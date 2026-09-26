/* Rutas de playback por HTTP (app.inject): el mando de la 0.6.59 (T-037,
   T-038, T-115; B-005 a B-007, B-277), GET /api/remux de los iPhone 0.6.x
   (B-105, B-217, B-222) y las v1 de §6.3 (web y app nativa con la URL
   firmada). */

import { describe, expect, it } from 'vitest';
import {
  HeartbeatResponseSchema,
  LegacyRemuxResponseSchema,
  PlaybackStatusSchema,
  StreamGrantSchema,
  TIMEOUTS,
} from '@ace/shared';
import { contentIdToInfohash, demoContentId } from '../../../test/fake-engine/catalog.js';
import { createTestApp, native, web } from '../../../test/helpers/index.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { AppError } from '../../core/errors.js';
import type { AuthService } from '../auth/types.js';
import { createStateService } from '../state/index.js';
import type { StateService } from '../state/types.js';
import { advanceParked } from '../remux/test-support.js';
import { setupPlayback, type PlaybackSetup, type PlaybackSetupOptions } from './test-support.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const X = demoContentId(1);
const Y = demoContentId(2);
const TOKEN = 'dispositivo-1.secreto';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function fakeAuth(): AuthService {
  const device = {
    deviceId: 'iphone-1',
    device: { id: 'iphone-1', name: 'iPhone de Isma' },
    via: 'bearer',
  } as unknown as AuthenticatedDevice;
  return {
    authenticateBearer: async (token: string) => {
      if (token !== TOKEN) throw new AppError('unauthorized');
      return device;
    },
    signVideoToken: ({ sessionId, deviceId }: { sessionId: string; deviceId: string }) =>
      `firma.${sessionId}.${deviceId}`,
  } as unknown as AuthService;
}

interface AppSetup extends PlaybackSetup {
  readonly app: Awaited<ReturnType<typeof createTestApp>>['app'];
}

/** La app con el estado de verdad (state.json en un temporal) y el SessionManager del motor falso. */
async function appWith(
  options: PlaybackSetupOptions & { realState?: boolean } = {},
): Promise<AppSetup> {
  let state: StateService | undefined;
  if (options.realState !== false) {
    const { createTestCore } = await import('../../../test/helpers/index.js');
    const core = createTestCore();
    state = createStateService(core);
    await state.load();
  }
  const setup = await setupPlayback({ ...options, ...(state ? { state } : {}) });
  const { app } = await createTestApp({
    services: {
      state: setup.state,
      engine: setup.engine,
      remux: setup.remux.service,
      playback: setup.runtime.service,
      scanner: setup.scanner,
      auth: fakeAuth(),
    },
  });
  return { ...setup, app };
}

async function post(app: AppSetup['app'], url: string, payload: unknown, headers = web()) {
  const response = await app.inject({ method: 'POST', url, headers, payload: payload as object });
  return {
    response,
    data: response.json() as Record<string, unknown> & {
      nowPlaying?: { at: number; token: string; id: string };
    },
  };
}

describe('T-037 · el servidor arbitra el mando con marcas monotónicas (B-006)', () => {
  it('T-037 · el servidor arbitra el mando con marcas monotónicas', async () => {
    const { app, state } = await appWith();
    const first = await post(app, '/api/playback/claim', { id: ID_A, title: 'Uno', dev: 'movil' });
    const second = await post(app, '/api/playback/claim', { id: ID_B, title: 'Dos', dev: 'tele' });
    expect(first.response.statusCode).toBe(200);
    expect(second.response.statusCode).toBe(200);
    expect(second.data.nowPlaying?.at).toBeGreaterThan(first.data.nowPlaying?.at ?? Infinity);

    const wrongRelease = await post(app, '/api/playback/release', { id: ID_A, dev: 'movil' });
    expect(wrongRelease.data.released).toBe(false);
    expect(state.get().nowPlaying?.id).toBe(ID_B);

    const release = await post(app, '/api/playback/release', { id: ID_B, dev: 'tele' });
    expect(release.data.released).toBe(true);
    expect(state.get().nowPlaying).toBeNull();
  });

  it('la forma exacta de la respuesta y los 400 de la 0.6.59 (api.md §4.5-4.6)', async () => {
    const { app } = await appWith();
    const claim = await post(app, '/api/playback/claim', {
      id: `acestream://${ID_A}`,
      dev: '  tele del salón  ',
    });
    expect(claim.data).toEqual({
      success: true,
      nowPlaying: {
        id: ID_A,
        title: `Stream ${ID_A.slice(0, 8)}`,
        dev: 'tele del salón',
        token: expect.stringMatching(/^teledelsaln-[a-z0-9]+-[a-f0-9]{6}$/),
        at: expect.any(Number),
      },
    });
    for (const body of [{ id: ID_A }, { dev: 'movil' }, { id: ID_A, dev: 'movil', token: '***' }]) {
      const bad = await post(app, '/api/playback/claim', body);
      expect(bad.response.statusCode).toBe(400);
      expect(bad.data).toEqual({ error: 'bad_request' });
    }
    const badRelease = await post(app, '/api/playback/release', { id: ID_A });
    expect(badRelease.response.statusCode).toBe(400);
    expect(await post(app, '/api/playback/release', { id: ID_B, dev: 'nadie' })).toMatchObject({
      data: { success: true, released: false },
    });
  });
});

describe('T-038 · una liberación adelantada no resucita un claim tardío (B-007)', () => {
  it('T-038 · una liberación adelantada no resucita un claim tardío', async () => {
    const { app, state } = await appWith();
    const lateToken = 'movil-late-claim';
    const earlyRelease = await post(app, '/api/playback/release', {
      id: ID_A,
      dev: 'movil',
      token: lateToken,
    });
    expect(earlyRelease.response.statusCode).toBe(200);
    const lateClaim = await post(app, '/api/playback/claim', {
      id: ID_A,
      title: 'Tarde',
      dev: 'movil',
      token: lateToken,
    });
    expect(lateClaim.data.ignored).toBe(true);
    expect(state.get().nowPlaying).toBeNull();

    await post(app, '/api/playback/claim', {
      id: ID_A,
      title: 'Viejo',
      dev: 'movil',
      token: 'movil-old',
    });
    await post(app, '/api/playback/claim', {
      id: ID_A,
      title: 'Nuevo',
      dev: 'movil',
      token: 'movil-new',
    });
    const delayedRelease = await post(app, '/api/playback/release', {
      id: ID_A,
      dev: 'movil',
      token: 'movil-old',
    });
    expect(delayedRelease.data.released).toBe(false);
    expect(state.get().nowPlaying?.token).toBe('movil-new');
  });

  it('la lápida dura 60 s: pasado ese tiempo el mismo token vuelve a valer', async () => {
    const { app, clock } = await appWith();
    await post(app, '/api/playback/release', { id: ID_A, dev: 'movil', token: 'tok-1' });
    await clock.advanceAsync(59_000);
    expect(
      (await post(app, '/api/playback/claim', { id: ID_A, dev: 'movil', token: 'tok-1' })).data
        .ignored,
    ).toBe(true);
    await clock.advanceAsync(2000);
    const again = await post(app, '/api/playback/claim', {
      id: ID_A,
      dev: 'movil',
      token: 'tok-1',
    });
    expect(again.data.nowPlaying?.token).toBe('tok-1');
  });
});

describe('T-115 · /api/playback devuelve solo el mando, no el estado entero (B-277)', () => {
  it('T-115 · /api/playback devuelve solo el mando, no el estado entero', async () => {
    const { app } = await appWith();
    await post(app, '/api/playback/claim', {
      id: ID_A,
      title: 'Canal',
      dev: 'tv-salon',
      token: 'abc123',
    });
    const ligero = (
      await app.inject({ method: 'GET', url: '/api/playback', headers: web() })
    ).json();
    const completo = (
      await app.inject({ method: 'GET', url: '/api/state', headers: web() })
    ).json();
    expect(Object.keys(ligero).sort()).toEqual(['learningCount', 'nowPlaying', 'serverTime']);
    expect(ligero.nowPlaying).toEqual(completo.nowPlaying);
    expect(ligero.learningCount).toBe(completo.learningCount);
    expect(typeof ligero.serverTime).toBe('number');
    const metodo = await app.inject({
      method: 'POST',
      url: '/api/playback',
      headers: web({ 'sec-fetch-site': 'same-origin' }),
    });
    expect(metodo.statusCode).toBe(405);
  });
});

describe('el claim de un cliente 0.6.x en la v2 (arquitectura §5.6, B-005)', () => {
  it('cuenta como visor legacy y quita el canal a los demás dispositivos', async () => {
    const setup = await appWith();
    const { app, runtime, events, fakeEngine } = setup;
    const grant = await runtime.service.acquire(
      X,
      { client: 'web', kind: 'auto', mode: 'balanced', viewer: 'visor-web-1' },
      { viewerId: 'visor-web-1', deviceId: 'pc', device: null },
      new AbortController().signal,
    );
    await post(app, '/api/playback/claim', { id: Y, title: 'Otro', dev: 'movil-06' });
    await runtime.idle();
    expect(events.of('playback.handoff')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-web-1'],
        byDeviceId: 'movil-06',
        byClient: 'legacy',
        hash: Y,
        title: 'Otro',
        reason: 'other_channel',
      },
    ]);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);
    expect(events.of('playback.activity').at(-1)).toEqual({
      watching: true,
      hashes: [Y],
      viewers: 1,
    });
    expect(events.of('playback.nowPlaying').at(-1)?.nowPlaying?.dev).toBe('movil-06');
  });

  it('caduca a los 45 s si no reclama ni sondea; el sondeo de /api/playback lo mantiene vivo', async () => {
    const { app, clock, state, events, runtime } = await appWith();
    await post(app, '/api/playback/claim', { id: ID_A, dev: 'tele' });
    await runtime.idle();
    for (let index = 0; index < 12; index += 1) {
      await advanceParked(clock, 5000, { step: 1000 });
      await app.inject({ method: 'GET', url: '/api/playback', headers: web() });
    }
    expect(state.get().nowPlaying?.dev).toBe('tele');
    await runtime.idle();
    expect(state.get().nowPlaying?.dev).toBe('tele');
    await advanceParked(clock, TIMEOUTS.viewerExpiryMs + 4000, { step: 2000 });
    await runtime.idle();
    expect(state.get().nowPlaying).toBeNull();
    expect(events.of('playback.activity').at(-1)).toEqual({
      watching: false,
      hashes: [],
      viewers: 0,
    });
  });

  it('un release 0.6.x quita su visor', async () => {
    const { app, events, runtime } = await appWith();
    await post(app, '/api/playback/claim', { id: ID_A, dev: 'tele', token: 'tele-1' });
    await runtime.idle();
    expect(runtime.inspect().viewers).toHaveLength(1);
    await post(app, '/api/playback/release', { id: ID_A, dev: 'tele', token: 'tele-1' });
    expect(runtime.inspect().viewers).toEqual([]);
    expect(events.of('playback.activity').at(-1)).toMatchObject({ watching: false });
  });
});

describe('GET /api/remux de los iPhone 0.6.x (api.md §4.21; B-105, B-217, B-222)', () => {
  it('abre la sesión del backend, lanza ffmpeg sobre ella y responde {url, token}', async () => {
    const setup = await appWith();
    const { app, ffmpeg, fakeEngine, runtime } = setup;
    const res = await app.inject({
      method: 'GET',
      url: `/api/remux?id=${X}&dev=movil`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    const body = LegacyRemuxResponseSchema.parse(res.json());
    expect(body.url).toBe(`/remux/${X}/index.m3u8`);
    expect(ffmpeg.last().input).toMatch(/\/ace\/r\//);
    expect(fakeEngine.control.sessions()[0]?.requestedAs).toBe('id');
    const file = await app.inject({ method: 'GET', url: body.url, headers: web() });
    expect(file.statusCode).toBe(200);
    expect(file.body).toContain('#EXTINF');

    /* Reintento: ficha nueva y el mismo ffmpeg. */
    const retry = LegacyRemuxResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/remux?id=${X}&dev=movil`, headers: web() })
      ).json(),
    );
    expect(retry.token).not.toBe(body.token);
    expect(ffmpeg.spawned).toHaveLength(1);

    const stale = await post(app, '/api/remux/stop', { id: X, dev: 'movil', token: body.token });
    expect(stale.data).toEqual({ success: true, stopped: false, detached: false, stale: true });
    const stop = await post(app, '/api/remux/stop', { id: X, dev: 'movil', token: retry.token });
    expect(stop.data).toEqual({ success: true, stopped: true, detached: true });
    await runtime.idle();
    expect(ffmpeg.alive()).toBe(0);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);
  });

  it('?infohash= abre con infohash y keepAlive deja la sesión hasta que la recoge el recolector', async () => {
    const setup = await appWith();
    const { app, fakeEngine, runtime, remux, clock } = setup;
    const ih = contentIdToInfohash(X);
    const res = await app.inject({
      method: 'GET',
      url: `/api/remux?infohash=${ih}&dev=movil`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    expect(fakeEngine.control.sessions()[0]?.requestedAs).toBe('infohash');
    const { token } = res.json() as { token: string };
    const keep = await post(app, '/api/remux/stop', {
      id: ih,
      dev: 'movil',
      token,
      keepAlive: true,
    });
    expect(keep.data).toEqual({ success: true, stopped: false, detached: true });
    await runtime.idle();
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(1);
    await clock.advanceAsync(91_000);
    await remux.reap();
    await runtime.idle();
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);
  });

  it('errores con los códigos de la 0.6.59: 400, 403, 502 y 504', async () => {
    const setup = await appWith();
    const { app, fakeEngine } = setup;
    const bad = await app.inject({ method: 'GET', url: '/api/remux?id=nada', headers: web() });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'bad_request' });
    const cross = await app.inject({
      method: 'GET',
      url: `/api/remux?id=${X}`,
      headers: web({ 'sec-fetch-site': 'cross-site' }),
    });
    expect(cross.statusCode).toBe(403);
    await fakeEngine.control.setMode(Y, 'failedContent');
    const noPeers = await app.inject({
      method: 'GET',
      url: `/api/remux?id=${Y}&dev=movil`,
      headers: web(),
    });
    expect(noPeers.statusCode).toBe(504);
    expect(noPeers.json()).toEqual({ error: 'remux_timeout' });
    await fakeEngine.control.setMode('*', { kind: 'down', how: 'refuse' });
    const down = await app.inject({
      method: 'GET',
      url: `/api/remux?id=${X}&dev=movil`,
      headers: web(),
    });
    expect(down.statusCode).toBe(502);
    expect(down.json()).toEqual({ error: 'remux_died' });
  });

  it('sin ffmpeg, 502 remux_died como la 0.6.59 (y en v1, 501 ffmpeg_missing)', async () => {
    const setup = await appWith({ launcher: { missing: true } });
    const legacy = await setup.app.inject({
      method: 'GET',
      url: `/api/remux?id=${X}&dev=movil`,
      headers: web(),
    });
    expect(legacy.statusCode).toBe(502);
    expect(legacy.json()).toEqual({ error: 'remux_died' });
    const v1 = await setup.app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-ios-1`,
      headers: native(TOKEN),
    });
    expect(v1.statusCode).toBe(501);
    expect(v1.json().error.code).toBe('ffmpeg_missing');
    await setup.runtime.idle();
    expect(setup.fakeEngine.control.metrics().sessionsOpen).toBe(0);
  });
});

describe('rutas v1 de reproducción (arquitectura §6.2-6.3)', () => {
  it('web: canal, latido, estado y soltar', async () => {
    const setup = await appWith();
    const { app, fakeEngine } = setup;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/${X}/stream?client=web&viewer=visor-web-1&device=pc-salon&title=Canal%201`,
      headers: web({ 'user-agent': CHROME_WINDOWS }),
    });
    expect(res.statusCode).toBe(200);
    const grant = StreamGrantSchema.parse(res.json());
    expect(grant.protocol).toBe('mpegts');
    const sid = grant.session.id;

    const beat = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sid}/heartbeat`,
      headers: web(),
      payload: { viewer: 'visor-web-1', playing: true },
    });
    expect(HeartbeatResponseSchema.parse(beat.json())).toMatchObject({
      url: grant.url,
      viewers: 1,
    });

    const status = PlaybackStatusSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/playback', headers: web() })).json(),
    );
    expect(status.sessions).toEqual([
      expect.objectContaining({
        id: sid,
        hash: X,
        mode: 'progressive',
        /* «Dónde se está reproduciendo»: canal, protocolo y quién lo ve (nombre sacado del User-Agent). */
        title: 'Canal 1',
        protocol: 'mpegts',
        viewers: [
          expect.objectContaining({
            client: 'web',
            deviceId: 'pc-salon',
            viewerId: 'visor-web-1',
            deviceName: 'Chrome · Windows',
            platform: 'web',
            playing: true,
          }),
        ],
      }),
    ]);
    expect(status.nowPlaying).toMatchObject({ id: X, title: 'Canal 1', dev: 'pc-salon' });

    /* sendBeacon manda text/plain. */
    const release = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sid}/release`,
      headers: web({ 'content-type': 'text/plain;charset=UTF-8' }),
      payload: JSON.stringify({ viewer: 'visor-web-1', reason: 'pagehide' }),
    });
    expect(release.json()).toEqual({ released: true, sessionClosed: true });
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);

    const late = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sid}/heartbeat`,
      headers: web(),
      payload: { viewer: 'visor-web-1' },
    });
    expect(late.statusCode).toBe(410);
    expect(late.json().error.code).toBe('session_expired');
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions/s_nuncaexistio1/release',
      headers: web(),
      payload: { viewer: 'visor-web-1' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('app nativa: la lista del remux sale firmada con ?t= en la respuesta y en el latido', async () => {
    const setup = await appWith();
    const { app } = setup;
    const res = await app.inject({
      method: 'GET',
      url: `/native/api/v1/channels/${X}/stream?client=ios&viewer=visor-ios-1&mode=stable`,
      headers: native(TOKEN),
    });
    expect(res.statusCode).toBe(200);
    const grant = StreamGrantSchema.parse(res.json());
    const sid = grant.session.id;
    expect(grant.url).toBe(
      `/native/api/v1/video/${sid}/index.m3u8?t=${encodeURIComponent(`firma.${sid}.iphone-1`)}`,
    );
    /* «Estable» con TARGETDURATION 1 (el ffmpeg falso corta en 1 s): 10 s del
       directo y 12 s de colchón (docs/multidispositivo.md §4.4). */
    expect(grant.latency.ios).toEqual({ preferredForwardBufferDuration: 12, liveEdgeOffsetS: 10 });
    const beat = await app.inject({
      method: 'POST',
      url: `/native/api/v1/sessions/${sid}/heartbeat`,
      headers: native(TOKEN),
      payload: { viewer: 'visor-ios-1' },
    });
    expect(beat.json().url).toBe(grant.url);
    expect(setup.runtime.service.isViewerAlive(sid, 'iphone-1')).toBe(true);
    /* El iPhone también ve «Dónde se está reproduciendo», con el nombre del emparejado. */
    const status = PlaybackStatusSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/native/api/v1/playback', headers: native(TOKEN) })
      ).json(),
    );
    expect(status.sessions).toEqual([
      expect.objectContaining({
        id: sid,
        protocol: 'hls-fmp4',
        title: '',
        viewers: [
          expect.objectContaining({
            client: 'ios',
            deviceId: 'iphone-1',
            viewerId: 'visor-ios-1',
            deviceName: 'iPhone de Isma',
            platform: 'ios',
            playing: null,
          }),
        ],
      }),
    ]);
    const release = await app.inject({
      method: 'POST',
      url: `/native/api/v1/sessions/${sid}/release`,
      headers: native(TOKEN),
      payload: { viewer: 'visor-ios-1' },
    });
    expect(release.json()).toEqual({ released: true, sessionClosed: true });
    expect(setup.ffmpeg.alive()).toBe(0);
  });

  it('valida la entrada: visor y cliente obligatorios', async () => {
    const { app } = await appWith();
    const noViewer = await app.inject({
      method: 'GET',
      url: `/api/v1/channels/${X}/stream?client=web`,
      headers: web(),
    });
    expect(noViewer.statusCode).toBe(400);
    const badHash = await app.inject({
      method: 'GET',
      url: '/api/v1/channels/nada/stream?client=web&viewer=visor-1',
      headers: web(),
    });
    expect(badHash.statusCode).toBe(400);
  });
});
