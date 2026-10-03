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
     (docs/vod.md §11.1), en `vod/vod-service.ts`. `vodArt` manda la imagen
     (o el 304) por su cuenta, con `nosniff` y `default-src 'none'`.
   Ni el cuerpo ni la respuesta se registran: el cuerpo de iptvSave lleva
   credenciales (docs/iptv.md §2.4) y la consulta del buscador, de la
   pestaña y de vodBrowse es lo que escribe Isma. */

import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { AppError, isAppError } from '../../core/errors.js';
import type { RequestContext } from '../../core/module.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import type { VodApi } from './types.js';
import type { ArtReply } from './vod/art.js';

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
  /* Películas y series (docs/vod.md §11.1). Sin VOD en el servicio (dobles de tests), `vod_unavailable`. */
  const vod = (): VodApi => {
    const api = services.iptv.vod;
    if (!api) throw new AppError('vod_unavailable', { detail: 'sin servicio VOD' });
    return api;
  };
  router.handle('vodHome', () => vod().home());
  router.handle('vodBrowse', (input) => vod().browse(input.query));
  router.handle('vodTitle', (input) =>
    vod().title(input.params.id, { pre: input.query.pre === '1' }),
  );
  router.handle('vodArt', async (input, ctx) => {
    let reply: ArtReply;
    try {
      reply = await vod().artOf(
        input.params.id,
        input.params.art,
        input.query.v,
        ifNoneMatchOf(ctx),
      );
    } catch (error) {
      /* La cola de carteles llena (§8): 503 con `Retry-After`. */
      if (isAppError(error) && error.code === 'vod_unavailable') ctx.reply.header('retry-after', '2');
      throw error;
    }
    await sendArt(ctx.reply, reply);
  });
  router.handle('vodProgress', (input) => vod().progress(input.params.id, input.body));
}

/** `If-None-Match` de la petición (la primera si viniera repetida). */
function ifNoneMatchOf(ctx: RequestContext): string | undefined {
  const value = ctx.request.headers['if-none-match'];
  return Array.isArray(value) ? value[0] : value;
}

/* Espera a que la respuesta haya salido del todo (el hook onSend es
   asíncrono: justo después de `send()` `reply.sent` aún es false). */
function settle(reply: FastifyReply): Promise<void> {
  return new Promise((resolve) => {
    finished(reply.raw, () => {
      if (!reply.sent) reply.hijack();
      resolve();
    });
  });
}

/** Manda una imagen de `vodArt` (o su 304) con las cabeceras de §8. */
async function sendArt(reply: FastifyReply, art: ArtReply): Promise<void> {
  if (art.status === 304) void reply.code(304).headers(art.headers).send();
  else void reply.code(200).headers(art.headers).send(art.body);
  await settle(reply);
}
