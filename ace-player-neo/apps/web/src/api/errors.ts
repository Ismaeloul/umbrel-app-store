/* Errores del cliente de la API, siempre con un mensaje en español listo para
   enseñar (arregla P10: hoy la web traduce unos pocos y el resto sale crudo).

   Orden de preferencia del mensaje:
   1. el `message` que manda /api/v1 (ya sale del catálogo del servidor);
   2. el catálogo de @ace/shared (`errorMessage`) si solo llega el código;
   3. los de aquí para lo que no pasa por el servidor: sin red, plazo agotado,
      respuesta que no es JSON o que no cumple el contrato. */

import { errorMessage, isAnyErrorCode } from '@ace/shared';

/** Códigos que genera el propio cliente (no están en el catálogo del servidor). */
export const CLIENT_ERRORS = {
  network: 'No hay conexión con el Umbrel. Comprueba la red; la app seguirá reintentando.',
  timeout: 'El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.',
  bad_response: 'El servidor ha respondido algo que no se entiende.',
  invalid_response:
    'La respuesta del servidor no cumple el contrato de la API (solo se comprueba en desarrollo).',
  demo_unsupported: 'Esto no se puede hacer en el modo demo.',
} as const;

export type ClientErrorCode = keyof typeof CLIENT_ERRORS;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly route: string | null;
  /**
   * Intentos que hizo el servidor antes de rendirse (`error.attempts`, solo si
   * fueron más de uno): hoy, la prueba rápida de «Guardar IPTV» (docs/iptv.md §16.8).
   */
  readonly attempts: number | null;

  constructor(options: {
    code: string;
    message?: string | null;
    status?: number;
    requestId?: string | null;
    route?: string | null;
    cause?: unknown;
    attempts?: number | null;
  }) {
    super(
      options.message || messageFor(options.code),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options.code;
    this.status = options.status ?? 0;
    this.requestId = options.requestId ?? null;
    this.route = options.route ?? null;
    this.attempts = options.attempts ?? null;
  }

  /** Error del propio cliente (sin red, plazo...) y no del servidor. */
  get isClientSide(): boolean {
    return this.code in CLIENT_ERRORS;
  }

  /** Vale la pena reintentar solo (sin red, plazo, 5xx...). Los 4xx, no. */
  get retryable(): boolean {
    if (this.code === 'network' || this.code === 'timeout') return true;
    return this.status >= 500 || this.status === 429;
  }
}

export function messageFor(code: string): string {
  if (code in CLIENT_ERRORS) return CLIENT_ERRORS[code as ClientErrorCode];
  return errorMessage(code);
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isAbortError(value: unknown): boolean {
  return (
    (value instanceof DOMException && value.name === 'AbortError') ||
    (value instanceof Error && value.name === 'AbortError')
  );
}

/** El texto que se enseña de cualquier fallo (para toasts y estados de error). */
export function describeFailure(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (isAbortError(error)) return CLIENT_ERRORS.timeout;
  return messageFor('internal_error');
}

interface V1ErrorBody {
  error: { code?: unknown; message?: unknown; requestId?: unknown; attempts?: unknown } | string;
}

/** Un número de intentos que tenga sentido (2 a 9), o null. */
function attemptsOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 9
    ? value
    : null;
}

/** Convierte una respuesta de error (v1 o antigua) en ApiError. */
export async function errorFromResponse(response: Response, route: string): Promise<ApiError> {
  let body: V1ErrorBody | null = null;
  try {
    body = (await response.json()) as V1ErrorBody;
  } catch {}
  const raw = body?.error;
  if (raw && typeof raw === 'object') {
    const code = typeof raw.code === 'string' ? raw.code : `http_${response.status}`;
    return new ApiError({
      code,
      message: typeof raw.message === 'string' ? raw.message : null,
      requestId: typeof raw.requestId === 'string' ? raw.requestId : null,
      status: response.status,
      route,
      attempts: attemptsOf(raw.attempts),
    });
  }
  // Forma antigua `{ error: "<código>" }` o cuerpo que no es JSON (la pasarela de Umbrel).
  const code = typeof raw === 'string' && isAnyErrorCode(raw) ? raw : `http_${response.status}`;
  return new ApiError({ code, status: response.status, route });
}
