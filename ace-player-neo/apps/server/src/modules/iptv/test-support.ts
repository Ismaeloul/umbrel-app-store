/* Piezas de los tests del módulo `iptv` (no es código de producto: solo lo
   importan los *.test.ts y la integración).

   `createIptvTestRig()` monta el servicio de verdad (estado en un temporal,
   `net` con el filtro SSRF real) contra el proveedor falso de
   test/fake-iptv, con el reloj falso del backend y un logger que guarda lo
   que escribe (para las pruebas de fuga). */

import http from 'node:http';
import { Writable } from 'node:stream';
import { createLogger } from '../../core/logger.js';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { createNetClient } from '../net/index.js';
import { createStateService } from '../state/index.js';
import type { StateService } from '../state/types.js';
import { createTestCore, type TestCore } from '../../../test/helpers/index.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import {
  createFakeIptv,
  type FakeIptv,
  type FakeIptvOptions,
} from '../../../test/fake-iptv/provider.js';
import {
  FAKE_IPTV_HOST,
  fakeIptvResolver,
  fakeIptvTransport,
} from '../../../test/fake-iptv/net.js';
import { IptvServiceImpl } from './service.js';

/** El partido de la guía del proveedor falso empieza esto después del «ahora» del reloj falso. */
export const IPTV_TEST_MATCH_OFFSET_MS = 2 * 3_600_000;

export interface IptvTestRig {
  readonly core: TestCore;
  readonly state: StateService;
  readonly fake: FakeIptv;
  readonly service: IptvServiceImpl;
  /** Todo lo que se ha escrito en el log. */
  readonly logs: string[];
  close(): Promise<void>;
}

export async function createIptvTestRig(
  options: { readonly fake?: FakeIptvOptions; readonly env?: Record<string, string> } = {},
): Promise<IptvTestRig> {
  const logs: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger({ level: 'debug', destination });
  const core = createTestCore({ logger, ...(options.env ? { env: options.env } : {}) });
  const host = await loopbackHost();
  const fake = await createFakeIptv({
    host,
    publicHost: FAKE_IPTV_HOST,
    now: () => core.clock.now(),
    /* El partido de la guía, dentro de la ventana del reloj falso (2 h después). */
    matchStart: core.clock.now() + IPTV_TEST_MATCH_OFFSET_MS,
    ...options.fake,
  });
  const net = createNetClient({
    ...core,
    resolver: fakeIptvResolver(),
    transport: fakeIptvTransport({ host, port: fake.port }),
  });
  const state = createStateService(core);
  await state.load();
  const service = new IptvServiceImpl({
    ...core,
    state,
    net,
    relayHost: host === '::1' ? '::1' : '127.0.0.1',
    /* La puntuación de la resolución, como en services.ts (buscador y re-emparejado, §14). */
    scorer: (channels, item) => scoreResolutionCandidate(channels, item, 'iptv'),
  });
  return {
    core,
    state,
    fake,
    service,
    logs,
    async close() {
      await service.stop();
      await fake.close();
      await state.flush();
    },
  };
}

/** GET sencillo contra el relé (como haría ffmpeg). */
export function relayGet(
  url: string,
  options: { readonly maxBytes?: number; readonly timeoutMs?: number } = {},
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  const maxBytes = options.maxBytes ?? 64 * 1024;
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = (): void => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers });
      };
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= maxBytes) {
          res.destroy();
          finish();
        }
      });
      res.on('end', finish);
      res.on('error', finish);
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('relayGet: sin respuesta a tiempo'));
    }, options.timeoutMs ?? 5000);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Espera en tiempo real a que se cumpla algo. */
export async function waitFor(what: string, check: () => boolean, maxMs = 5000): Promise<void> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > maxMs) throw new Error(`no ha pasado a tiempo: ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
