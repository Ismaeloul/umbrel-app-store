/* Ficheros del remux: rangos HTTP, lista HLS y envío por streaming
   (server.js:339-409; api.md §4.23; B-221).

   - `parseByteRange` es la de la 0.6.59 tal cual (T-003).
   - El envío es el de `serveRemuxFile`: 200/206/416/404 con las mismas
     cabeceras y el fichero leído por trozos (nunca entero en memoria), ahora
     sobre la respuesta de Fastify.
   - `rewritePlaylist` añade `?t=<token>` a cada URI de la lista (también a
     `#EXT-X-MAP:URI`) para la app iOS (arquitectura §5.12). */

import { open, readFile, type FileHandle } from 'node:fs/promises';
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
  /**
   * El fichero puede no estar TODAVÍA (la lista de un remux que arranca o se
   * reinicia, docs/iptv.md §17): si falta, 503 con `Retry-After: 1` («aún no
   * está», hls.js lo reintenta) en vez de 404.
   */
  readonly notYet?: boolean | undefined;
}

/** «Aún no está»: la lista del remux mientras arranca o se reinicia (docs/iptv.md §17). */
export const NOT_YET_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'retry-after': '1',
};

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
  /* Se abre ANTES de medir y se lee de ese mismo descriptor: si el remux se
     reinicia y borra la carpeta entre medias, ya no hay un ENOENT al abrir el
     stream (que salía como 500 «error interno», docs/iptv.md §17). */
  let handle: FileHandle;
  try {
    handle = await open(file, 'r');
  } catch {
    sendEmpty(
      reply,
      options.notYet ? 503 : 404,
      options.notYet ? { ...NOT_YET_HEADERS } : { 'cache-control': 'no-store' },
    );
    await settle(reply);
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('not_file');
    size = info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    await handle.close().catch(() => undefined);
    sendEmpty(reply, 404, { 'cache-control': 'no-store' });
    await settle(reply);
    return null;
  }
  const close = (): void => {
    void handle.close().catch(() => undefined);
  };
  if (size === 0 && !options.rangeHeader) {
    close();
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
    close();
    sendEmpty(reply, 416, { 'content-range': `bytes */${size}`, 'cache-control': 'no-store' });
    await settle(reply);
    return { size, mtimeMs };
  }
  const out = rangeHeaders(file, size, range);
  reply.code(out.status).headers(out.headers);
  if (options.head) {
    close();
    void reply.send();
  } else {
    /* `autoClose`: el stream cierra el descriptor al acabar o al fallar. */
    const stream = handle.createReadStream({ start: out.start, end: out.end, autoClose: true });
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
