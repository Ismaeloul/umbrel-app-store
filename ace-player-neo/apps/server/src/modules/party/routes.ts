/* Rutas del módulo `party` («Ver juntos», docs/ver-juntos.md §4).

   Antiguas: ninguna.

   v1 (tabla de @ace/shared/routes.ts). Crear y cerrar, `any` con token de
   dispositivo (la web y la app, §10); el resto,
   `any` con credencial `party`: también los invitados que llegan por el proxy
   de la sala (docs/ver-juntos.md §9), con origen `native` y sin token de
   dispositivo. La credencial de la sala la comprueba el servicio.
   - partyCreate: POST /api/v1/party
   - partyPreview: GET /api/v1/party/:code
   - partyJoin: POST /api/v1/party/:code/join
   - partyEvents: GET /api/v1/party/:code/events (SSE; `?t=` con la credencial)
   - partyStream: GET /api/v1/party/:code/stream (la `VodGrant` de la sala; al
     invitado de fuera con `abr=1`, la lista maestra o la ligera, §17)
   - partyVideo: GET /api/v1/party/:code/v/:key/:file (la lista y los segmentos;
     también `master.m3u8`, `lo.m3u8` y los `lo_*`, que la ruta de vídeo de
     siempre no sirve)
   - partyArt: GET /api/v1/party/:code/art/:artId (el cartel del título de la
     sala para el invitado de fuera, que no tiene `vodArt`; las mismas
     cabeceras y el mismo 304)
   - partyControl, partyStatus, partyChat, partyLeave, partyClose: POST con
     la credencial en `token`.
   - partySettings, partyMember, partyQueue (§11 y §13): ajustes y personas
     (el líder y los co-líderes) y la lista; también POST con `token`.
   - partyTyping (§13): «está escribiendo»; POST con `token`. Las
     reacciones (`partyReact`) se quitaron en el rediseño de escritorio. */

import { isAppError } from '../../core/errors.js';
import { ORIGIN_HEADER, isGuestOrigin } from '../../core/origin.js';
import type { LegacyRouter, V1Router } from '../../core/router.js';
import type { Services } from '../../services.js';
import { ifNoneMatchOf, sendArt } from '../iptv/art-reply.js';
import type { ArtReply } from '../iptv/vod/art.js';
import { browserDeviceName } from '../playback/device-name.js';

export const LEGACY_ROUTES: readonly string[] = [];

export const V1_ROUTE_IDS: readonly string[] = [
  'partyCreate',
  'partyPreview',
  'partyJoin',
  'partyEvents',
  'partyStream',
  'partyVideo',
  'partyArt',
  'partyControl',
  'partyStatus',
  'partyChat',
  'partyTyping',
  'partySettings',
  'partyMember',
  'partyQueue',
  'partyLeave',
  'partyClose',
  'partyList',
  'partyEnd',
];

export function registerLegacyRoutes(_router: LegacyRouter, _services: Services): void {}

export function registerV1Routes(router: V1Router, services: Services): void {
  const party = services.party;
  router.handle('partyCreate', (input) => party.create(input.body));
  router.handle('partyPreview', (input) => party.preview(input.params.code));
  router.handle('partyJoin', (input) => party.join(input.params.code, input.body.name));
  router.handle('partyEvents', async (input, ctx) => {
    await party.connect(input.params.code, input.query.t, ctx.reply, ctx.signal, {
      ping: input.query.ping === '1',
    });
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
      /* El invitado de fuera (§9 y §17): Caddy pone `guest`, que para todo lo demás es `native`. */
      {
        guest:
          ctx.request.aceOrigin === 'native' &&
          isGuestOrigin(ctx.request.headers[ORIGIN_HEADER], ctx.request.url),
      },
    ),
  );
  router.handle('partyVideo', async (input, ctx) => {
    const sid = party.videoSession(input.params.code, input.params.key);
    await services.remux.serveFile(ctx.reply, sid, input.params.file, {
      rangeHeader: ctx.request.headers.range,
      deviceId: null,
      /* Además de los de siempre, la lista maestra y la versión ligera (§17): solo por aquí. */
      party: true,
    });
  });
  router.handle('partyArt', async (input, ctx) => {
    let reply: ArtReply;
    try {
      reply = await party.art(
        input.params.code,
        input.params.artId,
        input.query.v,
        ifNoneMatchOf(ctx),
      );
    } catch (error) {
      /* La cola de carteles llena (docs/vod.md §8): 503 con `Retry-After`, como `vodArt`. */
      if (isAppError(error) && error.code === 'vod_unavailable')
        ctx.reply.header('retry-after', '2');
      throw error;
    }
    await sendArt(ctx.reply, reply);
  });
  router.handle('partyControl', (input) => party.control(input.params.code, input.body));
  router.handle('partyStatus', (input) => party.status(input.params.code, input.body));
  router.handle('partyChat', (input) => {
    party.chat(input.params.code, input.body);
    return { ok: true as const };
  });
  router.handle('partyTyping', (input) => {
    party.typing(input.params.code, input.body.token);
    return { ok: true as const };
  });
  router.handle('partySettings', (input) => {
    party.settings(input.params.code, input.body);
    return { ok: true as const };
  });
  router.handle('partyMember', (input) => {
    party.member(input.params.code, input.body);
    return { ok: true as const };
  });
  router.handle('partyQueue', (input) => {
    party.queue(input.params.code, input.body);
    return { ok: true as const };
  });
  router.handle('partyLeave', (input) => {
    party.leave(input.params.code, input.body.token);
    return { ok: true as const };
  });
  router.handle('partyList', () => party.list());
  router.handle('partyEnd', (input) => {
    party.end(input.params.code);
    return { ok: true as const };
  });
  router.handle('partyClose', (input) => {
    party.close(input.params.code, input.body.token);
    return { ok: true as const };
  });
}
