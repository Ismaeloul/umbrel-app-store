/* Ficheros del remux: rangos HTTP, lista HLS y envío por streaming
   (server.js:339-409; api.md §4.23; B-221).

   - `parseByteRange` es la de la 0.6.59 tal cual (T-003).
   - El envío es el de `serveRemuxFile`: 200/206/416/404 con las mismas
     cabeceras y el fichero leído por trozos (nunca entero en memoria), ahora
     sobre la respuesta de Fastify.
   - `rewritePlaylist` añade `?t=<token>` a cada URI de la lista (también a
     `#EXT-X-MAP:URI`) para la app iOS (arquitectura §5.12). */

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { ByteRange } from './types.js';

/** `REMUX_TYPES` (server.js:339-344). */
export const REMUX_TYPES: Readonly<Record<string, string>> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.ts': 'video/mp2t',
};

export function remuxContentType(file: string): string {
  return REMUX_TYPES[path.extname(file)] ?? 'application/octet-stream';
}

/** `parseByteRange` (server.js:346-365): `{start,end}`, false (416) o null (sin Range). */
export function parseByteRange(value: string | undefined, size: number): ByteRange | false | null {
  if (!value) return null;
  if (String(value).includes(',')) return false;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export interface PlaylistStats {
  readonly segments: number;
  readonly seconds: number;
}

/** Cuenta de `remuxPlaylistStats` (server.js:215-221) sobre el texto de la lista. */
export function playlistStatsFromText(text: string): PlaylistStats {
  let segments = 0;
  let seconds = 0;
  for (const match of text.matchAll(/^#EXTINF:([\d.]+)/gm)) {
    segments += 1;
    seconds += Number(match[1]) || 0;
  }
  return { segments, seconds };
}

/** `remuxPlaylistStats` (server.js:212-222), síncrona como la original: solo la usa la fachada. */
export function remuxPlaylistStatsSync(file: string): PlaylistStats | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return playlistStatsFromText(text);
}

/** La misma cuenta sin bloquear el proceso (la espera del arranque ya no lee con readFileSync). */
export async function readPlaylistStats(file: string): Promise<PlaylistStats | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  return playlistStatsFromText(text);
}

/** `#EXTINF` más largo de la lista, redondeado al entero más cercano (como pide la norma para TARGETDURATION). */
export function maxRoundedExtinf(text: string): number {
  let max = 0;
  for (const match of text.matchAll(/^#EXTINF:([\d.]+)/gm)) {
    const value = Math.round(Number(match[1]) || 0);
    if (value > max) max = value;
  }
  return max;
}

/** TARGETDURATION con el que se fija la lista al quedar lista: el mayor `#EXTINF` redondeado, 1 como poco. */
export function initialTargetDuration(text: string): number {
  return Math.max(1, maxRoundedExtinf(text));
}

export interface PinnedPlaylist {
  readonly text: string;
  /** El TARGETDURATION que queda fijado (null si aún no se ha fijado). */
  readonly pinned: number | null;
  /** Ha habido que subirlo: un segmento no cabía en el fijado. */
  readonly raised: boolean;
}

/**
 * `EXT-X-TARGETDURATION` fijo por sesión (docs/multidispositivo.md §4.3): se
 * sirve siempre el valor fijado al quedar lista la lista, aunque ffmpeg lo
 * baje cuando un segmento largo sale de la ventana (la norma no deja que
 * cambie). Solo SUBE si llega un `#EXTINF` que, redondeado, no cabe: una lista
 * con un segmento mayor que TARGETDURATION es peor, AVPlayer puede rechazarla.
 * Sin valor fijado (`null`, antes de estar lista), el texto sale tal cual.
 */
export function pinTargetDuration(text: string, pinned: number | null): PinnedPlaylist {
  if (pinned === null) return { text, pinned: null, raised: false };
  const longest = maxRoundedExtinf(text);
  const value = Math.max(pinned, longest);
  const out = text.replace(/^#EXT-X-TARGETDURATION:\d+/m, `#EXT-X-TARGETDURATION:${value}`);
  return { text: out, pinned: value, raised: value > pinned };
}

export interface SegmentSpread {
  readonly minS: number;
  readonly maxS: number;
}

/**
 * Duración real de los segmentos de la ventana (docs/multidispositivo.md
 * §4.2), sin el primero de la sesión (`EXT-X-MEDIA-SEQUENCE:0`), que sale más
 * corto. Null si no queda ninguno.
 */
export function segmentSpread(text: string): SegmentSpread | null {
  const sequence = Number(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m.exec(text)?.[1] ?? 0);
  const values = [...text.matchAll(/^#EXTINF:([\d.]+)/gm)].map((match) => Number(match[1]) || 0);
  if (sequence === 0) values.shift();
  if (!values.length) return null;
  return { minS: Math.min(...values), maxS: Math.max(...values) };
}

/** Margen con el que arrancan las apps 0.6.x por `/remux/` (los 3 × 2 s de antes de C.1). */
export const LEGACY_START_OFFSET_S = 6;

/**
 * `#EXT-X-START:TIME-OFFSET=-6.0,PRECISE=NO` tras `#EXTM3U` (una vez): las
 * apps 0.6.x no fijan `configuredTimeOffsetFromLive`, y con TARGETDURATION 1
 * AVPlayer las pondría a 3 s del final en vez de a 6 s (§4.3).
 */
export function withStartOffset(text: string, offsetS: number = LEGACY_START_OFFSET_S): string {
  if (/^#EXT-X-START:/m.test(text)) return text;
  const tag = `#EXT-X-START:TIME-OFFSET=-${offsetS.toFixed(1)},PRECISE=NO`;
  return text.replace(/^#EXTM3U[^\r\n]*(\r?\n)/, (head, eol: string) => `${head}${tag}${eol}`);
}

function withToken(uri: string, token: string): string {
  if (/[?&]t=/.test(uri)) return uri;
  return `${uri}${uri.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

/**
 * Añade `?t=<token>` a cada URI de una lista HLS: las líneas de segmento y el
 * atributo `URI="…"` de las etiquetas (`#EXT-X-MAP`, claves, etc.).
 */
export function rewritePlaylist(text: string, token: string): string {
  return text
    .split('\n')
    .map((line) => {
      const bare = line.replace(/\r$/, '');
      const cr = bare.length === line.length ? '' : '\r';
      if (!bare.trim()) return line;
      if (bare.startsWith('#')) {
        return `${bare.replace(/URI="([^"]*)"/g, (_all, uri: string) => `URI="${withToken(uri, token)}"`)}${cr}`;
      }
      return `${withToken(bare.trim(), token)}${cr}`;
    })
    .join('\n');
}

export interface SendOptions {
  readonly rangeHeader?: string | undefined;
  readonly head?: boolean | undefined;
}

/* Espera a que la respuesta termine (o se corte) para que la capa HTTP la
   dé por enviada: con un stream, `reply.sent` no es verdadero hasta el final. */
function settle(reply: FastifyReply): Promise<void> {
  return new Promise((resolve) => {
    finished(reply.raw, () => {
      /* Si el cliente cortó a mitad, nadie más debe tocar esta respuesta. */
      if (!reply.sent) reply.hijack();
      resolve();
    });
  });
}

function sendEmpty(reply: FastifyReply, status: number, headers: Record<string, string>): void {
  void reply.code(status).headers(headers).send();
}

/** Respuesta sin cuerpo (403/404 de /remux/, server.js:4932 y 4937). */
export async function sendBare(
  reply: FastifyReply,
  status: number,
  headers: Record<string, string> = {},
): Promise<void> {
  sendEmpty(reply, status, headers);
  await settle(reply);
}

function rangeHeaders(
  file: string,
  size: number,
  range: ByteRange | null,
): { status: number; start: number; end: number; headers: Record<string, string> } {
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const headers: Record<string, string> = {
    'content-type': remuxContentType(file),
    'content-length': String(Math.max(0, end - start + 1)),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  return { status: range ? 206 : 200, start, end, headers };
}

/** Observación de un fichero para vigilar si ffmpeg sigue escribiendo la lista. */
export interface FileObservation {
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * `serveRemuxFile` (server.js:367-409) sobre Fastify: 404 si no es un
 * fichero, 200 vacío si mide 0 sin Range, 416 con `Content-Range: bytes
 * *\/total`, y 200/206 por streaming. Devuelve lo que midió (o null).
 */
export async function sendFile(
  reply: FastifyReply,
  file: string,
  options: SendOptions,
): Promise<FileObservation | null> {
  let size: number;
  let mtimeMs: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not_file');
    size = info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    sendEmpty(reply, 404, { 'cache-control': 'no-store' });
    await settle(reply);
    return null;
  }
  if (size === 0 && !options.rangeHeader) {
    sendEmpty(reply, 200, {
      'content-type': remuxContentType(file),
      'content-length': '0',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    await settle(reply);
    return { size, mtimeMs };
  }
  const range = parseByteRange(options.rangeHeader, size);
  if (range === false) {
    sendEmpty(reply, 416, { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' });
    await settle(reply);
    return { size, mtimeMs };
  }
  const out = rangeHeaders(file, size, range);
  reply.code(out.status).headers(out.headers);
  if (options.head) {
    void reply.send();
  } else {
    const stream = createReadStream(file, { start: out.start, end: out.end });
    stream.on('error', () => reply.raw.destroy());
    void reply.send(stream);
  }
  await settle(reply);
  return { size, mtimeMs };
}

/** Lo mismo con un contenido ya en memoria (la lista reescrita, unos cientos de bytes). */
export async function sendBuffer(
  reply: FastifyReply,
  file: string,
  body: Buffer,
  options: SendOptions,
): Promise<void> {
  const size = body.length;
  if (size === 0 && !options.rangeHeader) {
    sendEmpty(reply, 200, {
      'content-type': remuxContentType(file),
      'content-length': '0',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    await settle(reply);
    return;
  }
  const range = parseByteRange(options.rangeHeader, size);
  if (range === false) {
    sendEmpty(reply, 416, { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' });
    await settle(reply);
    return;
  }
  const out = rangeHeaders(file, size, range);
  reply.code(out.status).headers(out.headers);
  void reply.send(options.head ? undefined : body.subarray(out.start, out.end + 1));
  await settle(reply);
}
