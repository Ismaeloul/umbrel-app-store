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
   - Controles nativos (pantalla completa del iPhone): un play, una pausa o un
     salto que no coincide con la sala se manda como orden, pero solo si la
     persona acaba de tocar o pulsar algo (o está en esa pantalla completa).
     Lo que hace el navegador por su cuenta (pausar al bloquear el iPhone, un
     vídeo silenciado que no se ve) no para a los demás.
   - El primer play necesita un toque (los navegadores no dejan sonar un
     vídeo solo): hasta entonces, «Toca para empezar». */

import type { PartyRoom, VodGrant } from '@ace/shared';
import { api, getDeviceId, getViewerId, isApiError } from '../../api/index.ts';
import { HLS_PLAYLIST_RETRY, HLS_VOD_CONFIG } from '../../player/engines/hls.ts';
import { chooseEngine, detectPlatform, streamClient } from '../../player/engines/index.ts';
import { absoluteUrl } from '../../player/engines/types.ts';
import { canPlayHevc } from '../cine/play.ts';
import type { PartyClient } from './client.ts';
import { correction, isRunning, targetPosition } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const TICK_MS = 500;
/** Tras perder la sesión sin interrupción, lo que se espera antes de reabrir. */
const REOPEN_DELAY_MS = 2_000;
const REOPENS_PER_MINUTE = 3;
/** Un salto en los controles nativos tiene que apartarse al menos esto de la sala para ser una orden. */
const NATIVE_SEEK_S = 1.5;
/** Un evento del vídeo hasta esto después de un toque o una tecla cuenta como de la persona. */
const USER_ACTION_MS = 1_500;
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

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
}

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(
    event: string,
    listener: (event: string, data: { fatal?: boolean; type?: string }) => void,
  ): void;
  startLoad(position?: number): void;
  recoverMediaError(): void;
  destroy(): void;
}

interface HlsStatic {
  new (config: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
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
  };
  private readonly listeners = new Set<() => void>();
  private grant: VodGrant | null = null;
  private hls: HlsInstance | null = null;
  private tickTimer: unknown = null;
  private reopenTimer: unknown = null;
  private reopens: number[] = [];
  private acquiredAudio: number | null = null;
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
    private readonly env: PlayerEnv = BROWSER,
  ) {
    this.onVideoEvent = {
      play: () => this.onNative('play'),
      pause: () => this.onNative('pause'),
      seeking: () => this.onNative('seeking'),
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
    this.unsubscribe = this.client.subscribe(() => this.reconcile());
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
    this.teardown();
    this.set({ phase: 'preparing', error: null });
    const platform = detectPlatform();
    let grant: VodGrant;
    try {
      grant = await api('partyStream', {
        params: { code: this.client.code },
        query: {
          client: streamClient(platform),
          viewer: this.viewer,
          device: getDeviceId(),
          hevc: canPlayHevc() ? '1' : '0',
          t: this.client.credential.token,
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
    const engine = chooseEngine(grant.protocol, platform);
    const codecs = `video/mp4; codecs="${grant.vod.video.codecs},mp4a.40.2"`;
    if (!engine || !this.env.supportsType(codecs, engine === 'native', this.video)) {
      this.set({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
      return;
    }
    this.grant = grant;
    this.acquiredAudio = grant.vod.audioIndex >= 0 ? grant.vod.audioIndex : null;
    const startS = targetPosition(room.playback, this.client.serverNow(), grant.vod.durationS);
    const Hls = engine === 'hls' ? await this.env.loadHls() : null;
    if (generation !== this.generation || this.destroyed) return;
    if (Hls) {
      const hls = new Hls({
        manifestLoadingTimeOut: 20_000,
        ...HLS_PLAYLIST_RETRY,
        ...HLS_VOD_CONFIG,
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
      hls.loadSource(absoluteUrl(grant.url));
      hls.attachMedia(this.video);
    } else {
      const onMeta = (): void => {
        this.video.removeEventListener('loadedmetadata', onMeta);
        if (Math.abs(this.video.currentTime - startS) > 2) this.seekVideo(startS);
      };
      this.video.addEventListener('loadedmetadata', onMeta);
      this.video.src = absoluteUrl(grant.url);
      try {
        this.video.load();
      } catch {}
    }
    this.set({ phase: this.unlocked ? 'ready' : 'blocked', durationS: grant.vod.durationS });
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
    const buffering = preparing || (ready && video.readyState < 3);
    let bufferedS = 0;
    try {
      const ranges = video.buffered;
      for (let i = 0; i < ranges.length; i += 1) {
        if (ranges.start(i) <= video.currentTime + 0.5)
          bufferedS = Math.max(bufferedS, ranges.end(i));
      }
    } catch {}
    this.set({ positionS: video.currentTime || 0, durationS, bufferedS, buffering });
    this.client.report(video.currentTime || 0, buffering);
    if (!room || !ready) return;
    const running = isRunning(room.playback);
    const target = targetPosition(room.playback, this.client.serverNow(), durationS);
    if (running && video.paused) this.playVideo();
    if (!running && !video.paused) this.pauseVideo();
    if (video.readyState < 1 || video.seeking) return;
    const fix = correction(video.currentTime, target, running);
    if (fix.kind === 'seek') {
      video.playbackRate = 1;
      this.seekVideo(fix.to);
    } else if (fix.kind === 'rate' && video.playbackRate !== fix.rate) {
      video.playbackRate = fix.rate;
    }
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
    if (this.view.phase !== 'ready' || !room || this.unlocking) return;
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
