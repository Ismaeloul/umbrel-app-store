/* Ajustes → IPTV en /api/v1 (docs/iptv.md §5.3). Las 5 rutas son solo web:
   el iPhone recibe 403 `origin_forbidden` y no configura nada.

   Regla de oro: NADA de lo que devuelve el servidor lleva la URL de la
   lista, el usuario ni la contraseña (§1.4 y §2.4). `IptvView` solo dice si
   están guardados (`hasUrl`, `hasUsername`, `hasPassword`), el `host` y, en
   Xtream, el `origin` para rellenar «Servidor». Un test de forma lo vigila. */

import { z } from 'zod';
import { HashSchema, IsoDateTimeSchema, ShortCodeSchema } from '../../primitives.js';
import {
  IPTV_NAME_MAX,
  IPTV_REFRESH_HOURS,
  IPTV_SEARCH,
  IPTV_SECRET_MAX,
  IPTV_URL_MAX,
} from '../../constants/iptv.js';
import { SEARCH_QUERY_MAX } from '../../constants/limits.js';
import { IptvAccountStatusSchema, IptvKindSchema } from '../../state/v2.js';
import { IptvQualitySchema } from '../common.js';

const NameSchema = z.string().trim().min(1).max(IPTV_NAME_MAX);
const UrlSchema = z.string().trim().max(IPTV_URL_MAX);
const SecretSchema = z.string().min(1).max(IPTV_SECRET_MAX);

/**
 * PUT /api/v1/iptv: crear o cambiar la IPTV. Un campo ausente es «el
 * guardado» (la web no manda un secreto vacío). Al crear, al cambiar de tipo
 * o al cambiar el origen del servidor Xtream, los secretos son obligatorios:
 * si faltan, 400 `iptv_credentials_required`. Si falta el nombre, «IPTV».
 *
 * Hace solo una prueba rápida (Xtream `user_info`; M3U, los primeros 256 KiB)
 * y responde `syncing`; el recuento llega por SSE (`iptv.status`).
 */
export const IptvSaveBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('m3u'),
    name: NameSchema.optional(),
    /** URL de la lista (entera secreta: puede llevar usuario y contraseña en la query). */
    url: UrlSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('xtream'),
    name: NameSchema.optional(),
    /** `http(s)://host[:puerto][/ruta base]`. */
    server: UrlSchema.optional(),
    username: SecretSchema.optional(),
    password: SecretSchema.optional(),
  }),
]);
export type IptvSaveBody = z.infer<typeof IptvSaveBodySchema>;

/** PATCH /api/v1/iptv: pausar o reanudar (`enabled`) y renombrar. Sin IPTV, 409 `iptv_not_configured`. */
export const IptvUpdateBodySchema = z.strictObject({
  enabled: z.boolean().optional(),
  name: NameSchema.optional(),
});
export type IptvUpdateBody = z.infer<typeof IptvUpdateBodySchema>;

/**
 * - `syncing`: guardando o descargando la lista.
 * - `ok`: catálogo cargado (puede ser una copia anterior: ver `staleSince`).
 * - `error`: sin catálogo usable o con los secretos ilegibles; `error` dice por qué.
 * - `disabled`: en pausa, o eliminada (en el evento `iptv.status`, con `channels: 0`).
 */
export const IptvSyncStatusSchema = z.enum(['syncing', 'ok', 'error', 'disabled']);
export type IptvSyncStatus = z.infer<typeof IptvSyncStatusSchema>;

export const IptvStatusAccountSchema = z.strictObject({
  status: IptvAccountStatusSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  maxConnections: z.number().int().nonnegative().nullable(),
  activeConnections: z.number().int().nonnegative().nullable(),
  /** Conexiones abiertas ahora por Ace Player (0 o 1: un canal a la vez en casa). */
  ours: z.number().int().nonnegative(),
});
export type IptvStatusAccount = z.infer<typeof IptvStatusAccountSchema>;

export const IptvStatusGuideSchema = z.strictObject({
  available: z.boolean(),
  channelsWithGuide: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema.nullable(),
  /** Última descarga fallida; si hay `updatedAt`, se sigue usando esa copia. */
  failedAt: IsoDateTimeSchema.nullable(),
});
export type IptvStatusGuide = z.infer<typeof IptvStatusGuideSchema>;

/**
 * Estado vivo de la IPTV: va dentro de `IptvView.provider` y es el `data`
 * del evento `iptv.status` (solo web, §5.5).
 */
export const IptvStatusSchema = z.strictObject({
  status: IptvSyncStatusSchema,
  channels: z.number().int().nonnegative(),
  /** Última sincronización buena. */
  updatedAt: IsoDateTimeSchema.nullable(),
  /** Mensaje del catálogo de errores (§5.6); nunca lleva URLs. */
  error: z.strictObject({ code: ShortCodeSchema, message: z.string() }).nullable(),
  /** Falló la última actualización y se usa la copia de esta fecha. */
  staleSince: IsoDateTimeSchema.nullable(),
  /** Solo Xtream, si hay datos de la cuenta. */
  account: IptvStatusAccountSchema.nullable(),
  guide: IptvStatusGuideSchema,
});
export type IptvStatus = z.infer<typeof IptvStatusSchema>;

export const IptvProviderViewSchema = z.strictObject({
  kind: IptvKindSchema,
  name: NameSchema,
  enabled: z.boolean(),
  /** `nombre[:puerto]`, sin esquema, ruta, query ni credenciales. */
  host: z.string(),
  /** Solo Xtream: `http(s)://host[:puerto]`, sin ruta, para rellenar «Servidor». */
  origin: z.string().nullable(),
  /** M3U: hay dirección de la lista guardada. */
  hasUrl: z.boolean(),
  /** Xtream: hay usuario y contraseña guardados. */
  hasUsername: z.boolean(),
  hasPassword: z.boolean(),
  ...IptvStatusSchema.shape,
});
export type IptvProviderView = z.infer<typeof IptvProviderViewSchema>;

/** Respuesta de las 5 rutas IPTV. `provider: null` = sin IPTV (o recién eliminada). */
export const IptvViewSchema = z.strictObject({
  provider: IptvProviderViewSchema.nullable(),
  refreshHours: z.literal(IPTV_REFRESH_HOURS),
});
export type IptvView = z.infer<typeof IptvViewSchema>;

/* --- Buscador: IPTV y AceStream juntos (docs/iptv.md §14.2) ---

   `GET /api/v1/iptv/channels?q=` busca en el catálogo IPTV vigente. Nace con
   `access: 'web'` (D27) y pasa a `any` cuando la app calque el buscador.
   Nunca lleva URL, `ref`, `stream_id`, `tvg-id`, grupo ni nada del proveedor
   aparte del nombre que Isma le puso (`provider`). Sin IPTV activa responde
   200 con la lista vacía: no es un error. */

/** La consulta se limpia como en `search` (espacios colapsados, recorte, 80); con menos de 2 letras, 400 `empty_query`. */
export const IptvChannelsQuerySchema = z.strictObject({
  q: z.string().max(500).default(''),
  /** Por defecto (y como mucho) 50. */
  limit: z.coerce.number().int().min(1).max(IPTV_SEARCH.limit).optional(),
});
export type IptvChannelsQuery = z.infer<typeof IptvChannelsQuerySchema>;

export const IptvChannelSchema = z.strictObject({
  /** Id de §4.1 de la mejor variante del grupo (§4.3): el mismo que usa la resolución. */
  id: HashSchema,
  /** Nombre limpio («Antena 3»): sin país, adornos, calidad ni reserva. */
  title: z.string().min(1).max(120),
  /** Calidad de la variante del `id` (la que arranca primero: 1080p antes que 4K, 720p y SD). */
  quality: IptvQualitySchema.nullable(),
  /**
   * Todas las calidades que tiene el canal, de mayor a menor resolución
   * («4K · 1080p · 720p»; docs/iptv.md §16): una fila por canal, no por variante.
   */
  qualities: z.array(IptvQualitySchema).max(4).optional(),
  /** País del canal si no es España ni sin país («DE»); ausente o null si lo es (§16). */
  country: z.string().min(2).max(8).nullable().optional(),
  /** El nombre que Isma puso al proveedor («Casa»). */
  provider: z.string().max(IPTV_NAME_MAX),
  /** Ids de tu biblioteca (favoritos, recientes o la lista activa) que son este canal (≥ 92), de mejor a peor. */
  library: z.array(HashSchema).max(IPTV_SEARCH.libraryMatchesMax),
});
export type IptvChannel = z.infer<typeof IptvChannelSchema>;

export const IptvChannelsResponseSchema = z.strictObject({
  query: z.string().max(SEARCH_QUERY_MAX),
  /** Canales que casan, hasta `IPTV_SEARCH.totalCap`. */
  total: z.number().int().nonnegative(),
  /** Hay más de `totalCap`. */
  capped: z.boolean(),
  channels: z.array(IptvChannelSchema).max(IPTV_SEARCH.limit),
});
export type IptvChannelsResponse = z.infer<typeof IptvChannelsResponseSchema>;
