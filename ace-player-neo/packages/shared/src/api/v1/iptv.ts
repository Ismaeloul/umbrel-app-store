/* Ajustes → IPTV en /api/v1 (docs/iptv.md §5.3). Las 5 rutas son solo web:
   el iPhone recibe 403 `origin_forbidden` y no configura nada.

   Regla de oro: NADA de lo que devuelve el servidor lleva la URL de la
   lista, el usuario ni la contraseña (§1.4 y §2.4). `IptvView` solo dice si
   están guardados (`hasUrl`, `hasUsername`, `hasPassword`), el `host` y, en
   Xtream, el `origin` para rellenar «Servidor». Un test de forma lo vigila. */

import { z } from 'zod';
import { IsoDateTimeSchema, ShortCodeSchema } from '../../primitives.js';
import {
  IPTV_NAME_MAX,
  IPTV_REFRESH_HOURS,
  IPTV_SECRET_MAX,
  IPTV_URL_MAX,
} from '../../constants/iptv.js';
import { IptvAccountStatusSchema, IptvKindSchema } from '../../state/v2.js';

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
