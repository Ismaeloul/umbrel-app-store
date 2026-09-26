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
/**
 * Espera del remux IPTV (`iptv_timeout`, §6.3): la lista tiene que quedar lista
 * (docs/multidispositivo.md §4.3) este rato después del PRIMER BYTE ENTREGADO A
 * FFMPEG (hasta la 0.8.1 contaba desde que arrancaba ffmpeg). §4.5.
 */
export const IPTV_REMUX_READY_MS = 20 * SECOND;
/** Tope desde que se abre el relé (reintentos de «ocupado» de 2, 4 y 8 s incluidos) hasta la lista lista. */
export const IPTV_REMUX_OPEN_MAX_MS = 28 * SECOND;
/**
 * Tope total de una petición de canal IPTV, cerrojo de la casa incluido
 * (esperar a que se cierre la sesión anterior y el relé suelte la plaza). Por
 * debajo de `remuxStartClientMs` (55 s) y de los 60 s de nginx: el cliente
 * siempre recibe `iptv_timeout`, nunca un corte (docs/multidispositivo.md §4.5).
 */
export const IPTV_ACQUIRE_MAX_MS = 50 * SECOND;
/**
 * Análisis de la entrada con origen IPTV: 2 MB / 2 s (el motor sigue con los
 * 5 MB / 5 s de la 0.6.59). Si ffmpeg no encuentra los parámetros, UN reinicio
 * con `IPTV_PROBE_FALLBACK` sin soltar la conexión con el proveedor (§4.5).
 */
export const IPTV_PROBE_ARGS = { probesize: 2_000_000, analyzeduration: 2_000_000 } as const;
export const IPTV_PROBE_FALLBACK = { probesize: 5_000_000, analyzeduration: 5_000_000 } as const;
/** Cola de lo último entregado a ffmpeg que el relé guarda para volver a dárselo tras ese reinicio. */
export const IPTV_PROBE_RETAIN_BYTES = 5 * MIB;
/** Sin imagen en este rato, la web pasa de «Conectando con tu IPTV…» a «Tu IPTV está tardando en arrancar…». */
export const IPTV_SLOW_START_MS = 10 * SECOND;

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
} as const;
