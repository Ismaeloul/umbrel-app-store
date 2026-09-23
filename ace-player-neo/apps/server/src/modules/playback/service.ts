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
  SHUTDOWN_TIMINGS,
  SSE_TIMINGS,
  TIMEOUTS,
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
  type StreamGrant,
  type StreamProtocol,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError, errorCodeOf, isAppError } from '../../core/errors.js';
import type { EngineSessionMeta } from '../engine/types.js';
import { SerialLock } from '../remux/lock.js';
import type { RemuxCloseReason, RemuxHandle, RemuxSource } from '../remux/types.js';
import { codecFor, directProtocol, latencyFor, legacyVideoPath, nativeVideoPath } from './grant.js';
import { decideClaim, decideRelease, type Tombstones } from './mando.js';
import type { PlaybackDeps, PlaybackService, ViewerIdentity } from './types.js';

/** Aperturas por estadística fallida permitidas por sesión en esta ventana. */
const REOPEN_WINDOW_MS = 5 * 60 * 1000;
const REOPEN_MAX = 3;
/** Fallos seguidos de `stat_url` con el motor `online` para dar la sesión por perdida. */
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
  readonly mode: PlaybackMode;
  readonly signal: AbortSignal;
  /** `dev` de un `/api/remux` 0.6.x (ficha del remux). */
  readonly legacyDevice?: string;
  readonly writeNowPlaying: boolean;
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

function superseded(detail: string): AppError {
  return new AppError('session_expired', { detail });
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

  function sourceOf(session: SessionRec): RemuxSource {
    return {
      sessionId: session.id,
      hash: session.hash,
      playbackUrl: session.meta.playbackUrl,
      mode: session.mode,
    };
  }

  function urlFor(session: SessionRec, viewer: ViewerRec): string {
    if (viewer.consumes !== 'remux') return session.meta.playbackUrl;
    return viewer.native ? nativeVideoPath(session.id) : legacyVideoPath(session.hash);
  }

  function protocolFor(session: SessionRec, viewer: ViewerRec): StreamProtocol {
    return viewer.consumes === 'remux' ? 'hls-fmp4' : directProtocol(session.mode);
  }

  function sessionInfo(session: SessionRec) {
    return {
      id: session.id,
      heartbeatMs: TIMEOUTS.viewerHeartbeatMs,
      expiresAfterMs: TIMEOUTS.viewerExpiryMs,
    };
  }

  // --- Eventos ---

  function emitActivity(): void {
    const hashes = [...new Set([...viewers.values()].map((viewer) => viewer.hash))].sort();
    const payload = { watching: viewers.size > 0, hashes, viewers: viewers.size };
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

  /** Abre una sesión nueva (progresiva). Con `auto`, `id` y si no abre, una vez `infohash` (P6). */
  async function openSessionLocked(request: AcquireRequest): Promise<SessionRec> {
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
    for (const viewer of session.viewers.values()) {
      if (viewers.get(viewer.viewerId) === viewer) viewers.delete(viewer.viewerId);
    }
    session.viewers.clear();
    for (const viewerId of remux.viewersOf(session.id)) {
      await remux.detach(session.id, viewerId).catch(() => undefined);
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
    if (session && policy() === 'handoff') {
      const others = [...session.viewers.values()].filter((v) => v.viewerId !== request.viewerId);
      if (others.length) {
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
      mode: request.mode,
      lastBeat: clock.now(),
      playing: null,
      claimToken: null,
    };
    viewer.lastBeat = clock.now();
    viewer.title = request.title;
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
        return await remux.ensure(
          sourceOf(session),
          viewer.viewerId,
          request.signal,
          legacy ? { legacy } : undefined,
        );
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
          throw error;
        }
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

  function pollStats(session: SessionRec): void {
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
          session.statFailures += 1;
          const gone = errorCodeOf(error) === 'session_expired';
          let online = false;
          try {
            online = engine.status().status === 'online';
          } catch {}
          if (gone || (online && session.statFailures >= STAT_FAILURES_TO_REOPEN)) {
            scheduleReopen(session);
          }
        })
        .finally(() => {
          session.statInFlight = false;
          statAborts.delete(controller);
        }),
    );
  }

  /** El motor ya no tiene la sesión: se reabre, con un tope para no pelearse con nadie. */
  function scheduleReopen(session: SessionRec): void {
    track(
      engineLock.run(async () => {
        if (session.closed || !session.viewers.size) return;
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
          if (session.closed || !session.viewers.size) continue;
          /* Tras un bache sin reinicio la sesión puede seguir viva: reabrirla
             cortaría a quien la está viendo. Solo se reabre si ya no existe. */
          if (reason === 'engine_recovered') {
            const alive = await engine
              .client()
              .getStat(session.meta.statUrl)
              .then(
                () => true,
                () => false,
              );
            if (alive) continue;
          }
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
      const client = query.client;
      const deviceId = identity.device?.deviceId ?? identity.deviceId ?? query.device ?? null;
      const mode = query.mode ?? DEFAULT_PLAYBACK_MODE;
      const placed = await acquireInternal({
        hash,
        kind: query.kind ?? 'auto',
        viewerId: identity.viewerId,
        deviceId,
        client,
        consumes: client === 'ios' ? 'remux' : 'direct',
        heartbeat: true,
        native: identity.device !== null,
        title: cleanTitle(query.title, `Stream ${hash.slice(0, 8)}`),
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
        latency: latencyFor(mode, protocol),
        stats: { via: 'sse' },
        handoff: placed.handoff,
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
      const deviceId = identity.device?.deviceId ?? null;
      if (deviceId && viewer.deviceId && viewer.deviceId !== deviceId) {
        throw new AppError('session_not_found', { detail: 'el visor es de otro dispositivo' });
      }
      viewer.lastBeat = clock.now();
      if (body.playing !== undefined) viewer.playing = body.playing;
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
        const deviceId = identity.device?.deviceId ?? null;
        if (deviceId && viewer.deviceId && viewer.deviceId !== deviceId) {
          return { released: false, sessionClosed: false };
        }
        const { sessionClosed } = await dropViewer(viewer, 'released');
        return { released: true, sessionClosed };
      });
    },

    status(): PlaybackStatus {
      return {
        nowPlaying: state.get().nowPlaying,
        learningCount: state.learningCount(),
        serverTime: clock.now(),
        sessions: [...sessions.values()].map((session) => ({
          id: session.id,
          hash: session.hash,
          mode: session.mode,
          openedAt: new Date(session.openedAt).toISOString(),
          viewers: [...session.viewers.values()].map((viewer) => ({
            client: viewer.client,
            deviceId: viewer.deviceId,
            lastBeatAt: new Date(viewer.lastBeat).toISOString(),
          })),
        })),
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
      try {
        const placed = await acquireInternal({
          hash: id,
          kind: ihParam ? 'infohash' : 'id',
          viewerId,
          deviceId: dev || null,
          client: 'legacy',
          consumes: 'remux',
          heartbeat: false,
          native: false,
          title: `Stream ${id.slice(0, 8)}`,
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
