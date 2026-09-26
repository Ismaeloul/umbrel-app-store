/* Fábrica del módulo `net` (cliente saliente a internet con protección anti-SSRF,
   arquitectura §5.11).

   `createNetClient(deps)` junta el filtro (ssrf.ts), el bucle de descarga
   (client.ts) y el transporte (transport.ts). DNS y conexiones son
   inyectables (`deps.resolver`, `deps.transport`) para que los tests no
   toquen ni DNS ni red; sin ellos, los del sistema. */

import { TIMEOUTS } from '@ace/shared';
import { createFetcher, NetBadResponseError, type FetchBytesOptions } from './client.js';
import { hostIsLan, isPrivateAddress, isPrivateHostname } from './ssrf.js';
import { nodeTransport, systemResolver } from './transport.js';
import type { FetchOptions, FetchedResponse, NetClient, NetDeps } from './types.js';

export type * from './types.js';
export { NetBadResponseError } from './client.js';

export function createNetClient(deps: NetDeps): NetClient {
  const resolver = deps.resolver ?? systemResolver;
  const { fetchBytes, openStream } = createFetcher({
    clock: deps.clock,
    resolver,
    transport: deps.transport ?? nodeTransport,
    allowPrivateUrls: deps.config.sync.allowPrivateUrls,
    userAgent: `AcePlayerNeo/${deps.config.appVersion}`,
  });

  const toBytesOptions = (options: FetchOptions = {}): FetchBytesOptions => ({
    deadline: deps.clock.now() + (options.totalTimeoutMs ?? TIMEOUTS.directoryTotalMs),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.accept === undefined ? {} : { accept: options.accept }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.iptv === undefined ? {} : { iptv: options.iptv }),
  });

  const fetchBuffer = (url: string, options?: FetchOptions): Promise<FetchedResponse<Buffer>> =>
    fetchBytes(url, toBytesOptions(options));

  const fetchText = async (
    url: string,
    options?: FetchOptions,
  ): Promise<FetchedResponse<string>> => {
    const response = await fetchBuffer(url, options);
    return { ...response, body: response.body.toString('utf8') };
  };

  return {
    openStream,
    hostIsLan: (hostname) => hostIsLan(hostname, resolver),
    fetchBuffer,
    fetchText,
    async fetchJson(url, options) {
      const response = await fetchText(url, options);
      let body: unknown;
      try {
        body = JSON.parse(response.body);
      } catch (error) {
        throw new NetBadResponseError(error);
      }
      return { ...response, body };
    },
    isPrivateAddress: (ip) => isPrivateAddress(ip),
    isPrivateHostname: (hostname) => isPrivateHostname(hostname),
  };
}
