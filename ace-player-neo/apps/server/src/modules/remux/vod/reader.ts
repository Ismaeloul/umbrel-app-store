/* Lector por Range del fichero de una película (docs/vod.md §9.4).

   Pide trozos ACOTADOS (`bytes=a-b`) al relé VOD en 127.0.0.1 con
   `node:http`. `net` no sirve aquí: bloquea 127.0.0.1 a propósito, y el relé
   ya aplica el filtro SSRF hacia el proveedor. Las lecturas del índice pasan
   por la sesión del relé, así que cuentan como su conexión y quedan en su
   caché (un reinicio de ffmpeg no las vuelve a pedir al proveedor).

   El relé dice por qué falla con la cabecera `x-ace-vod-error` (solo en
   127.0.0.1): así un «ocupado» o un «sin Range» llegan con su código. */

import http from 'node:http';
import { VOD_PLAY, isVodErrorCode } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import { vodUnsupported } from './codecs.js';
import type { RangeReader } from './types.js';

/** Cabecera con la que el relé VOD dice el código `vod_*` de un fallo (y su motivo). */
export const VOD_ERROR_HEADER = 'x-ace-vod-error';
export const VOD_REASON_HEADER = 'x-ace-vod-reason';

export interface HttpRangeReaderOptions {
  /** Cancela la lectura en curso (cerrar la sesión, plazo del índice). */
  readonly signal?: AbortSignal;
  /** Plazo de cada petición (por defecto 20 s, `VOD_TIMINGS.indexMs`). */
  readonly timeoutMs?: number;
  /** Tope de una lectura (por defecto `VOD_PLAY.moovMaxBytes`, 32 MiB). */
  readonly maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Solo URLs del relé: `http://127.0.0.1:<p>/r/<ticket>/…` (o `[::1]` en los tests). */
export function isRelayUrl(url: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d{1,5}\/r\/[A-Za-z0-9_-]{16,64}\/[^/?#]+$/.test(url);
}

/** Traduce la respuesta de error del relé a un `AppError` `vod_*`. */
export function relayError(status: number, headers: http.IncomingHttpHeaders): AppError {
  const code = headers[VOD_ERROR_HEADER];
  const reason = headers[VOD_REASON_HEADER];
  if (typeof code === 'string' && isVodErrorCode(code)) {
    return new AppError(code, {
      detail: `relé VOD ${status}`,
      ...(typeof reason === 'string' && reason ? { data: { reason } } : {}),
    });
  }
  /* 200 a una petición con Range: el proveedor no deja saltar. Un 416 SIN la
     cabecera del relé es un rango fuera del fichero (P9), no «sin saltos»:
     el relé dice `sin_saltos` él mismo, con su cabecera. */
  if (status === 200) return vodUnsupported('sin_saltos', `relé VOD ${status}`);
  return new AppError('vod_dropped', { detail: `relé VOD ${status}` });
}

/** Tamaño del fichero que dice el `Content-Range` de un 416 (`bytes *` + `/N`), o null. */
function unsatisfiedSize(headers: http.IncomingHttpHeaders): number | null {
  const match = /^bytes \*\/(\d+)$/.exec(String(headers['content-range'] ?? ''));
  return match ? Number(match[1]) : null;
}

export function createHttpRangeReader(
  url: string,
  options: HttpRangeReaderOptions = {},
): RangeReader {
  if (!isRelayUrl(url))
    throw new AppError('internal_error', { detail: 'lector VOD fuera del relé' });
  const maxBytes = options.maxBytes ?? VOD_PLAY.moovMaxBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let total: number | null = null;

  const read = (start: number, wanted: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(wanted) ||
        start < 0 ||
        wanted < start
      ) {
        reject(
          new AppError('internal_error', { detail: `rango VOD no válido ${start}-${wanted}` }),
        );
        return;
      }
      if (total !== null && start >= total) {
        resolve(Buffer.alloc(0));
        return;
      }
      /* Con el tamaño ya sabido, no se pide más allá del final. */
      const end = total !== null ? Math.min(wanted, total - 1) : wanted;
      if (end - start + 1 > maxBytes) {
        reject(vodUnsupported('indice', 'índice enorme'));
        return;
      }
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new AppError('vod_timeout'));
        return;
      }
      let settled = false;
      const finish = (error: Error | null, value?: Buffer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (error) {
          req.destroy();
          reject(error);
        } else resolve(value as Buffer);
      };
      const req = http.get(
        url,
        { agent: false, headers: { range: `bytes=${start}-${end}` } },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status === 416 && res.headers[VOD_ERROR_HEADER] === undefined) {
            /* Se ha leído más allá del final: con el tamaño, es un trozo vacío. */
            const size = unsatisfiedSize(res.headers);
            res.resume();
            if (size !== null && start >= size) {
              total = size;
              finish(null, Buffer.alloc(0));
            } else finish(relayError(status, res.headers));
            return;
          }
          if (status !== 206) {
            res.resume();
            finish(relayError(status, res.headers));
            return;
          }
          const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
            String(res.headers['content-range'] ?? ''),
          );
          if (!range || Number(range[1]) !== start) {
            res.resume();
            finish(new AppError('vod_dropped', { detail: 'Content-Range del relé no válido' }));
            return;
          }
          if (range[3] !== '*') total = Number(range[3]);
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > end - start + 1) {
              finish(new AppError('vod_dropped', { detail: 'el relé manda de más' }));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const expected = Number(range[2]) - start + 1;
            if (size !== expected) {
              finish(new AppError('vod_dropped', { detail: 'lectura VOD a medias' }));
              return;
            }
            finish(null, Buffer.concat(chunks, size));
          });
          res.on('error', (error) =>
            finish(new AppError('vod_dropped', { cause: error, detail: 'lectura VOD cortada' })),
          );
          res.on('close', () => {
            if (!res.complete)
              finish(new AppError('vod_dropped', { detail: 'lectura VOD cortada' }));
          });
        },
      );
      req.on('error', (error) =>
        finish(new AppError('vod_dropped', { cause: error, detail: 'relé VOD' })),
      );
      const onAbort = (): void =>
        finish(signal?.reason instanceof Error ? signal.reason : new AppError('vod_timeout'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(
        () => finish(new AppError('vod_timeout', { detail: 'lectura del índice' })),
        timeoutMs,
      );
    });

  return { read, size: () => total };
}

/** Lector sobre bytes en memoria (los tests de los índices). */
export function createBufferReader(
  data: Buffer,
  reads?: { start: number; end: number }[],
): RangeReader {
  return {
    read(start, end) {
      reads?.push({ start, end });
      return Promise.resolve(Buffer.from(data.subarray(start, Math.min(end + 1, data.length))));
    },
    size: () => data.length,
  };
}
