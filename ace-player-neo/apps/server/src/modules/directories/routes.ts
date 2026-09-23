/* Rutas del módulo `directories`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - POST /api/streams/sync
   - POST /api/streams/activate
   - POST /api/streams/delete

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - directoriesGet: GET /api/v1/directories
   - directoriesSync: POST /api/v1/directories/sync
   - directoriesActivate: POST /api/v1/directories/:id/activate
   - directoriesDelete: DELETE /api/v1/directories/:id

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.directories.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.directories.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/streams/sync',
  'POST /api/streams/activate',
  'POST /api/streams/delete',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'directoriesGet',
  'directoriesSync',
  'directoriesActivate',
  'directoriesDelete',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
