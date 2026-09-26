/* Traducción de los errores de la red a los códigos de la IPTV
   (docs/iptv.md §5.6 y §2.4).

   Regla: el `AppError` que sale del módulo lleva el `message` fijo del
   catálogo y un `detail` corto (código de origen y estado HTTP), NUNCA la URL
   ni la causa original (podría llevarla). */

import { isIptvErrorCode } from '@ace/shared';
import { AppError, errorCodeOf } from '../../core/errors.js';

export type IptvErrorContext = 'account' | 'list' | 'guide' | 'stream';

/** Estado HTTP de un `http_NNN`, o null. */
export function httpStatusOf(error: unknown): number | null {
  const code = errorCodeOf(error);
  const match = code ? /^http_(\d{3})$/.exec(code) : null;
  return match ? Number(match[1]) : null;
}

const BUSY = new Set([429, 456, 458, 509]);

/** Códigos de red que se dejan tal cual al guardar (vienen en la tabla de la ruta). */
const KEEP_ON_SAVE = new Set([
  'bad_url',
  'private_url',
  'dns_failed',
  'redirect_limit',
  'redirect_loop',
  'unsupported_encoding',
]);

/**
 * El motivo corto de un fallo para el `detail` (docs/iptv.md §16.8): el
 * código del catálogo (`http_502`, `dns_failed`, `redirect_limit`…),
 * `bad_response` (JSON que no se entiende) o `fetch_failed` con el código
 * del sistema si lo hay (`fetch_failed:ECONNRESET`). Nunca la URL ni el
 * mensaje original.
 */
export function failureDetail(error: unknown): string {
  const code = errorCodeOf(error);
  if (code) return code;
  if (error instanceof Error && error.message === 'bad_response') return 'bad_response';
  const system =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  return /^[A-Z][A-Z0-9_]{2,40}$/.test(system) ? `fetch_failed:${system}` : 'fetch_failed';
}

/**
 * Pasa cualquier error de una llamada al proveedor a un `AppError` con
 * código del catálogo. Los `iptv_*` (también los que llegan como motivo de un
 * aborto: pausa, eliminar) salen tal cual.
 */
export function toIptvError(error: unknown, context: IptvErrorContext): AppError {
  const code = errorCodeOf(error);
  if (code && isIptvErrorCode(code)) {
    return error instanceof AppError ? error : new AppError(code);
  }
  const status = httpStatusOf(error);
  const detail = failureDetail(error);
  const make = (next: Parameters<typeof newError>[0]): AppError => newError(next, detail);
  if (status !== null) {
    if (status === 401) return make(context === 'stream' ? 'iptv_gone' : 'iptv_auth_failed');
    if (status === 403) return make(context === 'stream' ? 'iptv_busy' : 'iptv_auth_failed');
    if (status === 404 || status === 410) {
      if (context === 'stream') return make('iptv_gone');
      if (context === 'list') return make('iptv_bad_list');
      return make('iptv_unreachable');
    }
    if (BUSY.has(status)) return make('iptv_busy');
    return make('iptv_unreachable');
  }
  if (code === 'fetch_timeout') return make('iptv_timeout');
  if (code === 'response_too_large') return make('iptv_too_large');
  if (code && KEEP_ON_SAVE.has(code)) {
    if (context === 'stream' || context === 'guide') return make('iptv_unreachable');
    return error instanceof AppError
      ? new AppError(error.code, { detail })
      : make('iptv_unreachable');
  }
  if (error instanceof Error && error.message === 'bad_response') {
    return make(context === 'account' ? 'iptv_unreachable' : 'iptv_bad_list');
  }
  return make('iptv_unreachable');
}

/**
 * ¿Es un fallo pasajero de la prueba rápida de «Guardar IPTV», de los que
 * merecen un reintento (docs/iptv.md §16.8)? Sí: 5xx, 429, cuerpo vacío,
 * respuesta que no se entiende, sin `user_info`, conexión cortada, DNS y
 * redirecciones; en M3U, lo que no empieza por `#EXTM3U` la primera vez.
 * Nunca `auth: 0`, 401 ni 403 (los paneles bloquean tras varios intentos),
 * ni la cuenta caducada, ni un plazo agotado, ni un 404.
 */
export function isTransientSaveFailure(error: unknown): boolean {
  const code = errorCodeOf(error);
  const detail = error instanceof AppError ? (error.detail ?? '') : '';
  switch (code) {
    case 'iptv_unreachable':
      return (
        /^http_(?:5\d\d|429|200)$/.test(detail) ||
        detail === 'bad_response' ||
        detail === 'sin_user_info' ||
        detail.startsWith('fetch_failed')
      );
    case 'iptv_busy':
      return detail === 'http_429';
    case 'iptv_bad_list':
      return !/^http_\d{3}$/.test(detail);
    case 'dns_failed':
    case 'redirect_limit':
    case 'redirect_loop':
      return true;
    default:
      return false;
  }
}

function newError(
  code:
    | 'iptv_auth_failed'
    | 'iptv_account_expired'
    | 'iptv_unreachable'
    | 'iptv_timeout'
    | 'iptv_busy'
    | 'iptv_gone'
    | 'iptv_bad_list'
    | 'iptv_too_large'
    | 'iptv_unsupported',
  detail: string,
): AppError {
  return new AppError(code, { detail: detail.slice(0, 60) });
}
