/* Arranque y apagado del backend (arquitectura §5.16; T-111, B-028, B-247).

   Arranque (`startServices` + `startServer`):
   1. `config` (falla si algo de seguridad no vale: ACE_SEED corto).
   2. `state`: recuperación y migración; copia `state.pre-0.7.0.json` si no
      existe (lo hace `state.load()`).
   3. Vacía `remux/` y para las sesiones que queden en v2/sessions.json de un
      proceso anterior (`playback.recoverOrphans()`).
   4. Arranca los trabajos de fondo en el orden del grafo (SERVICE_ORDER):
      vigilante del motor, comprobador, sincronización (si AUTO_SYNC),
      recolector del remux, precalentado, disco del diagnóstico…
   5. `listen` en 0.0.0.0:PORT. El healthcheck de Docker da sano en cuanto
      escucha (/api/v1/health/live).

   Apagado (`stopServer`), una sola vez aunque lleguen varias señales
   (backend-modulos §8.6.29): deja de aceptar (Fastify contesta 503 a lo
   nuevo), cierra los SSE, para las sesiones del motor en paralelo (4 s),
   mata ffmpeg, para los trabajos de fondo en orden inverso (el comprobador
   corta sus sondas y su ffprobe), vacía la cola de escritura del estado y
   sale con 0. Salida forzada con 1 a los 5 s, como hoy (server.js:5165-5176).

   SIGTERM/SIGINT en Linux (Docker). En Windows no hay señales POSIX que se
   puedan capturar desde otro proceso: si el proceso tiene canal IPC (lo lanza
   `fork`, como scripts/smoke-bundle.mjs), el mensaje `shutdown` hace el mismo
   apagado. En el NAS no hay canal IPC y esto no hace nada. */

import type { FastifyInstance } from 'fastify';
import { SHUTDOWN_TIMINGS } from '@ace/shared';
import { buildApp } from './app.js';
import { loadConfig, type Env } from './config/index.js';
import { createDomainBus } from './core/bus.js';
import { createSystemClock, type Clock } from './core/clock.js';
import { createLogger, type Logger } from './core/logger.js';
import type { StateLoadReport } from './modules/state/types.js';
import { SERVICE_ORDER, createServices, type Services } from './services.js';

/** Pasos 2 a 4 del arranque. Devuelve lo que pasó al cargar el estado. */
export async function startServices(services: Services): Promise<StateLoadReport> {
  const report = await services.state.load();
  services.logger.info({ state: report }, 'estado cargado');
  await services.remux.cleanWorkDir();
  await services.playback.recoverOrphans();
  for (const name of SERVICE_ORDER) {
    const service = services[name] as Partial<{ start(): Promise<void> }>;
    if (typeof service.start === 'function') await service.start();
  }
  return report;
}

/**
 * Apagado limpio sin salir del proceso (lo usan `main` y los tests). Nunca
 * lanza: un paso que falla se anota y se sigue con el siguiente.
 */
export async function stopServices(services: Services, app?: FastifyInstance): Promise<void> {
  const { logger } = services;
  const step = async (name: string, run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
    } catch (error) {
      logger.warn({ err: error, step: name }, 'apagado: un paso ha fallado');
    }
  };
  /* Deja de aceptar ya; el cierre del servidor HTTP termina cuando se hayan
     ido las conexiones (las SSE se cierran justo después). */
  const closing = app ? app.close() : Promise.resolve();
  closing.catch(() => undefined);
  await step('sse', () => services.events.closeAll());
  await step('sesiones', () => services.playback.stopAll(SHUTDOWN_TIMINGS.stopSessionsMs));
  await step('ffmpeg', () => services.remux.stopAll());
  for (const name of [...SERVICE_ORDER].reverse()) {
    const service = services[name] as Partial<{ stop(): Promise<void> }>;
    if (typeof service.stop === 'function') await step(name, () => service.stop?.());
  }
  await step('estado', () => services.state.flush());
  await step('http', () => closing);
}

export interface RunningServer {
  readonly app: FastifyInstance;
  readonly services: Services;
  /** Milisegundos desde que se empezó a arrancar hasta que escucha. */
  readonly startupMs: number;
  /** Apagado limpio (idempotente). */
  stop(): Promise<void>;
}

export interface StartServerOptions {
  readonly env?: Env;
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** `false` para no escuchar en el puerto (tests con `inject`). */
  readonly listen?: boolean;
}

/** Arranque completo: config, servicios, trabajos de fondo y `listen`. */
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const startedAt = performance.now();
  const { config, warnings } = loadConfig(options.env ?? process.env);
  const logger =
    options.logger ??
    createLogger({ level: config.logLevel, base: { version: config.appVersion } });
  for (const warning of warnings) logger.warn(warning);

  const clock = options.clock ?? createSystemClock();
  const bus = createDomainBus({ logger });
  const services = createServices({ config, clock, logger, bus });
  await startServices(services);

  const app = await buildApp({ services });
  if (options.listen === false) await app.ready();
  else await app.listen({ host: config.host, port: config.port });
  const startupMs = Math.round(performance.now() - startedAt);
  logger.info({ port: config.port, startupMs }, 'escuchando');

  let stopping: Promise<void> | null = null;
  return {
    app,
    services,
    startupMs,
    stop() {
      stopping ??= stopServices(services, app);
      return stopping;
    },
  };
}

export async function main(): Promise<void> {
  const server = await startServer();
  const { logger, clock } = server.services;

  /* Una promesa rechazada sin capturar no debe tumbar el servidor entero (server.js:5162). */
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'promesa rechazada sin capturar');
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'apagando');
    clock.setTimeout(
      () => {
        logger.error('el apagado no terminó a tiempo: salida forzada');
        process.exit(1);
      },
      SHUTDOWN_TIMINGS.forceExitMs,
      { unref: true },
    );
    server.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'apagado con errores');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  if (typeof process.send === 'function') {
    process.on('message', (message) => {
      if (message === 'shutdown') shutdown('ipc');
    });
  }
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
