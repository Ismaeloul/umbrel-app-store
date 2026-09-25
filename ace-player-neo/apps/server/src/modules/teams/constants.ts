/* Constantes del módulo `teams` (escudos y colores). Módulo nuevo: no hay
   línea de server.js que citar. Los ritmos son prudentes con la clave
   gratuita de TheSportsDB (`123`), que limita las peticiones por minuto y
   devuelve un solo resultado por búsqueda. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Primera vuelta de resolución tras arrancar y cadencia después. */
export const TEAMS_FIRST_RUN_MS = 30 * SECOND;
export const TEAMS_ROUND_INTERVAL_MS = 5 * MINUTE;
/** Resoluciones (búsqueda + escudo) por vuelta. */
export const TEAMS_ROUND_BUDGET = 20;
/** Pausa entre dos resoluciones (cola única: nunca dos peticiones a la vez). */
export const TEAMS_REQUEST_GAP_MS = 1500;
/** Plazo y topes de cada descarga. */
export const TEAMS_FETCH_TIMEOUT_MS = 15 * SECOND;
export const TEAMS_SEARCH_MAX_BYTES = 256 * 1024;
export const TEAMS_IMAGE_MAX_BYTES = 512 * 1024;
/** Un escudo de más de 1024 px por lado no es un escudo. */
export const TEAMS_IMAGE_MAX_DIMENSION = 1024;
/** Sufijo de TheSportsDB para la versión reducida (200 px, ~37 KB) de una imagen. */
export const TEAMS_IMAGE_SIZE_SUFFIX = '/small';
/** Espera tras un fallo de red o 5xx, por número de intentos. */
export const TEAMS_RETRY_BACKOFF_MS: readonly number[] = [10 * MINUTE, HOUR, 6 * HOUR, DAY];
/** Un 429 para la vuelta y pausa todo el módulo una hora. */
export const TEAMS_RATE_LIMIT_PAUSE_MS = HOUR;
/** Sin resultados o imagen mala: se vuelve a intentar en una semana. */
export const TEAMS_NOT_FOUND_RETRY_MS = 7 * DAY;
/** Dos candidatos igual de buenos: hasta que un override lo fije (o en 30 días). */
export const TEAMS_AMBIGUOUS_RETRY_MS = 30 * DAY;
/** Lo resuelto se revalida cada 90 días (los escudos cambian). */
export const TEAMS_REVALIDATE_MS = 90 * DAY;
/** Topes del índice y de los PNG en disco (~40 KB de media → ~16 MB). */
export const TEAMS_MAX_ENTRIES = 600;
export const TEAMS_MAX_CRESTS = 400;
export const TEAMS_MAX_COMPETITIONS = 60;
/** Búferes de PNG en memoria (LRU). */
export const TEAMS_BUFFER_CACHE = 64;
/** Umbrales del parecido de nombres (el mínimo es `SCORE_MIN_ANCHOR` de los marcadores). */
export const TEAMS_MIN_SCORE = 0.6;
export const TEAMS_MIN_MARGIN = 0.2;
export const TEAMS_COUNTRY_BONUS = 0.15;
export const TEAMS_LEAGUE_BONUS = 0.1;
/** Cabeceras de caché del endpoint (informe de fase 2, §6). */
export const TEAMS_CACHE_VERSIONED = 'public, max-age=31536000, immutable';
export const TEAMS_CACHE_PLAIN = 'private, max-age=86400, stale-while-revalidate=604800';
/** Ficheros dentro de `paths.teamsDir`. */
export const TEAMS_INDEX_FILE = 'index.json';
export const TEAMS_COMPETITIONS_DIR = 'competitions';
export const TEAMS_DATA_OVERRIDES_FILE = 'overrides.json';
