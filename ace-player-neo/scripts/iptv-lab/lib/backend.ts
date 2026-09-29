/* Backend del laboratorio IPTV: el MISMO arranque que apps/web/e2e/support/backend.ts
   (y que `startServer` de apps/server/src/main.ts): config desde el entorno,
   servicios, trabajos de fondo y `listen` en `::`. La única diferencia es la
   red saliente: `iptv.ace-e2e.example` (un dominio reservado que se resuelve a
   una IP PÚBLICA, así que el filtro SSRF de la IPTV es el de producción) va al
   proveedor del laboratorio (LAB_PROVIDER_PORT en LAB_LOOPBACK: ::1 o 127.0.0.1).

   Lo lanza lab.ts con tsx y su propio entorno (PORT, DATA_DIR…). El registro
   (pino, JSON) sale por stdout y lab.ts lo guarda en backend.log. */

import { buildApp } from '../../../apps/server/src/app.js';
import { loadConfig } from '../../../apps/server/src/config/index.js';
import { createDomainBus } from '../../../apps/server/src/core/bus.js';
import { createSystemClock } from '../../../apps/server/src/core/clock.js';
import { createLogger } from '../../../apps/server/src/core/logger.js';
import { startServices, stopServices } from '../../../apps/server/src/main.js';
import { createNetClient } from '../../../apps/server/src/modules/net/index.js';
import { createServices } from '../../../apps/server/src/services.js';
import {
  fakeIptvResolver,
  fakeIptvTransport,
} from '../../../apps/server/test/fake-iptv/net.js';

const providerPort = Number(process.env.LAB_PROVIDER_PORT);
if (!providerPort) throw new Error('Falta LAB_PROVIDER_PORT');
/* ::1 como en el E2E (en el PC de Isma 127.0.0.1 corta conexiones) o 127.0.0.1 si no hay IPv6. */
const loop = process.env.LAB_LOOPBACK ?? '::1';

const resolver = fakeIptvResolver({ others: 'real' });
const transport = fakeIptvTransport({ host: loop, port: providerPort }, { others: 'real' });

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
await app.listen({ host: loop === '::1' ? '::' : '0.0.0.0', port: config.port });
logger.info({ port: config.port }, 'backend del laboratorio IPTV escuchando');

let stopping: Promise<void> | null = null;
const stop = (): void => {
  stopping ??= stopServices(services, app).finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message: unknown) => {
  if (message === 'shutdown') stop();
});
