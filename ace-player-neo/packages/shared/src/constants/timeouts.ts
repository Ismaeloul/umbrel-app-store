/* Todos los plazos de la tabla de arquitectura §5.15 en un solo sitio.
   Hoy cada uno está escrito a mano en el servidor, en el cliente y en nginx,
   y no siempre coinciden (P21 de reproductor.md): el cliente esperaba 55 s
   al remux, el servidor 45 y nginx 60, sin que nada los atara. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const TIMEOUTS = {
  /** Meta de sesión del motor (`getstream`/`manifest.m3u8` con `format=json`). Hoy, 12 s en el cliente (index.html:4604). */
  engineSessionMetaMs: 12 * SECOND,
  /** Lectura de `stat_url`. Hoy el cliente usa 4,5 s. */
  engineStatMs: 3 * SECOND,
  /** `command_url` con `method=stop`. Hoy, 2,5 s en el comprobador (server.js:3298). */
  engineStopMs: 2.5 * SECOND,
  /** `get_version` del vigilante del motor. Hoy, 3 s en la salud y 5 s en /api/engine/status. */
  engineVersionMs: 3 * SECOND,
  /** `/search` del motor (server.js:3643). */
  engineSearchMs: 12 * SECOND,
  /** POST a engine_control (server.js:4691). */
  engineControlMs: 8 * SECOND,
  /** Arranque del remux en el servidor (server.js:51). */
  remuxStartServerMs: 45 * SECOND,
  /** Arranque del remux visto desde el cliente: el del servidor más margen. */
  remuxStartClientMs: 55 * SECOND,
  /** `proxy_read_timeout` de nginx para la API: por encima de los dos anteriores. */
  remuxStartNginxMs: 60 * SECOND,
  /** Sonda completa del comprobador, con estadística final, ffprobe y stop (backend-modulos §9.7). */
  scannerProbeTotalMs: 30 * SECOND,
  /** Con alguien viendo, el comprobador lanza como mucho una sonda cada este rato (arquitectura §5.8). */
  scannerWatchingGapMs: 20 * SECOND,
  /**
   * Cada cuánto el comprobador pregunta su propio `get_version` para la salud
   * (`ScannerStats.online`). En la 0.6.59 lo hacía cada GET /api/health.
   */
  scannerPingMs: 30 * SECOND,
  /** Descarga de un directorio: plazo total (server.js:43). */
  directoryTotalMs: 45 * SECOND,
  /** Descarga de un directorio: inactividad del socket (server.js:1371). */
  directoryIdleMs: 12 * SECOND,
  /** Cadena completa de la agenda futbolenlatv → EPG → TheSportsDB (nuevo; hoy sin tope). */
  agendaTotalMs: 60 * SECOND,
  /** ESPN por liga (server.js:2103). */
  espnMs: 6 * SECOND,
  /** Ollama: embeddings (compose: 12000) y salud (server.js:4597). */
  ollamaMs: 12 * SECOND,
  ollamaHealthMs: 3.5 * SECOND,
  /** Latido de un visor y cuándo se le da por ido (D5). */
  viewerHeartbeatMs: 15 * SECOND,
  viewerExpiryMs: 45 * SECOND,
  /** Código de emparejamiento de la app iOS. */
  pairingCodeTtlMs: 5 * MINUTE,
  /** URL de vídeo firmada: plazo para empezar a usarla y tope absoluto. */
  videoUrlStartMs: 60 * SECOND,
  videoUrlMaxMs: 6 * HOUR,
} as const;

/** Vigilante del motor (arquitectura §5.5). */
export const ENGINE_WATCHDOG = {
  /** Cada cuánto se pregunta `get_version`. */
  intervalMs: 10 * SECOND,
  /** Fallos seguidos para pasar a `offline` con alguien viendo y sin nadie. */
  failuresToOfflineWatching: 2,
  failuresToOfflineIdle: 3,
  /** Aciertos seguidos para volver a `online`. */
  successesToOnline: 2,
  /** Reinicio automático: motor `offline` este rato con un visor esperando... */
  autoRestartAfterOfflineMs: 60 * SECOND,
  /** ...o tantas aperturas de sesión fallidas seguidas por culpa del motor. */
  autoRestartAfterOpenFailures: 3,
  /** Espera entre reinicios automáticos (1, 2 y 4 min). */
  autoRestartBackoffMs: [1 * MINUTE, 2 * MINUTE, 4 * MINUTE] as const,
  /** Tras un reinicio: respuestas buenas seguidas y plazo máximo para darlo por listo. */
  readySuccesses: 2,
  readyMaxWaitMs: 90 * SECOND,
  /** Enfriamiento del reinicio manual (server.js:40, engine-control.js:8). */
  manualRestartCooldownMs: 15 * SECOND,
  /** Mientras el motor reinicia o alguien espera a que vuelva, se le pregunta con este ritmo. */
  readyPollMs: 2 * SECOND,
  /**
   * "Responde pero no entrega": este rato con alguien viendo y las
   * estadísticas sin contestar o a velocidad 0 sin avanzar.
   */
  stalledAfterMs: 60 * SECOND,
} as const;

/** Sincronización de directorios (server.js:55; arquitectura §5.11). */
export const DIRECTORY_SYNC = {
  /** Sincronización automática de todos los directorios (`WEB_SYNC_INTERVAL_MS` de la 0.6.59). */
  intervalMs: 3 * HOUR,
  /** La resolución de un partido solo refresca los directorios más viejos que esto. */
  onResolveMs: 30 * MINUTE,
  /** Espera tras un fallo: empieza en 5 min y se dobla hasta 3 h (solo la sincronización por resolución). */
  retryBaseMs: 5 * MINUTE,
  retryMaxMs: 3 * HOUR,
} as const;

/** `WEB_SYNC_INTERVAL_MS` de la 0.6.59 (server.js:55): lo usan directories y health. */
export const WEB_SYNC_INTERVAL_MS = DIRECTORY_SYNC.intervalMs;

/** Emparejamiento y dispositivos (arquitectura §5.12). */
export const AUTH_TIMINGS = {
  /** `lastSeenAt` de un dispositivo se guarda como mucho una vez por este rato. */
  lastSeenThrottleMs: 60 * SECOND,
  /** Ventana del límite de canjes de código (`PAIRING_ATTEMPTS_PER_MINUTE`). */
  pairingWindowMs: 60 * SECOND,
} as const;

/** Tiempo real (arquitectura §5.13). */
export const SSE_TIMINGS = {
  /** Comentario de latido para que ningún proxy corte la conexión. */
  heartbeatMs: 15 * SECOND,
  /** Valor de `retry:` que se manda al cliente. */
  retryMs: 3 * SECOND,
  /** Si el SSE no conecta en este tiempo, la web vuelve al sondeo. */
  clientFallbackAfterMs: 10 * SECOND,
  /** Sondeo de respaldo de la web (hoy, index.html:4229). */
  fallbackPollMs: 5 * SECOND,
  /** Cada cuánto playback publica `stream.stats`. */
  statsIntervalMs: 2 * SECOND,
} as const;

/** Arranque y apagado del proceso (arquitectura §5.16). */
export const SHUTDOWN_TIMINGS = {
  /** Plazo para parar todas las sesiones del motor en paralelo. */
  stopSessionsMs: 4 * SECOND,
  /** Salida forzada si el apagado limpio no termina (server.js:5165-5176). */
  forceExitMs: 5 * SECOND,
} as const;

/** Remux: cuándo la lista se da por lista y cuándo se recoge una sesión (server.js:44-52). */
export const REMUX_TIMINGS = {
  /** Lista lista con 2 segmentos y 6 s de vídeo... */
  readySegments: 2,
  readySeconds: 6,
  /** ...o con 1 segmento pasados 20 s. */
  readyFallbackAfterMs: 20 * SECOND,
  /** Sin peticiones de ficheros en 90 s, la sesión se mata. */
  idleMs: 90 * SECOND,
  /** Revisión del recolector. */
  reaperIntervalMs: 15 * SECOND,
  /** Pasado el arranque, 15 s sin tocar la lista es un ffmpeg atascado. */
  staleMs: 15 * SECOND,
} as const;
