/* Rutas del módulo `diagnostics`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   (ninguna: la 0.6.59 solo escribía en la consola)

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - diagnosticsList: GET /api/v1/diagnostics?cause=&since=&limit=
   - diagnosticsReport: POST /api/v1/diagnostics (con límite, 429 `rate_limited`) */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['diagnosticsList', 'diagnosticsReport'];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('diagnosticsList', (input) => services.diagnostics.list(input.query));
  router.handle('diagnosticsReport', (input, ctx) =>
    services.diagnostics.report(input.body, { requestId: ctx.requestId, device: ctx.device }),
  );
}
