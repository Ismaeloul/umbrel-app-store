/* Rutas de la Guía TV (docs/iptv.md §20.6). Las registra routes.ts del
   módulo `iptv` (son de su tabla), pero viven aparte para no mezclarse con
   las de Ajustes → IPTV y Películas y series.

   - iptvGuide:           GET /api/v1/iptv/guide
   - iptvGuideProgrammes: GET /api/v1/iptv/guide/programmes (con la `v` buena,
     caché de un día: el trozo de una guía no cambia nunca)
   - iptvGuideProgramme:  GET /api/v1/iptv/guide/programmes/:id
   - iptvGuideNow:        GET /api/v1/iptv/guide/now
   - iptvGuideArt:        GET /api/v1/iptv/guide/art/:ref (la imagen o el 304)

   Todas `access: 'web'`. Sin `tvGuide` en el servicio (dobles de los tests),
   `guide_unavailable`. */

import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { AppError, isAppError } from '../../core/errors.js';
import type { RequestContext } from '../../core/module.js';
import type { V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import type { GuideApi } from './guide-api.js';
import type { GuideArtReply } from './guide-art.js';

/** Ids de /api/v1 de la Guía TV (van en `V1_ROUTE_IDS` de routes.ts). */
export const GUIDE_ROUTE_IDS = [
  'iptvGuide',
  'iptvGuideProgrammes',
  'iptvGuideProgramme',
  'iptvGuideNow',
  'iptvGuideArt',
] as const;

const SLICE_CACHE = 'private, max-age=86400, immutable';

export function registerGuideRoutes(router: V1Router, services: Services): void {
  const guide = (): GuideApi => {
    const api = services.iptv.tvGuide;
    if (!api) throw new AppError('guide_unavailable', { detail: 'sin Guía TV en el servicio' });
    return api;
  };
  router.handle('iptvGuide', (input) => guide().channels(input.query));
  router.handle('iptvGuideProgrammes', (input, ctx) => {
    const result = guide().programmes(input.query);
    ctx.reply.header('cache-control', SLICE_CACHE);
    return result;
  });
  router.handle('iptvGuideProgramme', (input, ctx) => {
    const result = guide().programme(input.params.id, input.query.v);
    ctx.reply.header('cache-control', SLICE_CACHE);
    return result;
  });
  router.handle('iptvGuideNow', (input) => guide().now(input.query));
  router.handle('iptvGuideArt', async (input, ctx) => {
    let reply: GuideArtReply;
    try {
      reply = await guide().art(input.params.ref, input.query.v, ifNoneMatchOf(ctx));
    } catch (error) {
      /* La cola de imágenes llena: 503 con `Retry-After`. */
      if (isAppError(error) && error.code === 'guide_busy') ctx.reply.header('retry-after', '2');
      throw error;
    }
    await sendImage(ctx.reply, reply);
  });
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

async function sendImage(reply: FastifyReply, image: GuideArtReply): Promise<void> {
  if (image.status === 304) void reply.code(304).headers(image.headers).send();
  else void reply.code(200).headers(image.headers).send(image.body);
  await settle(reply);
}
