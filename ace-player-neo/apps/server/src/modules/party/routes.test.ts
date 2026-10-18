/* Rutas de «Ver juntos» por HTTP (app.inject): crear, entrar, chatear,
   salir y cerrar, con los errores del catálogo (docs/ver-juntos.md §4). Que
   desde /native no existe en la fase 1 lo fija test/security.test.ts. */

import { describe, expect, it } from 'vitest';
import { PartyJoinResponseSchema, PartyPreviewSchema } from '@ace/shared';
import { createTestApp, web } from '../../../test/helpers/index.js';

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
