/* El driver de una película con un <video> simulado (docs/vod.md §12.7): la
   petición, los errores, la reconexión única y el reloj de la demo. */

import type { VodGrant } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeVideo } from '../testing.ts';
import { VodDriver, type VodHost } from './driver.ts';

const ID = 'c1d2e3f4a5b60718293a4b5c6d7e8f9012345678';

function grant(extra: Partial<VodGrant['vod']> = {}): VodGrant {
  return {
    session: { id: 's_x', heartbeatMs: 15_000, expiresAfterMs: 45_000 },
    url: '/api/v1/video/s_x/index.m3u8',
    protocol: 'hls',
    remux: true,
    source: 'iptv',
    codec: { video: 'h264', audio: 'aac', source: 'ffprobe' },
    latency: { mode: 'balanced', initialBufferS: 3, rebuildS: 3, liveSync: null },
    stats: { via: 'sse' },
    handoff: false,
    vod: {
      id: ID,
      kind: 'movie',
      seriesId: null,
      title: 'Dune',
      subtitle: null,
      durationS: 600,
      startS: 120,
      resumed: true,
      audio: [],
      audioIndex: 0,
      video: { codec: 'h264', codecs: 'avc1.640028', width: null, height: null },
      next: null,
      poster: null,
      ...extra,
    },
  } as VodGrant;
}

function make(
  options: { demo?: boolean; playing?: boolean; seekMedia?: VodHost['seekMedia'] } = {},
) {
  const sent: Array<{ event: string; posS: number; keepalive: boolean }> = [];
  const video = new FakeVideo();
  const notices: Array<{ text: string; action?: string }> = [];
  const state = { playing: options.playing ?? true, endedCalls: 0 };
  const host: VodHost = {
    video,
    demo: () => options.demo === true,
    playing: () => state.playing,
    seekMedia:
      options.seekMedia ??
      (async (target) => {
        video.currentTime = target;
      }),
    notify: (text, opts) => {
      notices.push({ text, ...(opts?.action ? { action: opts.action.label } : {}) });
    },
    publish: () => {},
    playNext: () => {},
    idle: () => {},
    leave: () => {},
    demoEnded: () => {
      state.endedCalls += 1;
      driver.onEnded();
    },
  };
  const driver = new VodDriver(
    host,
    { id: ID, kind: 'movie', title: 'Dune' },
    {
      send: async (_id, body, opts) => {
        sent.push({ event: body.event, posS: body.posS, keepalive: opts.keepalive === true });
      },
    },
  );
  return { driver, video, notices, state, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('VodDriver', () => {
  it('sin posición pedida no manda `start` (la decide el servidor); al reconectar, donde iba', () => {
    const { driver } = make();
    const base = { client: 'web' as const, viewer: 'v', device: 'd' };
    expect(driver.streamQuery(base, false)).toEqual({ ...base, hevc: '0' });
    driver.accept(grant());
    driver.positionS = 321.04;
    expect(driver.takeReconnect()).toBe(true);
    // Y con la pista que sonaba.
    expect(driver.streamQuery(base, true)).toEqual({ ...base, hevc: '1', start: 321, audio: 0 });
    // Solo una reconexión automática.
    expect(driver.takeReconnect()).toBe(false);
  });

  it('vod_busy con retryAfterS: un reintento solo; los demás vod_*, al momento y sin reintentos', () => {
    const { driver } = make();
    expect(driver.planError('vod_busy', 4, true)).toEqual({ kind: 'busy-retry', delayMs: 4000 });
    expect(driver.planError('vod_busy', 4, true)).toEqual({ kind: 'fail', retryable: false });
    expect(driver.planError('vod_timeout', undefined, true)).toEqual({
      kind: 'fail',
      retryable: false,
    });
    expect(driver.planError('network', undefined, true)).toEqual({ kind: 'fail', retryable: true });
  });

  it('«Reanudado en 2:00» con «Empezar desde el principio» la primera vez', () => {
    const { driver, notices } = make();
    driver.accept(grant());
    driver.onFirstFrame();
    driver.onFirstFrame();
    expect(notices).toEqual([{ text: 'Reanudado en 2:00', action: 'Empezar desde el principio' }]);
  });

  it('demo: el reloj avanza sonando, salta al momento y para al final con «Terminada»', () => {
    const { driver, state } = make({ demo: true });
    driver.accept(grant({ startS: 0, resumed: false }));
    driver.onFirstFrame();
    vi.advanceTimersByTime(2_000);
    driver.measure();
    expect(driver.positionS).toBeCloseTo(2, 1);
    void driver.seekTo(595);
    expect(driver.snapshot()?.positionS).toBe(595);
    vi.advanceTimersByTime(6_000);
    driver.measure();
    expect(state.endedCalls).toBe(1);
    expect(driver.snapshot()?.ended).toBe(true);
  });

  it('el cabezal del <video> manda fuera de la demo (salvo durante un salto)', () => {
    const { driver, video } = make();
    driver.accept(grant());
    video._currentTime = 130;
    driver.measure();
    expect(driver.positionS).toBe(130);
  });

  it('al cerrar con un salto a medias se guarda el destino, no donde estaba', () => {
    const { driver, video, sent } = make({ seekMedia: () => new Promise<void>(() => {}) });
    driver.accept(grant());
    video._currentTime = 400;
    driver.measure();
    void driver.seekTo(90);
    driver.pageHide(false);
    expect(sent.at(-1)).toEqual({ event: 'stop', posS: 90, keepalive: true });
  });
});
