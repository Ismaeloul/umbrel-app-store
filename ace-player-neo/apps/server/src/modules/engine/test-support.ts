/* Utilidades de los tests de engine, search y engine-control (no es código
   de producto: solo lo importan los *.test.ts).

   - `startFakeEngine(clock)`: el motor falso de test/fake-engine en loopback
     (`::1` si se puede: en el PC de Isma 127.0.0.1 corta ~1 de cada 6
     conexiones) con el MISMO FakeClock que el backend.
   - `startHttpServer(handler)`: un servidor http en loopback (engine_control
     falso, un motor que no contesta o que manda demasiado).
   - `engineConfig(core, …)`: la config de prueba apuntando a esos servidores
     (loadConfig sanea los hosts y quitaría los `:` de `::1`).
   Todo se cierra solo en el `afterEach`. */

import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';
import { createFakeEngine, type FakeEngine } from '../../../test/fake-engine/engine.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import type { AppConfig } from '../../config/index.js';
import type { FakeClock } from '../../core/clock.js';
import { hostForUrl } from './paths.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

export { loopbackHost };

export async function startFakeEngine(
  clock: FakeClock,
  options: Parameters<typeof createFakeEngine>[0] = {},
): Promise<FakeEngine> {
  const engine = await createFakeEngine({ host: await loopbackHost(), clock, ...options });
  cleanups.push(() => engine.close());
  return engine;
}

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

export interface TestServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const host = await loopbackHost();
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanups.push(close);
  return { host, port, url: `http://${hostForUrl(host)}:${port}`, requests, close };
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface EngineEndpoints {
  readonly engine?: { readonly host: string; readonly port: number };
  readonly control?: { readonly host: string; readonly port: number };
  readonly token?: string;
}

/** La config de prueba con el motor y engine_control en los servidores del test. */
export function engineConfig(config: AppConfig, endpoints: EngineEndpoints): AppConfig {
  return {
    ...config,
    engine: {
      ...config.engine,
      ...(endpoints.engine ? { host: endpoints.engine.host, port: endpoints.engine.port } : {}),
      ...(endpoints.control
        ? { controlHost: endpoints.control.host, controlPort: endpoints.control.port }
        : {}),
      ...(endpoints.token === undefined ? {} : { controlToken: endpoints.token }),
    },
  };
}
