/* Constantes del comprobador que no están en @ace/shared (server.js:81-109 y
   los números sueltos de probeAceCandidate). Los plazos que sí comparten
   servidor y clientes salen de @ace/shared/constants (TIMEOUTS, limits). */

import { ENGINE_MAX_BODY_BYTES, TIMEOUTS } from '@ace/shared';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Por debajo de esta fracción del bitrate del canal la señal se para al rato (server.js:97). */
export const SCANNER_STARVED_RATIO = 0.85;

/** Sin bitrate conocido, 1 Mbit/s es lo mínimo para que algo se vea (server.js:3176). */
export const SCANNER_MIN_INTAKE_KBPS = 1000;

/** Un veredicto bueno vale 10 min (server.js:101). El malo, el retraso de reintento (config). */
export const SCANNER_GOOD_TTL_MS = 10 * MINUTE;

/** Lo que cuenta el reproductor manda este rato sobre cualquier sonda (server.js:107). */
export const PLAYER_VERDICT_HOLD_MS = 3 * MINUTE;

/** Fallos que hablan del vídeo y no de la red: no se suavizan (server.js:109). */
export const SCANNER_HARD_FAILURES: ReadonlySet<string> = new Set([
  'unsupported_codec',
  'no_video',
]);

/** Lo que se guarda de la muestra para leer PAT, PMT y PCR (server.js:2985). */
export const SCANNER_KEEP_BYTES = 8 * 1024 * 1024;

/** "Transporte suficiente": 16 KiB leídos o descargados (server.js:3160, 3234). */
export const SCANNER_TRANSPORT_BYTES = 16 * 1024;

/** Tope del cuerpo de una petición de control al comprobador (server.js:2887). */
export const SCANNER_RESPONSE_MAX_BYTES = ENGINE_MAX_BODY_BYTES;

/** Plazo de la meta: el mismo que el reproductor (server.js:3202-3204). */
export const SCANNER_META_MAX_MS = TIMEOUTS.engineSessionMetaMs;

/** Plazo de cada lectura de `stat_url` (server.js:3217, 3228, 3252). */
export const SCANNER_STAT_MS = 1500;

/** Margen mínimo para pedir la estadística inicial (server.js:3215). */
export const SCANNER_STAT_MARGIN_MS = 1800;

/** Lo que se espera a la estadística de mitad de ventana (server.js:3232). */
export const SCANNER_MID_STAT_WAIT_MS = 1600;

/** Presupuesto de la muestra: ventana sostenida + 1,5 s, dejando 2,5 s (server.js:3223). */
export const SCANNER_SAMPLE_EXTRA_MS = 1500;
export const SCANNER_SAMPLE_MARGIN_MS = 2500;

/** Plazo del `stop` (server.js:3298). */
export const SCANNER_STOP_MS = TIMEOUTS.engineStopMs;

/** Tope duro de una sonda con estadística final, ffprobe y `stop` dentro (arquitectura §5.8). */
export const SCANNER_PROBE_HARD_MS = TIMEOUTS.scannerProbeTotalMs;

/** Con alguien viendo, como mucho una sonda cada 20 s (arquitectura §5.8; NUEVO en la 0.7.0). */
export const SCANNER_WATCHING_GAP_MS = TIMEOUTS.scannerWatchingGapMs;

/** Cada cuánto el comprobador pregunta su `get_version` para `stats().online` (paso 1.3). */
export const SCANNER_PING_INTERVAL_MS = TIMEOUTS.scannerPingMs;

/** Poda de trabajos y veredictos caducados (server.js:5140). */
export const SCANNER_PRUNE_INTERVAL_MS = MINUTE;

/** Sesiones sin parar: ventana y umbral de aviso de la salud (arquitectura §5.8). */
export const SCANNER_LEAK_WINDOW_MS = 60 * MINUTE;
export const SCANNER_LEAK_ALERT = 5;

/** Argumentos de ffprobe (server.js:3088-3095). */
export const FFPROBE_ARGS: readonly string[] = [
  '-v',
  'error',
  '-probesize',
  '524288',
  '-analyzeduration',
  '5000000',
  '-show_entries',
  'stream=codec_type,codec_name',
  '-of',
  'json',
];

/** Lo que se lee como mucho de la salida de ffprobe (server.js:3102). */
export const FFPROBE_STDOUT_MAX = 64 * 1024;

/** Códecs de vídeo que el remux de iOS pasa a fMP4 sin transcodificar (D6). */
export const IOS_VIDEO_CODECS: ReadonlySet<string> = new Set(['h264', 'hevc']);

/**
 * Valores por defecto de la 0.6.59 (server.js:83-88) para las exportaciones
 * antiguas, que no tienen configuración (la del servicio sale de AppConfig).
 */
export const LEGACY_SCANNER_DEFAULTS = {
  probeTimeoutMs: 24_000,
  sampleBytes: 128 * 1024,
  mediaProbeMs: 7000,
  sustainMs: 12_000,
  retryDelayMs: 10 * MINUTE,
} as const;
