/* Exportaciones de server.js (0.6.59) que corresponden al módulo `health`,
   con los mismos nombres (comportamientos-tests.md §3.1-3.2). */

import type { LegacyHealthResponse } from '@ace/shared';
import { boundHealthService } from './legacy-binding.js';

/**
 * `systemHealth` (server.js:4612): la forma de /api/health. Necesita un
 * servicio enlazado con `bindLegacyHealth()` (legacy-binding.ts).
 */
export async function systemHealth(): Promise<LegacyHealthResponse> {
  return boundHealthService('systemHealth').legacyHealth();
}
