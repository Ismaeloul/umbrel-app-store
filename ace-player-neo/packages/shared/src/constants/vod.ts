/* Constantes de Películas y series, el VOD de la IPTV (docs/vod.md §4.2 y
   §11.5). Un solo sitio para los topes, los plazos y los umbrales que
   comparten el servidor, la web, los tests y, cuando copie la pantalla, la
   app iOS (`VOD_CLIENT` lo usa hoy `apps/web/src/api/client.ts`; ningún
   guion de apps/ios/scripts lo copia todavía: la app lo llevará a
   `PlazosWeb` en su fase, docs/vod.md §17).

   Nada de aquí es lógica: el catálogo, las fichas, los carteles y el
   progreso viven en apps/server/src/modules/iptv/vod; el relé VOD en
   iptv/relay-vod.ts y la reproducción en apps/server/src/modules/remux/vod. */

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// --- Catálogo (§4.2) ---

/**
 * Topes de las llamadas VOD de `player_api` y del catálogo en memoria. Pasar
 * `maxMovies` o `maxSeries` RECORTA (`truncated: true`), no falla (T7). Los
 * `maxObjectBytes` son propios: el troceador del directo salta en silencio
 * lo que pasa de 16 KiB (T5), y una serie con sinopsis y reparto largos
 * llega a los 200 KiB; lo que se salta se cuenta en `skipped`.
 *
 * Los topes de títulos dejan margen ×2 sobre el panel de Isma (Paso 0 del
 * 3-oct: 181.210 películas en 66,6 MB y 48.797 series en 50,6 MB), y al
 * doble las listas siguen cabiendo en sus 160 MiB.
 */
export const VOD_LIMITS = {
  maxMovies: 400_000,
  maxSeries: 100_000,
  categories: { maxBytes: 2 * MIB, totalMs: 20 * SECOND },
  movies: {
    maxBytes: 160 * MIB,
    totalMs: 240 * SECOND,
    idleMs: 30 * SECOND,
    maxObjectBytes: 64 * KIB,
  },
  series: {
    maxBytes: 160 * MIB,
    totalMs: 240 * SECOND,
    idleMs: 30 * SECOND,
    maxObjectBytes: 256 * KIB,
  },
  /** Modo por categorías (§4.7): `&category_id=X` de una en una, con 250 ms entre llamadas. */
  byCategory: { maxBytes: 32 * MIB, totalMs: 60 * SECOND, spacingMs: 250 },
  movieInfo: { maxBytes: 512 * KIB, totalMs: 10 * SECOND },
  /** 748 episodios ≈ 2 MiB (medido). */
  seriesInfo: { maxBytes: 8 * MIB, totalMs: 20 * SECOND },
  seasonsMax: 100,
  episodesPerSeasonMax: 500,
  episodesMax: 3_000,
  titleMax: 200,
  plotMax: 2_000,
  episodePlotMax: 600,
} as const;

/** Cada cuánto se vuelve a descargar el catálogo VOD (§4.7). */
export const VOD_REFRESH_MS = 24 * HOUR;

/**
 * Extensiones de fichero que se aceptan de `container_extension` (§4.3), en
 * minúsculas. Cualquier otra es «desconocida» (índice 0 en la tabla): la
 * dice el índice al reproducir. El orden es el del índice de `VodTable.ext`
 * menos uno: no se reordena, porque `vod.enc` guarda el índice.
 */
export const VOD_EXTENSIONS = ['mp4', 'mkv', 'm4v', 'mov', 'avi', 'ts', 'webm'] as const;
export type VodExtension = (typeof VOD_EXTENSIONS)[number];

/**
 * Motivos de `vod_unsupported` (`error.data.reason`, §11.3 y §13):
 * - `formato`: AVI (y en la v1, nada que no sea MKV o MP4).
 * - `video`: MPEG-4 parte 2, MPEG-2, VC-1 o H.264 de 10 bits.
 * - `hevc`: HEVC pedido sin `hevc=1` (el navegador no lo decodifica).
 * - `indice`: sin índice de fotogramas clave (MKV sin Cues, TS).
 * - `sin_saltos`: el proveedor no responde a Range (200 con inicio > 0).
 */
export const VOD_UNSUPPORTED_REASONS = [
  'formato',
  'video',
  'hevc',
  'indice',
  'sin_saltos',
] as const;
export type VodUnsupportedReason = (typeof VOD_UNSUPPORTED_REASONS)[number];

// --- Búsqueda, fichas y carteles (§6, §7 y §8) ---

/** Búsqueda (§6.3): se guardan los 2 000 mejores; caché LRU de 16 consultas; páginas de 60 (100 como mucho). */
export const VOD_SEARCH = {
  rowsMax: 2_000,
  cacheQueries: 16,
  pageDefault: 60,
  pageMax: 100,
} as const;

/** Cola de fichas (§7.1): 1 en vuelo, 300 ms entre llamadas, 60 por minuto y 8 en espera; LRU de 8 MiB y 6 h. */
export const VOD_DETAILS = {
  cacheBytes: 8 * MIB,
  ttlMs: 6 * HOUR,
  spacingMs: 300,
  perMinute: 60,
  waitingMax: 8,
} as const;

/** Proxy de carteles (§8): topes por imagen, 4 a la vez y 64 en cola, caché en disco de 256 MiB y 5 000 ficheros. */
export const VOD_ART = {
  posterMaxBytes: 1 * MIB,
  backdropMaxBytes: 2 * MIB,
  fetchMs: 8 * SECOND,
  concurrent: 4,
  queue: 64,
  cacheBytes: 256 * MIB,
  cacheFiles: 5_000,
  negativeMs: HOUR,
} as const;

// --- Reproducción (§9) ---

/** El relé VOD, el índice y el productor (§9.3-§9.7). */
export const VOD_PLAY = {
  segmentMinS: 6,
  /** El segmento pedido empieza > 30 s después de lo producido → reinicio allí. */
  restartAheadS: 30,
  /** Reinicios agrupados: gana el último pedido. */
  restartMinGapMs: 1_500,
  /** Contrapresión: se deja de leer `pipe:1` por encima de +60 s… */
  aheadMaxS: 60,
  /** …y se sigue por debajo de +30 s. */
  aheadResumeS: 30,
  keepBehindS: 120,
  keepBehindMaxBytes: 256 * MIB,
  sessionDiskMaxBytes: 1.5 * GIB,
  diskFreeMinBytes: 2 * GIB,
  /** Después, 503 con `Retry-After: 1`. */
  segmentWaitMs: 15 * SECOND,
  /** Pausa larga: se suelta el proveedor (lo ajusta el Paso 0, §3.5). */
  idleReleaseMs: 5 * MINUTE,
  /**
   * Salto corto hacia delante sin reabrir (auditoría 0.9.0): solo si leer y tirar el hueco cuesta
   * como mucho `forwardSkipS` con el caudal medido de la conexión (y al menos `forwardSkipMinBytes`,
   * `forwardSkipMaxBytes` como mucho); sin caudal medido, `forwardSkipBytes`. Con los 32 MiB fijos de
   * antes, un salto leía y tiraba hasta 32 MiB (6-7 s a 40 Mb/s) antes de dar el primer byte.
   */
  forwardSkipBytes: 2 * MIB,
  forwardSkipMinBytes: 512 * KIB,
  forwardSkipMaxBytes: 32 * MIB,
  forwardSkipS: 1.5,
  relayHeadBytes: 2 * MIB,
  relayCacheMaxBytes: 40 * MIB,
  moovMaxBytes: 32 * MIB,
  reopenMax: 3,
  reopenWindowMs: 60 * SECOND,
  reopenBackoffMs: [1_000, 2_000, 4_000],
  indexCache: 8,
  ssNudgeS: 0.2,
  /** true solo si el Paso 0 valida que el destino de la redirección admite Range y su token dura (§3.3). */
  reuseRedirect: false,
} as const;

/**
 * Presupuesto de `vodStream` (§9.12). La suma de los cuatro primeros cabe
 * en `grantMs`, que queda 10 s por debajo del plazo de la web
 * (`VOD_CLIENT.streamMs`), y ese, por debajo de los 60 s de `location /api/`
 * en nginx. Lo comprueba test/vod.test.ts.
 */
export const VOD_TIMINGS = {
  accountGateMs: 5 * SECOND,
  closePreviousMs: 5 * SECOND,
  socketReleaseMs: 2 * SECOND,
  /** Incluye los reintentos por ocupado (2 + 4 + 8 s). */
  indexMs: 20 * SECOND,
  /** Tope duro de `vodStream`. */
  grantMs: 40 * SECOND,
} as const;

// --- Progreso y reproductor (§10 y §12) ---

/** Progreso (§10): umbrales de «visto», reanudar, «Seguir viendo» y validación. */
export const VOD_PROGRESS = {
  tickMs: 15 * SECOND,
  flushMs: MINUTE,
  resumeMinS: 30,
  resumeBackS: 5,
  itemsMax: 2_000,
  prefsMax: 500,
  continueMax: 20,
  markThroughMax: 500,
  /** Película vista si quedan ≤ max(180 s, 5 %). */
  watchedMovie: { tailS: 180, ratio: 0.05 },
  /** Episodio visto si quedan ≤ max(60 s, 4 %). */
  watchedEpisode: { tailS: 60, ratio: 0.04 },
  positionSlackS: 5,
  durationTolerance: 0.1,
  durationMaxS: 12 * 3_600,
} as const;

/** El reproductor en modo VOD (§12.7-§12.9). */
export const VOD_PLAYER = {
  seekStepS: 10,
  nextUpBeforeEndS: 20,
  nextUpRatio: 0.02,
  nextUpCountdownS: 10,
  stillWatchingAfter: 3,
  stillWatchingTimeoutMs: MINUTE,
  resumeNoticeMs: 5 * SECOND,
  autoReconnects: 1,
} as const;

/** Plazos de la web (y de la app, cuando copie la pantalla) para las rutas VOD. */
export const VOD_CLIENT = {
  homeMs: 8 * SECOND,
  browseMs: 8 * SECOND,
  titleMs: 25 * SECOND,
  streamMs: 50 * SECOND,
  progressMs: 5 * SECOND,
  searchDebounceMs: 250,
} as const;
