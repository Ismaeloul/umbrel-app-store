/* «Ver juntos» (docs/ver-juntos.md §6): el reproductor de la sala.

   No es el `PlayerDock` de la casa: la sala manda en la posición, así que
   este reproductor no decide nada por su cuenta. Cada medio segundo mira
   dónde va la sala y corrige (salta, acelera o frena un poco, pausa o
   sigue). Lo que se toca en los controles va al servidor como orden y vuelve
   a todos a la vez por el SSE.

   - Vídeo: `partyStream` da la misma `VodGrant` que `vodStream` (hls.js con
     MSE; Safari y el iPhone, HLS nativo), con la URL de la sala (`partyVideo`).
     El latido de la sesión lo da el servidor con cada `status`, así que esto
     no llama a ninguna ruta de playback: sirve igual a los invitados de fuera
     (docs/ver-juntos.md §9).
   - Sesión perdida: si la sala está «interrumpida» (alguien de casa puso otra
     cosa), se espera a que alguien pulse «Reanudar»; si no, se vuelve a abrir
     sola (3 veces por minuto como mucho).
   - Idioma: si la sala cambia de pista, se vuelve a abrir el vídeo.
   - Otro título (la lista o el siguiente episodio, §11): también.
   - Quien no puede mandar (solo controla el líder) no manda órdenes desde los
     controles nativos: la corrección le devuelve a donde va la sala.
   - Controles nativos (pantalla completa del iPhone): un play, una pausa o un
     salto que no coincide con la sala se manda como orden, pero solo si la
     persona acaba de tocar o pulsar algo (o está en esa pantalla completa).
     Lo que hace el navegador por su cuenta (pausar al bloquear el iPhone, un
     vídeo silenciado que no se ve) no para a los demás.
   - El primer play necesita un toque (los navegadores no dejan sonar un
     vídeo solo): hasta entonces, «Toca para empezar».
   - «Esperando a todos» (§13): con la sala en espera, cada latido dice cuánto
     vídeo hay cargado por delante (`PARTY.lobbyBufferS` es el 100 %) y si ya
     puede empezar; la sala arranca sola cuando todos lo están.
   - En directo (§14): `partyStream` da una `StreamGrant` del canal de la sala
     (el remux del NAS, el mismo para todos). Nada de posición: cada uno va en
     el directo con la configuración de casa (`hlsConfig` del perfil
     equilibrado) y, si se para, vuelve a reproducir solo. Otro canal llega
     como otro título: se vuelve a abrir.
   - Calidad ligera para invitados (§17): solo la web del invitado manda
     `abr=1`. Si el servidor da dos versiones (`variants`), se acepta el título
     si decodifica alguna; con hls.js se empieza por la ligera con una
     adaptación prudente (`HLS_GUEST_ABR`) y, al atascarse, se baja a la
     ligera (hls.js no lo hace con el vídeo en pausa, y la sala lo pausa al
     esperar); en Safari la maestra va en `src` y, tras un atasco repetido, se
     pasa a `lo.m3u8` hasta el final del título. «Calidad» (Automática, Alta,
     Ligera) es de cada uno: nunca es una orden de la sala. */

import { PLAYBACK_PROFILES, type PartyRoom, type PartyStreamGrant } from '@ace/shared';
import { api, getDeviceId, getViewerId, isApiError } from '../../api/index.ts';
import {
  guestAbrConfig,
  HLS_PLAYLIST_RETRY,
  HLS_VOD_CONFIG,
  hlsConfig,
} from '../../player/engines/hls.ts';
import { chooseEngine, detectPlatform, streamClient } from '../../player/engines/index.ts';
import { absoluteUrl } from '../../player/engines/types.ts';
import { readItem, writeItem } from '../../lib/storage.ts';
import { canPlayHevc } from '../cine/play.ts';
import { canControl, type PartyClient } from './client.ts';
import {
  correction,
  forwardBufferEnd,
  isRunning,
  lobbyReport,
  RESUME_AHEAD_S,
  StallDetector,
  targetPosition,
} from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const TICK_MS = 500;
/** Tras perder la sesión sin interrupción, lo que se espera antes de reabrir. */
const REOPEN_DELAY_MS = 2_000;
const REOPENS_PER_MINUTE = 3;
/** Reproduciendo, entre dos saltos de corrección pasa al menos esto. */
const SEEK_BACKOFF_MS = 4_000;
/** Un salto en los controles nativos tiene que apartarse al menos esto de la sala para ser una orden. */
const NATIVE_SEEK_S = 1.5;
/** Un evento del vídeo hasta esto después de un toque o una tecla cuenta como de la persona. */
const USER_ACTION_MS = 1_500;
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;
/** Safari: si la otra lista no da sus datos en esto, se vuelve a abrir el vídeo entero. */
const NATIVE_SWAP_TIMEOUT_MS = 20_000;
/** Lo que tiene que avanzar el vídeo reproduciendo para que la sesión «haya sonado» (`sounded`). */
const SOUNDED_S = 3;
/** «Calidad» (§17): lo último que eligió esta persona, en este navegador. */
const QUALITY_KEY = 'aceneo-juntos-calidad';

/** «Calidad» del invitado (§17): la elige cada uno, nunca la sala. */
export type QualityChoice = 'auto' | 'hd' | 'lite';

export interface PlayerQuality {
  readonly choice: QualityChoice;
  /** La versión que se está cargando, o null si no se sabe (Safari con la lista maestra). */
  readonly current: 'hd' | 'lite' | null;
}

function isQualityChoice(value: unknown): value is QualityChoice {
  return value === 'auto' || value === 'hd' || value === 'lite';
}

/** La «Calidad» guardada (`auto` si no hay o no se puede leer: `readItem` va con try/catch). */
export function savedQuality(): QualityChoice {
  const value = readItem(QUALITY_KEY);
  return isQualityChoice(value) ? value : 'auto';
}

/**
 * La misma URL de la sala con otro fichero al final (`master.m3u8` → `lo.m3u8` o `index.m3u8`);
 * la query, si la hay, se queda.
 */
export function variantUrl(url: string, file: string): string {
  return url.replace(/[^/?#]+(?=[?#]|$)/, file);
}

export type PlayerPhase =
  | 'idle'
  | 'preparing'
  /** Listo, pero el navegador aún no ha dejado sonar: hace falta un toque. */
  | 'blocked'
  | 'ready'
  | 'interrupted'
  | 'error';

export interface PlayerView {
  readonly phase: PlayerPhase;
  readonly error: string | null;
  readonly positionS: number;
  readonly durationS: number | null;
  readonly bufferedS: number;
  readonly buffering: boolean;
  /** «Calidad» (§17): null salvo con dos versiones que este navegador decodifica. */
  readonly quality: PlayerQuality | null;
  /**
   * El vídeo de esta sesión ha sonado de verdad (ha avanzado `SOUNDED_S` reproduciendo). 'ready'
   * no basta: llega con la concesión, antes de que haya ningún fotograma. Vuelve a false al
   * abrir otra sesión o quitar el vídeo.
   */
  readonly sounded: boolean;
}

export interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(
    event: string,
    listener: (event: string, data: { fatal?: boolean; type?: string; level?: number }) => void,
  ): void;
  startLoad(position?: number): void;
  recoverMediaError(): void;
  destroy(): void;
  /* La calidad (§17). Nunca `currentLevel`: vacía el búfer ya y hace esperar a toda la sala. */
  readonly levels: ReadonlyArray<{ readonly uri?: string }>;
  readonly autoLevelEnabled: boolean;
  /** Lo que se está cargando; con un número, a mano y sin vaciar lo cargado; -1, automática. */
  loadLevel: number;
  /** Al siguiente fragmento, vaciando lo cargado por delante del que suena. */
  nextLevel: number;
  /** Sin tocar nada de lo cargado y sin salir de la automática. */
  nextLoadLevel: number;
}

export interface HlsStatic {
  new (config: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string; LEVEL_SWITCHED: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
}

/** Lo que el reproductor sabe de las dos versiones del invitado (§17). */
interface AbrState {
  readonly engine: 'hls' | 'native';
  /** Las listas: la maestra (`auto`), la original y la ligera. */
  readonly urls: Readonly<Record<QualityChoice, string>>;
  /** Safari: la lista que está en `src`. */
  src: QualityChoice;
}

export interface RoomPlayerOptions {
  /** La página del invitado (`/s/<código>`): solo ella pide las dos calidades (`abr=1`, §17). */
  readonly guest?: boolean;
}

/** Lo que el reproductor necesita de fuera (los tests lo cambian). */
export interface PlayerEnv {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  loadHls(): Promise<HlsStatic | null>;
  supportsType(type: string, native: boolean, video: HTMLVideoElement): boolean;
}

const BROWSER: PlayerEnv = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  loadHls: async () => {
    const module = await import('hls.js');
    const Hls = module.default as unknown as HlsStatic;
    return Hls.isSupported() ? Hls : null;
  },
  supportsType: (type, native, video) => {
    try {
      if (!native) {
        const mse = (globalThis as { MediaSource?: { isTypeSupported?(t: string): boolean } })
          .MediaSource;
        if (mse?.isTypeSupported) return mse.isTypeSupported(type);
      }
      return video.canPlayType(type) !== '';
    } catch {
      return false;
    }
  },
};

export class RoomPlayer {
  private view: PlayerView = {
    phase: 'idle',
    error: null,
    positionS: 0,
    durationS: null,
    bufferedS: 0,
    buffering: false,
    quality: null,
    sounded: false,
  };
  private readonly listeners = new Set<() => void>();
  private grant: PartyStreamGrant | null = null;
  /** ¿Atascado? Con histéresis; el colchón de partida depende del motor (se pone al abrir). */
  private stall = new StallDetector(RESUME_AHEAD_S.mse);
  /** El último salto de corrección (para no encadenarlos). */
  private lastSeekAt = Number.NEGATIVE_INFINITY;
  /** La última orden de la sala que se ha aplicado (`playback.rev`). */
  private seenRev: number | null = null;
  /** La orden de la sala (`playback.rev`) del último salto de corrección. */
  private seekRev: number | null = null;
  private hls: HlsInstance | null = null;
  /** Las dos versiones del invitado (§17), o null: `index.m3u8` como siempre. */
  private abr: AbrState | null = null;
  /** ¿Estaba atascado en el tic anterior? (la regla del atasco va al entrar). */
  private wasStalled = false;
  /** Los atascos repetidos ya vistos (`StallDetector.escalations`). */
  private escalationsSeen = 0;
  /** Dónde estaba el vídeo al verlo reproducir por primera vez en esta sesión (para `sounded`). */
  private soundFrom: number | null = null;
  /** Safari en «Automática»: el título que ya bajó a la ligera (no vuelve a subir solo). */
  private nativeLiteTitle: string | null = null;
  private swapTimer: unknown = null;
  private tickTimer: unknown = null;
  private reopenTimer: unknown = null;
  private reopens: number[] = [];
  private acquiredAudio: number | null = null;
  /** El título que se pidió en el último `acquire` (si la sala cambia de título, se vuelve a abrir). */
  private requestedTitle: string | null = null;
  private generation = 0;
  private unlocked = false;
  /** El play de «Toca para empezar» está en curso: no es una orden de la sala. */
  private unlocking = false;
  /** Último toque o tecla de la persona en la página (para distinguir sus órdenes de las del navegador). */
  private lastInteraction = Number.NEGATIVE_INFINITY;
  private readonly onInteraction = (): void => {
    this.lastInteraction = this.env.now();
  };
  private destroyed = false;
  private readonly viewer = getViewerId();
  private unsubscribe: (() => void) | null = null;
  private readonly onVideoEvent: Record<string, () => void>;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly client: PartyClient,
    private readonly options: RoomPlayerOptions = {},
    private readonly env: PlayerEnv = BROWSER,
  ) {
    this.onVideoEvent = {
      play: () => this.onNative('play'),
      pause: () => this.onNative('pause'),
      seeking: () => this.onNative('seeking'),
      /* Sin datos ya: atascado al momento (no hay que esperar al tic). */
      waiting: () => {
        if (this.view.phase === 'ready' && !this.video.paused) this.stall.waiting(this.env.now());
      },
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): PlayerView => this.view;

  private set(patch: Partial<PlayerView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    for (const [type, handler] of Object.entries(this.onVideoEvent)) {
      this.video.addEventListener(type, handler);
    }
    for (const type of INTERACTION_EVENTS) {
      globalThis.document?.addEventListener(type, this.onInteraction, {
        capture: true,
        passive: true,
      });
    }
    this.tickTimer = this.env.setInterval(() => this.tick(), TICK_MS);
    this.unsubscribe = this.client.subscribe(() => {
      this.reconcile();
      /* Una orden nueva de la sala (pausa, espera, salto) se aplica ya, no en el
         próximo tic: hasta 500 ms tarde, los demás seguían y luego volvían atrás. */
      const rev = this.room()?.playback.rev ?? null;
      if (rev !== this.seenRev) {
        this.seenRev = rev;
        this.tick();
      }
    });
    this.reconcile();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe?.();
    for (const [type, handler] of Object.entries(this.onVideoEvent)) {
      this.video.removeEventListener(type, handler);
    }
    for (const type of INTERACTION_EVENTS) {
      globalThis.document?.removeEventListener(type, this.onInteraction, { capture: true });
    }
    this.env.clearInterval(this.tickTimer);
    this.env.clearTimeout(this.reopenTimer);
    this.teardown();
  }

  /**
   * «Calidad» (§17), solo para este aparato: nunca manda nada a la sala. Con hls.js, «Ligera» va
   * al siguiente fragmento (`nextLevel`), «Alta» sigue tras lo cargado (`loadLevel`, sin vaciar)
   * y «Automática» devuelve la elección a hls.js. En Safari se cambia la lista (`src`) en
   * 'preparing', así los eventos del vídeo no son órdenes.
   */
  setQuality(choice: QualityChoice): void {
    const abr = this.abr;
    const quality = this.view.quality;
    if (!abr || !quality) return;
    writeItem(QUALITY_KEY, choice);
    this.set({ quality: { ...quality, choice } });
    const now = this.env.now();
    if (abr.engine === 'hls') {
      const hls = this.hls;
      if (!hls) return;
      /* Sin la maestra leída aún (un enlace lento) no hay niveles: `levelIndex` daría 0 (la
         ligera) y hls.js borra la elección manual al cargarla. Queda guardada (arriba) y la pone
         MANIFEST_PARSED. */
      if (!hls.levels.length) return;
      /* El atasco que provoque el cambio es nuestro: no sube el colchón. */
      this.stall.moved(now, true);
      if (choice === 'lite') hls.nextLevel = this.levelIndex('lite');
      else if (choice === 'hd') hls.loadLevel = this.levelIndex('hd');
      else hls.loadLevel = -1;
      return;
    }
    /* Elegir «Automática» a mano vuelve a la maestra aunque este título ya hubiera bajado. */
    if (choice === 'auto') this.nativeLiteTitle = null;
    this.swapNative(choice);
  }

  private room(): PartyRoom | null {
    return this.client.getState().room;
  }

  /** Lo que tiene que pasar con el vídeo según la sala (interrupción, idioma). */
  private reconcile(): void {
    if (this.destroyed) return;
    const state = this.client.getState();
    const room = state.room;
    if (state.closed) {
      this.teardown();
      this.set({ phase: 'idle' });
      return;
    }
    if (!room) return;
    const phase = this.view.phase;
    /* El latido de `status` dice que la sesión ya no está (y la sala no está interrumpida). */
    if (
      state.stream === 'lost' &&
      !room.interrupted &&
      (phase === 'ready' || phase === 'blocked')
    ) {
      this.lost();
      return;
    }
    if (room.interrupted) {
      if (phase !== 'interrupted' && phase !== 'error') {
        this.teardown();
        this.set({ phase: 'interrupted' });
      }
      return;
    }
    if (phase === 'idle' || phase === 'interrupted') {
      void this.acquire();
      return;
    }
    if (this.requestedTitle !== null && this.requestedTitle !== room.title.id) {
      this.reopens = [];
      void this.acquire();
      return;
    }
    const wanted = room.audio.index;
    if (
      this.grant &&
      wanted !== null &&
      wanted !== this.acquiredAudio &&
      (phase === 'ready' || phase === 'blocked')
    ) {
      this.teardown();
      void this.acquire();
    }
  }

  /** «Reanudar» o «Reintentar»: abre otra vez el vídeo de la sala. */
  retry(): void {
    this.reopens = [];
    void this.acquire();
  }

  private async acquire(): Promise<void> {
    const room = this.room();
    if (!room || this.destroyed) return;
    const generation = ++this.generation;
    this.requestedTitle = room.title.id;
    this.teardown();
    this.set({ phase: 'preparing', error: null });
    const platform = detectPlatform();
    let grant: PartyStreamGrant;
    try {
      grant = await api('partyStream', {
        params: { code: this.client.code },
        query: {
          client: streamClient(platform),
          viewer: this.viewer,
          device: getDeviceId(),
          hevc: canPlayHevc() ? '1' : '0',
          t: this.client.credential.token,
          /* Las dos calidades (§17), solo desde la página del invitado: en casa, la consulta de siempre. */
          ...(this.options.guest ? { abr: '1' as const } : {}),
        },
      });
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.set({
        phase: 'error',
        error: isApiError(error) ? error.message : JUNTOS_TEXT.interruptedFailed,
      });
      return;
    }
    if (generation !== this.generation || this.destroyed) return;
    /* Una sesión nueva: el «lost» que quedaba de la anterior ya no vale (si no, el siguiente
       evento de la sala la volvería a tirar). */
    this.client.resetStream();
    if (!('vod' in grant)) {
      await this.attachLive(grant, platform, generation);
      return;
    }
    const engine = chooseEngine(grant.protocol, platform);
    if (!engine) {
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
      return;
    }
    const decodes = (video: string): boolean =>
      this.env.supportsType(
        `video/mp4; codecs="${video},mp4a.40.2"`,
        engine === 'native',
        this.video,
      );
    /* Con dos versiones (§17), vale si decodifica alguna; con las dos, la maestra y «Calidad». */
    let url = grant.url;
    let abr: AbrState | null = null;
    const variants = grant.variants;
    if (variants) {
      const lite = decodes(variants.lite);
      const hd = variants.hd !== null && decodes(variants.hd);
      if (!lite && !hd) {
        this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
        return;
      }
      const urls = {
        auto: grant.url,
        hd: variantUrl(grant.url, 'index.m3u8'),
        lite: variantUrl(grant.url, 'lo.m3u8'),
      };
      if (lite && hd) {
        abr = { engine: engine === 'hls' ? 'hls' : 'native', urls, src: 'auto' };
      } else if (variants.hd !== null) {
        /* Solo una que sirva: esa lista, sin menú (la ligera sola ya viene así del servidor). */
        url = lite ? urls.lite : urls.hd;
      }
    } else if (!decodes(grant.vod.video.codecs)) {
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
      return;
    }
    this.grant = grant;
    /* Safari (HLS nativo) llena el colchón a trozos enteros: pide más para darse por recuperado. */
    this.stall = new StallDetector(
      engine === 'native' ? RESUME_AHEAD_S.native : RESUME_AHEAD_S.mse,
    );
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.wasStalled = false;
    this.escalationsSeen = 0;
    this.acquiredAudio = grant.vod.audioIndex >= 0 ? grant.vod.audioIndex : null;
    if (this.nativeLiteTitle !== room.title.id) this.nativeLiteTitle = null;
    const startS = targetPosition(room.playback, this.client.serverNow(), grant.vod.durationS);
    const Hls = engine === 'hls' ? await this.env.loadHls() : null;
    if (generation !== this.generation || this.destroyed) return;
    const choice = abr ? savedQuality() : 'auto';
    this.abr = abr;
    let current: PlayerQuality['current'] = null;
    if (Hls) {
      const hls = new Hls({
        manifestLoadingTimeOut: 20_000,
        ...HLS_PLAYLIST_RETRY,
        ...HLS_VOD_CONFIG,
        /* La maestra del invitado: la ligera primero y una adaptación prudente (§17). */
        ...(abr ? guestAbrConfig() : {}),
        startPosition: startS,
        enableInterstitialPlayback: false,
      });
      this.hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || this.hls !== hls) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.lost();
      });
      if (abr) {
        /* Lo elegido otra vez (si no es «Automática»): antes del primer fragmento, sin vaciar nada.
           Lo elegido AHORA, no lo guardado al entrar: el menú sale antes de leer la maestra y se
           puede cambiar mientras tanto. */
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const live = this.view.quality?.choice ?? choice;
          if (this.hls !== hls || live === 'auto') return;
          hls.loadLevel = this.levelIndex(live);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          const quality = this.view.quality;
          if (this.hls !== hls || !quality || data.level === undefined) return;
          const kind = this.levelKind(data.level);
          if (kind !== quality.current) this.set({ quality: { ...quality, current: kind } });
        });
        current = choice === 'hd' ? 'hd' : 'lite';
      }
      hls.loadSource(absoluteUrl(url));
      hls.attachMedia(this.video);
    } else {
      const onMeta = (): void => {
        this.video.removeEventListener('loadedmetadata', onMeta);
        if (Math.abs(this.video.currentTime - startS) > 2) this.seekVideo(startS);
      };
      if (abr) {
        /* Safari: la maestra (la ligera primero, AVPlayer sube solo), o la lista elegida; si este
           título ya bajó a la ligera por los atascos, sigue en ella. */
        abr.src = choice === 'auto' && this.nativeLiteTitle === room.title.id ? 'lite' : choice;
        url = abr.urls[abr.src];
        current = abr.src === 'auto' ? null : abr.src;
      }
      this.video.addEventListener('loadedmetadata', onMeta);
      this.video.src = absoluteUrl(url);
      try {
        this.video.load();
      } catch {}
    }
    this.set({
      phase: this.unlocked ? 'ready' : 'blocked',
      durationS: grant.vod.durationS,
      quality: abr ? { choice, current } : null,
    });
  }

  /** El nivel de hls.js de cada versión (por su lista; hls.js los ordena por altura). */
  private levelIndex(kind: 'hd' | 'lite'): number {
    const levels = this.hls?.levels ?? [];
    const lite = levels.findIndex((level) => /(^|\/)lo\.m3u8($|[?#])/.test(level.uri ?? ''));
    if (kind === 'lite') return lite >= 0 ? lite : 0;
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      if (index !== lite) return index;
    }
    return Math.max(0, levels.length - 1);
  }

  private levelKind(level: number): 'hd' | 'lite' {
    return level === this.levelIndex('lite') ? 'lite' : 'hd';
  }

  /**
   * Safari (§17): otra lista en `src` sin que cuente como orden. En 'preparing' `onNative` no
   * manda nada (ni la pausa ni el salto de la recarga) y la sala espera a este aparato como en
   * cualquier carga; con los datos, se coloca en la posición de la sala y sigue.
   */
  private swapNative(src: QualityChoice): void {
    const abr = this.abr;
    const quality = this.view.quality;
    if (!abr || abr.engine !== 'native' || abr.src === src || !quality) return;
    abr.src = src;
    const generation = this.generation;
    this.env.clearTimeout(this.swapTimer);
    this.set({ phase: 'preparing', quality: { ...quality, current: src === 'auto' ? null : src } });
    const onMeta = (): void => {
      this.video.removeEventListener('loadedmetadata', onMeta);
      this.env.clearTimeout(this.swapTimer);
      if (generation !== this.generation || this.destroyed || this.abr !== abr) return;
      if (abr.src !== src || this.view.phase !== 'preparing') return;
      const room = this.room();
      if (room) {
        this.stall.moved(this.env.now(), true);
        this.seekVideo(targetPosition(room.playback, this.client.serverNow(), this.view.durationS));
      }
      this.set({ phase: this.unlocked ? 'ready' : 'blocked' });
    };
    this.video.addEventListener('loadedmetadata', onMeta);
    /* Si la otra lista no llega, se vuelve a abrir todo (como una sesión perdida). */
    this.swapTimer = this.env.setTimeout(() => {
      this.video.removeEventListener('loadedmetadata', onMeta);
      if (generation !== this.generation || this.destroyed || this.abr !== abr) return;
      if (this.view.phase === 'preparing') this.lost();
    }, NATIVE_SWAP_TIMEOUT_MS);
    this.video.src = absoluteUrl(abr.urls[src]);
    try {
      this.video.load();
    } catch {}
  }

  /** En directo (§14): el canal de la sala, en el directo, sin posición que seguir. */
  private async attachLive(
    grant: PartyStreamGrant,
    platform: ReturnType<typeof detectPlatform>,
    generation: number,
  ): Promise<void> {
    const engine = chooseEngine(grant.protocol, platform);
    if (engine !== 'hls' && engine !== 'native') {
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
      return;
    }
    this.grant = grant;
    /* Safari (HLS nativo) llena el colchón a trozos enteros: pide más para darse por recuperado. */
    this.stall = new StallDetector(
      engine === 'native' ? RESUME_AHEAD_S.native : RESUME_AHEAD_S.mse,
    );
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.acquiredAudio = null;
    const Hls = engine === 'hls' ? await this.env.loadHls() : null;
    if (generation !== this.generation || this.destroyed) return;
    if (Hls) {
      const hls = new Hls(hlsConfig(PLAYBACK_PROFILES.balanced));
      this.hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || this.hls !== hls) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.lost();
      });
      hls.loadSource(absoluteUrl(grant.url));
      hls.attachMedia(this.video);
    } else {
      this.video.src = absoluteUrl(grant.url);
      try {
        this.video.load();
      } catch {}
    }
    this.set({ phase: this.unlocked ? 'ready' : 'blocked', durationS: null });
  }

  /** La sesión ya no está: se espera a ver si es una interrupción de la sala y, si no, se reabre. */
  private lost(): void {
    this.teardown();
    this.set({ phase: 'preparing' });
    this.env.clearTimeout(this.reopenTimer);
    this.reopenTimer = this.env.setTimeout(() => {
      if (this.destroyed || this.room()?.interrupted) return;
      const now = this.env.now();
      this.reopens = this.reopens.filter((at) => now - at < 60_000);
      if (this.reopens.length >= REOPENS_PER_MINUTE) {
        this.set({ phase: 'error', error: JUNTOS_TEXT.interruptedFailed });
        return;
      }
      this.reopens.push(now);
      void this.acquire();
    }, REOPEN_DELAY_MS);
  }

  /**
   * Quita el vídeo. La sesión de playback la suelta el servidor (al salir o
   * cerrar la sala) o caduca sola cuando deja de llegar el latido de `status`.
   */
  private teardown(): void {
    this.grant = null;
    this.abr = null;
    this.soundFrom = null;
    if (this.view.sounded) this.set({ sounded: false });
    this.env.clearTimeout(this.swapTimer);
    if (this.view.quality) this.set({ quality: null });
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video.getAttribute('src')) {
      this.video.removeAttribute('src');
      try {
        this.video.load();
      } catch {}
    }
  }

  // --- Sincronización ---

  private tick(): void {
    const room = this.room();
    const video = this.video;
    const phase = this.view.phase;
    const durationS =
      room?.title.durationS ?? (Number.isFinite(video.duration) ? video.duration : null);
    const preparing = phase === 'preparing';
    const ready = phase === 'ready';
    const now = this.env.now();
    let bufferedS = 0;
    try {
      const ranges = video.buffered;
      const list: [number, number][] = [];
      for (let i = 0; i < ranges.length; i += 1) list.push([ranges.start(i), ranges.end(i)]);
      bufferedS = list.length ? forwardBufferEnd(list, video.currentTime || 0) : 0;
    } catch {}
    /* Con histéresis (sync.ts, StallDetector): `readyState < 3` sola volvía a
       «listo» con un fotograma en el iPhone y la sala se paraba y seguía sin fin. */
    const stalled =
      ready &&
      this.stall.update({
        now,
        currentTime: video.currentTime || 0,
        paused: video.paused,
        seeking: video.seeking,
        ended: video.ended,
        readyState: video.readyState,
        aheadS: Math.max(0, bufferedS - (video.currentTime || 0)),
        leftS: durationS !== null ? Math.max(0, durationS - (video.currentTime || 0)) : null,
      });
    if (ready) this.adaptQuality(stalled, now);
    /* Safari cambiando de lista (§17) vuelve a 'preparing' en este mismo tic. */
    const buffering = preparing || this.view.phase === 'preparing' || stalled;
    const sounded = this.view.sounded || this.hasSounded(ready && !video.paused && !stalled);
    this.set({ positionS: video.currentTime || 0, durationS, bufferedS, buffering, sounded });
    this.client.report(
      video.currentTime || 0,
      buffering,
      room?.playback.lobby
        ? lobbyReport(
            ready || phase === 'blocked',
            video.currentTime || 0,
            video.readyState,
            bufferedS,
            durationS,
          )
        : null,
    );
    /* Si Safari acaba de cambiar de lista (§17), la colocación va al tener los datos. */
    if (!room || !ready || this.view.phase !== 'ready') return;
    /* En directo no hay posición que seguir: solo que no se quede parado. */
    if (room.live) {
      if (video.paused && !video.ended) this.playVideo();
      return;
    }
    const running = isRunning(room.playback);
    const target = targetPosition(room.playback, this.client.serverNow(), durationS);
    if (running && video.paused) this.playVideo();
    if (!running && !video.paused) this.pauseVideo();
    if (video.readyState < 1 || video.seeking) return;
    const fix = correction(video.currentTime, target, running);
    if (fix.kind === 'seek') {
      /* Reproduciendo, un salto cada `SEEK_BACKOFF_MS` como mucho: en una conexión
         justa, cada salto tira lo que se estaba bajando, cae sin datos, se aparta
         otra vez y vuelve a saltar (el «CD rayado»). En pausa se coloca siempre. */
      /* El freno es para la deriva: una orden nueva de la sala (un salto del líder) pasa siempre. */
      const order = room.playback.rev !== this.seekRev;
      if (running && !order && now - this.lastSeekAt < SEEK_BACKOFF_MS) return;
      video.playbackRate = 1;
      this.lastSeekAt = now;
      this.seekRev = room.playback.rev;
      this.stall.moved(now, true);
      this.seekVideo(fix.to);
    } else if (fix.kind === 'rate' && video.playbackRate !== fix.rate) {
      video.playbackRate = fix.rate;
    }
  }

  /** ¿Ya ha avanzado `SOUNDED_S` reproduciendo desde que se le vio empezar en esta sesión? */
  private hasSounded(playing: boolean): boolean {
    if (!playing) return false;
    const at = this.video.currentTime || 0;
    /* La primera vez, o tras un salto atrás: se empieza a contar desde aquí. */
    if (this.soundFrom === null || at < this.soundFrom) {
      this.soundFrom = at;
      return false;
    }
    return at - this.soundFrom >= SOUNDED_S;
  }

  /**
   * La calidad ante un atasco (§17), solo con las dos versiones y en «Automática»:
   * - hls.js: al ENTRAR en un atasco, si no está ya en la ligera, la siguiente carga es la ligera
   *   (`nextLoadLevel`, sin vaciar ni salir de la automática). hls.js tiene su bajada de emergencia,
   *   pero no corre con el vídeo en pausa, y la sala lo pausa mientras espera a este aparato. El
   *   rellenado que provoca es nuestro (`moved`): no sube el colchón.
   * - Safari: un atasco repetido (el que sube el colchón) pasa a `lo.m3u8` hasta el final del título,
   *   sin volver a subir solo. Con la pantalla completa del iPhone no: cambiar `src` la cerraría.
   */
  private adaptQuality(stalled: boolean, now: number): void {
    const entered = stalled && !this.wasStalled;
    this.wasStalled = stalled;
    const escalated = this.stall.escalations > this.escalationsSeen;
    this.escalationsSeen = this.stall.escalations;
    const abr = this.abr;
    if (!abr || this.view.quality?.choice !== 'auto') return;
    if (abr.engine === 'hls') {
      const hls = this.hls;
      if (!entered || !hls?.autoLevelEnabled || !hls.levels.length) return;
      const lite = this.levelIndex('lite');
      if (hls.loadLevel === lite) return;
      hls.nextLoadLevel = lite;
      this.stall.moved(now, true);
      return;
    }
    if (!escalated || abr.src !== 'auto') return;
    const fullscreen =
      (this.video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean })
        .webkitDisplayingFullscreen === true;
    if (fullscreen) return;
    const room = this.room();
    if (room) this.nativeLiteTitle = room.title.id;
    this.swapNative('lite');
  }

  private playVideo(): void {
    void this.video.play().catch((error: unknown) => {
      if ((error as { name?: string } | null)?.name === 'NotAllowedError') {
        this.unlocked = false;
        this.set({ phase: 'blocked' });
      }
    });
  }

  private pauseVideo(): void {
    this.video.pause();
  }

  private seekVideo(to: number): void {
    this.video.currentTime = to;
  }

  /** «Toca para empezar»: el play dentro del toque desbloquea el sonido para lo que venga. */
  unlock(): void {
    this.unlocked = true;
    this.unlocking = true;
    void this.video
      .play()
      .then(() => {
        const room = this.room();
        if (room && !isRunning(room.playback)) this.pauseVideo();
      })
      .catch(() => undefined)
      .finally(() => {
        this.unlocking = false;
      });
    if (this.view.phase === 'blocked') this.set({ phase: 'ready' });
  }

  /**
   * Un play, una pausa o un salto en el vídeo que NO coincide con lo que hace
   * la sala es un toque en los controles nativos: se manda como orden. Lo que
   * coincide (lo que hace este mismo código, o el salto de una recarga a la
   * posición de la sala) no es una orden.
   */
  private onNative(type: 'play' | 'pause' | 'seeking'): void {
    const room = this.room();
    if (this.view.phase !== 'ready' || !room || this.unlocking || room.live) return;
    if (!canControl(room, this.client.credential.id)) return;
    /* Con la página oculta (pestaña de fondo, iPhone bloqueado) el navegador pausa solo: eso no para a los demás. */
    if (globalThis.document?.visibilityState === 'hidden') return;
    /* Solo es de la persona si acaba de tocar o pulsar algo, o si está en la pantalla completa
       nativa del iPhone (sus controles no llegan como eventos de la página). El navegador
       también pausa por su cuenta: un vídeo silenciado que no se ve, el audio que se corta. */
    const nativeFullscreen =
      (this.video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean })
        .webkitDisplayingFullscreen === true;
    if (!nativeFullscreen && this.env.now() - this.lastInteraction > USER_ACTION_MS) return;
    const position = this.video.currentTime || 0;
    const playback = room.playback;
    if (type === 'play') {
      if (!playback.playing) {
        void this.client.control({ action: 'play', positionS: position }).catch(() => undefined);
      }
    } else if (type === 'pause') {
      /* Un vídeo que llega al final también se pausa: eso no es una orden. */
      if (isRunning(playback) && !this.video.ended) {
        void this.client.control({ action: 'pause', positionS: position }).catch(() => undefined);
      }
    } else {
      const target = targetPosition(playback, this.client.serverNow(), this.view.durationS);
      if (Math.abs(position - target) > NATIVE_SEEK_S) {
        void this.client.control({ action: 'seek', positionS: position }).catch(() => undefined);
      }
    }
  }
}
