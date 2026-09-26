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
  const detail = code ?? (error instanceof Error ? error.name : 'desconocido');
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
