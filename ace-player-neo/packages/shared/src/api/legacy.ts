/* Contratos EXACTOS de las 25 rutas (27 operaciones) de la 0.6.59, tal y
   como las documenta api.md, rarezas incluidas: respuestas sin `success`,
   `/api/scores` con `success: false` y 200, `web` y `streams` duplicados…
   Sirven para los tests de paridad (plan E1.3) y para el contraste con la
   0.6.59 (E1.4). Nadie nuevo debería usar estas rutas: la web y la app iOS
   van por /api/v1.

   Las respuestas son `strictObject`: una clave de más o de menos es una
   diferencia con la 0.6.59 y tiene que ir anotada en docs/compat.md.
   Los cuerpos son `looseObject` con todo opcional porque la 0.6.59 acepta
   cualquier JSON y normaliza lo que entiende (api.md §2.4). */

import { z } from 'zod';
import { EpochMsSchema, HashSchema, IsoDateTimeSchema } from '../primitives.js';
import {
  ChannelBindingSchema,
  ChannelFeedbackSchema,
  ItemSchema,
  NowPlayingSchema,
  PreferencesSchema,
  SourceReportSchema,
  SourceStatEntrySchema,
  SourceStatsSchema,
} from '../state/v1.js';
import {
  FootballScheduleSchema,
  LiveScoreSchema,
  PreheatPublicSchema,
  PublicSourceReportSchema,
  ResolutionSchema,
  ScanJobSchema,
  ScanRefSchema,
  SearchResultSchema,
  WebSourceSummarySchema,
} from './common.js';

const Success = z.literal(true);

// --- Proyecciones del estado (api.md §3.3 y §3.11) ---

/** `directoryResponse` (server.js:963-972): `web` y `streams` son el mismo array. */
export const LegacyDirectoryResponseSchema = z.strictObject({
  success: Success,
  web: z.array(ItemSchema),
  streams: z.array(ItemSchema),
  webSyncedAt: z.string().nullable(),
  webSources: z.array(WebSourceSummarySchema),
  activeWebSourceId: z.string(),
});
export type LegacyDirectoryResponse = z.infer<typeof LegacyDirectoryResponseSchema>;

/** `publicState` (server.js:954-961): todo menos `channelFeedback`, con `learningCount`. Sin `success`. */
export const LegacyPublicStateSchema = z.strictObject({
  favorites: z.array(ItemSchema),
  history: z.array(ItemSchema),
  web: z.array(ItemSchema),
  webSyncedAt: z.string().nullable(),
  webSources: z.array(WebSourceSummarySchema),
  activeWebSourceId: z.string(),
  preferences: PreferencesSchema,
  channelBindings: z.array(ChannelBindingSchema),
  sourceReports: z.array(SourceReportSchema),
  sourceStats: SourceStatsSchema,
  nowPlaying: NowPlayingSchema.nullable(),
  learningCount: z.number().int().nonnegative(),
});
export type LegacyPublicState = z.infer<typeof LegacyPublicStateSchema>;

// --- 1 y 2. /api/state ---

/** PUT /api/state (clientes 0.6.8): solo altas en favoritos e historial y el mando (api.md §4.2). */
export const LegacyPutStateBodySchema = z.looseObject({
  favorites: z.unknown().optional(),
  history: z.unknown().optional(),
  nowPlaying: z.unknown().optional(),
});

// --- 3. POST /api/library ---

export const LegacyLibraryBodySchema = z.looseObject({
  action: z.unknown().optional(),
  item: z.unknown().optional(),
  collection: z.unknown().optional(),
  id: z.unknown().optional(),
  title: z.unknown().optional(),
  sourceId: z.unknown().optional(),
});

export const LegacyFavoritesResponseSchema = z.strictObject({
  success: Success,
  favorites: z.array(ItemSchema),
});
export const LegacyHistoryResponseSchema = z.strictObject({
  success: Success,
  history: z.array(ItemSchema),
});
/** Según la colección: `{success, favorites}`, `{success, history}` o `directoryResponse`. */
export const LegacyLibraryResponseSchema = z.union([
  LegacyFavoritesResponseSchema,
  LegacyHistoryResponseSchema,
  LegacyDirectoryResponseSchema,
]);

// --- 4 a 6. Mando ---

/** GET /api/playback: SOLO estas tres claves (T-115). */
export const LegacyPlaybackResponseSchema = z.strictObject({
  nowPlaying: NowPlayingSchema.nullable(),
  learningCount: z.number().int().nonnegative(),
  serverTime: EpochMsSchema,
});

export const LegacyClaimBodySchema = z.looseObject({
  id: z.unknown().optional(),
  dev: z.unknown().optional(),
  title: z.unknown().optional(),
  token: z.unknown().optional(),
});
/** Con lápida de 60 s del token: `{success, nowPlaying: null, ignored: true}` sin escribir (T-038). */
export const LegacyClaimResponseSchema = z.union([
  z.strictObject({ success: Success, nowPlaying: NowPlayingSchema }),
  z.strictObject({ success: Success, nowPlaying: z.null(), ignored: z.literal(true) }),
]);

export const LegacyReleaseBodySchema = z.looseObject({
  id: z.unknown().optional(),
  dev: z.unknown().optional(),
  token: z.unknown().optional(),
});
export const LegacyReleaseResponseSchema = z.strictObject({
  success: Success,
  released: z.boolean(),
});

// --- 7. POST /api/preferences (sustituye, no fusiona: api.md §6.7) ---

export const LegacyPreferencesBodySchema = z.looseObject({
  onboardingComplete: z.unknown().optional(),
  country: z.unknown().optional(),
  leagues: z.unknown().optional(),
  teams: z.unknown().optional(),
  nationalities: z.unknown().optional(),
});
export const LegacyPreferencesResponseSchema = z.strictObject({
  success: Success,
  preferences: PreferencesSchema,
});

// --- 8 a 13. Fútbol ---

export const LegacyFootballResponseSchema = FootballScheduleSchema.extend({ success: Success });

/** GET /api/football/resolve: `channel` repetible; `research=1`; `current`, `current_ih=1`, `client`. */
export const LegacyResolveQuerySchema = z.looseObject({
  match: z.string().optional(),
  channel: z.union([z.string(), z.array(z.string())]).optional(),
  research: z.string().optional(),
  current: z.string().optional(),
  current_ih: z.string().optional(),
  client: z.string().optional(),
});
export const LegacyResolveResponseSchema = ResolutionSchema.extend({ success: Success });

export const LegacyScanResponseSchema = ScanJobSchema.extend({ success: Success });

export const LegacyPreheatResponseSchema = z.strictObject({
  success: Success,
  preheat: PreheatPublicSchema.nullable(),
});

export const LegacyBindBodySchema = z.looseObject({
  channel: z.unknown().optional(),
  id: z.unknown().optional(),
  title: z.unknown().optional(),
  ih: z.unknown().optional(),
});
export const LegacyBindResponseSchema = z.strictObject({
  success: Success,
  binding: ChannelBindingSchema,
  channelBindings: z.array(ChannelBindingSchema),
});

/** GET /api/scores tiene TRES formas (api.md §4.13), la tercera con `success: false` y 200. */
export const LegacyScoresResponseSchema = z.union([
  z.strictObject({
    success: Success,
    generatedAt: IsoDateTimeSchema,
    source: z.literal('espn'),
    attribution: z.literal('ESPN'),
    leagues: z.number().int().nonnegative(),
    scores: z.record(z.string(), LiveScoreSchema),
  }),
  z.strictObject({
    success: Success,
    generatedAt: IsoDateTimeSchema,
    source: z.literal('espn'),
    leagues: z.literal(0),
    scores: z.strictObject({}),
  }),
  z.strictObject({
    success: z.literal(false),
    error: z.literal('sin_agenda'),
    scores: z.strictObject({}),
  }),
]);

// --- 14 a 16. Fuentes ---

export const LegacyReportBodySchema = z.looseObject({
  id: z.unknown().optional(),
  reason: z.unknown().optional(),
  channel: z.unknown().optional(),
  matchId: z.unknown().optional(),
  title: z.unknown().optional(),
  source: z.unknown().optional(),
  ih: z.unknown().optional(),
});
export const LegacyReportResponseSchema = z.strictObject({
  success: Success,
  report: PublicSourceReportSchema,
  scan: ScanRefSchema.nullable(),
});

export const LegacyOutcomeBodySchema = z.looseObject({
  id: z.unknown().optional(),
  resultado: z.unknown().optional(),
  segundos: z.unknown().optional(),
  title: z.unknown().optional(),
  listaId: z.unknown().optional(),
  source: z.unknown().optional(),
});
/** Con `sigue`: `{success, hash: null, proveedor: null}` y no escribe (T-123). */
export const LegacyOutcomeResponseSchema = z.strictObject({
  success: Success,
  hash: SourceStatEntrySchema.nullable(),
  proveedor: SourceStatEntrySchema.nullable(),
});

export const LegacyFeedbackBodySchema = z.looseObject({
  id: z.unknown().optional(),
  verdict: z.unknown().optional(),
  channel: z.unknown().optional(),
  channelKey: z.unknown().optional(),
  title: z.unknown().optional(),
  reason: z.unknown().optional(),
});
export const LegacyFeedbackResponseSchema = z.strictObject({
  success: Success,
  feedback: ChannelFeedbackSchema,
  learningCount: z.number().int().nonnegative(),
});

// --- 17. GET /api/health (lo usa el healthcheck de Docker y el vigilante del NAS) ---

const OnlineStatus = z.strictObject({ status: z.enum(['ready', 'offline']), online: z.boolean() });

export const LegacyHealthResponseSchema = z.strictObject({
  success: Success,
  version: z.string(),
  checkedAt: IsoDateTimeSchema,
  uptimeSeconds: z.number().int().nonnegative(),
  components: z.strictObject({
    backend: z.strictObject({ status: z.literal('ready'), online: z.literal(true) }),
    engine: OnlineStatus,
    scanner: z.strictObject({
      status: z.enum(['ready', 'offline', 'disabled']),
      online: z.boolean(),
      busy: z.boolean(),
      queue: z.number().int().nonnegative(),
      activeJobs: z.number().int().nonnegative(),
      cachedSources: z.number().int().nonnegative(),
    }),
    ai: z.strictObject({
      status: z.enum(['disabled', 'ready', 'model_missing', 'offline']),
      online: z.boolean(),
      model: z.string(),
      /** Sin él si la IA está desactivada. */
      modelReady: z.boolean().optional(),
    }),
    agenda: z.strictObject({
      status: z.enum(['ready', 'stale', 'warming']),
      generatedAt: IsoDateTimeSchema.nullable(),
      matches: z.number().int().nonnegative(),
      preheated: z.number().int().nonnegative(),
    }),
    directories: z.strictObject({
      status: z.enum(['ready', 'degraded', 'empty']),
      total: z.number().int().nonnegative(),
      channels: z.number().int().nonnegative(),
      sources: z.array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          count: z.number().int().nonnegative(),
          syncedAt: z.string().nullable(),
          lastErrorAt: z.string().nullable(),
          stale: z.boolean(),
        }),
      ),
    }),
  }),
  reports: z.strictObject({
    total: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    learningCount: z.number().int().nonnegative(),
  }),
});
export type LegacyHealthResponse = z.infer<typeof LegacyHealthResponseSchema>;

// --- 18 a 20. Motor y búsqueda (sin `success`) ---

export const LegacyEngineStatusResponseSchema = z.strictObject({
  online: z.boolean(),
  /** Los 300 primeros caracteres de la respuesta de `get_version`. */
  raw: z.string().max(300),
});

export const LegacyRestartResponseSchema = z.strictObject({ restarted: z.literal(true) });

export const LegacySearchQuerySchema = z.looseObject({ q: z.string().optional() });
export const LegacySearchResponseSchema = z.strictObject({
  query: z.string(),
  results: z.array(SearchResultSchema).max(100),
});

// --- 21 a 23. Remux del iPhone ---

export const LegacyRemuxQuerySchema = z.looseObject({
  id: z.string().optional(),
  infohash: z.string().optional(),
  dev: z.string().optional(),
});
/** Sin `success`; `token` de 16 hex, nuevo en cada petición. */
export const LegacyRemuxResponseSchema = z.strictObject({
  url: z.string().regex(/^\/remux\/[a-f0-9]{40}\/index\.m3u8$/),
  token: z.string().regex(/^[a-f0-9]{16}$/),
});

export const LegacyRemuxStopBodySchema = z.looseObject({
  id: z.unknown().optional(),
  dev: z.unknown().optional(),
  token: z.unknown().optional(),
  keepAlive: z.unknown().optional(),
});
export const LegacyRemuxStopResponseSchema = z.union([
  z.strictObject({
    success: Success,
    stopped: z.literal(false),
    detached: z.literal(false),
    stale: z.literal(true),
  }),
  z.strictObject({ success: Success, stopped: z.boolean(), detached: z.boolean() }),
]);

// --- 24 a 26. Directorios ---

export const LegacySyncBodySchema = z.looseObject({
  url: z.unknown().optional(),
  type: z.unknown().optional(),
  sourceId: z.unknown().optional(),
  name: z.unknown().optional(),
});
export const LegacySourceIdBodySchema = z.looseObject({ sourceId: z.unknown().optional() });

// --- Tabla de operaciones ---

export type LegacyMethod = 'GET' | 'HEAD' | 'POST' | 'PUT';

export interface LegacyOperation {
  /** Número de fila en el índice de api.md. */
  readonly n: number;
  readonly method: LegacyMethod;
  readonly path: string;
  /** Si admite `?…` detrás (compara con `startsWith(path + "?")`, api.md §2.1). */
  readonly acceptsQuery: boolean;
  /** GET con efectos: pasa por la regla anti-CSRF (api.md §2.3). */
  readonly sideEffects: boolean;
  /** Si lee el cuerpo (todas las POST y el PUT salvo /api/restart-engine). */
  readonly readsBody: boolean;
  readonly body?: z.ZodType;
  readonly query?: z.ZodType;
  /** `null` = no es JSON (ficheros del remux). */
  readonly response: z.ZodType | null;
}

/**
 * Las 27 operaciones, en el orden de `handleRequest` (server.js:4720-5027).
 * El orden no cambia el resultado (api.md §2.1) pero se conserva igual.
 * `/remux/{hash}/{fichero}` es un prefijo, no una ruta exacta.
 */
export const LEGACY_OPERATIONS: readonly LegacyOperation[] = [
  {
    n: 7,
    method: 'POST',
    path: '/api/preferences',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyPreferencesBodySchema,
    response: LegacyPreferencesResponseSchema,
  },
  {
    n: 12,
    method: 'POST',
    path: '/api/football/bind',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyBindBodySchema,
    response: LegacyBindResponseSchema,
  },
  {
    n: 14,
    method: 'POST',
    path: '/api/sources/report',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyReportBodySchema,
    response: LegacyReportResponseSchema,
  },
  {
    n: 15,
    method: 'POST',
    path: '/api/sources/outcome',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyOutcomeBodySchema,
    response: LegacyOutcomeResponseSchema,
  },
  {
    n: 16,
    method: 'POST',
    path: '/api/sources/feedback',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyFeedbackBodySchema,
    response: LegacyFeedbackResponseSchema,
  },
  {
    n: 17,
    method: 'GET',
    path: '/api/health',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyHealthResponseSchema,
  },
  {
    n: 11,
    method: 'GET',
    path: '/api/football/preheat',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    query: z.looseObject({ match: z.string().optional() }),
    response: LegacyPreheatResponseSchema,
  },
  {
    n: 10,
    method: 'GET',
    path: '/api/football/scan',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    query: z.looseObject({ id: z.string().optional() }),
    response: LegacyScanResponseSchema,
  },
  {
    n: 9,
    method: 'GET',
    path: '/api/football/resolve',
    acceptsQuery: true,
    sideEffects: true,
    readsBody: false,
    query: LegacyResolveQuerySchema,
    response: LegacyResolveResponseSchema,
  },
  {
    n: 13,
    method: 'GET',
    path: '/api/scores',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyScoresResponseSchema,
  },
  {
    n: 8,
    method: 'GET',
    path: '/api/football',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    response: LegacyFootballResponseSchema,
  },
  {
    n: 1,
    method: 'GET',
    path: '/api/state',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyPublicStateSchema,
  },
  {
    n: 2,
    method: 'PUT',
    path: '/api/state',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyPutStateBodySchema,
    response: LegacyPublicStateSchema,
  },
  {
    n: 3,
    method: 'POST',
    path: '/api/library',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyLibraryBodySchema,
    response: LegacyLibraryResponseSchema,
  },
  {
    n: 4,
    method: 'GET',
    path: '/api/playback',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyPlaybackResponseSchema,
  },
  {
    n: 5,
    method: 'POST',
    path: '/api/playback/claim',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyClaimBodySchema,
    response: LegacyClaimResponseSchema,
  },
  {
    n: 6,
    method: 'POST',
    path: '/api/playback/release',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyReleaseBodySchema,
    response: LegacyReleaseResponseSchema,
  },
  {
    n: 22,
    method: 'POST',
    path: '/api/remux/stop',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacyRemuxStopBodySchema,
    response: LegacyRemuxStopResponseSchema,
  },
  {
    n: 21,
    method: 'GET',
    path: '/api/remux',
    acceptsQuery: true,
    sideEffects: true,
    readsBody: false,
    query: LegacyRemuxQuerySchema,
    response: LegacyRemuxResponseSchema,
  },
  {
    n: 23,
    method: 'GET',
    path: '/remux/',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    response: null,
  },
  {
    n: 23,
    method: 'HEAD',
    path: '/remux/',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    response: null,
  },
  {
    n: 20,
    method: 'GET',
    path: '/api/search',
    acceptsQuery: true,
    sideEffects: false,
    readsBody: false,
    query: LegacySearchQuerySchema,
    response: LegacySearchResponseSchema,
  },
  {
    n: 18,
    method: 'GET',
    path: '/api/engine/status',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyEngineStatusResponseSchema,
  },
  {
    n: 19,
    method: 'POST',
    path: '/api/restart-engine',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: false,
    response: LegacyRestartResponseSchema,
  },
  {
    n: 24,
    method: 'POST',
    path: '/api/streams/sync',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacySyncBodySchema,
    response: LegacyDirectoryResponseSchema,
  },
  {
    n: 25,
    method: 'POST',
    path: '/api/streams/activate',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacySourceIdBodySchema,
    response: LegacyDirectoryResponseSchema,
  },
  {
    n: 26,
    method: 'POST',
    path: '/api/streams/delete',
    acceptsQuery: false,
    sideEffects: false,
    readsBody: true,
    body: LegacySourceIdBodySchema,
    response: LegacyDirectoryResponseSchema,
  },
];

/** Prefijo de los ficheros del remux antiguo (`/remux/<hash>/<fichero>`). */
export const LEGACY_REMUX_PREFIX = '/remux/';

/** Busca la operación de un método y una ruta tal y como los escribe la tabla. */
export function findLegacyOperation(method: string, path: string): LegacyOperation | undefined {
  return LEGACY_OPERATIONS.find((op) => op.method === method && op.path === path);
}

/** Forma de una URL de fichero del remux antiguo: hash en minúsculas y un solo nombre de fichero. */
export const LegacyRemuxFilePathSchema = z
  .string()
  .regex(/^\/remux\/[a-f0-9]{40}\/[^/\\]+$/, 'ruta de fichero de remux');

/** Hash de una ruta antigua (lo reexporta para no importar primitives en los tests de paridad). */
export const LegacyHashSchema = HashSchema;
