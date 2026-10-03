/* Proveedor VOD falso del banco de pruebas (docs/vod.md §9.2 y §15.3).

   Sirve ficheros como un panel Xtream (`/movie/<u>/<p>/<id>.<ext>` y
   `/series/<u>/<p>/<id>.<ext>`) con Range y 206, y cuenta las conexiones
   abiertas a la vez. Lo raro de los paneles reales se elige por opciones (y
   se puede cambiar en marcha con `set`):

   - `maxConn`: conexiones a la vez; la siguiente recibe 458 (por defecto 1,
     como la cuenta de Isma).
   - `busyAfterCloseMs`: tras cerrarse una conexión, las nuevas reciben 458
     durante este rato (el panel tarda en soltar la plaza).
   - `noRange`: ignora Range y responde 200 con el fichero entero.
   - `redirect`: 302 a `/lb/<token>/<id>.<ext>` (un balanceador con token).
   - `firstByteMs`, `rateMbps`: latencia y velocidad.
   - `dropAtBytes`: corta la conexión tras mandar esos bytes (cada respuesta).
   - `cutOpen()`: corta YA las conexiones abiertas, como el `send_timeout` de
     un nginx con el reproductor en pausa. No se imita con un plazo de
     inactividad: en Windows el loopback se traga decenas de MB sin
     contrapresión (medido: 64 MiB «enviados» con el cliente parado), así que
     el servidor nunca vería la conexión parada.

   El manejador va suelto (`handler`) para poder montarlo después dentro del
   proveedor IPTV falso (test/fake-iptv, VOD-5). Escucha solo en loopback. */

import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const FAKE_VOD_USER = 'vodusuario';
export const FAKE_VOD_PASSWORD = 'vodclave';
const LB_TOKEN = 'tok3n-lb-9f8e7d';

export interface FakeVodOriginOptions {
  readonly maxConn?: number;
  readonly busyAfterCloseMs?: number;
  readonly noRange?: boolean;
  readonly redirect?: boolean;
  /** Token del balanceador al que redirige (cambiarlo deja los /lb/ viejos en 410). */
  readonly lbToken?: string;
  readonly firstByteMs?: number;
  readonly rateMbps?: number;
  readonly dropAtBytes?: number;
}

export interface FakeVodRequest {
  readonly path: string;
  readonly method: string;
  readonly range: string | null;
  readonly status: number;
}

export interface FakeVodStats {
  /** Respuestas en curso ahora. */
  open: number;
  /** El máximo de respuestas a la vez que se ha visto. */
  maxOpen: number;
  /** Peticiones rechazadas con 458. */
  rejected: number;
  /** Bytes de vídeo mandados. */
  bytesSent: number;
  readonly requests: FakeVodRequest[];
}

export interface FakeVodHandler {
  readonly handler: http.RequestListener;
  readonly stats: FakeVodStats;
  set(options: FakeVodOriginOptions): void;
  /** Corta todas las respuestas de vídeo abiertas (cuentan como cierre para `busyAfterCloseMs`). */
  cutOpen(): void;
}

export interface FakeVodOrigin extends FakeVodHandler {
  readonly port: number;
  readonly host: string;
  /** URL de una película (`kind` = movie) o de un episodio (`series`). */
  url(file: string, kind?: 'movie' | 'series'): string;
  close(): Promise<void>;
}

/** Rango simple `bytes=a-b`, `bytes=a-` o `bytes=-n`; varios rangos → 'multi'. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'multi' | 'bad' | null {
  if (!header) return null;
  const value = header.trim();
  if (!value.startsWith('bytes=')) return 'bad';
  const spec = value.slice(6);
  if (spec.includes(',')) return 'multi';
  const match = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!match) return 'bad';
  const a = match[1] ?? '';
  const b = match[2] ?? '';
  if (a === '' && b === '') return 'bad';
  if (a === '') {
    const n = Number(b);
    if (n <= 0) return 'bad';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || end < start) return 'bad';
  return { start, end };
}

export function createFakeVodHandler(
  files: Readonly<Record<string, string>>,
  initial: FakeVodOriginOptions = {},
): FakeVodHandler {
  let options: FakeVodOriginOptions = { maxConn: 1, ...initial };
  let lastCloseAt = -Infinity;
  const sizes = new Map<string, { path: string; size: number }>();
  for (const [name, file] of Object.entries(files)) {
    sizes.set(name, { path: file, size: statSync(file).size });
  }
  const stats: FakeVodStats = { open: 0, maxOpen: 0, rejected: 0, bytesSent: 0, requests: [] };
  const live = new Set<http.ServerResponse>();

  const handler: http.RequestListener = (req, res) => {
    res.on('error', () => undefined);
    const url = new URL(req.url ?? '/', 'http://origen');
    const note = (status: number): void => {
      stats.requests.push({
        path: url.pathname,
        method: req.method ?? 'GET',
        range: typeof req.headers.range === 'string' ? req.headers.range : null,
        status,
      });
    };
    const xtream = /^\/(movie|series)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    const balanced = /^\/lb\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    let name: string | null = null;
    if (xtream) {
      if (xtream[2] !== FAKE_VOD_USER || xtream[3] !== FAKE_VOD_PASSWORD) {
        note(401);
        res.writeHead(401).end();
        return;
      }
      if (options.redirect) {
        note(302);
        res.writeHead(302, { location: `/lb/${options.lbToken ?? LB_TOKEN}/${xtream[4]}` }).end();
        return;
      }
      name = xtream[4] ?? null;
    } else if (balanced && balanced[1] === (options.lbToken ?? LB_TOKEN)) {
      name = balanced[2] ?? null;
    }
    const entry = name ? sizes.get(name) : undefined;
    if (!entry) {
      note(404);
      res.writeHead(404).end();
      return;
    }
    if (
      stats.open >= (options.maxConn ?? Infinity) ||
      Date.now() - lastCloseAt < (options.busyAfterCloseMs ?? 0)
    ) {
      stats.rejected += 1;
      note(458);
      res.writeHead(458, { 'content-type': 'text/plain' }).end('max connections');
      return;
    }
    stats.open += 1;
    stats.maxOpen = Math.max(stats.maxOpen, stats.open);
    live.add(res);
    res.once('close', () => {
      live.delete(res);
      stats.open -= 1;
      lastCloseAt = Date.now();
    });

    const range = options.noRange
      ? null
      : parseRange(req.headers.range as string | undefined, entry.size);
    if (range === 'multi' || range === 'bad') {
      note(416);
      res.writeHead(416, { 'content-range': `bytes */${entry.size}` }).end();
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : entry.size - 1;
    const status = range ? 206 : 200;
    note(status);
    const send = (): void => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'content-type': 'video/x-matroska',
        'content-length': String(end - start + 1),
        'accept-ranges': options.noRange ? 'none' : 'bytes',
        ...(range ? { 'content-range': `bytes ${start}-${end}/${entry.size}` } : {}),
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      pump(res, entry.path, start, end, options, stats);
    };
    if (options.firstByteMs) setTimeout(send, options.firstByteMs);
    else send();
  };

  return {
    handler,
    stats,
    set(next) {
      options = { ...options, ...next };
    },
    cutOpen() {
      for (const res of [...live]) res.socket?.destroy();
    },
  };
}

/* Manda [start, end] con el ritmo y el corte pedidos, respetando la contrapresión. */
function pump(
  res: http.ServerResponse,
  file: string,
  start: number,
  end: number,
  options: FakeVodOriginOptions,
  stats: FakeVodStats,
): void {
  const stream = createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
  const bytesPerMs = options.rateMbps ? (options.rateMbps * 1_000_000) / 8 / 1000 : null;
  const began = Date.now();
  let sent = 0;
  res.once('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.on('end', () => res.end());
  stream.on('data', (chunk: Buffer | string) => {
    const piece = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    if (options.dropAtBytes !== undefined && sent + piece.length >= options.dropAtBytes) {
      const out = piece.subarray(0, Math.max(0, options.dropAtBytes - sent));
      stats.bytesSent += out.length;
      stream.destroy();
      /* Lo que ya se escribió llega entero y después se cierra (FIN, no RST: en
         Windows un RST tira lo que aún iba de camino y el corte caería en otro
         sitio cada vez). */
      res.write(out, () => res.socket?.end());
      return;
    }
    sent += piece.length;
    stats.bytesSent += piece.length;
    const ok = res.write(piece);
    const waitMs = bytesPerMs ? Math.max(0, began + sent / bytesPerMs - Date.now()) : 0;
    if (ok && waitMs === 0) return;
    stream.pause();
    let drained = ok;
    let slept = waitMs === 0;
    const go = (): void => {
      if (drained && slept && !res.destroyed) stream.resume();
    };
    if (!ok) {
      res.once('drain', () => {
        drained = true;
        go();
      });
    }
    if (waitMs > 0) {
      setTimeout(() => {
        slept = true;
        go();
      }, waitMs);
    }
  });
}

/**
 * Proveedor VOD falso escuchando en `host` (loopback). `files` va de
 * `<id>.<ext>` a la ruta del fichero en disco.
 */
export async function createFakeVodOrigin(
  host: string,
  files: Readonly<Record<string, string>>,
  options: FakeVodOriginOptions = {},
): Promise<FakeVodOrigin> {
  const fake = createFakeVodHandler(files, options);
  const sockets = new Set<Socket>();
  const server = http.createServer(fake.handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  const hostInUrl = host.includes(':') ? `[${host}]` : host;
  return {
    ...fake,
    port,
    host,
    url(file, kind = 'movie') {
      return `http://${hostInUrl}:${port}/${kind}/${FAKE_VOD_USER}/${FAKE_VOD_PASSWORD}/${file}`;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
