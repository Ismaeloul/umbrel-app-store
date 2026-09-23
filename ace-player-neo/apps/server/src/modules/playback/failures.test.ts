/* Fallos y casos límite del SessionManager con el motor falso: ffmpeg que
   muere, remux que no puede seguir a la sesión, paso a HLS que falla, claim
   0.6.x del mismo dispositivo que su /api/remux, y las fábricas y la
   fachada de la 0.6.59 (claimPlayback / releasePlayback). */

import { describe, expect, it } from 'vitest';
import type { ChannelStreamQuery, NowPlaying, StateV1 } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { isAppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import { createServices } from '../../services.js';
import { bindLegacyState } from '../state/legacy-binding.js';
import { createStateService } from '../state/index.js';
import type { SourceVerdict } from '../scanner/types.js';
import { createRemuxService } from '../remux/index.js';
import { createPlaybackService } from './index.js';
import { claimPlayback, releasePlayback } from './legacy-exports.js';
import { codecFor, latencyFor } from './grant.js';
import { createMemoryState, fakeScanner, setupPlayback } from './test-support.js';
import type { ViewerIdentity } from './types.js';

const X = demoContentId(1);
const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const live = (): AbortSignal => new AbortController().signal;

function query(over: Partial<ChannelStreamQuery> = {}): ChannelStreamQuery {
  return { client: 'web', kind: 'auto', mode: 'balanced', viewer: 'visor-web-1', ...over };
}

function web(viewerId: string, deviceId = `dev-${viewerId}`): ViewerIdentity {
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

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return isAppError(error) ? error.code : String((error as Error).message);
  }
}

describe('el remux falla por debajo de la sesión (arquitectura §5.7)', () => {
  it('ffmpeg muere: el iPhone recibe stream.closed remux_failed y la sesión se para', async () => {
    const setup = await setupPlayback();
    const { runtime, ffmpeg, events, fakeEngine } = setup;
    const grant = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1'),
      live(),
    );
    ffmpeg.last().exit(1);
    await runtime.idle();
    expect(events.of('stream.closed')).toEqual([
      {
        sessionId: grant.session.id,
        viewerIds: ['visor-ios-1'],
        reason: 'remux_failed',
        code: 'remux_died',
      },
    ]);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);
    expect(events.of('diagnostics.report')).toHaveLength(1);
  });

  it('el remux no puede seguir a la sesión al pasar a HLS: se suelta al iPhone y la web sigue', async () => {
    const setup = await setupPlayback();
    const { runtime, ffmpeg, events, fakeEngine } = setup;
    const phone = await runtime.service.acquire(
      X,
      query({ client: 'ios' }),
      ios('visor-ios-1'),
      live(),
    );
    ffmpeg.setMissing(true);
    const pc = await runtime.service.acquire(X, query(), web('visor-pc'), live());
    await runtime.idle();
    expect(pc.protocol).toBe('hls');
    expect(events.of('stream.closed')).toEqual([
      {
        sessionId: phone.session.id,
        viewerIds: ['visor-ios-1'],
        reason: 'remux_failed',
        code: 'ffmpeg_missing',
      },
    ]);
    expect(runtime.inspect().sessions[0]?.viewers).toEqual(['visor-pc']);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(1);
  });

  it('si el paso a HLS falla, el que llega recibe el error y el primero sigue como estaba', async () => {
    const setup = await setupPlayback();
    const { runtime, fakeEngine, events } = setup;
    const first = await runtime.service.acquire(X, query(), web('visor-tv'), live());
    await fakeEngine.control.setMode(X, 'failedContent');
    expect(await codeOf(runtime.service.acquire(X, query(), web('visor-movil'), live()))).toBe(
      'source_no_peers',
    );
    expect(events.of('stream.modeChanged')).toEqual([]);
    expect(runtime.inspect().sessions).toEqual([
      expect.objectContaining({ id: first.session.id, mode: 'progressive', viewers: ['visor-tv'] }),
    ]);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(1);
  });
});

describe('0.6.x: claim y /api/remux del mismo dispositivo (B-005, B-217)', () => {
  it('el claim de un iPhone 0.6.x no le quita su propio remux; el de otro dispositivo sí', async () => {
    const setup = await setupPlayback();
    const { runtime, fakeEngine, events } = setup;
    const res = await runtime.service.legacyRemux(
      new URLSearchParams({ id: X, dev: 'movil' }),
      live(),
    );
    expect(res.url).toBe(`/remux/${X}/index.m3u8`);
    await runtime.service.legacyClaim({ id: X, dev: 'movil', title: 'Canal' });
    await runtime.idle();
    expect(events.of('playback.handoff')).toEqual([]);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(1);
    await runtime.service.legacyClaim({ id: X, dev: 'tele', title: 'Canal' });
    await runtime.idle();
    expect(events.of('playback.handoff')).toEqual([
      expect.objectContaining({
        viewerIds: ['lr_movil'],
        byClient: 'legacy',
        reason: 'same_channel',
      }),
    ]);
    expect(fakeEngine.control.metrics().sessionsOpen).toBe(0);
    expect(setup.ffmpeg.alive()).toBe(0);
  });

  it('un /api/remux sin dev también funciona (visor anónimo)', async () => {
    const setup = await setupPlayback();
    const res = await setup.runtime.service.legacyRemux(new URLSearchParams({ id: X }), live());
    expect(res.token).toMatch(/^[a-f0-9]{16}$/);
    expect(setup.runtime.inspect().viewers[0]).toMatch(/^lr_/);
  });
});

describe('piezas de la respuesta (§6.3)', () => {
  it('latencia por modo y protocolo; códec desconocido si el veredicto no lo trae o falla', () => {
    expect(latencyFor('low', 'hls')).toEqual({
      mode: 'low',
      initialBufferS: 3,
      rebuildS: 4,
      liveSync: { targetS: 3, maxS: 7, rate: 1.05 },
    });
    const empty = { videoCodec: null, audioCodecs: [], by: 'player' } as unknown as SourceVerdict;
    expect(codecFor(fakeScanner(new Map([[X, empty]])), X).source).toBe('unknown');
    const player = {
      videoCodec: 'hevc',
      audioCodecs: [],
      by: 'player',
    } as unknown as SourceVerdict;
    expect(codecFor(fakeScanner(new Map([[X, player]])), X)).toEqual({
      video: 'hevc',
      audio: 'unknown',
      source: 'player',
    });
    const broken = fakeScanner();
    (broken as unknown as { verdict: () => never }).verdict = () => {
      throw new Error('comprobador roto');
    };
    expect(codecFor(broken, X).source).toBe('unknown');
  });
});

describe('fábricas y ciclo de vida', () => {
  it('createServices monta playback y remux reales sin abrir nada hasta que se pide', async () => {
    const core = createTestCore();
    const services = createServices(core, { state: createMemoryState() });
    expect(services.remux.stats()).toMatchObject({ sessions: 0, max: 3 });
    expect(services.playback.status().sessions).toEqual([]);
    await services.playback.start();
    await services.playback.start();
    await services.remux.start();
    await services.playback.stop();
    await services.remux.stop();
    expect(core.clock.pendingTimers()).toBe(0);
    const direct = createPlaybackService({
      ...core,
      engine: services.engine,
      remux: createRemuxService({ ...core, engine: services.engine, procRoot: null }),
      state: createMemoryState(),
      scanner: fakeScanner(),
    });
    expect(direct.isViewerAlive('s_nada00000', 'x')).toBe(false);
    expect(direct.legacyStatus()).toMatchObject({ nowPlaying: null, learningCount: 0 });
  });

  it('un estado que falla no rompe el mando ni las sesiones', async () => {
    const setup = await setupPlayback({ state: createMemoryState() });
    const broken = setup.state as unknown as Record<string, unknown>;
    broken.sessions = () => {
      throw new Error('disco lleno');
    };
    const grant = await setup.runtime.service.acquire(X, query(), web('visor-web-1'), live());
    expect(grant.protocol).toBe('mpegts');
    await setup.runtime.service.recoverOrphans();
    await setup.runtime.service.release(
      grant.session.id,
      { viewer: 'visor-web-1', reason: 'user' },
      web('visor-web-1'),
    );
    expect(setup.fakeEngine.control.metrics().sessionsOpen).toBe(0);
  });
});

describe('fachada de la 0.6.59: claimPlayback y releasePlayback (T-037, T-038)', () => {
  it('mismas entradas y salidas; con un estado enlazado lo escriben', async () => {
    const empty = { nowPlaying: null } as unknown as StateV1;
    const first = claimPlayback(empty, { id: ID_A, dev: 'movil', token: 'fachada-1' });
    expect(first).toEqual({
      success: true,
      nowPlaying: expect.objectContaining({ id: ID_A, dev: 'movil', token: 'fachada-1' }),
    });
    const withA = { nowPlaying: first.nowPlaying } as unknown as StateV1;
    const second = claimPlayback(withA, { id: ID_B, dev: 'tele' });
    expect((second.nowPlaying as NowPlaying).at).toBeGreaterThan(
      (first.nowPlaying as NowPlaying).at,
    );
    expect(releasePlayback(withA, { id: ID_B, dev: 'tele' })).toEqual({
      success: true,
      released: false,
    });
    expect(releasePlayback(withA, { id: ID_A, dev: 'movil', token: 'fachada-1' })).toEqual({
      success: true,
      released: true,
    });
    expect(claimPlayback(empty, { id: ID_A, dev: 'movil', token: 'fachada-1' })).toEqual({
      success: true,
      nowPlaying: null,
      ignored: true,
    });
    expect(() => claimPlayback(empty, { id: ID_A })).toThrow('bad_request');

    const core = createTestCore();
    const state = createStateService(core);
    await state.load();
    bindLegacyState(state);
    try {
      const written = claimPlayback(state.get() as StateV1, {
        id: ID_A,
        dev: 'pc',
        token: 'fachada-2',
      });
      expect(state.get().nowPlaying).toEqual(written.nowPlaying);
      releasePlayback(state.get() as StateV1, { id: ID_A, dev: 'pc', token: 'fachada-2' });
      expect(state.get().nowPlaying).toBeNull();
    } finally {
      bindLegacyState(null);
    }
  });
});
