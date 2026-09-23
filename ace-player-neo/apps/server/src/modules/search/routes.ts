/* Rutas del módulo `search`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.20):
   - GET /api/search?q=… → `{ query, results }` (server.js:4941-4947):
     400 `empty_query`, 400 `ace_timeout`, 503 `engine_unavailable`,
     502 `engine_bad_response`.

   v1 (tabla de @ace/shared/routes.ts):
   - search: GET /api/v1/search?q=… → la misma respuesta; los errores con su
     HTTP de v1 (504 `ace_timeout`). */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/search'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['search'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  /* server.js:4943: `searchParams.get("q") || ""`. */
  router.handle('GET', '/api/search', (req, ctx) =>
    services.search.search(req.query.get('q') || '', { signal: ctx.signal }),
  );
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('search', (input, ctx) =>
    services.search.search(input.query.q, { signal: ctx.signal }),
  );
}
