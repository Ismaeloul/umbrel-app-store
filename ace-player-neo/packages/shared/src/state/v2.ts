/* Ficheros nuevos de la 0.7.0 bajo `data/v2/` (arquitectura §5.4). La
   0.6.59 no los mira, así que una vuelta atrás no los pisa ni los necesita.
   state.json sigue en forma v1 más `schemaVersion: 2`. */

import { z } from 'zod';
import {
  DeviceIdSchema,
  HashSchema,
  IsoDateTimeSchema,
  SessionIdSchema,
  ShortCodeSchema,
} from '../primitives.js';
import { IPTV_NAME_MAX } from '../constants/iptv.js';
import { VOD_PROGRESS } from '../constants/vod.js';
import { StateV1Schema } from './v1.js';

/** Versión de esquema que escribe la 0.7.0. Ausente = 1 (arquitectura §5.4). */
export const SCHEMA_VERSION = 2;

/** Rutas relativas a `DATA_DIR`. */
export const V2_FILES = {
  dir: 'v2',
  devices: 'v2/devices.json',
  settings: 'v2/settings.json',
  /** «Arranque instantáneo» (D24): aparte de settings.json para no romper la vuelta atrás. */
  instantStart: 'v2/arranque-instantaneo.json',
  sessions: 'v2/sessions.json',
  diagnostics: 'v2/diagnostics.jsonl',
  /** IPTV (docs/iptv.md §2.1): configuración con los secretos cifrados (0600). */
  iptv: 'v2/iptv.json',
  /** Carpeta de la IPTV (0700): catálogo y guía cifrados y, sin semilla, la clave. */
  iptvDir: 'v2/iptv',
  iptvCatalog: 'v2/iptv/catalogo.enc',
  iptvGuide: 'v2/iptv/guia.enc',
  /** 32 bytes aleatorios, solo si no hay `ACE_SEED` ni `ENGINE_CONTROL_TOKEN`. */
  iptvKey: 'v2/iptv/clave',
  /**
   * Películas y series (docs/vod.md §10.1): progreso, «Seguir viendo»,
   * preferencias y el resumen del catálogo (0600). Se crea en la primera
   * escritura. Nunca en `state.json` (T4).
   */
  vod: 'v2/vod.json',
  /** Catálogo VOD binario y cifrado (§4.6). */
  vodCatalog: 'v2/iptv/vod.enc',
  /** Caché en disco de los carteles (§8): `arte/<ab>/<HMAC 32 hex>`. */
  vodArt: 'v2/iptv/arte',
} as const;

/** state.json tal y como lo escribe la 0.7.0: las 12 claves v1 más la versión. */
export const StateFileV2Schema = StateV1Schema.extend({
  schemaVersion: z.literal(SCHEMA_VERSION),
});
export type StateFileV2 = z.infer<typeof StateFileV2Schema>;

// --- v2/settings.json ---

/**
 * Qué pasa cuando un segundo dispositivo abre el MISMO canal (D5):
 * - `share`: se comparte la sesión (pasa a HLS). Por defecto.
 * - `handoff`: el último que da al play se queda el mando, como la 0.6.59.
 * Con canales distintos siempre hay traspaso, sea cual sea la política.
 */
export const SameChannelPolicySchema = z.enum(['share', 'handoff']);
export type SameChannelPolicy = z.infer<typeof SameChannelPolicySchema>;
export const DEFAULT_SAME_CHANNEL_POLICY: SameChannelPolicy = 'share';

/** Ajustes v2 que ve y cambia la interfaz. */
export const SettingsSchema = z.strictObject({
  sameChannelPolicy: SameChannelPolicySchema.default(DEFAULT_SAME_CHANNEL_POLICY),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  settings: SettingsSchema,
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

// --- v2/arranque-instantaneo.json (D24) ---

/** «Arranque instantáneo» viene activado de fábrica. */
export const DEFAULT_INSTANT_START = true;

/**
 * `v2/arranque-instantaneo.json`. No va en `settings.json`: es
 * `strictObject` y la 0.8.3 apartaría el fichero (y con él la política de
 * mismo canal) tras una vuelta atrás. Es `z.object` (no estricto) a
 * propósito: un campo de una versión futura se ignora, no aparta el fichero.
 */
export const InstantStartFileSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type InstantStartFile = z.infer<typeof InstantStartFileSchema>;

// --- v2/devices.json ---

export const DevicePlatformSchema = z.enum(['ios', 'ipados', 'macos', 'other']);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

/**
 * Dispositivo emparejado. Del token (`<deviceId>.<secreto de 256 bits>`)
 * solo se guarda `sha256(secreto)` en hex: el token en claro solo existe en
 * la respuesta del emparejamiento y en el Llavero del iPhone (arquitectura §5.12).
 */
export const DeviceRecordSchema = z.strictObject({
  id: DeviceIdSchema,
  name: z.string().min(1).max(60),
  platform: DevicePlatformSchema,
  secretSha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: IsoDateTimeSchema,
  /** Se actualiza como mucho una vez por minuto. */
  lastSeenAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

export const DevicesFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  devices: z.array(DeviceRecordSchema),
});
export type DevicesFile = z.infer<typeof DevicesFileSchema>;

// --- v2/sessions.json ---

export const EngineSessionKindSchema = z.enum(['id', 'infohash']);
export type EngineSessionKind = z.infer<typeof EngineSessionKindSchema>;

/** progresivo = `getstream` (un solo consumidor); hls = `manifest.m3u8` (compartible). */
export const EngineSessionModeSchema = z.enum(['progressive', 'hls']);
export type EngineSessionMode = z.infer<typeof EngineSessionModeSchema>;

/**
 * Sesión abierta en el motor principal. Se guarda para poder pararla con
 * `command_url` si el proceso muere: al arrancar, se paran las que queden
 * de un proceso anterior (sin zombis, arquitectura §5.6).
 */
export const PersistedSessionSchema = z.strictObject({
  id: SessionIdSchema,
  hash: HashSchema,
  kind: EngineSessionKindSchema,
  mode: EngineSessionModeSchema,
  /** Ruta relativa `/ace/cmd/…` del motor. */
  commandUrl: z.string().min(1),
  openedAt: IsoDateTimeSchema,
});
export type PersistedSession = z.infer<typeof PersistedSessionSchema>;

export const SessionsFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sessions: z.array(PersistedSessionSchema),
});
export type SessionsFile = z.infer<typeof SessionsFileSchema>;

// --- v2/iptv.json (docs/iptv.md §2) ---

/** Tipo de proveedor: una lista M3U por URL o Xtream Codes (`player_api.php`). */
export const IptvKindSchema = z.enum(['m3u', 'xtream']);
export type IptvKind = z.infer<typeof IptvKindSchema>;

/**
 * Id del proveedor: aleatorio al crear, nuevo al eliminar y al cambiar el
 * origen o el tipo (§1.4, D11). Entra en el HMAC de los ids de canal, así que
 * cambiarlo cambia todos los ids.
 */
export const IptvProviderIdSchema = z
  .string()
  .regex(/^p_[A-Za-z0-9_-]{8}$/, 'id de proveedor IPTV');
export type IptvProviderId = z.infer<typeof IptvProviderIdSchema>;

/** Estado de la cuenta según `user_info` de Xtream. */
export const IptvAccountStatusSchema = z.enum([
  'active',
  'expired',
  'banned',
  'disabled',
  'unknown',
]);
export type IptvAccountStatus = z.infer<typeof IptvAccountStatusSchema>;

/**
 * Bloque cifrado con AES-256-GCM (§2.3). El AAD es
 * `ace-iptv|<provider.id>|<kind>`, para que no se pueda pegar el bloque de
 * otro proveedor. En claro: M3U `{ url }`; Xtream `{ server, username, password }`.
 */
export const SealedSchema = z.strictObject({
  alg: z.literal('A256GCM'),
  /** 12 bytes en base64url sin relleno. */
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/, 'base64url de 12 bytes'),
  /** 16 bytes en base64url sin relleno. */
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'base64url de 16 bytes'),
  data: z
    .string()
    .max(64 * 1024)
    .regex(/^[A-Za-z0-9_-]+$/, 'base64url'),
});
export type Sealed = z.infer<typeof SealedSchema>;

export const IptvLastSyncSchema = z.strictObject({
  at: IsoDateTimeSchema,
  ok: z.boolean(),
  channels: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  error: ShortCodeSchema.nullable(),
});
export type IptvLastSync = z.infer<typeof IptvLastSyncSchema>;

export const IptvGuideStateSchema = z.strictObject({
  at: IsoDateTimeSchema,
  ok: z.boolean(),
  channelsWithGuide: z.number().int().nonnegative(),
  programmes: z.number().int().nonnegative(),
  error: ShortCodeSchema.nullable(),
});
export type IptvGuideState = z.infer<typeof IptvGuideStateSchema>;

/** Solo Xtream (`user_info`). */
export const IptvAccountStateSchema = z.strictObject({
  status: IptvAccountStatusSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  maxConnections: z.number().int().nonnegative().nullable(),
  activeConnections: z.number().int().nonnegative().nullable(),
  checkedAt: IsoDateTimeSchema,
});
export type IptvAccountState = z.infer<typeof IptvAccountStateSchema>;

export const IptvProviderRecordSchema = z.strictObject({
  id: IptvProviderIdSchema,
  /** Sube con cada cambio de datos: un resultado de sincronización de otra `revision` no se aplica (§3.4). */
  revision: z.number().int().nonnegative(),
  kind: IptvKindSchema,
  name: z.string().min(1).max(IPTV_NAME_MAX),
  enabled: z.boolean(),
  /** `nombre[:puerto]`, sin credenciales, esquema, ruta ni query. */
  host: z.string().max(260),
  /** Solo Xtream: `esquema://host[:puerto]`, sin ruta. */
  origin: z.string().max(300).nullable(),
  secret: SealedSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastSync: IptvLastSyncSchema.nullable(),
  guide: IptvGuideStateSchema.nullable(),
  account: IptvAccountStateSchema.nullable(),
});
export type IptvProviderRecord = z.infer<typeof IptvProviderRecordSchema>;

/**
 * `v2/iptv.json`. No va en `settings.json` (es `strictObject` y la 0.8.0
 * apartaría el fichero) ni en `state.json`. Sin listas de ids: un id IPTV se
 * reconoce solo por su etiqueta (§4.1), así que nada de aquí crece sin tope.
 * `provider: null` = sin IPTV (o eliminada).
 */
export const IptvFileSchema = z.strictObject({
  version: z.literal(1),
  provider: IptvProviderRecordSchema.nullable(),
});
export type IptvFile = z.infer<typeof IptvFileSchema>;

// --- v2/vod.json (Películas y series, docs/vod.md §10.1) ---

/**
 * Estado del catálogo VOD (§4.8):
 * - `off`: sin IPTV, o en pausa.
 * - `unsupported`: IPTV por M3U (la v1 es solo Xtream, D-VOD1).
 * - `preparing`: primera sincronización en marcha, o cargando `vod.enc`.
 * - `ready`: hay catálogo (con `stale` si la última sincronización falló).
 * - `none`: el proveedor no tiene VOD.
 * - `error`: falló y no hay catálogo guardado.
 */
export const VodCatalogStateSchema = z.enum([
  'off',
  'preparing',
  'ready',
  'none',
  'unsupported',
  'error',
]);
export type VodCatalogState = z.infer<typeof VodCatalogStateSchema>;

/** Una película o un episodio con progreso (§10.1). Los ids son sellados (§5): nunca el `stream_id`. */
export const VodProgressEntrySchema = z.strictObject({
  /** Película o episodio (id sellado). */
  id: HashSchema,
  kind: z.enum(['movie', 'episode']),
  seriesId: HashSchema.nullable(),
  /** La película o la serie. */
  title: z.string().min(1).max(200),
  /** «T2 · E5 · El regreso». */
  subtitle: z.string().max(120).nullable(),
  season: z.number().int().min(0).max(999).nullable(),
  episode: z.number().int().min(0).max(9_999).nullable(),
  posS: z.number().min(0).max(86_400),
  durS: z.number().min(0).max(86_400),
  watched: z.boolean(),
  /** «Quitar de Seguir viendo». */
  hidden: z.boolean(),
  /** Se rellena al acabar un episodio: el siguiente que propone «Seguir viendo». */
  next: z.strictObject({ id: HashSchema, label: z.string().max(80) }).nullable(),
  updatedAt: z.number().int(),
});
export type VodProgressEntry = z.infer<typeof VodProgressEntrySchema>;

/** Preferencia de audio y subtítulos de una serie o una película (§10.4). */
export const VodPrefSchema = z.strictObject({
  /** Serie o película. */
  id: HashSchema,
  /** Lengua ('spa', 'eng'…). */
  audio: z.string().max(8).nullable(),
  /** Lengua, `forced` u `off` (reservado para los subtítulos, §9.10). */
  subtitle: z.string().max(12).nullable(),
  updatedAt: z.number().int(),
});
export type VodPref = z.infer<typeof VodPrefSchema>;

/** Resumen del catálogo sin abrir `vod.enc` (§4.6): con él responden `features.vod` y Ajustes. */
export const VodCatalogSummarySchema = z.strictObject({
  state: VodCatalogStateSchema,
  movies: z.number().int(),
  series: z.number().int(),
  builtAt: IsoDateTimeSchema.nullable(),
  truncated: z.boolean(),
  skipped: z.number().int(),
});
export type VodCatalogSummary = z.infer<typeof VodCatalogSummarySchema>;

/**
 * `v2/vod.json`: por casa, no por aparato (D-VOD17). `providerFp` es
 * HMAC(k_vod, provider.id): con otro proveedor todos los ids cambian y el
 * documento se vacía (§10.5). `progress` es una LRU por `updatedAt`.
 */
export const VodDocSchema = z.strictObject({
  v: z.literal(1),
  providerFp: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .nullable(),
  catalog: VodCatalogSummarySchema.nullable(),
  progress: z.array(VodProgressEntrySchema).max(VOD_PROGRESS.itemsMax),
  prefs: z.array(VodPrefSchema).max(VOD_PROGRESS.prefsMax),
});
export type VodDoc = z.infer<typeof VodDocSchema>;
