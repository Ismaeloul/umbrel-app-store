/* Rutas del módulo `engine`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.18-4.19):
   - GET /api/engine/status → `{ online, raw }` (server.js:4949-4953). Sale de
     la caché del vigilante en vez de preguntar al motor en cada petición: ya
     no hay 500 ni 400 `ace_timeout` con el motor caído, sino
     `{ online: false }` (docs/cobertura/engine.md, cambios para compat.md).
   - POST /api/restart-engine → `{ restarted: true }` (server.js:4955-4958);
     429 `restart_cooldown`, 502 `restart_failed`.

   v1 (tabla de @ace/shared/routes.ts):
   - engineStatus: GET /api/v1/engine/status → `EngineStatus` con histéresis.
   - engineRestart: POST /api/v1/engine/restart → `{ restarted: true }`. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'GET /api/engine/status',
  'POST /api/restart-engine',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['engineStatus', 'engineRestart'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/engine/status', () => services.engine.legacyStatus());
  /* El cuerpo no se lee (api.md §4.19). */
  router.handle('POST', '/api/restart-engine', () => services.engine.restartManual());
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('engineStatus', () => services.engine.status());
  router.handle('engineRestart', () => services.engine.restartManual());
}
