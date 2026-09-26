/* SessionManager contra el motor AceStream falso (test/fake-engine) con
   FakeClock: una sesión por contenido, stop siempre (sin zombis), latido de
   45 s, cambio de canal sin carreras, share y handoff (D5), iOS con remux,
   recuperación tras reiniciar el motor, estadísticas, arranque y apagado
   (arquitectura §5.6, §6.3, §7.1). */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  IOS_PLAYBACK_PROFILES_080,
  StreamGrantSchema,
  TIMEOUTS,
  type ChannelStreamQuery,
} from '@ace/shared';
import { contentIdToInfohash, demoContentId } from '../../../test/fake-engine/catalog.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { isAppError } from '../../core/errors.js';
import type { SourceVerdict } from '../scanner/types.js';
import { advanceParked, parked } from '../remux/test-support.js';
import { engineStatus, setupPlayback, type PlaybackSetup } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const X = demoContentId(1);
const Y = demoContentId(2);
const Z = demoContentId(3);

function query(over: Partial<ChannelStreamQuery> = {}): ChannelStreamQuery {
  return { client: 'web', kind: 'auto', mode: 'balanced', viewer: 'visor-web-1', ...over };
}

function web(viewerId: string, deviceId: string | null = `dev-${viewerId}`): ViewerIdentity {
  return { viewerId, deviceId, device: null };
}

function ios(viewerId: string, deviceId = 'iphone-1'): ViewerIdentity {
  const device = {
    deviceId,
    device: { id: deviceId },
    via: 'bearer',
  } as unknown as AuthenticatedDevice;
  return { viewerId, deviceId, device };
}

const live = (): AbortSignal => new AbortController().signal;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return isAppError(error) ? error.code : String((error as Error).message);
  }
}

function metrics(setup: PlaybackSetup) {
  return setup.fakeEngine.control.metrics();
}

describe('una sesión por contenido y stop siempre (D5.1, B-002, B-003)', () => {
  it('abre con format=json, responde §6.3 y al soltar hace stop y la borra de sessions.json', async () => {
    const setup = await setupPlayback();
    const { runtime, state, events } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    expect(StreamGrantSchema.parse(grant)).toEqual(grant);
    expect(grant).toMatchObject({
      session: { heartbeatMs: TIMEOUTS.viewerHeartbeatMs, expiresAfterMs: TIMEOUTS.viewerExpiryMs },
      protocol: 'mpegts',
      remux: false,
      codec: { video: 'unknown', audio: 'unknown', source: 'unknown' },
      latency: {
        mode: 'balanced',
        initialBufferS: 6,
        rebuildS: 8,
        liveSync: { targetS: 6, maxS: 14, rate: 1.03 },
      },
      stats: { via: 'sse' },
      handoff: false,
    });
    expect(grant.url).toMatch(new RegExp(`^/ace/r/${contentIdToInfohash(X)}/`));
    expect(metrics(setup)).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
    expect(metrics(setup).requestsByRoute.getstream).toBe(1);
    const persisted = state.sessions().read().sessions;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: grant.session.id,
      hash: X,
      kind: 'id',
      mode: 'progressive',
    });
    expect(persisted[0]?.commandUrl).toMatch(/^\/ace\/cmd\//);
    expect(state.get().nowPlaying).toMatchObject({
      id: X,
      dev: 'dev-visor-web-1',
      token: 'visor-web-1',
    });
    expect(events.of('stream.ready')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-web-1'],
        url: grant.url,
        protocol: 'mpegts',
      },
    ]);
    expect(events.of('playback.activity').at(-1)).toEqual({
      watching: true,
      hashes: [X],
      viewers: 1,
    });

    /* Reengancharse: la misma sesión, sin otra meta ni otro mando (B-008). */
    const claimedAt = state.get().nowPlaying?.at;
    await setup.clock.advanceAsync(1000);
    const again = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    expect(again.session.id).toBe(grant.session.id);
    expect(metrics(setup).sessionsOpened).toBe(1);
    expect(state.get().nowPlaying?.at).toBe(claimedAt);

    const released = await runtime.service.release(
      grant.session.id,
      { viewer: 'visor-web-1', reason: 'user' },
      web('visor-web-1'),
    );
    expect(released).toEqual({ released: true, sessionClosed: true });
    expect(metrics(setup)).toMatchObject({ sessionsOpen: 0, sessionsStopped: 1, stopsReceived: 1 });
    expect(state.sessions().read().sessions).toEqual([]);
    expect(state.get().nowPlaying).toBeNull();
    expect(events.of('playback.activity').at(-1)).toEqual({
      watching: false,
      hashes: [],
      viewers: 0,
    });
    expect(runtime.inspect()).toMatchObject({ sessions: [], viewers: [], ticking: false });
    expect(setup.clock.pendingTimers()).toBe(0);

    /* Soltar dos veces no rompe nada; una sesión que nunca existió, 404. */
    expect(
      await runtime.service.release(
        grant.session.id,
        { viewer: 'visor-web-1', reason: 'pagehide' },
        web('visor-web-1'),
      ),
    ).toEqual({ released: false, sessionClosed: false });
    expect(
      await codeOf(
        runtime.service.release(
          's_noexiste0001',
          { viewer: 'visor-web-1', reason: 'user' },
          web('x'),
        ),
      ),
    ).toBe('session_not_found');
  });

  it('el códec sale del veredicto del comprobador o del reproductor (§6.3)', async () => {
    const verdict = {
      hash: X,
      state: 'playable',
      reason: '',
      by: 'scanner',
      checkedAt: 0,
      videoCodec: 'h264',
      audioCodecs: ['aac', 'mp2'],
      playableOn: 'all',
    } as unknown as SourceVerdict;
    const { runtime } = await setupPlayback({ verdicts: new Map([[X, verdict]]) });
    const grant = await runtime.service.acquire(
      X,
      query({ mode: 'stable' }),
      web('visor-web-1'),
      live(),
    );
    expect(grant.codec).toEqual({ video: 'h264', audio: 'aac', source: 'scanner' });
    expect(grant.latency).toEqual({
      mode: 'stable',
      initialBufferS: 10,
      rebuildS: 12,
      liveSync: null,
    });
  });

  /* La parte de servidor de T-083 (1-2) de la 0.6.59: un hash externo que no
     abre como Content ID se reintenta UNA vez como infohash (el resto de
     T-083 es texto de index.html: Fase 2). */
  it('kind auto: prueba id y, si el motor no abre, una vez infohash (P6)', async () => {
    const setup = await setupPlayback({ unknownContent: 'fail' });
    const ih = contentIdToInfohash(X);
    const grant = await setup.runtime.service.acquire(ih, query(), web('visor-web-1'), live());
    expect(grant.url).toContain(`/ace/r/${ih}/`);
    expect(setup.state.sessions().read().sessions[0]?.kind).toBe('infohash');
    expect(metrics(setup).requestsByRoute.getstream).toBe(2);
    /* Con kind=id no hay segundo intento. */
    const other = contentIdToInfohash(Y);
    const code = await codeOf(
      setup.runtime.service.acquire(other, query({ kind: 'id' }), web('visor-web-2'), live()),
    );
    expect(code).toBe('source_no_peers');
    expect(metrics(setup).requestsByRoute.getstream).toBe(3);
  });

  /* Verificación del backend (23-09-2026): B-009 dice "UNA sola vez" y el
     test de arriba solo veía el caso en que el segundo intento funciona. */
  it('kind auto: si tampoco abre como infohash, no hay tercer intento (B-009)', async () => {
    const setup = await setupPlayback({ unknownContent: 'fail' });
    const code = await codeOf(
      setup.runtime.service.acquire('e'.repeat(40), query(), web('visor-web-1'), live()),
    );
    expect(code).toBe('source_no_peers');
    expect(metrics(setup).requestsByRoute.getstream).toBe(2);
    expect(setup.runtime.inspect().sessions).toEqual([]);
  });

  it('un motor caído da engine_unavailable y no deja nada abierto', async () => {
    const setup = await setupPlayback();
    await setup.fakeEngine.control.setMode('*', { kind: 'down', how: 'refuse' });
    expect(
      await codeOf(setup.runtime.service.acquire(X, query(), web('visor-web-1'), live())),
    ).toBe('engine_unavailable');
    expect(setup.runtime.inspect().sessions).toEqual([]);
    expect(setup.state.sessions().read().sessions).toEqual([]);
  });
});

describe('latido de 45 s (D5.1, arquitectura §5.6)', () => {
  it('con latido sigue; sin latido en 45 s se da por ido, stop y 410 después', async () => {
    const setup = await setupPlayback();
    const { runtime, clock, events } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1', 'pc-1'), live());
    const sid = grant.session.id;
    await advanceParked(clock, 40_000, { step: 2000 });
    const beat = await runtime.service.heartbeat(
      sid,
      { viewer: 'visor-web-1', playing: true },
      web('visor-web-1'),
    );
    expect(beat).toEqual({
      session: grant.session,
      url: grant.url,
      protocol: 'mpegts',
      viewers: 1,
    });
    await advanceParked(clock, 44_000, { step: 2000 });
    expect(runtime.service.isViewerAlive(sid, 'pc-1')).toBe(true);
    expect(runtime.inspect().sessions).toHaveLength(1);
    await advanceParked(clock, 4000, { step: 2000 });
    await runtime.idle();
    expect(runtime.service.isViewerAlive(sid, 'pc-1')).toBe(false);
    expect(runtime.inspect().sessions).toEqual([]);
    expect(metrics(setup)).toMatchObject({ sessionsOpen: 0, sessionsStopped: 1 });
    expect(events.of('stream.closed')).toEqual([
      { sessionId: sid, viewerIds: ['visor-web-1'], reason: 'expired' },
    ]);
    expect(
      await codeOf(runtime.service.heartbeat(sid, { viewer: 'visor-web-1' }, web('visor-web-1'))),
    ).toBe('session_expired');
    expect(
      await codeOf(
        runtime.service.heartbeat('s_nuncaexistio', { viewer: 'visor-web-1' }, web('x')),
      ),
    ).toBe('session_not_found');
    expect(clock.pendingTimers()).toBe(0);
  });

  it('un latido de otro visor o de otro dispositivo no vale', async () => {
    const { runtime } = await setupPlayback();
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1', 'iphone-1'),
      live(),
    );
    expect(
      await codeOf(
        runtime.service.heartbeat(grant.session.id, { viewer: 'otro-visor' }, web('otro-visor')),
      ),
    ).toBe('session_expired');
    expect(
      await codeOf(
        runtime.service.heartbeat(
          grant.session.id,
          { viewer: 'visor-ios-1' },
          ios('visor-ios-1', 'iphone-2'),
        ),
      ),
    ).toBe('session_not_found');
    expect(
      await runtime.service.release(
        grant.session.id,
        { viewer: 'visor-ios-1', reason: 'user' },
        ios('visor-ios-1', 'iphone-2'),
      ),
    ).toEqual({ released: false, sessionClosed: false });
  });
});

describe('cambio de canal sin carreras (arquitectura §5.6)', () => {
  it('varias peticiones seguidas del mismo visor: solo abre la última y nunca hay dos sesiones', async () => {
    const setup = await setupPlayback();
    const { runtime } = setup;
    await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    const results = await Promise.allSettled([
      runtime.service.acquire(Y, query(), web('visor-web-1'), live()),
      runtime.service.acquire(Z, query(), web('visor-web-1'), live()),
      runtime.service.acquire(X, query(), web('visor-web-1'), live()),
      runtime.service.acquire(Y, query(), web('visor-web-1'), live()),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    const last = results[3] as PromiseFulfilledResult<{ url: string }>;
    expect(last.value.url).toContain(contentIdToInfohash(Y));
    await runtime.idle();
    const m = metrics(setup);
    expect(m.sessionsOpen).toBe(1);
    expect(m.sessionsOpenByContent).toEqual({ [contentIdToInfohash(Y)]: 1 });
    /* X se paró antes de abrir Y: el motor no tuvo que matar nada. */
    expect(m.sessionsSuperseded).toBe(0);
    expect(m.sessionsOpened).toBe(2);
    expect(runtime.inspect().sessions.map((session) => session.hash)).toEqual([Y]);
    expect(runtime.inspect().viewerQueues).toBe(0);
  });

  it('canales distintos en dos dispositivos: traspaso con aviso al momento y stop antes de abrir', async () => {
    const setup = await setupPlayback();
    const { runtime, events, state } = setup;
    const first = await runtime.service.acquire(
      X,
      query({ title: 'Uno' }),
      web('visor-tv', 'tv'),
      live(),
    );
    const second = await runtime.service.acquire(
      Y,
      query({ title: 'Dos' }),
      web('visor-movil', 'movil'),
      live(),
    );
    expect(second.handoff).toBe(true);
    expect(events.of('playback.handoff')).toEqual([
      {
        sessionId: first.session.id,
        viewerIds: ['visor-tv'],
        byDeviceId: 'movil',
        byClient: 'web',
        hash: Y,
        title: 'Dos',
        reason: 'other_channel',
        byDeviceName: 'Navegador',
      },
    ]);
    expect(metrics(setup)).toMatchObject({
      sessionsOpen: 1,
      sessionsStopped: 1,
      sessionsSuperseded: 0,
    });
    expect(state.get().nowPlaying).toMatchObject({ id: Y, dev: 'movil', title: 'Dos' });
    expect(
      await codeOf(
        runtime.service.heartbeat(first.session.id, { viewer: 'visor-tv' }, web('visor-tv')),
      ),
    ).toBe('session_expired');
  });
});

describe('mismo canal: share y handoff (D5)', () => {
  it('share: el segundo se une, la sesión pasa a HLS y el primero recibe stream.modeChanged', async () => {
    const setup = await setupPlayback({ policy: 'share' });
    const { runtime, events } = setup;
    const first = await runtime.service.acquire(X, query(), web('visor-tv', 'tv'), live());
    const second = await runtime.service.acquire(X, query(), web('visor-movil', 'movil'), live());
    expect(second.session.id).toBe(first.session.id);
    expect(second.handoff).toBe(false);
    expect(second.protocol).toBe('hls');
    expect(second.url).toMatch(/^\/ace\/m\/.+\.m3u8$/);
    expect(events.of('stream.modeChanged')).toEqual([
      {
        sessionId: first.session.id,
        viewerIds: ['visor-tv'],
        from: 'mpegts',
        to: 'hls',
        url: second.url,
        reason: 'shared',
      },
    ]);
    expect(second.latency.liveSync).toEqual({ targetS: 6, maxS: 14, rate: 1.03 });
    const beat = await runtime.service.heartbeat(
      first.session.id,
      { viewer: 'visor-tv' },
      web('visor-tv'),
    );
    expect(beat).toMatchObject({ url: second.url, protocol: 'hls', viewers: 2 });
    expect(metrics(setup)).toMatchObject({ sessionsOpen: 1, sessionsOpened: 2 });
    expect(setup.state.sessions().read().sessions[0]).toMatchObject({ mode: 'hls' });
    /* Un tercero ya no cambia nada. */
    await runtime.service.acquire(X, query(), web('visor-3', 'portatil'), live());
    expect(metrics(setup).sessionsOpened).toBe(2);
    await runtime.service.release(
      first.session.id,
      { viewer: 'visor-movil', reason: 'user' },
      web('visor-movil'),
    );
    await runtime.service.release(
      first.session.id,
      { viewer: 'visor-3', reason: 'user' },
      web('visor-3'),
    );
    expect(metrics(setup).sessionsOpen).toBe(1);
    const last = await runtime.service.release(
      first.session.id,
      { viewer: 'visor-tv', reason: 'user' },
      web('visor-tv'),
    );
    expect(last).toEqual({ released: true, sessionClosed: true });
    expect(metrics(setup).sessionsOpen).toBe(0);
  });

  it('handoff: el último manda, el otro recibe playback.handoff y la sesión se reabre para él', async () => {
    const setup = await setupPlayback({ policy: 'handoff' });
    const { runtime, events } = setup;
    const first = await runtime.service.acquire(X, query(), web('visor-tv', 'tv'), live());
    const second = await runtime.service.acquire(
      X,
      query({ title: 'Partido' }),
      web('visor-movil', 'movil'),
      live(),
    );
    expect(second.handoff).toBe(true);
    expect(second.protocol).toBe('mpegts');
    expect(second.session.id).not.toBe(first.session.id);
    expect(events.of('playback.handoff')).toEqual([
      expect.objectContaining({
        sessionId: first.session.id,
        viewerIds: ['visor-tv'],
        reason: 'same_channel',
        byDeviceId: 'movil',
      }),
    ]);
    expect(metrics(setup)).toMatchObject({
      sessionsOpen: 1,
      sessionsStopped: 1,
      sessionsSuperseded: 0,
    });
    expect(runtime.service.status().sessions).toHaveLength(1);
  });
});

describe('iOS: remux sobre la sesión del backend (arquitectura §5.7, D5.3)', () => {
  it('el iPhone recibe la lista de /native/api/v1/video y ffmpeg lee la playbackUrl', async () => {
    const setup = await setupPlayback();
    const { runtime, ffmpeg } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios', mode: 'low' }),
      ios('visor-ios-1'),
      live(),
    );
    expect(StreamGrantSchema.parse(grant)).toEqual(grant);
    expect(grant).toMatchObject({
      url: `/native/api/v1/video/${grant.session.id}/index.m3u8`,
      protocol: 'hls-fmp4',
      remux: true,
      latency: { mode: 'low', liveSync: null, ios: IOS_PLAYBACK_PROFILES_080.low },
    });
    expect(ffmpeg.last().input).toMatch(/\/ace\/r\//);
    expect(ffmpeg.last().sessionId).toBe(grant.session.id);
    /* Un segundo iPhone comparte el mismo ffmpeg: sigue habiendo un solo consumidor. */
    await runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-2', 'ipad'), live());
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(runtime.inspect().sessions[0]?.mode).toBe('progressive');
    await runtime.service.releaseDevice('iphone-1');
    await runtime.service.releaseDevice('ipad');
    expect(ffmpeg.alive()).toBe(0);
    expect(metrics(setup).sessionsOpen).toBe(0);
  });

  it('C.4 encendido: iPhone primero + web → la web lee el remux, el motor sigue en progresivo con un lector', async () => {
    const setup = await setupPlayback({ shareViaRemux: true });
    const { runtime, ffmpeg, events } = setup;
    await runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), live());
    const pc = await runtime.service.acquire(
      X,
      query({ mode: 'low' }),
      web('visor-pc', 'pc'),
      live(),
    );
    expect(pc).toMatchObject({
      url: `/api/v1/video/${pc.session.id}/index.m3u8`,
      protocol: 'hls',
      remux: true,
      /* TD 1 del ffmpeg falso: «Baja latencia» a 4 s en la web (REMUX_WEB_MIN_S). */
      latency: { liveSync: { targetS: 4, maxS: 7, rate: 1.05 } },
    });
    await runtime.idle();
    expect(runtime.inspect().sessions[0]?.mode).toBe('progressive');
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(events.of('stream.modeChanged')).toEqual([]);
    /* La reconexión de la web no la suelta (consumes pegajoso) aunque se vaya el iPhone. */
    await runtime.service.releaseDevice('iphone-1');
    const again = await runtime.service.acquire(X, query(), web('visor-pc', 'pc'), live());
    expect(again.session.id).toBe(pc.session.id);
    expect(again.url).toBe(pc.url);
    expect(ffmpeg.spawned).toHaveLength(1);
    expect(runtime.inspect().sessions[0]?.mode).toBe('progressive');
  });

  it('C.4 encendido pero la web primero: como hoy (el motor pasa a HLS)', async () => {
    const setup = await setupPlayback({ shareViaRemux: true });
    const { runtime } = setup;
    const pc = await runtime.service.acquire(X, query(), web('visor-pc', 'pc'), live());
    expect(pc.protocol).toBe('mpegts');
    await runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), live());
    await runtime.idle();
    expect(runtime.inspect().sessions[0]?.mode).toBe('hls');
  });

  it('una web que se une al iPhone: la sesión pasa a HLS y el remux se relanza sobre ella', async () => {
    const setup = await setupPlayback();
    const { runtime, ffmpeg, events } = setup;
    const phone = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1'),
      live(),
    );
    const pc = await runtime.service.acquire(X, query(), web('visor-pc', 'pc'), live());
    expect(pc.protocol).toBe('hls');
    await runtime.idle();
    expect(ffmpeg.spawned).toHaveLength(2);
    expect(ffmpeg.spawned[0]?.killed).toBe(true);
    expect(ffmpeg.last().input).toContain(pc.url);
    expect(events.of('stream.modeChanged')).toEqual([]);
    expect(events.of('stream.reopened')).toEqual([
      {
        sessionId: phone.session.id,
        viewerIds: ['visor-ios-1'],
        url: phone.url,
        protocol: 'hls-fmp4',
        reason: 'remux_restart',
      },
    ]);
    await runtime.service.release(
      phone.session.id,
      { viewer: 'visor-ios-1', reason: 'user' },
      ios('visor-ios-1'),
    );
    expect(ffmpeg.alive()).toBe(0);
    expect(metrics(setup).sessionsOpen).toBe(1);
  });

  it('cada petición de segmento cuenta como latido del iPhone', async () => {
    const setup = await setupPlayback();
    const { runtime, clock } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1', 'iphone-1'),
      live(),
    );
    /* Lo que hace la ruta /api/v1/video al servir un fichero. */
    const bare = Fastify();
    bare.get('/segmento', async (_request, reply) => {
      await setup.remux.service.serveFile(reply, grant.session.id, 'init.mp4', {
        deviceId: 'iphone-1',
      });
      return reply;
    });
    for (let index = 0; index < 5; index += 1) {
      await advanceParked(clock, 20_000, { step: 2000 });
      expect((await bare.inject({ method: 'GET', url: '/segmento' })).statusCode).toBe(200);
    }
    await runtime.idle();
    expect(runtime.service.isViewerAlive(grant.session.id, 'iphone-1')).toBe(true);
    expect(runtime.service.isViewerAlive(grant.session.id, 'otro')).toBe(false);
    await bare.close();
  });

  it('un iPhone desde la web (sin dispositivo emparejado) usa /remux/<hash>/index.m3u8', async () => {
    const { runtime } = await setupPlayback();
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      web('visor-safari', 'safari'),
      live(),
    );
    expect(grant.url).toBe(`/remux/${X}/index.m3u8`);
  });

  it('si el cliente cuelga mientras se prepara el remux: se suelta todo', async () => {
    const setup = await setupPlayback({ launcher: { autoSegments: null } });
    const { runtime, clock, ffmpeg } = setup;
    const controller = new AbortController();
    const pending = codeOf(
      runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), controller.signal),
    );
    await parked(clock, 2);
    expect(ffmpeg.spawned).toHaveLength(1);
    controller.abort(new Error('client_closed'));
    expect(await pending).toBe('session_expired');
    await runtime.idle();
    expect(ffmpeg.alive()).toBe(0);
    expect(metrics(setup).sessionsOpen).toBe(0);
    expect(runtime.inspect().viewers).toEqual([]);
  });

  it('remux lleno: 503 remux_busy y la sesión del motor se para', async () => {
    const setup = await setupPlayback();
    for (let n = 4; n <= 6; n += 1) {
      await setup.remux.service.ensure(
        {
          sessionId: `s_ocupada000${n}`,
          hash: demoContentId(n),
          playbackUrl: `/ace/r/x/${n}`,
          mode: 'progressive',
        },
        `ocupa-${n}`,
      );
    }
    expect(
      await codeOf(
        setup.runtime.service.acquire(X, query({ client: 'ios' }), ios('visor-ios-1'), live()),
      ),
    ).toBe('remux_busy');
    await setup.runtime.idle();
    expect(metrics(setup).sessionsOpen).toBe(0);
  });
});

describe('recuperación tras reiniciar el motor (arquitectura §5.5)', () => {
  it('el motor vuelve sin sesiones: se reabre para quien la seguía queriendo (stream.reopened)', async () => {
    const setup = await setupPlayback();
    const { runtime, core, events, fakeEngine, engineClock } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    const restarted = fakeEngine.control.restart({ downMs: 5000 });
    core.bus.emit('engine.status', engineStatus('restarting'));
    engineClock.advance(5000);
    await restarted;
    core.bus.emit('engine.status', engineStatus('online'));
    await runtime.idle();
    const reopened = events.of('stream.reopened');
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({
      sessionId: grant.session.id,
      viewerIds: ['visor-web-1'],
      protocol: 'mpegts',
      reason: 'engine_restart',
    });
    expect(reopened[0]?.url).not.toBe(grant.url);
    expect(metrics(setup)).toMatchObject({ sessionsLostInRestart: 1, sessionsOpen: 1 });
    const beat = await runtime.service.heartbeat(
      grant.session.id,
      { viewer: 'visor-web-1' },
      web('visor-web-1'),
    );
    expect(beat.url).toBe(reopened[0]?.url);
  });

  it('tras un bache sin reinicio la sesión sigue viva y no se toca', async () => {
    const setup = await setupPlayback();
    const { runtime, core, events } = setup;
    await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    core.bus.emit('engine.status', engineStatus('online'));
    core.bus.emit('engine.status', engineStatus('offline'));
    core.bus.emit('engine.status', engineStatus('online'));
    await runtime.idle();
    expect(events.of('stream.reopened')).toEqual([]);
    expect(metrics(setup).sessionsOpened).toBe(1);
  });

  it('si al volver no se puede reabrir: stream.closed engine_failed y nada abierto', async () => {
    const setup = await setupPlayback();
    const { runtime, core, events, fakeEngine } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    const restarted = fakeEngine.control.restart({ downMs: 0 });
    setup.engineClock.advance(0);
    await restarted;
    await fakeEngine.control.setMode(X, 'failedContent');
    core.bus.emit('engine.status', engineStatus('restarting'));
    core.bus.emit('engine.status', engineStatus('online'));
    await runtime.idle();
    expect(events.of('stream.closed')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-web-1'],
        reason: 'engine_failed',
        code: 'source_no_peers',
      },
    ]);
    expect(runtime.inspect().sessions).toEqual([]);
  });

  it('el motor dice que ya no conoce la sesión: se reabre, con tope', async () => {
    const setup = await setupPlayback();
    const { runtime, events, fakeEngine } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    for (let round = 0; round < 4; round += 1) {
      await fakeEngine.control.reset({ sessions: true });
      runtime.tick();
      await runtime.idle();
    }
    const reopened = events.of('stream.reopened');
    expect(reopened).toHaveLength(3);
    expect(reopened.every((event) => event.reason === 'engine_recovered')).toBe(true);
    expect(events.of('stream.closed')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-web-1'],
        reason: 'engine_failed',
        code: 'session_expired',
      },
    ]);
    expect(runtime.inspect().sessions).toEqual([]);
  });
});

describe('estadísticas por SSE cada 2 s (arquitectura §5.6)', () => {
  it('stat_url del motor → stream.stats para los visores de la sesión', async () => {
    const setup = await setupPlayback();
    const { runtime, clock, events } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    await advanceParked(clock, 2000, { step: 2000 });
    await runtime.idle();
    const stats = events.of('stream.stats');
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ sessionId: grant.session.id, viewerIds: ['visor-web-1'] });
    expect(typeof stats[0]?.peers).toBe('number');
    expect(stats[0]?.status).toMatch(/dl|prebuf/);
  });
});

describe('arranque y apagado (arquitectura §5.16)', () => {
  it('al arrancar para las sesiones que quedaron en v2/sessions.json', async () => {
    const setup = await setupPlayback({ noStart: true });
    const client = setup.engine.client();
    const orphan = await client.openSession({ hash: Y, kind: 'id', mode: 'progressive' });
    await setup.state.sessions().update((draft) => {
      draft.sessions.push({
        id: 's_huerfana0001',
        hash: Y,
        kind: 'id',
        mode: 'progressive',
        commandUrl: orphan.commandUrl,
        openedAt: new Date(0).toISOString(),
      });
    });
    expect(metrics(setup).sessionsOpen).toBe(1);
    await setup.runtime.service.recoverOrphans();
    expect(metrics(setup)).toMatchObject({ sessionsOpen: 0, sessionsStopped: 1 });
    expect(setup.state.sessions().read().sessions).toEqual([]);
    await setup.runtime.service.recoverOrphans();
  });

  it('al apagar para todas las sesiones en paralelo con 4 s de tope y avisa a los visores', async () => {
    const setup = await setupPlayback();
    const { runtime, events, clock } = setup;
    const grant = await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    await runtime.service.stopAll(4000);
    expect(events.of('stream.closed')).toEqual([
      { sessionId: grant.session.id, viewerIds: ['visor-web-1'], reason: 'shutdown' },
    ]);
    expect(metrics(setup).sessionsOpen).toBe(0);
    expect(setup.state.sessions().read().sessions).toEqual([]);
    expect(clock.pendingTimers()).toBe(0);
    expect(await codeOf(runtime.service.acquire(X, query(), web('visor-web-1'), live()))).toBe(
      'engine_unavailable',
    );
  });

  it('con el motor colgado, el apagado no espera más de 4 s', async () => {
    const setup = await setupPlayback();
    const { runtime, clock, fakeEngine } = setup;
    await runtime.service.acquire(X, query(), web('visor-web-1'), live());
    await fakeEngine.control.setMode('*', 'stall');
    let done = false;
    const stopping = runtime.service.stopAll(4000).then(() => {
      done = true;
    });
    await parked(clock, 2);
    await clock.advanceAsync(4000);
    await stopping;
    expect(done).toBe(true);
    await fakeEngine.control.clearMode('*');
  });
});

describe('revocación y dispositivos (arquitectura §5.12)', () => {
  it('devices.changed revoked suelta los visores de ese dispositivo', async () => {
    const setup = await setupPlayback();
    const { runtime, core, events } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1', 'iphone-1'),
      live(),
    );
    core.bus.emit('devices.changed', { reason: 'revoked', deviceId: 'iphone-1' });
    await runtime.idle();
    expect(events.of('stream.closed')).toEqual([
      { sessionId: grant.session.id, viewerIds: ['visor-ios-1'], reason: 'revoked' },
    ]);
    expect(runtime.service.isViewerAlive(grant.session.id, 'iphone-1')).toBe(false);
    expect(metrics(setup).sessionsOpen).toBe(0);
  });
});
