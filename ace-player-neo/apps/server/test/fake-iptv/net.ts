/* `net` de las pruebas contra el proveedor IPTV falso (docs/iptv.md §9.2).

   El host del proveedor (`iptv.ace-e2e.example`, un dominio reservado)
   resuelve a una IP PÚBLICA, así que el filtro SSRF real del backend lo deja
   pasar como en producción; el transporte, en vez de conectar a esa IP,
   reenvía la petición al servidor falso local (manteniendo ruta, query y
   cabeceras). Cualquier otro host va por el resolvedor y el transporte de
   verdad (o falla, en los tests). */

import http from 'node:http';
import type { NetResolver, NetTransport } from '../../src/modules/net/types.js';
import { nodeTransport, systemResolver } from '../../src/modules/net/transport.js';

export const FAKE_IPTV_HOST = 'iptv.ace-e2e.example';
/** Una IP pública cualquiera (no se conecta nunca a ella). */
export const FAKE_IPTV_PUBLIC_IP = '93.184.215.14';

export interface FakeIptvTarget {
  readonly host: string;
  readonly port: number;
}

export interface FakeIptvNetOptions {
  /** Host público del proveedor (por defecto `iptv.ace-e2e.example`). */
  readonly hostname?: string;
  /** Qué hacer con los demás hosts: `real` (DNS y red de verdad) o `fail`. */
  readonly others?: 'real' | 'fail';
}

export function fakeIptvResolver(options: FakeIptvNetOptions = {}): NetResolver {
  const hostname = options.hostname ?? FAKE_IPTV_HOST;
  return {
    lookup(name) {
      if (name === hostname) return Promise.resolve([{ address: FAKE_IPTV_PUBLIC_IP, family: 4 }]);
      if (options.others === 'real') return systemResolver.lookup(name);
      return Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND' }),
      );
    },
  };
}

/** Transporte que manda al proveedor falso lo que va a su host público. */
export function fakeIptvTransport(
  target: FakeIptvTarget,
  options: FakeIptvNetOptions = {},
): NetTransport {
  const hostname = options.hostname ?? FAKE_IPTV_HOST;
  return (request) => {
    if (request.url.hostname !== hostname) {
      if (options.others === 'real') return nodeTransport(request);
      return Promise.reject(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      );
    }
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: target.host,
          port: target.port,
          path: `${request.url.pathname}${request.url.search}`,
          headers: { ...request.headers, host: request.url.host },
          agent: false,
        },
        (response) => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
        },
      );
      const onAbort = (): void => {
        req.destroy(
          request.signal.reason instanceof Error ? request.signal.reason : new Error('aborted'),
        );
      };
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener('abort', onAbort, { once: true });
      req.on('error', reject);
      req.on('close', () => request.signal.removeEventListener('abort', onAbort));
    });
  };
}
