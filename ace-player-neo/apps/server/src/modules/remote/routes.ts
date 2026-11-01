/* Rutas del módulo `remote` (el dominio de fuera, tv.ismaeloul.es; docs/acceso-remoto.md).

   Antiguas: ninguna.

   v1, todas solo web (`access: 'web'`, detrás del login de Umbrel) y nunca por el dominio
   (`remote: 'deny'`): un iPhone no puede darse permiso a sí mismo ni ver IPs.
   - remoteGet: GET /api/v1/remote
   - remoteUpdate: PUT /api/v1/remote (interruptor general, «Cerrar el dominio ya»)
   - deviceRemoteUpdate: PUT /api/v1/devices/:id/remote
   - remoteBlockDelete: DELETE /api/v1/remote/blocks/:key
   - remoteBlocksClear: DELETE /api/v1/remote/blocks */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

export const LEGACY_ROUTES: readonly string[] = [];

export const V1_ROUTE_IDS: readonly string[] = [
  'remoteGet',
  'remoteUpdate',
  'deviceRemoteUpdate',
  'remoteBlockDelete',
  'remoteBlocksClear',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('remoteGet', () => services.remote.view());
  router.handle('remoteUpdate', (input) => services.remote.setEnabled(input.body.enabled));
  router.handle('deviceRemoteUpdate', (input) =>
    services.remote.setDevice(input.params.id, input.body),
  );
  router.handle('remoteBlockDelete', (input) => services.remote.unblock(input.params.key));
  router.handle('remoteBlocksClear', () => services.remote.unblockAll());
}
