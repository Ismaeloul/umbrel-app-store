/* Guía TV de la IPTV en /api/v1 (docs/iptv.md §20). Las 5 rutas nacen
   `access: 'web'`, como el resto de la IPTV, y pasan a `any` cuando la app
   iOS copie la pantalla.

   La parrilla nunca baja la guía entera: pide la lista de canales por
   páginas (`iptvGuide`), los programas de un trozo de canales × horas
   (`iptvGuideProgrammes`), la ficha de uno al elegirlo
   (`iptvGuideProgramme`) y, aparte, «ahora / después» de unos canales para
   Canales (`iptvGuideNow`). Los logos e imágenes, por el proxy propio
   (`iptvGuideArt`): el navegador nunca ve una URL del proveedor.

   Regla de oro (docs/iptv.md §2.4): nada del proveedor sale de
   `modules/iptv` salvo el nombre limpio del canal y lo que dice la guía de
   cada programa. Ni URLs, `stream_id`, `tvg-id`, usuario ni contraseña.

   `version` es el sello de la guía guardada: cambia con cada descarga
   aplicada y va en cada petición de programas; con uno viejo, 409
   `guide_stale` y la web vuelve a pedir `iptvGuide`. El cambio llega por el
   evento de siempre (`iptv.status`, `guide.updatedAt`): no hay evento nuevo.

   Horas en epoch ms (UTC); la web las pinta en su zona con `Intl`. */

import { z } from 'zod';
import { IPTV_GUIDE_API, IPTV_GUIDE_STORE, GUIDE_FLAGS_ALL } from '../../constants/guide.js';
import { IPTV_NAME_MAX } from '../../constants/iptv.js';
import { HashSchema, IsoDateTimeSchema } from '../../primitives.js';

export const IPTV_GUIDE_SCOPES = ['favorites', 'all'] as const;
export const IptvGuideScopeSchema = z.enum(IPTV_GUIDE_SCOPES);
export type IptvGuideScope = z.infer<typeof IptvGuideScopeSchema>;

/**
 * - `ready`: hay guía (si la última descarga falló, `failedAt` lo dice y se
 *   sigue con la copia de `updatedAt`).
 * - `preparing`: la IPTV está activa y la primera guía aún no ha llegado.
 * - `none`: el proveedor no da guía (una M3U sin `url-tvg`, o una guía
 *   vacía y sin respaldo).
 * - `failed`: la descarga falló y no hay copia.
 * - `inactive`: sin IPTV, en pausa o sin catálogo.
 */
export const IPTV_GUIDE_READINESS = ['ready', 'preparing', 'none', 'failed', 'inactive'] as const;
export const IptvGuideReadinessSchema = z.enum(IPTV_GUIDE_READINESS);
export type IptvGuideReadiness = z.infer<typeof IptvGuideReadinessSchema>;

/** Sello de la guía guardada (base 36). */
export const IptvGuideVersionSchema = z.string().regex(/^[a-z0-9]{1,16}$/, 'sello de la guía');
/** Canal de la guía: el número con el que se piden sus programas (cambia con cada `version`). */
export const IptvGuideChannelRefSchema = z.number().int().positive().max(9_999_999);
/** Programa: `<canal de la guía>.<minuto de inicio en epoch>`. Vale con su `version`. */
export const IptvGuideProgrammeIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,6}\.\d{1,9}$/, 'id de programa');

const GUIDE_REF = '[1-9]\\d{0,6}';
const HASH = '[a-f0-9]{40}';

// --- iptvGuide: estado y canales por páginas ---

export const IptvGuideQuerySchema = z.strictObject({
  /** Por defecto `favorites`; si ninguno tiene guía, responde `all` con `fellBack: true`. */
  scope: IptvGuideScopeSchema.optional(),
  /** Primera fila de la página (0…). */
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  /** Por defecto 200; `0` solo da el estado y los recuentos. */
  limit: z.coerce.number().int().min(0).max(IPTV_GUIDE_API.channelsPageMax).optional(),
});
export type IptvGuideQuery = z.infer<typeof IptvGuideQuerySchema>;

export const IptvGuideChannelSchema = z.strictObject({
  /** Canal de la guía (para `iptvGuideProgrammes`); null = un favorito sin programación («Sin información»). */
  guide: IptvGuideChannelRefSchema.nullable(),
  /**
   * Id de §4.1 del canal que suena con «Ver»: su mejor variante, el mismo
   * que da el buscador IPTV (`iptvChannels`). Se abre como un canal tocado.
   */
  id: HashSchema,
  /**
   * Número del canal: su puesto en «Todos» (1, 2, 3…), el mismo en los dos
   * ámbitos, para saltar tecleándolo. null si no tiene guía.
   */
  number: z.number().int().positive().nullable(),
  /** Nombre limpio («M+ LaLiga TV»): sin país, adornos, calidad ni reserva. */
  name: z.string().min(1).max(120),
  /** País si no es España ni sin país («DE»); null si lo es (docs/iptv.md §17). */
  country: z
    .string()
    .regex(/^[A-Z]{2,4}$/)
    .nullable(),
  /** Está en tus favoritos (él o un canal de tu lista que es este, ≥ 92). */
  favorite: z.boolean(),
  /** Hay logo (`iptvGuideArt` con `c<guide>`). */
  logo: z.boolean(),
});
export type IptvGuideChannel = z.infer<typeof IptvGuideChannelSchema>;

export const IptvGuideResponseSchema = z.strictObject({
  state: IptvGuideReadinessSchema,
  /** Sello de la guía: va en cada petición de programas. '' sin guía. */
  version: z.union([IptvGuideVersionSchema, z.literal('')]),
  /** El nombre que Isma puso al proveedor («Casa»); vacío sin IPTV. */
  provider: z.string().max(IPTV_NAME_MAX),
  /**
   * Ventana guardada (epoch ms): de 24 h antes a 80 h después de la descarga
   * (`IPTV_GUIDE_STORE`). Los trozos se recortan a ella. NO dice hasta dónde
   * llega la programación: eso es `coveredFrom`/`coveredTo`. null sin guía.
   */
  from: z.number().int().nullable(),
  to: z.number().int().nullable(),
  /**
   * Hasta dónde llega de verdad la programación de las filas de este ámbito
   * (epoch ms): inicio del primer programa y fin del último, dentro de
   * `from`/`to`. Una guía que solo cubre hoy (la del panel de Isma, Paso 0
   * del 3-oct) acaba hoy aunque la ventana llegue a +80 h: la web esconde
   * «Mañana» y «Pasado» si no llegan. null sin guía o si ninguna fila del
   * ámbito tiene programación.
   */
  coveredFrom: z.number().int().nullable(),
  coveredTo: z.number().int().nullable(),
  /** Descarga de la guía que se está usando. */
  updatedAt: IsoDateTimeSchema.nullable(),
  /** Última descarga fallida (si hay `updatedAt`, se sigue con esa copia). */
  failedAt: IsoDateTimeSchema.nullable(),
  /**
   * La guía solo cubre algunos canales: el respaldo de Xtream (`get_short_epg`,
   * 40 canales deportivos y unas horas) porque el proveedor no da `xmltv.php`.
   */
  partial: z.boolean(),
  /** El ámbito de la respuesta: el pedido o, si era `favorites` y ninguno tiene guía, `all`. */
  scope: IptvGuideScopeSchema,
  /** Se pidieron favoritos y ninguno tiene guía: se enseñan todos. */
  fellBack: z.boolean(),
  /** Favoritos con programación (para el interruptor «Favoritos | Todos»). */
  favorites: z.number().int().nonnegative(),
  /** Canales con programación: lo que hay en «Todos». */
  all: z.number().int().nonnegative(),
  /** Filas del ámbito de la respuesta (en `favorites`, también los favoritos sin guía). */
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  /** Las filas `offset … offset + limit − 1` del ámbito, en su orden. */
  channels: z.array(IptvGuideChannelSchema).max(IPTV_GUIDE_API.channelsPageMax),
});
export type IptvGuideResponse = z.infer<typeof IptvGuideResponseSchema>;

// --- iptvGuideProgrammes: un trozo de canales × horas ---

export const IptvGuideProgrammesQuerySchema = z.strictObject({
  v: IptvGuideVersionSchema,
  /** Canales de la guía separados por comas (60 como mucho). */
  ch: z
    .string()
    .regex(
      new RegExp(`^${GUIDE_REF}(?:,${GUIDE_REF}){0,${IPTV_GUIDE_API.sliceChannelsMax - 1}}$`),
      'canales de la guía separados por comas',
    ),
  /** Desde y hasta (epoch ms, `to > from`, 12 h como mucho). Entra todo programa que se solape. */
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
});
export type IptvGuideProgrammesQuery = z.infer<typeof IptvGuideProgrammesQuerySchema>;

export const IptvGuideProgrammeSchema = z.strictObject({
  id: IptvGuideProgrammeIdSchema,
  /** Epoch ms; [start, end). Dos programas de un canal nunca se solapan. */
  start: z.number().int(),
  end: z.number().int(),
  /** Título tal cual de la guía (vacío si no traía; entonces es relleno). */
  title: z.string().max(IPTV_GUIDE_STORE.titleChars + 1),
  /** Marcas (`GUIDE_FLAGS`): en directo, estreno, repetición, ficha, relleno, sin fin, imagen. */
  flags: z.number().int().min(0).max(GUIDE_FLAGS_ALL),
});
export type IptvGuideProgramme = z.infer<typeof IptvGuideProgrammeSchema>;

export const IptvGuideProgrammesResponseSchema = z.strictObject({
  version: IptvGuideVersionSchema,
  /** El trozo pedido, recortado a la ventana guardada (`from`/`to` de `iptvGuide`). */
  from: z.number().int(),
  to: z.number().int(),
  /** En el orden pedido; un canal que no existe (o sin programas en el trozo), con la lista vacía. */
  channels: z
    .array(
      z.strictObject({
        guide: IptvGuideChannelRefSchema,
        programmes: z.array(IptvGuideProgrammeSchema).max(IPTV_GUIDE_API.sliceProgrammesMax),
      }),
    )
    .max(IPTV_GUIDE_API.sliceChannelsMax),
});
export type IptvGuideProgrammesResponse = z.infer<typeof IptvGuideProgrammesResponseSchema>;

// --- iptvGuideProgramme: la ficha de uno ---

export const IptvGuideProgrammeParamsSchema = z.strictObject({ id: IptvGuideProgrammeIdSchema });
export const IptvGuideVersionQuerySchema = z.strictObject({ v: IptvGuideVersionSchema });

export const IptvGuideProgrammeDetailSchema = z.strictObject({
  version: IptvGuideVersionSchema,
  ...IptvGuideProgrammeSchema.shape,
  guide: IptvGuideChannelRefSchema,
  subTitle: z
    .string()
    .max(IPTV_GUIDE_STORE.subTitleChars + 1)
    .nullable(),
  /** Sinopsis, sin etiquetas HTML y recortada a 800 letras. */
  description: z
    .string()
    .max(IPTV_GUIDE_STORE.descChars + 1)
    .nullable(),
  /** Categorías tal cual (texto libre del proveedor, en su idioma). */
  categories: z
    .array(z.string().max(IPTV_GUIDE_STORE.categoryChars + 1))
    .max(IPTV_GUIDE_STORE.categoriesMax),
  /** Temporada y episodio (de `xmltv_ns` o `onscreen`), si la guía los trae como números. */
  season: z.number().int().positive().max(9999).nullable(),
  episode: z.number().int().positive().max(99999).nullable(),
  /** El episodio tal cual si no se entiende como números («Capítulo especial»). */
  episodeText: z.string().max(60).nullable(),
  year: z.number().int().min(1888).max(2100).nullable(),
  /** Edad recomendada tal cual («+7», «TP», «18»). */
  rating: z.string().max(20).nullable(),
  /** Nota tal cual («3/5», «7.5/10»). */
  stars: z.string().max(20).nullable(),
  directors: z
    .array(z.string().max(IPTV_GUIDE_STORE.creditChars + 1))
    .max(IPTV_GUIDE_STORE.directorsMax),
  actors: z.array(z.string().max(IPTV_GUIDE_STORE.creditChars + 1)).max(IPTV_GUIDE_STORE.actorsMax),
});
export type IptvGuideProgrammeDetail = z.infer<typeof IptvGuideProgrammeDetailSchema>;

// --- iptvGuideNow: «ahora / después» para Canales ---

export const IptvGuideNowQuerySchema = z.strictObject({
  /** Ids IPTV de §4.1 separados por comas (100 como mucho): los de las filas de la pestaña IPTV. */
  ids: z
    .string()
    .regex(
      new RegExp(`^${HASH}(?:,${HASH}){0,${IPTV_GUIDE_API.nowIdsMax - 1}}$`),
      'ids IPTV separados por comas',
    ),
});
export type IptvGuideNowQuery = z.infer<typeof IptvGuideNowQuerySchema>;

export const IptvGuideNowItemSchema = z.strictObject({
  id: HashSchema,
  /** Canal de la guía de ese canal; null si no tiene guía (o el id ya no es del catálogo). */
  guide: IptvGuideChannelRefSchema.nullable(),
  /** Lo que se emite ahora y lo siguiente; null si la guía no lo sabe. */
  now: IptvGuideProgrammeSchema.nullable(),
  next: IptvGuideProgrammeSchema.nullable(),
});
export type IptvGuideNowItem = z.infer<typeof IptvGuideNowItemSchema>;

export const IptvGuideNowResponseSchema = z.strictObject({
  /** Hay guía. Sin ella (o sin IPTV activa), 200 con `items` vacío: no es un error. */
  available: z.boolean(),
  version: z.union([IptvGuideVersionSchema, z.literal('')]),
  /** En el orden pedido, sin repetir. */
  items: z.array(IptvGuideNowItemSchema).max(IPTV_GUIDE_API.nowIdsMax),
});
export type IptvGuideNowResponse = z.infer<typeof IptvGuideNowResponseSchema>;

// --- iptvGuideArt: logo de un canal o imagen de un programa ---

export const IptvGuideArtParamsSchema = z.strictObject({
  /** `c<canal de la guía>` (logo) o `p<id de programa>` (imagen). */
  ref: z.string().regex(/^(?:c[1-9]\d{0,6}|p[1-9]\d{0,6}\.\d{1,9})$/, 'logo o imagen de la guía'),
});
