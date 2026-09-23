/* Ejemplos válidos de cada respuesta JSON de /api/v1, de cada evento SSE y
   del error v1 (arquitectura §4 y §10.3). Se escriben en fixtures/ como JSON
   para que los tests de decodificación de la app iOS los lean tal cual.

   Están tipados contra los esquemas: si alguien cambia un esquema y no el
   ejemplo, falla el typecheck; y el test fixtures.test.ts comprueba que el
   JSON de disco coincide con esto y que valida con zod.

   Uso: corepack pnpm@10.18.2 --filter @ace/shared fixtures
   Datos inventados: hashes de ejemplo, nombres genéricos y un host
   `umbrel.local`; nada real. */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import type {
  ApiError,
  Device,
  EngineStatus,
  FootballMatch,
  Item,
  LibraryView,
  Preferences,
  ResolutionCandidate,
  ScanJob,
  SseEventData,
  SseEventType,
  V1ResponseInput,
  V1RouteId,
  V1Routes,
  WebSourceSummary,
} from '../src/index.js';

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures',
);

/** Rutas que responden JSON (las de SSE y ficheros no llevan ejemplo). */
export type JsonRouteId = {
  [K in V1RouteId]: V1Routes[K]['response'] extends null ? never : K;
}[V1RouteId];

// --- Piezas comunes ---

const HASH_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const HASH_B = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';
const HASH_C = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
const AT = '2026-09-23T18:30:00.000Z';
const AT_MS = Date.parse(AT);
const SID = 's_Q2FuYWxEZVBydWViYQ';
const DEVICE_ID = 'dev_iphone01';
const VIEWER = 'viewer_tab01';
const SCAN_ID = '0123456789abcdef01234567';

const item = (id: string, title: string, type: Item['type']): Item => ({
  id,
  title,
  type,
  category: type === 'web' ? 'Deportes' : '',
  date: AT,
  fromWebSync: type === 'web',
  ih: false,
});

const webSource: WebSourceSummary = {
  id: 'principal',
  name: 'Principal',
  url: 'https://example.com/lista.m3u',
  type: 'm3u',
  count: 2,
  syncedAt: AT,
  lastErrorAt: null,
  lastError: null,
};

const preferences: Preferences = {
  onboardingComplete: true,
  country: 'Spain',
  leagues: ['LaLiga', 'Champions League'],
  teams: ['Real Madrid'],
  nationalities: ['España'],
};

const library: LibraryView = {
  web: [item(HASH_A, 'DAZN 1', 'web'), item(HASH_B, 'M+ LaLiga', 'web')],
  webSyncedAt: AT,
  webSources: [webSource],
  activeWebSourceId: 'principal',
  favorites: [item(HASH_A, 'DAZN 1', 'fav')],
  history: [item(HASH_C, 'Canal de prueba', 'recent')],
};

const engineStatus: EngineStatus = {
  status: 'online',
  online: true,
  since: AT,
  checkedAt: AT,
  engineVersion: '3.2.3',
  autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
};

const device: Device = {
  id: DEVICE_ID,
  name: 'iPhone de prueba',
  platform: 'ios',
  createdAt: AT,
  lastSeenAt: AT,
  revokedAt: null,
};

const match: FootballMatch = {
  id: 'fltv-2026-09-23-3',
  date: '2026-09-23',
  time: '21:00',
  start: AT_MS,
  title: 'Equipo Local - Equipo Visitante',
  home: 'Equipo Local',
  away: 'Equipo Visitante',
  competition: 'LaLiga',
  country: 'Spain',
  channels: [{ id: 'm-laliga', name: 'M+ LaLiga' }],
};

const candidate: ResolutionCandidate = {
  id: HASH_B,
  title: 'M+ LaLiga FHD',
  alias: null,
  ih: false,
  source: 'm3u',
  score: 100,
  matchedChannel: 'M+ LaLiga',
  soloFamilia: false,
  familyFallbackAllowed: false,
  listaId: 'principal',
  availability: null,
  bitrate: null,
  learned: null,
  reported: null,
  rejectedByLearning: false,
  quarantined: false,
};

const scanJob: ScanJob = {
  id: SCAN_ID,
  kind: 'interactive',
  status: 'running',
  createdAt: AT,
  updatedAt: AT,
  total: 2,
  checked: 1,
  playable: 1,
  failed: 0,
  waiting: 0,
  retryAt: null,
  initialCount: 2,
  candidates: [
    {
      id: HASH_B,
      state: 'working',
      checkedAt: AT,
      retryAt: null,
      durationMs: 9000,
      bytes: 262144,
      peers: 12,
      speedDown: 850,
      rateKbps: 4200,
      intakeKbps: 4400,
      streamKbps: 4000,
      reason: 'playable_media',
      mediaValid: true,
      browserCompatible: true,
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      cached: false,
      attempts: 1,
      playableOn: { web: true, ios: true },
    },
    {
      id: HASH_C,
      state: 'checking',
      checkedAt: null,
      retryAt: null,
      durationMs: 0,
      bytes: 0,
      peers: 0,
      speedDown: 0,
      rateKbps: null,
      intakeKbps: null,
      streamKbps: 0,
      reason: '',
      mediaValid: false,
      browserCompatible: false,
      videoCodec: '',
      audioCodecs: [],
      cached: false,
      attempts: 0,
    },
  ],
};

const statEntry = { intentos: 3.5, exitos: 2.8, caidas: 0.4, segundos: 5400, ultimo: AT_MS };
const counts = { engine: 1, source: 3, network: 0, codec: 1, client: 2, state: 0 };
const streamSession = { id: SID, heartbeatMs: 15000, expiresAfterMs: 45000 };
/** Una sesión compartida por la web y el iPhone («Dónde se está reproduciendo»). */
const sessionSummary = {
  id: SID,
  hash: HASH_A,
  mode: 'hls' as const,
  openedAt: AT,
  viewers: [
    {
      client: 'web' as const,
      deviceId: 'web_salon01',
      lastBeatAt: AT,
      viewerId: VIEWER,
      deviceName: 'Chrome · Windows',
      platform: 'web' as const,
      playing: true,
    },
    {
      client: 'ios' as const,
      deviceId: DEVICE_ID,
      lastBeatAt: AT,
      viewerId: 'viewer_iphone01',
      deviceName: 'iPhone de Isma',
      platform: 'ios' as const,
      playing: false,
    },
  ],
  title: 'DAZN 1',
  protocol: 'hls' as const,
};
const diagnostic = {
  id: 'diag_000001',
  at: AT,
  cause: 'source' as const,
  code: 'source_no_peers',
  message: 'La fuente no tiene pares.',
  hash: HASH_A,
  channel: 'DAZN 1',
  sessionId: SID,
};

// --- Una respuesta por ruta JSON ---

export const V1_FIXTURES = {
  ping: { ok: true, app: 'ace-player-neo', version: '0.7.0', apiVersion: 1, serverTime: AT_MS },
  bootstrap: {
    version: '0.7.0',
    serverTime: AT_MS,
    origin: 'native',
    device,
    preferences,
    library,
    playback: { nowPlaying: null, learningCount: 4, serverTime: AT_MS, sessions: [] },
    engine: engineStatus,
    settings: { sameChannelPolicy: 'share' },
    features: { scanner: true, ai: false, demoSchedule: false },
  },
  health: {
    version: '0.7.0',
    checkedAt: AT,
    uptimeSeconds: 3600,
    components: {
      backend: { status: 'ready' },
      engine: engineStatus,
      scanner: {
        status: 'ready',
        busy: false,
        queue: 0,
        activeJobs: 0,
        cachedSources: 42,
        leakedSessionsLastHour: 0,
      },
      ai: { status: 'disabled', model: 'embeddinggemma:300m-qat-q4_0' },
      agenda: { status: 'ready', generatedAt: AT, matches: 120, preheated: 3 },
      directories: { status: 'ready', total: 1, channels: 2 },
      state: { status: 'ready', recoveredFrom: null },
      playback: { sessions: 1, viewers: 2, remuxSessions: 1 },
      events: { connections: 2 },
    },
    reports: { total: 2, quarantined: 1, learningCount: 4 },
    diagnostics: { counts24h: counts },
    warnings: [],
  },
  healthLive: { ok: true },
  engineStatus,
  engineRestart: { restarted: true },
  channelStream: {
    session: streamSession,
    url: `/native/api/v1/video/${SID}/index.m3u8?t=eyJzaWQiOiJzX1EyRnVZV3cifQ.firma`,
    protocol: 'hls-fmp4',
    remux: true,
    codec: { video: 'hevc', audio: 'aac', source: 'ffprobe' },
    latency: {
      mode: 'balanced',
      initialBufferS: 6,
      rebuildS: 8,
      liveSync: null,
      ios: { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 8 },
    },
    stats: { via: 'sse' },
    handoff: false,
  },
  sessionHeartbeat: {
    session: streamSession,
    url: `/ace/m/${HASH_A}/${SID}.m3u8`,
    protocol: 'hls',
    viewers: 2,
  },
  sessionRelease: { released: true, sessionClosed: false },
  playbackStatus: {
    nowPlaying: { id: HASH_A, title: 'DAZN 1', dev: 'salon', token: 'tok_abc123', at: AT_MS },
    learningCount: 4,
    serverTime: AT_MS,
    sessions: [sessionSummary],
  },
  settingsGet: { settings: { sameChannelPolicy: 'share' }, source: 'environment' },
  settingsUpdate: { settings: { sameChannelPolicy: 'handoff' }, source: 'saved' },
  pairingCreate: {
    code: '482913',
    expiresAt: '2026-09-23T18:35:00.000Z',
    ttlMs: 300000,
    pairUri: 'aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913',
    qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"></svg>',
  },
  pairingClaim: {
    deviceId: DEVICE_ID,
    token: `${DEVICE_ID}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    device,
  },
  devicesList: { devices: [device] },
  deviceRevoke: { device: { ...device, revokedAt: AT } },
  diagnosticsList: { entries: [diagnostic], counts24h: counts, total: 7 },
  diagnosticsReport: { accepted: true, id: 'diag_000002' },
  libraryGet: library,
  libraryMutate: library,
  preferencesGet: { preferences },
  preferencesUpdate: { preferences },
  directoriesGet: {
    web: library.web,
    webSyncedAt: AT,
    webSources: [webSource],
    activeWebSourceId: 'principal',
  },
  directoriesSync: {
    web: library.web,
    webSyncedAt: AT,
    webSources: [webSource, { ...webSource, id: 'deportes', name: 'Deportes', count: 0 }],
    activeWebSourceId: 'deportes',
  },
  directoriesActivate: {
    web: library.web,
    webSyncedAt: AT,
    webSources: [webSource],
    activeWebSourceId: 'principal',
  },
  directoriesDelete: {
    web: library.web,
    webSyncedAt: AT,
    webSources: [webSource],
    activeWebSourceId: 'principal',
  },
  footballSchedule: {
    generatedAt: AT,
    timezone: 'Europe/Madrid',
    country: 'Spain',
    source: 'futbolenlatv',
    attribution: 'futbolenlatv.com',
    demo: false,
    limited: false,
    partial: false,
    days: [{ date: '2026-09-23', matches: [match] }],
  },
  footballResolve: {
    status: 'found',
    channels: ['M+ LaLiga'],
    checked: ['m3u', 'favorites', 'history', 'acestream'],
    candidate,
    candidates: [candidate],
    engineAvailable: true,
    ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
    program: null,
    research: false,
    preheat: null,
    scan: {
      id: SCAN_ID,
      statusUrl: `/api/v1/football/scans/${SCAN_ID}`,
      total: 1,
      initialCount: 1,
    },
  },
  footballScan: scanJob,
  footballPreheat: {
    preheat: {
      matchId: match.id,
      stage: 'scan',
      status: 'scanning',
      updatedAt: AT,
      candidateCount: 2,
      checked: 1,
      playable: 1,
      total: 2,
      error: '',
    },
  },
  footballBind: {
    binding: {
      channel: 'M+ LaLiga',
      channelKey: 'movistar laliga',
      id: HASH_B,
      title: 'M+ LaLiga FHD',
      ih: false,
      updatedAt: AT,
    },
    channelBindings: [
      {
        channel: 'M+ LaLiga',
        channelKey: 'movistar laliga',
        id: HASH_B,
        title: 'M+ LaLiga FHD',
        ih: false,
        updatedAt: AT,
      },
    ],
  },
  scores: {
    available: true,
    generatedAt: AT,
    source: 'espn',
    attribution: 'ESPN',
    leagues: 1,
    scores: {
      [match.id]: {
        home: 1,
        away: 0,
        state: 'in',
        clock: "54'",
        detail: '2ª parte',
        confidence: 0.92,
      },
    },
  },
  sourcesReport: {
    report: {
      reportId: 'rep_0001',
      id: HASH_C,
      channel: 'DAZN 1',
      matchId: match.id,
      reason: 'stuttering',
      state: 'checking',
      checkReason: '',
      reportedAt: AT,
      lastCheckedAt: null,
      quarantineUntil: '2026-09-23T19:00:00.000Z',
    },
    scan: {
      id: SCAN_ID,
      statusUrl: `/api/v1/football/scans/${SCAN_ID}`,
      total: 1,
      initialCount: 1,
    },
  },
  sourcesOutcome: { hash: statEntry, proveedor: { ...statEntry, intentos: 10, exitos: 8 } },
  sourcesFeedback: {
    feedback: {
      id: HASH_C,
      title: 'Canal equivocado',
      channel: 'DAZN 1',
      channelKey: 'dazn 1',
      verdict: 'incorrect',
      reason: 'wrong_channel',
      corrections: 1,
      updatedAt: AT,
    },
    learningCount: 5,
  },
  search: {
    query: 'dazn',
    results: [
      {
        id: HASH_A,
        title: 'DAZN 1 HD',
        category: 'Busqueda',
        availability: 0.9,
        bitrate: 450000,
        ih: true,
      },
    ],
  },
} satisfies { [K in JsonRouteId]: V1ResponseInput<K> };

// --- Un evento de cada tipo ---

export const EVENT_FIXTURES = {
  'playback.nowPlaying': {
    nowPlaying: { id: HASH_A, title: 'DAZN 1', dev: 'salon', token: 'tok_abc123', at: AT_MS },
    learningCount: 4,
  },
  'playback.sessions': { sessions: [sessionSummary] },
  'playback.handoff': {
    sessionId: SID,
    viewerIds: [VIEWER],
    byDeviceId: DEVICE_ID,
    byClient: 'ios',
    hash: HASH_B,
    title: 'M+ LaLiga',
    reason: 'other_channel',
  },
  'stream.ready': {
    sessionId: SID,
    viewerIds: [VIEWER],
    url: `/ace/r/${HASH_A}/${SID}`,
    protocol: 'mpegts',
  },
  'stream.reopened': {
    sessionId: SID,
    viewerIds: [VIEWER],
    url: `/ace/m/${HASH_A}/${SID}.m3u8`,
    protocol: 'hls',
    reason: 'engine_restart',
  },
  'stream.modeChanged': {
    sessionId: SID,
    viewerIds: [VIEWER],
    from: 'mpegts',
    to: 'hls',
    url: `/ace/m/${HASH_A}/${SID}.m3u8`,
    reason: 'shared',
  },
  'stream.closed': {
    sessionId: SID,
    viewerIds: [VIEWER],
    reason: 'engine_failed',
    code: 'engine_unavailable',
  },
  'stream.stats': {
    sessionId: SID,
    viewerIds: [VIEWER],
    status: 'dl',
    peers: 14,
    speedDown: 820,
    speedUp: 95,
    downloaded: 52428800,
    at: AT,
  },
  'engine.status': engineStatus,
  'scan.progress': {
    jobId: SCAN_ID,
    kind: 'interactive',
    status: 'running',
    total: 2,
    checked: 1,
    playable: 1,
    failed: 0,
    waiting: 0,
    retryAt: null,
    matchId: match.id,
  },
  'scan.verdict': {
    jobId: SCAN_ID,
    hash: HASH_B,
    state: 'working',
    reason: 'playable_media',
    by: 'scanner',
    checkedAt: AT,
    playableOn: { web: true, ios: true },
  },
  'state.changed': { scopes: ['library', 'nowPlaying'], at: AT },
  'diagnostics.new': diagnostic,
  'devices.changed': { reason: 'paired', deviceId: DEVICE_ID },
  resync: { reason: 'buffer_miss' },
} satisfies { [T in SseEventType]: SseEventData<T> };

export const ERROR_FIXTURE: ApiError = {
  error: {
    code: 'engine_unavailable',
    message: 'El motor AceStream no responde. Prueba a reiniciarlo desde Ajustes.',
    requestId: 'req-7f3a9c',
  },
};

/** Todos los ficheros a escribir: ruta relativa a fixtures/ → contenido. */
export function fixtureFiles(): Map<string, unknown> {
  const files = new Map<string, unknown>();
  for (const [id, value] of Object.entries(V1_FIXTURES)) files.set(`v1/${id}.json`, value);
  for (const [type, data] of Object.entries(EVENT_FIXTURES))
    files.set(`events/${type}.json`, { type, data });
  files.set('errors/api-error.json', ERROR_FIXTURE);
  return files;
}

/**
 * JSON formateado con la configuración de prettier del monorepo, para que
 *  no se queje de los ficheros generados. El test
 * compara el contenido ya parseado, así que el formato no le afecta.
 */
export async function toFixtureJson(value: unknown, file: string): Promise<string> {
  const options = (await resolveConfig(file)) ?? {};
  return format(JSON.stringify(value), { ...options, parser: 'json', filepath: file });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const sub of ['v1', 'events', 'errors']) {
    const dir = path.join(FIXTURES_DIR, sub);
    /* Se regenera la carpeta entera: un ejemplo de una ruta borrada no debe quedarse. */
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  for (const [rel, value] of fixtureFiles()) {
    const file = path.join(FIXTURES_DIR, rel);
    writeFileSync(file, await toFixtureJson(value, file));
  }
  console.log(
    `ejemplos escritos en ${FIXTURES_DIR}: ${readdirSync(path.join(FIXTURES_DIR, 'v1')).length} rutas`,
  );
}

/** Para el test: qué rutas no tienen ejemplo porque no responden JSON. */
export const NON_JSON_ROUTE_IDS: readonly V1RouteId[] = ['events', 'video'];
