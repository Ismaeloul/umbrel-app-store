/* Fábrica del módulo `scanner` (comprobador de fuentes con el segundo motor).

   La implementación vive en service.ts (trabajos, cola y veredictos),
   probe.ts (la sonda), transport.ts (HTTP, muestra y ffprobe), evidence.ts
   (funciones puras portadas) y verdicts.ts (caché y máquina de estados). */

import { ScannerServiceImpl } from './service.js';
import type { ScannerDeps, ScannerService } from './types.js';

export type * from './types.js';
export { v1ScanRef } from './jobs.js';

export function createScannerService(deps: ScannerDeps): ScannerService {
  return new ScannerServiceImpl(deps);
}
