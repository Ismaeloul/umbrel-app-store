/* Rutas del módulo `iptv` (docs/iptv.md §5.3).

   Antiguas: ninguna (módulo nuevo).

   v1 (tabla de @ace/shared/routes.ts; todas `access: 'web'`, así que desde
   /native app.ts ya responde 403 `origin_forbidden`):
   - iptvGet:    GET    /api/v1/iptv
   - iptvSave:   PUT    /api/v1/iptv
   - iptvUpdate: PATCH  /api/v1/iptv
   - iptvSync:   POST   /api/v1/iptv/sync
   - iptvDelete: DELETE /api/v1/iptv
   Ni el cuerpo ni la respuesta se registran: el cuerpo de iptvSave lleva
   credenciales (docs/iptv.md §2.4). */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (ninguna). */
export const LEGACY_ROUTES: readonly string[] = [];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'iptvGet',
  'iptvSave',
  'iptvUpdate',
  'iptvSync',
  'iptvDelete',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('iptvGet', () => services.iptv.view());
  router.handle('iptvSave', (input, ctx) => services.iptv.save(input.body, ctx.signal));
  router.handle('iptvUpdate', (input) => services.iptv.update(input.body));
  router.handle('iptvSync', () => services.iptv.sync());
  router.handle('iptvDelete', () => services.iptv.remove());
}
