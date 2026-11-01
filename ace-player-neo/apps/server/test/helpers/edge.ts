/* Arnés de los tests del dominio de fuera (tv.ismaeloul.es, docs/acceso-remoto.md).

   Monta la app con un servicio `remote` cuya resolución de `ACE_EDGE_PEER` es falsa (por defecto
   da 127.0.0.1, que es desde donde llega el cliente de los tests) y abre DE VERDAD el servidor del
   puerto del dominio (core/edge.ts) en 127.0.0.1 con un puerto libre: así lo que se prueba es el
   socket, no una cabecera. Lo de casa (el 3000 por nginx) sigue yendo por `app.inject`.

   `pair()` empareja un aparato con el auth real (estado en una carpeta temporal) y `allow()` le
   da permiso de fuera como lo haría la web. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/index.js';
import type { EdgeLookup } from '../../src/core/edge.js';
import { createEdgeServer } from '../../src/core/edge.js';
import type { Logger } from '../../src/core/logger.js';
import type { RouteCollector } from '../../src/core/router.js';
import type { PlaybackService } from '../../src/modules/playback/types.js';
import { createRemote, type RemoteServiceInternal } from '../../src/modules/remote/service.js';
import { createServices, type Services } from '../../src/services.js';
import { createTestCore, web, type TestCore } from './index.js';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** Una IP de internet de documentación (RFC 5737): cuenta para bloqueos y límites. */
export const PUBLIC_IP = '198.51.100.7';

export interface EdgeResponse {
  /** Lo que ve quien llama (un error sin credencial buena sale como 404 vacío). */
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
  json<T = { error?: { code?: string } }>(): T;
  /**
   * Lo que pasó de verdad: el error escondido tras el 404 sin huella (core/remote-gate.ts) o, si
   * no se escondió, el estado y el código del JSON.
   */
  readonly real: { readonly status: number; readonly code: string | null };
  /** ¿Salió como un 404 sin huella? (sin cuerpo y sin cabeceras propias) */
  readonly concealed: boolean;
}

/**
 * Un error del dominio sin credencial buena: quien llama solo ve un 404 vacío, sin cabeceras
 * propias (como el de Caddy), y por dentro fue `status` / `code`.
 */
export function expectHidden(response: EdgeResponse, status: number, code: string): void {
  expect({ seen: response.status, text: response.text, real: response.real }).toEqual({
    seen: 404,
    text: '',
    real: { status, code },
  });
  expect(response.concealed).toBe(true);
  for (const header of ['x-request-id', 'cache-control', 'retry-after', 'www-authenticate']) {
    expect(response.headers[header], header).toBeUndefined();
  }
  expect(response.headers['content-type']).toBeUndefined();
}

/** Un error en JSON v1 de verdad (a un aparato emparejado). */
export function expectError(response: EdgeResponse, status: number, code: string): void {
  expect({
    status: response.status,
    code: response.real.code,
    concealed: response.concealed,
  }).toEqual({ status, code, concealed: false });
}

/** Cabecera solo de los tests para casar cada respuesta con lo que vio el backend. */
const SEQ_HEADER = 'x-test-edge-seq';

export interface EdgeRequest {
  readonly method?: string;
  readonly path: string;
  readonly token?: string;
  /** La IP que pone Caddy en X-Ace-Client-Ip (por defecto, PUBLIC_IP; null = sin cabecera). */
  readonly ip?: string | null;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export interface EdgeTest {
  readonly app: FastifyInstance;
  readonly services: Services;
  readonly remote: RemoteServiceInternal;
  readonly core: TestCore;
  readonly port: number;
  /** Petición al puerto del dominio (como la manda Caddy). */
  edge(request: EdgeRequest): Promise<EdgeResponse>;
  /** Empareja un aparato (auth real) y devuelve su token. */
  pair(name?: string): Promise<{ deviceId: string; token: string }>;
  /** Le da permiso de fuera desde la web. */
  allow(deviceId: string, expiresIn?: '24h' | '7d' | '30d' | 'never'): Promise<void>;
}

export interface EdgeTestOptions {
  readonly env?: Env;
  readonly logger?: Logger;
  readonly lookup?: EdgeLookup;
  /** `false` para no registrar las rutas de los módulos (todo da 501 tras la puerta). */
  readonly moduleRoutes?: boolean;
  readonly register?: (collector: RouteCollector) => void;
  readonly services?: Partial<Omit<Services, keyof TestCore>>;
}

/** playback solo hace falta para el «visor vivo» de las URL de vídeo. */
export function fakePlayback(alive: (sid: string, dev: string) => boolean = () => false) {
  return new Proxy({} as PlaybackService, {
    get(_target, property) {
      if (property === 'isViewerAlive') return alive;
      if (property === 'then' || typeof property === 'symbol') return undefined;
      if (property === 'start' || property === 'stop') return async () => undefined;
      return () => {
        throw new Error(`fakePlayback.${String(property)}`);
      };
    },
  });
}

export async function createEdgeTest(options: EdgeTestOptions = {}): Promise<EdgeTest> {
  const core = createTestCore({
    env: { ACE_EDGE_PEER: 'caddy-de-prueba', ...options.env },
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const base = createServices(core, { playback: fakePlayback(), ...options.services });
  const lookup = options.lookup ?? vi.fn(async () => ['127.0.0.1']);
  const remote = createRemote({ ...core, auth: base.auth, events: base.events, lookup });
  const services: Services = { ...base, remote };
  await remote.start();
  const app = await buildApp({
    services,
    ...(options.moduleRoutes === undefined ? {} : { moduleRoutes: options.moduleRoutes }),
    ...(options.register ? { register: options.register } : {}),
  });
  const concealedBySeq = new Map<string, { status: number; code: string | null }>();
  app.addHook('onResponse', async (request) => {
    const seq = request.headers[SEQ_HEADER];
    const concealed = request.aceRemote?.concealed;
    if (typeof seq === 'string' && concealed) concealedBySeq.set(seq, { ...concealed });
  });
  await app.ready();
  const server = createEdgeServer((req, res) => app.routing(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  remote.setListening(true);
  const port = (server.address() as AddressInfo).port;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remote.stop();
    services.events.closeAll();
    await app.close();
  });

  let nextSeq = 1;
  function edge(request: EdgeRequest): Promise<EdgeResponse> {
    const seq = String(nextSeq++);
    const headers: Record<string, string> = { ...request.headers, [SEQ_HEADER]: seq };
    const ip = request.ip === undefined ? PUBLIC_IP : request.ip;
    if (ip !== null) headers['x-ace-client-ip'] = ip;
    if (request.token) headers.authorization = `Bearer ${request.token}`;
    let payload: string | undefined;
    if (request.body !== undefined) {
      payload = JSON.stringify(request.body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: request.method ?? 'GET', path: request.path, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            /* onResponse corre al terminar la respuesta: se le da una vuelta al bucle. */
            setImmediate(() => {
              const hidden = concealedBySeq.get(seq) ?? null;
              concealedBySeq.delete(seq);
              let code: string | null = null;
              if (!hidden && text) {
                try {
                  code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? null;
                } catch {
                  code = null;
                }
              }
              resolve({
                status,
                headers: res.headers,
                text,
                json: <T>() => JSON.parse(text) as T,
                real: hidden ?? { status, code },
                concealed: hidden !== null,
              });
            });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  async function pair(name = 'iPhone de Isma') {
    const created = await services.auth.createPairing({}, 'http://umbrel.local:7792');
    const claimed = await services.auth.claimPairing({ code: created.code, name, platform: 'ios' });
    return { deviceId: claimed.deviceId, token: claimed.token };
  }

  async function allow(deviceId: string, expiresIn: '24h' | '7d' | '30d' | 'never' = '30d') {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/devices/${deviceId}/remote`,
      headers: web({ 'content-type': 'application/json' }),
      payload: { enabled: true, expiresIn },
    });
    if (response.statusCode !== 200) {
      /* Sin las rutas de los módulos, directo al servicio. */
      await remote.setDevice(deviceId, { enabled: true, expiresIn });
    }
  }

  return { app, services, remote, core, port, edge, pair, allow };
}

/** Abre un SSE por el puerto del dominio y devuelve cómo saber si sigue abierto. */
export function openEdgeSse(
  port: number,
  token: string,
  ip = PUBLIC_IP,
): Promise<{ status: number; closed: Promise<void>; isOpen(): boolean; destroy(): void }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: '/native/api/v1/events',
        headers: { authorization: `Bearer ${token}`, 'x-ace-client-ip': ip },
      },
      (res) => {
        let open = true;
        const closed = new Promise<void>((done) => {
          const finish = () => {
            open = false;
            done();
          };
          res.on('end', finish);
          res.on('close', finish);
          res.on('error', finish);
        });
        res.on('data', () => undefined);
        resolve({
          status: res.statusCode ?? 0,
          closed,
          isOpen: () => open,
          destroy: () => req.destroy(),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
