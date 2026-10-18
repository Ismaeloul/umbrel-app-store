/* Fábrica del módulo `party` («Ver juntos», docs/ver-juntos.md, D36). Las
   salas están en service.ts; no programa temporizadores hasta que alguien
   crea una sala. */

import { createPartyRuntime } from './service.js';
import type { PartyDeps, PartyService } from './types.js';

export type * from './types.js';

export function createPartyService(deps: PartyDeps): PartyService {
  return createPartyRuntime(deps);
}
