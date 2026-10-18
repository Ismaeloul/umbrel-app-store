/* Rutas del módulo `party` («Ver juntos», docs/ver-juntos.md §4).

   Antiguas: ninguna.

   v1 (tabla de @ace/shared/routes.ts). Crear y cerrar, solo `web`; el resto,
   `any` con credencial `party`: también los invitados que llegan por el proxy
   de la sala (docs/ver-juntos.md §9), con origen `native` y sin token de
   dispositivo. La credencial de la sala la comprueba el servicio.
   - partyCreate: POST /api/v1/party
   - partyPreview: GET /api/v1/party/:code
   - partyJoin: POST /api/v1/party/:code/join
   - partyEvents: GET /api/v1/party/:code/events (SSE; `?t=` con la credencial)
   - partyStream: GET /api/v1/party/:code/stream (la `VodGrant` de la sala)
   - partyVideo: GET /api/v1/party/:code/v/:key/:file (la lista y los segmentos)
   - partyControl, partyStatus, partyChat, partyLeave, partyClose: POST con
     la credencial en `token`. */

import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { browserDeviceName } from '../playback/device-name.js';

export const LEGACY_ROUTES: readonly string[] = [];

export const V1_ROUTE_IDS: readonly string[] = [
  'partyCreate',
  'partyPreview',
  'partyJoin',
  'partyEvents',
  'partyStream',
  'partyVideo',
  'partyControl',
  'partyStatus',
  'partyChat',
  'partyLeave',
  'partyClose',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  const party = services.party;
  router.handle('partyCreate', (input) => party.create(input.body));
  router.handle('partyPreview', (input) => party.preview(input.params.code));
  router.handle('partyJoin', (input) => party.join(input.params.code, input.body.name));
  router.handle('partyEvents', async (input, ctx) => {
    await party.connect(input.params.code, input.query.t, ctx.reply, ctx.signal);
  });
  router.handle('partyStream', (input, ctx) =>
    party.stream(
      input.params.code,
      input.query,
      {
        viewerId: input.query.viewer,
        deviceId: input.query.device ?? null,
        device: null,
        deviceName: browserDeviceName(ctx.request.headers['user-agent']),
      },
      ctx.signal,
    ),
  );
  router.handle('partyVideo', async (input, ctx) => {
    const sid = party.videoSession(input.params.code, input.params.key);
    await services.remux.serveFile(ctx.reply, sid, input.params.file, {
      rangeHeader: ctx.request.headers.range,
      deviceId: null,
    });
  });
  router.handle('partyControl', (input) => party.control(input.params.code, input.body));
  router.handle('partyStatus', (input) => party.status(input.params.code, input.body));
  router.handle('partyChat', (input) => {
    party.chat(input.params.code, input.body);
    return { ok: true as const };
  });
  router.handle('partyLeave', (input) => {
    party.leave(input.params.code, input.body.token);
    return { ok: true as const };
  });
  router.handle('partyClose', (input) => {
    party.close(input.params.code, input.body.token);
    return { ok: true as const };
  });
}
