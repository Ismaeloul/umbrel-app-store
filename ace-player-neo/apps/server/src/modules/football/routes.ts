/* Rutas del módulo `football`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - POST /api/football/bind
   - GET /api/football/preheat
   - GET /api/football/resolve
   - GET /api/scores
   - GET /api/football

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - footballSchedule: GET /api/v1/football
   - footballResolve: GET /api/v1/football/resolve
   - footballPreheat: GET /api/v1/football/preheat/:matchId
   - footballBind: POST /api/v1/football/bindings
   - scores: GET /api/v1/scores

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.football.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.football.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/football/bind',
  'GET /api/football/preheat',
  'GET /api/football/resolve',
  'GET /api/scores',
  'GET /api/football',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'footballSchedule',
  'footballResolve',
  'footballPreheat',
  'footballBind',
  'scores',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
