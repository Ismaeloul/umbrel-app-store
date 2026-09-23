/* Fábrica del módulo `engine` (cliente del motor principal, reinicio y
   vigilante; arquitectura §5.5). La implementación está en service.ts
   (cliente en client.ts, vigilante en watchdog.ts, engine_control en
   control.ts). */

import { createEngineRuntime } from './service.js';
import type { EngineDeps, EngineService } from './types.js';

export type * from './types.js';

export function createEngineService(deps: EngineDeps): EngineService {
  return createEngineRuntime(deps).service;
}
