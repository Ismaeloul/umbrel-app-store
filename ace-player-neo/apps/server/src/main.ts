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
import { LOG_CLEAN_STOP_MSG, SHUTDOWN_TIMINGS } from '@ace/shared';
import { buildApp } from './app.js';
import { loadConfig, type Env } from './config/index.js';
import { createDomainBus } from './core/bus.js';
import { createSystemClock, type Clock } from './core/clock.js';
import { createLogger, createLogRing, logRingOf, logStoreOf, type Logger } from './core/logger.js';
import {
  HEARTBEAT_MS,
  attachLogStore,
  logBootLines,
  logHeartbeat,
  openLogStore,
} from './modules/diagnostics/logs.js';
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
  const clock = options.clock ?? createSystemClock();
  /* «Descargar logs» (0.9.0): el registro en disco de unos 45 días, en
     <DATA_DIR>/v2/registro/ (core/log-store.ts). Sobrevive a reinicios y
     actualizaciones; lo que llega antes de start() se escribe al arrancar. */
  const store = options.logger ? null : openLogStore(config, clock);
  /* Con anillo: las últimas líneas van también al fichero de «Descargar fallos». */
  const logger =
    options.logger ??
    createLogger({
      level: config.logLevel,
      base: { version: config.appVersion },
      ring: createLogRing(),
      ...(store ? { store } : {}),
    });
  const boot = store ? await store.start() : null;
  for (const warning of warnings) logger.warn(warning);
  /* «arranque»: versión, entorno y cómo terminó el anterior (y si cambió la versión). */
  logBootLines(logger, config, boot);

  const bus = createDomainBus({ logger });
  const services = createServices({ config, clock, logger, bus });
  /* El anillo guarda cada línea ya tapada con los secretos de la IPTV de ese
     momento: si luego se cambia o se borra el proveedor, sigue tapada. El
     registro en disco, igual, y además apunta cada fallo del registro de
     fallos con su canal (modules/diagnostics/logs.ts). */
  logRingOf(logger)?.setScrubber((line) => services.iptv.redact(line));
  const detachLog = store ? attachLogStore(services, store) : null;
  await startServices(services);

  const app = await buildApp({ services });
  if (options.listen === false) await app.ready();
  else await app.listen({ host: config.host, port: config.port });
  const startupMs = Math.round(performance.now() - startedAt);
  logger.info({ port: config.port, startupMs }, 'escuchando');
  /* Cada 6 h, memoria y sesiones: dentro de un mes se ve si algo fue a más. */
  const heartbeat = clock.setInterval(() => logHeartbeat(services), HEARTBEAT_MS, { unref: true });

  let stopping: Promise<void> | null = null;
  return {
    app,
    services,
    startupMs,
    stop() {
      stopping ??= (async () => {
        await stopServices(services, app);
        clock.clearInterval(heartbeat);
        detachLog?.();
        /* La última línea: el próximo arranque sabe que este terminó bien. */
        logger.info({ uptimeSeconds: Math.round(process.uptime()) }, LOG_CLEAN_STOP_MSG);
        await store?.close();
      })();
      return stopping;
    },
  };
}

/**
 * Lo que `main` necesita del proceso. Es `process` en producción; en los
 * tests, un EventEmitter con `exit` falso (así se prueba sin matar Vitest).
 */
export interface ProcessHooks {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): void;
  readonly send?: unknown;
}

export interface ProcessHandlerDeps {
  readonly logger: Logger;
  readonly clock: Clock;
  /** Apagado limpio (el `stop` de `startServer`). */
  readonly stop: () => Promise<void>;
  /** Escribe ya en el disco lo pendiente del registro (un proceso que se cae o sale a la fuerza). */
  readonly flushLogs?: () => void;
}

/**
 * Enganches del proceso (T-111, B-028, B-247; server.js:5162-5176). Va aparte
 * de `main` para poder probarlo: en la 0.6.59 el test T-111 solo buscaba el
 * texto `process.on("unhandledRejection"` en el fuente.
 * - una promesa rechazada sin capturar se anota y el servidor sigue;
 * - SIGTERM/SIGINT (o `shutdown` por IPC) apagan una sola vez, salen con 0 si
 *   todo fue bien y con 1 si algo falló o si a los 5 s no ha terminado.
 */
export function installProcessHandlers(proc: ProcessHooks, deps: ProcessHandlerDeps): void {
  const { logger, clock } = deps;

  /* Una promesa rechazada sin capturar no debe tumbar el servidor entero (server.js:5162). */
  proc.on('unhandledRejection', (reason: unknown) => {
    logger.error({ err: reason }, 'promesa rechazada sin capturar');
  });

  /* Una excepción sin capturar sí tumba el proceso (Docker lo levanta otra
     vez): antes de irse, la causa queda en el registro en disco («Descargar
     logs»). `uncaughtExceptionMonitor` no cambia lo que hace Node después. */
  proc.on('uncaughtExceptionMonitor', (error: unknown, origin: unknown) => {
    try {
      logger.fatal({ err: error, origin }, 'el servidor se cae: excepción sin capturar');
      deps.flushLogs?.();
    } catch {
      // Lo que sea antes que tapar la caída de verdad.
    }
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'apagando');
    clock.setTimeout(
      () => {
        logger.error('el apagado no terminó a tiempo: salida forzada');
        deps.flushLogs?.();
        proc.exit(1);
      },
      SHUTDOWN_TIMINGS.forceExitMs,
      { unref: true },
    );
    deps.stop().then(
      () => proc.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'apagado con errores');
        proc.exit(1);
      },
    );
  };
  proc.once('SIGTERM', () => shutdown('SIGTERM'));
  proc.once('SIGINT', () => shutdown('SIGINT'));
  if (typeof proc.send === 'function') {
    proc.on('message', (message: unknown) => {
      if (message === 'shutdown') shutdown('ipc');
    });
  }
}

export async function main(): Promise<void> {
  /* `node server.js --iptv-ensayo`: el ensayo de la IPTV (docs/iptv.md §9.2), sin arrancar el servidor. */
  if (process.argv.includes('--iptv-ensayo')) {
    const { runIptvEnsayo } = await import('./modules/iptv/ensayo.js');
    process.exitCode = await runIptvEnsayo({
      env: process.env,
      print: (line) => process.stdout.write(`${line}\n`),
    });
    return;
  }
  const server = await startServer();
  const { logger, clock } = server.services;
  installProcessHandlers(process, {
    logger,
    clock,
    stop: () => server.stop(),
    flushLogs: () => logStoreOf(logger)?.flushSync(),
  });
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
