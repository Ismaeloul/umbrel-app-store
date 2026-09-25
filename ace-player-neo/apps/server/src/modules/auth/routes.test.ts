/* Rutas de `auth` por HTTP (app.inject, sin sockets) con la capa de acceso
   de app.ts: orígenes web/native, Bearer, revocación, URL de vídeo firmada
   y que el token en claro no llega ni al disco ni al log. */

import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp, native, web } from '../../../test/helpers/index.js';
import { createLogger } from '../../core/logger.js';
import type { PlaybackService } from '../playback/types.js';
import { baseUrlFromHeaders } from './routes.js';
import { fakeState, memoryDevicesStore } from './test-support.js';

const SID = 's_SesionDePrueba01';

function fakePlayback(alive: (sid: string, dev: string) => boolean): PlaybackService {
  return new Proxy({} as PlaybackService, {
    get(_target, property) {
      if (property === 'isViewerAlive') return alive;
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw new Error(`fakePlayback.${String(property)}`);
      };
    },
  });
}

async function appWithStore() {
  const store = memoryDevicesStore();
  const alive = vi.fn((_sid: string, _dev: string) => false);
  const test = await createTestApp({
    services: { state: fakeState(store), playback: fakePlayback(alive) },
  });
  return { ...test, store, alive };
}

type TestApp = Awaited<ReturnType<typeof appWithStore>>;

async function pairOverHttp(app: TestApp['app'], name = 'iPhone') {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/pairing',
    headers: web({ 'content-type': 'application/json', host: 'umbrel.local:7792' }),
    payload: {},
  });
  expect(created.statusCode).toBe(201);
  const { code } = created.json<{ code: string }>();
  const claimed = await app.inject({
    method: 'POST',
    url: '/native/api/v1/pairing/claim',
    headers: native(undefined, { 'content-type': 'application/json' }),
    payload: { code, name, platform: 'ios' },
  });
  expect(claimed.statusCode).toBe(201);
  return claimed.json<{ deviceId: string; token: string }>();
}

describe('auth · rutas v1', () => {
  it('flujo completo con el estado real: el QR usa el Host y devices.json solo guarda el hash', async () => {
    const { app, services } = await createTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: web({ host: 'umbrel.local:7792' }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      pairUri: expect.stringContaining(`u=${encodeURIComponent('http://umbrel.local:7792')}`),
      qrSvg: expect.stringMatching(/^<svg/),
    });
    const claimed = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code: created.json<{ code: string }>().code, name: 'iPhone', platform: 'ios' },
    });
    expect(claimed.statusCode).toBe(201);
    const { token, deviceId } = claimed.json<{ token: string; deviceId: string }>();
    const [, secret] = token.split('.') as [string, string];

    const file = readFileSync(services.config.paths.devicesFile, 'utf8');
    expect(file).toContain(deviceId);
    expect(file).not.toContain(secret);
    expect(JSON.parse(file).devices[0]).toHaveProperty('secretSha256');

    const bootstrap = await app.inject({
      method: 'GET',
      url: '/native/api/v1/diagnostics',
      headers: native(token),
    });
    expect(bootstrap.statusCode).toBe(200);
    await services.auth.stop();
  });

  it('native: sin token 401, token bueno 200, manipulado 401 y revocado 401 device_revoked', async () => {
    const { app } = await appWithStore();
    const { token, deviceId } = await pairOverHttp(app);
    const get = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/native/api/v1/diagnostics', headers });

    const missing = await get(native());
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: { code: 'unauthorized' } });
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect((await get(native(token))).statusCode).toBe(200);
    const tampered = await get(native(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`));
    expect(tampered.statusCode).toBe(401);
    expect(tampered.json()).toMatchObject({ error: { code: 'unauthorized' } });

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${deviceId}`,
      headers: web(),
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      device: { id: deviceId, revokedAt: expect.any(String) },
    });
    const after = await get(native(token));
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: 'device_revoked' } });
  });

  it('el canje va sin token; crear códigos y administrar dispositivos, sin token 401 y con token el iPhone puede (0.8.1)', async () => {
    const { app } = await appWithStore();
    const { token, deviceId } = await pairOverHttp(app);
    const calls = [
      ['POST', '/native/api/v1/pairing', 201],
      ['GET', '/native/api/v1/devices', 200],
      /* Revocar al final (el propio): después su token ya no vale. */
      ['DELETE', `/native/api/v1/devices/${deviceId}`, 200],
    ] as const;
    for (const [method, url] of calls) {
      const noToken = await app.inject({ method, url, headers: native() });
      expect(noToken.statusCode, `${method} ${url}`).toBe(401);
    }
    for (const [method, url, expected] of calls) {
      const withToken = await app.inject({ method, url, headers: native(token) });
      expect(withToken.statusCode, `${method} ${url}`).toBe(expected);
    }
    const after = await app.inject({
      method: 'GET',
      url: '/native/api/v1/devices',
      headers: native(token),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: 'device_revoked' } });
  });

  it('el iPhone crea un código con sus dos direcciones y otro iPhone lo canjea', async () => {
    const { app } = await appWithStore();
    const a = await pairOverHttp(app, 'iPhone A');
    const created = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing',
      headers: native(a.token),
      payload: {
        baseUrl: 'http://umbrel.local:7792',
        alternateBaseUrls: ['https://umbrel.tail1234.ts.net'],
      },
    });
    expect(created.statusCode).toBe(201);
    const { code, pairUri } = created.json<{ code: string; pairUri: string }>();
    expect(pairUri).toBe(
      `aceneo://pair?u=${encodeURIComponent('http://umbrel.local:7792')}&u=${encodeURIComponent('https://umbrel.tail1234.ts.net')}&c=${code}`,
    );
    const claimed = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code, name: 'iPhone B', platform: 'ios' },
    });
    expect(claimed.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: '/native/api/v1/devices',
      headers: native(a.token),
    });
    expect(list.statusCode).toBe(200);
    const devices = list.json<{ devices: { name: string; revokedAt: string | null }[] }>().devices;
    expect(devices.filter((device) => device.revokedAt === null).map((d) => d.name)).toEqual([
      'iPhone A',
      'iPhone B',
    ]);
  });

  it('sin baseUrl, el QR usa el Host con el que llegó el iPhone', async () => {
    const { app } = await appWithStore();
    const { token } = await pairOverHttp(app);
    const created = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing',
      headers: native(token, { host: 'umbrel.local:7792' }),
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const { code, pairUri } = created.json<{ code: string; pairUri: string }>();
    expect(pairUri).toBe(
      `aceneo://pair?u=${encodeURIComponent('http://umbrel.local:7792')}&c=${code}`,
    );
  });

  it('alternateBaseUrls con 3 entradas o con ruta → 400 validation_error', async () => {
    const { app } = await appWithStore();
    const { token } = await pairOverHttp(app);
    for (const alternateBaseUrls of [
      ['http://a', 'http://b', 'http://c'],
      ['http://umbrel.local:7792/ruta'],
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing',
        headers: native(token),
        payload: { baseUrl: 'http://umbrel.local:7792', alternateBaseUrls },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
    }
  });

  it('direcciones con credenciales o que se codifican (%, unicode) → 400, sin 500 ni código nuevo', async () => {
    const { app } = await appWithStore();
    const { token } = await pairOverHttp(app);
    const fromWeb = await app.inject({ method: 'POST', url: '/api/v1/pairing', headers: web() });
    expect(fromWeb.statusCode).toBe(201);
    const noisy = `http://${'%'.repeat(505)}`;
    for (const payload of [
      { baseUrl: 'http://admin:secreto@umbrel.local:7792' },
      { baseUrl: noisy, alternateBaseUrls: [`${noisy}a`, `${noisy}b`] },
      { baseUrl: `http://${'a'.repeat(505)}`, alternateBaseUrls: [`http://${'ñ'.repeat(505)}`] },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing',
        headers: native(token),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
    }
    /* Ninguna ha anulado el código que la web tenía a la vista. */
    const claimed = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code: fromWeb.json<{ code: string }>().code, name: 'iPhone B', platform: 'ios' },
    });
    expect(claimed.statusCode).toBe(201);
  });

  it('el código que crea un iPhone por /native muere al revocarlo; el de la web, no', async () => {
    const { app } = await appWithStore();
    const a = await pairOverHttp(app, 'iPhone A');
    const claim = (code: string, name: string) =>
      app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing/claim',
        headers: native(),
        payload: { code, name, platform: 'ios' },
      });
    const revoke = (deviceId: string) =>
      app.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}`, headers: web() });

    /* A crea el código con su Bearer; la web revoca a A; el canje da 410. */
    const seeded = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing',
      headers: native(a.token),
      payload: { baseUrl: 'http://umbrel.local:7792' },
    });
    expect(seeded.statusCode).toBe(201);
    expect((await revoke(a.deviceId)).statusCode).toBe(200);
    const dead = await claim(seeded.json<{ code: string }>().code, 'Sembrado');
    expect(dead.statusCode).toBe(410);
    expect(dead.json()).toMatchObject({ error: { code: 'pairing_expired' } });

    /* Al revés: el código de la web sobrevive a que se revoque un iPhone. */
    const b = await pairOverHttp(app, 'iPhone B');
    const fromWeb = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: web({ host: 'umbrel.local:7792' }),
      payload: {},
    });
    expect(fromWeb.statusCode).toBe(201);
    expect((await revoke(b.deviceId)).statusCode).toBe(200);
    expect((await claim(fromWeb.json<{ code: string }>().code, 'iPhone C')).statusCode).toBe(201);
  });

  it('un iPhone en bucle: al sexto código en el minuto 429 pairing_rate_limited; la web sigue pudiendo', async () => {
    const { app } = await appWithStore();
    const a = await pairOverHttp(app, 'iPhone A');
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing',
        headers: native(a.token),
        payload: { baseUrl: 'http://umbrel.local:7792' },
      });
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) statuses.push((await create()).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    const limited = await create();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'pairing_rate_limited' } });
    const fromWeb = await app.inject({ method: 'POST', url: '/api/v1/pairing', headers: web() });
    expect(fromWeb.statusCode).toBe(201);
  });

  it('revocarse a sí mismo: 200 con revokedAt y después 401 device_revoked (también su URL de vídeo)', async () => {
    const { app, services } = await appWithStore();
    const { token, deviceId } = await pairOverHttp(app);
    const videoToken = services.auth.signVideoToken({ sessionId: SID, deviceId });
    const res = await app.inject({
      method: 'DELETE',
      url: `/native/api/v1/devices/${deviceId}`,
      headers: native(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ device: { id: deviceId, revokedAt: expect.any(String) } });
    const after = await app.inject({
      method: 'GET',
      url: '/native/api/v1/bootstrap',
      headers: native(token),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: 'device_revoked' } });
    const video = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/index.m3u8?t=${encodeURIComponent(videoToken)}`,
      headers: native(),
    });
    expect(video.statusCode).toBe(401);
    expect(video.json()).toMatchObject({ error: { code: 'device_revoked' } });
  });

  it('un iPhone revoca a otro: el otro 401, el que revoca sigue 200', async () => {
    const { app } = await appWithStore();
    const a = await pairOverHttp(app, 'iPhone A');
    const b = await pairOverHttp(app, 'iPhone B');
    const res = await app.inject({
      method: 'DELETE',
      url: `/native/api/v1/devices/${b.deviceId}`,
      headers: native(a.token),
    });
    expect(res.statusCode).toBe(200);
    const get = (token: string) =>
      app.inject({ method: 'GET', url: '/native/api/v1/devices', headers: native(token) });
    const other = await get(b.token);
    expect(other.statusCode).toBe(401);
    expect(other.json()).toMatchObject({ error: { code: 'device_revoked' } });
    expect((await get(a.token)).statusCode).toBe(200);
  });

  it('el id de la web (su navegador) no es un dispositivo: 404 device_not_found', async () => {
    const { app } = await appWithStore();
    const { token } = await pairOverHttp(app);
    const res = await app.inject({
      method: 'DELETE',
      url: '/native/api/v1/devices/web_AbCdEf0123456789',
      headers: native(token),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'device_not_found' } });
  });

  it('web: lista y revoca; 404 device_not_found; 400 si el id no tiene forma', async () => {
    const { app } = await appWithStore();
    const { deviceId } = await pairOverHttp(app, 'iPad');
    const list = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: web() });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      devices: [expect.objectContaining({ id: deviceId, name: 'iPad', revokedAt: null })],
    });
    expect(JSON.stringify(list.json())).not.toContain('secretSha256');
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/v1/devices/dev_NoExiste0000000',
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'device_not_found' } });
    const bad = await app.inject({ method: 'DELETE', url: '/api/v1/devices/a.b', headers: web() });
    expect(bad.statusCode).toBe(400);
  });

  it('crear un código desde otra web (anti-CSRF) da 403 cross_origin', async () => {
    const { app } = await appWithStore();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing',
      headers: web({ 'sec-fetch-site': 'cross-site', origin: 'https://malo.example' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('errores del canje con su HTTP: 401 invalid, 410 expired, 429 rate_limited, 400 sin forma', async () => {
    const { app } = await appWithStore();
    const claim = (code: string) =>
      app.inject({
        method: 'POST',
        url: '/native/api/v1/pairing/claim',
        headers: native(),
        payload: { code, name: 'X', platform: 'ios' },
      });
    expect((await claim('123456')).statusCode).toBe(410);
    const created = await app.inject({ method: 'POST', url: '/api/v1/pairing', headers: web() });
    const { code } = created.json<{ code: string }>();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    /* El primer 410 (sin código) ya contó: 1 + 9 = 10 intentos en el minuto. */
    const statuses: number[] = [];
    for (let index = 0; index < 9; index += 1) statuses.push((await claim(wrong)).statusCode);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([410, 410, 410, 410]);
    const limited = await claim(code);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'pairing_rate_limited' } });
    expect((await claim('12345')).statusCode).toBe(400);
  });

  it('URL de vídeo: sin t o manipulada 401 video_token_invalid; revocado 401 device_revoked', async () => {
    const { app, services, alive } = await appWithStore();
    const { token, deviceId } = await pairOverHttp(app);
    const videoToken = services.auth.signVideoToken({ sessionId: SID, deviceId });
    const video = (t: string) =>
      app.inject({
        method: 'GET',
        url: `/native/api/v1/video/${SID}/index.m3u8?t=${encodeURIComponent(t)}`,
        headers: native(),
      });
    const tampered = await video(
      `${videoToken.slice(0, -1)}${videoToken.endsWith('A') ? 'B' : 'A'}`,
    );
    expect(tampered.statusCode).toBe(401);
    expect(tampered.json()).toMatchObject({ error: { code: 'video_token_invalid' } });
    const good = await video(videoToken);
    expect(good.statusCode).not.toBe(401);
    expect(alive).not.toHaveBeenCalled();

    await app.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}`, headers: web() });
    const revoked = await video(videoToken);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toMatchObject({ error: { code: 'device_revoked' } });
    expect(token).toContain(deviceId);
  });

  it('el token, el secreto, el código y el t= no salen en el log de peticiones', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const store = memoryDevicesStore();
    const { app, services } = await createTestApp({
      logger: createLogger({ level: 'trace', destination }),
      services: { state: fakeState(store), playback: fakePlayback(() => false) },
    });
    const created = await app.inject({ method: 'POST', url: '/api/v1/pairing', headers: web() });
    const { code } = created.json<{ code: string }>();
    await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code: '999999' === code ? '000000' : '999999', name: 'X', platform: 'ios' },
    });
    const claimed = await app.inject({
      method: 'POST',
      url: '/native/api/v1/pairing/claim',
      headers: native(),
      payload: { code, name: 'X', platform: 'ios' },
    });
    const { token, deviceId } = claimed.json<{ token: string; deviceId: string }>();
    const [, secret] = token.split('.') as [string, string];
    await app.inject({ method: 'GET', url: '/native/api/v1/devices', headers: native(token) });
    await app.inject({
      method: 'GET',
      url: '/native/api/v1/diagnostics',
      headers: native(`${token}x`),
    });
    const t = services.auth.signVideoToken({ sessionId: SID, deviceId });
    await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/index.m3u8?t=${t}x`,
      headers: native(),
    });
    const log = lines.join('');
    expect(log).toContain('[redactado]');
    for (const secretValue of [code, secret, token, t]) expect(log).not.toContain(secretValue);
  });
});

describe('auth · URL base del QR deducida de las cabeceras', () => {
  it('X-Forwarded-Proto/Host si tienen forma; si no, Host; si nada vale, localhost', () => {
    expect(baseUrlFromHeaders({ host: 'umbrel.local:7792' })).toBe('http://umbrel.local:7792');
    expect(
      baseUrlFromHeaders({
        host: 'interno:3000',
        'x-forwarded-proto': 'https, http',
        'x-forwarded-host': 'umbrel.tail1234.ts.net',
      }),
    ).toBe('https://umbrel.tail1234.ts.net');
    expect(baseUrlFromHeaders({ host: '[::1]:3000', 'x-forwarded-proto': 'gopher' })).toBe(
      'http://[::1]:3000',
    );
    expect(baseUrlFromHeaders({ host: 'malo/ruta', 'x-forwarded-host': 'a b' })).toBe(
      'http://localhost',
    );
    expect(baseUrlFromHeaders({})).toBe('http://localhost');
  });
});
