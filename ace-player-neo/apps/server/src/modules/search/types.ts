/* Módulo `search`: el buscador del motor AceStream (arquitectura §5.2 y
   §5.10; backend-modulos §3.17; api.md §4.20; B-209 a B-216).

   `searchAceStreams` + `parseAceSearchResults`: consulta de 2 a 80
   caracteres (espacios colapsados), hasta 100 resultados por disponibilidad,
   todos `ih: true`. Con reproducción activa, las búsquedas de la resolución
   van al motor comprobador en vez de al principal (backend-modulos §9.11);
   el buscador de la pestaña "Buscar" sigue yendo al principal.

   Errores: `empty_query` (400), `ace_timeout`, `engine_unavailable` (503),
   `engine_bad_response` (502).

   Tests a portar: T-030 (B-211), y por la resolución T-021 (B-213), T-067 y
   T-068 (B-214). */

import type { SearchResponse, SearchResult } from '@ace/shared';
import type { CoreDeps } from '../../core/module.js';
import type { EngineService } from '../engine/types.js';
import type { ScannerService } from '../scanner/types.js';

export interface SearchDeps extends CoreDeps {
  readonly engine: EngineService;
  readonly scanner: ScannerService;
}

export interface SearchOptions {
  /** `main` = motor principal (por defecto); `scanner` = comprobador (resolución con reproducción activa). */
  readonly via?: 'main' | 'scanner';
  readonly signal?: AbortSignal;
}

export interface SearchService {
  /** GET /api/search y /api/v1/search. */
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  /**
   * `parseAceSearchResults` (server.js:3599): normaliza resultados planos
   * (`content_id`) y agrupados (`items` con `infohash`), deduplica por id y
   * ordena por disponibilidad. Pura (T-030).
   */
  parseResults(body: string): SearchResult[];
}
