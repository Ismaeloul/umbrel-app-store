/* Montaje del módulo `engine`: cliente del motor principal + vigilante +
   reinicio vía engine_control (arquitectura §5.5).

   `createEngineRuntime` devuelve además las piezas internas (el vigilante y
   el cliente con `probeVersion`) para los tests; el resto del backend solo ve
   `EngineService` (index.ts). No hace nada de red ni programa temporizadores
   hasta `start()`: `createServices()` se llama en cada test. */

import type { CoreDeps } from '../../core/module.js';
import { createEngineClient, type VersionProbe } from './client.js';
import { requestEngineRestart } from './control.js';
import { hostForUrl } from './paths.js';
import type { EngineClient, EngineService } from './types.js';
import { EngineWatchdog } from './watchdog.js';

export interface EngineRuntime {
  readonly service: EngineService;
  readonly watchdog: EngineWatchdog;
  readonly client: EngineClient & { probeVersion(signal?: AbortSignal): Promise<VersionProbe> };
}

/** `http://<ACESTREAM_HOST>:6878` (server.js:2816-2818). */
export function engineBaseUrl(deps: CoreDeps): string {
  return `http://${hostForUrl(deps.config.engine.host)}:${deps.config.engine.port}`;
}

export function createEngineRuntime(deps: CoreDeps): EngineRuntime {
  const { config, clock, logger, bus } = deps;
  const log = logger.child({ module: 'engine' });

  /* El vigilante se crea después del cliente, pero el cliente le cuenta lo
     que ve de las estadísticas: referencia diferida. */
  let watchdogRef: EngineWatchdog | null = null;
  const client = createEngineClient({
    clock,
    logger: log,
    bus,
    baseUrl: engineBaseUrl(deps),
    observer: {
      onStat: (key, stat) => watchdogRef?.noteStat(key, stat),
      onStatTimeout: (key) => watchdogRef?.noteStatTimeout(key),
    },
  });

  const watchdog = new EngineWatchdog({
    clock,
    bus,
    logger: log,
    probe: (signal) => client.probeVersion(signal),
    restart: () => requestEngineRestart(config, clock),
  });
  watchdogRef = watchdog;

  const service: EngineService = {
    async start() {
      watchdog.start();
    },
    stop: () => watchdog.stop(),
    client: () => client,
    status: () => watchdog.status(),
    legacyStatus: () => watchdog.legacyStatus(),
    restartManual: () => watchdog.restartManual(),
    waitUntilReady: (signal) => watchdog.waitUntilReady(signal),
    reportOpenFailure: () => watchdog.reportOpenFailure(),
    reportOpenSuccess: () => watchdog.reportOpenSuccess(),
  };

  return { service, watchdog, client };
}
