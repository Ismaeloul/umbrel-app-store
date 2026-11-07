/* Rutas de «Ver juntos» por HTTP (app.inject): crear, entrar, chatear,
   salir y cerrar, con los errores del catálogo (docs/ver-juntos.md §4). Que
   desde /native no existe en la fase 1 lo fija test/security.test.ts. */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PartyJoinResponseSchema,
  PartyListSchema,
  PartyPreviewSchema,
  PartyQueueResponseSchema,
  type VodGrant,
} from '@ace/shared';
import { createTestApp, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { ArtReply } from '../iptv/vod/art.js';

const PELI = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';

const createBody = {
  titleId: PELI,
  kind: 'movie',
  artId: PELI,
  title: 'Dune',
  name: 'Isma',
};

describe('rutas de «Ver juntos»', () => {
  it('crear (201), ver, entrar, chatear, salir y cerrar', async () => {
    const { app } = await createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/party',
      headers: web(),
      payload: createBody,
    });
    expect(created.statusCode).toBe(201);
    const host = PartyJoinResponseSchema.parse(created.json());
    const code = host.room.code;

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}`,
      headers: web(),
    });
    expect(PartyPreviewSchema.parse(preview.json()).members).toEqual(['Isma']);

    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/join`,
      headers: web(),
      payload: { name: '  Ana  ' },
    });
    expect(joined.statusCode).toBe(200);
    const ana = PartyJoinResponseSchema.parse(joined.json());
    expect(ana.room.members.map((m) => m.name)).toEqual(['Isma', 'Ana']);

    const chat = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/chat`,
      headers: web(),
      payload: { token: ana.member.token, text: 'hola' },
    });
    expect(chat.json()).toEqual({ ok: true });

    /* «Está escribiendo» (§13): ligero y sin error aunque se repita. */
    for (let i = 0; i < 3; i += 1) {
      const typing = await app.inject({
        method: 'POST',
        url: `/api/v1/party/${code}/typing`,
        headers: web(),
        payload: { token: ana.member.token },
      });
      expect(typing.json()).toEqual({ ok: true });
    }
    /* Las reacciones ya no existen. */
    const react = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/react`,
      headers: web(),
      payload: { token: ana.member.token, emoji: '😂' },
    });
    expect(react.statusCode).toBe(404);

    const notHost = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/close`,
      headers: web(),
      payload: { token: ana.member.token },
    });
    expect(notHost.statusCode).toBe(403);
    expect(notHost.json().error.code).toBe('party_host_only');

    const left = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/leave`,
      headers: web(),
      payload: { token: ana.member.token },
    });
    expect(left.json()).toEqual({ ok: true });

    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/close`,
      headers: web(),
      payload: { token: host.member.token },
    });
    expect(closed.json()).toEqual({ ok: true });
    const gone = await app.inject({ method: 'GET', url: `/api/v1/party/${code}`, headers: web() });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe('party_not_found');
  });

  it('nombres con saltos de línea, mensajes vacíos y credenciales mal formadas: 400', async () => {
    const { app } = await createTestApp();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/party',
      headers: web(),
      payload: { ...createBody, name: 'Is\nma' },
    });
    expect(bad.statusCode).toBe(400);
    const host = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/party',
          headers: web(),
          payload: createBody,
        })
      ).json(),
    );
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${host.room.code}/chat`,
      headers: web(),
      payload: { token: host.member.token, text: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    const events = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${host.room.code}/events?t=nada`,
      headers: web(),
    });
    expect(events.statusCode).toBe(400);
  });

  it('el SSE con una credencial que no vale responde 403 en JSON, sin abrir el flujo', async () => {
    const { app } = await createTestApp();
    const host = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/party',
          headers: web(),
          payload: createBody,
        })
      ).json(),
    );
    const forged = `${host.member.id}.${'z'.repeat(32)}`;
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${host.room.code}/events?t=${encodeURIComponent(forged)}`,
      headers: web(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('party_forbidden');
  });
  it('un invitado del proxy (origen guest) entra, chatea y sale, pero no puede crear ni cerrar salas', async () => {
    const { app } = await createTestApp();
    const guest = { 'x-ace-origin': 'guest' };
    const host = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/party',
          headers: web(),
          payload: createBody,
        })
      ).json(),
    );
    const code = host.room.code;
    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}`,
      headers: guest,
    });
    expect(preview.statusCode).toBe(200);
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/join`,
      headers: guest,
      payload: { name: 'Ana' },
    });
    expect(joined.statusCode).toBe(200);
    const ana = PartyJoinResponseSchema.parse(joined.json());
    const chat = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/chat`,
      headers: guest,
      payload: { token: ana.member.token, text: 'hola desde fuera' },
    });
    expect(chat.json()).toEqual({ ok: true });
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/party',
      headers: guest,
      payload: createBody,
    });
    expect(create.statusCode).toBe(401);
    const close = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/close`,
      headers: guest,
      payload: { token: ana.member.token },
    });
    expect(close.statusCode).toBe(401);
    /* Nada más de la casa: ni el estado ni los ajustes. */
    const settings = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: guest });
    expect(settings.statusCode).toBe(401);
  });
});

describe('partyQueue por HTTP: proponer y «Poner en la sala ahora» (docs/ver-juntos.md §11)', () => {
  const OTRA = '0123456789abcdef0123456789abcdef01234567';
  const add = (token: string, extra: Record<string, unknown> = {}) => ({
    token,
    action: 'add',
    titleId: OTRA,
    kind: 'movie',
    artId: OTRA,
    title: 'Oppenheimer',
    ...extra,
  });

  it('`add` responde con el id; con `play`, el anfitrión lo pone y un invitado recibe 403', async () => {
    const { app } = await createTestApp();
    const host = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/party',
          headers: web(),
          payload: createBody,
        })
      ).json(),
    );
    const code = host.room.code;
    const guest = { 'x-ace-origin': 'guest' };
    const ana = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/party/${code}/join`,
          headers: guest,
          payload: { name: 'Ana' },
        })
      ).json(),
    );
    const proposed = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/queue`,
      headers: guest,
      payload: add(ana.member.token),
    });
    expect(proposed.statusCode).toBe(200);
    expect(PartyQueueResponseSchema.parse(proposed.json()).itemId).toMatch(/^q_/);
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/queue`,
      headers: guest,
      payload: add(ana.member.token, { play: true }),
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('party_leader_only');
    const put = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/queue`,
      headers: web(),
      payload: add(host.member.token, { play: true }),
    });
    expect(put.statusCode).toBe(200);
    expect(PartyQueueResponseSchema.parse(put.json())).toEqual({
      ok: true,
      itemId: expect.stringMatching(/^q_/),
    });
    const after = PartyPreviewSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/party/${code}`, headers: web() })).json(),
    );
    expect(after.title.title).toBe('Oppenheimer');
    expect(after.host).toBe('Isma');
    const vote = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${code}/queue`,
      headers: web(),
      payload: {
        token: host.member.token,
        action: 'vote',
        itemId: PartyQueueResponseSchema.parse(proposed.json()).itemId,
      },
    });
    expect(vote.json()).toEqual({ ok: true });
  });
});

describe('partyList por HTTP (docs/ver-juntos.md §15)', () => {
  it('lista también la sala en directo (y tras cambiar a un canal IPTV), con la respuesta validada', async () => {
    const { app } = await createTestApp();
    const DAZN = 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00';
    const IPTV = '0123456789abcdef0123456789abcdef01234567';
    await app.inject({ method: 'POST', url: '/api/v1/party', headers: web(), payload: createBody });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/party',
      headers: web(),
      payload: {
        name: 'Leo',
        live: {
          hash: DAZN,
          channel: 'DAZN 1 · 1080p',
          source: 'engine',
          matchId: 'fltv-1',
          match: 'Málaga – Racing',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const live = PartyJoinResponseSchema.parse(created.json());
    const switched = await app.inject({
      method: 'POST',
      url: `/api/v1/party/${live.room.code}/control`,
      headers: web(),
      payload: {
        token: live.member.token,
        action: 'live',
        live: {
          hash: IPTV,
          channel: 'M+ LaLiga · FHD',
          source: 'iptv',
          matchId: 'fltv-1',
          match: 'Málaga – Racing',
        },
      },
    });
    expect(switched.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/v1/party', headers: web() });
    expect(list.statusCode).toBe(200);
    const rooms = PartyListSchema.parse(list.json()).rooms;
    expect(rooms.map((room) => room.title.kind).sort()).toEqual(['live', 'movie']);
    expect(rooms.find((room) => room.code === live.room.code)?.title).toMatchObject({
      title: 'Málaga – Racing',
      subtitle: 'M+ LaLiga · FHD',
    });
  });
});

describe('«Calidad ligera para invitados» por HTTP (docs/ver-juntos.md §17)', () => {
  const GRANT = JSON.parse(
    readFileSync(
      new URL('../../../../../packages/shared/fixtures/web/v1/partyStream.json', import.meta.url),
      'utf8',
    ),
  ) as VodGrant;

  async function room() {
    const { app, services } = await createTestApp();
    const host = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/party',
          headers: web(),
          payload: createBody,
        })
      ).json(),
    );
    const code = host.room.code;
    const ana = PartyJoinResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/party/${code}/join`,
          headers: { 'x-ace-origin': 'guest' },
          payload: { name: 'Ana' },
        })
      ).json(),
    );
    return { app, services, code, host, ana };
  }

  it('partyStream: solo el que entra por el proxy de la sala llega como invitado; abr por defecto 0', async () => {
    const { app, services, code, ana } = await room();
    const stream = vi.spyOn(services.party, 'stream').mockResolvedValue(GRANT);
    const url = (extra: string) =>
      `/api/v1/party/${code}/stream?client=web&viewer=v-ana&t=${encodeURIComponent(ana.member.token)}${extra}`;
    const cases: [Record<string, string>, string, boolean, '0' | '1'][] = [
      [{ 'x-ace-origin': 'guest' }, '&abr=1', true, '1'],
      [{ 'x-ace-origin': 'GUEST ' }, '', true, '0'],
      [web(), '&abr=1', false, '1'],
      [{ 'x-ace-origin': 'native' }, '&abr=1', false, '1'],
      [{}, '&abr=1', false, '1'],
    ];
    for (const [headers, extra, guest, abr] of cases) {
      const response = await app.inject({ method: 'GET', url: url(extra), headers });
      expect(response.statusCode, JSON.stringify(headers)).toBe(200);
      const call = stream.mock.calls.at(-1);
      expect(call?.[1].abr).toBe(abr);
      expect(call?.[4]).toEqual({ guest });
    }
    /* Un valor raro de abr no vale. */
    const bad = await app.inject({ method: 'GET', url: url('&abr=2'), headers: web() });
    expect(bad.statusCode).toBe(400);
  });

  it('partyVideo sirve la maestra y los lo_* (con party: true); la ruta de vídeo de siempre, nunca', async () => {
    const { app, services, code } = await room();
    vi.spyOn(services.party, 'videoSession').mockReturnValue('s_abcdefgh12');
    const serve = vi
      .spyOn(services.remux, 'serveFile')
      .mockImplementation(async (reply) => void (await reply.code(204).send()));
    for (const file of ['master.m3u8', 'lo.m3u8', 'lo_init.mp4', 'lo_index12.m4s', 'index.m3u8']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/party/${code}/v/${'x'.repeat(32)}/${file}`,
        headers: { 'x-ace-origin': 'guest' },
      });
      expect(response.statusCode, file).toBe(204);
      const call = serve.mock.calls.at(-1);
      expect(call?.[2]).toBe(file);
      expect(call?.[3]).toMatchObject({ party: true });
    }
    for (const file of ['lo_index.m4s', 'lo_x.mp4', 'master.m3u', 'lo_init_1.mp4']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/party/${code}/v/${'x'.repeat(32)}/${file}`,
        headers: { 'x-ace-origin': 'guest' },
      });
      expect(response.statusCode, file).toBe(400);
    }
    serve.mockClear();
    for (const file of ['master.m3u8', 'lo.m3u8', 'lo_init.mp4', 'lo_index12.m4s']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/video/s_abcdefgh12/${file}`,
        headers: web(),
      });
      expect(response.statusCode, file).toBeGreaterThanOrEqual(400);
    }
    expect(serve).not.toHaveBeenCalled();
  });

  it('partyArt: el cartel de la sala (200 y 304 como vodArt); otro título, 404; sin sala, party_not_found', async () => {
    const { app, services, code } = await room();
    const vod = services.iptv.vod;
    if (!vod) throw new Error('sin VOD');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const artOf = vi
      .spyOn(vod, 'artOf')
      .mockImplementation(async (_id, _art, _v, ifNoneMatch): Promise<ArtReply> =>
        ifNoneMatch === '"abc"'
          ? { status: 304, headers: { etag: '"abc"' } }
          : {
              status: 200,
              headers: {
                'content-type': 'image/jpeg',
                etag: '"abc"',
                'x-content-type-options': 'nosniff',
              },
              body: jpeg,
            },
      );
    const guest = { 'x-ace-origin': 'guest' };
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}/art/${PELI}?v=0a1b2c3d`,
      headers: guest,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.rawPayload).toEqual(jpeg);
    /* Siempre el cartel, con la `v` que se pidió. */
    expect(artOf.mock.calls.at(-1)?.slice(0, 3)).toEqual([PELI, 'poster', '0a1b2c3d']);
    const cached = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}/art/${PELI}`,
      headers: { ...guest, 'if-none-match': '"abc"' },
    });
    expect(cached.statusCode).toBe(304);
    /* Un título que no es de la sala: no abre el catálogo. */
    artOf.mockClear();
    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}/art/${'f'.repeat(40)}`,
      headers: guest,
    });
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('vod_not_found');
    expect(artOf).not.toHaveBeenCalled();
    const noRoom = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${'Z'.repeat(16)}/art/${PELI}`,
      headers: guest,
    });
    expect(noRoom.statusCode).toBe(404);
    expect(noRoom.json().error.code).toBe('party_not_found');
    /* La cola de carteles llena: 503 con `Retry-After`, como `vodArt`. */
    artOf.mockRejectedValueOnce(new AppError('vod_unavailable'));
    const busy = await app.inject({
      method: 'GET',
      url: `/api/v1/party/${code}/art/${PELI}`,
      headers: guest,
    });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers['retry-after']).toBe('2');
  });
});
