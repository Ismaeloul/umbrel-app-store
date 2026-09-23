/* Fábrica del módulo `sources` (informes, cuarentenas, correcciones y fiabilidad de las fuentes).

   La implementación vive en service.ts; las funciones puras en stats.ts
   (fiabilidad), ranking.ts (orden y reparto, que usa la resolución de
   football), reports.ts (informes y correcciones) y state-machine.ts (las
   dos máquinas de estados). */

import { SourcesServiceImpl } from './service.js';
import type { SourcesDeps, SourcesService } from './types.js';

export type * from './types.js';
export {
  canalEsGenerico,
  mergeResolutionCandidates,
  repartirEntreProveedores,
  resolutionTier,
} from './ranking.js';

export function createSourcesService(deps: SourcesDeps): SourcesService {
  return new SourcesServiceImpl(deps);
}
