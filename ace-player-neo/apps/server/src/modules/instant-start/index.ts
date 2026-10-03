/* Fábrica del módulo `instant-start` («Arranque instantáneo», D24). Las
   reglas puras están en plan.ts y el planificador en service.ts. */

import { createInstantStartRuntime } from './service.js';
import type { InstantStartDeps, InstantStartService } from './types.js';

export type * from './types.js';

export function createInstantStartService(deps: InstantStartDeps): InstantStartService {
  return createInstantStartRuntime(deps);
}
