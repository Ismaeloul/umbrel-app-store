/* Fábrica del módulo `diagnostics` (registro de fallos por causa,
   arquitectura §5.14). La implementación está en service.ts;
   `createDiagnostics(deps, options)` deja a los tests bajar el tamaño de
   rotación y los límites sin cambiar la firma de esta fábrica. */

import { createDiagnostics } from './service.js';
import type { DiagnosticsDeps, DiagnosticsService } from './types.js';

export type * from './types.js';
export {
  CLIENT_REPORTS_PER_MINUTE,
  DEFAULT_LIST_LIMIT,
  TOTAL_REPORTS_PER_MINUTE,
  createDiagnostics,
  toShortCode,
} from './service.js';

export function createDiagnosticsService(deps: DiagnosticsDeps): DiagnosticsService {
  return createDiagnostics(deps);
}
