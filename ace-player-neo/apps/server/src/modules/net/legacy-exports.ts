/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `net`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. Mismas entradas y
   salidas que la 0.6.59, con dos diferencias que van a docs/compat.md:
   - `isPrivateAddress`/`isPrivateHostname` son las ampliadas de la 0.7.0;
   - `fetchText` no lee `ALLOW_PRIVATE_SYNC_URLS` (la v2 no lee el entorno
     fuera de config/): el filtro anti-SSRF va SIEMPRE puesto. El servicio
     (`createNetClient`) sí lo respeta, desde `config.sync.allowPrivateUrls`. */

import { FETCH_MAX_BYTES, TIMEOUTS } from '@ace/shared';
import { createSystemClock } from '../../core/clock.js';
import { createFetcher } from './client.js';
import { nodeTransport, systemResolver } from './transport.js';

export { motivoDeFallo } from '@ace/shared';
export { isPrivateAddress, isPrivateHostname } from './ssrf.js';

/**
 * `fetchText` (server.js:1342): URL, saltos, visitadas, plazo (epoch ms),
 * tope y opciones (`binary` → Buffer, `accept`). T-005, T-116.
 */
export async function fetchText(
  url: string,
  redirects = 0,
  visited: Set<string> = new Set(),
  deadline?: number,
  maxBytes: number = FETCH_MAX_BYTES,
  options: { binary?: boolean; accept?: string } = {},
): Promise<string | Buffer> {
  const clock = createSystemClock();
  const fetchBytes = createFetcher({
    clock,
    resolver: systemResolver,
    transport: nodeTransport,
    allowPrivateUrls: false,
    userAgent: 'AcePlayerNeo/0.6.59',
  });
  const response = await fetchBytes(url, {
    deadline: deadline ?? clock.now() + TIMEOUTS.directoryTotalMs,
    maxBytes,
    redirects,
    visited,
    ...(options.accept ? { accept: options.accept } : {}),
  });
  return options.binary ? response.body : response.body.toString('utf8');
}
