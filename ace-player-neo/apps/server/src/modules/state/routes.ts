/* Rutas del módulo `state`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - POST /api/preferences
   - GET /api/state
   - PUT /api/state
   - POST /api/library

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - bootstrap: GET /api/v1/bootstrap
   - settingsGet: GET /api/v1/settings
   - settingsUpdate: PUT /api/v1/settings
   - libraryGet: GET /api/v1/library
   - libraryMutate: POST /api/v1/library
   - preferencesGet: GET /api/v1/preferences
   - preferencesUpdate: PUT /api/v1/preferences

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.state.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.state.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/preferences',
  'GET /api/state',
  'PUT /api/state',
  'POST /api/library',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'bootstrap',
  'settingsGet',
  'settingsUpdate',
  'libraryGet',
  'libraryMutate',
  'preferencesGet',
  'preferencesUpdate',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
