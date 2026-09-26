/* SessionManager: dueño de las sesiones del motor principal, de los visores
   y del mando (arquitectura §5.6, §6.3 y §7.1; D5; B-005 a B-008, B-277).

   Reglas (todas probadas con el motor falso):
   - Una `EngineSession` por contenido y, en la 0.7.0, UNA sola a la vez en el
     motor principal. Siempre abierta con `format=json` (hay `command_url`),
     guardada en v2/sessions.json y parada con `stop` cuando no quedan visores.
   - Visores con latido cada 15 s; sin latido en 45 s se dan por idos. Los de
     la app nativa también "laten" al pedir ficheros del remux. Los clientes
     0.6.x: su `claim` es un visor `legacy` sin sesión (caduca a los 45 s si
     no reclaman ni sondean /api/playback) y su `/api/remux` un visor que vive
     lo que viva su sesión del remux (como en la 0.6.59).
   - Sin carreras: una cola por visor (con número de generación) y una cola
     única para todo lo que habla con el motor. Al cambiar de canal, lo
     anterior se suelta y se para ANTES de abrir lo nuevo. Una apertura en
     vuelo nunca se corta (el motor ya habría creado la sesión y quedaría
     zombi): si el cliente cuelga, se termina de abrir y se para.
   - Mismo canal con `share`: el segundo se une y, si la sesión era
     progresiva y ya hay dos consumidores, pasa a HLS (`stream.modeChanged`).
     Con `handoff`, el último manda (`playback.handoff`) y la sesión se
     reabre para él. Canales distintos: siempre traspaso.
   - `stat_url` cada 2 s con visores → `stream.stats`. Si el motor vuelve
     (`engine.status` a `online`) o dice que ya no conoce la sesión, se
     reabre para quien la seguía queriendo (`stream.reopened`). */

import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_PLAYBACK_MODE,
  IPTV_ACQUIRE_MAX_MS,
  IPTV_SESSION,
  LEGACY_DEVICE_NAME,
  SHUTDOWN_TIMINGS,
  SSE_TIMINGS,
  TIMEOUTS,
  UNKNOWN_BROWSER_NAME,
  cleanTitle,
  normalizeHash,
  type ClientKind,
  type EngineSessionKind,
  type EngineSessionMode,
  type EngineState,
  type NowPlaying,
  type PersistedSession,
  type PlaybackMode,
  type PlaybackStatus,
  type SameChannelPolicy,
  type SessionSummary,
  type StreamGrant,
  type StreamProtocol,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf, isAppError } from '../../core/errors.js';
import { isEngineUnreachable } from '../engine/index.js';
import type { EngineSessionMeta } from '../engine/types.js';
import { SerialLock } from '../remux/lock.js';
import type { IptvInput } from '../iptv/types.js';
import type { RemuxCloseReason, RemuxHandle, RemuxSource } from '../remux/types.js';
import {
  codecFor,
  directProtocol,
  iptvInputOf,
  latencyFor,
  legacyVideoPath,
  nativeVideoPath,
  webVideoPath,
} from './grant.js';
import { SHARE_VIA_REMUX, consumesFor } from './sharing.js';
import { cleanDeviceName } from './device-name.js';
import { decideClaim, decideRelease, type Tombstones } from './mando.js';
import type { PlaybackDeps, PlaybackService, ViewerIdentity } from './types.js';

/** Aperturas por estadística fallida permitidas por sesión en esta ventana. */
const REOPEN_WINDOW_MS = 5 * 60 * 1000;
const REOPEN_MAX = 3;
/**
 * Fallos seguidos de `stat_url` con el motor `online` y CONTESTANDO (HTTP de
 * error o respuesta rara) para dar la sesión por perdida.
 */
const STAT_FAILURES_TO_REOPEN = 3;
/** Ids de sesiones cerradas que se recuerdan (410 en vez de 404). */
const RECENTLY_CLOSED_MAX = 256;

type Consumption = 'direct' | 'remux' | 'none';
type DropReason =
  | 'released'
  | 'expired'
  | 'revoked'
  | 'channel_change'
  | 'aborted'
  | 'remux_failed'
  | 'remux_closed'
  | 'shutdown';

interface ViewerRec {
  readonly viewerId: string;
  readonly deviceId: string | null;
  readonly client: ClientKind;
  readonly consumes: Consumption;
  /** Caduca por falta de latido (los del remux 0.6.x viven lo que su remux). */
  readonly heartbeat: boolean;
  /** Viene de la app nativa (su URL es la de /native/api/v1/video). */
  readonly native: boolean;
  readonly sessionId: string | null;
  readonly hash: string;
  title: string;
  /** Título conocido (de la petición o de la biblioteca) para «Dónde se está reproduciendo»; "" si no se sabe. */
  label: string;
  /** Nombre legible del dispositivo (device-name.ts). */
  deviceName: string;
  mode: PlaybackMode;
  lastBeat: number;
  playing: boolean | null;
  /** Token del `claim` 0.6.x (visores sin sesión). */
  readonly claimToken: string | null;
}

interface SessionRec {
  readonly id: string;
  readonly hash: string;
  readonly kind: EngineSessionKind;
  mode: EngineSessionMode;
  meta: EngineSessionMeta;
  readonly openedAt: number;
  readonly viewers: Map<string, ViewerRec>;
  closed: boolean;
  statInFlight: boolean;
  statFailures: number;
  readonly reopens: number[];
  /** De dónde sale el vídeo: el motor o la IPTV (relé + remux, docs/iptv.md §6.4). */
  readonly source: 'engine' | 'iptv';
  /** Entrada del relé (solo IPTV). */
  readonly input: IptvInput | null;
  /** Gracia de 3 s tras irse el último visor sin pedir otra cosa (solo IPTV). */
  graceTimer: TimerHandle | null;
  /** Visores que dejan el remux cuando se engancha el siguiente (o acaba la gracia). */
  readonly pendingDetach: string[];
  /** Última vez que el relé apuntó `working` por `player` (con bytes entrando). */
  lastWorkingAt: number;
}

interface AcquireRequest {
  readonly hash: string;
  readonly kind: 'id' | 'infohash' | 'auto';
  readonly viewerId: string;
  readonly deviceId: string | null;
  readonly client: ClientKind;
  readonly consumes: 'direct' | 'remux';
  readonly heartbeat: boolean;
  readonly native: boolean;
  readonly title: string;
  readonly label: string;
  readonly deviceName: string;
  readonly mode: PlaybackMode;
  readonly signal: AbortSignal;
  /** `dev` de un `/api/remux` 0.6.x (ficha del remux). */
  readonly legacyDevice?: string;
  readonly writeNowPlaying: boolean;
  /** Decidido ANTES de mirar el motor (docs/iptv.md §4.1 y §6.4). */
  readonly source: 'engine' | 'iptv';
  /**
   * IPTV: tope absoluto de la petición (`IPTV_ACQUIRE_MAX_MS`, cerrojo
   * incluido). Cada espera usa el menor de su plazo y lo que quede de este
   * (docs/multidispositivo.md §4.5).
   */
  readonly deadlineAt?: number;
}

interface Placement {
  readonly session: SessionRec;
  readonly viewer: ViewerRec;
  readonly handoff: boolean;
  readonly isNew: boolean;
  readonly remux: RemuxHandle | null;
}

export interface PlaybackInspection {
  readonly sessions: readonly {
    readonly id: string;
    readonly hash: string;
    readonly mode: EngineSessionMode;
    readonly playbackUrl: string;
    readonly viewers: readonly string[];
  }[];
  readonly viewers: readonly string[];
  readonly viewerQueues: number;
  readonly background: number;
  readonly ticking: boolean;
}

export interface PlaybackRuntime {
  readonly service: PlaybackService;
  inspect(): PlaybackInspection;
  /** Espera a que terminen los trabajos de fondo (cierres, reaperturas, relanzar el remux). */
  idle(): Promise<void>;
  /** Una vuelta del temporizador de 2 s (caducidad y estadísticas). */
  tick(): void;
}

function newSessionId(): string {
  return `s_${randomBytes(12).toString('base64url')}`;
}

/**
 * S-02 (docs/seguridad.md): ¿el visor es de OTRO dispositivo que el iPhone
 * que pide? Solo cuenta para el origen native (`identity.device`): la web es
 * la administradora y puede con cualquier visor, como en la 0.6.59. Un visor
 * sin dispositivo (web sin `device`, iPhone 0.6.x sin `dev`) tampoco es del
 * iPhone: antes se le dejaba pasar y cualquier dispositivo emparejado podía
 * soltarlo con solo ver su id en un evento SSE.
 */
function foreignViewer(viewer: ViewerRec, identity: ViewerIdentity): boolean {
  const own = identity.device?.deviceId;
  return own !== undefined && viewer.deviceId !== own;
}

function superseded(detail: string): AppError {
  return new AppError('session_expired', { detail });
}

/** Nombre legible del visor: el que trae la identidad, el del emparejado o "Navegador". */
function deviceNameOf(identity: ViewerIdentity): string {
  return cleanDeviceName(
    identity.deviceName ?? identity.device?.device.name,
    identity.device ? 'iPhone' : UNKNOWN_BROWSER_NAME,
  );
}

export function createPlaybackRuntime(deps: PlaybackDeps): PlaybackRuntime {
  const { clock, bus, engine, remux, state, scanner } = deps;
  const logger = deps.logger.child({ module: 'playback' });

  const sessions = new Map<string, SessionRec>();
  const viewers = new Map<string, ViewerRec>();
  const recentlyClosed = new Set<string>();
  const engineLock = new SerialLock();
  const viewerQueues = new Map<string, { readonly lock: SerialLock; gen: number }>();
  const tombstones: Tombstones = new Map();
  const background = new Set<Promise<unknown>>();
  const statAborts = new Set<AbortController>();
  let ticker: TimerHandle | null = null;
  let lastActivity = '';
  let lastEngineState: EngineState | null = null;
  let unsubscribers: (() => void)[] = [];
  let started = false;
  let stopped = false;

  // --- Utilidades ---

  function track(promise: Promise<unknown>): void {
    const tracked: Promise<unknown> = promise
      .catch((error: unknown) => logger.error({ err: error }, 'trabajo de fondo de playback'))
      .finally(() => background.delete(tracked));
    background.add(tracked);
  }

  function queueOf(viewerId: string): { readonly lock: SerialLock; gen: number } {
    let queue = viewerQueues.get(viewerId);
    if (!queue) {
      queue = { lock: new SerialLock(), gen: 0 };
      viewerQueues.set(viewerId, queue);
    }
    return queue;
  }

  /** Cola por visor: sus operaciones van en orden y sin pisarse. */
  function runForViewer<T>(viewerId: string, task: () => Promise<T>): Promise<T> {
    const queue = queueOf(viewerId);
    return queue.lock.run(task).finally(() => {
      if (queue.lock.size === 0 && viewerQueues.get(viewerId) === queue) {
        viewerQueues.delete(viewerId);
      }
    });
  }

  function rememberClosed(sessionId: string): void {
    recentlyClosed.add(sessionId);
    if (recentlyClosed.size > RECENTLY_CLOSED_MAX) {
      const oldest = recentlyClosed.values().next().value;
      if (oldest !== undefined) recentlyClosed.delete(oldest);
    }
  }

  function policy(): SameChannelPolicy {
    try {
      return state.sameChannelPolicy();
    } catch {
      return deps.config.playback.sameChannelPolicy;
    }
  }

  /** Título del canal en la biblioteca (favoritos, historial y la lista activa); "" si no está. */
  function libraryTitle(hash: string): string {
    try {
      const current = state.get();
      for (const list of [current.favorites, current.history, current.web]) {
        const item = list.find((entry) => entry.id === hash && entry.title.trim() !== '');
        if (item) return cleanTitle(item.title, '');
      }
    } catch {}
    return '';
  }

  function remuxViewers(session: SessionRec): ViewerRec[] {
    return [...session.viewers.values()].filter((viewer) => viewer.consumes === 'remux');
  }

  function directViewers(session: SessionRec): ViewerRec[] {
    return [...session.viewers.values()].filter((viewer) => viewer.consumes === 'direct');
  }

  /** Consumidores de la sesión del motor: cada visor directo y el remux (uno para todos). */
  function consumers(session: SessionRec, extra: ViewerRec | null): number {
    const all = [...session.viewers.values()];
    if (extra && !session.viewers.has(extra.viewerId)) all.push(extra);
    const direct = all.filter((viewer) => viewer.consumes === 'direct').length;
    return direct + (all.some((viewer) => viewer.consumes === 'remux') ? 1 : 0);
  }

  /** Qué leerá el visor que pide (sharing.ts, docs/multidispositivo.md §4.6). */
  function consumesOf(
    hash: string,
    client: ClientKind,
    source: 'engine' | 'iptv',
    viewerId: string,
  ): 'direct' | 'remux' {
    const previous = viewers.get(viewerId);
    const live = [...sessions.values()].find((candidate) => candidate.hash === hash) ?? null;
    return consumesFor({
      client,
      source,
      hash,
      previous: previous
        ? {
            hash: previous.hash,
            consumes: previous.consumes,
            sessionAlive: previous.sessionId !== null && sessions.has(previous.sessionId),
          }
        : null,
      session: live
        ? {
            mode: live.mode,
            remux: remuxViewers(live).length > 0,
            direct: directViewers(live).length > 0,
          }
        : null,
      shareViaRemux: deps.shareViaRemux ?? SHARE_VIA_REMUX,
    });
  }

  function sourceOf(session: SessionRec): RemuxSource {
    const base = {
      sessionId: session.id,
      hash: session.hash,
      playbackUrl: session.meta.playbackUrl,
      mode: session.mode,
    };
    if (session.source !== 'iptv' || !session.input) return base;
    const input = session.input;
    return {
      ...base,
      inputUrl: input.inputUrl,
      origin: 'iptv',
      ...(input.isHls ? { isHls: true } : {}),
      openedAt: input.openedAt,
      firstByteAt: () => input.stats().firstByteAt,
      prepareRestart: () => !session.closed && input.prepareRestart(),
    };
  }

  /*
   * Visor web que lee el remux con hls.js por /api/v1/video: una IPTV
   * (docs/iptv.md §5.4 y §6.4) o, con C.4, un AceStream que ya tenía remux
   * porque llegó antes un iPhone (docs/multidispositivo.md §4.6).
   */
  function webRemuxViewer(session: SessionRec, viewer: ViewerRec): boolean {
    if (viewer.native || viewer.client === 'legacy') return false;
    if (session.source === 'iptv') return true;
    return viewer.client === 'web' && viewer.consumes === 'remux';
  }

  function urlFor(session: SessionRec, viewer: ViewerRec): string {
    if (viewer.consumes !== 'remux') return session.meta.playbackUrl;
    if (viewer.native) return nativeVideoPath(session.id);
    return webRemuxViewer(session, viewer)
      ? webVideoPath(session.id)
      : legacyVideoPath(session.hash);
  }

  function protocolFor(session: SessionRec, viewer: ViewerRec): StreamProtocol {
    if (viewer.consumes !== 'remux') return directProtocol(session.mode);
    return webRemuxViewer(session, viewer) ? 'hls' : 'hls-fmp4';
  }

  function sessionInfo(session: SessionRec) {
    return {
      id: session.id,
      heartbeatMs: TIMEOUTS.viewerHeartbeatMs,
      expiresAfterMs: TIMEOUTS.viewerExpiryMs,
    };
  }

  // --- Eventos ---

  /**
   * Visores esperando a que se abra su canal (id del visor → hash). Cuentan
   * como "alguien viendo" en `playback.activity`: así el vigilante del motor
   * cuenta sus aperturas fallidas para el reinicio automático (3 seguidas con
   * un visor esperando, arquitectura §5.5) y el comprobador no prueba ese
   * hash mientras se abre. Sin esto, un visor que no conseguía abrir nunca
   * contaba como esperando (encontrado en la integración, paso 1.3).
   */
  const waiting = new Map<string, string>();

  /** Clave de la última lista publicada en `playback.sessions` (sin `lastBeatAt`). */
  let lastSessionsKey = '';

  function summarize(session: SessionRec): SessionSummary {
    const list = [...session.viewers.values()];
    /* El título del visor que llegó el último y lo sabía. */
    const known = list.findLast((viewer) => viewer.label !== '');
    const direct = list.some((viewer) => viewer.consumes !== 'remux');
    if (session.source === 'iptv') {
      return {
        id: session.id,
        hash: session.hash,
        mode: session.mode,
        openedAt: new Date(session.openedAt).toISOString(),
        viewers: list.map((viewer) => ({
          client: viewer.client,
          deviceId: viewer.deviceId,
          lastBeatAt: new Date(viewer.lastBeat).toISOString(),
          viewerId: viewer.viewerId,
          deviceName: viewer.deviceName,
          platform: viewer.client,
          playing: viewer.playing,
        })),
        title: known?.label ?? '',
        /* Una IPTV siempre pasa por el remux: `hls` si la ve alguna web, `hls-fmp4` si solo iPhones. */
        protocol: list.some((viewer) => webRemuxViewer(session, viewer)) ? 'hls' : 'hls-fmp4',
        source: 'iptv',
      };
    }
    return {
      id: session.id,
      hash: session.hash,
      mode: session.mode,
      openedAt: new Date(session.openedAt).toISOString(),
      viewers: list.map((viewer) => ({
        client: viewer.client,
        deviceId: viewer.deviceId,
        lastBeatAt: new Date(viewer.lastBeat).toISOString(),
        viewerId: viewer.viewerId,
        deviceName: viewer.deviceName,
        platform: viewer.client,
        playing: viewer.playing,
      })),
      title: known?.label ?? '',
      /* Solo apps de iOS (remux): hls-fmp4. Si no, lo que da el motor. */
      protocol: !direct && list.length > 0 ? 'hls-fmp4' : directProtocol(session.mode),
    };
  }

  function summaries(): SessionSummary[] {
    return [...sessions.values()].map(summarize);
  }

  /**
   * «Dónde se está reproduciendo» (`playback.sessions`): la lista entera,
   * solo si ha cambiado algo que se ve (sesiones, visores, nombres, título,
   * modo o `playing`); los latidos, que solo mueven `lastBeatAt`, no cuentan.
   */
  function emitSessions(): void {
    const list = summaries();
    const key = JSON.stringify(list, (name, value: unknown) =>
      name === 'lastBeatAt' ? undefined : value,
    );
    if (key === lastSessionsKey) return;
    lastSessionsKey = key;
    bus.emit('playback.sessions', { sessions: list });
  }

  function emitActivity(): void {
    emitSessions();
    const hashes = [
      ...new Set([...[...viewers.values()].map((viewer) => viewer.hash), ...waiting.values()]),
    ].sort();
    /* ¿Alguien ve (o espera) algo del MOTOR? Con solo IPTV, el motor está libre. */
    const onEngine = (hash: string): boolean => {
      if (!deps.iptv) return true;
      try {
        return deps.iptv.classify(hash) === 'engine';
      } catch {
        return true;
      }
    };
    const watching = viewers.size > 0 || waiting.size > 0;
    const engineWatching =
      [...viewers.values()].some((viewer) => onEngine(viewer.hash)) ||
      [...waiting.values()].some(onEngine);
    /* `engineWatching` solo cuando difiere (hay IPTV): sin IPTV, el evento de siempre. */
    const payload = {
      watching,
      hashes,
      viewers: viewers.size,
      ...(engineWatching !== watching ? { engineWatching } : {}),
    };
    const key = JSON.stringify(payload);
    if (key === lastActivity) return;
    lastActivity = key;
    bus.emit('playback.activity', payload);
  }

  function emitClosed(
    sessionId: string,
    viewerIds: string[],
    reason:
      | 'released'
      | 'expired'
      | 'handoff'
      | 'engine_failed'
      | 'remux_failed'
      | 'revoked'
      | 'shutdown',
    code?: string,
  ): void {
    if (!viewerIds.length) return;
    bus.emit('stream.closed', { sessionId, viewerIds, reason, ...(code ? { code } : {}) });
  }

  /** Agrupa los visores por la URL y el protocolo que les tocan. */
  function groupByUrl(
    session: SessionRec,
    list: ViewerRec[],
  ): { url: string; protocol: StreamProtocol; viewerIds: string[] }[] {
    const groups = new Map<
      string,
      { url: string; protocol: StreamProtocol; viewerIds: string[] }
    >();
    for (const viewer of list) {
      const url = urlFor(session, viewer);
      const protocol = protocolFor(session, viewer);
      const key = `${protocol} ${url}`;
      const group = groups.get(key) ?? { url, protocol, viewerIds: [] };
      group.viewerIds.push(viewer.viewerId);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  function emitNowPlaying(): void {
    try {
      bus.emit('playback.nowPlaying', {
        nowPlaying: state.get().nowPlaying,
        learningCount: state.learningCount(),
      });
    } catch (error) {
      logger.warn({ err: error }, 'no se pudo publicar el mando');
    }
  }

  // --- v2/sessions.json ---

  function toPersisted(session: SessionRec): PersistedSession {
    return {
      id: session.id,
      hash: session.hash,
      kind: session.kind,
      mode: session.mode,
      commandUrl: session.meta.commandUrl,
      openedAt: new Date(session.openedAt).toISOString(),
    };
  }

  async function persistSession(session: SessionRec): Promise<void> {
    try {
      await state.sessions().update((draft) => {
        draft.sessions = [
          ...draft.sessions.filter((entry) => entry.id !== session.id),
          toPersisted(session),
        ];
      });
    } catch (error) {
      logger.warn(
        { err: error, sessionId: session.id },
        'no se pudo guardar la sesión en sessions.json',
      );
    }
  }

  async function forgetSession(sessionId: string): Promise<void> {
    try {
      await state.sessions().update((draft) => {
        draft.sessions = draft.sessions.filter((entry) => entry.id !== sessionId);
      });
    } catch (error) {
      logger.warn({ err: error, sessionId }, 'no se pudo quitar la sesión de sessions.json');
    }
  }

  // --- Mando (nowPlaying en state.json) ---

  async function writeNowPlaying(viewer: ViewerRec): Promise<void> {
    try {
      await state.enqueue(
        (draft) => {
          const previousAt = Number(draft.nowPlaying?.at) || 0;
          draft.nowPlaying = {
            id: viewer.hash,
            title: viewer.title,
            dev: (viewer.deviceId ?? viewer.viewerId).slice(0, 40),
            token: viewer.viewerId,
            at: Math.max(clock.now(), previousAt + 1),
          };
        },
        { scopes: ['nowPlaying'] },
      );
      emitNowPlaying();
    } catch (error) {
      logger.warn({ err: error }, 'no se pudo apuntar el mando');
    }
  }

  function ownsNowPlaying(current: NowPlaying | null, viewer: ViewerRec): boolean {
    if (!current || current.id !== viewer.hash) return false;
    if (viewer.claimToken !== null) return current.token === viewer.claimToken;
    return current.token === viewer.viewerId;
  }

  /** Si el que se va tenía el mando, se borra (hoy `nowPlaying` no caducaba nunca, reproductor §6.3). */
  async function releaseNowPlaying(viewer: ViewerRec): Promise<void> {
    let current: NowPlaying | null;
    try {
      current = state.get().nowPlaying;
    } catch {
      return;
    }
    if (!ownsNowPlaying(current, viewer)) return;
    try {
      const cleared = await state.enqueue(
        (draft) => {
          if (!ownsNowPlaying(draft.nowPlaying, viewer)) return false;
          draft.nowPlaying = null;
          return true;
        },
        { scopes: ['nowPlaying'] },
      );
      if (cleared) emitNowPlaying();
    } catch (error) {
      logger.warn({ err: error }, 'no se pudo soltar el mando');
    }
  }

  // --- Motor ---

  async function openEngine(
    hash: string,
    kind: EngineSessionKind,
    mode: EngineSessionMode,
  ): Promise<EngineSessionMeta> {
    try {
      /* Sin señal a propósito: cortar la meta dejaría la sesión creada en el
         motor sin su command_url (zombi). El plazo de 12 s es del cliente. */
      const meta = await engine.client().openSession({ hash, kind, mode });
      engine.reportOpenSuccess();
      return meta;
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === 'engine_unavailable' || code === 'engine_timeout') engine.reportOpenFailure();
      throw error;
    }
  }

  async function stopEngine(commandUrl: string): Promise<void> {
    try {
      await engine.client().stop(commandUrl);
    } catch (error) {
      logger.warn({ err: error }, 'stop de la sesión del motor');
    }
  }

  /**
   * La señal de la petición más su tope IPTV (docs/multidispositivo.md §4.5):
   * vencido el tope, se aborta con `iptv_timeout` (el cliente recibe ese
   * código, nunca un corte de nginx).
   */
  function deadlineSignal(request: AcquireRequest): {
    readonly signal: AbortSignal;
    dispose(): void;
  } {
    if (request.deadlineAt === undefined) return { signal: request.signal, dispose: () => {} };
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(request.signal.reason);
    if (request.signal.aborted) onAbort();
    else request.signal.addEventListener('abort', onAbort, { once: true });
    const left = request.deadlineAt - clock.now();
    const expire = (): void =>
      controller.abort(new AppError('iptv_timeout', { detail: 'tope de la petición IPTV' }));
    let timer: TimerHandle | null = null;
    if (left <= 0) expire();
    else timer = clock.setTimeout(expire, left, { unref: true });
    return {
      signal: controller.signal,
      dispose: () => {
        clock.clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
      },
    };
  }

  /**
   * Abre una sesión IPTV (docs/iptv.md §6.4): el relé en vez del motor. Sin
   * `reportOpen*`, sin `stat_url` y sin sessions.json (el ffmpeg huérfano ya
   * lo mata la marca `ace_session=`). Con el cerrojo de la casa tomado.
   */
  async function openIptvLocked(request: AcquireRequest): Promise<SessionRec> {
    const iptv = deps.iptv;
    if (!iptv) throw new AppError('iptv_removed');
    const limited = deadlineSignal(request);
    let input: IptvInput;
    try {
      input = await iptv.openInput(request.hash, { signal: limited.signal });
    } finally {
      limited.dispose();
    }
    if (stopped) {
      await input.close();
      throw new AppError('engine_unavailable', { detail: 'apagando' });
    }
    const session: SessionRec = {
      id: newSessionId(),
      hash: request.hash,
      kind: 'id',
      mode: 'hls',
      meta: {
        playbackUrl: input.inputUrl,
        statUrl: '',
        commandUrl: '',
        infohash: null,
        isLive: true,
      },
      openedAt: clock.now(),
      viewers: new Map(),
      closed: false,
      statInFlight: false,
      statFailures: 0,
      reopens: [],
      source: 'iptv',
      input,
      graceTimer: null,
      pendingDetach: [],
      lastWorkingAt: 0,
    };
    sessions.set(session.id, session);
    input.onDropped((code) => track(closeIptv(session, code)));
    input.onRestart(() => track(restartIptv(session)));
    logger.info({ sessionId: session.id }, 'sesión IPTV abierta');
    return session;
  }

  /** Abre una sesión nueva (progresiva). Con `auto`, `id` y si no abre, una vez `infohash` (P6). */
  async function openSessionLocked(request: AcquireRequest): Promise<SessionRec> {
    if (request.source === 'iptv') return openIptvLocked(request);
    const kinds: EngineSessionKind[] =
      request.kind === 'auto' ? ['id', 'infohash'] : [request.kind];
    let lastError: unknown = null;
    for (const kind of kinds) {
      let meta: EngineSessionMeta;
      try {
        meta = await openEngine(request.hash, kind, 'progressive');
      } catch (error) {
        lastError = error;
        const code = errorCodeOf(error);
        if (code === 'source_no_peers' || code === 'bad_request') continue;
        throw error;
      }
      const session: SessionRec = {
        id: newSessionId(),
        hash: request.hash,
        kind,
        mode: 'progressive',
        meta,
        openedAt: clock.now(),
        viewers: new Map(),
        closed: false,
        statInFlight: false,
        statFailures: 0,
        reopens: [],
        source: 'engine',
        input: null,
        graceTimer: null,
        pendingDetach: [],
        lastWorkingAt: 0,
      };
      if (stopped) {
        await stopEngine(meta.commandUrl);
        throw new AppError('engine_unavailable', { detail: 'apagando' });
      }
      sessions.set(session.id, session);
      await persistSession(session);
      logger.info({ sessionId: session.id, hash: session.hash, kind }, 'sesión del motor abierta');
      return session;
    }
    throw lastError;
  }

  /** Cierra una sesión: suelta su remux, `stop` con command_url y fuera de sessions.json. */
  async function closeSessionLocked(
    session: SessionRec,
    options: { readonly stop?: boolean } = {},
  ): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    sessions.delete(session.id);
    rememberClosed(session.id);
    clock.clearTimeout(session.graceTimer);
    session.graceTimer = null;
    session.pendingDetach.length = 0;
    for (const viewer of session.viewers.values()) {
      if (viewers.get(viewer.viewerId) === viewer) viewers.delete(viewer.viewerId);
    }
    session.viewers.clear();
    for (const viewerId of remux.viewersOf(session.id)) {
      await remux.detach(session.id, viewerId).catch(() => undefined);
    }
    if (session.source === 'iptv') {
      /* Cerrar antes de abrir: se espera a que el relé suelte el socket con el proveedor. */
      await session.input?.close().catch(() => undefined);
      logger.info({ sessionId: session.id }, 'sesión IPTV cerrada');
      emitActivity();
      syncTicker();
      return;
    }
    if (options.stop !== false) await stopEngine(session.meta.commandUrl);
    await forgetSession(session.id);
    logger.info({ sessionId: session.id }, 'sesión del motor cerrada');
    emitActivity();
    syncTicker();
  }

  /** Cambia la sesión de modo (progresivo → HLS al compartirse, D5.3). */
  async function switchModeLocked(
    session: SessionRec,
    mode: EngineSessionMode,
    reason: 'shared' | 'alone',
  ): Promise<void> {
    const fromMode = session.mode;
    const old = session.meta;
    const meta = await openEngine(session.hash, session.kind, mode);
    session.meta = meta;
    session.mode = mode;
    session.statFailures = 0;
    /* El motor ya la ha sustituido (una por contenido); el stop es por si acaso. */
    await stopEngine(old.commandUrl);
    await persistSession(session);
    const direct = directViewers(session);
    if (direct.length) {
      bus.emit('stream.modeChanged', {
        sessionId: session.id,
        viewerIds: direct.map((viewer) => viewer.viewerId),
        from: directProtocol(fromMode),
        to: directProtocol(mode),
        url: meta.playbackUrl,
        reason,
      });
    }
    if (remuxViewers(session).length) track(retargetRemux(session, 'remux_restart'));
  }

  /** El remux sigue a la sesión cuando cambia de URL. */
  async function retargetRemux(
    session: SessionRec,
    reason: 'engine_restart' | 'engine_recovered' | 'remux_restart',
  ): Promise<void> {
    const list = remuxViewers(session);
    if (!list.length || session.closed) return;
    let handle: RemuxHandle | null = null;
    let failure: unknown = null;
    try {
      handle = await remux.retarget(sourceOf(session));
    } catch (error) {
      failure = error;
    }
    const still = remuxViewers(session);
    if (handle && !session.closed) {
      for (const group of groupByUrl(session, still)) {
        bus.emit('stream.reopened', { sessionId: session.id, ...group, reason });
      }
      return;
    }
    const code = errorCodeOf(failure) ?? 'remux_died';
    for (const viewer of still) {
      track(runForViewer(viewer.viewerId, () => dropViewer(viewer, 'remux_failed', code)));
    }
  }

  /** Reabre una sesión que el motor ha perdido (reinicio o sesión desconocida). */
  async function reopenLocked(
    session: SessionRec,
    reason: 'engine_restart' | 'engine_recovered',
    stopOld: boolean,
  ): Promise<void> {
    if (session.closed || !session.viewers.size) return;
    let meta: EngineSessionMeta;
    try {
      try {
        meta = await openEngine(session.hash, session.kind, session.mode);
      } catch (error) {
        /* Recién vuelto el motor, una conexión vieja del grupo puede fallar:
           un reintento, y solo si ni siquiera llegó a responder. */
        if (errorCodeOf(error) !== 'engine_unavailable') throw error;
        meta = await openEngine(session.hash, session.kind, session.mode);
      }
    } catch (error) {
      const code = errorCodeOf(error) ?? 'engine_unavailable';
      emitClosed(session.id, [...session.viewers.keys()], 'engine_failed', code);
      const gone = [...session.viewers.values()];
      await closeSessionLocked(session, { stop: false });
      for (const viewer of gone) track(releaseNowPlaying(viewer));
      return;
    }
    const old = session.meta;
    session.meta = meta;
    session.statFailures = 0;
    session.reopens.push(clock.now());
    if (stopOld) await stopEngine(old.commandUrl);
    await persistSession(session);
    logger.info({ sessionId: session.id, reason }, 'sesión del motor reabierta');
    for (const group of groupByUrl(session, directViewers(session))) {
      bus.emit('stream.reopened', { sessionId: session.id, ...group, reason });
    }
    if (remuxViewers(session).length) track(retargetRemux(session, reason));
  }

  // --- IPTV ---

  /**
   * Cierre de una sesión IPTV que decide el servidor (docs/iptv.md §7.4):
   * relé agotado, pausa, eliminar o cuenta caducada. Primero se avisa
   * (`stream.closed remux_failed` con el código `iptv_*`) y DESPUÉS se mata
   * ffmpeg, para que gane el código IPTV y no un `remux_died`.
   */
  async function closeIptv(session: SessionRec, code: string): Promise<void> {
    await engineLock.run(async () => {
      if (session.closed) return;
      const gone = [...session.viewers.values()];
      emitClosed(session.id, [...session.viewers.keys()], 'remux_failed', code);
      if (code === 'iptv_dropped' || code === 'iptv_busy') {
        try {
          scanner.recordVerdict(session.hash, {
            state: code === 'iptv_busy' ? 'weak' : 'failed',
            reason: code,
            by: 'player',
          });
        } catch {}
      }
      await closeSessionLocked(session);
      for (const viewer of gone) track(releaseNowPlaying(viewer));
    });
  }

  /** El relé pide reiniciar el remux (otra base de tiempos u otra variante, §6.1). */
  async function restartIptv(session: SessionRec): Promise<void> {
    if (session.closed) return;
    let handle: RemuxHandle | null = null;
    try {
      handle = await remux.restart(session.id);
    } catch (error) {
      logger.warn(
        { sessionId: session.id, errorCode: errorCodeOf(error) },
        'reinicio del remux IPTV',
      );
    }
    if (session.closed) return;
    if (!handle) {
      await closeIptv(session, 'iptv_dropped');
      return;
    }
    for (const group of groupByUrl(session, remuxViewers(session))) {
      bus.emit('stream.reopened', { sessionId: session.id, ...group, reason: 'remux_restart' });
    }
  }

  /** Pausa, eliminar o cuenta caducada: fuera todas las sesiones IPTV (§7.4). */
  function onIptvRevoked(code: string): void {
    for (const session of [...sessions.values()]) {
      if (session.source === 'iptv') track(closeIptv(session, code));
    }
  }

  /* Visores que dejaron el remux durante la gracia: se sueltan cuando ya se ha enganchado el nuevo. */
  async function releasePendingDetach(session: SessionRec): Promise<void> {
    for (const viewerId of session.pendingDetach.splice(0)) {
      if (session.viewers.has(viewerId)) continue;
      await remux.detach(session.id, viewerId).catch(() => undefined);
    }
  }

  // --- Visores ---

  function emitHandoff(
    session: SessionRec,
    list: ViewerRec[],
    by: { deviceId: string | null; client: ClientKind; hash: string; title: string },
    reason: 'other_channel' | 'same_channel',
  ): void {
    const ids = list.map((viewer) => viewer.viewerId);
    if (!ids.length) return;
    bus.emit('playback.handoff', {
      sessionId: session.id,
      viewerIds: ids,
      byDeviceId: by.deviceId,
      byClient: by.client,
      hash: by.hash,
      title: by.title,
      reason,
    });
  }

  /**
   * Quita un visor. Si su sesión se queda sin nadie, `stop`. Si tenía el
   * mando, se suelta. Con la cola del visor tomada (nunca con la del motor).
   */
  async function dropViewer(
    viewer: ViewerRec,
    reason: DropReason,
    code?: string,
  ): Promise<{ sessionClosed: boolean }> {
    if (viewers.get(viewer.viewerId) !== viewer) return { sessionClosed: false };
    viewers.delete(viewer.viewerId);
    const session = viewer.sessionId ? sessions.get(viewer.sessionId) : undefined;
    session?.viewers.delete(viewer.viewerId);
    if (session) {
      if (reason === 'expired' || reason === 'revoked' || reason === 'released') {
        emitClosed(session.id, [viewer.viewerId], reason);
      } else if (reason === 'remux_failed') {
        emitClosed(session.id, [viewer.viewerId], 'remux_failed', code);
      }
    }
    /* IPTV (docs/iptv.md §6.4): gracia de 3 s SOLO si el último visor se va sin
       pedir otra cosa (soltar o latido perdido). Mientras, el remux y la
       conexión con el proveedor siguen; volver enseguida al mismo canal no
       reabre nada. Cualquier otra colocación la cancela y cierra al momento. */
    const grace =
      session?.source === 'iptv' &&
      session.viewers.size === 0 &&
      (reason === 'released' || reason === 'expired') &&
      !stopped;
    if (session && grace) {
      if (viewer.consumes === 'remux') session.pendingDetach.push(viewer.viewerId);
      clock.clearTimeout(session.graceTimer);
      session.graceTimer = clock.setTimeout(
        () => {
          session.graceTimer = null;
          track(
            engineLock.run(async () => {
              if (session.closed || session.viewers.size > 0) return;
              await closeSessionLocked(session);
            }),
          );
        },
        IPTV_SESSION.graceMs,
        { unref: true },
      );
      await releaseNowPlaying(viewer);
      emitActivity();
      syncTicker();
      return { sessionClosed: false };
    }
    if (session && viewer.consumes === 'remux') {
      await remux.detach(session.id, viewer.viewerId).catch(() => undefined);
    }
    let sessionClosed = false;
    if (session && session.viewers.size === 0) {
      await engineLock.run(async () => {
        if (!session.closed && session.viewers.size === 0) await closeSessionLocked(session);
      });
      sessionClosed = session.closed;
    }
    if (reason !== 'channel_change') await releaseNowPlaying(viewer);
    emitActivity();
    syncTicker();
    return { sessionClosed };
  }

  /** Coloca al visor en la sesión de su canal (cola del motor tomada). */
  async function placeLocked(request: AcquireRequest): Promise<Omit<Placement, 'remux'>> {
    if (stopped) throw new AppError('engine_unavailable', { detail: 'apagando' });
    waiting.set(request.viewerId, request.hash);
    emitActivity();
    try {
      return await placeWaitingLocked(request);
    } finally {
      waiting.delete(request.viewerId);
      emitActivity();
    }
  }

  async function placeWaitingLocked(request: AcquireRequest): Promise<Omit<Placement, 'remux'>> {
    const by = {
      deviceId: request.deviceId,
      client: request.client,
      hash: request.hash,
      title: request.title,
    };
    let handoff = false;
    /* Canales distintos: siempre traspaso (una sola sesión en el motor principal). */
    for (const other of [...sessions.values()]) {
      if (other.hash === request.hash) continue;
      const affected = [...other.viewers.values()].filter((v) => v.viewerId !== request.viewerId);
      emitHandoff(other, affected, by, 'other_channel');
      handoff ||= affected.length > 0;
      await closeSessionLocked(other);
    }
    /* Los 0.6.x con mando se enteran por nowPlaying: dejan de contar como visores. */
    for (const viewer of [...viewers.values()]) {
      if (viewer.sessionId === null && viewer.viewerId !== request.viewerId) {
        viewers.delete(viewer.viewerId);
      }
    }
    let session = [...sessions.values()].find((candidate) => candidate.hash === request.hash);
    /* Vuelta al mismo canal IPTV durante la gracia: se reutiliza (docs/iptv.md §6.4). */
    if (session?.graceTimer) {
      clock.clearTimeout(session.graceTimer);
      session.graceTimer = null;
    }
    if (session && policy() === 'handoff') {
      const others = [...session.viewers.values()].filter((v) => v.viewerId !== request.viewerId);
      if (others.length && session.source === 'iptv') {
        /* IPTV (docs/iptv.md §6.5): la sesión vive en el servidor. Se echa a
           los demás y se conserva: cerrar y reabrir la conexión con el
           proveedor dejaría al nuevo sin plaza en los paneles que la retienen. */
        emitHandoff(session, others, by, 'same_channel');
        handoff = true;
        for (const other of others) {
          session.viewers.delete(other.viewerId);
          if (viewers.get(other.viewerId) === other) viewers.delete(other.viewerId);
          if (other.consumes !== 'remux') continue;
          /* El remux sigue hasta que se engancha el nuevo (como en la gracia). */
          if (request.consumes === 'remux') session.pendingDetach.push(other.viewerId);
          else await remux.detach(session.id, other.viewerId).catch(() => undefined);
        }
      } else if (others.length) {
        /* El último manda y la sesión se reabre para él, en vez de dejar que
           el motor mate la del otro con un 403 (arquitectura §5.6). */
        emitHandoff(session, others, by, 'same_channel');
        handoff = true;
        await closeSessionLocked(session);
        session = undefined;
      }
    }
    if (!session) session = await openSessionLocked(request);
    const existing = session.viewers.get(request.viewerId);
    const viewer: ViewerRec = existing ?? {
      viewerId: request.viewerId,
      deviceId: request.deviceId,
      client: request.client,
      consumes: request.consumes,
      heartbeat: request.heartbeat,
      native: request.native,
      sessionId: session.id,
      hash: request.hash,
      title: request.title,
      label: request.label,
      deviceName: request.deviceName,
      mode: request.mode,
      lastBeat: clock.now(),
      playing: null,
      claimToken: null,
    };
    viewer.lastBeat = clock.now();
    viewer.title = request.title;
    viewer.label = request.label;
    viewer.deviceName = request.deviceName;
    viewer.mode = request.mode;
    /* D5.3: el progresivo solo admite un consumidor. */
    if (session.mode === 'progressive' && consumers(session, viewer) > 1) {
      try {
        await switchModeLocked(session, 'hls', 'shared');
      } catch (error) {
        if (!session.viewers.size) await closeSessionLocked(session);
        throw error;
      }
    }
    session.viewers.set(viewer.viewerId, viewer);
    viewers.set(viewer.viewerId, viewer);
    emitActivity();
    syncTicker();
    return { session, viewer, handoff, isNew: !existing };
  }

  async function ensureRemux(
    session: SessionRec,
    viewer: ViewerRec,
    request: AcquireRequest,
  ): Promise<RemuxHandle> {
    const legacy =
      request.legacyDevice === undefined ? undefined : { device: request.legacyDevice };
    for (let attempt = 0; ; attempt += 1) {
      const url = session.meta.playbackUrl;
      try {
        return await remux.ensure(sourceOf(session), viewer.viewerId, request.signal, {
          ...(legacy ? { legacy } : {}),
          ...(request.deadlineAt === undefined ? {} : { deadlineAt: request.deadlineAt }),
        });
      } catch (error) {
        /* La sesión ha pasado a HLS mientras arrancaba: se engancha a la nueva. */
        const moved =
          isAppError(error) &&
          error.code === 'remux_died' &&
          session.meta.playbackUrl !== url &&
          !session.closed;
        if (attempt === 0 && moved) continue;
        throw error;
      }
    }
  }

  async function acquireInternal(request: AcquireRequest): Promise<Placement> {
    if (stopped) throw new AppError('engine_unavailable', { detail: 'apagando' });
    const queue = queueOf(request.viewerId);
    queue.gen += 1;
    const gen = queue.gen;
    return runForViewer(request.viewerId, async () => {
      const stale = (): boolean => queue.gen !== gen;
      if (stale()) throw superseded('sustituida por una petición más nueva del mismo visor');
      /* Cambio de canal: lo anterior se suelta (y se para) ANTES de abrir. */
      const previous = viewers.get(request.viewerId);
      /* S-02 (docs/seguridad.md): el id de visor lo elige el cliente y viaja
         en claro en los eventos stream.* (van a todas las conexiones, D13).
         Un iPhone que pide un canal con el id de un visor de OTRO dispositivo
         lo soltaría; se comprueba dentro de la cola del visor, así dos
         peticiones a la vez no se cuelan entre la comprobación y el cambio. */
      if (request.native && previous && previous.deviceId !== request.deviceId) {
        throw new AppError('handoff_denied', { detail: 'el visor es de otro dispositivo' });
      }
      if (
        previous &&
        (previous.hash !== request.hash ||
          previous.sessionId === null ||
          previous.consumes !== request.consumes ||
          !sessions.has(previous.sessionId))
      ) {
        await dropViewer(previous, 'channel_change');
      }
      const placed = await engineLock.run(() => placeLocked(request));
      const { session, viewer } = placed;
      let handle: RemuxHandle | null = null;
      if (request.consumes === 'remux') {
        try {
          handle = await ensureRemux(session, viewer, request);
        } catch (error) {
          await dropViewer(viewer, 'aborted');
          if (request.signal.aborted) {
            throw superseded('el cliente colgó mientras se preparaba el remux');
          }
          /* Una IPTV que no arranca en el remux se cierra (sin gracia): la plaza del proveedor queda libre. */
          if (session.source === 'iptv' && !session.closed && session.viewers.size === 0) {
            await engineLock.run(() => closeSessionLocked(session));
          }
          throw error;
        }
        if (session.pendingDetach.length) await releasePendingDetach(session);
      }
      if (request.signal.aborted || stale() || viewers.get(viewer.viewerId) !== viewer) {
        await dropViewer(viewer, 'aborted');
        throw superseded(
          request.signal.aborted ? 'el cliente colgó' : 'sustituida por una petición más nueva',
        );
      }
      if (request.writeNowPlaying && placed.isNew) await writeNowPlaying(viewer);
      return { ...placed, remux: handle };
    });
  }

  // --- Temporizador: caducidad y estadísticas ---

  function syncTicker(): void {
    const needed = !stopped && (viewers.size > 0 || sessions.size > 0);
    if (needed && !ticker) {
      ticker = clock.setInterval(tick, SSE_TIMINGS.statsIntervalMs, { unref: true });
    } else if (!needed && ticker) {
      clock.clearInterval(ticker);
      ticker = null;
    }
  }

  function tick(): void {
    const now = clock.now();
    for (const viewer of [...viewers.values()]) {
      if (!viewer.heartbeat || now - viewer.lastBeat <= TIMEOUTS.viewerExpiryMs) continue;
      track(
        runForViewer(viewer.viewerId, async () => {
          if (viewers.get(viewer.viewerId) !== viewer) return;
          if (clock.now() - viewer.lastBeat <= TIMEOUTS.viewerExpiryMs) return;
          logger.info({ viewerId: viewer.viewerId }, 'visor sin latido: se da por ido');
          await dropViewer(viewer, 'expired');
        }),
      );
    }
    for (const session of sessions.values()) pollStats(session);
  }

  /**
   * Estadísticas de una IPTV: las del relé (docs/iptv.md §5.5), y con bytes
   * entrando se apunta `working` por el reproductor cada 60 s (§7.3).
   */
  function iptvStats(session: SessionRec): void {
    const input = session.input;
    if (!input || session.closed || !session.viewers.size) return;
    const stats = input.stats();
    const now = clock.now();
    bus.emit('stream.stats', {
      sessionId: session.id,
      viewerIds: [...session.viewers.keys()],
      status: 'iptv',
      peers: 0,
      speedDown: stats.kbps,
      speedUp: 0,
      downloaded: stats.bytes,
      at: clock.date().toISOString(),
    });
    const flowing = stats.lastByteAt !== null && now - stats.lastByteAt < 5_000;
    if (flowing && now - session.lastWorkingAt >= IPTV_SESSION.workingEveryMs) {
      session.lastWorkingAt = now;
      try {
        scanner.recordVerdict(session.hash, {
          state: 'working',
          reason: 'playable_media',
          by: 'player',
        });
      } catch {}
    }
  }

  function pollStats(session: SessionRec): void {
    if (session.source === 'iptv') {
      iptvStats(session);
      return;
    }
    if (session.closed || session.statInFlight || !session.viewers.size) return;
    session.statInFlight = true;
    const controller = new AbortController();
    statAborts.add(controller);
    const statUrl = session.meta.statUrl;
    track(
      engine
        .client()
        .getStat(statUrl, controller.signal)
        .then((stat) => {
          session.statFailures = 0;
          if (session.closed || session.meta.statUrl !== statUrl || !session.viewers.size) return;
          bus.emit('stream.stats', {
            sessionId: session.id,
            viewerIds: [...session.viewers.keys()],
            status: stat.status,
            peers: Math.round(stat.peers),
            speedDown: stat.speedDown,
            speedUp: stat.speedUp,
            downloaded: stat.downloaded,
            at: clock.date().toISOString(),
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || session.closed || session.meta.statUrl !== statUrl)
            return;
          /* Motor sin contestar (caído o colgado): la sesión no se da por
             perdida; lo decide el vigilante y, al volver el motor, se reabre
             (onEngineStatus). Si no, en los 20 s que tarda el vigilante en
             verlo offline, 3 fallos de estadística cerraban la sesión del
             visor que estaba esperando (encontrado en la integración, paso 1.3). */
          if (isEngineUnreachable(error)) return;
          session.statFailures += 1;
          const gone = errorCodeOf(error) === 'session_expired';
          let online = false;
          try {
            const state = engine.status().status;
            /* `unknown`: el vigilante aún no ha preguntado (o no está arrancado). */
            online = state === 'online' || state === 'unknown';
          } catch {}
          /* Solo si el vigilante no dice que el motor está reiniciando o
             caído: la reapertura la hace onEngineStatus cuando vuelva (abrir en un
             motor a medio arrancar fallaría y cerraría la sesión del visor). */
          if (online && (gone || session.statFailures >= STAT_FAILURES_TO_REOPEN)) {
            scheduleReopen(session, statUrl);
          }
        })
        .finally(() => {
          session.statInFlight = false;
          statAborts.delete(controller);
        }),
    );
  }

  /** El motor ya no tiene la sesión: se reabre, con un tope para no pelearse con nadie. */
  function scheduleReopen(session: SessionRec, failedStatUrl: string): void {
    track(
      engineLock.run(async () => {
        if (session.closed || !session.viewers.size) return;
        /* Otra vía (la vuelta del motor) ya la ha reabierto mientras esperaba. */
        if (session.meta.statUrl !== failedStatUrl) return;
        const now = clock.now();
        const recent = session.reopens.filter((at) => now - at < REOPEN_WINDOW_MS);
        if (recent.length >= REOPEN_MAX) {
          emitClosed(session.id, [...session.viewers.keys()], 'engine_failed', 'session_expired');
          const gone = [...session.viewers.values()];
          await closeSessionLocked(session);
          for (const viewer of gone) track(releaseNowPlaying(viewer));
          return;
        }
        await reopenLocked(session, 'engine_recovered', false);
      }),
    );
  }

  // --- Suscripciones ---

  function onEngineStatus(status: { readonly status: EngineState }): void {
    const previous = lastEngineState;
    lastEngineState = status.status;
    if (
      status.status !== 'online' ||
      previous === null ||
      previous === 'online' ||
      previous === 'unknown'
    ) {
      return;
    }
    const reason = previous === 'restarting' ? 'engine_restart' : 'engine_recovered';
    track(
      engineLock.run(async () => {
        for (const session of [...sessions.values()]) {
          /* Una IPTV no depende del motor: no se reabre al volver (docs/iptv.md §6.4). */
          if (session.closed || !session.viewers.size || session.source === 'iptv') continue;
          /* Solo se reabre si la sesión ya no existe en el motor. Tras un bache
             sin reinicio puede seguir viva (reabrirla cortaría a quien la ve);
             y tras un reinicio puede que ya la haya reabierto la vía de las
             estadísticas (una segunda reapertura cortaba al visor otra vez:
             encontrado en la integración, paso 1.3). */
          const alive = await engine
            .client()
            .getStat(session.meta.statUrl)
            .then(
              () => true,
              () => false,
            );
          if (alive || session.closed || !session.viewers.size) continue;
          await reopenLocked(session, reason, false);
        }
      }),
    );
  }

  function onRemuxAccess(sessionId: string, deviceId: string | null): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    const now = clock.now();
    for (const viewer of session.viewers.values()) {
      if (viewer.consumes !== 'remux' || !viewer.heartbeat) continue;
      if (deviceId === null || viewer.deviceId === deviceId) viewer.lastBeat = now;
    }
  }

  function onRemuxDetached(
    sessionId: string,
    viewerIds: readonly string[],
    reason: RemuxCloseReason,
  ): void {
    /* IPTV: el remux se ha ido solo (desalojo, ffmpeg muerto, recolector): se
       cierra con `iptv_dropped`, nunca con `remux_died` (docs/iptv.md §6.3). */
    const session = sessions.get(sessionId);
    if (session?.source === 'iptv' && reason !== 'stopped' && reason !== 'shutdown') {
      track(closeIptv(session, 'iptv_dropped'));
      return;
    }
    for (const viewerId of viewerIds) {
      const viewer = viewers.get(viewerId);
      if (!viewer || viewer.sessionId !== sessionId) continue;
      const why: DropReason =
        reason === 'shutdown'
          ? 'shutdown'
          : reason === 'died' || reason === 'evicted'
            ? 'remux_failed'
            : 'remux_closed';
      track(
        runForViewer(viewerId, () =>
          dropViewer(viewer, why, why === 'remux_failed' ? 'remux_died' : undefined),
        ),
      );
    }
  }

  // --- Mando 0.6.x ---

  function claimViewerId(dev: string): string {
    return `lc_${createHash('sha256').update(dev).digest('hex').slice(0, 16)}`;
  }

  /** Un `claim` 0.6.x: los demás dispositivos pierden el canal (traspaso de la 0.6.5). */
  async function applyLegacyClaim(nowPlaying: NowPlaying): Promise<void> {
    await engineLock.run(async () => {
      if (stopped) return;
      const by = {
        deviceId: nowPlaying.dev,
        client: 'legacy' as const,
        hash: nowPlaying.id,
        title: nowPlaying.title,
      };
      for (const session of [...sessions.values()]) {
        /* Su propio /api/remux (mismo dev y canal) no se toca. */
        const affected = [...session.viewers.values()].filter(
          (viewer) => session.hash !== nowPlaying.id || viewer.deviceId !== nowPlaying.dev,
        );
        if (!affected.length) continue;
        emitHandoff(
          session,
          affected,
          by,
          session.hash === nowPlaying.id ? 'same_channel' : 'other_channel',
        );
        for (const viewer of affected) {
          viewers.delete(viewer.viewerId);
          session.viewers.delete(viewer.viewerId);
          if (viewer.consumes === 'remux')
            await remux.detach(session.id, viewer.viewerId).catch(() => undefined);
        }
        if (!session.viewers.size) await closeSessionLocked(session);
      }
      for (const viewer of [...viewers.values()]) {
        if (viewer.sessionId === null) viewers.delete(viewer.viewerId);
      }
      const viewerId = claimViewerId(nowPlaying.dev);
      viewers.set(viewerId, {
        viewerId,
        deviceId: nowPlaying.dev,
        client: 'legacy',
        consumes: 'none',
        heartbeat: true,
        native: false,
        sessionId: null,
        hash: nowPlaying.id,
        title: nowPlaying.title,
        label: cleanTitle(nowPlaying.title, ''),
        deviceName: LEGACY_DEVICE_NAME,
        mode: DEFAULT_PLAYBACK_MODE,
        lastBeat: clock.now(),
        playing: null,
        claimToken: nowPlaying.token,
      });
      emitActivity();
      syncTicker();
    });
  }

  function legacyRemuxError(error: unknown): unknown {
    const code = errorCodeOf(error);
    switch (code) {
      case 'remux_busy':
      case 'remux_died':
      case 'remux_timeout':
      case 'bad_request':
      case 'session_expired':
        return error;
      /* En la 0.6.59 el motor lo abría ffmpeg: un canal sin datos acababa en 504
         y un fallo al abrir, en ffmpeg muerto (502). Sin ffmpeg, igual: 502. */
      case 'engine_timeout':
      case 'source_no_peers':
        return new AppError('remux_timeout', { cause: error });
      default:
        return new AppError('remux_died', { cause: error });
    }
  }

  // --- Servicio ---

  const service: PlaybackService = {
    async start() {
      if (started || stopped) return;
      started = true;
      unsubscribers = [
        bus.on('engine.status', onEngineStatus),
        bus.on('devices.changed', (event) => {
          if (event.reason === 'revoked') track(service.releaseDevice(event.deviceId));
        }),
        remux.subscribe({ onAccess: onRemuxAccess, onDetached: onRemuxDetached }),
        ...(deps.iptv ? [deps.iptv.subscribe({ onRevoked: onIptvRevoked })] : []),
      ];
    },

    async stop() {
      stopped = true;
      for (const off of unsubscribers) off();
      unsubscribers = [];
      for (const controller of statAborts) controller.abort(new Error('playback parado'));
      syncTicker();
    },

    async acquire(hashParam, query, identity, signal) {
      const hash = normalizeHash(hashParam);
      if (!hash) throw new AppError('bad_request', { detail: 'hash no válido' });
      /* Decisión de §4.1 ANTES de mirar el motor: un id IPTV que ya no vale
         responde sin tocarlo; uno del catálogo vigente se abre por el relé. */
      const iptvClass = deps.iptv ? deps.iptv.classify(hash) : 'engine';
      if (iptvClass !== 'engine' && iptvClass !== 'owned') throw new AppError(iptvClass);
      const source = iptvClass === 'owned' ? 'iptv' : 'engine';
      const client = query.client;
      const deviceId = identity.device?.deviceId ?? identity.deviceId ?? query.device ?? null;
      const mode = query.mode ?? DEFAULT_PLAYBACK_MODE;
      /* Sin título en la petición, el de la biblioteca (favoritos, historial o la lista activa). */
      const label =
        cleanTitle(query.title, '') ||
        (source === 'iptv' ? cleanTitle(deps.iptv?.titleOf(hash) ?? '', '') : '') ||
        libraryTitle(hash);
      const placed = await acquireInternal({
        hash,
        kind: query.kind ?? 'auto',
        viewerId: identity.viewerId,
        deviceId,
        client,
        source,
        /* Una IPTV siempre pasa por el remux, también en la web (docs/iptv.md
           §6.4); una reconexión conserva lo que leía (docs/multidispositivo.md §4.6). */
        consumes: consumesOf(hash, client, source, identity.viewerId),
        ...(source === 'iptv' ? { deadlineAt: clock.now() + IPTV_ACQUIRE_MAX_MS } : {}),
        heartbeat: true,
        native: identity.device !== null,
        title: label || `Stream ${hash.slice(0, 8)}`,
        label,
        deviceName: deviceNameOf(identity),
        mode,
        signal,
        writeNowPlaying: true,
      });
      const { session, viewer } = placed;
      const url = urlFor(session, viewer);
      const protocol = protocolFor(session, viewer);
      bus.emit('stream.ready', {
        sessionId: session.id,
        viewerIds: [viewer.viewerId],
        url,
        protocol,
      });
      const grant: StreamGrant = {
        session: sessionInfo(session),
        url,
        protocol,
        remux: viewer.consumes === 'remux',
        codec: codecFor(scanner, hash),
        /* Con el remux, la distancia al directo sale del TARGETDURATION fijado (§4.4). */
        latency: latencyFor(
          mode,
          protocol,
          viewer.consumes === 'remux'
            ? { targetDurationS: placed.remux?.targetDurationS() ?? null }
            : null,
        ),
        stats: { via: 'sse' },
        handoff: placed.handoff,
        ...(session.source === 'iptv' ? { source: 'iptv' as const } : {}),
        ...(session.source === 'iptv' && session.input
          ? { iptvInput: iptvInputOf(session.input) }
          : {}),
      };
      return grant;
    },

    async heartbeat(sessionId, body, identity) {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new AppError(recentlyClosed.has(sessionId) ? 'session_expired' : 'session_not_found');
      }
      const viewer = session.viewers.get(body.viewer);
      if (!viewer)
        throw new AppError('session_expired', { detail: 'el visor ya no está en la sesión' });
      if (foreignViewer(viewer, identity)) {
        throw new AppError('session_not_found', { detail: 'el visor es de otro dispositivo' });
      }
      viewer.lastBeat = clock.now();
      if (body.playing !== undefined) viewer.playing = body.playing;
      /* Un iPhone renombrado se ve con su nombre nuevo al siguiente latido. En la
         web el nombre sale del User-Agent de la petición del canal: no se toca. */
      if (identity.device) viewer.deviceName = deviceNameOf(identity);
      emitSessions();
      return {
        session: sessionInfo(session),
        url: urlFor(session, viewer),
        protocol: protocolFor(session, viewer),
        viewers: session.viewers.size,
      };
    },

    async release(sessionId, body, identity) {
      const known = sessions.has(sessionId) || recentlyClosed.has(sessionId);
      if (!known) throw new AppError('session_not_found');
      return runForViewer(body.viewer, async () => {
        const session = sessions.get(sessionId);
        const viewer = session?.viewers.get(body.viewer);
        if (!session || !viewer) return { released: false, sessionClosed: false };
        if (foreignViewer(viewer, identity)) return { released: false, sessionClosed: false };
        const { sessionClosed } = await dropViewer(viewer, 'released');
        return { released: true, sessionClosed };
      });
    },

    status(): PlaybackStatus {
      return {
        nowPlaying: state.get().nowPlaying,
        learningCount: state.learningCount(),
        serverTime: clock.now(),
        sessions: summaries(),
      };
    },

    async releaseDevice(deviceId) {
      const mine = [...viewers.values()].filter((viewer) => viewer.deviceId === deviceId);
      await Promise.all(
        mine.map((viewer) => runForViewer(viewer.viewerId, () => dropViewer(viewer, 'revoked'))),
      );
    },

    isViewerAlive(sessionId, deviceId) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      const now = clock.now();
      return [...session.viewers.values()].some(
        (viewer) =>
          viewer.deviceId === deviceId &&
          (!viewer.heartbeat || now - viewer.lastBeat <= TIMEOUTS.viewerExpiryMs),
      );
    },

    legacyStatus() {
      /* server.js:4864-4872 (T-115). */
      const current = state.get().nowPlaying;
      /* Un 0.6.x solo sondea mientras reproduce o conecta: cuenta como su latido. */
      if (current) {
        const viewer = viewers.get(claimViewerId(current.dev));
        if (viewer && viewer.claimToken === current.token) viewer.lastBeat = clock.now();
      }
      return { nowPlaying: current, learningCount: state.learningCount(), serverTime: clock.now() };
    },

    async legacyClaim(body) {
      const decision = decideClaim(state.get().nowPlaying, body as Record<string, unknown>, {
        now: clock.now(),
        tombstones,
        random: () => randomBytes(4).toString('hex').slice(0, 6),
      });
      if (decision.kind === 'ignored') return { success: true, nowPlaying: null, ignored: true };
      const nowPlaying = await state.enqueue(
        (draft) => {
          /* La marca se recalcula dentro de la cola: dos claims seguidos no empatan. */
          const previousAt = Number(draft.nowPlaying?.at) || 0;
          const next = {
            ...decision.nowPlaying,
            at: Math.max(decision.nowPlaying.at, previousAt + 1),
          };
          draft.nowPlaying = next;
          return next;
        },
        { scopes: ['nowPlaying'] },
      );
      emitNowPlaying();
      track(applyLegacyClaim(nowPlaying));
      return { success: true, nowPlaying };
    },

    async legacyRelease(body) {
      const decision = decideRelease(state.get().nowPlaying, body as Record<string, unknown>, {
        now: clock.now(),
        tombstones,
      });
      if (!decision.release) return { success: true, released: false };
      const released = await state.enqueue(
        (draft) => {
          /* Se vuelve a comprobar dentro de la cola por si otro claim entró antes. */
          const again = decideRelease(draft.nowPlaying, body as Record<string, unknown>, {
            now: clock.now(),
            tombstones,
          });
          if (!again.release) return null;
          const gone = draft.nowPlaying;
          draft.nowPlaying = null;
          return gone;
        },
        { scopes: ['nowPlaying'] },
      );
      if (!released) return { success: true, released: false };
      emitNowPlaying();
      const viewer = viewers.get(claimViewerId(released.dev));
      if (viewer && viewer.sessionId === null && viewer.claimToken === released.token) {
        viewers.delete(viewer.viewerId);
        emitActivity();
        syncTicker();
      }
      return { success: true, released: true };
    },

    async legacyRemux(query, signal) {
      /* server.js:4906-4926 (B-105, B-217). */
      const ihParam = query.get('infohash');
      const id = normalizeHash(ihParam || query.get('id'));
      if (!id) throw new AppError('bad_request');
      const dev = String(query.get('dev') || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 40);
      const viewerId = dev ? `lr_${dev}` : `lr_${randomBytes(9).toString('base64url')}`;
      const iptvClass = deps.iptv ? deps.iptv.classify(id) : 'engine';
      if (iptvClass !== 'engine' && iptvClass !== 'owned')
        throw new AppError('remux_died', { detail: iptvClass });
      try {
        const placed = await acquireInternal({
          hash: id,
          source: iptvClass === 'owned' ? 'iptv' : 'engine',
          kind: ihParam ? 'infohash' : 'id',
          viewerId,
          deviceId: dev || null,
          client: 'legacy',
          consumes: 'remux',
          heartbeat: false,
          native: false,
          title: `Stream ${id.slice(0, 8)}`,
          label: libraryTitle(id),
          deviceName: LEGACY_DEVICE_NAME,
          mode: DEFAULT_PLAYBACK_MODE,
          signal,
          legacyDevice: dev,
          writeNowPlaying: false,
        });
        return { url: legacyVideoPath(id), token: placed.remux?.legacyToken ?? '' };
      } catch (error) {
        throw legacyRemuxError(error);
      }
    },

    async recoverOrphans() {
      let orphans: readonly PersistedSession[];
      try {
        orphans = state.sessions().read().sessions;
      } catch (error) {
        logger.warn({ err: error }, 'no se pudo leer sessions.json');
        return;
      }
      if (!orphans.length) return;
      logger.info({ count: orphans.length }, 'parando sesiones del motor de un arranque anterior');
      await Promise.all(orphans.map((orphan) => stopEngine(orphan.commandUrl)));
      const ids = new Set(orphans.map((orphan) => orphan.id));
      try {
        await state.sessions().update((draft) => {
          draft.sessions = draft.sessions.filter((entry) => !ids.has(entry.id));
        });
      } catch (error) {
        logger.warn({ err: error }, 'no se pudo vaciar sessions.json');
      }
    },

    async stopAll(timeoutMs = SHUTDOWN_TIMINGS.stopSessionsMs) {
      stopped = true;
      syncTicker();
      const all = [...sessions.values()];
      for (const session of all) {
        emitClosed(session.id, [...session.viewers.keys()], 'shutdown');
        session.closed = true;
        sessions.delete(session.id);
        rememberClosed(session.id);
        session.viewers.clear();
      }
      viewers.clear();
      emitActivity();
      const work = Promise.all(
        all.map(async (session) => {
          clock.clearTimeout(session.graceTimer);
          if (session.source === 'iptv') {
            await session.input?.close().catch(() => undefined);
            return;
          }
          await stopEngine(session.meta.commandUrl);
          await forgetSession(session.id);
        }),
      );
      const timeout = new AbortController();
      await Promise.race([work, clock.sleep(timeoutMs, timeout.signal).catch(() => undefined)]);
      timeout.abort();
    },
  };

  return {
    service,
    inspect: () => ({
      sessions: [...sessions.values()].map((session) => ({
        id: session.id,
        hash: session.hash,
        mode: session.mode,
        playbackUrl: session.meta.playbackUrl,
        viewers: [...session.viewers.keys()],
      })),
      viewers: [...viewers.keys()],
      viewerQueues: viewerQueues.size,
      background: background.size,
      ticking: ticker !== null,
    }),
    async idle() {
      for (let round = 0; round < 50; round += 1) {
        if (!background.size && engineLock.size === 0 && !viewerQueues.size) return;
        await Promise.all([...background]);
        await engineLock.idle();
        await Promise.all([...viewerQueues.values()].map((queue) => queue.lock.idle()));
      }
    },
    tick,
  };
}

export type { ViewerIdentity };
