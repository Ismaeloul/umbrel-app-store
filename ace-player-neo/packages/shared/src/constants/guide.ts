/* Constantes de la Guía TV (docs/iptv.md §20): la guía COMPLETA de la IPTV
   guardada en disco (`v2/iptv/guia.db`) y la API por trozos que pinta la
   parrilla. Un solo sitio para la ventana, los topes y las marcas de un
   programa, que comparten el servidor, la web, la demo y los tests.

   Nada de aquí es lógica: la descarga y el guardado viven en
   apps/server/src/modules/iptv/guide-*.ts y el generador de ejemplo en
   src/demo/guide.ts. */

const KIB = 1024;
const MIB = 1024 * KIB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Guardado de la guía completa (§20.2). */
export const IPTV_GUIDE_STORE = {
  /**
   * Se guarda desde 24 h antes de la descarga: la web enseña «hoy» desde las
   * 00:00 de SU zona, que como mucho son 24 h atrás.
   */
  pastMs: 24 * HOUR,
  /**
   * …hasta 80 h después: hoy, mañana y pasado mañana enteros en cualquier
   * zona (72 h) y 8 h de margen hasta la siguiente descarga.
   */
  futureMs: 80 * HOUR,
  /** Días que enseña la parrilla: hoy, mañana y pasado. */
  days: 3,
  /** Programas guardados como mucho; si se pasa, el resto se ignora (se dice en el registro). */
  maxProgrammes: 2_000_000,
  /** Tope del fichero (`PRAGMA max_page_count`): con el disco lleno se deja de guardar, no se falla. */
  maxBytes: 512 * MIB,
  /** Caché de páginas de SQLite al leer (por conexión) y al construir. */
  readCacheBytes: 8 * MIB,
  buildCacheBytes: 16 * MIB,
  /** Recortes al guardar (lo que pase se corta por una palabra y lleva «…»). */
  titleChars: 200,
  subTitleChars: 300,
  descChars: 800,
  categoriesMax: 8,
  categoryChars: 60,
  directorsMax: 3,
  actorsMax: 5,
  creditChars: 80,
  /** Construir cede el hilo cada tantos ms de trabajo seguido (la IPTV no se corta, §20.3). */
  sliceMs: 12,
} as const;

/** Arreglos de los horarios al guardar (§20.4). Intervalos semiabiertos [inicio, fin). */
export const IPTV_GUIDE_NORMALIZE = {
  /** Sin `stop`: acaba cuando empieza el siguiente si es antes de 12 h… */
  noStopMaxGapMs: 12 * HOUR,
  /** …y si no hay siguiente (o está más lejos), se pinta con 30 min. */
  noStopDefaultMs: 30 * MINUTE,
  /** Un hueco de menos de 2 min se pega al programa anterior. */
  gapMergeMs: 2 * MINUTE,
  /** Un bloque de más de 12 h es relleno («Sin información»). */
  fillerMs: 12 * HOUR,
  /** Ningún bloque dura más de 24 h (lo que pase se recorta). */
  maxDurationMs: 24 * HOUR,
} as const;

/** API por trozos (§20.6). */
export const IPTV_GUIDE_API = {
  /** Canales por página de `iptvGuide` (por defecto y como mucho). */
  channelsPage: 200,
  channelsPageMax: 1000,
  /** `iptvGuideProgrammes`: como mucho 60 canales y 12 h por petición. */
  sliceChannelsMax: 60,
  sliceMaxMs: 12 * HOUR,
  /** Programas por canal en una respuesta (uno de 5 min en 12 h son 144). */
  sliceProgrammesMax: 400,
  /**
   * Cómo pide la web (recomendado, no obligatorio): teselas de 6 h alineadas
   * en UTC y bloques de 30 canales, para reutilizarlas en la caché.
   */
  tileMs: 6 * HOUR,
  tileRows: 30,
  /** `iptvGuideNow`: ids como mucho por petición. */
  nowIdsMax: 100,
} as const;

/** Logos de canal e imágenes de programa por el proxy propio (`iptvGuideArt`, §20.6). */
export const IPTV_GUIDE_ART = {
  maxBytes: 512 * KIB,
  timeoutMs: 8 * SECOND,
  /** Caché en memoria (LRU) de lo ya descargado. */
  cacheBytes: 16 * MIB,
  concurrency: 2,
  /** Con más en cola, 503 con `Retry-After`. */
  queueMax: 32,
  /** Un logo que falló no se vuelve a pedir en este rato. */
  negativeMs: 1 * HOUR,
} as const;

/**
 * Marcas de un programa (`flags`, un número): se suman. `live` es `<live/>`,
 * `new` es `<new/>` (estreno), `repeat` es `<previously-shown/>`; `detail`,
 * que tiene ficha con algo más que el título (`iptvGuideProgramme`);
 * `filler`, un bloque de relleno que se pinta como «Sin información» (más de
 * 12 h, sin título o «Programación no disponible»); `noStop`, que la guía no
 * decía cuándo acababa (su fin es el inicio del siguiente o 30 min); `image`,
 * que tiene imagen (`iptvGuideArt` con `p<id>`).
 */
export const GUIDE_FLAGS = {
  live: 1,
  new: 2,
  repeat: 4,
  detail: 8,
  filler: 16,
  noStop: 32,
  image: 64,
} as const;
export type GuideFlagName = keyof typeof GUIDE_FLAGS;
/** Todas las marcas juntas (el máximo de `flags`). */
export const GUIDE_FLAGS_ALL = 127;

/** ¿Lleva esa marca? */
export function hasGuideFlag(flags: number, name: GuideFlagName): boolean {
  return (flags & GUIDE_FLAGS[name]) !== 0;
}
