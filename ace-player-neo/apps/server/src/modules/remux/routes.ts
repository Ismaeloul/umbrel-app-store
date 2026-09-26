/* Rutas del módulo `remux`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.22-4.23):
   - POST /api/remux/stop → `{success, stopped, detached}` o `{…, stale: true}` (B-222).
   - GET y HEAD /remux/<hash>/<fichero> → el fichero con Range, 206/416 y
     `no-store`; 403 sin cuerpo si la ruta no vale; 404 sin cuerpo si no está
     (T-035, B-221). `ffmpeg.log` ya no existe: el log vive en memoria.

   v1 (tabla de @ace/shared/routes.ts):
   - video: GET /api/v1/video/:sid/:file. Desde native, con `?t=` ya
     comprobado por app.ts: la lista reescrita con `?t=` en cada URI y los
     segmentos con Range. Desde la web (docs/iptv.md §5.4, `access: 'any'`),
     `t` se ignora y la lista sale tal cual. Cada petición cuenta como latido
     del visor. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'POST /api/remux/stop',
  'GET /remux/',
  'HEAD /remux/',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = ['video'];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('POST', '/api/remux/stop', (req) =>
    services.remux.legacyStop(req.body as Record<string, unknown>),
  );
  for (const method of ['GET', 'HEAD'] as const) {
    router.handle(method, '/remux/', async (req, ctx) => {
      await services.remux.serveLegacyFile(ctx.reply, req.url, {
        rangeHeader: ctx.request.headers.range,
        head: method === 'HEAD',
      });
      return undefined;
    });
  }
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('video', async (input, ctx) => {
    await services.remux.serveFile(ctx.reply, input.params.sid, input.params.file, {
      rangeHeader: ctx.request.headers.range,
      /* Solo el token comprobado de /native reescribe la lista; el de la web se ignora. */
      ...(ctx.origin === 'native' && input.query.t ? { videoToken: input.query.t } : {}),
      deviceId: ctx.device?.deviceId ?? null,
    });
  });
}
