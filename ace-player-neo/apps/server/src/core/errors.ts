/* Errores de la app y sus dos formatos de salida (arquitectura §5.15 y §6.4).

   Cualquier módulo lanza `AppError('<código>')` con un código del catálogo
   de @ace/shared (o `http_NNN` para errores HTTP de terceros). La capa HTTP
   decide la forma según la ruta:

   - Rutas antiguas (/api/*, /remux/*): `{ "error": "<código>" }` con el HTTP
     de la 0.6.59, rarezas incluidas (errores de terceros como 400, api.md
     §2.6). Si el código no estaba en la lista blanca de la 0.6.59
     (`safeErrors`, server.js:5032-5069), sale como 500 `internal_error`,
     igual que hoy.
   - Rutas v1: `{ "error": { code, message, requestId } }` con el HTTP
     correcto (502/504 para fallos del motor o de terceros) y el mensaje en
     español del catálogo. Lo que no es público sale como 500
     `internal_error`: es un fallo de programación y va al log con su traza. */

import {
  ERROR_CATALOG,
  describeError,
  isAnyErrorCode,
  type AnyErrorCode,
  type ApiError,
  type LegacyError,
} from '@ace/shared';

export interface AppErrorOptions {
  /** Texto para el log (nunca sale al cliente: el cliente ve el del catálogo). */
  readonly detail?: string;
  /** Datos para el log (por ejemplo, los fallos de validación). */
  readonly data?: unknown;
  readonly cause?: unknown;
  /**
   * Intentos que hizo el servidor antes de rendirse (2 o más): sale en la
   * respuesta v1 como `error.attempts` (hoy, «Guardar IPTV», docs/iptv.md §16.8).
   */
  readonly attempts?: number;
}

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: AnyErrorCode;
  readonly data: unknown;

  constructor(code: AnyErrorCode, options: AppErrorOptions = {}) {
    /* El `message` ES el código, como en la 0.6.59 (`new Error("bad_json")`):
       así `motivoDeFallo(error)` sigue funcionando igual con estos errores. */
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.data = options.data;
    if (options.detail) this.detail = options.detail;
    if (options.attempts !== undefined && options.attempts >= 2) this.attempts = options.attempts;
  }

  /** Explicación para el log. */
  detail?: string;
  /** Intentos hechos (2 o más) si los hubo; va a la respuesta v1. */
  attempts?: number;
}

/** Lo que lanza cualquier función del esqueleto que aún no se ha portado. */
export function notImplemented(what: string): AppError {
  return new AppError('not_implemented', { detail: `sin implementar todavía: ${what}` });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Código que lleva un error cualquiera: el de un `AppError`, el `message` de
 * un `Error` si es un código conocido (así los errores que lanzan con
 * `new Error("fetch_timeout")` los parsers portados tal cual también valen) o
 * los de Fastify que traducimos. `null` si es un fallo desconocido.
 */
export function errorCodeOf(error: unknown): AnyErrorCode | null {
  if (error instanceof AppError) return error.code;
  const fastifyCode = fastifyErrorCode(error);
  if (fastifyCode) return fastifyCode;
  const message = error instanceof Error ? error.message : '';
  return isAnyErrorCode(message) ? message : null;
}

/* Errores propios de Fastify que tienen equivalente en el catálogo. */
function fastifyErrorCode(error: unknown): AnyErrorCode | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  switch ((error as { code?: unknown }).code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return 'body_too_large';
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
      return 'bad_request';
    default:
      return null;
  }
}

export interface SerializedError<B> {
  readonly status: number;
  readonly body: B;
  /** true si es un fallo del servidor que hay que dejar en el log con su traza. */
  readonly internal: boolean;
}

/** Forma de la 0.6.59: `{ error: "<código>" }` con su HTTP de entonces. */
export function toLegacyError(error: unknown): SerializedError<LegacyError> {
  const code = errorCodeOf(error);
  if (code) {
    const definition = describeError(code);
    if (definition && definition.legacyStatus !== null) {
      return { status: definition.legacyStatus, body: { error: code }, internal: false };
    }
  }
  return { status: 500, body: { error: 'internal_error' }, internal: true };
}

/** Forma de /api/v1: `{ error: { code, message, requestId } }` con el HTTP correcto. */
export function toV1Error(error: unknown, requestId: string): SerializedError<ApiError> {
  const code = errorCodeOf(error);
  const definition = code ? describeError(code) : null;
  if (code && definition?.public) {
    const attempts =
      error instanceof AppError && error.attempts !== undefined
        ? Math.min(9, Math.max(2, Math.floor(error.attempts)))
        : undefined;
    return {
      status: definition.status,
      body: {
        error: {
          code,
          message: definition.message,
          requestId,
          ...(attempts !== undefined ? { attempts } : {}),
        },
      },
      internal: definition.status >= 500 && code === 'internal_error',
    };
  }
  return {
    status: 500,
    body: {
      error: { code: 'internal_error', message: ERROR_CATALOG.internal_error.message, requestId },
    },
    internal: true,
  };
}
