/* Rutas del módulo `scanner`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - GET /api/football/scan

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - footballScan: GET /api/v1/football/scans/:id

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.scanner.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.scanner.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/football/scan'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['footballScan'];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
