/* Rutas del remux por HTTP (app.inject): /remux/<hash>/<fichero> y
   POST /api/remux/stop con la forma exacta de la 0.6.59 (T-035, B-221,
   B-222) y /api/v1/video para la app nativa (lista reescrita con ?t=). */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { DeviceRecord } from '@ace/shared';
import { createTestApp, createTestCore, native, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { notImplementedService } from '../../core/stub.js';
import type { AuthService } from '../auth/types.js';
import type { EngineService } from '../engine/types.js';
import { createRemuxRuntime } from './service.js';
import { createFakeLauncher } from './test-support.js';

const ID_A = 'a'.repeat(40);
const SID = 's_sesionvideo1';
const GOOD_TOKEN = 'token-bueno-123.firma';

function fakeAuth(): Pick<AuthService, 'verifyVideoToken'> {
  const device: AuthenticatedDevice = {
    deviceId: 'iphone-1',
    device: { id: 'iphone-1' } as DeviceRecord,
    via: 'video-token',
  };
  return {
    verifyVideoToken: async (token: string) => {
      if (token !== GOOD_TOKEN) throw new AppError('video_token_invalid');
      return device;
    },
  };
}

async function setup() {
  const core = createTestCore();
  const fake = createFakeLauncher();
  const runtime = createRemuxRuntime({
    ...core,
    engine: notImplementedService<EngineService>('engine'),
    launcher: fake.launcher,
    procRoot: null,
    watchFiles: false,
  });
  const accesses: [string, string | null][] = [];
  runtime.service.subscribe({ onAccess: (sid, device) => accesses.push([sid, device]) });
  const auth = fakeAuth() as AuthService;
  const { app } = await createTestApp({ services: { remux: runtime.service, auth } });
  const remuxDir = core.config.paths.remuxDir;
  return { app, core, runtime, fake, accesses, remuxDir };
}

function writeFile(remuxDir: string, rel: string, body: string | Buffer): void {
  const file = path.join(remuxDir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

describe('T-035 · el remux sirve rangos sin cargar el segmento completo en memoria (B-221, B-222)', () => {
  it('T-035 · el remux sirve rangos sin cargar el segmento completo en memoria', async () => {
    const { app, remuxDir } = await setup();
    writeFile(remuxDir, `${ID_A}/init.mp4`, Buffer.from('0123456789'));
    const response = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/init.mp4`,
      headers: web({ range: 'bytes=2-5' }),
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 2-5/10');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.body).toBe('2345');

    const stop = await app.inject({
      method: 'POST',
      url: '/api/remux/stop',
      headers: web(),
      payload: { id: ID_A, dev: 'test-device' },
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json().stopped).toBe(false);
  });

  it('fichero completo, HEAD, 416, 404, 403 y 405 como la 0.6.59 (api.md §4.23)', async () => {
    const { app, remuxDir } = await setup();
    writeFile(remuxDir, `${ID_A}/init.mp4`, Buffer.from('0123456789'));
    writeFile(remuxDir, `${ID_A}/index.m3u8`, '#EXTM3U\n');
    writeFile(remuxDir, `${ID_A}/vacio.m4s`, '');
    writeFile(remuxDir, 'fuera.txt', 'secreto');

    const full = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/init.mp4?x=1`,
      headers: web(),
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers).toMatchObject({
      'content-type': 'video/mp4',
      'content-length': '10',
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(full.body).toBe('0123456789');

    const head = await app.inject({
      method: 'HEAD',
      url: `/remux/${ID_A}/init.mp4`,
      headers: web(),
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.body).toBe('');

    const headRange = await app.inject({
      method: 'HEAD',
      url: `/remux/${ID_A}/init.mp4`,
      headers: web({ range: 'bytes=-3' }),
    });
    expect(headRange.statusCode).toBe(206);
    expect(headRange.headers['content-range']).toBe('bytes 7-9/10');

    const list = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/index.m3u8`,
      headers: web(),
    });
    expect(list.headers['content-type']).toBe('application/vnd.apple.mpegurl');

    const empty = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/vacio.m4s`,
      headers: web(),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['content-length']).toBe('0');
    expect(empty.headers['content-type']).toBe('video/iso.segment');

    const out = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/init.mp4`,
      headers: web({ range: 'bytes=120-130' }),
    });
    expect(out.statusCode).toBe(416);
    expect(out.headers['content-range']).toBe('bytes */10');
    expect(out.headers['cache-control']).toBe('no-store');
    expect(out.body).toBe('');

    const missing = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/index9.m4s`,
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toBe('');
    expect(missing.headers['cache-control']).toBe('no-store');

    /* El log de ffmpeg ya no está en disco (api.md §6.22). */
    const log = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/ffmpeg.log`,
      headers: web(),
    });
    expect(log.statusCode).toBe(404);

    for (const url of [
      `/remux/${ID_A}`,
      '/remux/no-es-un-hash/init.mp4',
      `/remux/${ID_A}/..%2F..%2Fsecreto`,
      `/remux/${ID_A}/..%2F..%2F..%2Ffuera.txt`,
      `/remux/${ID_A}/a%5Cb`,
    ]) {
      const forbidden = await app.inject({ method: 'GET', url, headers: web() });
      expect(forbidden.statusCode, url).toBe(403);
      expect(forbidden.body, url).toBe('');
    }

    const post = await app.inject({
      method: 'POST',
      url: `/remux/${ID_A}/init.mp4`,
      headers: web(),
    });
    expect(post.statusCode).toBe(405);
    expect(post.body).toBe('');
  });

  it('cada petición a /remux/ renueva la sesión y cuenta como latido', async () => {
    const { app, runtime, accesses } = await setup();
    await runtime.service.ensure(
      { sessionId: SID, hash: ID_A, playbackUrl: `/ace/r/${ID_A}/x`, mode: 'progressive' },
      'lr_movil',
      undefined,
      { legacy: { device: 'movil' } },
    );
    const res = await app.inject({
      method: 'GET',
      url: `/remux/${ID_A}/index.m3u8`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('index2.m4s');
    expect(accesses).toEqual([[SID, null]]);
    await runtime.service.stopAll();
  });

  it('POST /api/remux/stop: 400 sin hash y el stop de un enganche anterior da stale', async () => {
    const { app, runtime } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/remux/stop',
      headers: web(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'bad_request' });
    const source = {
      sessionId: SID,
      hash: ID_A,
      playbackUrl: `/ace/r/${ID_A}/x`,
      mode: 'progressive' as const,
    };
    const old = await runtime.service.ensure(source, 'lr_tele', undefined, {
      legacy: { device: 'tele' },
    });
    await runtime.service.ensure(source, 'lr_tele', undefined, { legacy: { device: 'tele' } });
    const stale = await app.inject({
      method: 'POST',
      url: '/api/remux/stop',
      headers: web(),
      payload: { id: ID_A, dev: 'tele', token: old.legacyToken, keepAlive: false },
    });
    expect(stale.json()).toEqual({ success: true, stopped: false, detached: false, stale: true });
    await runtime.service.stopAll();
  });
});

describe('GET /api/v1/video/:sid/:file (arquitectura §5.12)', () => {
  async function withSession() {
    const ctx = await setup();
    await ctx.runtime.service.ensure(
      { sessionId: SID, hash: ID_A, playbackUrl: `/ace/r/${ID_A}/x`, mode: 'progressive' },
      'visor-ios',
    );
    return ctx;
  }

  it('la lista sale reescrita con ?t= en cada URI, también en #EXT-X-MAP', async () => {
    const { app, accesses, runtime } = await withSession();
    const res = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/index.m3u8?t=${encodeURIComponent(GOOD_TOKEN)}`,
      headers: native(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(res.headers['cache-control']).toBe('no-store');
    const token = encodeURIComponent(GOOD_TOKEN);
    expect(res.body).toContain(`#EXT-X-MAP:URI="init.mp4?t=${token}"`);
    expect(res.body).toContain(`index0.m4s?t=${token}`);
    expect(res.body).toContain(`index2.m4s?t=${token}`);
    expect(accesses).toEqual([[SID, 'iphone-1']]);
    await runtime.service.stopAll();
  });

  it('segmentos con Range y 206; ficheros que no existen, 404 sin cuerpo', async () => {
    const { app, runtime } = await withSession();
    const url = (file: string) =>
      `/native/api/v1/video/${SID}/${file}?t=${encodeURIComponent(GOOD_TOKEN)}`;
    const seg = await app.inject({
      method: 'GET',
      url: url('index1.m4s'),
      headers: native(undefined, { range: 'bytes=0-3' }),
    });
    expect(seg.statusCode).toBe(206);
    expect(seg.body).toBe('segm');
    expect(seg.headers['content-type']).toBe('video/iso.segment');
    const init = await app.inject({ method: 'GET', url: url('init.mp4'), headers: native() });
    expect(init.statusCode).toBe(200);
    expect(init.body).toBe('init-mp4-fake');
    const gone = await app.inject({ method: 'GET', url: url('index77.m4s'), headers: native() });
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toBe('');
    const bigRange = await app.inject({
      method: 'GET',
      url: url('index.m3u8'),
      headers: native(undefined, { range: 'bytes=99999-' }),
    });
    expect(bigRange.statusCode).toBe(416);
    await runtime.service.stopAll();
  });

  it('410 session_expired sin remux, 401 con token malo, 400 con un fichero que no es de ffmpeg; la web entra sin reescribir (IPTV)', async () => {
    const { app, runtime } = await withSession();
    const expired = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/s_otrasesion1/index.m3u8?t=${encodeURIComponent(GOOD_TOKEN)}`,
      headers: native(),
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('session_expired');
    const badToken = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/index.m3u8?t=token-malo-1234`,
      headers: native(),
    });
    expect(badToken.statusCode).toBe(401);
    const log = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/ffmpeg.log?t=${encodeURIComponent(GOOD_TOKEN)}`,
      headers: native(),
    });
    expect(log.statusCode).toBe(400);
    /* docs/iptv.md §5.4: `video` es `any`; desde la web `t` se ignora y la
       lista sale tal cual, sin `?t=` en sus URIs. */
    const fromWeb = await app.inject({
      method: 'GET',
      url: `/api/v1/video/${SID}/index.m3u8?t=${encodeURIComponent(GOOD_TOKEN)}`,
      headers: web(),
    });
    expect(fromWeb.statusCode).toBe(200);
    expect(fromWeb.body).toContain('#EXTM3U');
    expect(fromWeb.body).not.toContain('?t=');
    const fromWebBare = await app.inject({
      method: 'GET',
      url: `/api/v1/video/${SID}/index.m3u8`,
      headers: web(),
    });
    expect(fromWebBare.statusCode).toBe(200);
    expect(fromWebBare.body).toBe(fromWeb.body);
    await runtime.service.stopAll();
  });

  it('sin ?t= la lista sale tal cual y los errores de ruta se respetan (servicio)', async () => {
    const { runtime } = await withSession();
    const bare = Fastify();
    bare.get('/lista', async (_request, reply) => {
      await runtime.service.serveFile(reply, SID, 'index.m3u8', {});
      return reply;
    });
    bare.get('/malo', async (_request, reply) => {
      await runtime.service.serveFile(reply, SID, '../state.json', {});
      return reply;
    });
    const res = await bare.inject({ method: 'GET', url: '/lista' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(res.body).not.toContain('?t=');
    const bad = await bare.inject({ method: 'GET', url: '/malo' });
    expect(bad.statusCode).toBe(500);
    await bare.close();
    await runtime.service.stopAll();
  });
});

describe('casos raros del servido (api.md §6)', () => {
  it('escapes rotos en /remux/ dan not_found y una lista que no está, 404 aunque lleve ?t=', async () => {
    const { runtime, app, remuxDir } = await setup();
    await runtime.service.ensure(
      { sessionId: SID, hash: ID_A, playbackUrl: `/ace/r/${ID_A}/x`, mode: 'progressive' },
      'visor-ios',
    );
    const bare = Fastify();
    bare.get('/roto', async (_request, reply) => {
      await runtime.service.serveLegacyFile(reply, '/remux/%E0%A4%A/init.mp4', {});
      return reply;
    });
    const broken = await bare.inject({ method: 'GET', url: '/roto' });
    expect(JSON.parse(broken.body).message).toBe('not_found');
    await bare.close();

    rmSync(path.join(remuxDir, ID_A, 'index.m3u8'));
    const gone = await app.inject({
      method: 'GET',
      url: `/native/api/v1/video/${SID}/index.m3u8?t=${encodeURIComponent(GOOD_TOKEN)}`,
      headers: native(),
    });
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toBe('');
    await runtime.service.stopAll();
  });
});
