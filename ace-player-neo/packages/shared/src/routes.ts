/* Tabla de rutas de /api/v1 como DATOS (arquitectura §4 y §6.2).

   Es el contrato entre servidor, web e iOS: el servidor registra cada ruta
   desde aquí (los módulos solo aportan el manejador por su id), el OpenAPI
   (docs/openapi-v2.yaml) se genera recorriendo esta tabla y los ejemplos de
   fixtures/ salen uno por ruta. Si una ruta no está aquí, no existe.

   Cada ruta de /api/v1 existe también bajo /native (la entrada de la app iOS,
   D4): `/native/api/v1/ping` es la misma ruta que `/api/v1/ping`, pero con
   origen `native` (lo pone nginx en `X-Ace-Origin`, arquitectura §8.2).

   Acceso (`access`):
   - `web`: solo el origen web (pasó el login de Umbrel). Desde /native, 403
     `origin_forbidden`.
   - `native`: solo la app iOS (hoy, los ficheros del remux con `?t=`).
   - `any`: los dos. Desde /native hace falta credencial salvo que
     `credential` sea `none`.

   Credencial nativa (`credential`, solo cuenta con origen native):
   - `bearer`: `Authorization: Bearer <deviceId>.<secreto>` (arquitectura §5.12).
   - `video-token`: `?t=` firmado, porque AVPlayer no puede poner cabeceras en
     cada segmento.
   - `none`: sin token. Solo `GET /api/v1/ping` y `POST /api/v1/pairing/claim`.

   Las rutas antiguas (/api/*) NO están aquí: su contrato exacto está en
   api/legacy.ts (LEGACY_OPERATIONS) y la app iOS no las usa nunca. */

import type { z } from 'zod';
import type { ErrorCode } from './errors.js';
import {
  DeviceParamsSchema,
  DeviceRevokeResponseSchema,
  DevicesListResponseSchema,
  PairingClaimBodySchema,
  PairingClaimResponseSchema,
  PairingCreateBodySchema,
  PairingCreateResponseSchema,
} from './api/v1/auth.js';
import {
  DiagnosticReportBodySchema,
  DiagnosticReportResponseSchema,
  DiagnosticsListResponseSchema,
  DiagnosticsQuerySchema,
} from './api/v1/diagnostics.js';
import { EngineRestartResponseSchema, EngineStatusSchema } from './api/v1/engine.js';
import {
  BindBodySchema,
  BindResponseSchema,
  FootballScheduleResponseSchema,
  PreheatParamsSchema,
  PreheatResponseSchema,
  ResolveQuerySchema,
  ResolveResponseSchema,
  ScanParamsSchema,
  ScanResponseSchema,
  ScoresResponseSchema,
} from './api/v1/football.js';
import {
  DirectoryIdParamsSchema,
  DirectorySyncBodySchema,
  DirectoryViewSchema,
  LibraryMutationBodySchema,
  LibraryViewSchema,
  PreferencesInputSchema,
  PreferencesResponseSchema,
} from './api/v1/library.js';
import {
  ChannelStreamParamsSchema,
  ChannelStreamQuerySchema,
  HeartbeatBodySchema,
  HeartbeatResponseSchema,
  PlaybackStatusSchema,
  ReleaseBodySchema,
  ReleaseResponseSchema,
  SessionParamsSchema,
  StreamGrantSchema,
  VideoParamsSchema,
  VideoQuerySchema,
} from './api/v1/playback.js';
import { SearchQuerySchema, SearchResponseSchema } from './api/v1/search.js';
import { SettingsResponseSchema, SettingsUpdateBodySchema } from './api/v1/settings.js';
import {
  FeedbackBodySchema,
  FeedbackResponseSchema,
  OutcomeBodySchema,
  OutcomeResponseSchema,
  ReportBodySchema,
  ReportResponseSchema,
} from './api/v1/sources.js';
import {
  BootstrapResponseSchema,
  EventsQuerySchema,
  HealthLiveResponseSchema,
  HealthResponseSchema,
  PingResponseSchema,
} from './api/v1/system.js';

/** Prefijo de la API nueva. */
export const V1_PREFIX = '/api/v1';
/** Prefijo por el que entra la app iOS sin el login de Umbrel (D4). */
export const NATIVE_PREFIX = '/native';

export type V1Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type RouteAccess = 'web' | 'native' | 'any';
export type NativeCredential = 'none' | 'bearer' | 'video-token';
/** `json` = respuesta JSON validada; `sse` = text/event-stream; `binary` = ficheros del remux. */
export type RouteContent = 'json' | 'sse' | 'binary';

/** Módulos del backend (arquitectura §5.2): quién aporta el manejador de cada ruta. */
export const SERVER_MODULES = [
  'state',
  'net',
  'directories',
  'engine',
  'playback',
  'remux',
  'scanner',
  'sources',
  'football',
  'auth',
  'events',
  'diagnostics',
  'health',
  'search',
] as const;
export type ServerModuleName = (typeof SERVER_MODULES)[number];

export interface V1RouteDefinition {
  readonly method: V1Method;
  /** Ruta completa con `:param`, siempre bajo `/api/v1`. */
  readonly path: string;
  readonly access: RouteAccess;
  readonly credential: NativeCredential;
  readonly module: ServerModuleName;
  readonly summary: string;
  readonly description?: string;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Esquema de la respuesta de éxito; `null` si no es JSON (SSE o ficheros). */
  readonly response: z.ZodType | null;
  readonly status: 200 | 201;
  readonly content: RouteContent;
  /**
   * GET con efectos (abre una sesión, lanza una comprobación…): desde el
   * origen web pasa por la regla anti-CSRF igual que una mutación (T-033).
   */
  readonly sideEffects: boolean;
  /** Errores propios de la ruta (además de los comunes de §6.4). */
  readonly errors: readonly ErrorCode[];
  /** Ruta antigua gemela, si la hay (arquitectura §6.2). */
  readonly legacyTwin: string | null;
}

/* `const` conserva los tipos literales de cada ruta (sus esquemas concretos),
   que es lo que permite tipar los manejadores del servidor por id. */
function defineRoute<const R extends V1RouteDefinition>(route: R): R {
  return route;
}

/** Errores que puede dar cualquier ruta v1 (validación, acceso, cuerpo, fallo interno). */
export const COMMON_V1_ERRORS = [
  'validation_error',
  'bad_json',
  'body_too_large',
  'cross_origin',
  'origin_forbidden',
  'unauthorized',
  'device_revoked',
  'not_found',
  'not_implemented',
  'internal_error',
] as const satisfies readonly ErrorCode[];

/* Además de estos, `directoriesSync` puede devolver `http_NNN` (502 en v1: el
   servidor de la lista respondió con ese error), que no es un código fijo del
   catálogo y por eso no se lista aquí. Los `ipfs_*` y `fetch_failed` se
   añadieron en el paso 1.3 (los devuelve la descarga por IPFS y el socket). */
const DIRECTORY_FETCH_ERRORS = [
  'bad_url',
  'private_url',
  'dns_failed',
  'fetch_timeout',
  'fetch_failed',
  'redirect_limit',
  'redirect_loop',
  'response_too_large',
  'unsupported_encoding',
  'empty_directory',
  'source_not_found',
  'source_limit',
  'ipfs_not_found',
  'ipfs_bad_cid',
  'ipfs_bad_block',
  'ipfs_bad_data',
  'ipfs_bad_record',
  'ipfs_hamt_unsupported',
  'ipfs_missing_block',
  'ipfs_not_file',
  'ipfs_unsupported_codec',
  'ipfs_unsupported_hash',
] as const satisfies readonly ErrorCode[];

export const V1_ROUTES = {
  // --- Sistema ---
  ping: defineRoute({
    method: 'GET',
    path: '/api/v1/ping',
    access: 'any',
    credential: 'none',
    module: 'health',
    summary: 'Vivo y versión, sin datos',
    description:
      'Sin token también desde /native: la app la usa para saber si la dirección es un Ace Player Neo antes de emparejar, y el vigilante del NAS puede usarla a través de la pasarela sin login.',
    response: PingResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  bootstrap: defineRoute({
    method: 'GET',
    path: '/api/v1/bootstrap',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Todo lo necesario para pintar la primera pantalla en una sola llamada',
    response: BootstrapResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/state',
  }),
  health: defineRoute({
    method: 'GET',
    path: '/api/v1/health',
    access: 'web',
    credential: 'bearer',
    module: 'health',
    summary: 'Panel de salud, desde las cachés de los vigilantes (sin red en cada llamada)',
    response: HealthResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/health',
  }),
  healthLive: defineRoute({
    method: 'GET',
    path: '/api/v1/health/live',
    access: 'web',
    credential: 'bearer',
    module: 'health',
    summary: 'Healthcheck de Docker: sano en cuanto escucha, sin red ni disco',
    response: HealthLiveResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  events: defineRoute({
    method: 'GET',
    path: '/api/v1/events',
    access: 'any',
    credential: 'bearer',
    module: 'events',
    summary: 'Tiempo real por SSE (reanudable con Last-Event-ID)',
    query: EventsQuerySchema,
    response: null,
    status: 200,
    content: 'sse',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),

  // --- Motor ---
  engineStatus: defineRoute({
    method: 'GET',
    path: '/api/v1/engine/status',
    access: 'any',
    credential: 'bearer',
    module: 'engine',
    summary: 'Estado del motor con histéresis (el del vigilante del backend)',
    response: EngineStatusSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/engine/status',
  }),
  engineRestart: defineRoute({
    method: 'POST',
    path: '/api/v1/engine/restart',
    access: 'any',
    credential: 'bearer',
    module: 'engine',
    summary: 'Reiniciar el motor (enfriamiento de 15 s; no gasta el cupo automático)',
    response: EngineRestartResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['restart_cooldown', 'restart_failed'],
    legacyTwin: 'POST /api/restart-engine',
  }),

  // --- Reproducción ---
  channelStream: defineRoute({
    method: 'GET',
    path: '/api/v1/channels/:id/stream',
    access: 'any',
    credential: 'bearer',
    module: 'playback',
    summary: 'Abrir (o unirse a) la sesión del motor de un canal y recibir su URL',
    description:
      'Espera a que la URL sea reproducible (la sesión abierta o, en iOS, el remux listo). Si el cliente cuelga, se cancela. Arquitectura §6.3.',
    params: ChannelStreamParamsSchema,
    query: ChannelStreamQuerySchema,
    response: StreamGrantSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [
      'engine_unavailable',
      'engine_timeout',
      'source_no_peers',
      'remux_busy',
      'remux_timeout',
      'remux_died',
      'ffmpeg_missing',
      'handoff_denied',
    ],
    legacyTwin: 'GET /api/remux',
  }),
  sessionHeartbeat: defineRoute({
    method: 'POST',
    path: '/api/v1/sessions/:sid/heartbeat',
    access: 'any',
    credential: 'bearer',
    module: 'playback',
    summary: 'Latido del visor cada 15 s; sin latido en 45 s se le da por ido',
    params: SessionParamsSchema,
    body: HeartbeatBodySchema,
    response: HeartbeatResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['session_expired', 'session_not_found'],
    legacyTwin: 'POST /api/playback/claim',
  }),
  sessionRelease: defineRoute({
    method: 'POST',
    path: '/api/v1/sessions/:sid/release',
    access: 'any',
    credential: 'bearer',
    module: 'playback',
    summary: 'Soltar la sesión (también con sendBeacon al cerrar la página)',
    params: SessionParamsSchema,
    body: ReleaseBodySchema,
    response: ReleaseResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['session_not_found'],
    legacyTwin: 'POST /api/playback/release',
  }),
  playbackStatus: defineRoute({
    method: 'GET',
    path: '/api/v1/playback',
    access: 'any',
    credential: 'bearer',
    module: 'playback',
    summary: 'El mando de siempre más las sesiones abiertas (respaldo si falla el SSE)',
    response: PlaybackStatusSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/playback',
  }),
  video: defineRoute({
    method: 'GET',
    path: '/api/v1/video/:sid/:file',
    access: 'native',
    credential: 'video-token',
    module: 'remux',
    summary: 'Lista y segmentos del remux para AVPlayer (Range, 206/416, no-store)',
    description:
      'El backend reescribe cada m3u8 y añade `?t=` a cada URI, también a `#EXT-X-MAP:URI` (arquitectura §5.12).',
    params: VideoParamsSchema,
    query: VideoQuerySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: false,
    errors: ['video_token_invalid', 'session_expired', 'session_not_found'],
    legacyTwin: 'GET /remux/{hash}/{fichero}',
  }),

  // --- Ajustes ---
  settingsGet: defineRoute({
    method: 'GET',
    path: '/api/v1/settings',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Ajustes v2 (política de mismo canal)',
    response: SettingsResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  settingsUpdate: defineRoute({
    method: 'PUT',
    path: '/api/v1/settings',
    access: 'web',
    credential: 'bearer',
    module: 'state',
    summary: 'Cambiar los ajustes v2 (parcial: lo que no llega se queda como está)',
    body: SettingsUpdateBodySchema,
    response: SettingsResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),

  // --- Emparejamiento y dispositivos ---
  pairingCreate: defineRoute({
    method: 'POST',
    path: '/api/v1/pairing',
    access: 'web',
    credential: 'bearer',
    module: 'auth',
    summary: 'Crear un código de 6 dígitos y su QR (5 min, un solo uso, anula el anterior)',
    body: PairingCreateBodySchema,
    response: PairingCreateResponseSchema,
    status: 201,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),
  pairingClaim: defineRoute({
    method: 'POST',
    path: '/api/v1/pairing/claim',
    access: 'any',
    credential: 'none',
    module: 'auth',
    summary: 'Canjear el código desde la app iOS y recibir el token',
    description: '5 intentos por código y 10 por minuto en total; comparación en tiempo constante.',
    body: PairingClaimBodySchema,
    response: PairingClaimResponseSchema,
    status: 201,
    content: 'json',
    sideEffects: true,
    errors: ['pairing_invalid', 'pairing_expired', 'pairing_rate_limited'],
    legacyTwin: null,
  }),
  devicesList: defineRoute({
    method: 'GET',
    path: '/api/v1/devices',
    access: 'web',
    credential: 'bearer',
    module: 'auth',
    summary: 'Dispositivos emparejados',
    response: DevicesListResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  deviceRevoke: defineRoute({
    method: 'DELETE',
    path: '/api/v1/devices/:id',
    access: 'web',
    credential: 'bearer',
    module: 'auth',
    summary: 'Revocar un dispositivo: cierra su SSE, suelta sus visores y anula sus URLs de vídeo',
    params: DeviceParamsSchema,
    response: DeviceRevokeResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['device_not_found'],
    legacyTwin: null,
  }),

  // --- Diagnóstico ---
  diagnosticsList: defineRoute({
    method: 'GET',
    path: '/api/v1/diagnostics',
    access: 'any',
    credential: 'bearer',
    module: 'diagnostics',
    summary: 'Últimos fallos y recuento por causa en 24 h',
    query: DiagnosticsQuerySchema,
    response: DiagnosticsListResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  diagnosticsReport: defineRoute({
    method: 'POST',
    path: '/api/v1/diagnostics',
    access: 'any',
    credential: 'bearer',
    module: 'diagnostics',
    summary: 'Un cliente informa de un fallo o de sus métricas de reproducción',
    body: DiagnosticReportBodySchema,
    response: DiagnosticReportResponseSchema,
    status: 201,
    content: 'json',
    sideEffects: true,
    errors: ['rate_limited'],
    legacyTwin: null,
  }),

  // --- Biblioteca, preferencias y directorios ---
  libraryGet: defineRoute({
    method: 'GET',
    path: '/api/v1/library',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Favoritos, recientes y canales del directorio activo',
    response: LibraryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/state',
  }),
  libraryMutate: defineRoute({
    method: 'POST',
    path: '/api/v1/library',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Alta, renombrado o borrado por acción (no pisa colecciones de otros dispositivos)',
    body: LibraryMutationBodySchema,
    response: LibraryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['bad_request', 'bad_action', 'bad_collection', 'bad_title', 'source_not_found'],
    legacyTwin: 'POST /api/library',
  }),
  preferencesGet: defineRoute({
    method: 'GET',
    path: '/api/v1/preferences',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Preferencias de fútbol',
    response: PreferencesResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/state',
  }),
  preferencesUpdate: defineRoute({
    method: 'PUT',
    path: '/api/v1/preferences',
    access: 'any',
    credential: 'bearer',
    module: 'state',
    summary: 'Guardar las preferencias de fútbol (sustituye, como POST /api/preferences)',
    body: PreferencesInputSchema,
    response: PreferencesResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: 'POST /api/preferences',
  }),
  directoriesGet: defineRoute({
    method: 'GET',
    path: '/api/v1/directories',
    access: 'any',
    credential: 'bearer',
    module: 'directories',
    summary: 'Directorios guardados y canales del activo',
    response: DirectoryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/state',
  }),
  directoriesSync: defineRoute({
    method: 'POST',
    path: '/api/v1/directories/sync',
    access: 'any',
    credential: 'bearer',
    module: 'directories',
    summary: 'Añadir o refrescar un directorio (M3U, HTML o IPFS)',
    body: DirectorySyncBodySchema,
    response: DirectoryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: DIRECTORY_FETCH_ERRORS,
    legacyTwin: 'POST /api/streams/sync',
  }),
  directoriesActivate: defineRoute({
    method: 'POST',
    path: '/api/v1/directories/:id/activate',
    access: 'any',
    credential: 'bearer',
    module: 'directories',
    summary: 'Elegir el directorio activo',
    params: DirectoryIdParamsSchema,
    response: DirectoryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['source_not_found'],
    legacyTwin: 'POST /api/streams/activate',
  }),
  directoriesDelete: defineRoute({
    method: 'DELETE',
    path: '/api/v1/directories/:id',
    access: 'any',
    credential: 'bearer',
    module: 'directories',
    summary: 'Borrar un directorio (nunca el último)',
    params: DirectoryIdParamsSchema,
    response: DirectoryViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['source_not_found', 'last_source'],
    legacyTwin: 'POST /api/streams/delete',
  }),

  // --- Fútbol ---
  footballSchedule: defineRoute({
    method: 'GET',
    path: '/api/v1/football',
    access: 'any',
    credential: 'bearer',
    module: 'football',
    summary: 'Agenda de partidos (60 s como máximo; si vence, la última buena con stale)',
    response: FootballScheduleResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['football_unavailable'],
    legacyTwin: 'GET /api/football',
  }),
  footballResolve: defineRoute({
    method: 'GET',
    path: '/api/v1/football/resolve',
    access: 'any',
    credential: 'bearer',
    module: 'football',
    summary: 'Buscar fuentes para un partido o canal y lanzar su comprobación',
    query: ResolveQuerySchema,
    response: ResolveResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['channel_required'],
    legacyTwin: 'GET /api/football/resolve',
  }),
  footballScan: defineRoute({
    method: 'GET',
    path: '/api/v1/football/scans/:id',
    access: 'any',
    credential: 'bearer',
    module: 'scanner',
    summary: 'Estado de un trabajo del comprobador',
    params: ScanParamsSchema,
    response: ScanResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['scan_not_found'],
    legacyTwin: 'GET /api/football/scan',
  }),
  footballPreheat: defineRoute({
    method: 'GET',
    path: '/api/v1/football/preheat/:matchId',
    access: 'any',
    credential: 'bearer',
    module: 'football',
    summary: 'Estado del precalentado de un partido',
    params: PreheatParamsSchema,
    response: PreheatResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/football/preheat',
  }),
  footballBind: defineRoute({
    method: 'POST',
    path: '/api/v1/football/bindings',
    access: 'any',
    credential: 'bearer',
    module: 'football',
    summary: 'Vincular a mano un canal con un hash',
    body: BindBodySchema,
    response: BindResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['bad_binding'],
    legacyTwin: 'POST /api/football/bind',
  }),
  scores: defineRoute({
    method: 'GET',
    path: '/api/v1/scores',
    access: 'any',
    credential: 'bearer',
    module: 'football',
    summary: 'Marcadores en vivo (ESPN); sin agenda, available: false con 200',
    response: ScoresResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: 'GET /api/scores',
  }),

  // --- Fuentes ---
  sourcesReport: defineRoute({
    method: 'POST',
    path: '/api/v1/sources/report',
    access: 'any',
    credential: 'bearer',
    module: 'sources',
    summary: 'Reportar una fuente: cuarentena y recomprobación prioritaria',
    body: ReportBodySchema,
    response: ReportResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['bad_request'],
    legacyTwin: 'POST /api/sources/report',
  }),
  sourcesOutcome: defineRoute({
    method: 'POST',
    path: '/api/v1/sources/outcome',
    access: 'any',
    credential: 'bearer',
    module: 'sources',
    summary: 'Resultado real de reproducir una fuente (sigue no suma)',
    body: OutcomeBodySchema,
    response: OutcomeResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['bad_outcome'],
    legacyTwin: 'POST /api/sources/outcome',
  }),
  sourcesFeedback: defineRoute({
    method: 'POST',
    path: '/api/v1/sources/feedback',
    access: 'any',
    credential: 'bearer',
    module: 'sources',
    summary: 'Confirmar o rechazar que una fuente es el canal',
    body: FeedbackBodySchema,
    response: FeedbackResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['bad_feedback'],
    legacyTwin: 'POST /api/sources/feedback',
  }),

  // --- Buscador ---
  search: defineRoute({
    method: 'GET',
    path: '/api/v1/search',
    access: 'any',
    credential: 'bearer',
    module: 'search',
    summary: 'Buscador del motor AceStream (2 a 80 caracteres; hasta 100 resultados)',
    query: SearchQuerySchema,
    response: SearchResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['empty_query', 'ace_timeout', 'engine_unavailable', 'engine_bad_response'],
    legacyTwin: 'GET /api/search',
  }),
} as const satisfies Record<string, V1RouteDefinition>;

export type V1Routes = typeof V1_ROUTES;
export type V1RouteId = keyof V1Routes;

/** Ids en el orden de la tabla (el del OpenAPI y el de registro en el servidor). */
export const V1_ROUTE_IDS = Object.keys(V1_ROUTES) as V1RouteId[];

type SchemaOf<R, K extends string> = R extends { readonly [P in K]: infer S extends z.ZodType }
  ? S
  : undefined;

/** Parámetros de ruta ya validados (lo que recibe el manejador). */
export type V1Params<Id extends V1RouteId> =
  SchemaOf<V1Routes[Id], 'params'> extends infer S extends z.ZodType
    ? z.output<S>
    : Record<string, never>;
/** Query ya validada. */
export type V1Query<Id extends V1RouteId> =
  SchemaOf<V1Routes[Id], 'query'> extends infer S extends z.ZodType
    ? z.output<S>
    : Record<string, never>;
/** Cuerpo ya validado (`undefined` si la ruta no lleva cuerpo). */
export type V1Body<Id extends V1RouteId> =
  SchemaOf<V1Routes[Id], 'body'> extends infer S extends z.ZodType ? z.output<S> : undefined;
/** Lo que devuelve el manejador de una ruta JSON (se valida antes de salir). */
export type V1ResponseInput<Id extends V1RouteId> = V1Routes[Id]['response'] extends infer S extends
  z.ZodType
  ? z.input<S>
  : never;
/** Lo que recibe el cliente de una ruta JSON. */
export type V1ResponseOutput<Id extends V1RouteId> =
  V1Routes[Id]['response'] extends infer S extends z.ZodType ? z.output<S> : never;

/** Ruta con su id, para recorrer la tabla. */
export type V1RouteEntry = V1RouteDefinition & { readonly id: V1RouteId };

export function listV1Routes(): V1RouteEntry[] {
  return V1_ROUTE_IDS.map((id) => ({ id, ...V1_ROUTES[id] }));
}

/** `/api/v1/channels/:id/stream` → `/native/api/v1/channels/:id/stream`. */
export function nativePath(path: string): string {
  return `${NATIVE_PREFIX}${path}`;
}

/** `:param` → `{param}` (OpenAPI). */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Rutas que la app iOS puede llamar sin credencial (arquitectura §5.12). */
export const NATIVE_PUBLIC_ROUTE_IDS = V1_ROUTE_IDS.filter(
  (id) => V1_ROUTES[id].credential === 'none',
);
