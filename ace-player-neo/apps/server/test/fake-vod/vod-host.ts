/* Un «relé» mínimo que aloja sesiones VOD de verdad (src/modules/iptv/
   relay-vod.ts) en loopback, para las pruebas y el laboratorio. En
   producción las aloja relay.ts (VOD-5: `route` → `VodSession.handle`).

   La sesión abre el proveedor con el `net` DE VERDAD (identity, redirecciones
   comprobadas, espera al cierre del socket de P6); como el proveedor falso
   está en loopback, se permite la red privada (ALLOW_PRIVATE_SYNC_URLS) y no
   se pasa el filtro IPTV, que bloquea loopback siempre. */

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { IPTV_RELAY } from '@ace/shared';
import { createSystemClock, type Clock } from '../../src/core/clock.js';
import { createSilentLogger, type Logger } from '../../src/core/logger.js';
import {
  VodSession,
  type VodOpenRequest,
  type VodSessionDeps,
  type VodSessionOptions,
} from '../../src/modules/iptv/relay-vod.js';
import { createFetcher } from '../../src/modules/net/client.js';
import { nodeTransport, systemResolver } from '../../src/modules/net/transport.js';
import type { OpenedStream } from '../../src/modules/net/types.js';

export interface VodHost {
  readonly port: number;
  /** Peticiones abiertas al proveedor (las que hizo `open`). */
  readonly opens: VodOpenRequest[];
  session(
    url: string,
    ext: string,
    options?: Partial<Omit<VodSessionOptions, 'ticket' | 'inputUrl' | 'url'>> & {
      readonly deps?: Partial<VodSessionDeps>;
    },
  ): VodSession;
  close(): Promise<void>;
}

/**
 * El `open` de producción, con el net de verdad (el mismo `openStream`:
 * redirecciones, identity, espera al socket de P6) y Range. Sin los
 * ayudantes de vitest: también lo usa el guion del laboratorio.
 */
export function netOpener(
  clock: Clock,
  idleMs: number = IPTV_RELAY.idleMs,
): (request: VodOpenRequest) => Promise<OpenedStream> {
  const net = createFetcher({
    clock,
    resolver: systemResolver,
    transport: nodeTransport,
    allowPrivateUrls: true,
    userAgent: 'AcePlayerNeo/laboratorio',
  });
  return (request) =>
    net.openStream(request.url, {
      idleMs,
      headersMs: IPTV_RELAY.headersMs,
      accept: '*/*',
      identity: true,
      headers: { range: `bytes=${request.start}-${request.end ?? ''}` },
      signal: request.signal,
    });
}

export async function createVodHost(
  host: string,
  options: { readonly clock?: Clock; readonly logger?: Logger; readonly idleMs?: number } = {},
): Promise<VodHost> {
  const clock = options.clock ?? createSystemClock();
  const logger = options.logger ?? createSilentLogger();
  const opener = netOpener(clock, options.idleMs);
  const opens: VodOpenRequest[] = [];
  const sessions = new Map<string, VodSession>();
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const match = /^\/r\/([A-Za-z0-9_-]{16,64})\/vod\.[a-z0-9]{2,5}$/.exec(req.url ?? '');
    const session = match ? sessions.get(match[1] as string) : undefined;
    if (!session) {
      res.writeHead(404).end();
      return;
    }
    session.handle(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  const hostInUrl = host.includes(':') ? `[${host}]` : host;
  return {
    port,
    opens,
    session(url, ext, extra = {}) {
      const ticket = randomBytes(16).toString('base64url');
      const { deps, ...rest } = extra;
      const session = new VodSession(
        {
          clock,
          logger,
          open: (request) => {
            opens.push(request);
            return opener(request);
          },
          ...deps,
        },
        { ...rest, ticket, inputUrl: `http://${hostInUrl}:${port}/r/${ticket}/vod.${ext}`, url },
      );
      sessions.set(ticket, session);
      return session;
    },
    async close() {
      for (const session of sessions.values()) await session.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
