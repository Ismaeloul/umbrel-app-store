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
     Desde la 0.8.1 el iPhone emparejado administra como la web (Salud,
     Dispositivos, emparejar otro y ajustes v2): solo `healthLive` (es el
     healthcheck de Docker; la app usa `ping`), las 5 rutas de Ajustes →
     IPTV (`iptv*`, docs/iptv.md §5.3: la IPTV solo se configura en la web)
     y `iptvChannels` (el buscador IPTV, §14.2; pasa a `any` cuando la app
     calque el buscador, D27) e `iptvBrowse` (la pestaña IPTV de Canales,
     §16.2; D29) son `web`. Las 5 de la Guía TV (`iptvGuide*`, §20.6)
     también nacen `web`. También las 3 de la copia de seguridad
     (`backup*`, decisiones.md D25: la copia lleva datos personales y la
     IPTV solo se configura en la web) y `diagnosticsExport` («Descargar
     fallos» de Salud, 0.9.0: lleva el registro del servidor, aunque
     redactado), igual que las 3 de «Descargar logs» (`diagnosticsLogInfo`,
     `diagnosticsLogDownload` y `diagnosticsWebLog`, Ajustes → Registro).
     Las 8 de Películas y series (`vod*`, docs/vod.md §11.1) nacen `web`
     (D-VOD19) y pasan a `any` cuando la app copie la pantalla.
     `video` es `any` desde la IPTV (docs/iptv.md §5.4): la web entra sin
     token (el login de Umbrel basta) y el iPhone con `video-token`.

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
import {
  DiagnosticsExportBodySchema,
  DiagnosticsExportSchema,
} from './api/v1/diagnostics-export.js';
import {
  DiagnosticsLogDownloadBodySchema,
  DiagnosticsLogInfoSchema,
  WebLogUploadBodySchema,
  WebLogUploadResponseSchema,
} from './api/v1/diagnostics-log.js';
import { WEB_LOG_UPLOAD_MAX_ENTRIES, WEB_LOG_UPLOAD_PER_MINUTE } from './constants/limits.js';
import { EngineRestartResponseSchema, EngineStatusSchema } from './api/v1/engine.js';
import {
  BadgeVersionQuerySchema,
  BindBodySchema,
  BindResponseSchema,
  CompetitionLogoParamsSchema,
  FootballScheduleResponseSchema,
  PreheatParamsSchema,
  PreheatResponseSchema,
  ResolveQuerySchema,
  ResolveResponseSchema,
  ScanParamsSchema,
  ScanResponseSchema,
  ScoresResponseSchema,
  TeamCrestParamsSchema,
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
import {
  IptvBrowseQuerySchema,
  IptvBrowseResponseSchema,
  IptvChannelsQuerySchema,
  IptvChannelsResponseSchema,
  IptvSaveBodySchema,
  IptvUpdateBodySchema,
  IptvViewSchema,
} from './api/v1/iptv.js';
import {
  IptvGuideArtParamsSchema,
  IptvGuideNowQuerySchema,
  IptvGuideNowResponseSchema,
  IptvGuideProgrammeDetailSchema,
  IptvGuideProgrammeParamsSchema,
  IptvGuideProgrammesQuerySchema,
  IptvGuideProgrammesResponseSchema,
  IptvGuideQuerySchema,
  IptvGuideResponseSchema,
  IptvGuideVersionQuerySchema,
} from './api/v1/guide.js';
import {
  BackupExportBodySchema,
  BackupFileSchema,
  BackupImportBodySchema,
  BackupImportResponseSchema,
} from './api/v1/backup.js';
import { SearchQuerySchema, SearchResponseSchema } from './api/v1/search.js';
import {
  VodArtParamsSchema,
  VodArtQuerySchema,
  VodBrowseQuerySchema,
  VodBrowseResponseSchema,
  VodGrantSchema,
  VodHomeQuerySchema,
  VodHomeSchema,
  VodLanguagesBodySchema,
  VodLanguagesSchema,
  VodListParamsSchema,
  VodListSchema,
  VodProgressBodySchema,
  VodStreamQuerySchema,
  VodTitleParamsSchema,
  VodTitleQuerySchema,
  VodTitleSchema,
} from './api/v1/vod.js';
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

/** `PATCH` llegó con la IPTV (`iptvUpdate`: pausar o renombrar sin tocar los secretos). */
export type V1Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteAccess = 'web' | 'native' | 'any';
export type NativeCredential = 'none' | 'bearer' | 'video-token';
/**
 * `json` = respuesta JSON validada; `sse` = text/event-stream; `binary` =
 * ficheros del remux, escudos (PNG) y carteles VOD; `empty` = 204 sin cuerpo
 * (hoy, `vodProgress`: docs/vod.md §11.1).
 */
export type RouteContent = 'json' | 'sse' | 'binary' | 'empty';

/** Módulos del backend (arquitectura §5.2): quién aporta el manejador de cada ruta. */
export const SERVER_MODULES = [
  'state',
  'net',
  'iptv',
  'directories',
  'engine',
  'playback',
  'remux',
  'scanner',
  'sources',
  'football',
  'instantStart',
  'teams',
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
  /** Esquema de la respuesta de éxito; `null` si no es JSON (SSE, ficheros o 204). */
  readonly response: z.ZodType | null;
  /** 204 solo con `content: 'empty'`. */
  readonly status: 200 | 201 | 204;
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

/* Lo que puede dar la prueba rápida de «Guardar IPTV» (docs/iptv.md §5.3):
   la descarga con el filtro SSRF de `net` y la respuesta del proveedor. */
const IPTV_SAVE_ERRORS = [
  'bad_url',
  'private_url',
  'dns_failed',
  'redirect_limit',
  'redirect_loop',
  'unsupported_encoding',
  'iptv_credentials_required',
  'iptv_secret_unreadable',
  'iptv_auth_failed',
  'iptv_account_expired',
  'iptv_unreachable',
  'iptv_timeout',
  'iptv_bad_list',
  'iptv_empty',
] as const satisfies readonly ErrorCode[];

/* Abrir un id IPTV (docs/iptv.md §4.1 y §6): uno que ya no vale responde
   sin tocar el motor (`iptv_gone`, `iptv_disabled`, `iptv_removed`); los
   demás son fallos de la apertura. Todos son de fuente: agotan la fuente. */
const IPTV_STREAM_ERRORS = [
  'iptv_gone',
  'iptv_disabled',
  'iptv_removed',
  'iptv_secret_unreadable',
  'iptv_busy',
  'iptv_auth_failed',
  'iptv_account_expired',
  'iptv_unreachable',
  'iptv_timeout',
  'iptv_unsupported',
] as const satisfies readonly ErrorCode[];

/* Abrir un título de Películas y series (docs/vod.md §11.3 y §9.12). Los
   `vod_*` son suyos: nunca agotan una fuente ni pasan a AceStream. */
const VOD_STREAM_ERRORS = [
  'vod_unavailable',
  'vod_not_found',
  'vod_unsupported',
  'vod_busy',
  'vod_timeout',
  'vod_dropped',
  'vod_provider_error',
  'vod_disk_full',
  'vod_account',
  'remux_busy',
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
    access: 'any',
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
      'Espera a que la URL sea reproducible (la sesión abierta o, en iOS, el remux listo). Si el cliente cuelga, se cancela. Arquitectura §6.3. ' +
      'Con un id IPTV (docs/iptv.md §6.4) la sesión sale del relé y del remux: la web recibe `hls` en `/api/v1/video/<sid>/index.m3u8` sin token y el iPhone `hls-fmp4`, los dos con `source: iptv`.',
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
      ...IPTV_STREAM_ERRORS,
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
    access: 'any',
    credential: 'video-token',
    module: 'remux',
    summary:
      'Lista y segmentos del remux para AVPlayer y, con la IPTV, para hls.js (Range, 206/416, no-store)',
    description:
      'Desde /native, `?t=` obligatorio: el backend reescribe cada m3u8 y añade `?t=` a cada URI, también a `#EXT-X-MAP:URI` (arquitectura §5.12). ' +
      'Desde la web (docs/iptv.md §5.4), sin token: `t` se ignora y la lista sale sin `?t=`. La sesión tiene que existir y tener remux vivo; si no, error como hoy.',
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
    access: 'any',
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

  // --- Ajustes → Copia de seguridad (solo web, decisiones.md D25) ---
  backupExport: defineRoute({
    method: 'GET',
    path: '/api/v1/backup',
    access: 'web',
    credential: 'bearer',
    module: 'state',
    summary: 'Descargar la copia de seguridad de tus ajustes (sin la contraseña de la IPTV)',
    description:
      'Responde el fichero `ace-player-neo-copia-AAAA-MM-DD.json` como descarga (`Content-Disposition: attachment`). ' +
      'Lleva favoritos, recientes, listas, «Tu fútbol», vínculos, correcciones, ajustes y la IPTV sin contraseña (Xtream: servidor y usuario; M3U: solo el host). ' +
      'Nunca dispositivos, tokens, sesiones ni la semilla. Pasa por la regla anti-CSRF (`sideEffects`): lleva datos personales.',
    response: BackupFileSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),
  backupExportSecret: defineRoute({
    method: 'POST',
    path: '/api/v1/backup/export',
    access: 'web',
    credential: 'bearer',
    module: 'state',
    summary:
      'Descargar la copia con la contraseña de la IPTV, protegida con una clave (scrypt + AES-256-GCM)',
    description:
      'La contraseña (Xtream) o la URL de la lista (M3U) van cifradas con la clave que escribe Isma; nunca en claro. ' +
      'La clave no se guarda ni se registra. Sin IPTV, la misma copia que GET.',
    body: BackupExportBodySchema,
    response: BackupFileSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['iptv_secret_unreadable'],
    legacyTwin: null,
  }),
  backupImport: defineRoute({
    method: 'POST',
    path: '/api/v1/backup/import',
    access: 'web',
    credential: 'bearer',
    module: 'state',
    summary: 'Restaurar una copia: vista previa (`dryRun`) o aplicarla (Reemplazar o Combinar)',
    description:
      'Valida la copia (formato, versión y topes). Con `dryRun` (por defecto) solo cuenta lo que cambiaría. ' +
      'Al aplicar escribe state.json de una vez en la cola del estado (tmp + rename), luego los ajustes y la IPTV, y emite `state.changed`. ' +
      'Nunca toca dispositivos emparejados, sesiones ni «quién tiene el mando». Una IPTV sin contraseña en la copia no sustituye a la de ahora.',
    body: BackupImportBodySchema,
    response: BackupImportResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [
      'backup_invalid',
      'backup_version_unsupported',
      'backup_too_large',
      'backup_passphrase_wrong',
    ],
    legacyTwin: null,
  }),

  // --- Ajustes → IPTV (solo web, docs/iptv.md §5.3) ---
  iptvGet: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Tu IPTV: tipo, nombre, host, estado, cuenta y guía (nunca URL, usuario ni contraseña)',
    response: IptvViewSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  iptvSave: defineRoute({
    method: 'PUT',
    path: '/api/v1/iptv',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Conectar o cambiar la IPTV (M3U o Xtream): prueba rápida, cifra, guarda y sincroniza de fondo',
    description:
      'Un secreto ausente es «el guardado». Al crear, o si cambia el tipo o el origen del servidor, son obligatorios (`iptv_credentials_required`). ' +
      'Si la prueba rápida falla no guarda nada. Responde `syncing`; el recuento llega por SSE (`iptv.status`). Aborta la sincronización en curso.',
    body: IptvSaveBodySchema,
    response: IptvViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: IPTV_SAVE_ERRORS,
    legacyTwin: null,
  }),
  iptvUpdate: defineRoute({
    method: 'PATCH',
    path: '/api/v1/iptv',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Pausar o reanudar la IPTV, o cambiarle el nombre',
    description:
      'En pausa se guarda pero no se ofrece; cierra las sesiones IPTV vivas y conserva el catálogo.',
    body: IptvUpdateBodySchema,
    response: IptvViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['iptv_not_configured'],
    legacyTwin: null,
  }),
  iptvSync: defineRoute({
    method: 'POST',
    path: '/api/v1/iptv/sync',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Actualizar ya la lista de la IPTV (responde syncing; el recuento llega por SSE)',
    response: IptvViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['iptv_not_configured', 'iptv_disabled'],
    legacyTwin: null,
  }),
  iptvDelete: defineRoute({
    method: 'DELETE',
    path: '/api/v1/iptv',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Eliminar la IPTV y todos sus datos del Umbrel (copias incluidas)',
    description:
      'Aborta los trabajos en curso, cierra las sesiones IPTV y borra configuración, catálogo, guía, `.bak` y copias apartadas. Los ids de antes dan 410 `iptv_removed`.',
    response: IptvViewSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),

  iptvChannels: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/channels',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Buscar canales en tu IPTV (2 a 80 letras; hasta 50, España o sin país, sin adultos)',
    description:
      'Buscador de la web (docs/iptv.md §14): una fila por canal (la mejor variante) con su nombre limpio, la calidad, el nombre del proveedor y los ids de tu biblioteca que son ese canal. ' +
      'Nunca lleva URL, grupo ni nada más del proveedor. Sin IPTV activa responde 200 con la lista vacía. Nada se lista sin escribir al menos 2 letras.',
    query: IptvChannelsQuerySchema,
    response: IptvChannelsResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['empty_query'],
    legacyTwin: null,
  }),
  iptvBrowse: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/browse',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Recorrer tu IPTV como la ordena el proveedor: categorías, canales por páginas, texto y filtros con facetas',
    description:
      'La pestaña IPTV de Canales (docs/iptv.md §16): categorías del proveedor en su orden y con su número de canales, una fila por canal (nombre limpio y país) con sus calidades, ' +
      'filtros de país, idioma, tipo, deporte y calidad (O dentro de un filtro, Y entre filtros) con sus recuentos, y páginas de 60 con `nextCursor`. ' +
      'El servidor filtra, pagina y cuenta sobre un índice en memoria. Sin IPTV activa responde 200 con `active: false`; una categoría que ya no existe, `category: null`; un cursor de otro catálogo, la primera página con `stale: true`. ' +
      'Nunca lleva URL, `stream_id`, `tvg-id` ni credenciales.',
    query: IptvBrowseQuerySchema,
    response: IptvBrowseResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    /* Una consulta o un cursor mal formados: `validation_error` (de COMMON_V1_ERRORS). */
    errors: [],
    legacyTwin: null,
  }),

  // --- Guía TV (solo web por ahora, docs/iptv.md §20.6) ---
  iptvGuide: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/guide',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Guía TV: estado de la guía y canales con programación por páginas (Favoritos o Todos)',
    description:
      'La parrilla de la Guía TV (docs/iptv.md §20). Da el estado de la guía, su sello (`version`), lo que cubre (`from`, `to`) y una página de canales: ' +
      '`favorites` (tus favoritos en su orden, también los que no tienen guía) o `all` (todos los canales con programación, España y sin país primero, en el orden del proveedor). ' +
      'Con `favorites` y ningún favorito con guía, responde `all` con `fellBack: true`. Sin IPTV activa responde 200 con `state: inactive`: no es un error. ' +
      'Nunca lleva URL, `stream_id`, `tvg-id` ni credenciales.',
    query: IptvGuideQuerySchema,
    response: IptvGuideResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  iptvGuideProgrammes: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/guide/programmes',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Guía TV: los programas de un trozo de la parrilla (hasta 60 canales × 12 h)',
    description:
      'Programas que se solapan con [`from`, `to`) de cada canal de la guía pedido, ordenados y sin solaparse entre sí, con título y marcas (docs/iptv.md §20.6). ' +
      'Con la `v` de ahora, `private, max-age=86400, immutable` (el trozo de una guía no cambia nunca); con otra, 409 `guide_stale`. Sin guía, 409 `guide_unavailable`.',
    query: IptvGuideProgrammesQuerySchema,
    response: IptvGuideProgrammesResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['guide_unavailable', 'guide_stale'],
    legacyTwin: null,
  }),
  iptvGuideProgramme: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/guide/programmes/:id',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Guía TV: la ficha de un programa (sinopsis, episodio, edad, nota, reparto…)',
    description:
      'Lo que la guía dice de un programa, para «Más info» (docs/iptv.md §20.6). El id solo vale con su `v`: con otra, 409 `guide_stale`; uno que no existe, 404 `not_found`.',
    params: IptvGuideProgrammeParamsSchema,
    query: IptvGuideVersionQuerySchema,
    response: IptvGuideProgrammeDetailSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['guide_unavailable', 'guide_stale'],
    legacyTwin: null,
  }),
  iptvGuideNow: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/guide/now',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Guía TV: «ahora / después» de unos canales IPTV (para Canales)',
    description:
      'Para cada id IPTV pedido (los de las filas de la pestaña IPTV o del buscador), lo que echa ahora y lo siguiente según la guía (docs/iptv.md §20.6). ' +
      'Sin guía o sin IPTV activa, 200 con `available: false`: no es un error.',
    query: IptvGuideNowQuerySchema,
    response: IptvGuideNowResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  iptvGuideArt: defineRoute({
    method: 'GET',
    path: '/api/v1/iptv/guide/art/:ref',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Guía TV: logo de un canal o imagen de un programa (JPEG, PNG o WebP) por el proxy propio',
    description:
      'Solo recibe referencias de la guía, nunca URLs (docs/iptv.md §20.6). Con la `v` de ahora, `private, max-age=86400, immutable`; con otra, 409 `guide_stale`. ' +
      "`If-None-Match` da 304. Solo imágenes raster por bytes mágicos, con `nosniff` y `Content-Security-Policy: default-src 'none'`. Sin imagen, 404 `not_found`; con la cola llena, 503 `guide_busy` con `Retry-After`.",
    params: IptvGuideArtParamsSchema,
    query: IptvGuideVersionQuerySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: false,
    errors: ['guide_unavailable', 'guide_stale', 'guide_busy'],
    legacyTwin: null,
  }),

  // --- Películas y series (solo web por ahora, docs/vod.md §11.1, D-VOD19) ---
  vodHome: defineRoute({
    method: 'GET',
    path: '/api/v1/vod',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Portada de Películas y series en una petición: «Seguir viendo», novedades, series actualizadas, categorías y distintivos',
    description:
      'Estado del catálogo VOD (docs/vod.md §4.8 y §6.4, D-VOD28). «Novedades en películas» y «Series actualizadas» van sin adultos (D-VOD7). ' +
      'Sin IPTV activa, en pausa, con M3U o sin VOD responde 200 con `active: false` o su `state`: no es un error. Nunca lleva URL, `stream_id` ni credenciales. ' +
      'Con `langs` (y `unknown`), novedades, categorías y distintivos van filtrados por idioma (§4.10); `langs` y `noLang` cuentan siempre el catálogo entero.',
    query: VodHomeQuerySchema,
    response: VodHomeSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  vodBrowse: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/browse',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary:
      'Rejilla y buscador de películas o series: categoría, distintivo, texto y orden, por páginas',
    description:
      'Por tipo (`kind`), con `otherKindTotal` para «Ver 3 series» (docs/vod.md §6, D-VOD5). Con `q` (2 a 80 letras) manda la relevancia; sin ella, `added` o `name`. ' +
      'Los 2 000 mejores como mucho (`capped`); un cursor de otro catálogo da la primera página con `stale: true`. El texto buscado no va al registro.',
    query: VodBrowseQuerySchema,
    response: VodBrowseResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    /* Una consulta o un cursor mal formados: `validation_error` (de COMMON_V1_ERRORS). */
    errors: ['empty_query'],
    legacyTwin: null,
  }),
  vodTitle: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/titles/:id',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Ficha de una película o una serie (con temporadas y episodios)',
    description:
      'Pide la ficha al proveedor por una cola (1 en vuelo, 300 ms, 60 por minuto; docs/vod.md §7, D-VOD30). Nunca queda en blanco: si el proveedor falla, ' +
      'lo que se sabe por la lista con `info: failed`; con `pre=1` y la cola ocupada, `info: pending`.',
    params: VodTitleParamsSchema,
    query: VodTitleQuerySchema,
    response: VodTitleSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: ['vod_not_found', 'vod_unavailable'],
    legacyTwin: null,
  }),
  vodArt: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/titles/:id/art/:art',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Cartel, fondo o fotograma de un título (JPEG, PNG o WebP) por el proxy propio',
    description:
      'Solo recibe ids, nunca URLs (docs/vod.md §8, D-VOD8). Con la `v` correcta, `private, max-age=31536000, immutable`; sin ella o con otra, `private, no-cache`. ' +
      "`If-None-Match` da 304. Solo imágenes raster por bytes mágicos, con `nosniff` y `Content-Security-Policy: default-src 'none'`. Sin imagen, 404 `vod_not_found`.",
    params: VodArtParamsSchema,
    query: VodArtQuerySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: false,
    errors: ['vod_not_found'],
    legacyTwin: null,
  }),
  vodStream: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/titles/:id/stream',
    access: 'web',
    credential: 'bearer',
    module: 'playback',
    summary: 'Abrir una película o un episodio y recibir su lista HLS VOD completa',
    description:
      'Sesión IPTV del relé VOD y del productor (docs/vod.md §9): la web recibe `hls` en `/api/v1/video/<sid>/index.m3u8` sin token y el iPhone `hls-fmp4` con `?t=`, los dos con `source: iptv`. ' +
      'No espera al primer segmento: la lista sale del índice. Tope de 40 s en el servidor (§9.12). Dos cosas por IPTV a la vez siguen la regla de la casa: la nueva corta la anterior.',
    params: VodTitleParamsSchema,
    query: VodStreamQuerySchema,
    response: VodGrantSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: VOD_STREAM_ERRORS,
    legacyTwin: null,
  }),
  vodProgress: defineRoute({
    method: 'POST',
    path: '/api/v1/vod/titles/:id/progress',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Guardar el progreso de una película o un episodio, o marcarlo (204 sin cuerpo)',
    description:
      'Progreso por casa en `v2/vod.json` (docs/vod.md §10, D-VOD17). `tick` se vuelca como mucho una vez por minuto; lo demás, al momento. ' +
      'El servidor valida la posición contra la duración (`posS ≤ durS + 5`, ±10 % de la del índice); si no cumple, `validation_error` y no se guarda.',
    params: VodTitleParamsSchema,
    body: VodProgressBodySchema,
    response: null,
    status: 204,
    content: 'empty',
    sideEffects: true,
    errors: ['vod_not_found'],
    legacyTwin: null,
  }),
  vodLanguagesGet: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/languages',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Los idiomas elegidos para Películas y series (castellano y latino, aparte)',
    description:
      'Por casa, en `v2/vod-idiomas.json` (docs/vod.md §4.10): valen en el PC y en el iPhone y no dependen del proveedor. ' +
      '`chosen: false` hasta la primera elección (la web enseña el selector). `langs` vacía = todos los idiomas.',
    response: VodLanguagesSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  vodLanguagesUpdate: defineRoute({
    method: 'PUT',
    path: '/api/v1/vod/languages',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Elegir los idiomas de Películas y series (sustituye la elección)',
    description:
      'Guarda la elección (`chosen` pasa a `true`) y la devuelve. Los idiomas repetidos se juntan. Entra en la copia de seguridad.',
    body: VodLanguagesBodySchema,
    response: VodLanguagesSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),
  vodListGet: defineRoute({
    method: 'GET',
    path: '/api/v1/vod/list',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: '«Mi lista»: las películas y series guardadas para ver luego',
    description:
      'Por casa, en `v2/vod-mi-lista.json` (0.9.1): vale en el PC y en el iPhone y entra en la copia de seguridad. De la más nueva a la más vieja, ' +
      'SIN filtrar por los idiomas elegidos. Lo que ya no está en el catálogo sale con `available: false` («Ya no está en tu IPTV»); en las series empezadas, ' +
      '`upTo` dice por qué episodio se va.',
    response: VodListSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  vodListAdd: defineRoute({
    method: 'PUT',
    path: '/api/v1/vod/list/:id',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Añadir una película o una serie a «Mi lista» (si ya está, no cambia nada)',
    description:
      'Solo películas y series del catálogo (un episodio da `vod_not_found`). Idempotente: si ya estaba, se queda donde estaba. ' +
      'Con la lista llena (500), `vod_list_full`. Devuelve la lista entera y avisa a las demás pestañas (`state.changed` con `vod`).',
    params: VodListParamsSchema,
    response: VodListSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: ['vod_not_found', 'vod_unavailable', 'vod_list_full'],
    legacyTwin: null,
  }),
  vodListRemove: defineRoute({
    method: 'DELETE',
    path: '/api/v1/vod/list/:id',
    access: 'web',
    credential: 'bearer',
    module: 'iptv',
    summary: 'Quitar un título de «Mi lista»',
    description:
      'Idempotente: quitar uno que no está devuelve la lista igual. Vale también para los que ya no están en el catálogo. Devuelve la lista entera.',
    params: VodListParamsSchema,
    response: VodListSchema,
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
    access: 'any',
    credential: 'bearer',
    module: 'auth',
    summary: 'Crear un código de 6 dígitos y su QR (5 min, un solo uso, anula el anterior)',
    description:
      'Desde la web (su dirección en baseUrl) o desde un iPhone emparejado (baseUrl = la dirección que usa ahora; alternateBaseUrls = la otra, casa o Tailscale). El QR lleva una u= por dirección, en ese orden. Si lo crea un iPhone y luego se revoca, su código muere.',
    body: PairingCreateBodySchema,
    response: PairingCreateResponseSchema,
    status: 201,
    content: 'json',
    sideEffects: true,
    errors: ['bad_request', 'pairing_rate_limited'],
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
    access: 'any',
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
    access: 'any',
    credential: 'bearer',
    module: 'auth',
    summary: 'Revocar un dispositivo: cierra su SSE, suelta sus visores y anula sus URLs de vídeo',
    description:
      'Web o cualquier iPhone emparejado; también el propio (entonces responde 200 y todo lo suyo deja de valer al instante: su SSE recibe devices.changed revoked y se cierra).',
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
  diagnosticsExport: defineRoute({
    method: 'POST',
    path: '/api/v1/diagnostics/export',
    access: 'web',
    credential: 'bearer',
    module: 'diagnostics',
    summary: '«Descargar fallos» de Salud: un fichero con fallos y registro, redactado',
    description:
      'La web manda su anillo de errores (`web`) y recibe el fichero `ace-player-neo-fallos-AAAA-MM-DD-HHMM.json` ' +
      '(`Content-Disposition: attachment`): versión, entorno, estado de motor/IPTV/remux, fallos clasificados en ' +
      '«nuestro» y «de fuera» con un resumen, y el registro del servidor y de la web. Todo pasa por el redactor ' +
      'de la IPTV y por el del informe: sin contraseñas, usuarios, tokens, cookies, URLs con credenciales ni IPs ' +
      'públicas. Solo web: lleva el registro del servidor.',
    body: DiagnosticsExportBodySchema,
    response: DiagnosticsExportSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),
  diagnosticsLogInfo: defineRoute({
    method: 'GET',
    path: '/api/v1/diagnostics/log',
    access: 'web',
    credential: 'bearer',
    module: 'diagnostics',
    summary: '«Descargar logs» de Ajustes → Registro: cuánto registro hay guardado en el disco',
    description:
      'El servidor guarda su registro (y los errores que manda la web) en `<DATA_DIR>/v2/registro/`, un fichero por día, ' +
      'redactado al escribirse, unos 45 días y como mucho 40 MiB (docs/registro.md). Solo web.',
    response: DiagnosticsLogInfoSchema,
    status: 200,
    content: 'json',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  diagnosticsLogDownload: defineRoute({
    method: 'POST',
    path: '/api/v1/diagnostics/log/download',
    access: 'web',
    credential: 'bearer',
    module: 'diagnostics',
    summary: '«Descargar logs»: un zip con el registro del último día, semana o mes, redactado',
    description:
      'La web manda el periodo y lo suyo (como en «Descargar fallos») y recibe `ace-player-neo-logs-AAAA-MM-DD-HHMM.zip` ' +
      '(`Content-Disposition: attachment`, `no-store`) con LEEME.txt, resumen.json (LogsSummary), fallos.json ' +
      '(DiagnosticsExport) y registro.jsonl (las líneas del periodo, de la más vieja a la más nueva). Todo redactado: ' +
      'sin contraseñas, usuarios, tokens, cookies, URLs con credenciales ni IPs públicas. Solo web.',
    body: DiagnosticsLogDownloadBodySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: true,
    errors: [],
    legacyTwin: null,
  }),
  diagnosticsWebLog: defineRoute({
    method: 'POST',
    path: '/api/v1/diagnostics/web-log',
    access: 'web',
    credential: 'bearer',
    module: 'diagnostics',
    summary: 'La web manda sus errores importantes para que queden en el registro del servidor',
    description:
      'Excepciones, promesas sin capturar, errores de la consola, peticiones que fallan y avisos del reproductor ' +
      `(nunca las notas), en tandas de ${WEB_LOG_UPLOAD_MAX_ENTRIES} como mucho. Por encima de ${WEB_LOG_UPLOAD_PER_MINUTE} ` +
      'por minuto (en total) no se guardan y se cuentan en `dropped`; tampoco los fallos del reproductor que ya llegaron ' +
      'por el registro de fallos. Se redactan antes de escribirse. Solo web.',
    body: WebLogUploadBodySchema,
    response: WebLogUploadResponseSchema,
    status: 200,
    content: 'json',
    sideEffects: true,
    errors: [],
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

  // --- Escudos y logos (módulo teams) ---
  footballTeamCrest: defineRoute({
    method: 'GET',
    path: '/api/v1/football/teams/:teamId/crest',
    access: 'any',
    credential: 'bearer',
    module: 'teams',
    summary: 'Escudo del equipo (PNG) con ETag y caché larga',
    description:
      'El `id` sale de `homeTeam`/`awayTeam` de la agenda. Con `?v=<etag>` (la URL que da la agenda) ' +
      'la respuesta es `public, max-age=31536000, immutable`; sin él, `private, max-age=86400`. ' +
      '`If-None-Match` da 304 sin cuerpo. Un id sin escudo da 404 `not_found`: el cliente pinta el escudo generado. Sin Range ni HEAD.',
    params: TeamCrestParamsSchema,
    query: BadgeVersionQuerySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
  }),
  footballCompetitionLogo: defineRoute({
    method: 'GET',
    path: '/api/v1/football/competitions/:competitionId/logo',
    access: 'any',
    credential: 'bearer',
    module: 'teams',
    summary: 'Logo de la competición (PNG) con ETag y caché larga',
    description:
      'El `id` sale de `competitionBadge` de la agenda. Mismas cabeceras y caché que el escudo del equipo.',
    params: CompetitionLogoParamsSchema,
    query: BadgeVersionQuerySchema,
    response: null,
    status: 200,
    content: 'binary',
    sideEffects: false,
    errors: [],
    legacyTwin: null,
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
