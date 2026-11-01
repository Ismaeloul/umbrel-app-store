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
   - Los eventos del vídeo (play, pausa, salto) NUNCA son órdenes: solo se
     apuntan para depurar (`__aceJuntosDebug.native`). Antes, cualquier evento
     hasta 1,5 s después de un toque en cualquier parte de la página se
     mandaba como orden y salían en el chat pausas y saltos que nadie había
     dado (la 1.1.1 en el iPhone). Las órdenes salen de los controles de la
     sala y, fuera de la página, de Media Session (teclas multimedia, pantalla
     de bloqueo, Centro de control), con la posición de la sala.
   - El sonido (los navegadores no dejan sonar un vídeo sin un toque):
     - en pelis y series, el toque es «Estoy listo» (`vote`, §13): la sala no
       arranca hasta que lo han dado todos, así que al empezar suena en todos.
       Si aun así el navegador no deja (o se entra con la peli en marcha),
       «Toca para empezar» (`blocked`): nada de arrancar en silencio;
     - en directo, con que uno le dé basta: se intenta con sonido y, si el
       navegador no deja, se arranca en silencio (`soundBlocked`) para ir a la
       par con los demás, con «Activar sonido» (`unmute`, dentro de un toque).
       Solo si ni en silencio deja, «Toca para empezar».
   - Corrección (sync.ts): control proporcional de la velocidad y, al saltar
     reproduciendo, la posición de la sala más lo que tarda el salto en este
     aparato (`seekLead`, medido). Lo que quedó al colocarse se absorbe con la
     velocidad solo en Safari (`WAITED_STAY_S`); hls.js cae donde se le pide.
   - Recuperación: un fallo pasajero al abrir, un `error` del vídeo o los
     errores fatales de hls.js por encima de su presupuesto van a `lost()`
     (reabrir, 3 por minuto); en directo, si no avanza en `LIVE_SILENT_MS`,
     también.
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
import { routeUrl } from '../../api/routes.ts';
import { readSavedVolume } from '../../player/volume.ts';
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
  coldSeekLead,
  leadTarget,
  lobbyReport,
  pausedSeek,
  RESUME_AHEAD_S,
  SAME_TARGET_S,
  seekLead,
  seekPlan,
  StallDetector,
  targetPosition,
  WAITED_STAY_S,
} from './sync.ts';
import type { PausedSeek, SyncEngine } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const TICK_MS = 500;
/** Tras perder la sesión sin interrupción, lo que se espera antes de reabrir. */
const REOPEN_DELAY_MS = 2_000;
const REOPENS_PER_MINUTE = 3;
/** Reproduciendo, entre dos saltos de corrección pasa al menos esto. */
const SEEK_BACKOFF_MS = 4_000;
/**
 * Safari: tras colocarse por una orden o al seguir la sala, durante esto lo que quede hasta
 * `WAITED_STAY_S` se corrige con la velocidad, no saltando (§16). Acaba antes en cuanto la deriva
 * baja de `ABSORB_DONE_S`. hls.js no lo necesita: cae justo donde se le pide.
 */
const LANDING_ABSORB_MS = 60_000;
const ABSORB_DONE_S = 0.1;
/** Con `?debug=juntos`, los toques y teclas de la página (solo para `msSinceInteraction`). */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;
/**
 * Tras un play que falla (no por el sonido, ni AbortError, que es una pausa nuestra), lo que se
 * espera para volver a intentarlo.
 */
const PLAY_RETRY_MS = 2_000;
/** En directo, si el vídeo no avanza en esto (y debería), se da la sesión por perdida. */
export const LIVE_SILENT_MS = 25_000;
/** hls.js: errores fatales de cada tipo (red, medio) que se recuperan por minuto; más, `lost()`. */
const HLS_FATAL_BUDGET = 2;
const HLS_FATAL_WINDOW_MS = 60_000;
/** Errores pasajeros al abrir: se reintenta con `lost()` (además de la red, los 5xx y `timeout`). */
const TRANSIENT_OPEN_ERRORS: ReadonlySet<string> = new Set([
  'remux_timeout',
  'engine_timeout',
  'remux_died',
]);
/** Las medidas de lo que tarda un salto que se guardan (`seekLead`). */
const LEAD_SAMPLES = 20;
/** Una medida de salto de más de esto se descarta (un atasco, no un salto). */
const LEAD_PROBE_MAX_MS = 10_000;
/** Media Session: lo que saltan «atrás» y «adelante». */
const MEDIA_SEEK_S = 10;
/** La barra de la pantalla de bloqueo (`setPositionState`): cada esto como mucho (como en casa). */
const MEDIA_POSITION_MS = 2_000;
/** La segunda línea de Media Session cuando el título no tiene otra. */
const MEDIA_ARTIST = 'Ver juntos';
const MEDIA_ACTIONS = ['play', 'pause', 'seekto', 'seekbackward', 'seekforward'] as const;
const APP_ARTWORK: MediaImage[] = [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
];
/** Los últimos tics y eventos del vídeo que se guardan para depurar (`?debug=juntos`). */
const TICK_LOG_SIZE = 120;
const NATIVE_LOG_SIZE = 50;
/** Safari: si la otra lista no da sus datos en esto, se vuelve a abrir el vídeo entero. */
const NATIVE_SWAP_TIMEOUT_MS = 20_000;
/** Lo que tiene que avanzar el vídeo reproduciendo para que la sesión «haya sonado» (`sounded`). */
const SOUNDED_S = 3;
/** «Calidad» (§17): lo último que eligió esta persona, en este navegador. */
const QUALITY_KEY = 'aceneo-juntos-calidad';
/** Los últimos saltos de corrección que se guardan para depurar (§16, `?debug=juntos`). */
const SEEK_LOG_SIZE = 50;

/**
 * Un salto de corrección (§16): a dónde, desde dónde, con qué orden de la sala y dónde cayó al
 * llegar 'seeked'. Con `?debug=juntos` en la URL se ven en `window.__aceJuntosDebug.seeks`
 * (el inspector web del iPhone o Safari del Mac, que usa el mismo AVFoundation).
 */
export interface SeekRecord {
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly rev: number;
  readonly running: boolean;
  readonly readyState: number;
  /** Lo que se compensó por lo que tarda el salto (ms; 0 en pausa). */
  readonly lead: number;
  landed: number | null;
  landedAt: number | null;
}

/** Un tic con la sala en marcha o parada (para depurar): deriva, velocidad, reloj y compensación. */
export interface TickRecord {
  readonly at: number;
  readonly drift: number;
  readonly rate: number;
  readonly offsetMs: number;
  readonly rttMs: number | null;
  readonly lead: number;
  readonly engine: SyncEngine;
}

/** Un evento del vídeo (play, pausa, salto): solo se apunta, nunca es una orden. */
export interface NativeRecord {
  readonly at: number;
  readonly type: 'play' | 'pause' | 'seeking';
  readonly positionS: number;
  readonly phase: PlayerPhase;
  /** Desde el último toque o tecla en la página (solo con `?debug=juntos`), o null. */
  readonly msSinceInteraction: number | null;
}

/** Lo que `debug()` devuelve (y `window.__aceJuntosDebug` con `?debug=juntos`). */
export interface PlayerDebug {
  readonly seeks: readonly SeekRecord[];
  readonly ticks: readonly TickRecord[];
  readonly native: readonly NativeRecord[];
  readonly orders: ReturnType<PartyClient['getOrders']>;
  readonly view: PlayerView;
  /** Lo que se compensa ahora por lo que tarda un salto con datos (ms). */
  readonly lead: number;
  /** Y uno sin datos (ms), o null si aún no se ha medido ninguno. */
  readonly coldLead: number | null;
  readonly engine: SyncEngine;
  /** El sonido: si ya hubo un toque, si el silencio es nuestro y qué play está en curso. */
  readonly sound: {
    readonly unlocked: boolean;
    readonly voted: boolean;
    readonly autoMuted: boolean;
    readonly autoStarting: boolean;
    readonly unlocking: boolean;
  };
}

function debugEnabled(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('debug') === 'juntos';
  } catch {
    return false;
  }
}

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
  /**
   * El navegador no deja reproducir ni en silencio: hace falta un toque. Es el respaldo; lo normal
   * es arrancar en silencio (`soundBlocked`).
   */
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
  /**
   * El vídeo va, pero en silencio: el navegador no dejó sonar sin un toque. La interfaz ofrece
   * «Activar sonido» (`unmute`).
   */
  readonly soundBlocked: boolean;
  /**
   * «Estoy listo» (§13): esta página ya ha dado el toque que deja sonar el vídeo (`vote`, `unlock`
   * o `unmute`). Dura lo que la página: el título siguiente no lo vuelve a pedir.
   */
  readonly voted: boolean;
  /**
   * El error es de este aparato, no del vídeo de la sala: este navegador no decodifica el códec
   * (`codecUnsupported`). Otro aparato lo puede estar viendo bien: el «Cambio automático si se
   * cae» no lo cuenta como canal caído. Vuelve a false con cualquier otra fase.
   */
  readonly localError: boolean;
}

/** Lo que se mira de un error de hls.js. */
export interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
  level?: number;
  response?: { code?: number };
}

export interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: HlsErrorData) => void): void;
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
  /** Media Session del navegador, o null (los tests dan una de mentira). */
  mediaSession?(): MediaSession | null;
  /** ¿Se ve la página? (sin esto, sí). */
  visible?(): boolean;
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
  mediaSession: () => {
    try {
      return typeof navigator !== 'undefined' && 'mediaSession' in navigator
        ? navigator.mediaSession
        : null;
    } catch {
      return null;
    }
  },
  visible: () => globalThis.document?.visibilityState !== 'hidden',
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
    soundBlocked: false,
    voted: false,
    localError: false,
  };
  private readonly listeners = new Set<() => void>();
  private grant: PartyStreamGrant | null = null;
  /** ¿Atascado? Con histéresis; el colchón de partida depende del motor (se pone al abrir). */
  private stall = new StallDetector(RESUME_AHEAD_S.mse);
  /** El último salto de corrección (para no encadenarlos). */
  private lastSeekAt = Number.NEGATIVE_INFINITY;
  /** La última orden de la sala que se ha aplicado (`playback.rev`). */
  private seenRev: number | null = null;
  /**
   * La posición de la sala (`playback.positionS`) de la última orden ya atendida: saltando a ella o
   * quedándose donde estaba. Una orden es otra posición (un salto o una pausa del líder), no otro
   * `rev`: «esperando a…», «entra…» y «sigue» lo suben sin mover la sala (§16).
   */
  private placedS: number | null = null;
  /** ¿La sala reproducía en el tic anterior? (al seguir, se absorbe con la velocidad). */
  private wasRunning = false;
  /** Hasta cuándo lo que quedó al colocarse se absorbe con la velocidad (`LANDING_ABSORB_MS`). */
  private absorbUntil = Number.NEGATIVE_INFINITY;
  /** El último salto en pausa (`pausedSeek`, §16): no se repite en cada tic. */
  private lastPausedSeek: PausedSeek | null = null;
  /** Los últimos saltos de corrección (§16), para depurar en el aparato. */
  private readonly seekLog: SeekRecord[] = [];
  /** Los últimos tics y eventos del vídeo, para depurar. */
  private readonly tickLog: TickRecord[] = [];
  private readonly nativeLog: NativeRecord[] = [];
  /** El motor de esta sesión (el umbral en pausa, la absorción y la compensación del salto). */
  private engine: SyncEngine = 'mse';
  /**
   * Las medidas de lo que tarda un salto en volver a avanzar, por motor (ms): aparte las de saltos
   * que cayeron en lo cargado (`warm`) y las de saltos sin datos (`cold`).
   */
  private leadSamples: Record<SyncEngine, { warm: number[]; cold: number[] }> = {
    mse: { warm: [], cold: [] },
    native: { warm: [], cold: [] },
  };
  /** El salto que se está midiendo: cuándo se pidió, dónde cayó ('seeked') y si tenía datos. */
  private leadProbe: { at: number; landed: number | null; loaded: boolean } | null = null;
  /** ¿Se corregía con la velocidad en el tic anterior? (la histéresis de `correction`). */
  private correcting = false;
  /** El `loadedmetadata` pendiente de colocar (se quita al quitar el vídeo). */
  private pendingMeta: (() => void) | null = null;
  /** Hay un play() en curso: no se pide otro en cada tic. */
  private playInFlight = false;
  /** Tras un play fallido (no por el sonido), no antes de esto. */
  private playRetryAt = Number.NEGATIVE_INFINITY;
  /** El silencio lo puso este código (el navegador no dejaba sonar): no se guarda como volumen. */
  private autoMuted = false;
  /** El play en silencio de `autoStart` está en curso (para depurar). */
  private autoStarting = false;
  /** Los errores fatales recientes de hls.js, por tipo (su presupuesto). */
  private hlsFatal: { network: number[]; media: number[] } = { network: [], media: [] };
  /** En directo: la última vez que el vídeo avanzó (o que no tenía por qué). */
  private liveMovedAt = 0;
  private liveLastTime = Number.NaN;
  /** La sesión (`generation`) cuyo primer 'playing' ya volvió a poner Media Session. */
  private mediaBoundFor = -1;
  private mediaState: MediaSessionPlaybackState | null = null;
  /** La última `setPositionState` (y con qué estado), para no llamarla en cada tic. */
  private mediaPositionAt = Number.NEGATIVE_INFINITY;
  private mediaPositionPlaying: boolean | null = null;
  /**
   * Una pausa solo de este aparato (Media Session con la página oculta: los AirPods al quitarlos,
   * la pantalla de bloqueo): el tic no vuelve a reproducir hasta un «reproducir» o hasta que la
   * página se vuelve a ver.
   */
  private heldPause = false;
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
  /** Ya hubo un play con sonido dentro de un toque (`unlock`, `unmute`). */
  private unlocked = false;
  /**
   * «Estoy listo» (§13): esta página ya ha recibido un toque que deja sonar el vídeo (`vote`,
   * `unlock` o `unmute`). Va en cada `status`; la sala de pelis y series no arranca sola sin el
   * de todos. Al recargar, vuelve a false (el navegador vuelve a pedir el toque).
   */
  private voted = false;
  /** El play de «Toca para empezar» está en curso, hasta su propia pausa (para depurar). */
  private unlocking = false;
  /** Con `?debug=juntos`: el último toque o tecla en la página (solo para `NativeRecord`). */
  private lastInteraction = Number.NEGATIVE_INFINITY;
  private readonly onInteraction = (): void => {
    this.lastInteraction = this.env.now();
  };
  private readonly debugging = debugEnabled();
  /** Quitando el vídeo: su 'error' (al vaciar `src`) no es una sesión perdida. */
  private tearingDown = false;
  private readonly onVisibility = (): void => {
    if (this.destroyed || this.env.visible?.() === false) return;
    /* De vuelta a la página: la pausa solo de este aparato se acaba (se vuelve con la sala), el
       play en silencio que se esperaba, y Media Session otra vez. */
    this.heldPause = false;
    this.tick();
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
      seeked: () => this.onSeeked(),
      /* Sin datos ya: atascado al momento (no hay que esperar al tic). */
      waiting: () => {
        if (this.view.phase === 'ready' && !this.video.paused) this.stall.waiting(this.env.now());
      },
      timeupdate: () => this.measureLead(false),
      playing: () => this.onPlaying(),
      volumechange: () => this.onVolume(),
      error: () => this.onVideoError(),
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): PlayerView => this.view;

  /** Los últimos saltos de corrección (§16), del más viejo al más nuevo. */
  getSeeks = (): readonly SeekRecord[] => this.seekLog;

  /**
   * Para depurar en el aparato (`?debug=juntos`, la capa de la sala): saltos, tics, eventos del
   * vídeo, órdenes de este aparato, la vista y la compensación del salto.
   */
  debug = (): PlayerDebug => ({
    seeks: this.seekLog,
    ticks: this.tickLog,
    native: this.nativeLog,
    orders: this.client.getOrders(),
    view: this.view,
    lead: this.currentLead(),
    coldLead: this.coldLead(),
    engine: this.engine,
    sound: {
      unlocked: this.unlocked,
      voted: this.voted,
      autoMuted: this.autoMuted,
      autoStarting: this.autoStarting,
      unlocking: this.unlocking,
    },
  });

  private set(patch: Partial<PlayerView>): void {
    /* Otra fase sin decir nada del error local: ya no lo es. */
    const reset = patch.phase !== undefined && patch.localError === undefined;
    this.view = { ...this.view, ...(reset ? { localError: false } : {}), ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  start(): void {
    for (const [type, handler] of Object.entries(this.onVideoEvent)) {
      this.video.addEventListener(type, handler);
    }
    if (this.debugging) {
      for (const type of INTERACTION_EVENTS) {
        globalThis.document?.addEventListener(type, this.onInteraction, {
          capture: true,
          passive: true,
        });
      }
    }
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility);
    this.tickTimer = this.env.setInterval(() => this.tick(), TICK_MS);
    if (this.debugging) {
      const client = this.client;
      (globalThis as { __aceJuntosDebug?: unknown }).__aceJuntosDebug = {
        seeks: this.seekLog,
        ticks: this.tickLog,
        native: this.nativeLog,
        get orders() {
          return client.getOrders();
        },
        view: () => this.view,
        debug: this.debug,
      };
    }
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
    if (this.debugging) {
      for (const type of INTERACTION_EVENTS) {
        globalThis.document?.removeEventListener(type, this.onInteraction, { capture: true });
      }
    }
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.env.clearInterval(this.tickTimer);
    this.env.clearTimeout(this.reopenTimer);
    this.teardown();
    this.clearMediaSession();
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
      /* Pasajero (la red, un plazo, un 5xx, el remux o el motor que tardan): reabrir con su tope
         (`lost`), en 'preparing'. Lo demás (un 4xx: la sala no tiene título, el vídeo no está) va
         a «Reintentar». */
      if (transientOpenError(error)) {
        this.lost();
        return;
      }
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
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported, localError: true });
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
        this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported, localError: true });
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
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported, localError: true });
      return;
    }
    this.grant = grant;
    this.engine = engine === 'native' ? 'native' : 'mse';
    this.correcting = false;
    this.leadProbe = null;
    /* Safari (HLS nativo) llena el colchón a trozos enteros: pide más para darse por recuperado.
       En pausa, no más de lo de partida: AVPlayer puede no llenar 10 s parado (§16). */
    this.stall =
      engine === 'native'
        ? new StallDetector(RESUME_AHEAD_S.native, { pausedMaxS: RESUME_AHEAD_S.native })
        : new StallDetector(RESUME_AHEAD_S.mse);
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.lastPausedSeek = null;
    this.wasStalled = false;
    this.escalationsSeen = 0;
    this.acquiredAudio = grant.vod.audioIndex >= 0 ? grant.vod.audioIndex : null;
    if (this.nativeLiteTitle !== room.title.id) this.nativeLiteTitle = null;
    const durationS = grant.vod.durationS;
    const Hls = engine === 'hls' ? await this.env.loadHls() : null;
    if (generation !== this.generation || this.destroyed) return;
    const choice = abr ? savedQuality() : 'auto';
    this.abr = abr;
    let current: PlayerQuality['current'] = null;
    if (Hls) {
      /* La posición se calcula al leer la lista (`startLoad`), no antes de cargar hls.js: con
         la sala en marcha, los segundos de la apertura eran segundos de retraso. */
      const hls = new Hls({
        manifestLoadingTimeOut: 20_000,
        ...HLS_PLAYLIST_RETRY,
        ...HLS_VOD_CONFIG,
        /* La maestra del invitado: la ligera primero y una adaptación prudente (§17). */
        ...(abr ? guestAbrConfig() : {}),
        autoStartLoad: false,
        enableInterstitialPlayback: false,
      });
      this.hls = hls;
      this.bindHlsErrors(hls, Hls);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this.hls !== hls || generation !== this.generation) return;
        hls.startLoad(this.placement(durationS));
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
      /* La posición, al tener los datos (la de ese momento, no la de antes de abrir). */
      const onMeta = (): void => {
        this.dropPendingMeta();
        if (generation !== this.generation || this.destroyed) return;
        const to = this.placement(durationS);
        if (Math.abs(this.video.currentTime - to) > 2) this.seekVideo(to);
      };
      if (abr) {
        /* Safari: la maestra (la ligera primero, AVPlayer sube solo), o la lista elegida; si este
           título ya bajó a la ligera por los atascos, sigue en ella. */
        abr.src = choice === 'auto' && this.nativeLiteTitle === room.title.id ? 'lite' : choice;
        url = abr.urls[abr.src];
        current = abr.src === 'auto' ? null : abr.src;
      }
      this.watchMeta(onMeta);
      this.video.src = absoluteUrl(url);
      try {
        this.video.load();
      } catch {}
    }
    /* Siempre 'ready': el tic intenta reproducir (con sonido o, si no deja, en silencio).
       'blocked' solo sale de `playVideo`. */
    this.set({
      phase: 'ready',
      durationS: grant.vod.durationS,
      quality: abr ? { choice, current } : null,
    });
    this.bindMediaSession();
  }

  /**
   * Dónde colocarse al abrir, ahora: la posición de la sala y, si está en marcha, lo que tarda en
   * arrancar (`seekLead`, con el tope de lo no cargado: al abrir no hay nada cargado).
   */
  private placement(durationS: number | null): number {
    const room = this.room();
    if (!room) return 0;
    const target = targetPosition(room.playback, this.client.serverNow(), durationS);
    return isRunning(room.playback)
      ? leadTarget(target, this.currentLead(), [], durationS, this.coldLead())
      : target;
  }

  private watchMeta(onMeta: () => void): void {
    this.dropPendingMeta();
    this.pendingMeta = onMeta;
    this.video.addEventListener('loadedmetadata', onMeta);
  }

  private dropPendingMeta(): void {
    if (this.pendingMeta) this.video.removeEventListener('loadedmetadata', this.pendingMeta);
    this.pendingMeta = null;
  }

  /**
   * Los errores fatales de hls.js, con presupuesto (como `HLS_RECOVERY` en casa): hasta
   * `HLS_FATAL_BUDGET` de red (`startLoad`) y otros tantos de medio (`recoverMediaError`) por
   * minuto; más, o una lista que da 404/403 (la sesión ya no está), `lost()`. Antes se
   * reintentaba sin fin y el iPhone pedía cada segmento 5-10 veces.
   */
  private bindHlsErrors(hls: HlsInstance, Hls: HlsStatic): void {
    this.hlsFatal = { network: [], media: [] };
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || this.hls !== hls) return;
      const now = this.env.now();
      const code = data.response?.code ?? 0;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const playlist = /manifest|level/i.test(data.details ?? '');
        if (playlist && (code === 404 || code === 403)) {
          this.lost();
          return;
        }
        if (!this.spendHlsBudget('network', now)) {
          this.lost();
          return;
        }
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (!this.spendHlsBudget('media', now)) {
          this.lost();
          return;
        }
        hls.recoverMediaError();
      } else {
        this.lost();
      }
    });
  }

  /** ¿Queda presupuesto para recuperar este tipo de error? (y lo gasta). */
  private spendHlsBudget(kind: 'network' | 'media', now: number): boolean {
    const recent = this.hlsFatal[kind].filter((at) => now - at < HLS_FATAL_WINDOW_MS);
    if (recent.length >= HLS_FATAL_BUDGET) {
      this.hlsFatal[kind] = recent;
      return false;
    }
    this.hlsFatal[kind] = [...recent, now];
    return true;
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
      this.dropPendingMeta();
      this.env.clearTimeout(this.swapTimer);
      if (generation !== this.generation || this.destroyed || this.abr !== abr) return;
      if (abr.src !== src || this.view.phase !== 'preparing') return;
      if (this.room()) {
        this.stall.moved(this.env.now(), true);
        this.seekVideo(this.placement(this.view.durationS));
      }
      this.set({ phase: 'ready' });
    };
    this.watchMeta(onMeta);
    /* Si la otra lista no llega, se vuelve a abrir todo (como una sesión perdida). */
    this.swapTimer = this.env.setTimeout(() => {
      this.dropPendingMeta();
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
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported, localError: true });
      return;
    }
    /* El códec del canal, si se sabe: un HEVC que este navegador no decodifica no se queda
       cargando para siempre (pedía cada segmento una y otra vez). */
    if (grant.codec.video === 'hevc') {
      const hevc = this.env.supportsType(
        'video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"',
        engine === 'native',
        this.video,
      );
      if (!hevc) {
        this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported, localError: true });
        return;
      }
    }
    this.grant = grant;
    this.engine = engine === 'native' ? 'native' : 'mse';
    /* Safari (HLS nativo) llena el colchón a trozos enteros: pide más para darse por recuperado. */
    this.stall = new StallDetector(
      engine === 'native' ? RESUME_AHEAD_S.native : RESUME_AHEAD_S.mse,
    );
    this.lastSeekAt = Number.NEGATIVE_INFINITY;
    this.acquiredAudio = null;
    this.liveMovedAt = this.env.now();
    this.liveLastTime = Number.NaN;
    const Hls = engine === 'hls' ? await this.env.loadHls() : null;
    if (generation !== this.generation || this.destroyed) return;
    if (Hls) {
      const hls = new Hls(hlsConfig(PLAYBACK_PROFILES.balanced));
      this.hls = hls;
      this.bindHlsErrors(hls, Hls);
      hls.loadSource(absoluteUrl(grant.url));
      hls.attachMedia(this.video);
    } else {
      this.video.src = absoluteUrl(grant.url);
      try {
        this.video.load();
      } catch {}
    }
    this.set({ phase: 'ready', durationS: null });
    this.bindMediaSession();
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
    this.leadProbe = null;
    this.playInFlight = false;
    this.dropPendingMeta();
    if (this.view.sounded) this.set({ sounded: false });
    this.env.clearTimeout(this.swapTimer);
    if (this.view.quality) this.set({ quality: null });
    /* `muted` no se toca: si el navegador no dejaba sonar, sigue sin dejar en la sesión nueva. */
    this.tearingDown = true;
    try {
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
    } finally {
      this.tearingDown = false;
    }
  }

  /**
   * Un `error` del `<video>` (Safari: la lista o un segmento que ya no están, un códec que no
   * puede): la sesión, perdida. Con hls.js no: sus errores van por `bindHlsErrors`. Lo que pasa
   * al quitar el vídeo tampoco.
   */
  private onVideoError(): void {
    if (this.tearingDown || this.destroyed || !this.grant || this.hls) return;
    if (this.view.phase !== 'ready' && this.view.phase !== 'preparing') return;
    this.lost();
  }

  // --- Sincronización ---

  private tick(): void {
    if (this.destroyed) return;
    const room = this.room();
    const video = this.video;
    const phase = this.view.phase;
    const durationS =
      room?.title.durationS ?? (Number.isFinite(video.duration) ? video.duration : null);
    const preparing = phase === 'preparing';
    const ready = phase === 'ready';
    const now = this.env.now();
    let bufferedS = 0;
    const ranges: [number, number][] = [];
    try {
      const buffered = video.buffered;
      for (let i = 0; i < buffered.length; i += 1)
        ranges.push([buffered.start(i), buffered.end(i)]);
      bufferedS = ranges.length ? forwardBufferEnd(ranges, video.currentTime || 0) : 0;
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
      this.voted,
    );
    /* Lo que la sala quiere (reproducir), no si va ya: con la sala esperando a alguien, la tecla
       de alternar del sistema debe mandar «pausa», como el botón de la sala. */
    if (room) {
      const playing = !this.heldPause && (room.live !== null || room.playback.playing);
      this.mediaPlaybackState(playing ? 'playing' : 'paused');
      this.mediaPosition(room, durationS, playing, now, false);
    }
    /* Sin poder reproducir (cargando, «Toca para empezar»), el directo no cuenta como parado. */
    if (!ready || this.view.phase !== 'ready') this.liveMovedAt = now;
    /* Si Safari acaba de cambiar de lista (§17), la colocación va al tener los datos. */
    if (!room || !ready || this.view.phase !== 'ready') return;
    /* En directo no hay posición que seguir: solo que no se quede parado. */
    if (room.live) {
      if (video.paused && !video.ended && !this.heldPause) this.playVideo();
      this.watchLive(now);
      return;
    }
    const running = isRunning(room.playback);
    /* La sala sigue (tras una pausa o una espera): en Safari, lo que quedó al colocarse, con la
       velocidad. */
    if (running && !this.wasRunning) this.absorbUntil = now + LANDING_ABSORB_MS;
    this.wasRunning = running;
    const target = targetPosition(room.playback, this.client.serverNow(), durationS);
    if (running && video.paused && !this.heldPause) this.playVideo();
    if (!running && !video.paused) this.pauseVideo();
    if (video.readyState < 1 || video.seeking) return;
    /* El aparato acaba de dormir (el iPhone bloqueado, el Mac en reposo): hasta la siguiente ida
       y vuelta, la hora de la sala es una estimación. Reproduciendo no se salta ni se corrige con
       ella; antes, al volver, se saltaba a una posición de hace minutos. */
    if (running && this.client.clockStale()) {
      if (video.playbackRate !== 1) video.playbackRate = 1;
      this.correcting = false;
      return;
    }
    /* Una orden es otra posición de la sala, no otro `rev` (§16). */
    const order =
      this.placedS === null || Math.abs(room.playback.positionS - this.placedS) >= SAME_TARGET_S;
    this.placedS = room.playback.positionS;
    const engine = this.engine;
    const drift = target - video.currentTime;
    /* Safari no cae justo donde se le pide (el fotograma clave, a 1-2 s): otro salto caería en el
       mismo sitio tras tirar el colchón. Hasta `WAITED_STAY_S`, la velocidad lo absorbe; en cuanto
       la deriva es pequeña, se acabó. hls.js cae donde se le pide: con él no se absorbe. */
    if (this.absorbUntil > now && Math.abs(drift) < ABSORB_DONE_S) {
      this.absorbUntil = Number.NEGATIVE_INFINITY;
    }
    const absorbing = engine === 'native' && running && !order && now < this.absorbUntil;
    const fix = correction(video.currentTime, target, running, {
      engine,
      ...(absorbing ? { seekS: WAITED_STAY_S } : {}),
      correcting: this.correcting,
    });
    this.correcting = fix.kind === 'rate' && fix.rate !== 1;
    const lead = running ? this.currentLead() : 0;
    this.logTick({
      at: now,
      drift,
      rate: fix.kind === 'rate' ? fix.rate : video.playbackRate,
      offsetMs: this.client.getState().offsetMs,
      rttMs: this.client.clockInfo().rttMs,
      lead,
      engine,
    });
    if (fix.kind === 'seek') {
      /* Reproduciendo, un salto cada `SEEK_BACKOFF_MS` como mucho: en una conexión
         justa, cada salto tira lo que se estaba bajando, cae sin datos, se aparta
         otra vez y vuelve a saltar (el «CD rayado»). */
      /* El freno es para la deriva: una orden nueva de la sala (un salto del líder) pasa siempre. */
      if (running) {
        if (!order && now - this.lastSeekAt < SEEK_BACKOFF_MS) return;
        this.lastPausedSeek = null;
      } else {
        /* En pausa, una vez por orden (§16): Safari no cae justo donde se le pide y cada salto
           vaciaba lo cargado; con la sala esperando a este aparato, no se mueve. */
        const next = pausedSeek({
          rev: room.playback.rev,
          target: fix.to,
          localS: video.currentTime,
          last: this.lastPausedSeek,
          now,
          backoffMs: SEEK_BACKOFF_MS,
          waitedFor: room.playback.waitingFor.includes(this.client.credential.id),
        });
        if (!next) return;
        this.lastPausedSeek = next;
      }
      /* Reproduciendo, a donde irá la sala cuando el vídeo vuelva a avanzar (lo que tarda el
         salto en este aparato), si eso está cargado. En pausa, justo a la posición. */
      const plan = running
        ? seekPlan(fix.to, lead, ranges, durationS, this.coldLead())
        : { to: fix.to, loaded: true };
      const to = plan.to;
      video.playbackRate = 1;
      this.correcting = false;
      this.lastSeekAt = now;
      if (running) this.absorbUntil = now + LANDING_ABSORB_MS;
      this.stall.moved(now, true);
      this.logSeek({
        at: now,
        from: video.currentTime,
        to,
        rev: room.playback.rev,
        running,
        readyState: video.readyState,
        lead: running ? lead : 0,
        landed: null,
        landedAt: null,
      });
      this.leadProbe = running ? { at: now, landed: null, loaded: plan.loaded } : null;
      this.seekVideo(to);
    } else if (fix.kind === 'rate' && video.playbackRate !== fix.rate) {
      video.playbackRate = fix.rate;
    }
  }

  private logTick(record: TickRecord): void {
    this.tickLog.push(record);
    if (this.tickLog.length > TICK_LOG_SIZE) this.tickLog.shift();
  }

  /**
   * En directo: si el vídeo no avanza en `LIVE_SILENT_MS` (y debería: la página se ve y no hace
   * falta un toque), la sesión se da por perdida y se reabre; al tercer intento en un minuto,
   * «Reintentar». Antes se quedaba cargando para siempre.
   */
  private watchLive(now: number): void {
    const at = this.video.currentTime || 0;
    const advanced = !Number.isNaN(this.liveLastTime) && at > this.liveLastTime;
    this.liveLastTime = at;
    if (advanced || this.heldPause || this.env.visible?.() === false) {
      this.liveMovedAt = now;
      return;
    }
    if (now - this.liveMovedAt >= LIVE_SILENT_MS) {
      this.liveMovedAt = now;
      this.lost();
    }
  }

  private logSeek(record: SeekRecord): void {
    this.seekLog.push(record);
    if (this.seekLog.length > SEEK_LOG_SIZE) this.seekLog.shift();
  }

  /** Dónde cayó el último salto de corrección (§16): Safari no siempre cae donde se le pide. */
  private onSeeked(): void {
    if (this.leadProbe && this.leadProbe.landed === null) {
      this.leadProbe.landed = this.video.currentTime || 0;
    }
    const last = this.seekLog.at(-1);
    if (!last || last.landed !== null) return;
    last.landed = this.video.currentTime || 0;
    last.landedAt = this.env.now();
  }

  /**
   * Lo que tarda un salto reproduciendo en este aparato: desde que se pidió hasta que el vídeo
   * volvió a avanzar. Se ve en el primer `timeupdate` que pasa de donde cayó (o `playing` tras
   * `seeked`), pero `timeupdate` llega cada ~250 ms: el arranque de verdad es ahora menos lo ya
   * avanzado (a la velocidad de ahora). Antes se tomaba la hora del evento y cada medida salía
   * ~125 ms larga: en el PC, los saltos con datos caían siempre por delante. Los saltos con datos
   * y sin datos se apuntan aparte (`leadTarget` usa la que toca).
   */
  private measureLead(playing: boolean): void {
    const probe = this.leadProbe;
    const video = this.video;
    if (!probe || probe.landed === null || video.seeking || video.paused) return;
    const at = video.currentTime || 0;
    if (!playing && at <= probe.landed) return;
    this.leadProbe = null;
    const now = this.env.now();
    const rate = video.playbackRate > 0 ? video.playbackRate : 1;
    const advancedMs = (Math.max(0, at - probe.landed) / rate) * 1000;
    const took = Math.max(0, now - advancedMs - probe.at);
    if (now - probe.at > LEAD_PROBE_MAX_MS) return;
    const samples = this.leadSamples[this.engine][probe.loaded ? 'warm' : 'cold'];
    samples.push(took);
    if (samples.length > LEAD_SAMPLES) samples.shift();
  }

  /** La compensación del salto con datos ahora (ms): la media de lo medido (`seekLead`). */
  private currentLead(): number {
    return seekLead(this.leadSamples[this.engine].warm, this.engine);
  }

  /** La de un salto sin datos (ms), o null si aún no se ha medido ninguno (`coldSeekLead`). */
  private coldLead(): number | null {
    return coldSeekLead(this.leadSamples[this.engine].cold);
  }

  private onPlaying(): void {
    this.measureLead(true);
    /* El reproductor de casa quita Media Session al desmontarse: la primera vez que suena cada
       sesión, se vuelve a poner. */
    if (this.mediaBoundFor !== this.generation) this.bindMediaSession();
  }

  /** Alguien ha tocado el volumen (la interfaz de la sala): si ya suena, no hay silencio nuestro. */
  private onVolume(): void {
    if (!this.autoMuted || this.video.muted) return;
    this.autoMuted = false;
    this.unlocked = true;
    if (this.view.soundBlocked) this.set({ soundBlocked: false });
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

  /**
   * Reproducir, con freno: no otro play() mientras hay uno en curso, ni antes de `PLAY_RETRY_MS`
   * tras uno que falló (en directo se pedía en cada tic). Si el navegador no deja sonar
   * (NotAllowedError): en directo, y sin estar ya en silencio, se arranca en silencio
   * (`autoStart`) y, si ni así, «Toca para empezar» (`blocked`); en pelis y series, «Toca para
   * empezar» directamente (§13: el arranque es por «Estoy listo», no en silencio). En silencio y
   * con la página oculta, se espera a que vuelva.
   */
  private playVideo(force = false): void {
    const now = this.env.now();
    if (!force && (this.playInFlight || now < this.playRetryAt)) return;
    if (!force && this.autoMuted && this.env.visible?.() === false) return;
    const generation = this.generation;
    const video = this.video;
    this.playInFlight = true;
    void attempt(() => video.play()).then(
      () => {
        this.playInFlight = false;
      },
      (error: unknown) => {
        this.playInFlight = false;
        if (generation !== this.generation || this.destroyed) return;
        const name = errorName(error);
        /* AbortError: lo interrumpió una pausa nuestra (la sala espera a alguien, el líder pausa).
           No es un fallo: si la sala sigue enseguida, el próximo tic vuelve a pedirlo. */
        if (name === 'AbortError') return;
        if (name !== 'NotAllowedError') {
          this.playRetryAt = this.env.now() + PLAY_RETRY_MS;
          return;
        }
        if (!video.muted && this.room()?.live) this.autoStart(generation);
        else this.blockPlayback();
      },
    );
  }

  /**
   * El navegador no deja sonar sin un toque: se arranca en silencio (eso sí se deja en iOS y
   * Chrome) para ir a la par con la sala, y la interfaz ofrece «Activar sonido». El silencio es
   * nuestro (`autoMuted`): no se guarda como volumen de nadie.
   */
  private autoStart(generation: number): void {
    const video = this.video;
    video.muted = true;
    this.autoMuted = true;
    this.autoStarting = true;
    this.playInFlight = true;
    this.set({ soundBlocked: true });
    void attempt(() => video.play()).then(
      () => {
        this.playInFlight = false;
        this.autoStarting = false;
      },
      (error: unknown) => {
        this.playInFlight = false;
        this.autoStarting = false;
        if (generation !== this.generation || this.destroyed) return;
        const name = errorName(error);
        if (name === 'NotAllowedError') this.blockPlayback();
        else if (name !== 'AbortError') this.playRetryAt = this.env.now() + PLAY_RETRY_MS;
      },
    );
  }

  /** Ni en silencio: «Toca para empezar» (el respaldo). */
  private blockPlayback(): void {
    this.unlocked = false;
    this.set({
      soundBlocked: false,
      ...(this.view.phase === 'ready' ? { phase: 'blocked' as const } : {}),
    });
  }

  private pauseVideo(): void {
    this.video.pause();
  }

  private seekVideo(to: number): void {
    this.video.currentTime = to;
  }

  /**
   * «Toca para empezar» (o el toque en «Esperando a todos»): el play dentro del toque desbloquea
   * el sonido para lo que venga. Si el silencio era nuestro, se quita. Se pasa a 'ready' ya y,
   * si aun así el navegador no deja (NotAllowedError), se vuelve a 'blocked'.
   */
  unlock(): void {
    const generation = this.generation;
    const video = this.video;
    this.markVoted();
    this.unlocking = true;
    this.heldPause = false;
    if (this.autoMuted) {
      video.muted = false;
      this.autoMuted = false;
    }
    if (this.view.phase === 'blocked') this.set({ phase: 'ready' });
    this.playInFlight = true;
    void attempt(() => video.play()).then(
      () => {
        this.playInFlight = false;
        this.unlocked = true;
        if (generation === this.generation && this.view.soundBlocked) {
          this.set({ soundBlocked: false });
        }
        const room = this.room();
        /* Sin la sala en marcha, se para otra vez; `unlocking` se quita con el 'pause' de esa
           pausa (`onNative`), no aquí: el evento llega después. */
        if (room && !room.live && !isRunning(room.playback) && !video.paused) this.pauseVideo();
        else this.unlocking = false;
      },
      (error: unknown) => {
        this.playInFlight = false;
        this.unlocking = false;
        if (generation !== this.generation || this.destroyed) return;
        if (errorName(error) === 'NotAllowedError') this.blockPlayback();
      },
    );
  }

  /**
   * «Activar sonido» (solo dentro de un toque o una tecla): quita el silencio que puso el
   * navegador (con el volumen guardado si estaba a 0) y, si la sala va y el vídeo está parado,
   * reproduce.
   */
  unmute(): void {
    const video = this.video;
    if (video.volume === 0) {
      try {
        video.volume = readSavedVolume() ?? 1;
      } catch {}
    }
    video.muted = false;
    this.autoMuted = false;
    this.unlocked = true;
    this.markVoted();
    if (this.view.soundBlocked) this.set({ soundBlocked: false });
    const room = this.room();
    if (room && (room.live || isRunning(room.playback)) && video.paused) this.playVideo(true);
  }

  /**
   * «Estoy listo» (§13, pelis y series; solo dentro de un toque): el voto de este aparato (lo
   * manda el tic siguiente, al momento por ser un cambio: `client.report`) y en el mismo toque el
   * play que deja sonar el vídeo cuando empiece la sala (con la sala aún parada, se vuelve a parar
   * al empezar a sonar, no antes: una pausa en el mismo toque lo cortaría). Aunque el vídeo aún no
   * esté abierto: el play dentro del toque ya desbloquea este `<video>` en Safari, y Chrome se
   * acuerda del toque en la página.
   */
  vote(): void {
    if (this.destroyed) return;
    this.unlock();
  }

  private markVoted(): void {
    if (this.voted) return;
    this.voted = true;
    this.set({ voted: true });
  }

  /**
   * Un play, una pausa o un salto del `<video>` NUNCA es una orden (§6): el `<video>` de la sala
   * no tiene controles y la pantalla completa del iPhone es la de la página. Solo se apunta para
   * depurar; las órdenes salen de la interfaz de la sala y de Media Session.
   */
  private onNative(type: 'play' | 'pause' | 'seeking'): void {
    if (type === 'pause' && this.unlocking) this.unlocking = false;
    this.nativeLog.push({
      at: this.env.now(),
      type,
      positionS: this.video.currentTime || 0,
      phase: this.view.phase,
      msSinceInteraction:
        this.debugging && Number.isFinite(this.lastInteraction)
          ? this.env.now() - this.lastInteraction
          : null,
    });
    if (this.nativeLog.length > NATIVE_LOG_SIZE) this.nativeLog.shift();
  }

  // --- Media Session (teclas multimedia, pantalla de bloqueo, Centro de control) ---

  /**
   * Mientras haya sala, las acciones del sistema son órdenes de la sala (`source: 'mediaSession'`)
   * con la posición de la sala, no la de este vídeo (que puede ir retrasado); lo que no va a la
   * sala (sin permiso, una pausa con la página oculta) se hace aquí (`mediaOrder`). La barra es la
   * de la sala (`mediaPosition`). Se vuelven a poner en cada sesión y en su primer 'playing': el
   * reproductor de casa los quita al desmontarse.
   */
  private bindMediaSession(): void {
    const ms = this.env.mediaSession?.() ?? null;
    const room = this.room();
    if (!ms || !room || this.destroyed) return;
    this.mediaBoundFor = this.generation;
    this.mediaState = null;
    /* La barra es la de la sala desde ya: la de casa (la película de antes) se quedaba puesta y su
       `seekto` llevaba la sala a otro sitio. */
    this.mediaPosition(
      room,
      this.view.durationS ?? room.title.durationS ?? null,
      room.live !== null || room.playback.playing,
      this.env.now(),
      true,
    );
    const handlers: Record<
      (typeof MEDIA_ACTIONS)[number],
      (details?: MediaSessionActionDetails) => void
    > = {
      play: () => this.mediaOrder('play'),
      pause: () => this.mediaOrder('pause'),
      seekto: (details) => {
        const time = details?.seekTime;
        if (typeof time === 'number' && Number.isFinite(time)) this.mediaOrder('seek', time);
      },
      seekbackward: (details) =>
        this.mediaOrder('seek', -(details?.seekOffset ?? MEDIA_SEEK_S), true),
      seekforward: (details) => this.mediaOrder('seek', details?.seekOffset ?? MEDIA_SEEK_S, true),
    };
    for (const action of MEDIA_ACTIONS) setMediaHandler(ms, action, handlers[action]);
    try {
      if (typeof MediaMetadata === 'function') {
        const live = room.live;
        const title = room.title;
        const artwork =
          !live && title.kind !== 'live' && title.poster
            ? [
                {
                  src: routeUrl(
                    'partyArt',
                    { code: this.client.code, artId: title.artId },
                    { v: title.poster },
                  ),
                },
                ...APP_ARTWORK,
              ]
            : APP_ARTWORK;
        ms.metadata = new MediaMetadata({
          title: live ? (live.match ?? live.channel) : title.title,
          artist: live ? live.channel : (title.subtitle ?? MEDIA_ARTIST),
          album: 'Ace Player Neo',
          artwork,
        });
      }
    } catch {}
  }

  /**
   * Una acción de Media Session. `seek` con `relative` suma a la posición de la sala.
   * - «Reproducir» es un gesto: si la sala va (o en directo) y el vídeo está parado (iOS lo pausa
   *   en segundo plano), reproduce aquí mismo; como hay handler, el sistema ya no lo hace solo. A
   *   la sala solo va si estaba en pausa (con la sala esperando a alguien, ya reproduce).
   * - «Pausa» con la página oculta es solo de este aparato (`heldPause`): los AirPods al quitarse
   *   uno, o unos auriculares al desconectarse, mandan «pausa» sin que nadie la pida para la sala.
   * - Sin permiso para controlar, nada va a la sala.
   */
  private mediaOrder(action: 'play' | 'pause' | 'seek', value = 0, relative = false): void {
    const room = this.room();
    if (!room || this.destroyed) return;
    const steer = !room.live && canControl(room, this.client.credential.id);
    if (action === 'play') {
      this.heldPause = false;
      const plays = room.live !== null || isRunning(room.playback);
      /* Con «Toca para empezar», este gesto vale como el toque. */
      if (this.view.phase === 'blocked') this.unlock();
      else if (plays && this.video.paused && this.view.phase === 'ready') this.playVideo(true);
      if (!steer || room.playback.playing) {
        this.mediaPlaybackState(room.live !== null || room.playback.playing ? 'playing' : 'paused');
        return;
      }
    } else if (action === 'pause') {
      if (this.env.visible?.() === false) {
        this.heldPause = true;
        this.pauseVideo();
        this.mediaPlaybackState('paused');
        return;
      }
      if (!steer) return;
    } else if (!steer) {
      return;
    }
    const durationS = this.view.durationS;
    const target = targetPosition(room.playback, this.client.serverNow(), durationS);
    let positionS = target;
    if (action === 'seek') {
      positionS = Math.max(0, relative ? target + value : value);
      if (durationS !== null) positionS = Math.min(positionS, durationS);
    }
    void this.client.control({ action, positionS }, 'mediaSession').catch(() => undefined);
  }

  /**
   * La barra de la pantalla de bloqueo con la posición de la sala (`setPositionState`), cada
   * `MEDIA_POSITION_MS` o al cambiar entre reproducir y pausa. En pausa, el sistema no la mueve
   * (`playbackState`); la velocidad no puede ser 0. En directo, sin barra.
   */
  private mediaPosition(
    room: PartyRoom,
    durationS: number | null,
    playing: boolean,
    now: number,
    force: boolean,
  ): void {
    if (
      !force &&
      playing === this.mediaPositionPlaying &&
      now - this.mediaPositionAt < MEDIA_POSITION_MS
    ) {
      return;
    }
    const ms = this.env.mediaSession?.() ?? null;
    if (!ms || typeof ms.setPositionState !== 'function') return;
    this.mediaPositionAt = now;
    this.mediaPositionPlaying = playing;
    try {
      if (room.live || durationS === null || !(durationS > 0)) {
        ms.setPositionState();
        return;
      }
      const target = targetPosition(room.playback, this.client.serverNow(), durationS);
      ms.setPositionState({
        duration: durationS,
        position: Math.min(durationS, Math.max(0, target)),
        playbackRate: 1,
      });
    } catch {}
  }

  /** Lo que muestra el sistema (reproduciendo o en pausa), solo si cambia. */
  private mediaPlaybackState(state: MediaSessionPlaybackState): void {
    if (state === this.mediaState) return;
    const ms = this.env.mediaSession?.() ?? null;
    if (!ms) return;
    this.mediaState = state;
    try {
      ms.playbackState = state;
    } catch {}
  }

  private clearMediaSession(): void {
    const ms = this.env.mediaSession?.() ?? null;
    if (!ms) return;
    for (const action of MEDIA_ACTIONS) setMediaHandler(ms, action, null);
    try {
      ms.metadata = null;
      ms.playbackState = 'none';
      if (typeof ms.setPositionState === 'function') ms.setPositionState();
    } catch {}
    this.mediaState = null;
    this.mediaPositionAt = Number.NEGATIVE_INFINITY;
    this.mediaPositionPlaying = null;
  }
}

function setMediaHandler(
  ms: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    ms.setActionHandler(action, handler);
  } catch {
    /* Una acción que este navegador no conoce: se ignora. */
  }
}

/** Un play() que puede lanzar en vez de devolver una promesa rechazada (navegadores viejos). */
function attempt(run: () => Promise<void> | undefined): Promise<void> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function errorName(error: unknown): string | null {
  return (error as { name?: unknown } | null)?.name === undefined
    ? null
    : String((error as { name?: unknown }).name);
}

/**
 * ¿Un fallo al abrir que vale la pena reintentar solo? La red, un plazo, un 5xx, o el remux o el
 * motor que tardan o se caen. Un error que no es de la API (la red sin más), también.
 */
function transientOpenError(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return error.retryable || TRANSIENT_OPEN_ERRORS.has(error.code);
}
