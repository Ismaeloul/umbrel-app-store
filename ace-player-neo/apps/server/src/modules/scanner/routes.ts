/* Rutas del módulo `scanner`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.10):
   - GET /api/football/scan?id=<24 hex> → `{ success: true, …ScanJob }`;
     404 `scan_not_found` si el id no tiene el formato o ya no existe
     (server.js:4761-4766).

   v1 (tabla de @ace/shared/routes.ts):
   - footballScan: GET /api/v1/football/scans/:id → ScanJob sin `success`. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/football/scan'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['footballScan'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/football/scan', (req) => ({
    success: true,
    ...services.scanner.job(req.query.get('id') ?? ''),
  }));
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('footballScan', (input) =>
    services.scanner.job(input.params.id, { playableOn: true }),
  );
}
