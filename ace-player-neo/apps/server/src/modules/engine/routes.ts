/* Rutas del módulo `engine`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - GET /api/engine/status
   - POST /api/restart-engine

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - engineStatus: GET /api/v1/engine/status
   - engineRestart: POST /api/v1/engine/restart

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.engine.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.engine.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'GET /api/engine/status',
  'POST /api/restart-engine',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['engineStatus', 'engineRestart'];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
