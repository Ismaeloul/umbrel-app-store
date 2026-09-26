/* Constantes de la IPTV (docs/iptv.md). Un solo sitio para los umbrales,
   los topes y los plazos que comparten el servidor, la web y los tests; la
   app iOS copia los que necesita (motivos y tope de candidatas).

   Nada de aquí es lógica: el emparejado, el relé y la guía viven en
   apps/server/src/modules/iptv. */

import { RESOLUTION_EXACT_SCORE } from '../domain/channels.js';

const KIB = 1024;
const MIB = 1024 * KIB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// --- Emparejado (§4) ---

/**
 * Puntuación mínima para que una entrada IPTV case con un canal (§4.3, D8):
 * la de «es ese canal, sin duda». Una familia numerada (78) nunca entra.
 */
export const IPTV_MIN_SCORE = RESOLUTION_EXACT_SCORE;
/** Puntuación de una IPTV confirmada por la guía (§4.3 y §4.5). */
export const IPTV_GUIDE_SCORE = 100;
/** Candidatas IPTV por resolución como mucho: un cartel por canal y 2 en total (§4.3, D23). */
export const IPTV_MAX_CANDIDATES = 2;
/** Variantes de respaldo (FHD, HD, reserva) que guarda el servidor por canal, además de la principal (§4.3). */
export const IPTV_MAX_BACKUP_VARIANTS = 2;
/** Nombres de canal confirmados por la guía que se usan como pista para AceStream (§4.5). */
export const IPTV_MAX_GUIDE_HINTS = 2;
/** Canales distintos de la guía por encima de los cuales hay que casar también con la agenda (§4.5.6). */
export const IPTV_GUIDE_AMBIGUOUS_CHANNELS = 3;
/**
 * Orden de procedencia de las candidatas (§4.6): la IPTV va primera, antes
 * que los vínculos guardados. `sources/ranking.ts` lo usa como su
 * `DEFAULT_SOURCE_ORDER`.
 */
export const IPTV_SOURCE_ORDER = [
  'iptv',
  'saved',
  'm3u',
  'favorites',
  'history',
  'acestream',
] as const;

/**
 * Motivos (`ScanCandidate.reason` y `scan.verdict.reason`) de una IPTV (§5.1
 * y §7.3). No hay `iptv_ready`: una cuenta activa no es un stream
 * verificado. `iptv_busy` es `weak`; los demás, `failed`.
 */
export const IPTV_REASONS = [
  'iptv_busy',
  'iptv_auth_failed',
  'iptv_account_expired',
  'iptv_gone',
  'iptv_timeout',
  'iptv_unreachable',
  'iptv_dropped',
  'iptv_unsupported',
] as const;
export type IptvReason = (typeof IPTV_REASONS)[number];

export function isIptvReason(value: unknown): value is IptvReason {
  return typeof value === 'string' && (IPTV_REASONS as readonly string[]).includes(value);
}

/**
 * Fallos de cuenta (§4.3): con ellos no se prueban otras variantes del
 * canal, se salta directamente a AceStream.
 */
export const IPTV_ACCOUNT_REASONS: readonly IptvReason[] = [
  'iptv_busy',
  'iptv_auth_failed',
  'iptv_account_expired',
];

// --- Configuración (§1 y §2) ---

/** Tope del nombre del proveedor («Casa»). Si falta, el servidor usa `IPTV_DEFAULT_NAME`. */
export const IPTV_NAME_MAX = 40;
export const IPTV_DEFAULT_NAME = 'IPTV';
/** Tope de la URL de la lista o del servidor Xtream en el cuerpo de `iptvSave`. */
export const IPTV_URL_MAX = 2048;
/** Tope del usuario y de la contraseña de Xtream. */
export const IPTV_SECRET_MAX = 200;
/** Horas entre sincronizaciones de la lista (§3.5, D12). Es el `refreshHours` de `IptvView`. */
export const IPTV_REFRESH_HOURS = 6;

/** User-Agent por defecto hacia el proveedor (§3.1, D17). */
export const IPTV_USER_AGENT = 'VLC/3.0.21 LibVLC/3.0.21';
/** Tope de `http-user-agent=` y `http-referrer=` de `#EXTVLCOPT` (§3.1). */
export const IPTV_VLCOPT_MAX = 256;

// --- Descargas (§3) ---

/** Canales en directo como mucho en un catálogo (`iptv_too_large` si pasa, §3.4). */
export const IPTV_MAX_CHANNELS = 100_000;

/** Lista M3U (§3.2 y §3.4). */
export const IPTV_M3U_LIMITS = {
  maxBytes: 64 * MIB,
  maxDecompressedBytes: 160 * MIB,
  totalMs: 120 * SECOND,
  maxLineBytes: 16 * KIB,
} as const;

/** Llamadas de Xtream Codes a `player_api.php` (§3.3). */
export const IPTV_XTREAM_LIMITS = {
  userInfo: { maxBytes: 256 * KIB, totalMs: 8 * SECOND },
  liveCategories: { maxBytes: 2 * MIB, totalMs: 20 * SECOND },
  liveStreams: { maxBytes: 48 * MIB, totalMs: 90 * SECOND, idleMs: 20 * SECOND },
  shortEpg: { maxBytes: 256 * KIB, totalMs: 8 * SECOND },
  /** Tope de cada objeto del array de `get_live_streams` (troceador en streaming). */
  maxObjectBytes: 16 * KIB,
} as const;

/** Guía XMLTV (§3.6). */
export const IPTV_GUIDE_LIMITS = {
  maxBytes: 64 * MIB,
  maxDecompressedBytes: 512 * MIB,
  totalMs: 180 * SECOND,
  idleMs: 30 * SECOND,
  maxTextBytes: 8 * KIB,
  maxDepth: 8,
  maxAttributes: 64,
  windowMs: 48 * HOUR,
  maxProgrammes: 60_000,
  /** Respaldo de Xtream con `get_short_epg`: canales, llamadas a la vez y cada cuánto. */
  shortEpgChannels: 40,
  shortEpgConcurrency: 2,
  shortEpgEveryMs: 3 * HOUR,
} as const;

/** Prueba rápida de «Guardar IPTV» (§5.3): Xtream `user_info`; M3U, los primeros bytes. */
export const IPTV_QUICK_TEST = {
  xtreamMs: 8 * SECOND,
  m3uMs: 20 * SECOND,
  m3uBytes: 256 * KIB,
  /**
   * Un solo reintento interno (§16.8) si el primer intento falló por algo
   * pasajero y en menos de `retryFastMs`, tras `retryDelayMs`. Los dos
   * intentos caben en `budgetMs` (la web espera 30 s, `TIMEOUTS.iptvSave`).
   */
  retryFastMs: 5 * SECOND,
  retryDelayMs: 1_500,
  budgetMs: 25 * SECOND,
} as const;

/** Refrescos (§3.5, §3.6 y §7.4). */
export const IPTV_REFRESH = {
  listMs: IPTV_REFRESH_HOURS * HOUR,
  guideMs: 8 * HOUR,
  accountMs: 10 * MINUTE,
  /** Antigüedad a partir de la cual una resolución vuelve a preguntar la cuenta (plazo `accountCheckMs`). */
  accountStaleMs: 2 * MINUTE,
  accountCheckMs: 5 * SECOND,
  /** «Rebuscar» refresca la lista si tiene más de esto. */
  researchStaleMs: 30 * MINUTE,
  /** Con alguien viendo, el refresco periódico de la lista y de la guía se retrasa hasta esto. */
  listDelayWatchingMs: 1 * HOUR,
  guideDelayWatchingMs: 2 * HOUR,
  /** Espera exponencial tras un fallo. */
  listBackoffMinMs: 5 * MINUTE,
  listBackoffMaxMs: 6 * HOUR,
  guideBackoffMinMs: 30 * MINUTE,
  guideBackoffMaxMs: 8 * HOUR,
  /** M3U con 401/403/404 al abrir: refresco como mucho una vez por minuto. */
  m3uTokenRefreshMs: 1 * MINUTE,
  /** Xtream con 404 al abrir: refresco en segundo plano con antirrebote. */
  xtreamGoneRefreshMs: 10 * MINUTE,
  /** Entre las dos comprobaciones de `user_info` que dan la cuenta por caducada. */
  accountExpiredConfirmMs: 1 * MINUTE,
} as const;

// --- Reproducción (§6) ---

/** Relé local y reconexión (§6.1 y §6.6). */
export const IPTV_RELAY = {
  /** Sin bytes del proveedor en este rato, se reconecta. */
  idleMs: 10 * SECOND,
  /** Esperas antes de cada intento de reconexión. */
  backoffMs: [1 * SECOND, 2 * SECOND, 4 * SECOND],
  /** Plazo para las cabeceras en cada apertura o reconexión. */
  headersMs: 8 * SECOND,
  /** Intentos de reconexión como mucho en `attemptsWindowMs`. */
  maxAttempts: 3,
  attemptsWindowMs: 60 * SECOND,
  /** Salto de PTS/PCR tras reconectar por encima del cual se reinicia el remux. */
  ptsJumpMs: 5 * SECOND,
  /** Segmentos HLS recordados (`seq → URL real`). */
  segmentMemory: 40,
  /** La lista de medios del proveedor se pide como mucho una vez en este rato. */
  playlistCacheMs: 1 * SECOND,
  /** Sin lista de medios nueva en este rato, cuenta como corte. */
  playlistStaleMs: 15 * SECOND,
  playlistFailures: 3,
  /** Resolución máxima al elegir variante de una lista maestra. */
  maxWidth: 1920,
  maxHeight: 1080,
} as const;

/** Estados HTTP del proveedor que cuentan como «plaza ocupada» (§6.1 y §6.5). */
export const IPTV_BUSY_STATUSES: readonly number[] = [403, 429, 456, 458, 509];

/**
 * `-rw_timeout` de ffmpeg con origen IPTV, en MICROsegundos (§6.3): por encima
 * del peor caso del relé, 41 s de reconexiones más los 8 s de abrir otra
 * variante (49 s). Si ffmpeg muriera antes, la sesión se cerraría sin probarla.
 */
export const IPTV_FFMPEG_RW_TIMEOUT_US = 55_000_000;
/** Espera del remux IPTV: 2 segmentos o este tope (`iptv_timeout`, §6.3). */
export const IPTV_REMUX_READY_MS = 20 * SECOND;

/** Sesión y plaza del proveedor (§6.4 y §6.5). */
export const IPTV_SESSION = {
  /** Gracia al irse el último visor sin pedir otra cosa. */
  graceMs: 3 * SECOND,
  /** Cierres nuestros que se recuerdan y se descuentan de `active_cons`. */
  recentCloseMs: 120 * SECOND,
  /** Esperas de los reintentos al abrir con la plaza recién cerrada. */
  busyRetryMs: [2 * SECOND, 4 * SECOND, 8 * SECOND],
  /** Estadísticas del relé → `stream.stats`. */
  statsEveryMs: 2 * SECOND,
  /** Con bytes entrando, el relé apunta `working` por `player` cada este rato. */
  workingEveryMs: 60 * SECOND,
} as const;

// --- Comprobación (§7.3) ---

export const IPTV_PROBE = {
  /** La sonda de fondo lee hasta esto o hasta `maxBytes`. */
  maxMs: 6 * SECOND,
  maxBytes: 1.5 * MIB,
  /** Un mismo canal no se vuelve a sondear antes de esto. */
  sameChannelMs: 30 * MINUTE,
  /** Reintento de una IPTV fallida (no 10 min: la plaza se libera sola). */
  failedRetryMs: 2 * MINUTE,
  /** Reintento de la comprobación de cuenta con `iptv_busy`. */
  busyRetryMs: 2 * MINUTE,
  /** Mientras se ve una IPTV, cada cuánto se revalidan las mejores AceStream `working`. */
  keepWarmMs: 10 * MINUTE,
  keepWarmCount: 2,
} as const;

// --- Web y app (§1.5, §6.6, §7.2 y §8.4) ---

export const IPTV_CLIENT = {
  /** `footballResolve` con `scope=channel` al tocar un canal. */
  channelResolveMs: 2_500,
  /** `footballResolve?match=` de un partido sin canales. */
  matchResolveMs: 5_000,
  /** Sin SSE, se sondea `iptvGet` cada esto mientras dure `syncing`, y como mucho `syncPollMaxMs`. */
  syncPollMs: 3 * SECOND,
  syncPollMaxMs: 2 * MINUTE,
  /** Saltos automáticos del puente IPTV ↔ AceStream como mucho en `bridgeWindowMs`. */
  bridgeMaxJumps: 2,
  bridgeWindowMs: 3 * MINUTE,
  /** `autoTried` de una IPTV solo se limpia con un `working` posterior y pasado esto. */
  autoTriedResetMs: 60 * SECOND,
  /** Una IPTV probada en este rato no recibe el salto desde AceStream. */
  bridgeRecentTryMs: 60 * SECOND,
  /** El toast «Volver a la IPTV» dura esto. */
  backToastMs: 8 * SECOND,
  /** `iptvChannels` desde Buscar y el filtro de Canales (docs/iptv.md §14.2): `TIMEOUTS.iptvChannels` de la web. */
  searchMs: 4 * SECOND,
  /** `footballResolve` con `engine=1` (búsqueda inversa de fondo, §14.4). */
  channelEngineMs: 20 * SECOND,
  /** `iptvBrowse` (la pestaña IPTV de Canales, §16.2): `TIMEOUTS.iptvBrowse` de la web. */
  browseMs: 6 * SECOND,
  /** Espera tras la última tecla del campo de la pestaña y tras un cambio de filtro (juntar toques). */
  browseDebounceMs: 450,
  browseFilterDebounceMs: 200,
} as const;

// --- Buscador: IPTV y AceStream juntos (§14) ---

export const IPTV_SEARCH = {
  /** Filas por búsqueda: por defecto y como mucho. */
  limit: 50,
  /** `total` cuenta hasta aquí; si hay más, `capped: true`. */
  totalCap: 200,
  /** Filas IPTV a la vista antes de «Ver más»: en Buscar y en el filtro de Canales. */
  shownInSearch: 5,
  shownInLibrary: 3,
  /** Ids de tu biblioteca que se devuelven por canal IPTV, y cuántos de la biblioteca se miran como mucho. */
  libraryMatchesMax: 20,
  libraryCandidatesMax: 200,
  /** Grupos del catálogo preseleccionados por resultado del motor al anotar `SearchResult.iptv`. */
  annotatePreselect: 50,
  /** Consultas al motor de la búsqueda inversa (§14.4). */
  reverseQueriesMax: 2,
  /** Con menos fuentes de AceStream que esto, la sesión del canal pide la búsqueda inversa. */
  reverseBelowAce: 3,
  /** Un favorito IPTV que no casa tras cambiar de proveedor se quita pasado esto (§14.6). */
  relinkGraceMs: 24 * HOUR,
} as const;

/** Estado de un id IPTV de favoritos o recientes (`LibraryView.iptvIds`, §14.6). */
export const IPTV_ID_STATES = ['ok', 'iptv_gone', 'iptv_disabled', 'iptv_removed'] as const;
export type IptvIdState = (typeof IPTV_ID_STATES)[number];

// --- Pestaña IPTV en Canales (§16) ---

export const IPTV_BROWSE = {
  /** Filas por página: por defecto y como mucho. `limit=0` pide solo categorías y facetas. */
  limit: 60,
  limitMax: 100,
  /** Categorías devueltas como mucho (las del proveedor, en su orden). */
  categoriesMax: 2_000,
  /** Categorías cuyo nombre contiene el texto, en la raíz con texto (§16.3). */
  categoriesMatchMax: 5,
  /** Valores por faceta como mucho (País puede pasar de 100). */
  facetValuesMax: 250,
  /** Valores elegidos por faceta en una consulta. */
  selectedMax: 16,
  /** Consultas ya calculadas que el servidor guarda para servir las páginas siguientes. */
  cacheEntries: 16,
  /** Nombre de categoría enseñado: como mucho. */
  categoryNameMax: 120,
  /** El índice se monta a trozos de este tamaño, cediendo el hilo entre trozo y trozo. */
  buildChunk: 5_000,
  /** …y este rato después de aplicar la lista (o antes, si alguien abre la pestaña). */
  buildDelayMs: 2 * SECOND,
} as const;

/** Tipos (§16.4). El orden es el de la hoja de filtros cuando empatan en número. */
export const IPTV_TYPES = [
  'generalistas',
  'deportes',
  'cine',
  'series',
  'noticias',
  'infantil',
  'documentales',
  'musica',
  'entretenimiento',
  'religion',
  'adultos',
] as const;
export type IptvType = (typeof IPTV_TYPES)[number];

/** Deportes (§16.4). */
export const IPTV_SPORTS = [
  'futbol',
  'baloncesto',
  'f1',
  'motos',
  'motor',
  'tenis',
  'padel',
  'golf',
  'ciclismo',
  'balonmano',
  'rugby',
  'lucha',
  'futbol-americano',
  'hockey',
  'beisbol',
  'toros',
] as const;
export type IptvSport = (typeof IPTV_SPORTS)[number];

/** Calidades de la faceta Calidad, en su orden fijo (4K, 1080p, 720p, SD). */
export const IPTV_BROWSE_QUALITIES = ['uhd', 'fhd', 'hd', 'sd'] as const;
