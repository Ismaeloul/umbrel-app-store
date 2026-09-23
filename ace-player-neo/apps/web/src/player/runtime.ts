/* El orquestador de una reproducción: pide la URL al backend, engancha el
   motor, precarga, vigila, reconecta, cambia de modo, suelta la sesión y
   cuenta lo que pasa. Portado de la capa A de la 0.6.59 (index.html:4340-5306,
   reproductor.md §2-§8) sobre la máquina de estados de machine.ts y con los
   problemas P1-P23 resueltos:

   - P3/P25: el INTENTO pertenece a la fuente elegida (una llamada a play()),
     no a cada conexión: una reconexión no manda otro `arranco` y una fuente
     que se cae tras 10 min se anota `cayo`, no `fallo`.
   - P4: presupuesto de reconexiones POR VENTANA (las de los últimos 3 min) y
     espera exponencial entre ellas (1, 2, 4 s: reconnectDelayMs). 3 antes de
     dar la fuente por fallida; 1 en arranque automático antes del primer
     fotograma (RECONNECT_POLICY de @ace/shared).
   - P5: los contadores y temporizadores son del INTENTO de conexión (objeto
     `Connection`), no globales: cada conexión empieza con su margen entero.
   - P7/P8/P9: la sesión es del backend (GET /api/v1/channels/:id/stream, latido
     cada 15 s, release al parar o con sendBeacon al cerrar). La primera
     reconexión REUTILIZA la sesión (en iPhone no se mata el remux ni se
     vuelven a esperar 45 s); las siguientes la sueltan antes para forzar una
     sesión nueva del motor, como hacía la 0.6.59 en cada una.
   - P10: errores tipados del backend con su mensaje en español.
   - P12: el traspaso llega por SSE (`playback.handoff`) al momento; sin SSE,
     el latido (410) lo descubre.
   - P13: si el motor estaba apagado, al volver se reengancha como
     recuperación (y `stream.reopened` reengancha las sesiones que el backend
     reabre tras reiniciar el motor).
   - P14: «arrancó» = primer fotograma REAL (requestVideoFrameCallback o, en
     su defecto, el cabezal avanzando tras `playing`), no el colchón lleno.
   - P16: una sola política de salto de fuente: al agotar las reconexiones se
     pregunta a quien escuche onSourceFailed (el centro de partido decide).
   - P23: métricas (tiempo hasta la primera imagen, rebuffers, reconexiones y
     retraso) a /api/v1/diagnostics y a la consola de desarrollo.

   Nada aquí toca React: la interfaz lee el estado de `playerStore` (api.ts)
   y llama a los métodos públicos (toggle, goLive, back, …). */

import {
  liveBufferSafety,
  PLAYBACK_PROFILES,
  readSeekWindow,
  reconnectDelayMs,
  RECONNECT_POLICY,
  resolveLiveTarget,
  type PlaybackMode,
  type PlaybackProfile,
  type SeekWindow,
  type SseEventData,
  type StreamGrant,
  type StreamProtocol,
  type TimeRangesLike,
} from '@ace/shared';
import { api } from '../api/client.ts';
import { isAbortError, isApiError } from '../api/errors.ts';
import { getDeviceId, getViewerId } from '../api/identity.ts';
import { isDemo } from '../api/mode.ts';
import { routeKey, queryClient } from '../api/query.ts';
import { onSseEvent } from '../api/sse.ts';
import { setPlayerPresence } from '../app/player-presence.ts';
import { shallowEqual } from '../lib/store.ts';
import { notify as defaultNotify, type NotifyOptions } from '../notices/notify.ts';
import { toast } from '../notices/toasts.ts';
import {
  channelRoute,
  getPlaybackMode,
  IDLE_LIVE,
  notifySourceFailed,
  playerStore,
  type IdleReason,
  type LiveInfo,
  type PlayChannel,
  type PlayerCommand,
  type PlayerState,
  type PlayerStats,
  type PlayOptions,
  type PlayOrigin,
  type SourceFailure,
} from './api.ts';
import {
  ADVANCE_EPSILON_S,
  BACK_SECONDS,
  BUFFER_CHECK_MS,
  BUFFER_FALLBACK_AFTER_MS,
  BUFFER_FALLBACK_S,
  CONNECT_LIMIT_TICKS,
  DEMO_STATS_MS,
  DOWNLOADING_KBPS,
  FROZEN_LIVE_PUSH_TICKS,
  FROZEN_REBUFFER_TICKS,
  FROZEN_RECONNECT_TICKS,
  GRACE_TICKS,
  INITIAL_MAX_WAIT_MS,
  LIVE_DISPLAY_S,
  LIVE_PUSH_MIN_BEHIND_S,
  LIVE_TOLERANCE_S,
  METER_MS,
  OUTCOME_KEEPALIVE_MS,
  REBUFFER_MAX_WAIT_MS,
  REBUFFER_NOTICE_MS,
  RECONNECT_WINDOW_MS,
  SEEK_TIMEOUT_MS,
  WATCHDOG_TICK_MS,
} from './constants.ts';
import { PlayerController, type CommandResult, type MediaLike } from './controller.ts';
import {
  chooseEngine,
  detectPlatform,
  EngineUnsupportedError,
  loadEngine as defaultLoadEngine,
  streamClient,
  type Engine,
  type EngineKind,
  type EngineLoader,
  type Platform,
} from './engines/index.ts';
import { derivePhase, isEngaged, nextState, type ConnEvent, type ConnState } from './machine.ts';

/** Lo que el orquestador usa del <video> (el de verdad o uno falso en los tests). */
export interface MediaElementLike extends MediaLike {
  readonly buffered: TimeRangesLike;
  readonly readyState: number;
  readonly error: unknown;
  muted: boolean;
  volume: number;
  playbackRate: number;
  src: string;
  removeAttribute(name: string): void;
  load(): void;
  requestVideoFrameCallback?(callback: () => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

type Request = typeof api;

export interface RuntimeDeps {
  video: MediaElementLike;
  request?: Request;
  loadEngine?: EngineLoader;
  platform?: Platform;
  isDemo?: () => boolean;
  identity?: () => { viewer: string; device: string };
  mode?: () => PlaybackMode;
  notify?: (text: string, options?: NotifyOptions) => void;
  sendBeacon?: (url: string, body: string) => boolean;
  sourceFailed?: (failure: SourceFailure) => { next: boolean; message: string | null };
  /** Escribe en el estado público (por defecto, playerStore). */
  setState?: (patch: Partial<PlayerState>) => void;
  /** El armazón: mantener montado el reproductor y avisar del inmersivo. */
  setPresence?: typeof setPlayerPresence;
  /** Tras apuntar el historial: la biblioteca nueva (por defecto, a la caché de TanStack Query). */
  onLibrary?: (library: unknown) => void;
  /** Registro de desarrollo. */
  log?: (message: string, data?: unknown) => void;
  /** Eventos SSE (por defecto, los de src/api/sse.ts). */
  subscribe?: typeof onSseEvent;
  /** window/document para el ciclo de vida de la página (null en algún test). */
  lifecycle?: { window: Window; document: Document } | null;
}

interface SourceAttempt {
  channel: PlayChannel & { hash: string };
  origin: PlayOrigin;
  requestedAt: number;
  /** Primer fotograma real con esta fuente (P14). */
  startedAt: number | null;
  arrancoSent: boolean;
  finalSent: boolean;
  lastSigueAt: number;
  /** Momentos de las reconexiones (se olvidan pasados RECONNECT_WINDOW_MS). */
  reconnects: number[];
  lastRebufferNoticeAt: number;
  metrics: {
    ttffMs: number | null;
    remuxStartMs: number | null;
    rebuffers: number;
    rebufferMs: number;
    reconnects: number;
    latencySum: number;
    latencyCount: number;
  };
  /** Ya se mandó el resumen de métricas de esta fuente (player_session). */
  metricsSent: boolean;
  failed: boolean;
}

interface Connection {
  id: number;
  abort: AbortController;
  engine: Engine | null;
  engineKind: EngineKind | null;
  recovery: boolean;
  connTicks: number;
  stuckTicks: number;
  graceTicks: number;
  lastPos: number;
  bufferTimer: ReturnType<typeof setInterval> | null;
  watchdog: ReturnType<typeof setInterval> | null;
  rebuffer: { startedAt: number; targetS: number } | null;
  firstFrameCleanup: (() => void) | null;
  profile: PlaybackProfile;
}

interface SessionInfo {
  id: string;
  heartbeatMs: number;
  url: string;
  protocol: StreamProtocol;
  remux: boolean;
  lastBeatAt: number;
}

/** Errores del backend que NO son culpa de la fuente: no se reintentan ni se salta a otra. */
const SYSTEM_ERRORS = new Set([
  'ffmpeg_missing',
  'remux_busy',
  'handoff_denied',
  'unauthorized',
  'device_revoked',
  'cross_origin',
  'origin_forbidden',
  'demo_unsupported',
]);

const IDLE_MESSAGES: Record<IdleReason, string> = {
  inicio: 'Elige un partido en la agenda o un canal de la biblioteca.',
  detenido: 'Reproducción detenida. Elige otro partido o canal.',
  traspasado: 'La reproducción ha pasado a otro dispositivo.',
  fallo: 'Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.',
  'sin-motor': 'El motor AceStream no responde. Se reanudará solo cuando vuelva.',
};

/** Lo cargado por delante del cabezal en el rango que lo contiene (index.html:4352-4362). */
export function bufferAhead(media: { currentTime: number; buffered: TimeRangesLike }): number {
  const ranges = media.buffered;
  const t = Number.isFinite(media.currentTime) ? media.currentTime : 0;
  try {
    for (let i = 0; i < ranges.length; i += 1) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (t >= start - 0.2 && t <= end + 0.05) return Math.max(0, end - Math.max(t, start));
    }
    if (ranges.length && t < ranges.start(0)) return Math.max(0, ranges.end(0) - ranges.start(0));
  } catch {}
  return 0;
}

/** Sin `seekable`, el último rango cargado (index.html:5012-5019). */
export function fallbackRangeWindow(ranges: TimeRangesLike | null | undefined): SeekWindow | null {
  if (!ranges?.length) return null;
  try {
    const start = ranges.start(ranges.length - 1);
    const end = ranges.end(ranges.length - 1);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? { start, end, duration: end - start }
      : null;
  } catch {
    return null;
  }
}

export interface LiveMeasure {
  window: SeekWindow;
  target: number;
  behind: number;
  /** Del cabezal a lo último cargado. */
  delay: number;
}

function sendBeaconDefault(url: string, body: string): boolean {
  try {
    const nav = globalThis.navigator;
    if (!nav || typeof nav.sendBeacon !== 'function') return false;
    return nav.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
  } catch {
    return false;
  }
}

export class PlayerRuntime {
  readonly video: MediaElementLike;
  readonly controller: PlayerController;
  readonly platform: Platform;
  private readonly request: Request;
  private readonly loadEngine: EngineLoader;
  private readonly demo: () => boolean;
  private readonly identity: () => { viewer: string; device: string };
  private readonly mode: () => PlaybackMode;
  private readonly notify: (text: string, options?: NotifyOptions) => void;
  private readonly sendBeacon: (url: string, body: string) => boolean;
  private readonly sourceFailed: (failure: SourceFailure) => {
    next: boolean;
    message: string | null;
  };
  private readonly setState: (patch: Partial<PlayerState>) => void;
  private readonly setPresence: typeof setPlayerPresence;
  private readonly onLibrary: (library: unknown) => void;
  private readonly log: (message: string, data?: unknown) => void;

  private conn: ConnState = 'idle';
  private source: SourceAttempt | null = null;
  private connection: Connection | null = null;
  private connectionSeq = 0;
  private session: SessionInfo | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private demoStatsTimer: ReturnType<typeof setInterval> | null = null;
  private waitingForEngine = false;
  /** Últimas estadísticas del motor (SSE `stream.stats`): el vigilante mira la bajada. */
  private lastStats: PlayerStats | null = null;
  private lastPublished: Partial<PlayerState> = {};
  private readonly cleanups: Array<() => void> = [];
  private destroyed = false;

  constructor(deps: RuntimeDeps) {
    this.video = deps.video;
    this.request = deps.request ?? api;
    this.loadEngine = deps.loadEngine ?? defaultLoadEngine;
    this.platform = deps.platform ?? detectPlatform();
    this.demo = deps.isDemo ?? isDemo;
    this.identity = deps.identity ?? (() => ({ viewer: getViewerId(), device: getDeviceId() }));
    this.mode = deps.mode ?? getPlaybackMode;
    this.notify = deps.notify ?? ((text, options) => void defaultNotify(text, options));
    this.sendBeacon = deps.sendBeacon ?? sendBeaconDefault;
    this.sourceFailed = deps.sourceFailed ?? notifySourceFailed;
    this.setState =
      deps.setState ?? ((patch) => playerStore.set((state) => mergePlayerState(state, patch)));
    this.setPresence = deps.setPresence ?? setPlayerPresence;
    this.onLibrary =
      deps.onLibrary ?? ((library) => queryClient.setQueryData(routeKey('libraryGet'), library));
    this.log =
      deps.log ??
      ((message, data) => {
        if (import.meta.env.DEV) console.info(`[reproductor] ${message}`, data ?? '');
      });

    this.controller = new PlayerController(this.video, {
      isDemo: () => this.demo(),
      isActive: (key) => key === this.controllerKey(),
      liveTolerance: LIVE_TOLERANCE_S,
      onState: () => this.publish(),
      onAutoplayBlocked: () => {
        this.report('client', 'autoplay_blocked', 'El navegador bloqueó el arranque con sonido');
      },
    });

    this.listenMedia();
    const subscribe = deps.subscribe ?? onSseEvent;
    this.cleanups.push(
      subscribe('playback.handoff', (data) => this.onHandoff(data)),
      subscribe('stream.modeChanged', (data) => this.onModeChanged(data)),
      subscribe('stream.reopened', (data) => this.onReopened(data)),
      subscribe('stream.stats', (data) => this.onStats(data)),
      subscribe('stream.closed', (data) => this.onClosed(data)),
      subscribe('engine.status', (data) => this.onEngineStatus(data)),
      subscribe('playback.nowPlaying', (data, meta) => this.onNowPlaying(data, meta)),
    );
    const lifecycle =
      deps.lifecycle === undefined
        ? typeof window !== 'undefined'
          ? { window, document }
          : null
        : deps.lifecycle;
    if (lifecycle) this.listenLifecycle(lifecycle.window, lifecycle.document);
    this.setState({ demo: this.demo(), muted: this.video.muted, volume: this.video.volume });
  }

  // ---- Órdenes (las que llegan de api.ts) ---------------------------------------

  handle(command: PlayerCommand): void {
    if (this.destroyed) return;
    switch (command.type) {
      case 'play':
        this.play(command.channel, command.options);
        break;
      case 'stop':
        this.stop();
        break;
      case 'mode':
        this.changeMode(command.mode);
        break;
    }
  }

  play(channel: PlayChannel & { hash: string }, options: PlayOptions = {}): void {
    const current = this.source;
    const route = options.route ?? channelRoute(channel.hash);
    if (current && current.channel.hash === channel.hash && isEngaged(this.conn)) {
      // El mismo canal ya suena o conecta: no se reinicia (idempotente).
      current.channel = { ...current.channel, ...channel };
      this.setState({ channel: current.channel, route });
      this.setPresence({ active: true, route });
      return;
    }
    this.endSource(current?.failed ? null : 'cambio de canal');
    this.clearReconnect();
    this.source = {
      channel,
      origin: options.origin ?? 'user',
      requestedAt: Date.now(),
      startedAt: null,
      arrancoSent: false,
      finalSent: false,
      lastSigueAt: 0,
      reconnects: [],
      lastRebufferNoticeAt: 0,
      metrics: {
        ttffMs: null,
        remuxStartMs: null,
        rebuffers: 0,
        rebufferMs: 0,
        reconnects: 0,
        latencySum: 0,
        latencyCount: 0,
      },
      metricsSent: false,
      failed: false,
    };
    this.waitingForEngine = false;
    this.lastStats = null;
    this.setState({
      channel,
      origin: this.source.origin,
      route,
      idleReason: null,
      attempt: null,
      started: false,
      ttffMs: null,
      stats: null,
      live: IDLE_LIVE,
      bufferAheadS: 0,
      rebuffering: null,
      demo: this.demo(),
    });
    this.setPresence({ active: true, route });
    this.recordHistory(channel);
    this.connect({ recovery: false });
  }

  stop(reason: IdleReason = 'detenido'): void {
    const hadSource = this.source !== null;
    this.clearReconnect();
    this.endSource(reason === 'traspasado' ? 'traspasado a otro dispositivo' : 'detenida');
    this.endConnection();
    if (reason !== 'traspasado') this.releaseSession('user');
    else this.dropSession();
    this.controller.reset();
    this.resetVideo();
    this.source = null;
    this.waitingForEngine = false;
    this.transition('detener');
    this.setState({
      channel: null,
      origin: null,
      message: hadSource ? IDLE_MESSAGES[reason] : null,
      idleReason: reason,
      attempt: null,
      started: false,
      stats: null,
      engine: null,
      protocol: null,
      codec: null,
      sessionId: null,
      ttffMs: null,
      live: IDLE_LIVE,
      bufferAheadS: 0,
      rebuffering: null,
      nerdOpen: false,
    });
    this.setPresence({ active: false, immersive: false });
  }

  /** Reintentar la misma fuente desde cero (botón del panel de error). */
  retry(): void {
    const source = this.source;
    if (!source) return;
    source.reconnects = [];
    source.failed = false;
    source.finalSent = false;
    this.clearReconnect();
    this.setPresence({ active: true });
    this.connect({ recovery: source.startedAt !== null });
  }

  private changeMode(mode: PlaybackMode): void {
    if (!this.source || !isEngaged(this.conn)) return;
    // P11: en iPhone el remux no cambia con el modo; reconectar solo cortaría.
    if (this.connection?.engineKind === 'native' || this.demo()) return;
    this.log(`Modo ${mode}: se reengancha el canal con el perfil nuevo`);
    this.clearReconnect();
    // El modo solo cambia la configuración del motor: la misma sesión del backend sirve.
    this.connect({ recovery: true, freshSession: false });
  }

  // ---- Acciones de la interfaz -------------------------------------------------

  /** Espacio / K / botón: pausa o reanuda. Sin imagen, reintenta. */
  toggle(origin = 'user'): Promise<CommandResult> {
    if (this.conn === 'error') {
      this.retry();
      return Promise.resolve({ ok: true, reason: 'retry' });
    }
    // Conectando no hay nada que pausar ni reanudar: un play() ahora se saltaría la precarga.
    const connecting =
      this.conn === 'pidiendo' ||
      this.conn === 'conectando' ||
      this.conn === 'precarga' ||
      this.conn === 'reconectando' ||
      (this.conn === 'arrancando' && !this.controller.state.blocked);
    if (connecting) return Promise.resolve({ ok: false, reason: 'connecting' });
    return this.controller.toggle(origin);
  }

  resume(origin = 'user'): Promise<CommandResult> {
    return this.controller.requestPlay(origin);
  }

  pause(origin = 'user'): CommandResult {
    return this.controller.requestPause(origin);
  }

  /** La capa «Toca para reproducir». */
  tapToPlay(): Promise<CommandResult> {
    return this.controller.requestPlay('tap');
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  setVolume(volume: number): void {
    const value = Math.min(1, Math.max(0, volume));
    this.video.volume = value;
    // A 0 queda silenciado (inventario §8.2).
    this.video.muted = value === 0;
  }

  /** Mide el directo ahora: ventana, borde útil (con colchón de seguridad) y retraso. */
  measureLive(): LiveMeasure | null {
    const media = this.video;
    const window = readSeekWindow(media) ?? fallbackRangeWindow(media.buffered);
    if (!window) return null;
    const preferred = this.connection?.engine?.liveSyncPosition() ?? null;
    const safety = liveBufferSafety(this.mode(), window.duration);
    const target = resolveLiveTarget(window, preferred, safety);
    if (target === null) return null;
    const current = Number.isFinite(media.currentTime) ? media.currentTime : window.start;
    return {
      window,
      target,
      behind: Math.max(0, target - current),
      delay: Math.max(0, window.end - current),
    };
  }

  /** Botón DIRECTO (inventario §8.2, textos de index.html:5038-5056). */
  async goLive(): Promise<CommandResult> {
    if (!this.source) return { ok: false, reason: 'inactive' };
    if (this.demo()) {
      const result = await this.controller.goLive(null);
      this.notify('Ya estás en el directo (en demo no hay retardo)', {
        kind: 'signal',
        icon: 'directo',
      });
      return result;
    }
    const before = this.measureLive();
    const wasPlaying = this.controller.snapshot().actuallyPlaying;
    const result = await this.controller.goLive(() => {
      const now = this.measureLive();
      return now ? { target: now.target, behind: now.behind } : null;
    });
    if (['inactive', 'cancelled', 'superseded'].includes(result.reason)) return result;
    this.publish();
    const atEdge = !before || before.behind <= LIVE_TOLERANCE_S || result.reason === 'held';
    if (atEdge) {
      if (wasPlaying || result.reason === 'already-playing' || result.reason === 'held')
        this.notify('Ya estabas en el directo', { kind: 'signal', icon: 'directo' });
      else if (result.ok)
        this.notify('Directo reanudado', { kind: 'signal', tone: 'ok', icon: 'directo' });
      return result;
    }
    if (result.ok)
      this.notify('De vuelta al directo', { kind: 'signal', tone: 'ok', icon: 'directo' });
    else if (result.reason !== 'blocked')
      this.notify('La señal no deja saltar más adelante', {
        kind: 'signal',
        tone: 'warn',
        icon: 'aviso',
      });
    return result;
  }

  /** −30 s para repetir la jugada (B-091, index.html:5061-5074). */
  async back(seconds = BACK_SECONDS): Promise<CommandResult> {
    if (!this.source) return { ok: false, reason: 'inactive' };
    if (this.demo()) {
      this.notify('En la demo no hay imagen guardada que repetir', { kind: 'signal' });
      return { ok: false, reason: 'demo' };
    }
    const media = this.video;
    const window = readSeekWindow(media) ?? fallbackRangeWindow(media.buffered);
    if (!window) {
      this.notify('Todavía no hay imagen guardada para retroceder', {
        kind: 'signal',
        tone: 'warn',
        icon: 'aviso',
      });
      return { ok: false, reason: 'no-window' };
    }
    const now = Number.isFinite(media.currentTime) ? media.currentTime : window.end;
    const destination = Math.max(window.start, now - seconds);
    const real = now - destination;
    if (real < 1) {
      this.notify('No hay más imagen guardada hacia atrás', {
        kind: 'signal',
        tone: 'warn',
        icon: 'aviso',
      });
      return { ok: false, reason: 'no-more' };
    }
    const result = await this.controller.seekTo(destination, {
      origin: 'timeline',
      timeoutMs: SEEK_TIMEOUT_MS,
    });
    this.publish();
    if (result.ok)
      this.notify(`Retrocedido ${Math.round(real)} s · pulsa DIRECTO para volver`, {
        kind: 'signal',
        icon: 'back',
      });
    return result;
  }

  /** Datos para el panel técnico que no están en el estado público. */
  engineInfo() {
    return this.connection?.engine?.info() ?? {};
  }

  // ---- Conexión --------------------------------------------------------------

  private controllerKey(): string {
    return this.source && this.connection
      ? `${this.source.channel.hash}#${this.connection.id}`
      : '';
  }

  private isCurrent(connection: Connection): boolean {
    return !this.destroyed && this.connection === connection;
  }

  private transition(event: ConnEvent): boolean {
    const next = nextState(this.conn, event);
    if (!next) {
      if (import.meta.env.DEV && event !== 'detener')
        this.log(`Transición ignorada: ${this.conn} --${event}-->`);
      return false;
    }
    this.conn = next;
    this.publish();
    return true;
  }

  private connect({
    recovery,
    freshSession = false,
  }: {
    recovery: boolean;
    freshSession?: boolean;
  }): void {
    const source = this.source;
    if (!source || this.destroyed) return;
    this.endConnection();
    const profile = PLAYBACK_PROFILES[this.mode()];
    const connection: Connection = {
      id: ++this.connectionSeq,
      abort: new AbortController(),
      engine: null,
      engineKind: null,
      recovery,
      connTicks: 0,
      stuckTicks: 0,
      graceTicks: 0,
      lastPos: 0,
      bufferTimer: null,
      watchdog: null,
      rebuffer: null,
      firstFrameCleanup: null,
      profile,
    };
    this.connection = connection;
    this.transition(this.conn === 'reconectando' ? 'reintentar' : 'solicitar');
    this.controller.setSession(this.controllerKey());
    this.resetVideo();
    this.setState({
      message: recovery ? 'Reconectando con AceStream…' : 'Conectando con AceStream…',
      rebuffering: null,
    });

    if (this.demo()) {
      this.transition('concedida');
      this.attachEngine(connection, 'demo', 'demo:', null);
      return;
    }

    const previous = this.session;
    const release =
      previous && freshSession ? this.releaseSessionNow(previous, 'error') : Promise.resolve();
    const identity = this.identity();
    const startedAt = Date.now();
    void release
      .then(() =>
        this.request('channelStream', {
          params: { id: source.channel.hash },
          query: {
            client: streamClient(this.platform),
            kind: source.channel.kind ?? 'auto',
            mode: this.mode(),
            viewer: identity.viewer,
            device: identity.device,
            title: source.channel.title.slice(0, 200),
          },
          signal: connection.abort.signal,
        }),
      )
      .then((grant) => {
        if (!this.isCurrent(connection)) return;
        if (grant.remux && source.metrics.remuxStartMs === null)
          source.metrics.remuxStartMs = Date.now() - startedAt;
        this.adoptSession(grant);
        this.transition('concedida');
        this.setState({
          protocol: grant.protocol,
          codec: { video: grant.codec.video, audio: grant.codec.audio },
          sessionId: grant.session.id,
        });
        this.attachEngine(
          connection,
          chooseEngine(grant.protocol, this.platform),
          grant.url,
          grant,
        );
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(connection) || isAbortError(error)) return;
        this.onGrantError(error);
      });
  }

  private onGrantError(error: unknown): void {
    if (!isApiError(error)) {
      this.fail('No se pudo abrir el canal: reconectando', { detail: String(error) });
      return;
    }
    if (error.code === 'engine_unavailable') {
      // El motor está caído: saltar de fuente no sirve. Se espera a que vuelva (P13).
      this.failSystem(error.message, 'sin-motor', error.code);
      this.waitingForEngine = true;
      return;
    }
    if (SYSTEM_ERRORS.has(error.code)) {
      this.failSystem(error.message, 'fallo', error.code);
      return;
    }
    this.fail(error.message, {
      retryable: error.retryable || error.status === 504,
      code: error.code,
    });
  }

  private adoptSession(grant: StreamGrant): void {
    const previous = this.session;
    if (previous && previous.id !== grant.session.id) this.stopHeartbeat();
    this.session = {
      id: grant.session.id,
      heartbeatMs: grant.session.heartbeatMs,
      url: grant.url,
      protocol: grant.protocol,
      remux: grant.remux,
      lastBeatAt: Date.now(),
    };
    this.startHeartbeat();
  }

  private attachEngine(
    connection: Connection,
    kind: EngineKind | null,
    url: string,
    grant: StreamGrant | null,
  ): void {
    if (!kind) {
      const message =
        grant?.protocol === 'hls'
          ? 'Este navegador no soporta HLS.'
          : 'Este navegador no puede reproducir este canal.';
      this.failSystem(message, 'fallo', 'unsupported_browser');
      return;
    }
    const profile = grant ? PLAYBACK_PROFILES[grant.latency.mode] : connection.profile;
    connection.profile = profile;
    const demoFails = kind === 'demo' && /ca[ií]d/i.test(this.source?.channel.title ?? '');
    this.loadEngine(kind)
      .then((factory) => {
        if (!this.isCurrent(connection)) return;
        const engine = factory({
          video: this.video as unknown as HTMLMediaElement,
          url,
          profile,
          demoFails,
          callbacks: {
            onReady: () => {
              if (this.isCurrent(connection)) this.onEngineReady(connection);
            },
            onFatal: (reason, detail) => {
              if (this.isCurrent(connection)) this.fail(reason, { detail });
            },
            onNotice: (text) => {
              if (this.isCurrent(connection))
                this.notify(text, { kind: 'signal', tone: 'warn', icon: 'refresh' });
            },
          },
        });
        connection.engine = engine;
        connection.engineKind = kind;
        this.setState({ engine: kind });
        this.startWatchdog(connection);
        if (kind === 'demo') this.startDemoStats();
        engine.start();
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(connection)) return;
        if (error instanceof EngineUnsupportedError) {
          this.failSystem(
            'Este navegador no puede reproducir este canal.',
            'fallo',
            'unsupported_browser',
          );
          return;
        }
        // Falló la descarga del trozo de JS del motor (red): se reintenta como cualquier corte.
        this.fail('No se pudo cargar el reproductor de vídeo: reconectando', {
          detail: String(error),
        });
      });
  }

  private onEngineReady(connection: Connection): void {
    const engine = connection.engine;
    if (!engine) return;
    if (!engine.preloads) {
      this.beginPlayback(connection);
      return;
    }
    this.transition('motor-listo');
    this.setState({ message: 'Señal encontrada: cargando los primeros segundos…' });
    const kind = connection.engineKind === 'hls' ? 'hls' : 'mpegts';
    this.waitBuffer(connection, {
      initial: true,
      target: connection.profile.initial,
      maxWait: INITIAL_MAX_WAIT_MS[kind],
      onReady: () => this.beginPlayback(connection),
      onTimeout: () =>
        this.fail(
          kind === 'hls'
            ? 'La señal no llega con fluidez: reconectando'
            : 'La señal no termina de arrancar: reconectando',
        ),
    });
  }

  private beginPlayback(connection: Connection): void {
    if (!this.isCurrent(connection)) return;
    this.transition('colchon-listo');
    this.watchFirstFrame(connection);
    void this.controller.requestPlay(connection.recovery ? 'resume' : 'startup').then((result) => {
      if (!this.isCurrent(connection)) return;
      // En la demo no hay fotogramas: el «primero» es el play aceptado.
      if (result.ok && result.reason === 'demo') this.onFirstFrame(connection);
    });
  }

  /** «Arrancó» = primer fotograma real (P14), no el colchón lleno ni un play() que luego falla. */
  private watchFirstFrame(connection: Connection): void {
    connection.firstFrameCleanup?.();
    const media = this.video;
    let done = false;
    let playingAt: number | null = null;
    let frameHandle: number | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      if (this.isCurrent(connection)) this.onFirstFrame(connection);
    };
    const onPlaying = () => {
      playingAt = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    };
    // Respaldo sin requestVideoFrameCallback (o con la pestaña oculta, que no pinta): el cabezal avanza.
    const onTime = () => {
      if (playingAt !== null && !media.paused && media.currentTime - playingAt >= 0.05) finish();
    };
    media.addEventListener('playing', onPlaying);
    media.addEventListener('timeupdate', onTime);
    if (typeof media.requestVideoFrameCallback === 'function') {
      try {
        frameHandle = media.requestVideoFrameCallback(() => finish());
      } catch {
        frameHandle = null;
      }
    }
    const cleanup = () => {
      media.removeEventListener('playing', onPlaying);
      media.removeEventListener('timeupdate', onTime);
      if (frameHandle !== null) {
        try {
          media.cancelVideoFrameCallback?.(frameHandle);
        } catch {}
      }
      connection.firstFrameCleanup = null;
    };
    connection.firstFrameCleanup = cleanup;
  }

  private onFirstFrame(connection: Connection): void {
    connection.firstFrameCleanup?.();
    if (!this.transition('primer-fotograma')) return;
    const source = this.source;
    connection.connTicks = 0;
    connection.stuckTicks = 0;
    connection.lastPos = this.video.currentTime;
    connection.graceTicks = connection.recovery ? GRACE_TICKS : 0;
    this.setState({ message: null, attempt: null, idleReason: null });
    this.startMeter();
    if (!source) return;
    if (source.startedAt === null) {
      const now = Date.now();
      source.startedAt = now;
      source.lastSigueAt = now;
      source.metrics.ttffMs = now - source.requestedAt;
      this.setState({ started: true, ttffMs: source.metrics.ttffMs });
      this.log(`Primera imagen en ${source.metrics.ttffMs} ms`, {
        canal: source.channel.title,
        motor: connection.engineKind,
      });
      this.sendOutcome('arranco', 0);
    } else if (connection.recovery) {
      this.notify('Señal recuperada', { kind: 'signal', tone: 'ok', signal: 'ok' });
    }
  }

  /** Espera a tener colchón (index.html:4363-4392): objetivo, o el respaldo pasados 20 s, o el tope. */
  private waitBuffer(
    connection: Connection,
    options: {
      initial: boolean;
      target: number;
      maxWait: number;
      onReady: () => void;
      onTimeout: () => void;
    },
  ): void {
    if (connection.bufferTimer) clearInterval(connection.bufferTimer);
    const started = Date.now();
    const check = () => {
      if (!this.isCurrent(connection)) {
        if (connection.bufferTimer) clearInterval(connection.bufferTimer);
        return;
      }
      const ahead = bufferAhead(this.video);
      const elapsed = Date.now() - started;
      const fallback = options.initial ? BUFFER_FALLBACK_S.initial : BUFFER_FALLBACK_S.rebuild;
      if (ahead >= options.target || (elapsed >= BUFFER_FALLBACK_AFTER_MS && ahead >= fallback)) {
        if (connection.bufferTimer) clearInterval(connection.bufferTimer);
        connection.bufferTimer = null;
        options.onReady();
        return;
      }
      if (elapsed >= options.maxWait) {
        if (connection.bufferTimer) clearInterval(connection.bufferTimer);
        connection.bufferTimer = null;
        options.onTimeout();
      }
    };
    connection.bufferTimer = setInterval(check, BUFFER_CHECK_MS);
    check();
  }

  // ---- Vigilante ---------------------------------------------------------------

  private startWatchdog(connection: Connection): void {
    if (connection.watchdog) clearInterval(connection.watchdog);
    connection.watchdog = setInterval(() => this.tick(connection), WATCHDOG_TICK_MS);
  }

  /** Un tic del vigilante (index.html:5231-5266), con sus contadores en la conexión (P5). */
  private tick(connection: Connection | null = this.connection): void {
    if (!connection || !this.isCurrent(connection) || this.demo()) return;
    const media = this.video;
    const native = connection.engineKind === 'native';
    if (this.conn === 'conectando' || this.conn === 'precarga' || this.conn === 'arrancando') {
      // Esperando el toque de «Toca para reproducir»: no es culpa de la señal.
      if (this.controller.state.blocked) return;
      connection.connTicks += 1;
      const speed = this.lastStats?.speedDown ?? connection.engine?.info().speedKBs ?? 0;
      const limit = native
        ? CONNECT_LIMIT_TICKS.native
        : (speed ?? 0) > DOWNLOADING_KBPS
          ? CONNECT_LIMIT_TICKS.downloading
          : CONNECT_LIMIT_TICKS.normal;
      if (connection.connTicks >= limit) this.fail('Sin señal suficiente: reintentando');
      return;
    }
    if (this.conn !== 'activa') return;
    if (media.paused || connection.rebuffer) {
      connection.stuckTicks = 0;
      connection.lastPos = media.currentTime;
      return;
    }
    if (connection.graceTicks > 0) {
      connection.graceTicks -= 1;
      connection.lastPos = media.currentTime;
      return;
    }
    if (Math.abs(media.currentTime - connection.lastPos) > ADVANCE_EPSILON_S) {
      // Avanza. OJO (P4): esto YA NO perdona las reconexiones; las olvida la ventana.
      connection.stuckTicks = 0;
      connection.lastPos = media.currentTime;
      this.maybeSigue();
      return;
    }
    connection.stuckTicks += 1;
    if (!native && connection.stuckTicks === FROZEN_REBUFFER_TICKS) {
      this.startRebuffer(connection);
      return;
    }
    if (native && connection.stuckTicks === FROZEN_LIVE_PUSH_TICKS) this.pushToLive();
    const limit = native ? FROZEN_RECONNECT_TICKS.native : FROZEN_RECONNECT_TICKS.normal;
    if (connection.stuckTicks >= limit) this.fail('La imagen se ha quedado parada: reconectando');
  }

  /**
   * Safari/iOS con la imagen parada pero con vídeo por delante: saltar al
   * directo en vez de reiniciar (index.html:5286-5292). Con P2 arreglado, por
   * fin salta de verdad cuando hace falta (antes `followingLiveEdge` lo impedía).
   */
  private pushToLive(): void {
    const live = this.measureLive();
    if (!live || live.behind < LIVE_PUSH_MIN_BEHIND_S) return;
    this.log(`Imagen parada con ${live.behind.toFixed(1)} s por delante: salto al directo`);
    void this.controller.goLive({ target: live.target, behind: live.behind });
  }

  private maybeSigue(): void {
    const source = this.source;
    if (!source?.startedAt || this.demo()) return;
    const now = Date.now();
    if (now - source.lastSigueAt < OUTCOME_KEEPALIVE_MS) return;
    source.lastSigueAt = now;
    void this.request('sourcesOutcome', {
      body: { id: source.channel.hash, resultado: 'sigue' },
    }).catch(() => {});
  }

  /** Rebuffer (index.html:5177-5206): retener, llenar el colchón y seguir. NUNCA salta al directo. */
  private startRebuffer(connection: Connection): void {
    const source = this.source;
    if (
      !source ||
      !this.isCurrent(connection) ||
      this.conn !== 'activa' ||
      connection.rebuffer ||
      connection.engineKind === 'native' ||
      this.demo() ||
      !this.controller.state.desiredPlaying ||
      this.controller.state.seeking
    )
      return;
    const target = connection.profile.rebuild;
    connection.rebuffer = { startedAt: Date.now(), targetS: target };
    connection.stuckTicks = 0;
    source.metrics.rebuffers += 1;
    void this.controller.setHold('rebuffer', true);
    const now = Date.now();
    if (
      now - source.lastRebufferNoticeAt >= REBUFFER_NOTICE_MS ||
      source.lastRebufferNoticeAt === 0
    ) {
      source.lastRebufferNoticeAt = now;
      this.notify('Señal irregular: recuperando la imagen…', {
        kind: 'signal',
        tone: 'warn',
        signal: 'weak',
      });
    }
    this.setState({ rebuffering: { targetS: target } });
    this.waitBuffer(connection, {
      initial: false,
      target,
      maxWait: REBUFFER_MAX_WAIT_MS,
      onReady: () => this.endRebuffer(connection, true),
      onTimeout: () => {
        this.endRebuffer(connection, false);
        this.fail('La señal no se recupera: reconectando');
      },
    });
  }

  private endRebuffer(connection: Connection, resume: boolean): void {
    const rebuffer = connection.rebuffer;
    if (!rebuffer) return;
    connection.rebuffer = null;
    if (this.source) this.source.metrics.rebufferMs += Date.now() - rebuffer.startedAt;
    this.setState({ rebuffering: null });
    void this.controller.setHold('rebuffer', false, { resume });
  }

  // ---- Fallos y reconexión -------------------------------------------------------

  /**
   * La conexión se ha roto. Si queda presupuesto en la ventana, se reconecta
   * tras la espera exponencial; si no, la fuente se da por fallida.
   */
  fail(
    reason: string,
    {
      retryable = true,
      code,
      detail,
    }: { retryable?: boolean; code?: string; detail?: string } = {},
  ): void {
    const source = this.source;
    if (!source || this.conn === 'idle' || this.conn === 'error' || this.conn === 'reconectando')
      return;
    this.endConnection();
    const now = Date.now();
    source.reconnects = source.reconnects.filter((at) => now - at < RECONNECT_WINDOW_MS);
    const max =
      source.origin === 'auto' && source.startedAt === null
        ? RECONNECT_POLICY.maxAttemptsAutoStart
        : RECONNECT_POLICY.maxAttempts;
    if (detail) this.log(`Fallo: ${reason}`, detail);
    if (!retryable || source.reconnects.length >= max) {
      this.exhaust(reason, code);
      return;
    }
    source.reconnects.push(now);
    source.metrics.reconnects += 1;
    const n = source.reconnects.length;
    this.transition('fallo');
    this.setState({ attempt: { n, max }, message: `${reason} (${n}/${max})…`, rebuffering: null });
    this.notify(`${reason} (${n}/${max})…`, { kind: 'signal', tone: 'warn', icon: 'refresh' });
    const delay = reconnectDelayMs(n);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.source !== source || this.conn !== 'reconectando') return;
      // La primera reconexión reutiliza la sesión (P9); las siguientes piden una nueva.
      this.connect({ recovery: true, freshSession: n >= 2 && !this.session?.remux });
    }, delay);
  }

  /** Reconexiones agotadas (index.html:4947-4974). */
  private exhaust(reason: string, code?: string): void {
    const source = this.source;
    if (!source) return;
    source.failed = true;
    const seconds = source.startedAt ? Math.round((Date.now() - source.startedAt) / 1000) : 0;
    const outcome: 'fallo' | 'cayo' = source.startedAt ? 'cayo' : 'fallo';
    this.sendOutcome(outcome, seconds);
    this.report('source', code ?? 'player_source_failed', reason);
    this.releaseSession('error');
    this.controller.reset();
    this.resetVideo();
    this.transition('agotado');
    const reply = this.sourceFailed({
      channel: source.channel,
      origin: source.origin,
      outcome,
      seconds,
      reason,
    });
    if (this.source !== source) {
      // Lo normal: quien escucha ya ha llamado a play() con la siguiente fuente
      // dentro del propio aviso. Esa fuente manda (su estado, su presencia):
      // aquí solo se cuenta por qué se ha cambiado, sin marcarla como fallida.
      const next = 'Esta fuente no responde: probando la siguiente…';
      if (this.source) this.setState({ message: next });
      this.notify(next, { kind: 'signal', tone: 'warn', signal: 'checking' });
      return;
    }
    const message = reply.next
      ? 'Esta fuente no responde: probando la siguiente…'
      : (reply.message ?? IDLE_MESSAGES.fallo);
    this.setState({ attempt: null, rebuffering: null, idleReason: 'fallo', message });
    // Sustituye al último «reconectando (n/máx)…» de la línea de estado.
    this.notify(message, {
      kind: 'signal',
      tone: reply.next ? 'warn' : 'err',
      signal: reply.next ? 'checking' : 'fail',
    });
    this.setPresence({ active: reply.next });
  }

  /** Fallo que no es de la fuente (motor caído, remux lleno, falta ffmpeg…): se enseña y no se salta. */
  private failSystem(message: string, reason: IdleReason, code: string): void {
    if (!this.source) return;
    this.endConnection();
    this.releaseSession('error');
    this.controller.reset();
    this.resetVideo();
    this.transition('agotado');
    this.report(code === 'engine_unavailable' ? 'engine' : 'client', code, message);
    this.setState({ attempt: null, idleReason: reason, message, rebuffering: null });
    this.setPresence({ active: false });
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Cierra la conexión actual: motor, temporizadores y peticiones en vuelo (B-083). */
  private endConnection(): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = null;
    connection.abort.abort(new DOMException('Conexión sustituida', 'AbortError'));
    if (connection.bufferTimer) clearInterval(connection.bufferTimer);
    if (connection.watchdog) clearInterval(connection.watchdog);
    connection.firstFrameCleanup?.();
    if (connection.rebuffer) {
      connection.rebuffer = null;
      this.setState({ rebuffering: null });
    }
    // Pausa técnica ANTES de destruir: así el motor no provoca un `pause` «de la persona».
    this.controller.pauseMedia();
    try {
      connection.engine?.destroy();
    } catch {}
    this.stopMeter();
    this.stopDemoStats();
  }

  private resetVideo(): void {
    const media = this.video;
    try {
      media.playbackRate = 1;
      if (media.src) {
        media.removeAttribute('src');
        media.load();
      }
    } catch {}
  }

  /** Cambiar de motor sin cortar la reproducción (D5 o motor reabierto): no cuenta como reconexión. */
  private reattach(url: string, protocol: StreamProtocol, notice: string): void {
    const source = this.source;
    const session = this.session;
    // Solo con un motor enganchado (con la URL aún en camino, el backend ya da la nueva).
    if (!source || !session || !nextState(this.conn, 'reenganche')) return;
    session.url = url;
    session.protocol = protocol;
    this.endConnection();
    const connection: Connection = {
      id: ++this.connectionSeq,
      abort: new AbortController(),
      engine: null,
      engineKind: null,
      recovery: true,
      connTicks: 0,
      stuckTicks: 0,
      graceTicks: 0,
      lastPos: 0,
      bufferTimer: null,
      watchdog: null,
      rebuffer: null,
      firstFrameCleanup: null,
      profile: PLAYBACK_PROFILES[this.mode()],
    };
    this.connection = connection;
    this.transition('reenganche');
    this.controller.setSession(this.controllerKey());
    this.resetVideo();
    this.setState({ protocol, message: notice });
    this.notify(notice, { kind: 'signal', icon: 'refresh' });
    this.attachEngine(connection, chooseEngine(protocol, this.platform), url, null);
  }

  // ---- Sesión: latido y soltar -----------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const session = this.session;
    if (!session || this.demo()) return;
    this.heartbeatTimer = setInterval(() => this.beat(), session.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Latido (cada 15 s y también desde `timeupdate`, que sobrevive al estrangulado de temporizadores). */
  beat(): void {
    const session = this.session;
    if (!session || this.demo()) return;
    session.lastBeatAt = Date.now();
    void this.request('sessionHeartbeat', {
      params: { sid: session.id },
      body: { viewer: this.identity().viewer, playing: this.controller.snapshot().actuallyPlaying },
    })
      .then((response) => {
        if (this.session !== session) return;
        // Se perdió un `stream.modeChanged` por SSE: el latido trae el protocolo actual.
        if (response.protocol !== session.protocol || response.url !== session.url) {
          this.reattach(
            response.url,
            response.protocol,
            'Otro dispositivo se ha unido: pasando a HLS…',
          );
        }
      })
      .catch((error: unknown) => {
        if (this.session !== session) return;
        if (
          isApiError(error) &&
          (error.code === 'session_expired' || error.code === 'session_not_found')
        )
          void this.onSessionLost(session);
      });
  }

  /** El backend ya no nos tiene (410/404): ¿otro dispositivo se ha quedado el mando o caducó? */
  private async onSessionLost(session: SessionInfo): Promise<void> {
    if (this.session !== session) return;
    this.dropSession();
    const source = this.source;
    if (!source) return;
    let otherDevice = false;
    try {
      const status = await this.request('playbackStatus');
      const now = status.nowPlaying;
      otherDevice =
        now !== null && (now.dev !== this.identity().device || now.id !== source.channel.hash);
    } catch {}
    if (this.source !== source) return;
    if (otherDevice) {
      this.handoff();
      return;
    }
    this.fail('La sesión había caducado: reconectando');
  }

  private releaseSession(reason: 'user' | 'error' | 'pagehide' | 'channel_change'): void {
    const session = this.session;
    this.dropSession();
    if (session) void this.releaseSessionNow(session, reason);
  }

  private releaseSessionNow(
    session: SessionInfo,
    reason: 'user' | 'error' | 'pagehide' | 'channel_change',
  ): Promise<void> {
    if (this.session === session) this.dropSession();
    if (this.demo()) return Promise.resolve();
    return this.request('sessionRelease', {
      params: { sid: session.id },
      body: { viewer: this.identity().viewer, reason },
      keepalive: true,
    }).then(
      () => undefined,
      () => undefined,
    );
  }

  private dropSession(): void {
    this.session = null;
    this.stopHeartbeat();
    this.setState({ sessionId: null });
  }

  /** Cerrar o salir de la página: se suelta con sendBeacon (regla 38). */
  private releaseOnPageHide(): void {
    const session = this.session;
    if (!session || this.demo()) return;
    this.dropSession();
    const body = JSON.stringify({ viewer: this.identity().viewer, reason: 'pagehide' });
    const url = `/api/v1/sessions/${encodeURIComponent(session.id)}/release`;
    if (!this.sendBeacon(url, body)) {
      void this.request('sessionRelease', {
        params: { sid: session.id },
        body: { viewer: this.identity().viewer, reason: 'pagehide' },
        keepalive: true,
      }).catch(() => {});
    }
  }

  // ---- Eventos del backend (SSE) ------------------------------------------------

  private ours(data: { sessionId?: string | null; viewerIds?: readonly string[] }): boolean {
    const session = this.session;
    if (!session) return false;
    if (data.sessionId && data.sessionId !== session.id) return false;
    return !data.viewerIds?.length || data.viewerIds.includes(this.identity().viewer);
  }

  private onHandoff(data: SseEventData<'playback.handoff'>): void {
    if (!this.source) return;
    const mine = data.viewerIds.includes(this.identity().viewer);
    if (!mine && !(data.sessionId && this.session?.id === data.sessionId)) return;
    this.handoff();
  }

  /** Otro dispositivo se ha quedado el mando (D5): se para sin soltar (ya lo hizo el backend). */
  private handoff(): void {
    this.notify('La reproducción ha pasado a otro dispositivo', { kind: 'signal', icon: 'movil' });
    this.stop('traspasado');
  }

  private onModeChanged(data: SseEventData<'stream.modeChanged'>): void {
    if (!this.ours(data) || data.to === this.session?.protocol) return;
    this.reattach(
      data.url,
      data.to,
      data.reason === 'shared'
        ? 'Otro dispositivo se ha unido: pasando a HLS…'
        : 'Vuelves a estar solo: recuperando la señal directa…',
    );
  }

  private onReopened(data: SseEventData<'stream.reopened'>): void {
    if (!this.ours(data)) return;
    this.reattach(
      data.url,
      data.protocol,
      data.reason === 'remux_restart'
        ? 'La conversión para iPhone se ha reiniciado: reenganchando…'
        : 'El motor se ha reiniciado: reenganchando la señal…',
    );
  }

  private onStats(data: SseEventData<'stream.stats'>): void {
    if (!this.ours(data)) return;
    this.lastStats = {
      status: data.status,
      peers: data.peers,
      speedDown: data.speedDown,
      speedUp: data.speedUp,
      downloaded: data.downloaded,
      at: data.at,
    };
    this.setState({ stats: this.lastStats });
  }

  private onClosed(data: SseEventData<'stream.closed'>): void {
    if (!this.ours(data)) return;
    switch (data.reason) {
      case 'released':
      case 'handoff':
        return;
      case 'revoked':
        this.dropSession();
        this.failSystem(
          'Este dispositivo ya no tiene acceso al reproductor.',
          'fallo',
          'device_revoked',
        );
        return;
      case 'expired':
        this.dropSession();
        this.fail('La sesión había caducado: reconectando');
        return;
      default:
        this.dropSession();
        this.fail('La señal se ha cortado: reconectando', { detail: data.code ?? data.reason });
    }
  }

  private onEngineStatus(data: SseEventData<'engine.status'>): void {
    // Motor de vuelta con un canal esperando: se reengancha como recuperación (P13).
    if (!this.waitingForEngine || data.status !== 'online' || !this.source) return;
    this.waitingForEngine = false;
    this.notify(`Motor de vuelta: reconectando «${this.source.channel.title}»…`, {
      kind: 'signal',
      icon: 'motor',
    });
    this.setPresence({ active: true });
    this.connect({ recovery: this.source.startedAt !== null });
  }

  /** Sin SSE, el sondeo de respaldo avisa de cambios de mando: el latido confirma si nos han echado. */
  private onNowPlaying(
    data: SseEventData<'playback.nowPlaying'>,
    meta: { synthetic: boolean },
  ): void {
    if (!meta.synthetic || !this.session || !data.nowPlaying) return;
    if (data.nowPlaying.dev !== this.identity().device) this.beat();
  }

  // ---- Medio y ciclo de vida de la página --------------------------------------------

  private listenMedia(): void {
    const media = this.video;
    const on = (name: string, handler: () => void) => {
      media.addEventListener(name, handler);
      this.cleanups.push(() => media.removeEventListener(name, handler));
    };
    on('waiting', () => {
      if (this.connection && this.conn === 'activa') this.startRebuffer(this.connection);
    });
    const broken = () => {
      if (!this.connection) return;
      if (
        this.conn === 'conectando' ||
        this.conn === 'precarga' ||
        this.conn === 'arrancando' ||
        this.conn === 'activa'
      )
        this.fail('La señal se ha cortado: reconectando', { detail: 'evento del vídeo' });
    };
    on('error', broken);
    on('ended', broken);
    on('timeupdate', () => {
      const session = this.session;
      if (session && Date.now() - session.lastBeatAt >= session.heartbeatMs) this.beat();
    });
    on('volumechange', () => this.setState({ muted: media.muted, volume: media.volume }));
  }

  private listenLifecycle(win: Window, doc: Document): void {
    const onPageHide = (event: PageTransitionEvent) => {
      // Cerrar la pestaña es el final más habitual de una reproducción: sin
      // esto se perdían sus métricas (P23). Si la página va a la caché de ida
      // y vuelta (persisted) puede volver y seguir: se mandarán al acabar.
      if (!event.persisted) this.endSource('página cerrada', { keepalive: true });
      this.releaseOnPageHide();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Vuelta desde la caché de ida y vuelta: la sesión se soltó al salir.
      if (event.persisted && this.source && isEngaged(this.conn)) this.connect({ recovery: true });
    };
    const onVisibility = () => {
      if (doc.visibilityState !== 'visible') return;
      this.onForeground();
    };
    win.addEventListener('pagehide', onPageHide);
    win.addEventListener('pageshow', onPageShow);
    doc.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => {
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('pageshow', onPageShow);
      doc.removeEventListener('visibilitychange', onVisibility);
    });
  }

  /** Vuelta a primer plano (index.html:5297-5306, ahora en todas las plataformas). */
  onForeground(): void {
    if (!this.source || this.conn !== 'activa' || this.demo()) return;
    // Los temporizadores de una pestaña oculta van estrangulados: latido ya.
    this.beat();
    const media = this.video;
    const wantsPlay = this.controller.state.desiredPlaying;
    if (
      media.error ||
      media.ended ||
      (wantsPlay && media.readyState < 2 && !this.connection?.rebuffer)
    ) {
      this.source.reconnects = [];
      this.fail('Reconectando al volver a la app');
    }
  }

  // ---- Medidor de directo y colchón (para la interfaz) -----------------------------------

  private startMeter(): void {
    this.stopMeter();
    this.meterTimer = setInterval(() => this.meter(), METER_MS);
    this.meter();
  }

  private stopMeter(): void {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
  }

  private meter(): void {
    const source = this.source;
    if (!source || this.conn !== 'activa') return;
    const live = this.measureLive();
    const ahead = bufferAhead(this.video);
    const info: LiveInfo = live
      ? {
          available: true,
          atLive: live.behind <= LIVE_DISPLAY_S,
          behindS: Math.ceil(live.behind),
          delayS: Math.round(live.delay),
        }
      : { ...IDLE_LIVE, available: false };
    if (live && !this.video.paused) {
      source.metrics.latencySum += live.delay;
      source.metrics.latencyCount += 1;
    }
    this.setState({
      live: info,
      bufferAheadS: Math.round(ahead * 10) / 10,
      following: this.controller.state.followingLiveEdge,
    });
  }

  private startDemoStats(): void {
    this.stopDemoStats();
    const roll = () => {
      this.lastStats = {
        status: 'dl',
        peers: 18 + Math.floor(Math.random() * 40),
        speedDown: 900 + Math.floor(Math.random() * 1500),
        speedUp: 80 + Math.floor(Math.random() * 220),
        downloaded: null,
        at: new Date().toISOString(),
      };
      this.setState({ stats: this.lastStats });
    };
    roll();
    this.demoStatsTimer = setInterval(roll, DEMO_STATS_MS);
  }

  private stopDemoStats(): void {
    if (this.demoStatsTimer) clearInterval(this.demoStatsTimer);
    this.demoStatsTimer = null;
  }

  // ---- Estado público --------------------------------------------------------------

  private publish(): void {
    const snapshot = this.controller.snapshot();
    const phase = derivePhase(this.conn, snapshot.phase);
    const patch: Partial<PlayerState> = {
      phase,
      conn: this.conn,
      desiredPlaying: snapshot.desiredPlaying,
      following: snapshot.followingLiveEdge,
    };
    const last = this.lastPublished;
    if (
      last.phase === patch.phase &&
      last.conn === patch.conn &&
      last.desiredPlaying === patch.desiredPlaying &&
      last.following === patch.following
    )
      return;
    this.lastPublished = patch;
    this.setState(patch);
  }

  // ---- Lo que se cuenta al backend -----------------------------------------------------

  /** Resultado de la fuente (index.html:4445-4461): uno por intento, salvo `cayo`. */
  private sendOutcome(resultado: 'arranco' | 'fallo' | 'cayo', segundos: number): void {
    const source = this.source;
    if (!source || this.demo()) return;
    if (resultado === 'arranco') {
      if (source.arrancoSent) return;
      source.arrancoSent = true;
    } else {
      if (source.finalSent) return;
      if (resultado === 'cayo' && !source.arrancoSent) return;
      source.finalSent = true;
    }
    void this.request('sourcesOutcome', {
      body: {
        id: source.channel.hash,
        resultado,
        segundos,
        title: source.channel.title.slice(0, 200),
        ...(source.channel.listaId ? { listaId: source.channel.listaId.slice(0, 64) } : {}),
        ...(source.channel.source ? { source: source.channel.source.slice(0, 60) } : {}),
      },
    }).catch(() => {});
  }

  private metrics(source: SourceAttempt) {
    const m = source.metrics;
    return {
      ...(m.ttffMs !== null ? { timeToFirstFrameMs: m.ttffMs } : {}),
      ...(m.remuxStartMs !== null ? { remuxStartMs: m.remuxStartMs } : {}),
      rebuffers: m.rebuffers,
      rebufferMs: Math.round(m.rebufferMs),
      reconnects: m.reconnects,
      ...(m.latencyCount
        ? { liveLatencyS: Math.round((m.latencySum / m.latencyCount) * 10) / 10 }
        : {}),
    };
  }

  /** Registro de fallos por causa (arquitectura §5.14), con las métricas de la fuente (P23). */
  private report(
    cause: 'client' | 'source' | 'engine',
    code: string,
    message: string,
    { keepalive = false }: { keepalive?: boolean } = {},
  ): void {
    const source = this.source;
    const metrics = source ? this.metrics(source) : undefined;
    this.log(`${code}: ${message}`, metrics);
    if (this.demo()) return;
    void this.request('diagnosticsReport', {
      ...(keepalive ? { keepalive: true } : {}),
      body: {
        cause,
        code:
          code
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 40) || 'player',
        message: message.slice(0, 500),
        ...(source
          ? { hash: source.channel.hash, channel: source.channel.title.slice(0, 120) }
          : {}),
        ...(this.session ? { sessionId: this.session.id } : {}),
        ...(metrics ? { metrics } : {}),
      },
    }).catch(() => {});
  }

  /** Fin de la fuente (parar, cambiar de canal, traspaso): resumen de métricas si hubo algo que medir. */
  private endSource(why: string | null, options: { keepalive?: boolean } = {}): void {
    const source = this.source;
    if (!source || why === null || source.metricsSent) return;
    if (source.startedAt === null && source.metrics.reconnects === 0) return;
    // Una vez por fuente: cerrar la página y luego el desmontaje no la cuentan dos veces.
    source.metricsSent = true;
    this.report('client', 'player_session', `Fin de la reproducción (${why})`, options);
  }

  private recordHistory(channel: PlayChannel & { hash: string }): void {
    void this.request('libraryMutate', {
      body: {
        action: 'history-upsert',
        item: {
          id: channel.hash,
          title: channel.title.slice(0, 500),
          ih: channel.kind === 'infohash',
        },
      },
    })
      .then((library) => this.onLibrary(library))
      .catch((error: unknown) => {
        if (!isAbortError(error)) toast('No se pudo guardar el historial', { tone: 'warn' });
      });
  }

  // ---- Final ---------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return;
    this.clearReconnect();
    if (this.source) this.endSource('reproductor cerrado');
    this.endConnection();
    this.releaseSession('user');
    this.destroyed = true;
    this.controller.destroy();
    this.stopHeartbeat();
    this.stopMeter();
    this.stopDemoStats();
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    this.source = null;
    this.conn = 'idle';
  }
}

/** Mezcla un cambio en el estado público sin repintar si nada cambia (el medidor corre 2 veces por segundo). */
export function mergePlayerState(state: PlayerState, patch: Partial<PlayerState>): PlayerState {
  for (const key of Object.keys(patch) as Array<keyof PlayerState>) {
    const next = patch[key];
    const prev = state[key];
    if (Object.is(next, prev)) continue;
    if (
      next &&
      prev &&
      typeof next === 'object' &&
      typeof prev === 'object' &&
      shallowEqual(next, prev)
    )
      continue;
    return { ...state, ...patch };
  }
  return state;
}
