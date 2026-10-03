/* Relé VOD de prueba (docs/vod.md §9.2, hallazgo 1): lo mínimo para que un
   ffmpeg de verdad lea del proveedor falso de una sola conexión.

   ffmpeg abre la petición nueva ANTES de cerrar la vieja en cada salto. Este
   relé, con cada petición que llega: corta la respuesta anterior hacia
   abajo, destruye la conexión de arriba, ESPERA a que su socket se cierre y
   solo entonces abre la nueva con el mismo Range. Sin caché, sin reintentos
   y sin filtro SSRF: el de verdad es src/modules/iptv/relay-vod.ts. Sirve
   para probar el lector, los índices y la ejecución de ffmpeg sin él, y
   como referencia de lo que el relé de verdad tiene que hacer.

   URL: `http://<loopback>:<p>/r/<ticket>/vod.<ext>` (la forma que acepta el
   lector, `isRelayUrl`). */

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface TestVodRelay {
  /** URL de entrada para ffmpeg y el lector. */
  readonly inputUrl: string;
  readonly stats: { requests: number; maxUpstream: number; upstream: number };
  close(): Promise<void>;
}

export async function createTestVodRelay(
  host: string,
  upstreamUrl: string,
  ext: string,
): Promise<TestVodRelay> {
  const ticket = randomBytes(16).toString('base64url');
  const stats = { requests: 0, maxUpstream: 0, upstream: 0 };
  let current: { up: http.ClientRequest; down: http.ServerResponse; closed: Promise<void> } | null =
    null;
  let chain: Promise<void> = Promise.resolve();
  const sockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    res.on('error', () => undefined);
    if (req.url !== `/r/${ticket}/vod.${ext}`) {
      res.writeHead(404).end();
      return;
    }
    stats.requests += 1;
    /* La petición más nueva gana: se corta la anterior y se espera su socket. */
    const previous = current;
    current = null;
    if (previous) {
      previous.down.destroy();
      previous.up.destroy();
    }
    chain = chain.then(async () => {
      if (previous) await previous.closed;
      if (res.destroyed) return;
      let markClosed: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => (markClosed = resolve));
      const up = http.get(
        upstreamUrl,
        {
          agent: false,
          headers: typeof req.headers.range === 'string' ? { range: req.headers.range } : {},
        },
        (upRes) => {
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
      let counted = true;
      up.on('socket', (socket) => {
        socket.once('close', () => {
          if (counted) stats.upstream -= 1;
          counted = false;
          markClosed();
        });
      });
      stats.maxUpstream = Math.max(stats.maxUpstream, stats.upstream);
      up.on('error', () => res.destroy());
      res.once('close', () => up.destroy());
      current = { up, down: res, closed };
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
        current?.up.destroy();
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
