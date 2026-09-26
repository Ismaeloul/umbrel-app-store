/* Ejemplos válidos de cada respuesta JSON de /api/v1, de cada evento SSE y
   del error v1 (arquitectura §4 y §10.3). Se escriben en fixtures/ como JSON
   para que los tests de decodificación de la app iOS los lean tal cual.

   Están tipados contra los esquemas: si alguien cambia un esquema y no el
   ejemplo, falla el typecheck; y el test fixtures.test.ts comprueba que el
   JSON de disco coincide con esto y que valida con zod.

   Uso: corepack pnpm@10.18.2 --filter @ace/shared fixtures
   Datos inventados: hashes de ejemplo, nombres genéricos y un host
   `umbrel.local`; nada real.

   Carpetas (docs/iptv.md §5.7). La app iOS recorre TODO `v1/` y `events/`
   (FixturesTests exige un tipo Swift por fichero y GeneradosTests un RutaID
   por nombre), así que lo que la app no usa va aparte:
   - `v1/` y `events/`: lo que ve la app (rutas JSON y eventos compartidos).
   - `web/v1/` y `web/events/`: rutas solo web con ejemplo propio
     (`WEB_FIXTURE_ROUTE_IDS`) y eventos de `WEB_ONLY_EVENT_TYPES`.
   - `variantes/`: otras formas de una respuesta (`<ruta>.<caso>.json`), que
     validan con el esquema de la ruta cuyo id va antes del primer punto. */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import type {
  ApiError,
  Device,
  EngineStatus,
  FootballMatch,
  IptvStatus,
  IptvView,
  Item,
  LibraryView,
  Preferences,
  ResolutionCandidate,
  ScanJob,
  SharedEventType,
  SseEventData,
  V1ResponseInput,
  V1RouteId,
  V1Routes,
  WebOnlyEventType,
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

/**
 * Rutas solo web cuyo ejemplo va en `web/v1/` (docs/iptv.md §5.7): las 5 de
 * la IPTV y el buscador IPTV (`iptvChannels`, §14.2; pasa a `v1/` cuando la
 * app calque el buscador, §14.10). `healthLive` y las demás rutas `web` de
 * antes se quedan en `v1/`, donde la app ya las conoce.
 */
export const WEB_FIXTURE_ROUTE_IDS = [
  'iptvGet',
  'iptvSave',
  'iptvUpdate',
  'iptvSync',
  'iptvDelete',
  'iptvChannels',
] as const satisfies readonly JsonRouteId[];
export type WebFixtureRouteId = (typeof WEB_FIXTURE_ROUTE_IDS)[number];
/** Rutas con ejemplo en `v1/`. */
export type AppFixtureRouteId = Exclude<JsonRouteId, WebFixtureRouteId>;

/** Subcarpetas de fixtures/ que escribe este script (se regeneran enteras). */
export const FIXTURE_DIRS = ['v1', 'events', 'errors', 'web', 'variantes'] as const;

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

/* Con escudos, colores y logo (módulo `teams`): la URL lleva la versión del
   fichero (`?v=<etag>`), que es lo que permite la caché inmutable. */
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
  homeTeam: {
    id: '133738',
    name: 'Equipo Local',
    short: 'LOC',
    crest: '/api/v1/football/teams/133738/crest?v=3f2a1b9c5d7e8f01',
    colors: { primary: '#1d3f9a', secondary: '#f2c94c' },
  },
  awayTeam: {
    id: 'k-equipo-visitante',
    name: 'Equipo Visitante',
    short: null,
    crest: null,
    colors: { primary: '#a50044', secondary: null },
  },
  competitionBadge: {
    id: '4335',
    name: 'Spanish La Liga',
    logo: '/api/v1/football/competitions/4335/logo?v=9b8c7d6e5f4a3b21',
  },
};

/* Sin nada del módulo `teams` (equipo desconocido o servicio apagado): el
   cliente pinta el escudo generado y un color derivado del nombre. */
const plainMatch: FootballMatch = {
  id: 'fltv-2026-09-24-1',
  date: '2026-09-24',
  time: '19:00',
  start: AT_MS + 24 * 60 * 60 * 1000,
  title: 'Otro Local - Otro Visitante',
  home: 'Otro Local',
  away: 'Otro Visitante',
  competition: 'Copa del Rey',
  country: 'Spain',
  channels: [{ id: 'm-copa', name: 'M+ Vamos' }],
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

// --- Una respuesta por ruta JSON que ve la app (v1/) ---

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
    days: [
      { date: '2026-09-23', matches: [match] },
      { date: '2026-09-24', matches: [plainMatch] },
    ],
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
} satisfies { [K in AppFixtureRouteId]: V1ResponseInput<K> };

// --- Rutas solo web con ejemplo aparte (web/v1/): Ajustes → IPTV ---

const IPTV_PROVIDER_ID = 'p_Ab3dE5gH';
const IPTV_SYNCED_AT = '2026-09-23T18:30:00.000Z';
const IPTV_GUIDE_AT = '2026-09-23T12:00:00.000Z';

/** Estado de una IPTV Xtream sincronizada, con cuenta y guía («Casa», 812 canales). */
const iptvStatusOk: IptvStatus = {
  status: 'ok',
  channels: 812,
  updatedAt: IPTV_SYNCED_AT,
  error: null,
  staleSince: null,
  account: {
    status: 'active',
    expiresAt: '2026-12-03T00:00:00.000Z',
    maxConnections: 1,
    activeConnections: 0,
    ours: 0,
  },
  guide: { available: true, channelsWithGuide: 640, updatedAt: IPTV_GUIDE_AT, failedAt: null },
};

/* Nunca lleva la URL, el usuario ni la contraseña: solo si están guardados. */
const iptvView: IptvView = {
  provider: {
    kind: 'xtream',
    name: 'Casa',
    enabled: true,
    host: 'proveedor.example:8080',
    origin: 'http://proveedor.example:8080',
    hasUrl: false,
    hasUsername: true,
    hasPassword: true,
    ...iptvStatusOk,
  },
  refreshHours: 6,
};

const iptvSyncing: IptvView = {
  provider: { ...iptvView.provider!, status: 'syncing' },
  refreshHours: 6,
};

/** Id sintético de un canal IPTV (32 hex de HMAC + 8 de etiqueta, docs/iptv.md §4.1). */
const IPTV_ID_GUIDE = 'd4e5f60718293a4b5c6d7e8f9012345601a2b3c4';
const IPTV_ID_NAME = 'e5f60718293a4b5c6d7e8f901234567812ab34cd';
/* Canales del buscador IPTV (§14): «La 1» está en tu biblioteca y en el
   motor; «Telecinco», solo en la IPTV. */
const IPTV_ID_LA1 = 'f60718293a4b5c6d7e8f9012345678ab23cd45ef';
const IPTV_ID_TELECINCO = '0718293a4b5c6d7e8f9012345678abcd34ef5601';

export const WEB_V1_FIXTURES = {
  iptvChannels: {
    query: 'la',
    total: 3,
    capped: false,
    channels: [
      { id: IPTV_ID_LA1, title: 'La 1', quality: 'hd', provider: 'Casa', library: [HASH_C] },
      { id: IPTV_ID_NAME, title: 'DAZN LaLiga', quality: 'fhd', provider: 'Casa', library: [] },
      { id: IPTV_ID_GUIDE, title: 'M+ LaLiga TV 2', quality: 'fhd', provider: 'Casa', library: [] },
    ],
  },
  iptvGet: iptvView,
  iptvSave: iptvSyncing,
  iptvUpdate: {
    provider: { ...iptvView.provider!, enabled: false, status: 'disabled' },
    refreshHours: 6,
  },
  iptvSync: iptvSyncing,
  iptvDelete: { provider: null, refreshHours: 6 },
} satisfies { [K in WebFixtureRouteId]: V1ResponseInput<K> };

// --- Variantes (variantes/<ruta>.<caso>.json) ---

const iptvCandidate = (
  id: string,
  channel: string,
  alias: string | null,
  guide: boolean,
): ResolutionCandidate => ({
  id,
  title: `${channel} --> Casa`,
  alias,
  ih: false,
  source: 'iptv',
  score: 100,
  matchedChannel: channel,
  soloFamilia: false,
  familyFallbackAllowed: false,
  listaId: IPTV_PROVIDER_ID,
  availability: null,
  bitrate: null,
  learned: null,
  reported: null,
  rejectedByLearning: false,
  quarantined: false,
  iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide },
});

/* La guía confirma el partido en «M+ LaLiga TV 2» aunque la agenda diga
   «DAZN LaLiga»: va primera. Luego la IPTV por nombre (un solo cartel, la
   FHD) y detrás las AceStream. El comprobador solo lleva las AceStream. */
const iptvGuideCandidate = iptvCandidate(IPTV_ID_GUIDE, 'M+ LaLiga TV 2', 'MLaLigaTV2.es', true);
const iptvNameCandidate = iptvCandidate(IPTV_ID_NAME, 'DAZN LaLiga', 'DAZNLaLiga.es', false);
/* Canal solo de la IPTV tocado en el buscador (§14.4): su IPTV con puntuación 100. */
const iptvTelecinco: ResolutionCandidate = {
  ...iptvCandidate(IPTV_ID_TELECINCO, 'Telecinco', 'Telecinco.es', false),
  iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false },
};

export const VARIANT_FIXTURES = {
  /* Canal solo de la IPTV con la búsqueda inversa (`engine=1`, §14.4): su IPTV
     primera y detrás dos AceStream del motor que casan ≥ 92. */
  'footballResolve.iptv-canal': {
    status: 'found',
    channels: ['Telecinco'],
    checked: ['iptv', 'saved', 'library', 'acestream'],
    candidate: iptvTelecinco,
    candidates: [
      iptvTelecinco,
      {
        ...candidate,
        id: HASH_C,
        title: 'Telecinco --> NEW ERA',
        ih: true,
        source: 'acestream',
        score: 100,
        matchedChannel: 'Telecinco',
        listaId: null,
        availability: 0.7,
      },
      {
        ...candidate,
        id: HASH_A,
        title: 'Telecinco HD --> ELCANO',
        ih: true,
        source: 'acestream',
        score: 96,
        matchedChannel: 'Telecinco',
        listaId: null,
        availability: 0.9,
      },
    ],
    engineAvailable: true,
    ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
    program: null,
    research: false,
    preheat: null,
    scan: {
      id: SCAN_ID,
      statusUrl: `/api/v1/football/scans/${SCAN_ID}`,
      total: 3,
      initialCount: 3,
    },
  },
  /* Buscar con IPTV activa (§14.3): los resultados del motor que son un canal
     de tu IPTV llevan su id; los demás, no. */
  'search.iptv': {
    query: 'la 1',
    results: [
      {
        id: HASH_A,
        title: 'La 1 HD --> ELCANO',
        category: 'Busqueda',
        availability: 0.9,
        bitrate: 450000,
        ih: true,
        iptv: IPTV_ID_LA1,
      },
      {
        id: HASH_B,
        title: 'La 1 HD --> NEW ERA',
        category: 'Busqueda',
        availability: 0.7,
        bitrate: null,
        ih: true,
        iptv: IPTV_ID_LA1,
      },
      {
        id: HASH_C,
        title: 'La 10 Deportes',
        category: 'Busqueda',
        availability: 0.4,
        bitrate: null,
        ih: true,
      },
    ],
  },
  /* Biblioteca con canales IPTV guardados desde el buscador (§14.6): un
     favorito renombrado y un reciente que ya no está en tu IPTV. */
  'libraryGet.iptv': {
    ...library,
    favorites: [
      ...library.favorites,
      {
        /* Renombrado por Isma: el nombre del canal en la IPTV queda aparte. */
        id: IPTV_ID_TELECINCO,
        title: 'Tele 5',
        type: 'fav',
        category: 'IPTV',
        alias: 'Telecinco',
        date: AT,
        fromWebSync: false,
        ih: false,
      },
    ],
    history: [
      {
        id: IPTV_ID_NAME,
        title: 'DAZN LaLiga',
        type: 'recent',
        category: '',
        date: AT,
        fromWebSync: false,
        ih: false,
      },
      ...library.history,
    ],
    iptvIds: { [IPTV_ID_TELECINCO]: 'ok', [IPTV_ID_NAME]: 'iptv_gone' },
  },
  'footballResolve.iptv': {
    status: 'found',
    channels: ['DAZN LaLiga'],
    checked: ['iptv', 'saved', 'm3u', 'favorites', 'history', 'acestream'],
    candidate: iptvGuideCandidate,
    candidates: [
      iptvGuideCandidate,
      iptvNameCandidate,
      { ...candidate, id: HASH_A, title: 'DAZN LaLiga FHD', matchedChannel: 'DAZN LaLiga' },
      {
        ...candidate,
        id: HASH_C,
        title: 'DAZN LaLiga',
        source: 'acestream',
        score: 92,
        matchedChannel: 'DAZN LaLiga',
        listaId: null,
      },
    ],
    engineAvailable: true,
    ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
    program: null,
    research: false,
    preheat: null,
    scan: {
      id: SCAN_ID,
      statusUrl: `/api/v1/football/scans/${SCAN_ID}`,
      total: 2,
      initialCount: 2,
    },
  },
  'channelStream.iptv': {
    session: streamSession,
    url: `/api/v1/video/${SID}/index.m3u8`,
    protocol: 'hls',
    remux: true,
    codec: { video: 'h264', audio: 'aac', source: 'ffprobe' },
    latency: {
      mode: 'balanced',
      initialBufferS: 6,
      rebuildS: 8,
      liveSync: { targetS: 6, maxS: 14, rate: 1.03 },
    },
    stats: { via: 'sse' },
    handoff: false,
    source: 'iptv',
  },
  /* Varios dispositivos (docs/multidispositivo.md §2.2): el partido de la
     sesión, quién sabe seguir y un visor sin latido desde hace 20 s. */
  'playbackStatus.multi': {
    nowPlaying: { id: HASH_A, title: 'DAZN 1', dev: 'salon', token: 'tok_abc123', at: AT_MS },
    learningCount: 4,
    serverTime: AT_MS,
    sessions: [
      {
        ...sessionSummary,
        viewers: [
          { ...sessionSummary.viewers[0]!, follows: true },
          { ...sessionSummary.viewers[1]!, away: true },
        ],
        matchId: match.id,
      },
    ],
  },
} satisfies {
  'footballResolve.iptv-canal': V1ResponseInput<'footballResolve'>;
  'search.iptv': V1ResponseInput<'search'>;
  'libraryGet.iptv': V1ResponseInput<'libraryGet'>;
  'footballResolve.iptv': V1ResponseInput<'footballResolve'>;
  'channelStream.iptv': V1ResponseInput<'channelStream'>;
  'playbackStatus.multi': V1ResponseInput<'playbackStatus'>;
};

/**
 * Variantes de eventos (`variantes/<tipo>.<caso>.json`, con `{ type, data }`
 * como los de events/): validan con el esquema SSE del tipo.
 */
export const EVENT_VARIANT_FIXTURES = {
  /* «Cambiar en los dos»: el visor debe pasar solo al canal nuevo (§2.4.3). */
  'playback.handoff.follow': {
    type: 'playback.handoff',
    data: {
      sessionId: SID,
      viewerIds: [VIEWER],
      byDeviceId: DEVICE_ID,
      byClient: 'ios',
      hash: HASH_B,
      title: 'M+ LaLiga',
      reason: 'other_channel',
      byDeviceName: 'iPhone de Isma',
      follow: true,
      matchId: match.id,
    },
  },
} satisfies {
  [name: string]: { type: 'playback.handoff'; data: SseEventData<'playback.handoff'> };
};

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
} satisfies { [T in SharedEventType]: SseEventData<T> };

/** Eventos solo web (web/events/): no llegan nunca a /native. */
export const WEB_EVENT_FIXTURES = {
  'iptv.status': iptvStatusOk,
} satisfies { [T in WebOnlyEventType]: SseEventData<T> };

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
  for (const [id, value] of Object.entries(WEB_V1_FIXTURES)) files.set(`web/v1/${id}.json`, value);
  for (const [type, data] of Object.entries(WEB_EVENT_FIXTURES))
    files.set(`web/events/${type}.json`, { type, data });
  for (const [name, value] of Object.entries(VARIANT_FIXTURES))
    files.set(`variantes/${name}.json`, value);
  for (const [name, value] of Object.entries(EVENT_VARIANT_FIXTURES))
    files.set(`variantes/${name}.json`, value);
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
  for (const sub of FIXTURE_DIRS) {
    /* Se regenera la carpeta entera: un ejemplo de una ruta borrada no debe quedarse. */
    rmSync(path.join(FIXTURES_DIR, sub), { recursive: true, force: true });
  }
  for (const [rel, value] of fixtureFiles()) {
    const file = path.join(FIXTURES_DIR, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await toFixtureJson(value, file));
  }
  console.log(
    `ejemplos escritos en ${FIXTURES_DIR}: ${readdirSync(path.join(FIXTURES_DIR, 'v1')).length} rutas`,
  );
}

/** Para el test: qué rutas no tienen ejemplo porque no responden JSON (SSE, vídeo y PNG). */
export const NON_JSON_ROUTE_IDS: readonly V1RouteId[] = [
  'events',
  'video',
  'footballTeamCrest',
  'footballCompetitionLogo',
];
