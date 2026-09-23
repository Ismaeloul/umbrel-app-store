/* Rutas del módulo `sources`.

   Antiguas (forma exacta de la 0.6.59, api.md §4):
   - POST /api/sources/report
   - POST /api/sources/outcome
   - POST /api/sources/feedback

   v1 (tabla de @ace/shared/routes.ts; se registran solas en /api/v1 y
   /native/api/v1 con acceso, validación y errores ya resueltos):
   - sourcesReport: POST /api/v1/sources/report
   - sourcesOutcome: POST /api/v1/sources/outcome
   - sourcesFeedback: POST /api/v1/sources/feedback

   ESQUELETO: todavía no se registra ningún manejador y app.ts responde 501
   `not_implemented` en todas. Para portar una ruta:
     router.handle('GET', '/api/…', (req, ctx) => services.sources.…);   // antiguas
     router.handle('<id>', (input, ctx) => services.sources.…);          // v1
   Ver docs/contratos.md §7. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/sources/report',
  'POST /api/sources/outcome',
  'POST /api/sources/feedback',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'sourcesReport',
  'sourcesOutcome',
  'sourcesFeedback',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(_router: V1Router, _services: Services): void {}
