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
import {
  demoGuide,
  demoGuideNow,
  demoGuideProgramme,
  demoGuideProgrammes,
} from '../src/demo/guide.js';
import type {
  ApiError,
  BackupCounts,
  BackupFile,
  IptvVodStatus,
  VodCard,
  VodGrant,
  VodHome,
  VodMovie,
  VodSeries,
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
 * la IPTV, el buscador IPTV (`iptvChannels`, §14.2; pasa a `v1/` cuando la
 * app calque el buscador, §14.10) y la pestaña IPTV de Canales
 * (`iptvBrowse`, §16.2; ídem, §16.11) y las 4 rutas JSON de Películas y
 * series (docs/vod.md §11.6; pasan a `v1/` cuando la app copie la pantalla,
 * §17). `healthLive` y las demás rutas `web` de antes se quedan en `v1/`,
 * donde la app ya las conoce.
 */
export const WEB_FIXTURE_ROUTE_IDS = [
  'iptvGet',
  'iptvSave',
  'iptvUpdate',
  'iptvSync',
  'iptvDelete',
  'iptvChannels',
  'iptvBrowse',
  /* La copia de seguridad (decisiones.md D25): solo web, la app no la usa. */
  'backupExport',
  'backupExportSecret',
  'backupImport',
  'vodHome',
  'vodBrowse',
  'vodTitle',
  'vodStream',
  /* «Descargar fallos» de Salud (0.9.0): solo web, lleva el registro del servidor. */
  'diagnosticsExport',
  /* Guía TV (docs/iptv.md §20.6): solo web hasta que la app copie la pantalla. */
  'iptvGuide',
  'iptvGuideProgrammes',
  'iptvGuideProgramme',
  'iptvGuideNow',
  'vodLanguagesGet',
  'vodLanguagesUpdate',
  /* «Descargar logs» de Ajustes → Registro (0.9.0): solo web (el zip es binario y no lleva ejemplo). */
  'diagnosticsLogInfo',
  'diagnosticsWebLog',
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
    settings: { sameChannelPolicy: 'share', instantStart: true },
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
  settingsGet: {
    settings: { sameChannelPolicy: 'share', instantStart: true },
    source: 'environment',
  },
  settingsUpdate: {
    settings: { sameChannelPolicy: 'handoff', instantStart: true },
    source: 'saved',
  },
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

/* Pestaña IPTV de Canales (§16): categorías como las de un panel real, en su
   orden, y facetas con sus recuentos. Ids de categoría de 12 hex. */
const CAT_DEPORTES = '3f2a9c1b7d40';
const CAT_DAZN = '8e1d0a6b2c93';
const CAT_LALIGA = 'c45b7e20f1a8';
const CAT_GENERALISTAS = '0b9f4d3e6a21';
const CAT_UK = '5a7c2e9d0f16';
const IPTV_ID_DAZN_F1 = '18293a4b5c6d7e8f9012345678abcdef45f60712';
const IPTV_ID_DAZN_1 = '293a4b5c6d7e8f9012345678abcdef0156071823';
const IPTV_ID_ACB_1 = '3a4b5c6d7e8f9012345678abcdef012367182934';

const iptvBrowseRoot: V1ResponseInput<'iptvBrowse'> = {
  active: true,
  provider: 'Casa',
  catalog: 'mfz3k1a01',
  query: '',
  category: null,
  total: 812,
  catalogTotal: 812,
  categories: [
    { id: CAT_DEPORTES, name: 'ES | DEPORTES', count: 164 },
    { id: CAT_DAZN, name: 'ES | DAZN', count: 12 },
    { id: CAT_LALIGA, name: 'ES | LALIGA', count: 11 },
    { id: CAT_GENERALISTAS, name: 'ES | GENERALISTAS', count: 58 },
    { id: CAT_UK, name: 'UK | SPORTS', count: 96 },
    { id: 'none', name: '', count: 3 },
  ],
  facets: {
    country: [
      { value: 'ES', count: 590, selected: false },
      { value: 'UK', count: 142, selected: false },
      { value: 'LAT', count: 41, selected: false },
      { value: 'none', count: 39, selected: false },
    ],
    language: [
      { value: 'es', count: 631, selected: false },
      { value: 'en', count: 150, selected: false },
      { value: 'ca', count: 6, selected: false },
      { value: 'none', count: 25, selected: false },
    ],
    type: [
      { value: 'deportes', count: 402, selected: false },
      { value: 'generalistas', count: 88, selected: false },
      { value: 'cine', count: 61, selected: false },
      { value: 'adultos', count: 12, selected: false },
      { value: 'none', count: 190, selected: false },
    ],
    sport: [
      { value: 'futbol', count: 118, selected: false },
      { value: 'baloncesto', count: 14, selected: false },
      { value: 'f1', count: 4, selected: false },
    ],
    quality: [
      { value: 'uhd', count: 9, selected: false },
      { value: 'fhd', count: 310, selected: false },
      { value: 'hd', count: 402, selected: false },
      { value: 'none', count: 120, selected: false },
    ],
  },
  channels: [],
  nextCursor: null,
  stale: false,
};

// --- Películas y series (docs/vod.md §11.6): solo web, en web/v1/ ---

/* Ids sellados de 40 hex (32 de AES + la etiqueta IPTV de 8, §5.1). */
const VOD_ID_DUNE = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';
const VOD_ID_DUNE_2 = '23456789abcdef0123456789abcdef0115263748';
const VOD_ID_OPPENHEIMER = '5c6d7e8f9012345678abcdef01234567a8b9c0d1';
const VOD_ID_AMELIE = '6d7e8f9012345678abcdef0123456789b9c0d1e2';
const VOD_ID_OFFICE = '7e8f9012345678abcdef0123456789abc0d1e2f3';
const VOD_ID_OFFICE_S2E5 = '8f9012345678abcdef0123456789abcdd1e2f304';
const VOD_ID_OFFICE_S2E6 = '9012345678abcdef0123456789abcdefe2f30415';
const VOD_ID_OFFICE_S1E1 = '012345678abcdef0123456789abcdef0f3041526';
const VOD_ID_DARK = '12345678abcdef0123456789abcdef0104152637';
/* Categorías del proveedor (12 hex, distintas de las del directo, §5.4). */
const VOD_CAT_ESTRENOS = '9a1b2c3d4e5f';
const VOD_CAT_4K = 'a1b2c3d4e5f6';
const VOD_CAT_VOSE = 'b2c3d4e5f607';
const VOD_CAT_ADULTOS = 'c3d4e5f60718';
const VOD_CAT_SERIES_ES = 'd4e5f6071829';
const VOD_CAT_SERIES_VOSE = 'e5f60718293a';
const VOD_BUILT_AT = '2026-09-23T04:10:00.000Z';

const vodCard = (
  id: string,
  kind: VodCard['kind'],
  title: string,
  year: number | null,
  extra: Partial<VodCard> = {},
): VodCard => ({
  id,
  kind,
  title,
  year,
  rating: 7.8,
  poster: 'c0ffee42',
  tags: [],
  adult: false,
  progress: null,
  ...extra,
});

const vodDune = vodCard(VOD_ID_DUNE, 'movie', 'Dune', 2021, {
  rating: 8,
  poster: '3fa9c210',
  tags: ['castellano', '4k'],
  progress: 0.28,
  langs: ['castellano'],
});
const vodOppenheimer = vodCard(VOD_ID_OPPENHEIMER, 'movie', 'Oppenheimer', 2023, {
  rating: 8.3,
  poster: '5d0e7b44',
  tags: ['castellano', '4k'],
  langs: ['castellano'],
});
const vodAmelie = vodCard(VOD_ID_AMELIE, 'movie', 'Amélie', 2001, {
  rating: 7.9,
  poster: null,
  tags: ['vose'],
  langs: ['vose'],
});
const vodOffice = vodCard(VOD_ID_OFFICE, 'series', 'The Office', 2005, {
  rating: 8.6,
  poster: '71bc0a93',
  tags: ['castellano', 'multi'],
  /* MULTI con las dos lenguas nombradas («ES/EN | MULTI»). */
  langs: ['castellano', 'ingles'],
});
const vodDark = vodCard(VOD_ID_DARK, 'series', 'Dark', 2017, {
  rating: 8.7,
  poster: '0e9d2a61',
  tags: ['castellano'],
  langs: ['castellano'],
});

const vodCategories: VodHome['categories'] = {
  movie: [
    { id: VOD_CAT_ESTRENOS, kind: 'movie', name: 'ES | ESTRENOS', count: 1_240, adult: false },
    { id: VOD_CAT_4K, kind: 'movie', name: 'VOD | 4K', count: 612, adult: false },
    { id: VOD_CAT_VOSE, kind: 'movie', name: 'VOSE', count: 3_025, adult: false },
    /* Las de adultos, al final (D-VOD7). */
    { id: VOD_CAT_ADULTOS, kind: 'movie', name: 'XXX | ADULTOS', count: 410, adult: true },
  ],
  series: [
    { id: VOD_CAT_SERIES_ES, kind: 'series', name: 'SERIES | ES', count: 2_310, adult: false },
    { id: VOD_CAT_SERIES_VOSE, kind: 'series', name: 'SERIES | VOSE', count: 1_190, adult: false },
  ],
};

const vodHomeReady: VodHome = {
  active: true,
  state: 'ready',
  counts: { movies: 48_213, series: 6_904 },
  builtAt: VOD_BUILT_AT,
  truncated: false,
  stale: false,
  continue: [
    {
      id: VOD_ID_DUNE,
      kind: 'movie',
      seriesId: null,
      title: 'Dune',
      subtitle: null,
      posS: 2_592,
      durS: 9_360,
      isNext: false,
      art: { id: VOD_ID_DUNE, art: 'backdrop', v: '8a7f3e21' },
      updatedAt: '2026-09-23T21:40:00.000Z',
    },
    {
      /* El último visto de The Office tiene siguiente: sale ese, desde el principio. */
      id: VOD_ID_OFFICE_S2E6,
      kind: 'episode',
      seriesId: VOD_ID_OFFICE,
      title: 'The Office',
      subtitle: 'T2 · E6 · La pelea',
      posS: 0,
      durS: 1_320,
      isNext: true,
      art: { id: VOD_ID_OFFICE_S2E6, art: 'still', v: '2b6c9d10' },
      updatedAt: '2026-09-22T22:15:00.000Z',
    },
  ],
  newMovies: [vodOppenheimer, vodDune, vodAmelie],
  updatedSeries: [vodOffice, vodDark],
  categories: vodCategories,
  tags: {
    movie: [
      { tag: 'castellano', count: 21_480 },
      { tag: 'latino', count: 9_310 },
      { tag: 'vose', count: 3_025 },
      { tag: 'multi', count: 1_870 },
      { tag: '4k', count: 612 },
    ],
    series: [
      { tag: 'castellano', count: 3_402 },
      { tag: 'vose', count: 1_190 },
      { tag: 'multi', count: 244 },
    ],
  },
  /* Todo el catálogo por idioma (§4.10), para el selector. */
  langs: {
    movie: [
      { lang: 'castellano', count: 21_480 },
      { lang: 'latino', count: 9_310 },
      { lang: 'vose', count: 3_025 },
      { lang: 'ingles', count: 5_102 },
      { lang: 'frances', count: 1_204 },
      { lang: 'otros', count: 388 },
    ],
    series: [
      { lang: 'castellano', count: 3_402 },
      { lang: 'latino', count: 870 },
      { lang: 'vose', count: 1_190 },
      { lang: 'ingles', count: 412 },
    ],
  },
  noLang: { movies: 7_704, series: 1_030 },
  /* Sin filtro de idiomas (`langs` en la consulta), igual que `counts`. */
  shown: { movies: 48_213, series: 6_904 },
};

/** Portada sin nada: el proveedor no tiene VOD, y la base de las demás variantes de estado. */
const vodHomeEmpty: VodHome = {
  active: true,
  state: 'none',
  counts: { movies: 0, series: 0 },
  builtAt: null,
  truncated: false,
  stale: false,
  continue: [],
  newMovies: [],
  updatedSeries: [],
  categories: { movie: [], series: [] },
  tags: { movie: [], series: [] },
};

const vodDuneTitle: VodMovie = {
  kind: 'movie',
  id: VOD_ID_DUNE,
  info: 'ok',
  title: 'Dune',
  originalTitle: 'Dune',
  year: 2021,
  plot: 'Paul Atreides, un joven brillante marcado por un destino que no comprende, viaja al planeta más peligroso del universo para asegurar el futuro de su familia y de su pueblo.',
  genres: ['Ciencia ficción', 'Aventura'],
  cast: ['Timothée Chalamet', 'Rebecca Ferguson', 'Oscar Isaac', 'Zendaya'],
  director: 'Denis Villeneuve',
  country: 'Estados Unidos',
  ageRating: '12',
  rating: 8,
  durationS: 9_360,
  poster: '3fa9c210',
  backdrop: '8a7f3e21',
  tags: ['castellano', '4k'],
  adult: false,
  tech: {
    container: 'mkv',
    video: '2160p · H.264',
    audio: ['AC-3 5.1 · Castellano', 'E-AC-3 5.1 · Inglés'],
  },
  playable: 'yes',
  progress: { posS: 2_592, durS: 9_360, watched: false },
  category: { id: VOD_CAT_4K, name: 'VOD | 4K' },
  releaseDate: '2021-09-15',
  trailer: 'Dune2021Tra',
};

const vodOfficeTitle: VodSeries = {
  kind: 'series',
  id: VOD_ID_OFFICE,
  info: 'ok',
  title: 'The Office',
  year: 2005,
  plot: 'El día a día de los empleados de una sucursal de una empresa de papel en Scranton, contado como un documental.',
  genres: ['Comedia'],
  cast: ['Steve Carell', 'Rainn Wilson', 'John Krasinski', 'Jenna Fischer'],
  director: 'Greg Daniels',
  country: 'Estados Unidos',
  rating: 8.6,
  poster: '71bc0a93',
  backdrop: '4e2d8f07',
  tags: ['castellano', 'multi'],
  adult: false,
  category: { id: VOD_CAT_SERIES_ES, name: 'SERIES | ES' },
  seasons: [
    {
      n: 1,
      name: 'Temporada 1',
      episodes: [
        {
          id: VOD_ID_OFFICE_S1E1,
          n: 1,
          title: 'Piloto',
          plot: 'Un equipo de documentales llega a la oficina de Dunder Mifflin en Scranton.',
          durationS: 1_380,
          still: '6a1f0c38',
          playable: 'yes',
          progress: { posS: 1_380, durS: 1_380, watched: true },
          container: 'mkv',
          airDate: '2005-03-24',
          rating: 7.4,
        },
      ],
      plot: 'Michael Scott dirige la sucursal de Scranton mientras le graba un equipo de documentales.',
      airDate: '2005-03-24',
    },
    {
      n: 2,
      name: 'Temporada 2',
      episodes: [
        {
          id: VOD_ID_OFFICE_S2E5,
          n: 5,
          title: 'Halloween',
          plot: null,
          durationS: 1_320,
          still: null,
          playable: 'yes',
          progress: { posS: 1_300, durS: 1_320, watched: true },
          container: 'mp4',
        },
        {
          id: VOD_ID_OFFICE_S2E6,
          n: 6,
          title: 'La pelea',
          plot: 'Michael y Dwight se enfrentan en el dojo.',
          durationS: 1_320,
          still: '2b6c9d10',
          /* Sin `container`: el servidor todavía no sabe el formato. */
          playable: 'unknown',
          progress: null,
        },
      ],
    },
  ],
  main: { episodeId: VOD_ID_OFFICE_S2E6, action: 'next', label: 'Siguiente: T2:E6', posS: 0 },
  truncated: false,
  originalTitle: 'The Office (US)',
  ageRating: '12',
  releaseDate: '2005-03-24',
  trailer: null,
  episodeDurationS: 1_320,
};

const vodDuneGrant: VodGrant = {
  session: streamSession,
  url: `/api/v1/video/${SID}/index.m3u8`,
  protocol: 'hls',
  remux: true,
  codec: { video: 'h264', audio: 'aac', source: 'ffprobe' },
  latency: { mode: 'balanced', initialBufferS: 6, rebuildS: 8, liveSync: null },
  stats: { via: 'sse' },
  handoff: false,
  source: 'iptv',
  vod: {
    id: VOD_ID_DUNE,
    kind: 'movie',
    seriesId: null,
    title: 'Dune',
    subtitle: null,
    durationS: 9_360,
    startS: 2_587,
    resumed: true,
    audio: [
      {
        index: 0,
        label: 'Castellano 5.1',
        lang: 'spa',
        codec: 'ac3',
        channels: 6,
        converted: true,
      },
      { index: 1, label: 'Inglés 5.1', lang: 'eng', codec: 'eac3', channels: 6, converted: true },
    ],
    audioIndex: 0,
    video: { codec: 'h264', codecs: 'avc1.640033', width: 3840, height: 1600 },
    next: null,
    poster: '3fa9c210',
  },
};

/** El resumen VOD de `iptv.status` (docs/vod.md §11.4). */
const iptvVodStatus: IptvVodStatus = {
  state: 'ready',
  movies: 48_213,
  series: 6_904,
  builtAt: VOD_BUILT_AT,
  truncated: false,
  skipped: 3,
  stale: false,
};

/* Copia de seguridad (decisiones.md D25): datos inventados, sin secretos.
   La IPTV de la copia normal va sin contraseña; la protegida lleva el bloque
   cifrado (aquí de forma, no se puede abrir con ninguna clave). */
const backupFile: BackupFile = {
  format: 'ace-player-neo-copia',
  schemaVersion: 1,
  appVersion: '0.8.4',
  createdAt: AT,
  library: {
    favorites: [item(HASH_A, 'DAZN 1', 'fav'), { ...item(IPTV_ID_LA1, 'La 1', 'fav'), iptv: true }],
    history: [item(HASH_C, 'Canal de prueba', 'recent')],
  },
  directories: {
    sources: [
      {
        id: 'principal',
        name: 'Principal',
        url: 'https://example.com/lista.m3u',
        type: 'm3u',
        streams: [item(HASH_A, 'DAZN 1', 'web'), item(HASH_B, 'M+ LaLiga', 'web')],
        renames: {},
        hidden: [],
        syncedAt: AT,
        lastErrorAt: null,
        lastError: null,
      },
    ],
    activeId: 'principal',
  },
  preferences,
  channelBindings: [],
  channelFeedback: [],
  settings: { sameChannelPolicy: 'share' },
  iptv: {
    kind: 'xtream',
    name: 'Casa',
    enabled: true,
    host: 'proveedor.example:8080',
    server: 'http://proveedor.example:8080',
    secret: null,
  },
  browser: { theme: 'oscuro', transparency: 'normal', playbackMode: 'balanced' },
  vod: { langs: ['castellano', 'frances'], unknown: true },
};

const backupCounts = (favorites: number, history: number): BackupCounts => ({
  favorites,
  history,
  directories: 1,
  channels: 2,
  channelBindings: 0,
  channelFeedback: 0,
});

/* Guía TV (docs/iptv.md §20.6 y §20.8): salen de la guía de ejemplo
   (src/demo/guide.ts) a la hora de los ejemplos, así que dicen lo mismo que
   la demo de la web. Un trozo de 3 h de los dos primeros favoritos y la
   ficha de lo que echa uno de ellos a esa hora. */
const guideFavorites = demoGuide({ scope: 'favorites' }, AT_MS);
const guideSliceFrom = AT_MS - 30 * 60_000;
const guideSlice = demoGuideProgrammes(
  {
    v: guideFavorites.version,
    ch: guideFavorites.channels
      .slice(2, 4)
      .map((channel) => channel.guide)
      .join(','),
    from: guideSliceFrom,
    to: guideSliceFrom + 3 * 3_600_000,
  },
  AT_MS,
);
const guideOnAir = guideSlice.channels
  .flatMap((channel) => channel.programmes)
  .find((item) => item.start <= AT_MS && item.end > AT_MS);
const guideDetail = demoGuideProgramme(guideOnAir?.id ?? '', { v: guideFavorites.version }, AT_MS);
const guideNow = demoGuideNow(
  {
    ids: guideFavorites.channels
      .slice(0, 3)
      .map((channel) => channel.id)
      .join(','),
  },
  AT_MS,
);

export const WEB_V1_FIXTURES = {
  iptvGuide: guideFavorites,
  iptvGuideProgrammes: guideSlice,
  iptvGuideProgramme: guideDetail,
  iptvGuideNow: guideNow,
  backupExport: backupFile,
  backupExportSecret: {
    ...backupFile,
    iptv: {
      ...backupFile.iptv!,
      secret: {
        kdf: 'scrypt',
        n: 32768,
        r: 8,
        p: 1,
        salt: 'AAECAwQFBgcICQoLDA0ODw',
        alg: 'A256GCM',
        iv: 'AAECAwQFBgcICQoL',
        tag: 'AAECAwQFBgcICQoLDA0ODw',
        data: 'ZWplbXBsby1zaW4tc2VudGlkbw',
      },
    },
  },
  backupImport: {
    applied: false,
    mode: 'replace',
    source: { appVersion: '0.8.4', createdAt: AT, schemaVersion: 1 },
    current: backupCounts(1, 1),
    incoming: backupCounts(2, 1),
    result: backupCounts(2, 1),
    preferences: true,
    settings: false,
    vodLanguages: true,
    iptv: {
      action: 'needs_secret',
      protected: false,
      kind: 'xtream',
      name: 'Casa',
      host: 'proveedor.example:8080',
      server: 'http://proveedor.example:8080',
      relinkItems: 1,
    },
    browser: { theme: 'oscuro', transparency: 'normal', playbackMode: 'balanced' },
  },
  vodHome: vodHomeReady,
  vodBrowse: {
    active: true,
    state: 'ready',
    items: [vodOppenheimer, vodDune],
    total: 612,
    capped: false,
    otherKindTotal: null,
    tags: [
      { tag: 'castellano', count: 540 },
      { tag: 'latino', count: 61 },
      { tag: '4k', count: 612 },
    ],
    nextCursor: 'djEuMTc1ODU5OS42MA',
    stale: false,
    otherLangs: null,
  },
  vodTitle: vodDuneTitle,
  vodStream: vodDuneGrant,
  /* Elegidos: castellano y francés, y también los que no lo dicen. */
  vodLanguagesGet: {
    chosen: true,
    langs: ['castellano', 'frances'],
    unknown: true,
    updatedAt: '2026-10-03T17:20:00.000Z',
  },
  vodLanguagesUpdate: {
    chosen: true,
    langs: ['castellano', 'frances'],
    unknown: true,
    updatedAt: '2026-10-03T17:20:00.000Z',
  },
  iptvBrowse: iptvBrowseRoot,
  iptvChannels: {
    query: 'la',
    total: 3,
    capped: false,
    /* Una fila por canal con sus calidades (§17): «DAZN LaLiga» tiene 4K, 1080p y 720p y arranca por la 1080p. */
    channels: [
      {
        id: IPTV_ID_LA1,
        title: 'La 1',
        quality: 'hd',
        qualities: ['hd'],
        country: null,
        provider: 'Casa',
        library: [HASH_C],
      },
      {
        id: IPTV_ID_NAME,
        title: 'DAZN LaLiga',
        quality: 'fhd',
        qualities: ['uhd', 'fhd', 'hd'],
        country: null,
        provider: 'Casa',
        library: [],
      },
      {
        id: IPTV_ID_GUIDE,
        title: 'M+ LaLiga TV 2',
        quality: 'fhd',
        qualities: ['fhd'],
        country: null,
        provider: 'Casa',
        library: [],
      },
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
  /* Un fichero de «Descargar fallos» ya redactado: un corte del relé (nuestro)
     y una fuente sin pares (de fuera), con lo que vio la web. */
  diagnosticsExport: {
    format: 'ace-player-neo-fallos',
    formatVersion: 1,
    createdAt: AT,
    appVersion: '0.9.0',
    summary: {
      nuestro: 1,
      deFuera: 1,
      sinClasificar: 0,
      byPiece: [
        { piece: 'fuente', side: 'de_fuera', count: 1 },
        { piece: 'rele', side: 'nuestro', count: 1 },
      ],
      lines: ['Nuestro: 1 fallo (relé de la IPTV 1).', 'De fuera: 1 fallo (fuentes que no van 1).'],
    },
    environment: {
      node: 'v24.15.0',
      platform: 'linux',
      arch: 'x64',
      uptimeSeconds: 5400,
      memoryMb: 182,
      logLevel: 'info',
      scanner: true,
      autoSync: true,
      allowPrivateUrls: false,
      footballDemoOnly: false,
      teams: true,
      ai: false,
      seedSource: 'ACE_SEED',
      serverLog: true,
    },
    status: {
      health: V1_FIXTURES.health,
      iptv: { kind: 'xtream', enabled: true, ...iptvStatusOk, connections: 1 },
      remux: { sessions: 1, max: 4, ffmpegMissing: false },
    },
    faults: [
      {
        at: AT,
        side: 'nuestro',
        piece: 'rele',
        from: 'servidor',
        level: 'warn',
        code: 'iptv_dropped',
        message: 'IPTV: la salida no avanza; se reconecta el relé',
      },
      {
        at: AT,
        side: 'de_fuera',
        piece: 'fuente',
        from: 'servidor',
        level: 'error',
        code: 'source_no_peers',
        message: 'La fuente no tiene pares.',
        channel: 'DAZN 1',
        source: HASH_A,
      },
    ],
    serverLog: [
      {
        time: AT,
        level: 'warn',
        module: 'playback',
        sessionId: SID,
        msg: 'IPTV: la salida no avanza; se reconecta el relé',
      },
      {
        time: AT,
        level: 'info',
        module: 'iptv',
        url: 'http://proveedor.example:8080/live/•••/•••/1234.ts',
        msg: 'IPTV: abierta',
      },
    ],
    web: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
      viewport: '1440x900@1',
      layout: 'wide',
      mode: 'live',
      view: 'partido/fltv-2026-09-23-3',
      online: true,
      installed: false,
      uptimeSeconds: 1800,
      log: [
        {
          at: AT,
          kind: 'player',
          level: 'warn',
          code: 'source_no_peers',
          message: 'La fuente no tiene pares.',
          view: 'partido/fltv-2026-09-23-3',
        },
      ],
    },
    redaction: {
      note: 'Sin contraseñas, usuarios, tokens, cookies, URLs con credenciales ni IPs públicas.',
      replaced: 1,
    },
  },
  /* 12 días guardados en el disco del Umbrel (los cerrados, comprimidos). */
  diagnosticsLogInfo: {
    enabled: true,
    since: '2026-09-11T08:02:11.000Z',
    days: 12,
    bytes: 1_468_006,
    maxBytes: 40 * 1024 * 1024,
    maxDays: 45,
  },
  /* Una tanda de 3 errores de la web: 2 guardados y el fallo del reproductor que ya llegó con su canal. */
  diagnosticsWebLog: { accepted: 2, dropped: 1 },
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
   «DAZN LaLiga»: va primera. Luego la IPTV por nombre, un cartel por
   variante de resolución (1080p y 720p, §17), y detrás las AceStream. El
   comprobador solo lleva las AceStream. */
const iptvGuideCandidate = iptvCandidate(IPTV_ID_GUIDE, 'M+ LaLiga TV 2', 'MLaLigaTV2.es', true);
const iptvNameCandidate = iptvCandidate(IPTV_ID_NAME, 'DAZN LaLiga', 'DAZNLaLiga.es', false);
const IPTV_ID_NAME_HD = '18293a4b5c6d7e8f9012345678abcdef45f06712';
const iptvNameHdCandidate: ResolutionCandidate = {
  ...iptvCandidate(IPTV_ID_NAME_HD, 'DAZN LaLiga', 'DAZNLaLiga.es', false),
  iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false },
};
/* Canal solo de la IPTV tocado en el buscador (§14.4): su IPTV con puntuación 100. */
const iptvTelecinco: ResolutionCandidate = {
  ...iptvCandidate(IPTV_ID_TELECINCO, 'Telecinco', 'Telecinco.es', false),
  iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false },
};

export const VARIANT_FIXTURES = {
  /* Guía TV (docs/iptv.md §20.6): «Todos» (una página corta) y los estados sin parrilla. */
  'iptvGuide.todos': demoGuide({ scope: 'all', limit: 6 }, AT_MS),
  /* Una guía que solo cubre hoy, como la del panel de Isma (Paso 0): coveredTo acaba hoy. */
  'iptvGuide.solo-hoy': demoGuide({ scope: 'all', limit: 6 }, AT_MS, { onlyToday: true }),
  'iptvGuide.inactiva': {
    ...guideFavorites,
    state: 'inactive',
    version: '',
    provider: '',
    from: null,
    to: null,
    coveredFrom: null,
    coveredTo: null,
    updatedAt: null,
    scope: 'favorites',
    favorites: 0,
    all: 0,
    total: 0,
    channels: [],
  },
  'iptvGuide.preparando': {
    ...guideFavorites,
    state: 'preparing',
    version: '',
    from: null,
    to: null,
    coveredFrom: null,
    coveredTo: null,
    updatedAt: null,
    favorites: 0,
    all: 0,
    total: 0,
    channels: [],
  },
  'iptvGuideNow.sin-guia': { available: false, version: '', items: [] },
  /* Películas y series (docs/vod.md §11.6 y §13): los estados de la portada. */
  'vodHome.preparing': { ...vodHomeEmpty, state: 'preparing' },
  'vodHome.none': vodHomeEmpty,
  'vodHome.unsupported': { ...vodHomeEmpty, state: 'unsupported' },
  /* «dune» en películas: dos aciertos y una serie en el otro tipo («Ver 1 serie»). */
  'vodBrowse.search': {
    active: true,
    state: 'ready',
    items: [
      vodDune,
      vodCard(VOD_ID_DUNE_2, 'movie', 'Dune: Parte dos', 2024, {
        rating: 8.5,
        poster: '9c3e1f52',
        tags: ['latino'],
      }),
    ],
    total: 2,
    capped: false,
    otherKindTotal: 1,
    tags: [
      { tag: 'castellano', count: 1 },
      { tag: 'latino', count: 1 },
      { tag: '4k', count: 1 },
    ],
    nextCursor: null,
    stale: false,
    otherLangs: null,
  },
  /* «coco» con castellano elegido: nada en castellano, pero 3 en latino y 1 en VOSE («3 en latino · Ver»). */
  'vodBrowse.otros-idiomas': {
    active: true,
    state: 'ready',
    items: [],
    total: 0,
    capped: false,
    otherKindTotal: 0,
    tags: [],
    nextCursor: null,
    stale: false,
    otherLangs: {
      total: 4,
      langs: [
        { lang: 'latino', count: 3 },
        { lang: 'vose', count: 1 },
      ],
      unknown: 0,
    },
  },
  /* La primera vez: aún sin elegir (la web enseña el selector). */
  'vodLanguagesGet.sin-elegir': {
    chosen: false,
    langs: [],
    unknown: true,
    updatedAt: null,
  },
  'vodBrowse.vacio': {
    active: true,
    state: 'ready',
    items: [],
    total: 0,
    capped: false,
    otherKindTotal: null,
    tags: [],
    nextCursor: null,
    stale: false,
  },
  'vodTitle.series': vodOfficeTitle,
  /* Un episodio en un formato que no se puede reproducir aquí: `container`
     dice cuál, para que la web lo nombre en vez de «desconocido». */
  'vodTitle.episodio-avi': {
    ...vodOfficeTitle,
    seasons: vodOfficeTitle.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) =>
        episode.id === VOD_ID_OFFICE_S2E6
          ? { ...episode, playable: 'no' as const, container: 'avi' }
          : episode,
      ),
    })),
  },
  /* «Sin indicar» por el proveedor: el servidor está leyendo el fichero (§4.11). */
  'vodTitle.audio-comprobando': { ...vodDuneTitle, langs: [], audioPending: true },
  /* Lo que dice el fichero: audio en inglés y subtítulos en español (§4.11). */
  'vodTitle.audio-del-fichero': {
    ...vodDuneTitle,
    langs: ['vose', 'ingles'],
    detectedAudio: { audio: ['Inglés'], subtitles: ['Español'] },
  },
  /* El proveedor no dio la ficha: lo que se sabe por la lista, y «Reproducir» sigue (§7.3). */
  'vodTitle.info-failed': {
    ...vodDuneTitle,
    info: 'failed',
    originalTitle: null,
    plot: null,
    genres: [],
    cast: [],
    director: null,
    country: null,
    ageRating: null,
    durationS: null,
    backdrop: null,
    tech: { container: 'mkv', video: null, audio: [] },
    playable: 'unknown',
    releaseDate: null,
    trailer: null,
  },
  /* HEVC copiado con `hvc1` (hevc=1: el cliente lo decodifica, §9.11). */
  'vodStream.hevc': {
    ...vodDuneGrant,
    codec: { video: 'hevc', audio: 'aac', source: 'ffprobe' },
    vod: {
      ...vodDuneGrant.vod,
      id: VOD_ID_OPPENHEIMER,
      title: 'Oppenheimer',
      durationS: 10_860,
      startS: 0,
      resumed: false,
      audio: [
        { index: 0, label: 'Castellano', lang: 'spa', codec: 'aac', channels: 2, converted: false },
      ],
      video: { codec: 'hevc', codecs: 'hvc1.2.4.L153.B0', width: 3840, height: 2160 },
      poster: '5d0e7b44',
    },
  },
  /* Pestaña IPTV (§16.2): dentro de «ES | DAZN», primera página con más detrás. */
  'iptvBrowse.categoria': {
    active: true,
    provider: 'Casa',
    catalog: 'mfz3k1a01',
    query: '',
    category: { id: CAT_DAZN, name: 'ES | DAZN', count: 12 },
    total: 12,
    catalogTotal: 812,
    facets: {
      country: [{ value: 'ES', count: 12, selected: false }],
      language: [{ value: 'es', count: 12, selected: false }],
      type: [{ value: 'deportes', count: 12, selected: false }],
      sport: [
        { value: 'baloncesto', count: 7, selected: false },
        { value: 'f1', count: 1, selected: false },
      ],
      quality: [
        { value: 'fhd', count: 3, selected: false },
        { value: 'hd', count: 12, selected: false },
      ],
    },
    channels: [
      {
        id: IPTV_ID_DAZN_1,
        title: 'DAZN 1',
        qualities: ['fhd', 'hd'],
        country: 'ES',
        category: CAT_DAZN,
      },
      {
        id: IPTV_ID_DAZN_F1,
        title: 'DAZN F1',
        qualities: ['fhd', 'hd'],
        country: 'ES',
        category: CAT_DAZN,
      },
      {
        id: IPTV_ID_ACB_1,
        title: 'DAZN ACB 1',
        qualities: ['hd'],
        country: 'ES',
        category: CAT_DAZN,
      },
    ],
    nextCursor: 'bWZ6M2sxYTAxLjM',
    stale: false,
  },
  /* Sin IPTV activa (en pausa, sin proveedor o sin catálogo): no es un error. */
  'iptvBrowse.inactiva': {
    active: false,
    provider: '',
    catalog: '0',
    query: '',
    category: null,
    total: 0,
    catalogTotal: 0,
    channels: [],
    nextCursor: null,
    stale: false,
  },
  /* Una categoría que ya no está (otra sincronización u otro proveedor). */
  'iptvBrowse.categoria-perdida': {
    active: true,
    provider: 'Casa',
    catalog: 'mfz3k1a01',
    query: '',
    category: null,
    total: 0,
    catalogTotal: 812,
    channels: [],
    nextCursor: null,
    stale: false,
  },
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
      iptvNameHdCandidate,
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
} satisfies {
  'iptvGuide.todos': V1ResponseInput<'iptvGuide'>;
  'iptvGuide.solo-hoy': V1ResponseInput<'iptvGuide'>;
  'iptvGuide.inactiva': V1ResponseInput<'iptvGuide'>;
  'iptvGuide.preparando': V1ResponseInput<'iptvGuide'>;
  'iptvGuideNow.sin-guia': V1ResponseInput<'iptvGuideNow'>;
  'vodHome.preparing': V1ResponseInput<'vodHome'>;
  'vodHome.none': V1ResponseInput<'vodHome'>;
  'vodHome.unsupported': V1ResponseInput<'vodHome'>;
  'vodBrowse.search': V1ResponseInput<'vodBrowse'>;
  'vodBrowse.otros-idiomas': V1ResponseInput<'vodBrowse'>;
  'vodLanguagesGet.sin-elegir': V1ResponseInput<'vodLanguagesGet'>;
  'vodBrowse.vacio': V1ResponseInput<'vodBrowse'>;
  'vodTitle.series': V1ResponseInput<'vodTitle'>;
  'vodTitle.episodio-avi': V1ResponseInput<'vodTitle'>;
  'vodTitle.audio-comprobando': V1ResponseInput<'vodTitle'>;
  'vodTitle.audio-del-fichero': V1ResponseInput<'vodTitle'>;
  'vodTitle.info-failed': V1ResponseInput<'vodTitle'>;
  'vodStream.hevc': V1ResponseInput<'vodStream'>;
  'iptvBrowse.categoria': V1ResponseInput<'iptvBrowse'>;
  'iptvBrowse.inactiva': V1ResponseInput<'iptvBrowse'>;
  'iptvBrowse.categoria-perdida': V1ResponseInput<'iptvBrowse'>;
  'footballResolve.iptv-canal': V1ResponseInput<'footballResolve'>;
  'search.iptv': V1ResponseInput<'search'>;
  'libraryGet.iptv': V1ResponseInput<'libraryGet'>;
  'footballResolve.iptv': V1ResponseInput<'footballResolve'>;
  'channelStream.iptv': V1ResponseInput<'channelStream'>;
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
  'iptv.status': { ...iptvStatusOk, vod: iptvVodStatus },
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

/** Para el test: qué rutas no tienen ejemplo porque no responden JSON (SSE, vídeo, imágenes y el 204 de `vodProgress`). */
export const NON_JSON_ROUTE_IDS: readonly V1RouteId[] = [
  'events',
  'video',
  'footballTeamCrest',
  'footballCompetitionLogo',
  'vodArt',
  'vodProgress',
  'iptvGuideArt',
  /* El zip de «Descargar logs» (Ajustes → Registro, 0.9.0). */
  'diagnosticsLogDownload',
];
