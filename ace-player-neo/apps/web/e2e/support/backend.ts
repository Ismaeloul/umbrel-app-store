/* Backend de las pruebas E2E: el MISMO arranque que `startServer` de
   apps/server/src/main.ts (config desde el entorno, servicios, trabajos de
   fondo y `listen`), con dos diferencias: escucha en `::` (ver abajo) y el
   cliente saliente (`net`)
   resuelve y «descarga» la lista M3U de pruebas (catalogo.ts) sin salir a
   internet. El filtro anti-SSRF sigue entero: la lista va a un dominio
   reservado que se resuelve a una IP pública, y cualquier URL privada se
   bloquea igual que en producción.

   Lo lanza stack.ts con tsx (`node tsx/dist/cli.mjs backend.ts`) y el entorno
   de siempre (PORT, DATA_DIR, ACESTREAM_HOST…). */

import { Readable } from 'node:stream';
import { buildApp } from '../../../server/src/app.js';
import { loadConfig } from '../../../server/src/config/index.js';
import { createDomainBus } from '../../../server/src/core/bus.js';
import { createSystemClock } from '../../../server/src/core/clock.js';
import { createLogger } from '../../../server/src/core/logger.js';
import { startServices, stopServices } from '../../../server/src/main.js';
import { createNetClient } from '../../../server/src/modules/net/index.js';
import { nodeTransport, systemResolver } from '../../../server/src/modules/net/transport.js';
import type { NetResolver, NetTransport } from '../../../server/src/modules/net/types.js';
import { createServices } from '../../../server/src/services.js';
import { LISTA_HOST, LISTA_URL, listaM3u } from './catalogo.ts';

/* Una IP pública cualquiera (no se conecta nunca: el transporte de abajo
   contesta antes). Tiene que ser pública para pasar el filtro anti-SSRF. */
const IP_PUBLICA = '93.184.215.14';

const resolver: NetResolver = {
  lookup(hostname) {
    if (hostname === LISTA_HOST) return Promise.resolve([{ address: IP_PUBLICA, family: 4 }]);
    return systemResolver.lookup(hostname);
  },
};

const LISTA_PATH = new URL(LISTA_URL).pathname;

const transport: NetTransport = (request) => {
  if (request.url.hostname !== LISTA_HOST) return nodeTransport(request);
  if (request.url.pathname !== LISTA_PATH) {
    return Promise.resolve({ status: 404, headers: {}, body: Readable.from([]) });
  }
  const body = Buffer.from(listaM3u(), 'utf8');
  return Promise.resolve({
    status: 200,
    headers: { 'content-type': 'audio/x-mpegurl', 'content-length': String(body.length) },
    body: Readable.from([body]),
  });
};

const { config, warnings } = loadConfig(process.env);
const logger = createLogger({ level: config.logLevel, base: { version: config.appVersion } });
for (const warning of warnings) logger.warn(warning);
const clock = createSystemClock();
const bus = createDomainBus({ logger });
const core = { config, clock, logger, bus };
const services = createServices(core, {
  net: createNetClient({ ...core, resolver, transport }),
});
await startServices(services);
const app = await buildApp({ services });
/* En `::` (doble pila) y no en 0.0.0.0 como en el NAS: así el proxy de Vite
   y los recorridos llegan por ::1, que en el PC de Isma no sufre los cortes
   de 127.0.0.1 (apps/server/test/fake-engine/README.md). Sigue contestando
   también en 127.0.0.1. */
await app.listen({ host: '::', port: config.port });
logger.info({ port: config.port }, 'backend E2E escuchando');

let stopping: Promise<void> | null = null;
const stop = (): void => {
  stopping ??= stopServices(services, app).finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message: unknown) => {
  if (message === 'shutdown') stop();
});
