/* La sonda de un candidato con el motor inyectado (T-075, T-105) y lo nuevo
   de la 0.7.0: tope duro de 30 s, avisos de sesiones sin parar y
   `playableOn`. Reloj falso: nada espera de verdad. */

import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../core/clock.js';
import * as legacy from './legacy-exports.js';
import { probeAceCandidate, type ProbeLeak, type ProbeOptions } from './probe.js';
import { tickUntil } from './test-support.js';
import type { ScannerRequestResult, ScannerSampleResult } from './transport.js';

const ID_A = 'a'.repeat(40);

const meta = (overrides: Record<string, unknown> = {}): ScannerRequestResult => ({
  statusCode: 200,
  body: JSON.stringify({
    response: {
      playback_url: `http://127.0.0.1:6878/ace/getstream?infohash=${ID_A}`,
      stat_url: 'http://127.0.0.1:6878/ace/stat?token=prueba',
      command_url: 'http://127.0.0.1:6878/ace/cmd?token=prueba',
      ...overrides,
    },
  }),
});

const stat = (downloaded: number): ScannerRequestResult => ({
  statusCode: 200,
  body: JSON.stringify({ response: { peers: 7, speed_down: 4200, downloaded, status: 'dl' } }),
});

/** Espera a que la señal se aborte (una petición colgada). */
function hang<T>(signal: AbortSignal | undefined, value: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      try {
        resolve(value());
      } catch (error) {
        reject(error as Error);
      }
    };
    if (signal?.aborted) done();
    signal?.addEventListener('abort', done, { once: true });
  });
}

function run(clock: FakeClock, options: Omit<ProbeOptions, 'clock'>, ih = true) {
  return tickUntil(clock, probeAceCandidate({ id: ID_A, ih }, { clock, ...options }));
}

describe('sonda de un candidato (B-014, B-021)', () => {
  it('T-075 · el segundo motor prueba un infohash y siempre cierra su sesion', async () => {
    const clock = new FakeClock();
    const calls: string[] = [];
    let statCall = 0;
    const result = await run(clock, {
      timeoutMs: 3000,
      minBytes: 64 * 1024,
      request: async (pathname) => {
        calls.push(pathname);
        if (pathname.includes('format=json')) return meta();
        if (pathname.startsWith('/ace/stat')) {
          statCall += 1;
          return stat(statCall === 1 ? 1000 : 90000);
        }
        if (pathname.includes('method=stop')) return { statusCode: 200, body: '{}' };
        throw new Error(`peticion inesperada: ${pathname}`);
      },
      sample: async (pathname) => {
        expect(pathname).toMatch(/^\/ace\/getstream\?infohash=/);
        return { statusCode: 200, bytes: 64 * 1024, reason: 'enough_data', durationMs: 80 };
      },
      inspect: async (pathname) => {
        expect(pathname).toMatch(/^\/ace\/getstream\?infohash=/);
        return {
          mediaValid: true,
          browserCompatible: true,
          videoCodec: 'h264',
          audioCodecs: ['aac'],
          mediaReason: 'playable_media',
        };
      },
    });
    expect(result.state).toBe('working');
    expect(result.videoCodec).toBe('h264');
    expect(calls[0]).toMatch(new RegExp(`infohash=${ID_A}`));
    expect(calls.some((pathname) => pathname.includes('method=stop'))).toBe(true);
    expect(result.playableOn).toEqual({ web: true, ios: true });
    expect(result.downloadedDelta).toBe(89000);
  });

  it('T-105 · si el TS ya dice el codec, el comprobador no lanza ffprobe', async () => {
    const clock = new FakeClock();
    let inspecciones = 0;
    const result = await run(
      clock,
      {
        timeoutMs: 3000,
        minBytes: 64 * 1024,
        request: async (pathname) => {
          if (pathname.includes('format=json')) return meta();
          if (pathname.startsWith('/ace/stat')) return stat(5_000_000);
          return { statusCode: 200, body: '{}' };
        },
        sample: async () => ({
          statusCode: 200,
          bytes: 3_000_000,
          reason: 'enough_data',
          durationMs: 6000,
          rateKbps: 700,
          streamKbps: 4500,
          videoCodec: 'h264',
          audioCodecs: ['mp2'],
        }),
        inspect: async () => {
          inspecciones += 1;
          return {
            mediaValid: true,
            browserCompatible: true,
            videoCodec: 'h264',
            audioCodecs: [],
            mediaReason: 'playable_media',
          };
        },
      },
      false,
    );
    expect(inspecciones).toBe(0);
    expect(result.state).toBe('working');
    expect(result.rateKbps).toBe(700);
    expect(result.streamKbps).toBe(4500);
    expect(result.videoCodec).toBe('h264');
  });

  it('con la estadística de mitad de ventana mide la entrada del enjambre: floja si no llega al bitrate', async () => {
    const clock = new FakeClock();
    const started = clock.now();
    const stops: string[] = [];
    const result = await run(clock, {
      timeoutMs: 24_000,
      minBytes: 128 * 1024,
      sustainMs: 12_000,
      request: async (pathname) => {
        if (pathname.includes('format=json')) return meta();
        if (pathname.includes('method=stop')) {
          stops.push(pathname);
          return { statusCode: 200, body: '{}' };
        }
        /* 1 Mbit/s de entrada: el contador crece 125 000 B por segundo. */
        return stat(Math.round(((clock.now() - started) / 1000) * 125_000));
      },
      sample: async (_pathname, budget, _minBytes, _sustain, signal) => {
        await clock.sleep(budget, signal);
        return {
          statusCode: 200,
          bytes: 2_000_000,
          reason: 'enough_data',
          videoCodec: 'h264',
          streamKbps: 3000,
        };
      },
      inspect: async () => {
        throw new Error('no debería hacer falta ffprobe');
      },
    });
    expect(result.state).toBe('weak');
    expect(result.reason).toBe('starved');
    expect(result.intakeKbps).toBe(1000);
    expect(stops).toHaveLength(1);
  });

  it('sin estadística ni códec en el TS: ffprobe; si no está, "floja sin verificar"', async () => {
    const clock = new FakeClock();
    const requests: string[] = [];
    const result = await run(clock, {
      request: async (pathname) => {
        requests.push(pathname);
        return meta({ stat_url: null });
      },
      sample: async () => ({ statusCode: 200, bytes: 20_000 }),
      inspect: async () => ({
        mediaValid: false,
        browserCompatible: false,
        videoCodec: '',
        audioCodecs: [],
        mediaReason: 'probe_unavailable',
      }),
    });
    expect(result).toMatchObject({ state: 'weak', reason: 'unverified_media', intakeKbps: null });
    expect(requests.filter((pathname) => pathname.startsWith('/ace/stat'))).toEqual([]);
  });

  it('HEVC: fallida por códec para la web y reproducible en iOS (D6)', async () => {
    const clock = new FakeClock();
    const result = await run(clock, {
      request: async (pathname) => (pathname.includes('format=json') ? meta() : stat(0)),
      sample: async () => ({ statusCode: 200, bytes: 400_000, videoCodec: 'hevc' }),
      inspect: async () => {
        throw new Error('no');
      },
    });
    expect(result).toMatchObject({
      state: 'failed',
      reason: 'unsupported_codec',
      videoCodec: 'hevc',
      mediaValid: true,
      browserCompatible: false,
      playableOn: { web: false, ios: true },
    });
  });
});

describe('fallos de la sonda y sesiones que pueden quedar abiertas (§8.3.14)', () => {
  function leaksOf() {
    const leaks: ProbeLeak[] = [];
    return { leaks, onLeak: (leak: ProbeLeak) => leaks.push(leak) };
  }
  const noSample = async (): Promise<ScannerSampleResult> => {
    throw new Error('no se llega a muestrear');
  };
  const noInspect = async () => {
    throw new Error('no');
  };

  it('meta sin 2xx: engine_error, sin stop y sin fuga', async () => {
    const clock = new FakeClock();
    const { leaks, onLeak } = leaksOf();
    const requests: string[] = [];
    const result = await run(clock, {
      request: async (pathname) => {
        requests.push(pathname);
        return { statusCode: 503, body: '' };
      },
      sample: noSample,
      inspect: noInspect,
      onLeak,
    });
    expect(result).toMatchObject({ state: 'failed', reason: 'engine_error', bytes: 0 });
    expect(result.playableOn).toEqual({ web: false, ios: false });
    expect(requests).toHaveLength(1);
    expect(leaks).toEqual([]);
  });

  it('meta ilegible: engine_error y posible fuga; con error del motor no hay fuga', async () => {
    const clock = new FakeClock();
    const { leaks, onLeak } = leaksOf();
    await run(clock, {
      request: async () => ({ statusCode: 200, body: '<html>' }),
      sample: noSample,
      inspect: noInspect,
      onLeak,
    });
    expect(leaks).toEqual([{ reason: 'meta_unreadable', hash: ID_A }]);
    const failed = await run(clock, {
      request: async () => ({
        statusCode: 200,
        body: '{"response":null,"error":"failed to load content"}',
      }),
      sample: noSample,
      inspect: noInspect,
      onLeak,
    });
    expect(failed.reason).toBe('engine_error');
    expect(leaks).toHaveLength(1);
  });

  it('meta sin command_url: se prueba igual, pero se avisa de que no se podrá parar', async () => {
    const clock = new FakeClock();
    const { leaks, onLeak } = leaksOf();
    const requests: string[] = [];
    const result = await run(clock, {
      request: async (pathname) => {
        requests.push(pathname);
        return pathname.includes('format=json') ? meta({ command_url: '' }) : stat(10);
      },
      sample: async () => ({ statusCode: 200, bytes: 400_000, videoCodec: 'h264' }),
      inspect: noInspect,
      onLeak,
    });
    expect(result.state).toBe('working');
    expect(leaks).toEqual([{ reason: 'no_command_url', hash: ID_A }]);
    expect(requests.some((pathname) => pathname.includes('method=stop'))).toBe(false);
  });

  it('la meta vence el plazo: timeout y posible fuga (la sesión pudo abrirse)', async () => {
    const clock = new FakeClock();
    const { leaks, onLeak } = leaksOf();
    const result = await run(clock, {
      request: async () => {
        throw new Error('scanner_timeout');
      },
      sample: noSample,
      inspect: noInspect,
      onLeak,
    });
    expect(result.reason).toBe('timeout');
    expect(leaks).toEqual([{ reason: 'meta_timeout', hash: ID_A }]);
  });

  it('un stop que no responde se anota como fuga', async () => {
    const clock = new FakeClock();
    const { leaks, onLeak } = leaksOf();
    await run(clock, {
      request: async (pathname) => {
        if (pathname.includes('method=stop')) throw new Error('scanner_timeout');
        return pathname.includes('format=json') ? meta() : stat(0);
      },
      sample: async () => ({ statusCode: 200, bytes: 400_000, videoCodec: 'h264' }),
      inspect: noInspect,
      onLeak,
    });
    expect(leaks).toEqual([{ reason: 'stop_failed', hash: ID_A }]);
  });

  it('tope duro de 30 s con el stop dentro, aunque el motor no conteste nada', async () => {
    const clock = new FakeClock();
    const started = clock.now();
    const stops: number[] = [];
    const result = await run(clock, {
      timeoutMs: 30_000,
      request: async (pathname, _timeoutMs, signal) => {
        if (pathname.includes('format=json')) return meta();
        if (pathname.includes('method=stop')) {
          stops.push(clock.now() - started);
          return { statusCode: 200, body: '{}' };
        }
        /* La estadística se queda colgada hasta que se corte. */
        return hang(signal, () => {
          throw new Error('scanner_timeout');
        });
      },
      /* La muestra y ffprobe también se cuelgan: solo el tope los corta. */
      sample: (_pathname, _budget, _minBytes, _sustain, signal) =>
        hang(signal, () => ({ statusCode: 200, bytes: 50_000, reason: 'timeout' })),
      inspect: (_pathname, _budget, signal) =>
        hang(signal, () => ({
          mediaValid: false,
          browserCompatible: false,
          videoCodec: '',
          audioCodecs: [],
          mediaReason: 'probe_timeout',
        })),
    });
    expect(result).toMatchObject({ state: 'failed', reason: 'probe_timeout' });
    expect(result.durationMs).toBeLessThanOrEqual(27_500);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBeLessThanOrEqual(30_000);
  });

  it('el apagado corta la sonda y aun así manda el stop', async () => {
    const clock = new FakeClock();
    const controller = new AbortController();
    const stops: string[] = [];
    const promise = probeAceCandidate(
      { id: ID_A },
      {
        clock,
        signal: controller.signal,
        request: async (pathname, _t, signal) => {
          if (pathname.includes('method=stop')) {
            stops.push(pathname);
            return { statusCode: 200, body: '{}' };
          }
          if (pathname.includes('format=json')) return meta();
          return hang(signal, () => {
            throw new Error('scanner_timeout');
          });
        },
        sample: (_p, _b, _m, _s, signal) =>
          hang(signal, () => ({ statusCode: 0, bytes: 0, reason: 'timeout' })),
        inspect: noInspect,
      },
    );
    controller.abort();
    const result = await tickUntil(clock, promise);
    expect(result).toMatchObject({ state: 'failed', reason: 'timeout' });
    expect(stops).toHaveLength(1);
  });

  it('un id que no es un hash lanza bad_request', async () => {
    await expect(
      probeAceCandidate(
        { id: 'nada' },
        {
          clock: new FakeClock(),
          request: async () => ({ statusCode: 200, body: '{}' }),
          sample: noSample,
          inspect: noInspect,
        },
      ),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('exportación antigua probeAceCandidate', () => {
  it('sin motor inyectado se porta como la 0.6.59 sin comprobador: engine_error, sin playableOn', async () => {
    const result = await legacy.probeAceCandidate({ id: ID_A, ih: true });
    expect(result).toMatchObject({ state: 'failed', reason: 'engine_error', bytes: 0 });
    expect(result).not.toHaveProperty('playableOn');
    const media = await legacy.inspectScannerMedia('/ace/getstream?id=x');
    expect(media.mediaReason).toBe('probe_unavailable');
  });
});
