/* Logs del backend: pino a stdout en JSON, sin transports (arquitectura
   §5.15 y empaquetado §7.2: en el NAS no hay node_modules y un transport
   levanta hilos de más). Docker recoge stdout.

   Redacción (arquitectura §5.12): nunca sale al log la cabecera
   `Authorization`, el token de un dispositivo, el `?t=` de una URL de vídeo
   ni el código de emparejamiento. Ojo: por eso un campo que se llame `code`
   en la raíz de un log se tapa; para códigos de error usa `errorCode`.

   IPTV (docs/iptv.md §2.4, red de seguridad por si algo se escapa: la regla
   principal es que el módulo `iptv` nunca escribe URLs del proveedor):
   - se tapan los campos `password`, `username` y `secret` (y `url` dentro de
     `iptv.*`);
   - `redactUrl` tapa también `username`, `user`, `password`, `pass`, `pwd`,
     `auth`, `key`, `token`, `t` y `code` de la query, `user:pass@`, los
     tramos Xtream `/(live|movie|series|timeshift)/<u>/<p>/`, la forma corta
     `/<u>/<p>/<número>` al final de una URL absoluta y el ticket `/r/<t>/`
     del relé;
   - el serializador de `err` pasa `message`, `detail`, `stack` y la causa
     por `redactText` (cada URL que aparezca, por `redactUrl`). */

import pino, {
  type DestinationStream,
  type Level,
  type Logger as PinoLogger,
  type SerializedError,
} from 'pino';

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
  // IPTV (docs/iptv.md §2.4)
  'password',
  '*.password',
  'username',
  '*.username',
  'iptv.url',
  'iptv.*.url',
];

export const REDACTED = '[redactado]';
/** Marca de los tramos de ruta tapados (y de los secretos que tapa el redactor de la IPTV). */
export const REDACTED_PART = '•••';

/** Parámetros de query que nunca se escriben en claro. */
const SECRET_QUERY_PARAMS = new Set([
  't',
  'token',
  'code',
  // IPTV: paneles Xtream y proveedores M3U (docs/iptv.md §2.4)
  'username',
  'user',
  'password',
  'pass',
  'pwd',
  'auth',
  'key',
]);

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/* Ruta de una URL (sin query ni fragmento). */
function redactPath(pathPart: string, absolute: boolean): string {
  let out = pathPart
    /* Xtream: /live/<usuario>/<contraseña>/<id>.ts y compañía. */
    .replace(
      /\/(live|movie|series|timeshift)\/[^/?#]+\/[^/?#]+(?=\/)/gi,
      `/$1/${REDACTED_PART}/${REDACTED_PART}`,
    )
    /* Ticket del relé local: /r/<ticket>/… */
    .replace(/\/r\/[^/?#]+(?=\/|$)/g, `/r/${REDACTED_PART}`);
  if (absolute) {
    /* Forma corta de los paneles: /<usuario>/<contraseña>/<número>(.ext) al final. */
    out = out.replace(
      /\/(?!•••)[^/?#]+\/(?!•••)[^/?#]+\/(\d+)(\.[a-z0-9]{1,5})?$/i,
      `/${REDACTED_PART}/${REDACTED_PART}/$1$2`,
    );
  }
  return out;
}

/**
 * Tapa los secretos de una URL para poder escribirla en el log
 * (`/api/v1/video/s_x/index.m3u8?t=…` → `?t=[redactado]`): los parámetros de
 * `SECRET_QUERY_PARAMS`, `user:pass@` y los tramos de ruta con credenciales
 * de la IPTV. No decodifica ni reordena nada más: el resto de la URL sale
 * tal cual llegó.
 */
export function redactUrl(url: string): string {
  const absolute = ABSOLUTE_URL_RE.test(url);
  const text = absolute
    ? url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]*@/i, `$1${REDACTED_PART}@`)
    : url;
  const mark = text.indexOf('?');
  let pathPart = mark < 0 ? text : text.slice(0, mark);
  if (absolute) {
    const start = pathPart.indexOf('/', pathPart.indexOf('//') + 2);
    if (start >= 0) {
      pathPart = pathPart.slice(0, start) + redactPath(pathPart.slice(start), true);
    }
  } else {
    pathPart = redactPath(pathPart, false);
  }
  if (mark < 0) return pathPart;
  const query = text
    .slice(mark + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const name = decodeSafe(eq < 0 ? part : part.slice(0, eq)).toLowerCase();
      return SECRET_QUERY_PARAMS.has(name) && eq >= 0 ? `${part.slice(0, eq)}=${REDACTED}` : part;
    })
    .join('&');
  return `${pathPart}?${query}`;
}

const URL_IN_TEXT_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+/gi;

/**
 * Pasa por `redactUrl` cada URL que aparezca en un texto libre (mensajes de
 * error, stderr de ffmpeg) y tapa los tickets del relé sueltos. Para lo que
 * no parece una URL no sirve: eso lo hace el redactor de la IPTV, que conoce
 * los secretos.
 */
export function redactText(text: string): string {
  return text
    .replace(URL_IN_TEXT_RE, (match) => redactUrl(match))
    .replace(/(^|[\s"'(])\/r\/[A-Za-z0-9_-]{8,}(?=\/)/g, `$1/r/${REDACTED_PART}`);
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type Serialized = SerializedError & Record<string, unknown>;

/* Tapa las URLs de los campos de texto de un error ya serializado y de su causa. */
function redactSerialized(value: Serialized, depth = 0): Serialized {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string') out[key] = redactText(field);
    else if (key === 'cause' && field && typeof field === 'object' && depth < 3) {
      out[key] = redactSerialized(field as Serialized, depth + 1);
    } else out[key] = field;
  }
  return out as Serialized;
}

/** Serializador de `err`: el de pino con las URLs tapadas (docs/iptv.md §2.4). */
export function redactedErrSerializer(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const serialized = pino.stdSerializers.err(error) as Serialized;
  const detail = (error as { detail?: unknown }).detail;
  const withDetail =
    typeof detail === 'string' && !('detail' in serialized)
      ? { ...serialized, detail }
      : serialized;
  const cause = (error as { cause?: unknown }).cause;
  const withCause =
    cause instanceof Error && !('cause' in withDetail)
      ? { ...withDetail, cause: { message: cause.message } }
      : withDetail;
  return redactSerialized(withCause as Serialized);
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
      serializers: { err: redactedErrSerializer },
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
