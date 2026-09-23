/* Fábrica del módulo `search` (buscador del motor AceStream). La
   implementación está en service.ts y las funciones puras en parse.ts. */

import { createSearchRuntime } from './service.js';
import type { SearchDeps, SearchService } from './types.js';

export type * from './types.js';

export function createSearchService(deps: SearchDeps): SearchService {
  return createSearchRuntime(deps).service;
}
