/* Rutas del módulo `playback`.

   Antiguas (forma exacta de la 0.6.59, api.md §4.4-4.6 y §4.21):
   - GET /api/playback → `{nowPlaying, learningCount, serverTime}` (T-115).
   - POST /api/playback/claim y /release → marca monótona y lápidas (T-037, T-038).
   - GET /api/remux → `{url: "/remux/<hash>/index.m3u8", token}` o 400/502/503/504.

   v1 (tabla de @ace/shared/routes.ts):
   - channelStream: GET /api/v1/channels/:id/stream (§6.3).
   - sessionHeartbeat / sessionRelease: POST /api/v1/sessions/:sid/{heartbeat,release}.
   - playbackStatus: GET /api/v1/playback.

   La URL de vídeo de la app nativa se firma AQUÍ con `services.auth`
   (arquitectura §7.1: "firmar t con sid, dispositivo y caducidad"): playback
   no depende de auth (auth se crea después). */

import type { RequestContext } from '../../core/module.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import type { ViewerIdentity } from './types.js';

/** Operaciones antiguas de este módulo (`MÉTODO ruta` como en LEGACY_OPERATIONS). */
export const LEGACY_ROUTES: readonly string[] = [
  'GET /api/playback',
  'POST /api/playback/claim',
  'POST /api/playback/release',
  'GET /api/remux',
];

/** Ids de /api/v1 de este módulo (su `module` en la tabla). */
export const V1_ROUTE_IDS: readonly string[] = [
  'channelStream',
  'sessionHeartbeat',
  'sessionRelease',
  'playbackStatus',
];

export function registerLegacyRoutes(router: LegacyRouter, services: Services): void {
  router.handle('GET', '/api/playback', () => services.playback.legacyStatus());
  router.handle('POST', '/api/playback/claim', (req) =>
    services.playback.legacyClaim(req.body as Record<string, unknown>),
  );
  router.handle('POST', '/api/playback/release', (req) =>
    services.playback.legacyRelease(req.body as Record<string, unknown>),
  );
  router.handle('GET', '/api/remux', (req, ctx) =>
    services.playback.legacyRemux(req.query, ctx.signal),
  );
}

function identity(
  viewerId: string,
  deviceHint: string | undefined,
  ctx: RequestContext,
): ViewerIdentity {
  return {
    viewerId,
    deviceId: ctx.device?.deviceId ?? deviceHint ?? null,
    device: ctx.device,
  };
}

/** Añade `?t=` a la lista del remux de la app nativa. */
function signed(services: Services, url: string, sessionId: string, ctx: RequestContext): string {
  if (!ctx.device || !url.startsWith('/native/')) return url;
  const token = services.auth.signVideoToken({ sessionId, deviceId: ctx.device.deviceId });
  return `${url}?t=${encodeURIComponent(token)}`;
}

export function registerV1Routes(router: V1Router, services: Services): void {
  router.handle('channelStream', async (input, ctx) => {
    const grant = await services.playback.acquire(
      input.params.id,
      input.query,
      identity(input.query.viewer, input.query.device, ctx),
      ctx.signal,
    );
    return { ...grant, url: signed(services, grant.url, grant.session.id, ctx) };
  });
  router.handle('sessionHeartbeat', async (input, ctx) => {
    const beat = await services.playback.heartbeat(
      input.params.sid,
      input.body,
      identity(input.body.viewer, undefined, ctx),
    );
    return { ...beat, url: signed(services, beat.url, input.params.sid, ctx) };
  });
  router.handle('sessionRelease', (input, ctx) =>
    services.playback.release(
      input.params.sid,
      input.body,
      identity(input.body.viewer, undefined, ctx),
    ),
  );
  router.handle('playbackStatus', () => services.playback.status());
}
