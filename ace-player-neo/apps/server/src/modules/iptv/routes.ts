/* Rutas del módulo `iptv` (docs/iptv.md §5.3).

   Antiguas: ninguna (módulo nuevo).

   v1 (tabla de @ace/shared/routes.ts; todas `access: 'web'`, así que desde
   /native app.ts ya responde 403 `origin_forbidden`):
   - iptvGet:    GET    /api/v1/iptv
   - iptvSave:   PUT    /api/v1/iptv
   - iptvUpdate: PATCH  /api/v1/iptv
   - iptvSync:   POST   /api/v1/iptv/sync
   - iptvDelete: DELETE /api/v1/iptv
   - iptvChannels: GET  /api/v1/iptv/channels?q= (el buscador, docs/iptv.md
     §14.2; sin IPTV activa, 200 con la lista vacía)
   - iptvBrowse: GET    /api/v1/iptv/browse (la pestaña IPTV de Canales,
     docs/iptv.md §16.2; sin IPTV activa, 200 con `active: false`)
   - vodHome, vodBrowse, vodTitle, vodArt y vodProgress: Películas y series
     (docs/vod.md §11.1). De momento, esqueleto del contrato (VOD-1): 501
     `not_implemented` hasta que llegue el catálogo (VOD-2, §16).
   Ni el cuerpo ni la respuesta se registran: el cuerpo de iptvSave lleva
   credenciales (docs/iptv.md §2.4) y la consulta del buscador, de la
   pestaña y de vodBrowse es lo que escribe Isma. */

import { notImplemented } from '../../core/errors.js';
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
  'iptvChannels',
  'iptvBrowse',
  'vodHome',
  'vodBrowse',
  'vodTitle',
  'vodArt',
  'vodProgress',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('iptvGet', () => services.iptv.view());
  router.handle('iptvSave', (input, ctx) => services.iptv.save(input.body, ctx.signal));
  router.handle('iptvUpdate', (input) => services.iptv.update(input.body));
  router.handle('iptvSync', () => services.iptv.sync());
  router.handle('iptvDelete', () => services.iptv.remove());
  router.handle('iptvChannels', (input) =>
    services.iptv.searchChannels(input.query.q, input.query.limit),
  );
  router.handle('iptvBrowse', (input) => services.iptv.browse(input.query));
  /* Películas y series (docs/vod.md): el catálogo llega con VOD-2. */
  router.handle('vodHome', () => {
    throw notImplemented('vodHome (docs/vod.md §6.4)');
  });
  router.handle('vodBrowse', () => {
    throw notImplemented('vodBrowse (docs/vod.md §6)');
  });
  router.handle('vodTitle', () => {
    throw notImplemented('vodTitle (docs/vod.md §7)');
  });
  router.handle('vodArt', () => {
    throw notImplemented('vodArt (docs/vod.md §8)');
  });
  router.handle('vodProgress', () => {
    throw notImplemented('vodProgress (docs/vod.md §10)');
  });
}
