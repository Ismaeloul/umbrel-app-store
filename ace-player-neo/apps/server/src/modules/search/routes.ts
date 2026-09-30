/* Rutas del módulo `search`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.20):
   - GET /api/search?q=… → `{ query, results }` (server.js:4941-4947):
     400 `empty_query`, 400 `ace_timeout`, 503 `engine_unavailable`,
     502 `engine_bad_response`.

   v1 (tabla de @ace/shared/routes.ts):
   - search: GET /api/v1/search?q=… → la misma respuesta; los errores con su
     HTTP de v1 (504 `ace_timeout`). Los resultados van por parecido con la
     consulta (`rankForQuery`) y, con IPTV activa, cada resultado que es un
     canal de tu IPTV lleva su id en `iptv` (docs/iptv.md §14.3). La ruta
     antigua no cambia: ni orden por parecido ni `iptv`. */

import type { SearchResult } from '@ace/shared';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { searchRelevanceFor } from '../iptv/index.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/search'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['search'];

/**
 * Ordena los resultados del motor por parecido con la consulta
 * (docs/diagnostico-iptv-0.8.2.md, E2), con la limpieza y la grafía del
 * buscador de la IPTV («m+ laliga» es «M. LALIGA», sin lo que va tras
 * «-->»): igual → misma familia → empieza por la consulta → todas las
 * palabras → el resto. Dentro de cada nivel, por disponibilidad (el orden que
 * trae), con los de disponibilidad 0 o sin ella al final. Solo v1:
 * `parseAceSearchResults` y la ruta antigua no cambian (la resolución y el
 * contraste con la 0.6.59 cuentan con su orden).
 */
export function rankForQuery(results: readonly SearchResult[], query: string): SearchResult[] {
  const relevance = searchRelevanceFor(query);
  return results
    .map((result, position) => ({
      result,
      position,
      tier: relevance(result.title),
      dead: (result.availability ?? 0) > 0 ? 0 : 1,
    }))
    .sort((a, b) => a.tier - b.tier || a.dead - b.dead || a.position - b.position)
    .map((item) => item.result);
}

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  /* server.js:4943: `searchParams.get("q") || ""`. */
  router.handle('GET', '/api/search', (req, ctx) =>
    services.search.search(req.query.get('q') || '', { signal: ctx.signal }),
  );
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('search', async (input, ctx) => {
    const found = await services.search.search(input.query.q, { signal: ctx.signal });
    const response = { ...found, results: rankForQuery(found.results, found.query) };
    const iptv = services.iptv;
    if (!iptv?.active()) return response;
    return { ...response, results: iptv.annotateSearch(response.results) };
  });
}
