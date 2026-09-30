/* Ficheros del remux: rangos HTTP, lista HLS y envío por streaming
   (server.js:339-409; api.md §4.23; B-221).

   - `parseByteRange` es la de la 0.6.59 tal cual (T-003).
   - El envío es el de `serveRemuxFile`: 200/206/416/404 con las mismas
     cabeceras y el fichero leído por trozos (nunca entero en memoria), ahora
     sobre la respuesta de Fastify.
   - `rewritePlaylist` añade `?t=<token>` a cada URI de la lista (también a
     `#EXT-X-MAP:URI`) para la app iOS (arquitectura §5.12).
   - Reinicio continuo de la IPTV (diagnostico-iptv-0.8.2 B2): cada ffmpeg de
     la misma sesión es una «generación» con su init (`init.mp4` la primera,
     `init_<n>.mp4` las siguientes) y sigue la numeración de los segmentos;
     `withDiscontinuitySequence` pone el `#EXT-X-DISCONTINUITY-SEQUENCE` que
     ffmpeg nunca escribe. */

import { open, readFile, readdir, type FileHandle } from 'node:fs/promises';
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

/** Lo que se mira de una lista del remux: la cuenta, su init y su TARGETDURATION. */
export interface PlaylistInfo extends PlaylistStats {
  /** URI de `#EXT-X-MAP` (`init.mp4`, `init_2.mp4`…) o null. */
  readonly init: string | null;
  /** `#EXT-X-TARGETDURATION` en segundos, o null. */
  readonly targetDuration: number | null;
}

export function playlistInfoFromText(text: string): PlaylistInfo {
  const map = /^#EXT-X-MAP:.*?URI="([^"?]*)/m.exec(text);
  const target = /^#EXT-X-TARGETDURATION:(\d+)/m.exec(text);
  return {
    ...playlistStatsFromText(text),
    init: map?.[1] ?? null,
    targetDuration: target ? Number(target[1]) : null,
  };
}

export async function readPlaylistInfo(file: string): Promise<PlaylistInfo | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  return playlistInfoFromText(text);
}

/** Nombre del init de una generación: `init.mp4` la primera (como siempre), `init_<n>.mp4` las demás. */
export function initFileName(generation: number): string {
  return generation > 1 ? `init_${generation}.mp4` : 'init.mp4';
}

/** Generación de un init (`init.mp4` → 1, `init_3.mp4` → 3) o null si no es un init del remux. */
export function generationOfInit(name: string | null): number | null {
  if (name === 'init.mp4') return 1;
  const match = /^init_(\d{1,6})\.mp4$/.exec(name ?? '');
  return match ? Number(match[1]) : null;
}

/** Segmentos de ffmpeg, también el `.tmp` que deja a medias uno que se mata con `temp_file`. */
const SEGMENT_FILE_RE = /^index(\d{1,9})\.m4s(?:\.tmp)?$/;

/** Ficheros de la carpeta (vacío si no está). */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Número del primer segmento de la generación siguiente: 1 + el mayor `index<N>.m4s` de la CARPETA (no de
 * la lista, que puede ir por detrás de los ficheros). 0 si no hay ninguno.
 */
export async function nextSegmentNumber(dir: string): Promise<number> {
  let max = -1;
  for (const name of await listDir(dir)) {
    const match = SEGMENT_FILE_RE.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/**
 * Ficheros de las generaciones anteriores: los segmentos por debajo de `startNumber` y cualquier init que
 * no sea `init`. Se borran cuando la lista nueva ya está (nunca antes: hasta entonces se sirve la vieja).
 */
export async function previousGenerationFiles(
  dir: string,
  startNumber: number,
  init: string,
): Promise<string[]> {
  return (await listDir(dir)).filter((name) => {
    const segment = SEGMENT_FILE_RE.exec(name);
    if (segment) return Number(segment[1]) < startNumber;
    return name !== init && generationOfInit(name) !== null;
  });
}

/**
 * `#EXT-X-DISCONTINUITY-SEQUENCE` de una lista de la generación `g` (la de su `#EXT-X-MAP`), que ffmpeg
 * nunca escribe y AVPlayer necesita (RFC 8216 §6.2.1): cada reinicio añade una discontinuidad, así que vale
 * `g−2` mientras se ve el `#EXT-X-DISCONTINUITY` de su primer segmento (el que pone `discont_start`) y
 * `g−1` cuando ya ha salido de la ventana. La primera generación (`init.mp4`) sale tal cual, byte a byte.
 */
export function withDiscontinuitySequence(text: string): string {
  const generation = generationOfInit(playlistInfoFromText(text).init);
  if (generation === null || generation < 2) return text;
  if (/^#EXT-X-DISCONTINUITY-SEQUENCE:/m.test(text)) return text;
  const visible = /^#EXT-X-DISCONTINUITY\r?$/m.test(text);
  const tag = `#EXT-X-DISCONTINUITY-SEQUENCE:${visible ? generation - 2 : generation - 1}`;
  const lines = text.split('\n');
  const cr = lines[0]?.endsWith('\r') ? '\r' : '';
  /* Detrás de MEDIA-SEQUENCE (o de TARGETDURATION, o de #EXTM3U): siempre antes del primer segmento. */
  let at = lines.findIndex((line) => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  if (at < 0) at = lines.findIndex((line) => line.startsWith('#EXT-X-TARGETDURATION:'));
  if (at < 0) at = 0;
  lines.splice(at + 1, 0, `${tag}${cr}`);
  return lines.join('\n');
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
   * reinicia, docs/iptv.md §18): si falta, 503 con `Retry-After: 1` («aún no
   * está», hls.js lo reintenta) en vez de 404.
   */
  readonly notYet?: boolean | undefined;
  /** Cuánto esperar a que aparezca antes del 503 (por defecto `NOT_YET_WAIT_MS`; los tests, 0). */
  readonly notYetWaitMs?: number | undefined;
}

/** «Aún no está»: la lista del remux mientras arranca o se reinicia (docs/iptv.md §18). */
export const NOT_YET_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'retry-after': '1',
};

/**
 * Lo que se espera a una lista que aún no está antes de responder 503 (docs/iptv.md §19): así un
 * reproductor que no reintenta un 503 (el HLS nativo de Safari) casi nunca lo ve, y hls.js tampoco.
 */
export const NOT_YET_WAIT_MS = 2_500;
const NOT_YET_POLL_MS = 150;

/** ¿Es «el fichero no está» (y no un permiso, un límite de descriptores…)? */
export function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Abre un fichero y, si es una lista que aún no está (`notYet`), lo reintenta cada 150 ms hasta
 * `NOT_YET_WAIT_MS` (o hasta que el cliente se vaya). null si sigue sin estar; otro error (EACCES, EMFILE)
 * se lanza: eso es un error de verdad, no «aún no está».
 */
async function openWhenReady(
  file: string,
  notYet: boolean,
  gone: () => boolean,
  waitMs: number,
): Promise<FileHandle | null> {
  const until = Date.now() + (notYet ? waitMs : 0);
  for (;;) {
    try {
      return await open(file, 'r');
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (Date.now() >= until || gone()) return null;
      await new Promise((resolve) => setTimeout(resolve, NOT_YET_POLL_MS));
    }
  }
}

/** El texto de una lista que puede no estar todavía (la ruta nativa, que la reescribe con el token). */
export async function readWhenReady(
  file: string,
  waitMs = NOT_YET_WAIT_MS,
): Promise<string | null> {
  const handle = await openWhenReady(file, true, () => false, waitMs);
  if (!handle) return null;
  try {
    return await handle.readFile('utf8');
  } finally {
    await handle.close().catch(() => undefined);
  }
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
  /* Se abre ANTES de medir y se lee de ese mismo descriptor: si el remux se
     reinicia y borra la carpeta entre medias, ya no hay un ENOENT al abrir el
     stream (que salía como 500 «error interno», docs/iptv.md §18). */
  const found = await openWhenReady(
    file,
    Boolean(options.notYet),
    () => reply.raw.destroyed,
    options.notYetWaitMs ?? NOT_YET_WAIT_MS,
  );
  if (!found) {
    sendEmpty(
      reply,
      options.notYet ? 503 : 404,
      options.notYet ? { ...NOT_YET_HEADERS } : { 'cache-control': 'no-store' },
    );
    await settle(reply);
    return null;
  }
  const handle = found;
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
