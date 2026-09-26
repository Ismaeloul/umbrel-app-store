/* Capa HTTP (arquitectura §5.15, §5.12 y §6.4): enrutado exacto de las
   rutas antiguas, origen web/native, credencial de la app iOS, anti-CSRF
   (T-033), límite de 2 MiB (T-032), formatos de error y X-Request-Id.

   Lo que se prueba es app.ts, no los módulos. Donde hace falta un manejador
   concreto (o una ruta sin manejador, 501), el test monta la app con
   `CORE_ONLY` (`moduleRoutes: false`: sin las rutas de los módulos) y
   registra el suyo con `register`. Donde no importa quién conteste, se
   usan los módulos reales (paso 1.3: ya no quedan esqueletos). */

import { describe, expect, it, vi } from 'vitest';
import type { PingResponse } from '@ace/shared';
import { AppError } from '../src/core/errors.js';
import type { EngineService } from '../src/modules/engine/types.js';
import { FAKE_TOKEN as TOKEN, createTestApp, fakeAuth, native, web } from './helpers/index.js';

const HASH = 'a'.repeat(40);

/** La app sin las rutas de los módulos: solo lo que registre el test. */
const CORE_ONLY = { moduleRoutes: false } as const;

const PING: PingResponse = {
  ok: true,
  app: 'ace-player-neo',
  version: '0.7.0-test',
  apiVersion: 1,
  serverTime: 1,
};

describe('rutas antiguas: enrutado exacto de la 0.6.59 (api.md §2.1-2.2)', () => {
  it.each([
    ['GET', '/api/state?x=1'],
    ['GET', '/api/state/'],
    ['GET', '/api/%73tate'],
    ['GET', '/api/health?t=1'],
    ['POST', '/api/remux/stop?x=1'],
    ['GET', '/no-existe'],
    ['GET', '/api'],
    ['OPTIONS', '/api/no-existe'],
  ])('%s %s → 404 not_found', async (method, url) => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: method as 'GET', url, headers: web() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it.each([
    ['POST', '/api/state'],
    ['HEAD', '/api/state'],
    ['OPTIONS', '/api/state'],
    ['GET', '/api/library'],
    ['POST', '/api/football?x=1'],
  ])('%s %s → 405 method_not_allowed', async (method, url) => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: method as 'GET', url, headers: web() });
    expect(res.statusCode).toBe(405);
    if (method !== 'HEAD') expect(res.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('en /remux/ el 405 va sin cuerpo (server.js:4929)', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/remux/${HASH}/index.m3u8`,
      headers: web(),
    });
    expect(res.statusCode).toBe(405);
    expect(res.body).toBe('');
  });

  it.each([
    ['GET', '/api/state'],
    ['PUT', '/api/state'],
    ['GET', '/api/football?date=2026-09-23'],
    ['GET', `/api/football/scan?id=${'0'.repeat(24)}`],
    ['GET', `/remux/${HASH}/index.m3u8`],
    ['HEAD', `/remux/${HASH}/index.m3u8`],
  ])('%s %s existe y, sin manejador, responde 501 not_implemented', async (method, url) => {
    const { app } = await createTestApp(CORE_ONLY);
    const res = await app.inject({ method: method as 'GET', url, headers: web() });
    expect(res.statusCode).toBe(501);
    if (method !== 'HEAD') expect(res.json()).toEqual({ error: 'not_implemented' });
  });

  it('un manejador registrado recibe la query cruda y responde con las cabeceras de send()', async () => {
    const seen: string[] = [];
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ legacy }) =>
        legacy.handle('GET', '/api/football', (req) => {
          seen.push(`${req.url} ${req.query.get('date')}`);
          return { success: true };
        }),
    });
    const ok = await app.inject({ method: 'GET', url: '/api/football?date=hoy', headers: web() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ success: true });
    expect(ok.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(seen).toEqual(['/api/football?date=hoy hoy']);
  });

  it('la ruta exacta no llama al manejador si la URL lleva query de más', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ legacy }) => legacy.handle('GET', '/api/health', handler),
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/health', headers: web() })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/health?t=1', headers: web() })).statusCode,
    ).toBe(404);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cualquier cuerpo es JSON: vacío = {}, roto = 400 bad_json (api.md §2.4)', async () => {
    const bodies: unknown[] = [];
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ legacy }) =>
        legacy.handle('POST', '/api/library', (req) => {
          bodies.push(req.body);
          return { success: true };
        }),
    });
    const vacio = await app.inject({ method: 'POST', url: '/api/library', headers: web() });
    expect(vacio.statusCode).toBe(200);
    const texto = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: web({ 'content-type': 'text/plain' }),
      payload: '{"action":"delete"}',
    });
    expect(texto.statusCode).toBe(200);
    expect(bodies).toEqual([{}, { action: 'delete' }]);
    const roto = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: web({ 'content-type': 'application/json' }),
      payload: '{roto',
    });
    expect(roto.statusCode).toBe(400);
    expect(roto.json()).toEqual({ error: 'bad_json' });
  });
});

describe('origen native (arquitectura §5.12)', () => {
  it.each([
    ['GET', '/native/api/state'],
    ['GET', '/api/state'],
    ['POST', '/api/playback/claim'],
    ['GET', `/remux/${HASH}/index.m3u8`],
    ['GET', '/native/'],
  ])('%s %s → 403 origin_forbidden a native, con o sin token', async (method, url) => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    for (const headers of [native(), native(TOKEN)]) {
      const res = await app.inject({ method: method as 'GET', url, headers });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'origin_forbidden' });
    }
  });

  it('/native/api/v1/* sin token → 401 con el formato v1 y WWW-Authenticate', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const res = await app.inject({
      method: 'GET',
      url: '/native/api/v1/bootstrap',
      headers: native(undefined, { 'x-request-id': 'req-401' }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.json()).toEqual({
      error: { code: 'unauthorized', message: expect.any(String), requestId: 'req-401' },
    });
  });

  it('el prefijo /native manda aunque la cabecera diga web', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const res = await app.inject({ method: 'GET', url: '/native/api/v1/library', headers: web() });
    expect(res.statusCode).toBe(401);
  });

  it('un valor desconocido en X-Ace-Origin cuenta como native (el más restrictivo)', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/state',
      headers: { 'x-ace-origin': 'otra' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ping y el canje del código no piden token', async () => {
    const { app } = await createTestApp({
      ...CORE_ONLY,
      services: { auth: fakeAuth() },
      register: ({ v1 }) => v1.handle('ping', () => PING),
    });
    const ping = await app.inject({ method: 'GET', url: '/native/api/v1/ping', headers: native() });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual(PING);
    const claim = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(undefined, { 'content-type': 'application/json' }),
      payload: { code: '123456', name: 'iPhone', platform: 'ios' },
    });
    /* Sin manejador todavía: 501, pero NO 401. */
    expect(claim.statusCode).toBe(501);
    expect(claim.json().error.code).toBe('not_implemented');
  });

  it('con token válido, auth lo comprueba y el manejador recibe el dispositivo', async () => {
    const auth = fakeAuth();
    const devices: (string | null)[] = [];
    const { app } = await createTestApp({
      ...CORE_ONLY,
      services: { auth },
      register: ({ v1 }) =>
        v1.handle('ping', (_input, ctx) => {
          devices.push(ctx.device?.deviceId ?? null);
          return PING;
        }),
    });
    await app.inject({ method: 'GET', url: '/native/api/v1/ping', headers: native() });
    const settings = await app.inject({
      method: 'GET',
      url: '/native/api/v1/settings',
      headers: native(TOKEN),
    });
    expect(settings.statusCode).toBe(501);
    expect(auth.authenticateBearer).toHaveBeenCalledWith(TOKEN);
    expect(devices).toEqual([null]);
  });

  it('token incorrecto → 401; la ruta solo web (healthLive) con token → 403 origin_forbidden', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const bad = await app.inject({
      method: 'GET',
      url: '/native/api/v1/library',
      headers: native('x.y'),
    });
    expect(bad.statusCode).toBe(401);
    const live = await app.inject({
      method: 'GET',
      url: '/native/api/v1/health/live',
      headers: native(TOKEN),
    });
    expect(live.statusCode).toBe(403);
    expect(live.json().error.code).toBe('origin_forbidden');
  });

  it('una ruta v1 desconocida pide token antes de decir que no existe', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const sinToken = await app.inject({
      method: 'GET',
      url: '/native/api/v1/no-existe',
      headers: native(),
    });
    expect(sinToken.statusCode).toBe(401);
    const conToken = await app.inject({
      method: 'GET',
      url: '/native/api/v1/no-existe',
      headers: native(TOKEN),
    });
    expect(conToken.statusCode).toBe(404);
    expect(conToken.json().error.code).toBe('not_found');
  });

  it('el vídeo exige ?t= desde native; la web entra sin token (IPTV, docs/iptv.md §5.4)', async () => {
    const { app } = await createTestApp({ services: { auth: fakeAuth() } });
    const url = '/api/v1/video/s_abcdefgh12/index.m3u8';
    const desdeWeb = await app.inject({
      method: 'GET',
      url: `${url}?t=${'x'.repeat(20)}`,
      headers: web(),
    });
    /* Sin remux para ese sid: el error de siempre, no un 403 de origen. */
    expect(desdeWeb.statusCode).toBe(410);
    expect(desdeWeb.json().error.code).toBe('session_expired');
    const sinT = await app.inject({ method: 'GET', url: `/native${url}`, headers: native() });
    expect(sinT.statusCode).toBe(401);
    expect(sinT.json().error.code).toBe('video_token_invalid');
  });
});

describe('T-032 · cuerpos de más de 2 MiB → 413 body_too_large (B-204)', () => {
  const grande = JSON.stringify({ item: { id: HASH, title: 'x'.repeat(2 * 1024 * 1024) } });

  it('en una ruta antigua', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/library',
      headers: web({ 'content-type': 'application/json' }),
      payload: grande,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'body_too_large' });
  });

  it('en una ruta v1, con su formato', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/library',
      headers: web({ 'content-type': 'application/json' }),
      payload: grande,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('body_too_large');
  });
});

describe('formatos de error (arquitectura §6.4)', () => {
  it('antiguas: { error } con el HTTP de la 0.6.59, y lo desconocido como 500 internal_error', async () => {
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ legacy }) => {
        legacy.handle('POST', '/api/streams/activate', () => {
          throw new AppError('source_not_found');
        });
        legacy.handle('POST', '/api/streams/sync', () => {
          throw new Error('http_503');
        });
        legacy.handle('POST', '/api/streams/delete', () => {
          throw new Error('fallo interno con datos');
        });
        legacy.handle('GET', '/api/search', () => {
          throw new AppError('engine_unavailable');
        });
      },
    });
    const call = (method: 'GET' | 'POST', url: string) =>
      app.inject({ method, url, headers: web() });
    const a = await call('POST', '/api/streams/activate');
    expect([a.statusCode, a.json()]).toEqual([400, { error: 'source_not_found' }]);
    const b = await call('POST', '/api/streams/sync');
    expect([b.statusCode, b.json()]).toEqual([400, { error: 'http_503' }]);
    const c = await call('POST', '/api/streams/delete');
    expect([c.statusCode, c.json()]).toEqual([500, { error: 'internal_error' }]);
    const d = await call('GET', '/api/search?q=dazn');
    expect([d.statusCode, d.json()]).toEqual([503, { error: 'engine_unavailable' }]);
  });

  it('v1: { error: { code, message, requestId } } con el HTTP correcto', async () => {
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ v1 }) => {
        v1.handle('search', () => {
          throw new AppError('engine_timeout');
        });
        v1.handle('libraryGet', () => {
          throw new Error('fallo interno con datos');
        });
      },
    });
    const timeout = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=dazn',
      headers: web({ 'x-request-id': 'req-504' }),
    });
    expect(timeout.statusCode).toBe(504);
    expect(timeout.json()).toEqual({
      error: {
        code: 'engine_timeout',
        message: expect.stringMatching(/motor/),
        requestId: 'req-504',
      },
    });
    const interno = await app.inject({ method: 'GET', url: '/api/v1/library', headers: web() });
    expect(interno.statusCode).toBe(500);
    expect(interno.json().error.code).toBe('internal_error');
    expect(interno.body).not.toContain('datos');
    const noExiste = await app.inject({ method: 'GET', url: '/api/v1/no-existe', headers: web() });
    expect([noExiste.statusCode, noExiste.json().error.code]).toEqual([404, 'not_found']);
  });

  it('v1 valida la entrada (400 validation_error) y la salida (500 si el manejador no cumple)', async () => {
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ v1 }) => {
        v1.handle('channelStream', () => {
          throw new Error('no debería llegar');
        });
        v1.handle('ping', () => ({ ok: true }) as never);
      },
    });
    const sinCliente = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/${HASH}/stream?viewer=viewer01`,
      headers: web(),
    });
    expect(sinCliente.statusCode).toBe(400);
    expect(sinCliente.json().error.code).toBe('validation_error');
    const salidaMala = await app.inject({ method: 'GET', url: '/api/v1/ping', headers: web() });
    expect(salidaMala.statusCode).toBe(500);
  });
});

describe('T-033 · bloquea mutaciones iniciadas desde otro origen (B-230)', () => {
  const crossSite = web({ origin: 'https://malo.example', 'sec-fetch-site': 'cross-site' });

  it.each([
    ['POST', '/api/restart-engine'],
    ['GET', `/api/remux?id=${HASH}`],
    ['GET', '/api/football/resolve?channel=DAZN'],
    ['POST', '/api/no-existe'],
    ['POST', `/remux/${HASH}/index.m3u8`],
  ])('%s %s cross-site → 403 cross_origin (antes que 404/405)', async (method, url) => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: method as 'GET', url, headers: crossSite });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'cross_origin' });
  });

  it('también los GET con efectos de v1, con su formato', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/${HASH}/stream?client=web&viewer=viewer01`,
      headers: crossSite,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('cross_origin');
  });

  it('los GET sin efectos, same-origin, sin Origin o con el mismo host pasan', async () => {
    const { app } = await createTestApp({
      ...CORE_ONLY,
      register: ({ v1 }) => v1.handle('ping', () => PING),
    });
    const ping = await app.inject({ method: 'GET', url: '/api/v1/ping', headers: crossSite });
    expect(ping.statusCode).toBe(200);
    const variants = [
      web({ 'sec-fetch-site': 'same-origin', origin: 'https://malo.example' }),
      web(),
      web({ origin: 'http://umbrel.local:7792', host: 'umbrel.local:7792' }),
      web({ origin: 'https://umbrel.example', 'x-forwarded-host': 'umbrel.example, otro' }),
    ];
    for (const headers of variants) {
      const res = await app.inject({ method: 'POST', url: '/api/restart-engine', headers });
      expect(res.statusCode).toBe(501);
    }
  });

  it('a la app iOS no se le aplica (va con token, no con cookies)', async () => {
    const { app } = await createTestApp({ ...CORE_ONLY, services: { auth: fakeAuth() } });
    const res = await app.inject({
      method: 'POST',
      url: '/native/api/v1/engine/restart',
      headers: native(TOKEN, { 'sec-fetch-site': 'cross-site', origin: 'https://malo.example' }),
    });
    expect(res.statusCode).toBe(501);
  });
});

describe('X-Request-Id (arquitectura §5.15)', () => {
  it('se usa el que llega si tiene forma válida y sale en la respuesta', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/state',
      headers: web({ 'x-request-id': 'abc-123' }),
    });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('si falta o no vale, se genera uno', async () => {
    const { app } = await createTestApp(CORE_ONLY);
    const sin = await app.inject({ method: 'GET', url: '/no-existe', headers: web() });
    const malo = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: web({ 'x-request-id': 'no vale: tiene espacios' }),
    });
    expect(sin.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(malo.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(malo.json().error.requestId).toBe(malo.headers['x-request-id']);
  });
});

describe('con los módulos reales (paso 1.3: ya no queda ningún esqueleto)', () => {
  it('las rutas que antes daban 501 las atiende su módulo con la forma de la 0.6.59', async () => {
    const { app } = await createTestApp();
    const state = await app.inject({ method: 'GET', url: '/api/state', headers: web() });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ favorites: [], history: [] });
    const scan = await app.inject({
      method: 'GET',
      url: `/api/football/scan?id=${'0'.repeat(24)}`,
      headers: web(),
    });
    expect([scan.statusCode, scan.json()]).toEqual([404, { error: 'scan_not_found' }]);
    for (const method of ['GET', 'HEAD'] as const) {
      const remux = await app.inject({ method, url: `/remux/${HASH}/index.m3u8`, headers: web() });
      /* Sin sesión de remux: 404 sin cuerpo, como la 0.6.59 (T-035). */
      expect([remux.statusCode, remux.body]).toEqual([404, '']);
    }
  });

  it('T-033 con los módulos reales: el anti-CSRF no se aplica a la app iOS y la ruta llega al motor', async () => {
    /* El reinicio de verdad va a engine_control por red: el motor, falso. */
    const restartManual = vi.fn(async () => ({ restarted: true as const }));
    const engine = { restartManual } as unknown as EngineService;
    const { app } = await createTestApp({ services: { auth: fakeAuth(), engine } });
    const res = await app.inject({
      method: 'POST',
      url: '/native/api/v1/engine/restart',
      headers: native(TOKEN, { 'sec-fetch-site': 'cross-site', origin: 'https://malo.example' }),
    });
    expect([res.statusCode, res.json()]).toEqual([200, { restarted: true }]);
    expect(restartManual).toHaveBeenCalledTimes(1);
  });

  it('X-Request-Id también en las respuestas y errores de los módulos', async () => {
    const { app } = await createTestApp();
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/ping',
      headers: web({ 'x-request-id': 'req-real-1' }),
    });
    expect([ok.statusCode, ok.headers['x-request-id']]).toEqual([200, 'req-real-1']);
    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/football/scans/${'0'.repeat(24)}`,
      headers: web({ 'x-request-id': 'req-real-2' }),
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error).toMatchObject({ code: 'scan_not_found', requestId: 'req-real-2' });
  });
});
