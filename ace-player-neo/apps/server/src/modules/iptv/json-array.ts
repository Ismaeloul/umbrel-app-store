/* Troceador en streaming del array JSON de `get_live_streams` (docs/iptv.md
   §3.3).

   No pasa por `fetchJson`, que acumula el Buffer entero y luego hace
   `JSON.parse` de 100 000 objetos (250-300 MB de pico en un contenedor con
   `mem_limit: 768m`). Recorre los bytes, respeta cadenas y escapes, corta
   cada elemento de primer nivel y hace `JSON.parse` de ese objeto solo. Un
   objeto de más de `maxObjectBytes` se salta sin acumularlo. Lo que no es un
   objeto (números, cadenas sueltas) se ignora. Sin dependencias, con la
   misma filosofía que el tokenizador XMLTV. */

import type { Readable } from 'node:stream';
import { IPTV_XTREAM_LIMITS } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { NetBadResponseError } from '../net/client.js';

export interface JsonArrayOptions {
  readonly maxObjectBytes?: number;
  readonly signal?: AbortSignal;
}

const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

/**
 * Llama a `onObject` con cada objeto del array de primer nivel. Si
 * `onObject` lanza, se deja de leer y el error sale tal cual. Lanza
 * `bad_response` si lo que llega no es un array JSON.
 */
export async function parseJsonArrayStream(
  body: Readable,
  onObject: (value: Record<string, unknown>) => void,
  options: JsonArrayOptions = {},
): Promise<{ readonly objects: number; readonly skipped: number }> {
  const maxObject = options.maxObjectBytes ?? IPTV_XTREAM_LIMITS.maxObjectBytes;
  /* 0: antes del '['; 1: dentro del array; 2: después del ']'. */
  let phase = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let collecting = false;
  let oversize = false;
  let pieces: Buffer[] = [];
  let size = 0;
  let objects = 0;
  let skipped = 0;
  /* Elemento que no es objeto (un número o una cadena suelta). */
  let scalar = false;

  const emit = (): void => {
    const text = Buffer.concat(pieces, size).toString('utf8');
    pieces = [];
    size = 0;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      skipped += 1;
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      objects += 1;
      onObject(value as Record<string, unknown>);
    } else skipped += 1;
  };

  try {
    for await (const value of body as AsyncIterable<Buffer | string>) {
      if (options.signal?.aborted) throw options.signal.reason ?? new AppError('fetch_timeout');
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      let segmentStart = -1;
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index] as number;
        if (phase === 0) {
          if (isSpace(byte) || byte === 0xef || byte === 0xbb || byte === 0xbf) continue;
          if (byte !== OPEN_BRACKET) throw new NetBadResponseError(new Error('no es un array'));
          phase = 1;
          continue;
        }
        if (phase === 2) {
          if (isSpace(byte)) continue;
          throw new NetBadResponseError(new Error('basura tras el array'));
        }
        if (depth === 0 && !scalar) {
          if (isSpace(byte) || byte === 0x2c) continue;
          if (byte === CLOSE_BRACKET) {
            phase = 2;
            continue;
          }
          if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
            depth = 1;
            collecting = byte === OPEN_BRACE;
            oversize = false;
            segmentStart = collecting ? index : -1;
            if (!collecting) skipped += 1;
            continue;
          }
          /* Número, cadena, true/false/null sueltos: se saltan. */
          scalar = true;
          inString = byte === QUOTE;
          escaped = false;
          skipped += 1;
          continue;
        }
        if (scalar) {
          if (inString) {
            if (escaped) escaped = false;
            else if (byte === BACKSLASH) escaped = true;
            else if (byte === QUOTE) inString = false;
            continue;
          }
          if (byte === 0x2c || isSpace(byte)) {
            scalar = false;
            continue;
          }
          if (byte === CLOSE_BRACKET) {
            scalar = false;
            phase = 2;
          }
          continue;
        }
        /* Dentro de un objeto (o array) de primer nivel. */
        if (inString) {
          if (escaped) escaped = false;
          else if (byte === BACKSLASH) escaped = true;
          else if (byte === QUOTE) inString = false;
        } else if (byte === QUOTE) inString = true;
        else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) depth += 1;
        else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
          depth -= 1;
          if (depth === 0) {
            if (collecting && !oversize) {
              const piece = chunk.subarray(segmentStart < 0 ? 0 : segmentStart, index + 1);
              size += piece.length;
              if (size > maxObject) {
                skipped += 1;
                pieces = [];
                size = 0;
              } else {
                pieces.push(piece);
                emit();
              }
            } else if (collecting) skipped += 1;
            collecting = false;
            segmentStart = -1;
            continue;
          }
        }
      }
      /* El objeto sigue en el siguiente trozo: se guarda lo de este. */
      if (depth > 0 && collecting && !oversize) {
        const piece = chunk.subarray(segmentStart < 0 ? 0 : segmentStart);
        size += piece.length;
        if (size > maxObject) {
          oversize = true;
          pieces = [];
          size = 0;
        } else pieces.push(piece);
      }
    }
  } finally {
    body.destroy();
  }
  if (phase !== 2) throw new NetBadResponseError(new Error('array sin cerrar'));
  return { objects, skipped };
}
