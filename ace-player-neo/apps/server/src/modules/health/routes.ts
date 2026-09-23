/* Rutas del módulo `health`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.17):
   - GET /api/health (server.js:4750-4753 → systemHealth)

   v1 (tabla de @ace/shared/routes.ts):
   - ping: GET /api/v1/ping (vivo y versión, sin datos; sin token desde /native)
   - health: GET /api/v1/health (panel de salud)
   - healthLive: GET /api/v1/health/live (healthcheck de Docker, sin red ni disco) */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = ['GET /api/health'];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['ping', 'health', 'healthLive'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/health', () => services.health.legacyHealth());
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('ping', () => services.health.ping());
  router.handle('health', () => services.health.health());
  router.handle('healthLive', () => services.health.live());
}
