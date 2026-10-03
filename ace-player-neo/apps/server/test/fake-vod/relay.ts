/* Relé VOD de prueba (docs/vod.md §9.2, hallazgo 1): lo mínimo para que un
   ffmpeg de verdad lea del proveedor falso de una sola conexión.

   ffmpeg abre la petición nueva ANTES de cerrar la vieja en cada salto. Este
   relé, con cada petición que llega: corta la respuesta anterior hacia
   abajo, destruye la conexión de arriba, ESPERA a que su socket se cierre y
   solo entonces abre la nueva con el mismo Range. Las aperturas van en fila
   y la petición más nueva gana: una que llega mientras otra espera deja a la
   anterior fuera. Sin caché, sin reintentos y sin filtro SSRF: el de verdad
   es src/modules/iptv/relay-vod.ts. Sirve para probar el lector, los índices
   y la ejecución de ffmpeg sin él, y como referencia de lo que el relé de
   verdad tiene que hacer.

   URL: `http://<loopback>:<p>/r/<ticket>/vod.<ext>` (la forma que acepta el
   lector, `isRelayUrl`). */

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface TestVodRelay {
  /** URL de entrada para ffmpeg y el lector. */
  readonly inputUrl: string;
  readonly stats: {
    requests: number;
    maxUpstream: number;
    upstream: number;
    /** El Range de cada petición que llegó (o «-» sin él). */
    readonly ranges: string[];
  };
  close(): Promise<void>;
}

const SETTLE_MS = 20;
const BUSY_RETRIES = 10;
const BUSY_RETRY_MS = 50;

interface Leg {
  readonly up: http.ClientRequest;
  readonly down: http.ServerResponse;
  readonly closed: Promise<void>;
}

export async function createTestVodRelay(
  host: string,
  upstreamUrl: string,
  ext: string,
): Promise<TestVodRelay> {
  const ticket = randomBytes(16).toString('base64url');
  const stats = { requests: 0, maxUpstream: 0, upstream: 0, ranges: [] as string[] };
  let current: Leg | null = null;
  let newest = 0;
  let chain: Promise<void> = Promise.resolve();
  const sockets = new Set<Socket>();

  const cut = (leg: Leg | null): void => {
    leg?.down.destroy();
    leg?.up.destroy();
  };

  const open = (req: http.IncomingMessage, res: http.ServerResponse, attempt = 0): Leg => {
    let markClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (markClosed = resolve));
    const up = http.get(
      upstreamUrl,
      {
        agent: false,
        headers: typeof req.headers.range === 'string' ? { range: req.headers.range } : {},
      },
      (upRes) => {
        /* «Ocupado» justo tras cerrar nosotros: el proveedor aún no ha visto el
           cierre (en Windows llega a pasar en loopback). Se reintenta un poco,
           como hará el relé de verdad con su espera por ocupado. */
        if (upRes.statusCode === 458 && attempt < BUSY_RETRIES && !res.destroyed) {
          upRes.resume();
          void closed.then(() =>
            setTimeout(() => {
              if (!res.destroyed && current?.down === res) current = open(req, res, attempt + 1);
            }, BUSY_RETRY_MS),
          );
          return;
        }
        const headers: http.OutgoingHttpHeaders = {
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
        };
        for (const name of ['content-length', 'content-range'] as const) {
          const value = upRes.headers[name];
          if (value) headers[name] = value;
        }
        res.writeHead(upRes.statusCode ?? 502, headers);
        if (req.method === 'HEAD') {
          upRes.destroy();
          res.end();
          return;
        }
        upRes.pipe(res);
        upRes.on('error', () => res.destroy());
      },
    );
    stats.upstream += 1;
    stats.maxUpstream = Math.max(stats.maxUpstream, stats.upstream);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      stats.upstream -= 1;
      markClosed();
    };
    let socketSeen = false;
    up.on('socket', (socket) => {
      socketSeen = true;
      socket.once('close', release);
    });
    /* Destruida antes de tener socket: no hubo conexión que esperar. */
    up.on('close', () => {
      if (!socketSeen) release();
    });
    up.on('error', () => res.destroy());
    res.once('close', () => up.destroy());
    return { up, down: res, closed };
  };

  const server = http.createServer((req, res) => {
    res.on('error', () => undefined);
    if (req.url !== `/r/${ticket}/vod.${ext}`) {
      res.writeHead(404).end();
      return;
    }
    stats.requests += 1;
    stats.ranges.push(typeof req.headers.range === 'string' ? req.headers.range : '-');
    const mine = ++newest;
    /* La petición más nueva gana: la anterior se corta ya, sin esperar a la fila. */
    cut(current);
    chain = chain.then(async () => {
      if (mine !== newest || res.destroyed) {
        res.destroy();
        return;
      }
      const previous = current;
      current = null;
      cut(previous);
      if (previous) {
        await previous.closed;
        /* Un respiro para que el proveedor procese el cierre antes de la nueva. */
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      }
      if (mine !== newest || res.destroyed) {
        res.destroy();
        return;
      }
      current = open(req, res);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  const hostInUrl = host.includes(':') ? `[${host}]` : host;
  return {
    inputUrl: `http://${hostInUrl}:${port}/r/${ticket}/vod.${ext}`,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        cut(current);
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
