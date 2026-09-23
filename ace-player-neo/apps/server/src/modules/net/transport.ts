/* Transporte y resolución de producción del cliente saliente.

   - `systemResolver`: `dns.promises.lookup` con todas las direcciones en el
     orden del sistema (server.js:1316: `{ all: true, verbatim: true }`).
   - `nodeTransport`: UNA petición GET con `node:http`/`node:https`
     (server.js:1370-1377). La conexión usa `pinnedLookup`: va a las
     direcciones ya comprobadas y a ninguna otra. `agent: false` crea un
     agente por petición, así que ningún socket de otra comprobación se
     reutiliza. No sigue redirecciones ni mira el cuerpo: eso lo hace el
     cliente (client.ts), que también lleva los plazos con el reloj
     inyectado; aquí solo se corta la conexión cuando la señal se aborta. */

import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { pinnedLookup } from './ssrf.js';
import type { NetResolver, NetTransport, ResolvedAddress } from './types.js';

export const systemResolver: NetResolver = {
  async lookup(hostname) {
    const entries = await dns.lookup(hostname, { all: true, order: 'verbatim' });
    return entries.map((entry): ResolvedAddress => ({
      address: entry.address,
      family: isIP(entry.address) === 6 ? 6 : 4,
    }));
  },
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

export const nodeTransport: NetTransport = (request) =>
  new Promise((resolve, reject) => {
    const client = request.url.protocol === 'https:' ? https : http;
    const req = client.get(
      request.url,
      {
        agent: false,
        lookup: pinnedLookup(request.addresses) as unknown as http.RequestOptions['lookup'],
        headers: { ...request.headers },
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
        });
      },
    );
    const onAbort = (): void => {
      req.destroy(abortReason(request.signal));
    };
    if (request.signal.aborted) onAbort();
    else request.signal.addEventListener('abort', onAbort, { once: true });
    req.on('error', reject);
    req.on('close', () => request.signal.removeEventListener('abort', onAbort));
  });
