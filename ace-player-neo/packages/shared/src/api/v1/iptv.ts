/* Ajustes → IPTV en /api/v1 (docs/iptv.md §5.3). Las 5 rutas son solo web:
   el iPhone recibe 403 `origin_forbidden` y no configura nada.

   Regla de oro: NADA de lo que devuelve el servidor lleva la URL de la
   lista, el usuario ni la contraseña (§1.4 y §2.4). `IptvView` solo dice si
   están guardados (`hasUrl`, `hasUsername`, `hasPassword`), el `host` y, en
   Xtream, el `origin` para rellenar «Servidor». Un test de forma lo vigila. */

import { z } from 'zod';
import { HashSchema, IsoDateTimeSchema, ShortCodeSchema } from '../../primitives.js';
import {
  IPTV_BROWSE,
  IPTV_BROWSE_QUALITIES,
  IPTV_NAME_MAX,
  IPTV_REFRESH_HOURS,
  IPTV_SEARCH,
  IPTV_SECRET_MAX,
  IPTV_SPORTS,
  IPTV_TYPES,
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
  quality: IptvQualitySchema.nullable(),
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

/* --- Pestaña IPTV en Canales (docs/iptv.md §16.2) ---

   `GET /api/v1/iptv/browse` recorre la IPTV como la ordena su proveedor:
   categorías con su número de canales, sus canales por páginas, un texto y
   filtros con facetas (país, idioma, tipo, deporte y calidad). El servidor
   filtra, pagina y cuenta; el catálogo nunca baja entero. Nace `web` (D29).
   Nunca lleva URL, `ref`, `stream_id`, `tvg-id`, usuario ni contraseña; el
   nombre de la categoría pasa por el redactor. */

/** Lista separada por comas de códigos válidos («ES,UK»), `IPTV_BROWSE.selectedMax` como mucho. */
const csv = (item: string) =>
  z.string().regex(new RegExp(`^(?:${item})(?:,(?:${item})){0,${IPTV_BROWSE.selectedMax - 1}}$`));

/** Código de país de la pestaña (§16.4): 2 a 4 mayúsculas («ES», «LAT», «EXYU»). */
const COUNTRY_CODE = '[A-Z]{2,4}';
/** Cursor opaco de `nextCursor` (base64url). */
const CursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Id de una categoría: 12 hex (estable mientras el proveedor y el nombre sean los mismos) o `none` («Sin categoría»). */
export const IptvCategoryIdSchema = z.string().regex(/^(?:[a-f0-9]{12}|none)$/);

export const IptvBrowseQuerySchema = z.strictObject({
  /** Categoría; sin ella, toda la IPTV. */
  category: IptvCategoryIdSchema.optional(),
  /** Se limpia como en `iptvChannels`. Con menos de 2 letras se IGNORA (aquí no es un error: se navega sin texto). */
  q: z.string().max(500).default(''),
  /** País: códigos de §16.4 o `none` («Sin país»). */
  country: csv(`${COUNTRY_CODE}|none`).optional(),
  /** Idioma: ISO 639-1 o `none` («Sin idioma»). */
  language: csv('[a-z]{2}|none').optional(),
  type: csv([...IPTV_TYPES, 'none'].join('|')).optional(),
  sport: csv(IPTV_SPORTS.join('|')).optional(),
  /** `none`: canales sin ninguna marca de calidad. */
  quality: csv([...IPTV_BROWSE_QUALITIES, 'none'].join('|')).optional(),
  /** Opaco (el de `nextCursor`). Sin él, primera página con categorías y facetas. */
  cursor: CursorSchema.optional(),
  /** Por defecto 60. `0`: solo categorías y facetas (la raíz sin texto). */
  limit: z.coerce.number().int().min(0).max(IPTV_BROWSE.limitMax).optional(),
});
export type IptvBrowseQuery = z.infer<typeof IptvBrowseQuerySchema>;

export const IptvCategorySchema = z.strictObject({
  id: IptvCategoryIdSchema,
  /** Nombre del proveedor tal cual, redactado (§2.4) y a 120. Con `id: 'none'`, vacío: la web pone «Sin categoría». */
  name: z.string().max(IPTV_BROWSE.categoryNameMax),
  /**
   * Canales (filas, §16.3) de la categoría con los filtros de ahora y, en
   * `categories` sin texto y en `category`, también con el texto. Las
   * categorías que casan por nombre en la raíz con texto cuentan sin el
   * texto: es lo que se verá al entrar.
   */
  count: z.number().int().nonnegative(),
});
export type IptvCategory = z.infer<typeof IptvCategorySchema>;

export const IptvFacetValueSchema = z.strictObject({
  /** Código (`ES`, `es`, `deportes`, `f1`, `fhd`) o `none`. La web pone el texto (§16.6). */
  value: z.string().min(1).max(20),
  /** Canales con este valor, con el texto, la categoría y los DEMÁS filtros de ahora. */
  count: z.number().int().nonnegative(),
  /** Está elegido. Un valor elegido sale siempre, aunque cuente 0, para poder quitarlo. */
  selected: z.boolean(),
});
export type IptvFacetValue = z.infer<typeof IptvFacetValueSchema>;

export const IptvFacetsSchema = z.strictObject({
  country: z.array(IptvFacetValueSchema).max(IPTV_BROWSE.facetValuesMax),
  language: z.array(IptvFacetValueSchema).max(IPTV_BROWSE.facetValuesMax),
  type: z.array(IptvFacetValueSchema).max(IPTV_TYPES.length + 1),
  sport: z.array(IptvFacetValueSchema).max(IPTV_SPORTS.length),
  quality: z.array(IptvFacetValueSchema).max(IPTV_BROWSE_QUALITIES.length + 1),
});
export type IptvFacets = z.infer<typeof IptvFacetsSchema>;
export type IptvFacetName = keyof IptvFacets;

export const IptvBrowseChannelSchema = z.strictObject({
  /** Id de §4.1 de la mejor variante de la fila (§16.3): el que se toca y se guarda en Favoritos. */
  id: HashSchema,
  /** Nombre limpio («DAZN F1»): sin país, adornos, calidad ni reserva. */
  title: z.string().min(1).max(120),
  /** Calidades de sus variantes, de mejor a peor para enseñar: uhd, fhd, hd, sd. Vacío = sin marca. */
  qualities: z.array(IptvQualitySchema).max(IPTV_BROWSE_QUALITIES.length),
  /** País deducido (§16.4), o null. */
  country: z
    .string()
    .regex(new RegExp(`^${COUNTRY_CODE}$`))
    .nullable(),
  /** Categoría de la mejor variante (la web la enseña fuera de una categoría). */
  category: IptvCategoryIdSchema,
});
export type IptvBrowseChannel = z.infer<typeof IptvBrowseChannelSchema>;

export const IptvBrowseResponseSchema = z.strictObject({
  /** Falso sin IPTV activa (sin proveedor, en pausa o sin catálogo): todo lo demás vacío. No es un error. */
  active: z.boolean(),
  /** El nombre que Isma puso al proveedor («Casa»); vacío sin IPTV. */
  provider: z.string().max(IPTV_NAME_MAX),
  /** Sello del catálogo: cambia con cada sincronización aplicada. `0` sin IPTV activa. */
  catalog: z.string().regex(/^[a-z0-9]{1,16}$/),
  /** La consulta limpia que se ha usado (vacía si tenía menos de 2 letras). */
  query: z.string().max(SEARCH_QUERY_MAX),
  /** La categoría pedida con su recuento; null si no se pidió o si ya no existe (la web lo distingue: la pidió). */
  category: IptvCategorySchema.nullable(),
  /** Filas que casan con todo (categoría, texto y filtros). */
  total: z.number().int().nonnegative(),
  /** Filas de todo el catálogo, sin nada (para «27.687 canales»). */
  catalogTotal: z.number().int().nonnegative(),
  /**
   * Solo en la primera página y sin `category`. Sin texto: las categorías con
   * al menos un canal, en el orden del proveedor. Con texto: las que tienen
   * el texto en el nombre (5 como mucho, «Categorías con «{q}»»).
   */
  categories: z.array(IptvCategorySchema).max(IPTV_BROWSE.categoriesMax).optional(),
  /** Solo en la primera página. */
  facets: IptvFacetsSchema.optional(),
  channels: z.array(IptvBrowseChannelSchema).max(IPTV_BROWSE.limitMax),
  /** null = no hay más. */
  nextCursor: CursorSchema.nullable(),
  /** El cursor era de otro catálogo (hubo sincronización): esta es la PRIMERA página, con categorías y facetas. */
  stale: z.boolean(),
});
export type IptvBrowseResponse = z.infer<typeof IptvBrowseResponseSchema>;
