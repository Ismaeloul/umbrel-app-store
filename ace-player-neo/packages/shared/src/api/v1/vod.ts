/* Películas y series de la IPTV en /api/v1 (docs/vod.md §11). Las 6 rutas
   nacen `access: 'web'` (D-VOD19) y pasan a `any` cuando la app iOS copie
   la pantalla (§17); las formas ya están pensadas para ella.

   Regla de oro (§14 y la regla §2.4 de docs/iptv.md): NADA del proveedor
   sale de `modules/iptv`. Ni URLs, usuario, contraseña, `stream_id`,
   `series_id`, `episode_id`, `container_extension`, `direct_source` ni las
   URLs de los carteles. Los títulos se identifican por ids sellados de 40
   hex (§5) y los carteles por la `v` de `vodArt`. Un test de forma lo vigila.

   Todos los esquemas son `strictObject`. */

import { z } from 'zod';
import { HashSchema, IsoDateTimeSchema } from '../../primitives.js';
import { VOD_LIST, VOD_SEARCH } from '../../constants/vod.js';
import { VodCatalogStateSchema } from '../../state/v2.js';
import { CursorSchema, IptvCategoryIdSchema } from './iptv.js';
import { ChannelStreamQuerySchema, StreamGrantSchema } from './playback.js';

export const VOD_KINDS = ['movie', 'series'] as const;
/** Distintivos de lengua y calidad (§4.4, D-VOD6), en el orden de los chips. */
export const VOD_TAGS = ['castellano', 'latino', 'vose', 'multi', '4k'] as const;
/**
 * Idiomas de Películas y series (docs/vod.md §4.10), en el orden del
 * selector. Salen del nombre de la categoría y de las marcas del título
 * («ES | ACCIÓN», «Coco (LAT)», «[VOSE]»): las pistas de audio de los
 * paneles casi nunca dicen su lengua. Castellano y latino van SIEMPRE
 * separados. `vose`: versión original con subtítulos en español. `ingles`:
 * inglés o versión original. `otros`: una lengua que se reconoce pero no
 * está en la lista (árabe, turco, polaco…). Un título sin ninguna marca no
 * tiene idioma (`langs: []`, «Sin indicar»); uno MULTI puede tener varios.
 */
export const VOD_LANGS = [
  'castellano',
  'latino',
  'vose',
  'ingles',
  'frances',
  'italiano',
  'aleman',
  'portugues',
  'catalan',
  'otros',
] as const;
/** Imágenes que sirve `vodArt` (§8). */
export const VOD_ART_KINDS = ['poster', 'backdrop', 'still'] as const;

export const VodKindSchema = z.enum(VOD_KINDS);
export type VodKind = z.infer<typeof VodKindSchema>;
export const VodTagSchema = z.enum(VOD_TAGS);
export type VodTag = z.infer<typeof VodTagSchema>;
export const VodArtKindSchema = z.enum(VOD_ART_KINDS);
export type VodArtKind = z.infer<typeof VodArtKindSchema>;

/** La `v` de `vodArt`: HMAC(k_vod, url)[0..8]. Cambia si el proveedor cambia la imagen y no deja deducir nada. */
export const VodArtStampSchema = z.string().regex(/^[a-f0-9]{8}$/, 'sello de 8 hex');

/** Pista del proveedor sobre si se podrá reproducir (por `video.codec_name`); manda el índice al abrir (§7.2). */
export const VodPlayableSchema = z.enum(['yes', 'hevc', 'no', 'unknown']);
export type VodPlayable = z.infer<typeof VodPlayableSchema>;

export const VodTagCountSchema = z.strictObject({
  tag: VodTagSchema,
  count: z.number().int().nonnegative(),
});
export type VodTagCount = z.infer<typeof VodTagCountSchema>;

export const VodLangSchema = z.enum(VOD_LANGS);
export type VodLang = z.infer<typeof VodLangSchema>;

/** Los idiomas de un título (vacío = no lo indica). Opcional: un servidor anterior a §4.10 no lo manda. */
export const VodTitleLangsSchema = z.array(VodLangSchema).max(VOD_LANGS.length);

/** Cuántos títulos hay de un idioma. */
export const VodLangCountSchema = z.strictObject({
  lang: VodLangSchema,
  count: z.number().int().nonnegative(),
});
export type VodLangCount = z.infer<typeof VodLangCountSchema>;

const VOD_LANG_ALT = VOD_LANGS.join('|');

/**
 * Filtro de idiomas en la URL (§4.10): `langs=castellano,frances` (sin
 * repetir ni inventar ninguno) y `unknown=0|1` (con `1` salen también los
 * títulos que no indican idioma; por defecto, desde la 0.9.0, NO salen: solo
 * los de los idiomas elegidos). Un título «sin indicar» cuyo audio real ya
 * se comprobó (§4.11) cuenta con ese idioma. Sin `langs`, no se filtra.
 */
export const VodLangsParamSchema = z
  .string()
  .max(200)
  .regex(
    new RegExp(`^(?:${VOD_LANG_ALT})(?:,(?:${VOD_LANG_ALT}))*$`),
    'idiomas separados por comas',
  );

export const VodLangQuerySchema = z.strictObject({
  langs: VodLangsParamSchema.optional(),
  unknown: z.enum(['0', '1']).optional(),
});
export type VodLangQuery = z.infer<typeof VodLangQuerySchema>;

/**
 * Los idiomas que Isma quiere ver en Películas y series (§4.10). Por casa,
 * en el servidor (`v2/vod-idiomas.json`): vale en el PC y en el iPhone, y
 * entra en la copia de seguridad.
 */
export const VodLanguagesSchema = z.strictObject({
  /** false hasta que los elige la primera vez (la web enseña el selector). */
  chosen: z.boolean(),
  /** Vacía = todos los idiomas (sin filtro). */
  langs: z.array(VodLangSchema).max(VOD_LANGS.length),
  /** También los títulos que no indican idioma (por defecto, no: solo los idiomas elegidos). */
  unknown: z.boolean(),
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type VodLanguages = z.infer<typeof VodLanguagesSchema>;

/** PUT /api/v1/vod/languages: sustituye la elección (y la da por hecha). Los repetidos se juntan. */
export const VodLanguagesBodySchema = z.strictObject({
  langs: z.array(VodLangSchema).max(VOD_LANGS.length),
  unknown: z.boolean(),
});
export type VodLanguagesBody = z.infer<typeof VodLanguagesBodySchema>;

/** Una tarjeta de la rejilla, la búsqueda o la portada. */
export const VodCardSchema = z.strictObject({
  id: HashSchema,
  kind: VodKindSchema,
  title: z.string().min(1).max(200),
  year: z.number().int().min(1880).max(2100).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  /** null = sin cartel (la web pinta el relleno); si no, la `v` de `vodArt`. */
  poster: VodArtStampSchema.nullable(),
  tags: z.array(VodTagSchema).max(5),
  /** Se ve con la cápsula «+18» (D-VOD7). */
  adult: z.boolean(),
  /** Parte vista (0-1) en películas; en series, null. */
  progress: z.number().min(0).max(1).nullable(),
  /** Sus idiomas (§4.10; vacío = no lo indica). Opcional: un servidor anterior no lo manda. */
  langs: VodTitleLangsSchema.optional(),
});
export type VodCard = z.infer<typeof VodCardSchema>;

/** Categoría del proveedor: `categoryId` de 12 hex, distinta de las del directo (§5.4). */
export const VodCategorySchema = z.strictObject({
  id: IptvCategoryIdSchema,
  kind: VodKindSchema,
  name: z.string().max(120),
  count: z.number().int().nonnegative(),
  adult: z.boolean(),
});
export type VodCategory = z.infer<typeof VodCategorySchema>;

/** Una entrada de «Seguir viendo» (§10.3). */
export const VodContinueSchema = z.strictObject({
  /** Película o episodio. */
  id: HashSchema,
  kind: z.enum(['movie', 'episode']),
  seriesId: HashSchema.nullable(),
  title: z.string().max(200),
  /** «T2 · E5 · El regreso». */
  subtitle: z.string().max(120).nullable(),
  posS: z.number().nonnegative(),
  durS: z.number().nonnegative(),
  /** Siguiente episodio propuesto («Siguiente: T2 · E6»): empieza en 0. */
  isNext: z.boolean(),
  art: z
    .strictObject({
      id: HashSchema,
      art: z.enum(['backdrop', 'still', 'poster']),
      v: VodArtStampSchema,
    })
    .nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type VodContinue = z.infer<typeof VodContinueSchema>;

/**
 * GET /api/v1/vod (§6.4, D-VOD28): la portada en una sola petición. Sin
 * IPTV activa, 200 con `active: false` y todo vacío: no es un error.
 */
export const VodHomeSchema = z.strictObject({
  active: z.boolean(),
  state: VodCatalogStateSchema,
  counts: z.strictObject({ movies: z.number().int(), series: z.number().int() }),
  builtAt: IsoDateTimeSchema.nullable(),
  /** El proveedor tiene más títulos que `VOD_LIMITS.maxMovies` o `maxSeries`: se ven los primeros. */
  truncated: z.boolean(),
  /** La última sincronización falló: se sigue con la copia de `builtAt`. */
  stale: z.boolean(),
  continue: z.array(VodContinueSchema).max(20),
  /** «Novedades en películas» (los títulos para adultos, como los demás: D-VOD7). */
  newMovies: z.array(VodCardSchema).max(20),
  /** «Series actualizadas» (ídem). */
  updatedSeries: z.array(VodCardSchema).max(20),
  /** Con su número, en el orden del panel (las de adultos también: D-VOD7). */
  categories: z.strictObject({
    movie: z.array(VodCategorySchema).max(2_000),
    series: z.array(VodCategorySchema).max(2_000),
  }),
  /** Distintivos con número por tipo, para pintar solo los chips que tienen algo. */
  tags: z.strictObject({
    movie: z.array(VodTagCountSchema).max(5),
    series: z.array(VodTagCountSchema).max(5),
  }),
  /**
   * Idiomas de TODO el catálogo por tipo, sin filtrar (§4.10): el selector
   * enseña cuántos títulos hay de cada uno. Solo los que tienen algo.
   * Opcional: un servidor anterior no lo manda.
   */
  langs: z
    .strictObject({
      movie: z.array(VodLangCountSchema).max(VOD_LANGS.length),
      series: z.array(VodLangCountSchema).max(VOD_LANGS.length),
    })
    .optional(),
  /** Títulos que no indican idioma, por tipo (todo el catálogo). Opcional. */
  noLang: z.strictObject({ movies: z.number().int(), series: z.number().int() }).optional(),
  /**
   * Con filtro de idiomas (`langs`), cuántos se ven de cada tipo («Ver las
   * 1.234 películas»); `counts` sigue siendo el catálogo entero. Sin filtro,
   * igual que `counts`. Las categorías, las novedades y los distintivos ya
   * van filtrados, y las categorías sin nada en esos idiomas no salen.
   */
  shown: z.strictObject({ movies: z.number().int(), series: z.number().int() }).optional(),
});
export type VodHome = z.infer<typeof VodHomeSchema>;

/** GET /api/v1/vod?langs&unknown: la portada con el filtro de idiomas (sin `langs`, todo). */
export const VodHomeQuerySchema = VodLangQuerySchema;
export type VodHomeQuery = z.infer<typeof VodHomeQuerySchema>;

/**
 * GET /api/v1/vod/browse (§6): rejilla y búsqueda, por tipo. Con `q` (2 a 80
 * caracteres tras limpiarla; si no, `empty_query`) manda la relevancia
 * (niveles 0-4, §6.2) y `sort` se ignora. El texto nunca va al registro.
 */
export const VodBrowseQuerySchema = z.strictObject({
  kind: VodKindSchema.default('movie'),
  cat: z.union([IptvCategoryIdSchema, z.literal('all')]).default('all'),
  tag: VodTagSchema.optional(),
  q: z.string().max(200).optional(),
  /** Con `q` manda la relevancia (§6.2). */
  sort: z.enum(['added', 'name']).default('added'),
  cursor: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(VOD_SEARCH.pageMax).default(VOD_SEARCH.pageDefault),
  /** Filtro de idiomas (§4.10): `castellano,frances`. Sin él, todos. */
  langs: VodLangsParamSchema.optional(),
  /** Con `langs`: `1` también los que no indican idioma (por defecto, `0`: no salen). */
  unknown: z.enum(['0', '1']).optional(),
});
export type VodBrowseQuery = z.infer<typeof VodBrowseQuerySchema>;

export const VodBrowseResponseSchema = z.strictObject({
  active: z.boolean(),
  state: VodCatalogStateSchema,
  items: z.array(VodCardSchema).max(100),
  total: z.number().int().nonnegative(),
  /** Más de 2 000 aciertos: se guardan los 2 000 mejores. */
  capped: z.boolean(),
  /** Solo con `q`: aciertos en el otro tipo («Ver 3 series»). */
  otherKindTotal: z.number().int().nonnegative().nullable(),
  /** Para los chips, sin contar el filtro `tag`. */
  tags: z.array(VodTagCountSchema).max(5),
  /** null = no hay más. */
  nextCursor: CursorSchema.nullable(),
  /** El cursor era de otro catálogo: esta es la primera página. */
  stale: z.boolean(),
});
export type VodBrowseResponse = z.infer<typeof VodBrowseResponseSchema>;

/** Una película o una serie (40 hex sellados). */
export const VodTitleParamsSchema = z.strictObject({ id: HashSchema });
export type VodTitleParams = z.infer<typeof VodTitleParamsSchema>;

/** `pre=1`: precarga al apuntar (§7.1); solo se pide al proveedor si la cola está vacía. */
export const VodTitleQuerySchema = z.strictObject({ pre: z.enum(['0', '1']).default('0') });
export type VodTitleQuery = z.infer<typeof VodTitleQuerySchema>;

export const VodProgressSchema = z.strictObject({
  posS: z.number(),
  durS: z.number(),
  watched: z.boolean(),
});
export type VodProgress = z.infer<typeof VodProgressSchema>;

/** La ficha del proveedor llegó (`ok`), está en cola (`pending`) o falló (`failed`): la ficha nunca queda en blanco (§7.3). */
export const VodInfoSchema = z.enum(['ok', 'pending', 'failed']);
export type VodInfo = z.infer<typeof VodInfoSchema>;

const VodTitleCategorySchema = z
  .strictObject({ id: IptvCategoryIdSchema, name: z.string().max(120) })
  .nullable();

/** Una fecha del panel ya normalizada (`releasedate`, `air_date`…): `AAAA-MM-DD`. */
export const VodDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

/**
 * El tráiler de la ficha (`youtube_trailer` de Xtream): SOLO el id de
 * YouTube de 11 caracteres, nunca una URL. La web abre
 * `https://www.youtube.com/watch?v=<id>` en otra pestaña.
 */
export const VodTrailerSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'id de YouTube');

/**
 * Lo que dice el propio fichero (§4.11): las lenguas de sus pistas de audio
 * y de sus subtítulos de texto, leídas del índice (MKV/MP4) al abrir la
 * ficha de un título «sin indicar» o al reproducirlo. Etiquetas ya en
 * castellano, sin repetir y en el orden de las pistas («Inglés»,
 * «Castellano», «Español (Latinoamérica)»); vacío si ninguna pista dice su
 * lengua.
 */
export const VodDetectedAudioSchema = z.strictObject({
  audio: z.array(z.string().max(40)).max(8),
  subtitles: z.array(z.string().max(40)).max(8),
});
export type VodDetectedAudio = z.infer<typeof VodDetectedAudioSchema>;

export const VodMovieSchema = z.strictObject({
  kind: z.literal('movie'),
  id: HashSchema,
  info: VodInfoSchema,
  title: z.string().max(200),
  originalTitle: z.string().max(200).nullable(),
  year: z.number().int().nullable(),
  plot: z.string().max(2_000).nullable(),
  genres: z.array(z.string().max(40)).max(8),
  cast: z.array(z.string().max(80)).max(12),
  director: z.string().max(200).nullable(),
  country: z.string().max(80).nullable(),
  ageRating: z.string().max(16).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  durationS: z.number().int().nullable(),
  poster: VodArtStampSchema.nullable(),
  backdrop: VodArtStampSchema.nullable(),
  tags: z.array(VodTagSchema).max(5),
  adult: z.boolean(),
  /** Sus idiomas (§4.10). Opcional. */
  langs: VodTitleLangsSchema.optional(),
  tech: z.strictObject({
    container: z.string().max(8).nullable(),
    /** «1080p · H.264». */
    video: z.string().max(40).nullable(),
    /** «AC-3 5.1 · Castellano». */
    audio: z.array(z.string().max(40)).max(8),
  }),
  playable: VodPlayableSchema,
  progress: VodProgressSchema.nullable(),
  category: VodTitleCategorySchema,
  /** Lenguas que dice el fichero (§4.11), si ya se han leído. Opcional. */
  detectedAudio: VodDetectedAudioSchema.nullable().optional(),
  /** El servidor está leyendo el fichero para saber su audio («Comprobando el audio…»). Opcional. */
  audioPending: z.boolean().optional(),
  /** Fecha de estreno (`releasedate`). Opcional: un servidor anterior no la manda. */
  releaseDate: VodDateSchema.nullable().optional(),
  /** Tráiler (`youtube_trailer`): el id de YouTube. Opcional. */
  trailer: VodTrailerSchema.nullable().optional(),
});
export type VodMovie = z.infer<typeof VodMovieSchema>;

export const VodEpisodeSchema = z.strictObject({
  id: HashSchema,
  n: z.number().int().min(0).max(9_999),
  title: z.string().max(200),
  plot: z.string().max(600).nullable(),
  durationS: z.number().int().nullable(),
  still: VodArtStampSchema.nullable(),
  playable: VodPlayableSchema,
  progress: VodProgressSchema.nullable(),
  /**
   * Formato del fichero del episodio («mkv», «mp4», «avi»…), en minúsculas,
   * sacado de la extensión que da la ficha de Xtream (nunca la URL). Para que
   * la web diga qué formato es cuando `playable` es `no`. Opcional: un
   * servidor que no lo sepa no lo manda (la película lo lleva en `tech`).
   */
  container: z.string().max(8).optional(),
  /** Fecha de emisión (`air_date` o `releasedate` del episodio). Opcional. */
  airDate: VodDateSchema.nullable().optional(),
  /** Nota del episodio (0-10). Opcional. */
  rating: z.number().min(0).max(10).nullable().optional(),
  /** Lenguas que dice el fichero del episodio (§4.11), si ya se han leído. Opcional. */
  detectedAudio: VodDetectedAudioSchema.nullable().optional(),
});
export type VodEpisode = z.infer<typeof VodEpisodeSchema>;

/** Botón principal de una serie (§10.3), calculado en el servidor. */
export const VodSeriesMainSchema = z.strictObject({
  episodeId: HashSchema,
  action: z.enum(['start', 'resume', 'next', 'rewatch']),
  /** «Ver T1:E1», «Reanudar T2:E3», «Siguiente: T2:E4», «Volver a ver T1:E1». */
  label: z.string().max(80),
  posS: z.number().nonnegative(),
});
export type VodSeriesMain = z.infer<typeof VodSeriesMainSchema>;

export const VodSeriesSchema = z.strictObject({
  kind: z.literal('series'),
  id: HashSchema,
  info: VodInfoSchema,
  title: z.string().max(200),
  year: z.number().int().nullable(),
  plot: z.string().max(2_000).nullable(),
  genres: z.array(z.string().max(40)).max(8),
  cast: z.array(z.string().max(80)).max(12),
  director: z.string().max(200).nullable(),
  country: z.string().max(80).nullable(),
  rating: z.number().min(0).max(10).nullable(),
  poster: VodArtStampSchema.nullable(),
  backdrop: VodArtStampSchema.nullable(),
  tags: z.array(VodTagSchema).max(5),
  adult: z.boolean(),
  /** Sus idiomas (§4.10). Opcional. */
  langs: VodTitleLangsSchema.optional(),
  category: VodTitleCategorySchema,
  /** La temporada 0 es «Especiales» y va al final. */
  seasons: z
    .array(
      z.strictObject({
        n: z.number().int().min(0).max(999),
        name: z.string().max(80),
        episodes: z.array(VodEpisodeSchema).max(500),
        /** Sinopsis de la temporada (`overview`). Opcional. */
        plot: z.string().max(600).nullable().optional(),
        /** Fecha de la temporada (`air_date` de `seasons`), para «Temporada 2 · 2006». Opcional. */
        airDate: VodDateSchema.nullable().optional(),
      }),
    )
    .max(100),
  main: VodSeriesMainSchema.nullable(),
  /** Pasó de 100 temporadas, 500 episodios por temporada o 3 000 en total. */
  truncated: z.boolean(),
  /** Título original (`o_name`). Opcional: un servidor anterior no lo manda. */
  originalTitle: z.string().max(200).nullable().optional(),
  /** Edad recomendada (`age`, `mpaa_rating`). Opcional. */
  ageRating: z.string().max(16).nullable().optional(),
  /** Fecha del estreno de la serie (`releaseDate`). Opcional. */
  releaseDate: VodDateSchema.nullable().optional(),
  /** Tráiler (`youtube_trailer`): el id de YouTube. Opcional. */
  trailer: VodTrailerSchema.nullable().optional(),
  /** Duración típica de un episodio (`episode_run_time`), en segundos. Opcional. */
  episodeDurationS: z.number().int().positive().max(86_400).nullable().optional(),
  /** Lenguas que dice el fichero de un episodio (§4.11; el primero de la temporada que se mira). Opcional. */
  detectedAudio: VodDetectedAudioSchema.nullable().optional(),
  /** El servidor está leyendo un episodio para saber su audio. Opcional. */
  audioPending: z.boolean().optional(),
});
export type VodSeries = z.infer<typeof VodSeriesSchema>;

/** GET /api/v1/vod/titles/:id: la ficha. Nunca 502: si el proveedor falla, lo que se sabe por la lista con `info: 'failed'`. */
export const VodTitleSchema = z.discriminatedUnion('kind', [VodMovieSchema, VodSeriesSchema]);
export type VodTitle = z.infer<typeof VodTitleSchema>;

/** GET /api/v1/vod/titles/:id/art/:art. */
export const VodArtParamsSchema = z.strictObject({ id: HashSchema, art: VodArtKindSchema });
export type VodArtParams = z.infer<typeof VodArtParamsSchema>;

/** Con la `v` correcta la respuesta es inmutable; sin ella o con otra, `no-cache`. */
export const VodArtQuerySchema = z.strictObject({ v: VodArtStampSchema.optional() });
export type VodArtQuery = z.infer<typeof VodArtQuerySchema>;

/**
 * GET /api/v1/vod/titles/:id/stream (§9.8). Sin `start`, el progreso
 * guardado; sin `audio`, la preferencia de la serie o la película (§10.4).
 * `hevc=1` solo si el cliente decodifica HEVC (§9.11): la web lo calcula con
 * `MediaSource.isTypeSupported`; iOS, siempre.
 */
export const VodStreamQuerySchema = ChannelStreamQuerySchema.pick({
  client: true,
  viewer: true,
  device: true,
}).extend({
  start: z.coerce.number().min(0).max(86_400).optional(),
  audio: z.coerce.number().int().min(0).max(15).optional(),
  hevc: z.enum(['0', '1']).default('0'),
});
export type VodStreamQuery = z.infer<typeof VodStreamQuerySchema>;

/** Una pista de audio del índice (§9.9): «Castellano 5.1», «Inglés», «Pista 3». */
export const VodAudioTrackSchema = z.strictObject({
  index: z.number().int(),
  label: z.string().max(40),
  lang: z.string().max(12).nullable(),
  codec: z.string().max(16),
  channels: z.number().int().nullable(),
  /** Pasa a AAC estéreo (todo lo que no es AAC-LC). */
  converted: z.boolean(),
});
export type VodAudioTrack = z.infer<typeof VodAudioTrackSchema>;

/**
 * La concesión de un VOD: un `StreamGrant` de siempre (`source: 'iptv'`,
 * `hls` en la web y `hls-fmp4` con `?t=` en el iPhone; `StreamSourceSchema`
 * no cambia) más lo que el reproductor necesita saber del título.
 */
export const VodGrantSchema = StreamGrantSchema.extend({
  vod: z.strictObject({
    id: HashSchema,
    kind: z.enum(['movie', 'episode']),
    seriesId: HashSchema.nullable(),
    title: z.string().max(200),
    subtitle: z.string().max(200).nullable(),
    durationS: z.number().positive().max(86_400),
    startS: z.number().nonnegative(),
    /** `startS` salió del progreso → «Reanudado en 43:12». */
    resumed: z.boolean(),
    audio: z.array(VodAudioTrackSchema).max(16),
    audioIndex: z.number().int(),
    video: z.strictObject({
      codec: z.enum(['h264', 'hevc']),
      /** RFC 6381: 'avc1.640028' | 'hvc1.2.4.L120.B0'. */
      codecs: z.string().max(64),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
    next: z
      .strictObject({ id: HashSchema, title: z.string().max(200), label: z.string().max(80) })
      .nullable(),
    poster: VodArtStampSchema.nullable(),
  }),
});
export type VodGrant = z.infer<typeof VodGrantSchema>;

/**
 * POST /api/v1/vod/titles/:id/progress (§10.2): 204 sin cuerpo. `tick` se
 * vuelca como mucho una vez por minuto; lo demás, al momento. En las marcas
 * (`mark`, `unmark`, `mark-through`, `hide`, `forget`) `posS` y `durS` se
 * ignoran.
 */
export const VodProgressBodySchema = z.strictObject({
  posS: z.number().min(0).max(86_400).default(0),
  durS: z.number().min(0).max(86_400).default(0),
  event: z.enum([
    'tick',
    'pause',
    'seek',
    'ended',
    'stop',
    'mark',
    'unmark',
    'mark-through',
    'hide',
    'forget',
  ]),
  /** Lengua de la pista elegida: se recuerda por serie o por película (§10.4). */
  audio: z.string().max(8).nullable().optional(),
  /** Reservado para los subtítulos (§9.10). */
  subtitle: z.string().max(12).nullable().optional(),
});
export type VodProgressBody = z.infer<typeof VodProgressBodySchema>;

/* --- «Mi lista» (0.9.1) ---
   Películas y series que Isma guarda para ver luego, por casa
   (`v2/vod-mi-lista.json`): vale en el PC y en el iPhone y entra en la copia
   de seguridad. NO se filtra por los idiomas elegidos: enseña lo que se
   añadió, sea del idioma que sea (con su distintivo). */

/** Por dónde va una serie de «Mi lista» (si se ha empezado). */
export const VodListUpToSchema = z.strictObject({
  /** «T2 · E5 · El regreso» (el que se está viendo) o el siguiente propuesto. */
  label: z.string().max(120),
  /** true = el anterior se acabó y este es el siguiente (empieza de cero). */
  next: z.boolean(),
});
export type VodListUpTo = z.infer<typeof VodListUpToSchema>;

/**
 * Un título de «Mi lista»: la tarjeta de siempre (`VodCard`) más cuándo se
 * añadió, si sigue en el catálogo y, en una serie, por dónde va. Si ya no
 * está (`available: false`), la tarjeta lleva lo guardado al añadirlo
 * (título y año), sin cartel ni distintivos.
 */
export const VodListItemSchema = VodCardSchema.extend({
  addedAt: IsoDateTimeSchema,
  /** false = «Ya no está en tu IPTV» (se queda en la lista hasta que se quite). */
  available: z.boolean(),
  /** Solo series empezadas; null en películas y en series sin empezar o ya vistas. */
  upTo: VodListUpToSchema.nullable(),
});
export type VodListItem = z.infer<typeof VodListItemSchema>;

/** GET/PUT/DELETE /api/v1/vod/list…: la lista entera, de la más nueva a la más vieja. */
export const VodListSchema = z.strictObject({
  items: z.array(VodListItemSchema).max(VOD_LIST.itemsMax),
  /** Cuántos caben (500). */
  max: z.number().int().positive(),
});
export type VodList = z.infer<typeof VodListSchema>;

/** Una película o una serie de «Mi lista» (40 hex sellados). */
export const VodListParamsSchema = VodTitleParamsSchema;
export type VodListParams = z.infer<typeof VodListParamsSchema>;
