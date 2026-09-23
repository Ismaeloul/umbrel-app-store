/* Arranque y apagado del backend (arquitectura §5.16; T-111, B-028, B-247).

   Arranque:
   1. `config` (falla si algo de seguridad no vale).
   2. `state`: recuperación y migración; copia `state.pre-0.7.0.json` si no existe.
   3. Vacía `remux/` y para las sesiones que queden en v2/sessions.json.
   4. Arranca vigilante del motor, comprobador, sincronización (si
      AUTO_SYNC), precalentado, reaper y el resto de trabajos de fondo.
   5. `listen` en 0.0.0.0:PORT. El healthcheck de Docker da sano en cuanto
      escucha (/api/v1/health/live).

   SIGTERM/SIGINT (una sola vez, backend-modulos §8.6.29): deja de aceptar,
   cierra los SSE, para las sesiones del motor (4 s), mata ffmpeg y sale;
   salida forzada a los 5 s como hoy (server.js:5165-5176).

   En el esqueleto los servicios lanzan `not_implemented`, así que el
   arranque se queda en el paso 2 con un error claro en el log. */

import { SHUTDOWN_TIMINGS } from '@ace/shared';
import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { createDomainBus } from './core/bus.js';
import { createSystemClock } from './core/clock.js';
import { createLogger, type Logger } from './core/logger.js';
import { SERVICE_ORDER, createServices, type Services } from './services.js';

async function startBackground(services: Services): Promise<void> {
  for (const name of SERVICE_ORDER) {
    const service = services[name] as Partial<{ start(): Promise<void> }>;
    if (typeof service.start === 'function') await service.start();
  }
}

async function stopBackground(services: Services, logger: Logger): Promise<void> {
  for (const name of [...SERVICE_ORDER].reverse()) {
    const service = services[name] as Partial<{ stop(): Promise<void> }>;
    if (typeof service.stop !== 'function') continue;
    try {
      await service.stop();
    } catch (error) {
      logger.warn({ err: error, service: name }, 'no se pudo parar un servicio');
    }
  }
}

export async function main(): Promise<void> {
  const { config, warnings } = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, base: { version: config.appVersion } });
  for (const warning of warnings) logger.warn(warning);

  const clock = createSystemClock();
  const bus = createDomainBus({ logger });
  const services = createServices({ config, clock, logger, bus });

  /* Una promesa rechazada sin capturar no debe tumbar el servidor entero (server.js:5162). */
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'promesa rechazada sin capturar');
  });

  const report = await services.state.load();
  logger.info({ state: report }, 'estado cargado');
  await services.remux.cleanWorkDir();
  await services.playback.recoverOrphans();
  await startBackground(services);

  const app = await buildApp({ services });
  await app.listen({ host: config.host, port: config.port });
  logger.info({ port: config.port }, 'escuchando');

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'apagando');
    clock.setTimeout(() => process.exit(1), SHUTDOWN_TIMINGS.forceExitMs, { unref: true });
    void (async () => {
      services.events.closeAll();
      await services.playback.stopAll(SHUTDOWN_TIMINGS.stopSessionsMs);
      await services.remux.stopAll();
      await stopBackground(services, logger);
      await services.state.flush();
      await app.close();
      process.exit(0);
    })().catch((error: unknown) => {
      logger.error({ err: error }, 'apagado con errores');
      process.exit(1);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

/* Solo si se ejecuta como programa (el bundle de build.mjs o `tsx src/main.ts`),
   no al importarlo desde un test. */
const entry = process.argv[1] ?? '';
if (/(?:^|[\\/])(?:main\.ts|server\.js)$/.test(entry)) {
  main().catch((error: unknown) => {
    console.error('[arranque] no se pudo arrancar el backend:', error);
    process.exit(1);
  });
}
