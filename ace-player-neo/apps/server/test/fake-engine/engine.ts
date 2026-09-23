/* Motor AceStream FALSO, fiel a lo medido contra el motor real 3.2.3
   (docs/analisis/motor-real.md). Sirve para los tests del backend, el soak
   de 2 h simulado, las pruebas E2E de la web y el perfil de test de compose.

   Reglas del motor real que reproduce:
   - Una sesión por contenido: otra meta del mismo contenido (otro pid u otro
     formato) abre una sesión nueva y la anterior deja de servir: su lista HLS
     da 403 y su progresivo se corta (motor-real §3).
   - Una sesión HLS la leen varios clientes a la vez: la misma lista y los
     mismos segmentos, idénticos byte a byte (motor-real §2).
   - Una sesión progresiva solo admite UN consumidor: si llega otro mientras
     el primero lee, al segundo se le escribe a pelo en el socket una
     respuesta con dos líneas de estado "HTTP/1.1 200 OK" seguidas y se cierra
     (Node lo rechaza con HPE_INVALID_HEADER_TOKEN, como con el real). El
     primero sigue recibiendo datos (motor-real §7).
   - Tras `stop`, la lista HLS da 500 y el progresivo se cierra (fin limpio).
   - Las sesiones sin nadie leyendo caducan solas pasado `idleTimeoutMs`.
     Leer es pedir la lista o un segmento, o tener abierto el progresivo; las
     estadísticas NO cuentan. El plazo del real no está medido: 60 s por defecto.
   - URL absolutas en http:// con el Host de la petición (o `publicUrl`), igual
     que el real: por eso nginx necesita `sub_filter` y `proxy_redirect`.

   Lo que NO está verificado en el real y aquí se decide así (anotado también
   en el README): el 404 para sesiones que nunca existieron o que se olvidaron
   en un reinicio; el 500 en la lista de una sesión caducada; la forma de los
   errores de la meta (`{"response": null, "error": "..."}` con 200); los
   campos de /search que no se usan (status, countries, languages). */

import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import {
  DEFAULT_CATALOG,
  HASH_RE,
  normalizeContent,
  parseCatalog,
  type FakeContent,
  type FakeContentInput,
} from './catalog.js';
import { realClock, type EngineClock, type TimerHandle } from './clock.js';
import { handleControlRequest, type ControlContext } from './control-http.js';
import {
  NORMAL_MODE,
  NO_PEERS_MODE,
  holdsData,
  parseMode,
  type FakeMode,
  type FakeModeInput,
} from './modes.js';
import { TS_PACKET_SIZE, TsMuxer, colorFromSeed, generateSegment } from './mpegts.js';
import {
  completedSegments,
  makeSegmentPlan,
  renderPlaylist,
  segmentDurationSec,
  segmentStartSec,
} from './timeline.js';

export interface FakeEngineOptions {
  /* Dirección en la que escucha. Por defecto 127.0.0.1. */
  host?: string;
  /* Puerto. Por defecto 0 (uno libre). */
  port?: number;
  /* Base de las URL absolutas (p. ej. http://acestream:6878). Sin ella se usa
     el Host de cada petición, como el motor real. */
  publicUrl?: string;
  catalog?: readonly FakeContentInput[];
  /* Qué hacer con un id que no está en el catálogo: reproducirlo con los
     valores por defecto ('play', lo de por defecto) o "failed to load content". */
  unknownContent?: 'play' | 'fail';
  clock?: EngineClock;
  idleTimeoutMs?: number;
  sweepIntervalMs?: number;
  /* Segmentos que como mucho tiene la lista viva (el real dio 17). */
  hlsWindowSegments?: number;
  /* Segmentos que ya tiene la lista nada más abrir la sesión (la caché del motor). */
  hlsInitialSegments?: number;
  segmentDurationsSec?: number[];
  /* Segundos de ráfaga inicial del progresivo (la caché del motor, motor-real §7). */
  burstSeconds?: number;
  /* Rutas /__fake/* en el puerto del motor. Por defecto sí. */
  controlApi?: boolean;
  /* Puerto aparte solo con /__fake/*: sigue vivo con el motor caído o reiniciando. */
  controlPort?: number;
  version?: { platform?: string; version?: string; code?: number; websocketPort?: number };
}

export type SessionKind = 'hls' | 'progressive';
export type SessionState = 'active' | 'superseded' | 'stopped' | 'expired';

export interface FakeSessionInfo {
  id: string;
  infohash: string;
  contentId: string;
  requestedAs: 'id' | 'infohash';
  kind: SessionKind;
  pid: string | null;
  state: SessionState;
  createdAt: number;
  readyAt: number;
  lastReadAt: number;
  endedAt: number | null;
  readers: number;
  reads: number;
  firstSequence: number;
}

export interface FakeEngineMetrics {
  sessionsOpened: number;
  sessionsOpen: number;
  sessionsOpenByContent: Record<string, number>;
  sessionsOpenedByContent: Record<string, number>;
  sessionsSuperseded: number;
  sessionsStopped: number;
  sessionsExpired: number;
  sessionsLostInRestart: number;
  stopsReceived: number;
  stopsUnknown: number;
  readersBySession: Record<string, number>;
  progressiveStreams: number;
  corruptResponses: number;
  heldRequests: number;
  requestsByRoute: Record<string, number>;
  bytesSent: number;
  restarts: number;
}

export interface FakeEngineControl {
  readonly clock: EngineClock;
  /* Pone un modo a un contenido (id o infohash) o a todos ('*'). La promesa
     se cumple cuando el cambio está aplicado (con `down` global, cuando el
     puerto ya no acepta conexiones). `forMs` lo quita solo pasado ese tiempo. */
  setMode(target: string, mode: FakeModeInput, options?: { forMs?: number }): Promise<void>;
  clearMode(target: string): Promise<void>;
  /* Quita todos los modos; con `sessions` olvida también las sesiones (y
     corta los progresivos y las peticiones en espera) y con `metrics` pone
     los contadores a cero. Sirve para reutilizar un motor entre tests. */
  reset(options?: { sessions?: boolean; metrics?: boolean }): Promise<void>;
  /* Reinicio del contenedor: corta todo, deja de escuchar `downMs` (con el
     reloj del motor) y vuelve sin ninguna sesión. */
  restart(options?: { downMs?: number }): Promise<void>;
  metrics(): FakeEngineMetrics;
  sessions(): FakeSessionInfo[];
  session(id: string): FakeSessionInfo | undefined;
  activeSession(contentKey: string): FakeSessionInfo | undefined;
  catalog(): FakeContent[];
  setCatalog(entries: readonly FakeContentInput[]): void;
  contentFor(key: string): FakeContent | undefined;
  /* Caduca ya las sesiones que toque (el barrido normal va cada segundo). */
  sweep(): void;
  /* Número del próximo segmento HLS de la línea de tiempo (para los tests). */
  liveSequence(): number;
}

export interface FakeEngine {
  url: string;
  port: number;
  host: string;
  controlUrl: string | null;
  control: FakeEngineControl;
  close(): Promise<void>;
}

interface Session {
  id: string;
  content: FakeContent;
  requestedAs: 'id' | 'infohash';
  kind: SessionKind;
  pid: string | null;
  state: SessionState;
  createdAt: number;
  readyAt: number;
  lastReadAt: number;
  endedAt: number | null;
  firstSequence: number;
  reads: number;
  readers: number;
  downloaded: number;
  settledAt: number;
  stream: ProgressiveStream | null;
}

interface ProgressiveStream {
  session: Session;
  req: IncomingMessage;
  res: ServerResponse;
  mux: TsMuxer;
  bytesPerMs: number;
  credit: number;
  maxCredit: number;
  lastPumpAt: number;
  bytes: number;
  waitingDrain: boolean;
  closed: boolean;
  cutMode: FakeMode | null;
  cutBytes0: number;
  cutAt0: number;
}

interface Waiter {
  attempt: () => boolean;
  session: Session | undefined;
  res: ServerResponse;
  finished: boolean;
}

const REDIRECT_MARK = '_fake_redir';
const EPOCH_OFFSET_MS = 3_600_000;
const SEGMENT_GRACE = 3;
const MAX_DEAD_SESSIONS = 2000;
const PUMP_INTERVAL_MS = 40;

const DEFAULTS = {
  host: '127.0.0.1',
  idleTimeoutMs: 60_000,
  sweepIntervalMs: 1000,
  hlsWindowSegments: 17,
  hlsInitialSegments: 3,
  segmentDurationsSec: [5, 4, 6, 5],
  burstSeconds: 2,
};

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function sendText(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      server.closeAllConnections();
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export async function createFakeEngine(options: FakeEngineOptions = {}): Promise<FakeEngine> {
  const clock = options.clock ?? realClock;
  const host = options.host ?? DEFAULTS.host;
  const urlHostBase = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urlHost = urlHostBase.includes(':') ? `[${urlHostBase}]` : urlHostBase;
  const idleTimeoutMs = clampInt(options.idleTimeoutMs, DEFAULTS.idleTimeoutMs, 1, 86_400_000);
  const sweepIntervalMs = clampInt(options.sweepIntervalMs, DEFAULTS.sweepIntervalMs, 10, 600_000);
  const windowSegments = clampInt(options.hlsWindowSegments, DEFAULTS.hlsWindowSegments, 1, 200);
  const initialSegments = clampInt(
    options.hlsInitialSegments,
    DEFAULTS.hlsInitialSegments,
    1,
    windowSegments,
  );
  const plan = makeSegmentPlan(options.segmentDurationsSec ?? DEFAULTS.segmentDurationsSec);
  const burstSeconds = clampInt(options.burstSeconds, DEFAULTS.burstSeconds, 0, 30);
  const unknownContent = options.unknownContent ?? 'play';
  const controlApi = options.controlApi !== false;
  const publicUrl = options.publicUrl ? options.publicUrl.replace(/\/+$/, '') : null;
  if (publicUrl && !/^http:\/\/[^/\s]+$/i.test(publicUrl))
    throw new Error('publicUrl debe ser http://host[:puerto] sin ruta');
  const version = {
    platform: options.version?.platform ?? 'linux',
    version: options.version?.version ?? '3.2.3',
    code: options.version?.code ?? 3020300,
    websocket_port: options.version?.websocketPort ?? 43879,
  };
  const usesClockTimers =
    typeof clock.setTimeout === 'function' && typeof clock.clearTimeout === 'function';
  const epochMs = clock.now() - EPOCH_OFFSET_MS;

  // --- estado -------------------------------------------------------------
  let catalogList: FakeContent[] = [];
  const byId = new Map<string, FakeContent>();
  const byInfohash = new Map<string, FakeContent>();
  const sessions = new Map<string, Session>();
  const activeByContent = new Map<string, Session>();
  const contentTokens = new Map<string, string>();
  const streams = new Set<ProgressiveStream>();
  const waiters = new Set<Waiter>();
  const modes = new Map<string, FakeMode>();
  const timers = new Set<TimerHandle>();
  const segmentCache = new Map<string, Buffer>();
  const counters = {
    sessionsOpened: 0,
    sessionsSuperseded: 0,
    sessionsStopped: 0,
    sessionsExpired: 0,
    sessionsLostInRestart: 0,
    stopsReceived: 0,
    stopsUnknown: 0,
    corruptResponses: 0,
    bytesSent: 0,
    restarts: 0,
  };
  let openedByContent: Record<string, number> = {};
  let requestsByRoute: Record<string, number> = {};
  let closed = false;
  let restarting = false;
  let restartPromise: Promise<void> | null = null;
  let restartRelease: (() => void) | null = null;
  let listening = false;
  let listenerChain: Promise<void> = Promise.resolve();
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let pokeQueued = false;
  let port = clampInt(options.port, 0, 0, 65535);

  function loadCatalog(entries: readonly FakeContentInput[]): void {
    catalogList = parseCatalog([...entries]);
    byId.clear();
    byInfohash.clear();
    for (const content of catalogList) {
      byId.set(content.id, content);
      byInfohash.set(content.infohash, content);
    }
  }
  loadCatalog(options.catalog ?? DEFAULT_CATALOG);

  // --- tiempo -------------------------------------------------------------
  function schedule(fn: () => void, ms: number): TimerHandle {
    let handle: TimerHandle = null;
    const run = () => {
      timers.delete(handle);
      if (!closed) fn();
    };
    const delay = Math.max(0, ms);
    handle =
      usesClockTimers && clock.setTimeout ? clock.setTimeout(run, delay) : setTimeout(run, delay);
    timers.add(handle);
    return handle;
  }

  function cancel(handle: TimerHandle): void {
    timers.delete(handle);
    if (usesClockTimers && clock.clearTimeout) clock.clearTimeout(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  function timelineSec(now = clock.now()): number {
    return (now - epochMs) / 1000;
  }

  function sweepTick(): void {
    sweep();
    schedule(sweepTick, sweepIntervalMs);
  }

  // --- contenidos y modos ---------------------------------------------------
  function contentFor(key: string): FakeContent | undefined {
    const value = key.trim().toLowerCase();
    return byId.get(value) ?? byInfohash.get(value);
  }

  function resolveContent(as: 'id' | 'infohash', value: string): FakeContent | null {
    const found = as === 'id' ? byId.get(value) : byInfohash.get(value);
    if (found) return found;
    if (unknownContent === 'fail') return null;
    // contenido fuera del catálogo: se reproduce con los valores por defecto
    const content = normalizeContent(as === 'id' ? { id: value } : { id: value, infohash: value });
    byId.set(content.id, content);
    byInfohash.set(content.infohash, content);
    return content;
  }

  function globalMode(): FakeMode {
    return modes.get('*') ?? NORMAL_MODE;
  }

  function modeFor(content: FakeContent): FakeMode {
    const global = modes.get('*');
    if (global && (global.kind === 'down' || global.kind === 'stall')) return global;
    const own = modes.get(content.infohash) ?? modes.get(content.id);
    if (own) return own;
    if (content.peers === 0) return NO_PEERS_MODE;
    return global ?? NORMAL_MODE;
  }

  function normalizeTarget(target: string): string {
    const value = String(target ?? '')
      .trim()
      .toLowerCase();
    if (value === '*' || HASH_RE.test(value)) return value;
    throw new Error(
      `destino de modo no válido: ${String(target)} (usa '*' o un id/infohash de 40 hex)`,
    );
  }

  // --- estadísticas -------------------------------------------------------
  function speedKBps(content: FakeContent): number {
    return Math.round((content.bitrateKbps * content.intakeRatio) / 8);
  }

  function intakeBytesPerSec(session: Session): number {
    const mode = modeFor(session.content);
    if (mode.kind === 'noPeers' || mode.kind === 'stall' || mode.kind === 'down') return 0;
    return speedKBps(session.content) * 1024;
  }

  function settle(session: Session): void {
    if (session.state !== 'active') return;
    const now = clock.now();
    session.downloaded +=
      (intakeBytesPerSec(session) * Math.max(0, now - session.settledAt)) / 1000;
    session.settledAt = now;
  }

  function settleAll(): void {
    for (const session of activeByContent.values()) settle(session);
  }

  // --- esperas (peticiones "colgadas") -------------------------------------
  function poke(): void {
    if (pokeQueued || closed) return;
    pokeQueued = true;
    queueMicrotask(() => {
      pokeQueued = false;
      for (const waiter of [...waiters]) {
        if (!waiters.has(waiter)) continue;
        if (waiter.attempt()) finishWaiter(waiter);
      }
    });
  }

  function finishWaiter(waiter: Waiter): void {
    if (waiter.finished) return;
    waiter.finished = true;
    waiters.delete(waiter);
    if (waiter.session) {
      waiter.session.readers = Math.max(0, waiter.session.readers - 1);
      waiter.session.lastReadAt = clock.now();
    }
  }

  /* Intenta responder ya; si no se puede (motor colgado, sin datos todavía),
     deja la petición abierta y lo reintenta en cada cambio de estado. Mientras
     espera cuenta como lector de la sesión, como un reproductor conectado. */
  function hold(res: ServerResponse, session: Session | undefined, attempt: () => boolean): void {
    const guarded = () => res.destroyed || res.writableEnded || attempt();
    if (guarded()) return;
    const waiter: Waiter = { attempt: guarded, session, res, finished: false };
    if (session) session.readers += 1;
    waiters.add(waiter);
    res.on('close', () => finishWaiter(waiter));
  }

  // --- sesiones -------------------------------------------------------------
  function burstBytes(content: FakeContent): number {
    return (burstSeconds * content.bitrateKbps * 1000) / 8;
  }

  function openSession(
    content: FakeContent,
    as: 'id' | 'infohash',
    kind: SessionKind,
    pid: string | null,
    readyInMs: number,
  ): Session {
    const now = clock.now();
    const previous = activeByContent.get(content.infohash);
    if (previous) endSession(previous, 'superseded');
    const session: Session = {
      id: randomHex(20),
      content,
      requestedAs: as,
      kind,
      pid,
      state: 'active',
      createdAt: now,
      readyAt: now + readyInMs,
      lastReadAt: now,
      endedAt: null,
      firstSequence: Math.max(0, completedSegments(plan, timelineSec(now)) - initialSegments),
      reads: 0,
      readers: 0,
      downloaded: modeFor(content).kind === 'noPeers' ? 0 : burstBytes(content),
      settledAt: now,
      stream: null,
    };
    sessions.set(session.id, session);
    activeByContent.set(content.infohash, session);
    counters.sessionsOpened += 1;
    openedByContent[content.infohash] = (openedByContent[content.infohash] ?? 0) + 1;
    if (readyInMs > 0) schedule(poke, readyInMs);
    return session;
  }

  function endSession(session: Session, state: Exclude<SessionState, 'active'>): void {
    if (session.state !== 'active') return;
    settle(session);
    session.state = state;
    session.endedAt = clock.now();
    if (activeByContent.get(session.content.infohash) === session)
      activeByContent.delete(session.content.infohash);
    if (state === 'superseded') counters.sessionsSuperseded += 1;
    if (state === 'stopped') counters.sessionsStopped += 1;
    if (state === 'expired') counters.sessionsExpired += 1;
    const stream = session.stream;
    if (stream && !stream.closed) {
      // stop: el progresivo se cierra; sesión pisada: se corta
      if (state === 'stopped') stream.res.end();
      else stream.res.destroy();
    }
    for (const [token, sid] of contentTokens) if (sid === session.id) contentTokens.delete(token);
    pruneDeadSessions();
    poke();
  }

  function pruneDeadSessions(): void {
    const dead = sessions.size - activeByContent.size;
    if (dead <= MAX_DEAD_SESSIONS) return;
    let excess = dead - MAX_DEAD_SESSIONS;
    for (const [id, session] of sessions) {
      if (excess <= 0) break;
      if (session.state === 'active') continue;
      sessions.delete(id);
      excess -= 1;
    }
  }

  function forgetEverything(): void {
    counters.sessionsLostInRestart += activeByContent.size;
    for (const stream of [...streams]) stream.res.destroy();
    sessions.clear();
    activeByContent.clear();
    contentTokens.clear();
    segmentCache.clear();
  }

  function sweep(): void {
    const now = clock.now();
    for (const session of [...activeByContent.values()]) {
      if (session.readers > 0) continue;
      if (now - session.lastReadAt >= idleTimeoutMs) endSession(session, 'expired');
    }
  }

  function touch(session: Session): void {
    session.reads += 1;
    session.lastReadAt = clock.now();
  }

  function trackReader(session: Session, res: ServerResponse): void {
    session.readers += 1;
    res.on('close', () => {
      session.readers = Math.max(0, session.readers - 1);
      session.lastReadAt = clock.now();
    });
  }

  function info(session: Session): FakeSessionInfo {
    return {
      id: session.id,
      infohash: session.content.infohash,
      contentId: session.content.id,
      requestedAs: session.requestedAs,
      kind: session.kind,
      pid: session.pid,
      state: session.state,
      createdAt: session.createdAt,
      readyAt: session.readyAt,
      lastReadAt: session.lastReadAt,
      endedAt: session.endedAt,
      readers: session.readers,
      reads: session.reads,
      firstSequence: session.firstSequence,
    };
  }

  // --- respuestas comunes -----------------------------------------------------
  function baseFor(req: IncomingMessage): string {
    if (publicUrl) return publicUrl;
    const hostHeader = String(req.headers.host ?? '');
    /* Con guion bajo: los alias de docker compose de la app lo llevan
       (ismaeloul-ace-player-neo_acestream_1) y sin él las URL saldrían con
       127.0.0.1, que desde otro contenedor no es el motor. */
    if (
      /^[a-z0-9._-]+(:\d{1,5})?$/i.test(hostHeader) ||
      /^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(hostHeader)
    ) {
      return `http://${hostHeader}`;
    }
    return `http://${urlHost}:${port}`;
  }

  function deadResponse(res: ServerResponse, session: Session): void {
    // pisada por otra sesión: 403 (medido); parada o caducada: 500 (medido tras stop)
    if (session.state === 'superseded') sendText(res, 403, 'Forbidden');
    else sendText(res, 500, 'Internal Server Error');
  }

  function downResponse(
    req: IncomingMessage,
    res: ServerResponse,
    mode: Extract<FakeMode, { kind: 'down' }>,
    global: boolean,
  ): void {
    const how = mode.how ?? (global ? 'refuse' : '503');
    if (how === '503') sendText(res, 503, 'Service Unavailable');
    else req.socket.destroy();
  }

  function redirectSelf(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const target = new URL(`${url.pathname}${url.search}`, baseFor(req));
    target.searchParams.set(REDIRECT_MARK, '1');
    res.writeHead(302, { Location: target.toString(), 'Content-Length': 0 });
    res.end();
  }

  function redirected(url: URL): boolean {
    return url.searchParams.get(REDIRECT_MARK) === '1';
  }

  /* Dos líneas de estado seguidas y el socket cerrado: lo mismo que devuelve
     el motor real al segundo consumidor de una sesión progresiva. */
  function corrupt(req: IncomingMessage): void {
    counters.corruptResponses += 1;
    const socket = req.socket;
    socket.write('HTTP/1.1 200 OK\r\nHTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\n\r\n', () =>
      socket.destroy(),
    );
  }

  function metaPayload(session: Session, base: string): unknown {
    const ih = session.content.infohash;
    const playbackUrl =
      session.kind === 'hls'
        ? `${base}/ace/m/${ih}/${session.id}.m3u8`
        : `${base}/ace/r/${ih}/${session.id}`;
    return {
      response: {
        infohash: ih,
        playback_session_id: session.id,
        playback_url: playbackUrl,
        stat_url: `${base}/ace/stat/${ih}/${session.id}`,
        command_url: `${base}/ace/cmd/${ih}/${session.id}`,
        is_live: 1,
        is_encrypted: 0,
        client_session_id: -1,
      },
      error: null,
    };
  }

  function metaError(res: ServerResponse, wantsJson: boolean, error: string): void {
    if (wantsJson) sendJson(res, 200, { response: null, error });
    else sendText(res, 500, error);
  }

  // --- rutas del motor ---------------------------------------------------------
  function handleWebui(res: ServerResponse, url: URL): void {
    if (url.searchParams.get('method') === 'get_version')
      sendJson(res, 200, { result: version, error: null });
    else sendJson(res, 200, { result: null, error: 'unknown method' });
  }

  function handleMeta(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    kind: SessionKind,
  ): void {
    const wantsJson = url.searchParams.get('format') === 'json';
    const infohashParam = url.searchParams.get('infohash');
    const idParam = url.searchParams.get('id');
    const as: 'id' | 'infohash' = infohashParam ? 'infohash' : 'id';
    const value = String(infohashParam ?? idParam ?? '')
      .trim()
      .toLowerCase();
    if (!value) return metaError(res, wantsJson, 'missing content id');
    if (!HASH_RE.test(value)) return metaError(res, wantsJson, 'invalid content id');
    const content = resolveContent(as, value);
    if (!content) return metaError(res, wantsJson, 'failed to load content');
    const pid = url.searchParams.get('pid');
    const base = baseFor(req);
    hold(res, undefined, () => {
      const mode = modeFor(content);
      if (mode.kind === 'stall') return false;
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      if (mode.kind === 'failedContent') {
        metaError(res, wantsJson, 'failed to load content');
        return true;
      }
      const metaDelay = mode.kind === 'slowStart' ? mode.ms : 0;
      const firstByteDelay = mode.kind === 'slowStart' ? (mode.firstByteMs ?? mode.ms) : 0;
      /* La sesión se abre al llegar la petición, aunque la respuesta tarde:
         si el cliente se cansa y corta, la sesión queda abierta sin que nadie
         tenga su command_url (la "fuga" de arquitectura §5.8). */
      const session = openSession(
        content,
        as,
        kind,
        pid ? pid.slice(0, 64) : null,
        metaDelay + firstByteDelay,
      );
      const respond = () => {
        if (res.destroyed || res.writableEnded) return;
        const payload = metaPayload(session, base) as { response: { playback_url: string } };
        if (wantsJson) sendJson(res, 200, payload);
        else {
          res.writeHead(302, { Location: payload.response.playback_url, 'Content-Length': 0 });
          res.end();
        }
      };
      if (metaDelay > 0) schedule(respond, metaDelay);
      else respond();
      return true;
    });
  }

  function handlePlaylist(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ih: string,
    sid: string,
  ): void {
    const session = sessions.get(sid);
    if (!session || session.content.infohash !== ih || session.kind !== 'hls')
      return sendText(res, 404, 'Not Found');
    const base = baseFor(req);
    hold(res, session, () => {
      if (session.state !== 'active') {
        deadResponse(res, session);
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      if (mode.kind === 'redirectHttp' && !redirected(url)) {
        redirectSelf(req, res, url);
        return true;
      }
      if (holdsData(mode) || clock.now() < session.readyAt) return false;
      touch(session);
      const last = completedSegments(plan, timelineSec());
      const from = Math.max(session.firstSequence, last - windowSegments);
      const body = renderPlaylist(plan, from, last, (n) => `${base}/ace/c/${ih}/${n}.ts`);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return true;
    });
  }

  function segmentBytes(content: FakeContent, n: number): Buffer {
    const key = `${content.infohash}:${n}:${content.bitrateKbps}:${content.video}:${content.audio.join(',')}`;
    let data = segmentCache.get(key);
    if (!data) {
      const startSec = segmentStartSec(plan, n);
      data = generateSegment({
        video: content.video,
        audio: content.audio,
        bitrateKbps: content.bitrateKbps,
        startSec,
        endSec: startSec + segmentDurationSec(plan, n),
        color: colorFromSeed(content.infohash),
      });
      segmentCache.set(key, data);
      if (segmentCache.size > 12) {
        const oldest = segmentCache.keys().next().value;
        if (oldest !== undefined) segmentCache.delete(oldest);
      }
    }
    return data;
  }

  function handleSegment(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ih: string,
    n: number,
  ): void {
    const initial = activeByContent.get(ih);
    hold(res, initial, () => {
      const session = activeByContent.get(ih);
      if (!session || session.kind !== 'hls') {
        sendText(res, 404, 'Not Found');
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      if (mode.kind === 'redirectHttp' && !redirected(url)) {
        redirectSelf(req, res, url);
        return true;
      }
      if (holdsData(mode) || clock.now() < session.readyAt) return false;
      const last = completedSegments(plan, timelineSec());
      const oldest = Math.max(session.firstSequence, last - windowSegments - SEGMENT_GRACE);
      if (n < oldest || n >= last) {
        sendText(res, 404, 'Not Found');
        return true;
      }
      touch(session);
      trackReader(session, res);
      const data = segmentBytes(session.content, n);
      res.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
      });
      if (mode.kind === 'cut') {
        const cutAt =
          mode.afterBytes !== undefined
            ? Math.min(mode.afterBytes, data.length)
            : Math.floor(data.length / 2);
        if (cutAt >= data.length) {
          counters.bytesSent += data.length;
          res.end(data);
          return true;
        }
        counters.bytesSent += cutAt;
        res.write(data.subarray(0, cutAt));
        const kill = () => req.socket.destroy();
        if (mode.afterBytes === undefined && mode.afterMs !== undefined)
          schedule(kill, mode.afterMs);
        else res.write(Buffer.alloc(0), kill);
        return true;
      }
      counters.bytesSent += data.length;
      res.end(data);
      return true;
    });
  }

  function handleProgressiveRedirect(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ih: string,
    sid: string,
  ): void {
    const session = sessions.get(sid);
    if (!session || session.content.infohash !== ih || session.kind !== 'progressive')
      return sendText(res, 404, 'Not Found');
    const base = baseFor(req);
    hold(res, session, () => {
      if (session.state !== 'active') {
        deadResponse(res, session);
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      if (mode.kind === 'stall') return false;
      if (mode.kind === 'redirectHttp' && !redirected(url)) {
        redirectSelf(req, res, url);
        return true;
      }
      const token = randomHex(16);
      contentTokens.set(token, session.id);
      res.writeHead(302, { Location: `${base}/content/${ih}/${token}`, 'Content-Length': 0 });
      res.end();
      return true;
    });
  }

  function handleContent(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ih: string,
    token: string,
  ): void {
    const sid = contentTokens.get(token);
    const session = sid ? sessions.get(sid) : undefined;
    if (!session || session.content.infohash !== ih) return sendText(res, 404, 'Not Found');
    hold(res, session, () => {
      if (session.state !== 'active') {
        deadResponse(res, session);
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      if (mode.kind === 'redirectHttp' && !redirected(url)) {
        redirectSelf(req, res, url);
        return true;
      }
      if (holdsData(mode) || clock.now() < session.readyAt) return false;
      if (session.stream && !session.stream.closed) {
        corrupt(req);
        return true;
      }
      startStream(session, req, res);
      return true;
    });
  }

  function startStream(session: Session, req: IncomingMessage, res: ServerResponse): void {
    const content = session.content;
    const bytesPerSec = (content.bitrateKbps * 1000) / 8;
    const burst = burstBytes(content);
    const stream: ProgressiveStream = {
      session,
      req,
      res,
      mux: new TsMuxer({
        video: content.video,
        audio: content.audio,
        bitrateKbps: content.bitrateKbps,
        // la ráfaga es lo que el motor ya tenía en caché: empieza en el pasado
        startSec: Math.max(0, Math.floor(timelineSec() - burstSeconds)),
        color: colorFromSeed(content.infohash),
      }),
      bytesPerMs: bytesPerSec / 1000,
      credit: burst,
      maxCredit: Math.max(burst, bytesPerSec),
      lastPumpAt: performance.now(),
      bytes: 0,
      waitingDrain: false,
      closed: false,
      cutMode: null,
      cutBytes0: 0,
      cutAt0: 0,
    };
    session.stream = stream;
    touch(session);
    session.readers += 1;
    streams.add(stream);
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    res.on('close', () => closeStream(stream));
    ensurePump();
    pumpStream(stream, performance.now());
  }

  function closeStream(stream: ProgressiveStream): void {
    if (stream.closed) return;
    stream.closed = true;
    streams.delete(stream);
    const session = stream.session;
    if (session.stream === stream) session.stream = null;
    session.readers = Math.max(0, session.readers - 1);
    session.lastReadAt = clock.now();
    if (streams.size === 0 && pumpTimer) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }
  }

  function ensurePump(): void {
    if (pumpTimer) return;
    pumpTimer = setInterval(() => {
      const now = performance.now();
      for (const stream of [...streams]) pumpStream(stream, now);
    }, PUMP_INTERVAL_MS);
  }

  /* El ritmo del progresivo va en tiempo real: crédito de bytes según el
     bitrate del canal, con la ráfaga inicial ya concedida. En los modos que
     no entregan datos no se acumula crédito (al volver no hay avalancha). */
  function pumpStream(stream: ProgressiveStream, nowReal: number): void {
    const dt = Math.max(0, nowReal - stream.lastPumpAt);
    stream.lastPumpAt = nowReal;
    if (stream.closed || stream.res.destroyed) return;
    const session = stream.session;
    if (session.state !== 'active') return;
    session.lastReadAt = clock.now();
    const mode = modeFor(session.content);
    if (mode.kind === 'down') {
      downResponse(stream.req, stream.res, { kind: 'down', how: 'reset' }, false);
      return;
    }
    if (holdsData(mode)) return;
    let remaining = Number.POSITIVE_INFINITY;
    if (mode.kind === 'cut') {
      if (stream.cutMode !== mode) {
        stream.cutMode = mode;
        stream.cutBytes0 = stream.bytes;
        stream.cutAt0 = clock.now();
      }
      if (mode.afterMs !== undefined && clock.now() - stream.cutAt0 >= mode.afterMs) {
        stream.req.socket.destroy();
        return;
      }
      if (mode.afterBytes !== undefined)
        remaining = stream.cutBytes0 + mode.afterBytes - stream.bytes;
      if (remaining <= 0) {
        stream.req.socket.destroy();
        return;
      }
    } else {
      stream.cutMode = null;
    }
    if (stream.waitingDrain) return;
    stream.credit = Math.min(stream.credit + dt * stream.bytesPerMs, stream.maxCredit);
    const packets = Math.floor(stream.credit / TS_PACKET_SIZE);
    if (packets <= 0) return;
    let chunk = stream.mux.nextPackets(packets);
    stream.credit -= chunk.length;
    let cutNow = false;
    if (chunk.length >= remaining) {
      chunk = chunk.subarray(0, remaining);
      cutNow = true;
    }
    stream.bytes += chunk.length;
    counters.bytesSent += chunk.length;
    if (cutNow) {
      stream.res.write(chunk, () => stream.req.socket.destroy());
      return;
    }
    if (!stream.res.write(chunk)) {
      stream.waitingDrain = true;
      stream.res.once('drain', () => {
        stream.waitingDrain = false;
      });
    }
  }

  function handleStat(res: ServerResponse, req: IncomingMessage, ih: string, sid: string): void {
    const session = sessions.get(sid);
    if (!session || session.state !== 'active' || session.content.infohash !== ih) {
      return sendJson(res, 200, { response: null, error: 'unknown playback session id' });
    }
    // un motor colgado tampoco contesta las estadísticas; esperar aquí NO cuenta como lector
    hold(res, undefined, () => {
      if (session.state !== 'active') {
        sendJson(res, 200, { response: null, error: 'unknown playback session id' });
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'stall') return false;
      if (mode.kind === 'down') downResponse(req, res, mode, false);
      else sendStat(res, session, mode);
      return true;
    });
  }

  function sendStat(res: ServerResponse, session: Session, mode: FakeMode): void {
    settle(session);
    const content = session.content;
    const intake = intakeBytesPerSec(session);
    const noPeers = mode.kind === 'noPeers';
    const prebuf = noPeers || clock.now() < session.readyAt;
    sendJson(res, 200, {
      response: {
        status: prebuf ? 'prebuf' : 'dl',
        speed_down: Math.round(intake / 1024),
        speed_up: 0,
        peers: noPeers ? 0 : content.peers,
        // el motor cuenta por piezas: múltiplos de 16 KiB
        downloaded: Math.floor(session.downloaded / 16384) * 16384,
        uploaded: 0,
        total_progress: 0,
        playback_session_id: session.id,
        infohash: content.infohash,
        is_live: 1,
        is_encrypted: 0,
        client_session_id: -1,
      },
      error: null,
    });
  }

  function handleCommand(
    res: ServerResponse,
    req: IncomingMessage,
    url: URL,
    ih: string,
    sid: string,
  ): void {
    if (url.searchParams.get('method') !== 'stop')
      return sendJson(res, 200, { response: null, error: 'unknown method' });
    counters.stopsReceived += 1;
    const session = sessions.get(sid);
    if (!session || session.state !== 'active' || session.content.infohash !== ih) {
      counters.stopsUnknown += 1;
      return sendJson(res, 200, { response: null, error: 'unknown playback session id' });
    }
    /* Con el motor colgado el stop se queda esperando (el backend tiene que
       tener su propio plazo); al descolgarse se aplica. */
    hold(res, undefined, () => {
      if (session.state !== 'active') {
        counters.stopsUnknown += 1;
        sendJson(res, 200, { response: null, error: 'unknown playback session id' });
        return true;
      }
      const mode = modeFor(session.content);
      if (mode.kind === 'stall') return false;
      if (mode.kind === 'down') {
        downResponse(req, res, mode, false);
        return true;
      }
      endSession(session, 'stopped');
      sendJson(res, 200, { response: 'ok', error: null });
      return true;
    });
  }

  function handleSearch(res: ServerResponse, url: URL): void {
    hold(res, undefined, () => {
      if (globalMode().kind === 'stall') return false;
      const query = normalizeText(String(url.searchParams.get('query') ?? '').trim());
      if (!query) {
        sendJson(res, 200, { result: null, error: 'missing query' });
        return true;
      }
      const pageSize = clampInt(url.searchParams.get('page_size'), 10, 1, 200);
      const page = clampInt(url.searchParams.get('page'), 0, 0, 10_000);
      const tokens = query.split(/\s+/).filter(Boolean);
      const matches = catalogList.filter((content) => {
        const name = normalizeText(content.searchName);
        return tokens.every((token) => name.includes(token));
      });
      const pageItems = matches.slice(page * pageSize, (page + 1) * pageSize);
      const groups: Array<{ name: string; items: unknown[] }> = [];
      const updatedAt = Math.floor(clock.now() / 1000) - 60;
      for (const content of pageItems) {
        let group = groups.find((g) => g.name === content.searchName);
        if (!group) {
          group = { name: content.searchName, items: [] };
          groups.push(group);
        }
        group.items.push({
          name: content.searchName,
          infohash: content.infohash,
          bitrate: Math.round((content.bitrateKbps * 1000) / 8),
          categories: [content.category],
          availability: content.peers > 0 ? Math.min(1, 0.5 + content.peers / 40) : 0.05,
          availability_updated_at: updatedAt,
          status: content.peers > 0 ? 2 : 1,
          countries: ['es'],
          languages: ['spa'],
        });
      }
      sendJson(res, 200, { result: { total: matches.length, results: groups }, error: null });
      return true;
    });
  }

  function countRoute(name: string): void {
    requestsByRoute[name] = (requestsByRoute[name] ?? 0) + 1;
  }

  function onEngineRequest(req: IncomingMessage, res: ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://motor-falso');
    } catch {
      return sendText(res, 400, 'Bad Request');
    }
    const path = url.pathname;
    if (path.startsWith('/__fake/') || path === '/__fake') {
      countRoute('control');
      if (!controlApi) return sendText(res, 404, 'Not Found');
      void handleControlRequest(control, req, res, url, controlContext(false));
      return;
    }
    let match: RegExpMatchArray | null;
    let route = 'other';
    if (path === '/webui/api/service') route = 'webui';
    else if (path === '/ace/manifest.m3u8') route = 'manifest';
    else if (path === '/ace/getstream') route = 'getstream';
    else if (path === '/search') route = 'search';
    else if (/^\/ace\/m\//.test(path)) route = 'playlist';
    else if (/^\/ace\/c\//.test(path)) route = 'segment';
    else if (/^\/ace\/r\//.test(path)) route = 'progressive';
    else if (/^\/content\//.test(path)) route = 'content';
    else if (/^\/ace\/stat\//.test(path)) route = 'stat';
    else if (/^\/ace\/cmd\//.test(path)) route = 'cmd';
    countRoute(route);
    const global = globalMode();
    if (global.kind === 'down') return downResponse(req, res, global, true);
    if (req.method !== 'GET') return sendText(res, 405, 'Method Not Allowed');
    switch (route) {
      case 'webui':
        return handleWebui(res, url);
      case 'manifest':
        return handleMeta(req, res, url, 'hls');
      case 'getstream':
        return handleMeta(req, res, url, 'progressive');
      case 'search':
        return handleSearch(res, url);
      case 'playlist':
        match = /^\/ace\/m\/([0-9a-f]{40})\/([0-9a-f]{1,64})\.m3u8$/i.exec(path);
        if (match?.[1] && match[2])
          return handlePlaylist(req, res, url, match[1].toLowerCase(), match[2].toLowerCase());
        break;
      case 'segment':
        match = /^\/ace\/c\/([0-9a-f]{40})\/(\d{1,12})\.ts$/i.exec(path);
        if (match?.[1] && match[2])
          return handleSegment(req, res, url, match[1].toLowerCase(), Number(match[2]));
        break;
      case 'progressive':
        match = /^\/ace\/r\/([0-9a-f]{40})\/([0-9a-f]{1,64})$/i.exec(path);
        if (match?.[1] && match[2])
          return handleProgressiveRedirect(
            req,
            res,
            url,
            match[1].toLowerCase(),
            match[2].toLowerCase(),
          );
        break;
      case 'content':
        match = /^\/content\/([0-9a-f]{40})\/([0-9a-f]{1,64})$/i.exec(path);
        if (match?.[1] && match[2])
          return handleContent(req, res, url, match[1].toLowerCase(), match[2].toLowerCase());
        break;
      case 'stat':
        match = /^\/ace\/stat\/([0-9a-f]{40})\/([0-9a-f]{1,64})$/i.exec(path);
        if (match?.[1] && match[2])
          return handleStat(res, req, match[1].toLowerCase(), match[2].toLowerCase());
        break;
      case 'cmd':
        match = /^\/ace\/cmd\/([0-9a-f]{40})\/([0-9a-f]{1,64})$/i.exec(path);
        if (match?.[1] && match[2])
          return handleCommand(res, req, url, match[1].toLowerCase(), match[2].toLowerCase());
        break;
      default:
        break;
    }
    sendText(res, 404, 'Not Found');
  }

  // --- servidores -------------------------------------------------------------
  const server = http.createServer(onEngineRequest);
  /* Los progresivos duran horas: sin plazo de petición. keepAliveTimeout se
     deja en el valor de Node: fijarlo a mano (aunque sea al mismo número) hizo
     que Node 24.15 cortara con ECONNRESET conexiones nuevas en Windows. */
  server.requestTimeout = 0;

  function wantsListening(): boolean {
    if (closed || restarting) return false;
    const global = modes.get('*');
    return !(global?.kind === 'down' && (global.how ?? 'refuse') === 'refuse');
  }

  /* Abre o cierra el puerto del motor según el estado. Encadenado para que
     dos cambios seguidos no se crucen. Al cerrar se cortan todas las
     conexiones: un motor caído no sigue sirviendo el progresivo. */
  function syncListener(): Promise<void> {
    listenerChain = listenerChain
      .catch(() => undefined)
      .then(async () => {
        const want = wantsListening();
        if (want && !listening) {
          await listen(server, port, host);
          listening = true;
          port = (server.address() as AddressInfo).port;
        } else if (!want && listening) {
          listening = false;
          for (const stream of [...streams]) stream.res.destroy();
          await closeServer(server);
        }
      });
    return listenerChain;
  }

  let controlServer: http.Server | null = null;

  function controlContext(viaControlPort: boolean): ControlContext {
    return { restarting: () => restarting, listening: () => listening, viaControlPort };
  }

  // --- control -------------------------------------------------------------------
  const control: FakeEngineControl = {
    clock,
    setMode(target, input, opts) {
      const key = normalizeTarget(target);
      const mode = parseMode(input);
      settleAll();
      modes.set(key, mode);
      const forMs = opts?.forMs;
      if (forMs !== undefined && Number.isFinite(forMs) && forMs >= 0) {
        schedule(() => {
          if (modes.get(key) !== mode) return;
          settleAll();
          modes.delete(key);
          poke();
          void syncListener();
        }, forMs);
      }
      poke();
      return syncListener();
    },
    clearMode(target) {
      const key = normalizeTarget(target);
      settleAll();
      modes.delete(key);
      poke();
      return syncListener();
    },
    reset(opts) {
      settleAll();
      modes.clear();
      if (opts?.sessions) {
        /* Se cortan también las peticiones en espera y se dan por cerradas ya
           (sin esperar al evento 'close'): así un motor reutilizado entre
           tests empieza el siguiente con las métricas a cero de verdad. */
        for (const stream of [...streams]) {
          closeStream(stream);
          stream.res.destroy();
        }
        for (const waiter of [...waiters]) {
          finishWaiter(waiter);
          waiter.res.destroy();
        }
        sessions.clear();
        activeByContent.clear();
        contentTokens.clear();
      }
      if (opts?.metrics) {
        for (const key of Object.keys(counters) as Array<keyof typeof counters>) counters[key] = 0;
        openedByContent = {};
        requestsByRoute = {};
      }
      poke();
      return syncListener();
    },
    restart(opts) {
      if (restartPromise) return restartPromise;
      const downMs = clampInt(opts?.downMs, 3000, 0, 600_000);
      counters.restarts += 1;
      restarting = true;
      forgetEverything();
      const waited = new Promise<void>((resolve) => {
        restartRelease = resolve;
        schedule(resolve, downMs);
      });
      restartPromise = (async () => {
        try {
          await syncListener();
          await waited;
        } finally {
          restarting = false;
          restartRelease = null;
        }
        await syncListener();
      })().finally(() => {
        restartPromise = null;
      });
      return restartPromise;
    },
    metrics() {
      const sessionsOpenByContent: Record<string, number> = {};
      const readersBySession: Record<string, number> = {};
      for (const [ih, session] of activeByContent) {
        sessionsOpenByContent[ih] = 1;
        readersBySession[session.id] = session.readers;
      }
      return {
        ...counters,
        sessionsOpen: activeByContent.size,
        sessionsOpenByContent,
        sessionsOpenedByContent: { ...openedByContent },
        readersBySession,
        progressiveStreams: streams.size,
        heldRequests: waiters.size,
        requestsByRoute: { ...requestsByRoute },
      };
    },
    sessions() {
      return [...sessions.values()].map(info);
    },
    session(id) {
      const session = sessions.get(String(id).toLowerCase());
      return session ? info(session) : undefined;
    },
    activeSession(contentKey) {
      const content = contentFor(contentKey);
      const session = content ? activeByContent.get(content.infohash) : undefined;
      return session ? info(session) : undefined;
    },
    catalog() {
      return catalogList.map((content) => ({ ...content, audio: [...content.audio] }));
    },
    setCatalog(entries) {
      loadCatalog(entries);
    },
    contentFor,
    sweep,
    liveSequence() {
      return completedSegments(plan, timelineSec());
    },
  };

  try {
    await syncListener();
    if (options.controlPort !== undefined) {
      controlServer = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://motor-falso');
        countRoute('control');
        if (!url.pathname.startsWith('/__fake')) return sendText(res, 404, 'Not Found');
        void handleControlRequest(control, req, res, url, controlContext(true));
      });
      await listen(controlServer, clampInt(options.controlPort, 0, 0, 65535), host);
    }
  } catch (error) {
    closed = true;
    await closeServer(server);
    throw error;
  }
  schedule(sweepTick, sweepIntervalMs);

  const controlAddress = controlServer ? (controlServer.address() as AddressInfo) : null;
  return {
    url: `http://${urlHost}:${port}`,
    port,
    host,
    controlUrl: controlAddress ? `http://${urlHost}:${controlAddress.port}` : null,
    control,
    async close() {
      if (closed) return;
      closed = true;
      for (const handle of [...timers]) cancel(handle);
      restartRelease?.();
      if (pumpTimer) {
        clearInterval(pumpTimer);
        pumpTimer = null;
      }
      for (const stream of [...streams]) stream.res.destroy();
      waiters.clear();
      await syncListener();
      await closeServer(server);
      if (controlServer) await closeServer(controlServer);
    },
  };
}
