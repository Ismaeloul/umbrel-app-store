/* Logs del backend: pino a stdout en JSON, sin transports (arquitectura
   §5.15 y empaquetado §7.2: en el NAS no hay node_modules y un transport
   levanta hilos de más). Docker recoge stdout.

   Redacción (arquitectura §5.12): nunca sale al log la cabecera
   `Authorization`, el token de un dispositivo, el `?t=` de una URL de vídeo
   ni el código de emparejamiento. Ojo: por eso un campo que se llame `code`
   en la raíz de un log se tapa; para códigos de error usa `errorCode`. */

import pino, { type DestinationStream, type Level, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;
export type LogLevel = Level | 'silent';

export const LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

/** Lo que se tapa en cualquier log estructurado. */
export const REDACTED_PATHS: readonly string[] = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'request.headers.authorization',
  'token',
  '*.token',
  't',
  'query.t',
  'req.query.t',
  'code',
  'body.code',
  'req.body.code',
  'pairing.code',
  'secret',
  '*.secret',
];

export const REDACTED = '[redactado]';

/** Parámetros de query que nunca se escriben en claro. */
const SECRET_QUERY_PARAMS = new Set(['t', 'token', 'code']);

/**
 * Tapa los valores de `t`, `token` y `code` de una URL para poder escribirla
 * en el log (`/api/v1/video/s_x/index.m3u8?t=…` → `?t=[redactado]`). No
 * decodifica ni reordena nada más: el resto de la URL sale tal cual llegó.
 */
export function redactUrl(url: string): string {
  const mark = url.indexOf('?');
  if (mark < 0) return url;
  const query = url
    .slice(mark + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const name = decodeSafe(eq < 0 ? part : part.slice(0, eq)).toLowerCase();
      return SECRET_QUERY_PARAMS.has(name) && eq >= 0 ? `${part.slice(0, eq)}=${REDACTED}` : part;
    })
    .join('&');
  return `${url.slice(0, mark)}?${query}`;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Por defecto, stdout. Los tests pasan un flujo en memoria para leer lo escrito. */
  readonly destination?: DestinationStream;
  /** Campos fijos en cada línea (por ejemplo, la versión). */
  readonly base?: Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      base: options.base ?? null,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...REDACTED_PATHS], censor: REDACTED },
      formatters: {
        /* `"level":"info"` en vez del número: se lee mejor con `docker logs`. */
        level: (label) => ({ level: label }),
      },
    },
    options.destination ?? pino.destination({ dest: 1, sync: false }),
  );
}

/** Logger que no escribe nada (tests que no miran los logs). */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
