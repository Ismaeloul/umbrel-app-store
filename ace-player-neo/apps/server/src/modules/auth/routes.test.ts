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

  it('el canje va sin token, pero crear códigos y administrar dispositivos es solo web', async () => {
    const { app } = await appWithStore();
    const { token, deviceId } = await pairOverHttp(app);
    for (const [method, url] of [
      ['POST', '/native/api/v1/pairing'],
      ['GET', '/native/api/v1/devices'],
      ['DELETE', `/native/api/v1/devices/${deviceId}`],
    ] as const) {
      const noToken = await app.inject({ method, url, headers: native() });
      expect(noToken.statusCode).toBe(401);
      const withToken = await app.inject({ method, url, headers: native(token) });
      expect(withToken.statusCode).toBe(403);
      expect(withToken.json()).toMatchObject({ error: { code: 'origin_forbidden' } });
    }
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
