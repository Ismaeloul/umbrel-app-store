/* Fábrica del módulo `football` (agenda, marcadores, resolución, IA y precalentado).

   La implementación vive en service.ts (estado por instancia y enchufes con
   los demás módulos); la lógica portada de la 0.6.59, en agenda-sources.ts
   (futbolenlatv, EPG, TheSportsDB y demo), programming.ts (catálogo de
   programación), scores.ts (ESPN), ai.ts (Ollama y LRU de vectores),
   resolution.ts, preheat.ts y bindings.ts. El orden final de candidatos es
   el de sources (`mergeResolutionCandidates`), y el emparejado de nombres,
   el de @ace/shared. */

import { FootballServiceImpl } from './service.js';
import type { FootballDeps, FootballService } from './types.js';

export type * from './types.js';
export { FootballServiceImpl } from './service.js';
/* Parecido de nombres de equipo (scores.ts) y base de TheSportsDB: los usa
   `teams` para elegir el candidato y pedir escudos. */
export { canonicalTeam, teamSimilarity } from './scores.js';
export { THESPORTSDB_BASE } from './constants.js';
/* La puntuación de la resolución: la IPTV la recibe para su buscador, la
   búsqueda inversa y el re-emparejado (docs/iptv.md §14.3). */
export { scoreResolutionCandidate } from './resolution.js';

export function createFootballService(deps: FootballDeps): FootballService {
  return new FootballServiceImpl(deps);
}
