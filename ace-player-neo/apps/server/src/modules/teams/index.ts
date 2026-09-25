/* Fábrica del módulo `teams` (escudos, colores y logos desde TheSportsDB).

   La implementación vive en service.ts (índice en memoria, vuelta de fondo,
   endpoint); normalize.ts (claves, términos de búsqueda y el esquema de las
   correcciones), resolver.ts (TheSportsDB y la elección del candidato),
   png.ts (decodificador propio), colors.ts (color dominante) y store.ts
   (índice y PNG en data/v2/teams). Las correcciones manuales empaquetadas
   están en overrides.json y se validan al cargar el módulo: una entrada mal
   escrita se ve en los tests, no en el NAS. */

import { parseOverrides, type Overrides } from './normalize.js';
import { TeamsServiceImpl } from './service.js';
import type { TeamsDeps, TeamsService } from './types.js';
import overridesJson from './overrides.json' with { type: 'json' };

export type * from './types.js';
export { TeamsServiceImpl } from './service.js';

/** Correcciones manuales empaquetadas (overrides.json), ya validadas. */
export const BUNDLED_OVERRIDES: Overrides = parseOverrides(overridesJson);

export function createTeamsService(deps: TeamsDeps): TeamsService {
  return new TeamsServiceImpl(deps, { overrides: BUNDLED_OVERRIDES });
}
