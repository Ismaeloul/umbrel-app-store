/* Gestor del remux con un ffmpeg falso en memoria y FakeClock: arranque con
   colchón, reutilización, tope de 3 sin expulsar a nadie, atascos, muertes,
   recolector, huérfanos, `stop` antiguo y ffmpeg ausente (B-105, B-217 a
   B-226; T-112 y T-125 sobre el gestor). */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_REMUX_SESSIONS, REMUX_TIMINGS, TIMEOUTS } from '@ace/shared';
import { createTestCore, tempDir } from '../../../test/helpers/index.js';
import type { DiagnosticReport } from '../../core/bus.js';
import { isAppError } from '../../core/errors.js';
import { notImplementedService } from '../../core/stub.js';
import type { EngineService } from '../engine/types.js';
import { READY_POLL_MS, createRemuxRuntime, type RemuxRuntime } from './service.js';
import {
  advanceParked,
  createFakeLauncher,
  parked,
  type FakeLauncherOptions,
} from './test-support.js';
import type { RemuxCloseReason, RemuxSource } from './types.js';

const hex = (n: number): string => n.toString(16).padStart(2, '0').repeat(20);

function source(n: number, over: Partial<RemuxSource> = {}): RemuxSource {
  return {
    sessionId: `s_sesion${String(n).padStart(4, '0')}`,
    hash: hex(n),
    playbackUrl: `/ace/r/${hex(n)}/p${n}`,
    mode: 'progressive',
    ...over,
  };
}

interface Detached {
  readonly sessionId: string;
  readonly viewers: readonly string[];
  readonly reason: RemuxCloseReason;
}

const runtimes: RemuxRuntime[] = [];
afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.service.stop();
});

function setup(
  options: {
    launcher?: FakeLauncherOptions;
    procRoot?: string | null;
  } = {},
) {
  const core = createTestCore();
  const fake = createFakeLauncher(options.launcher);
  const killed: number[] = [];
  const runtime = createRemuxRuntime({
    ...core,
    engine: notImplementedService<EngineService>('engine'),
    launcher: fake.launcher,
    procRoot: options.procRoot ?? null,
    killPid: (pid) => killed.push(pid),
    watchFiles: false,
  });
  runtimes.push(runtime);
  const detached: Detached[] = [];
  const accesses: [string, string | null][] = [];
  runtime.service.subscribe({
    onDetached: (sessionId, viewers, reason) => detached.push({ sessionId, viewers, reason }),
    onAccess: (sessionId, deviceId) => accesses.push([sessionId, deviceId]),
  });
  const reports: DiagnosticReport[] = [];
  core.bus.on('diagnostics.report', (report) => reports.push(report));
  return {
    core,
    clock: core.clock,
    fake,
    runtime,
    service: runtime.service,
    detached,
    accesses,
    reports,
    killed,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return isAppError(error) ? error.code : String((error as Error).message);
  }
}

describe('arranque y espera del manifiesto (B-105, B-217)', () => {
  it('lanza ffmpeg sobre la playbackUrl de la sesión y responde con colchón', async () => {
    const { service, fake, core, runtime } = setup();
    const handle = await service.ensure(source(1), 'visor-1');
    expect(handle).toMatchObject({ sessionId: 's_sesion0001', hash: hex(1), ready: true });
    expect(handle.dir).toBe(path.join(core.config.paths.remuxDir, hex(1)));
    const proc = fake.last();
    expect(proc.input).toBe(`http://ismaeloul-ace-player-neo_acestream_1:6878/ace/r/${hex(1)}/p1`);
    expect(proc.sessionId).toBe('s_sesion0001');
    expect(service.stats()).toEqual({ sessions: 1, max: MAX_REMUX_SESSIONS, ffmpegMissing: false });
    expect(service.viewersOf('s_sesion0001')).toEqual(['visor-1']);
    expect(service.viewersOf('s_otra00000')).toEqual([]);
    expect(runtime.entries()[0]).toMatchObject({ pid: proc.pid, ready: true, exited: false });
  });

  it('sin 3 segmentos y 4 s de vídeo no está lista; con 1 segmento, pasados 20 s; nunca con la lista vacía', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    let done = false;
    const pending = service.ensure(source(1), 'visor-1').then((handle) => {
      done = true;
      return handle;
    });
    await advanceParked(clock, READY_POLL_MS * 3);
    await parked(clock);
    expect(done).toBe(false);
    fake.last().writeSegments([2]);
    await advanceParked(clock, REMUX_TIMINGS.readyFallbackAfterMs - READY_POLL_MS * 3);
    await parked(clock);
    expect(done, 'a los 20 s justos todavía no (server.js usa >)').toBe(false);
    await clock.advanceAsync(READY_POLL_MS);
    expect((await pending).ready).toBe(true);
  });

  it('con TD 1: 3 segmentos y 4 s de vídeo; se da por lista en la siguiente lectura (§4.3)', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    let done = false;
    const pending = service.ensure(source(1), 'visor-1').then((handle) => {
      done = true;
      return handle;
    });
    await parked(clock);
    /* 3 segmentos de 0,96 s: 2,88 s, menos de los 4 s que pide TD 1. */
    fake.last().writeSegments([0.96, 0.96, 0.96]);
    await advanceParked(clock, READY_POLL_MS * 2);
    await parked(clock);
    expect(done).toBe(false);
    fake.last().writeSegments([0.96, 0.96]);
    await clock.advanceAsync(READY_POLL_MS);
    const handle = await pending;
    expect(handle.ready).toBe(true);
    expect(handle.targetDurationS()).toBe(1);
    expect(handle.segments()).toEqual({ minS: 0.96, maxS: 0.96 });
  });

  it('con TD 2 pide 7 s (3 × TD + 1): 3 segmentos de 2 s no bastan, 4 sí', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    let done = false;
    const pending = service.ensure(source(1), 'visor-1').then((handle) => {
      done = true;
      return handle;
    });
    await parked(clock);
    fake.last().writeSegments([2, 2, 2]);
    await advanceParked(clock, READY_POLL_MS * 2);
    await parked(clock);
    expect(done).toBe(false);
    fake.last().writeSegments([2]);
    await clock.advanceAsync(READY_POLL_MS);
    expect((await pending).targetDurationS()).toBe(2);
  });

  it('dos segmentos que no llegan a 6 s no bastan (server.js:4920)', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    let done = false;
    const pending = service.ensure(source(1), 'visor-1').then(() => {
      done = true;
    });
    await parked(clock);
    fake.last().writeSegments([2, 2]);
    await advanceParked(clock, READY_POLL_MS * 5);
    await parked(clock);
    expect(done).toBe(false);
    await advanceParked(clock, REMUX_TIMINGS.readyFallbackAfterMs);
    await pending;
    expect(done).toBe(true);
  });

  it('a los 45 s sin lista: 504 remux_timeout', async () => {
    const { service, clock } = setup({ launcher: { autoSegments: null } });
    const pending = codeOf(service.ensure(source(1), 'visor-1'));
    await advanceParked(clock, TIMEOUTS.remuxStartServerMs + READY_POLL_MS);
    await clock.advanceAsync(READY_POLL_MS);
    expect(await pending).toBe('remux_timeout');
  });

  it('si ffmpeg muere mientras se espera: remux_died', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    const pending = codeOf(service.ensure(source(1), 'visor-1'));
    await parked(clock);
    fake.last().exit(1);
    expect(await pending).toBe('remux_died');
  });

  it('la espera se corta si el cliente cuelga y no deja temporizadores', async () => {
    const { service, clock } = setup({ launcher: { autoSegments: null } });
    const controller = new AbortController();
    const pending = service.ensure(source(1), 'visor-1', controller.signal);
    await parked(clock);
    controller.abort(new Error('client_closed'));
    await expect(pending).rejects.toThrow('client_closed');
    expect(clock.pendingTimers()).toBe(0);
    const aborted = new AbortController();
    aborted.abort(new Error('ya_cortado'));
    await expect(service.ensure(source(1), 'visor-2', aborted.signal)).rejects.toThrow(
      'ya_cortado',
    );
  });
});

describe('TARGETDURATION fijado en las tres formas de servir la lista (docs/multidispositivo.md §4.3)', () => {
  it('se fija al quedar lista, nunca baja aunque ffmpeg lo baje y sube si un segmento no cabe', async () => {
    const { service, fake, runtime, clock } = setup({ launcher: { autoSegments: null } });
    const pending = service.ensure(source(1), 'visor-1');
    await parked(clock);
    fake.last().writeSegments([2, 2, 2, 2]);
    await clock.advanceAsync(READY_POLL_MS);
    const handle = await pending;
    expect(handle.targetDurationS()).toBe(2);
    const dir = handle.dir;
    const readServed = async (via: 'token' | 'bare' | 'legacy'): Promise<string> => {
      const { default: Fastify } = await import('fastify');
      const app = Fastify();
      app.get('/x', async (_req, reply) => {
        if (via === 'legacy')
          await service.serveLegacyFile(reply, `/remux/${hex(1)}/index.m3u8`, {});
        else
          await service.serveFile(reply, 's_sesion0001', 'index.m3u8', {
            ...(via === 'token' ? { videoToken: 'firma' } : {}),
          });
      });
      const res = await app.inject({ method: 'GET', url: '/x' });
      await app.close();
      return res.body;
    };
    /* Ventana con solo los segmentos de 1 s: ffmpeg escribe TD 1, se sirve 2. */
    fake.last().writeSegments([1, 1, 1, 1]);
    fake.last().setWindow(4);
    for (const via of ['token', 'bare', 'legacy'] as const) {
      const text = await readServed(via);
      expect(text, via).toContain('#EXT-X-TARGETDURATION:2\n');
    }
    expect(await readServed('legacy')).toContain('#EXT-X-START:TIME-OFFSET=-6.0,PRECISE=NO');
    expect(await readServed('token')).not.toContain('#EXT-X-START');
    expect(await readServed('token')).toContain('index4.m4s?t=firma');
    /* Llega un segmento de 3 s: sube a 3 y no vuelve a bajar. */
    fake.last().writeSegments([3]);
    expect(await readServed('bare')).toContain('#EXT-X-TARGETDURATION:3\n');
    expect(handle.targetDurationS()).toBe(3);
    fake.last().writeSegments([1, 1, 1, 1, 1]);
    expect(await readServed('bare')).toContain('#EXT-X-TARGETDURATION:3\n');
    expect(runtime.entries()[0]?.targetS).toBe(3);
    expect(dir).toBeTruthy();
  });

  it('antes de estar lista la lista sale tal cual (sin fijar)', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    const pending = service.ensure(source(1), 'visor-1').catch(() => undefined);
    await parked(clock);
    fake.last().writeSegments([2]);
    const { default: Fastify } = await import('fastify');
    const app = Fastify();
    app.get('/x', async (_req, reply) => {
      await service.serveFile(reply, 's_sesion0001', 'index.m3u8', {});
    });
    const res = await app.inject({ method: 'GET', url: '/x' });
    await app.close();
    expect(res.body).toContain('#EXT-X-TARGETDURATION:2\n');
    await service.stopAll();
    await pending;
  });
});

describe('IPTV: plazos y análisis largo sin perder la conexión (docs/multidispositivo.md §4.5)', () => {
  const iptvSource = (over: Partial<RemuxSource> = {}): RemuxSource =>
    source(7, {
      mode: 'hls',
      inputUrl: 'http://127.0.0.1:1/r/ticketdeprueba0000000/in.ts',
      origin: 'iptv',
      ...over,
    });

  async function settle<T>(
    clock: ReturnType<typeof setup>['clock'],
    promise: Promise<T>,
    stepMs = 1000,
    maxSteps = 40,
  ): Promise<{ value?: T; code?: string; at: number }> {
    let result: { value?: T; code?: string } | null = null;
    const start = clock.now();
    void promise.then(
      (value) => {
        result = { value };
      },
      (error: unknown) => {
        result = { code: isAppError(error) ? error.code : String(error) };
      },
    );
    for (let step = 0; step < maxSteps && !result; step += 1) {
      await parked(clock, 1, 500);
      await clock.advanceAsync(stepMs);
    }
    await parked(clock, 0, 50);
    return { ...(result ?? {}), at: clock.now() - start };
  }

  it('iptv_timeout a los 20 s del PRIMER BYTE entregado a ffmpeg, no de cuando arrancó', async () => {
    const { service, clock } = setup({ launcher: { autoSegments: null } });
    const t0 = clock.now();
    let firstByteAt: number | null = null;
    const pending = service.ensure(iptvSource({ firstByteAt: () => firstByteAt }), 'v');
    /* El primer byte llega a los 6 s: el plazo acaba a los 26 s. */
    await advanceParked(clock, 6000);
    firstByteAt = clock.now();
    const out = await settle(clock, pending);
    expect(out.code).toBe('iptv_timeout');
    expect(clock.now() - t0).toBeGreaterThanOrEqual(26_000);
    expect(clock.now() - t0).toBeLessThan(28_000);
  });

  it('tope de 28 s desde la apertura del relé y tope de la petición (deadlineAt)', async () => {
    const { service, clock } = setup({ launcher: { autoSegments: null } });
    /* El relé tardó 14 s en abrir (reintentos de ocupado): quedan 14 s. */
    const openedAt = clock.now() - 14_000;
    const first = settle(
      clock,
      service.ensure(iptvSource({ openedAt, firstByteAt: () => clock.now() }), 'v'),
    );
    const out = await first;
    expect(out.code).toBe('iptv_timeout');
    expect(out.at).toBeGreaterThanOrEqual(14_000);
    expect(out.at).toBeLessThan(16_000);
    await service.stopAll();
    const again = await settle(
      clock,
      service.ensure(iptvSource(), 'v2', undefined, { deadlineAt: clock.now() + 5000 }),
    );
    expect(again.code).toBe('iptv_timeout');
    expect(again.at).toBeLessThan(7000);
  });

  /**
   * ffmpeg con `-c copy` solo corta en fotogramas clave: con GOP de G s sale
   * un segmento de G s cada G s de vídeo, el primero G s después del primer
   * byte más el análisis (1 s). Devuelve cuándo quedó lista (o el error).
   */
  async function arranqueConGop(gopS: number): Promise<{ code?: string; at: number }> {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    const t0 = clock.now();
    const firstByteAt = t0;
    let result: { code?: string; at: number } | null = null;
    void service.ensure(iptvSource({ firstByteAt: () => firstByteAt }), 'v').then(
      () => {
        result = { at: clock.now() - t0 };
      },
      (error: unknown) => {
        result = { code: isAppError(error) ? error.code : String(error), at: clock.now() - t0 };
      },
    );
    let written = 0;
    for (let ms = 0; ms <= 30_000 && !result; ms += 500) {
      const due = Math.floor(Math.max(0, ms - 1000) / (gopS * 1000));
      if (due > written) {
        fake.last().writeSegments(Array.from({ length: due - written }, () => gopS));
        written = due;
      }
      await parked(clock, 1, 500);
      await clock.advanceAsync(500);
    }
    await parked(clock, 0, 50);
    return result ?? { code: 'sin resultado', at: clock.now() - t0 };
  }

  it('GOP de 1 s: la regla general (3 segmentos y 4 s) la da por lista en unos 5 s', async () => {
    const out = await arranqueConGop(1);
    expect(out.code).toBeUndefined();
    expect(out.at).toBeLessThanOrEqual(6000);
  });

  it('GOP largo (4, 5, 6 y 8 s): 2 segmentos pasados 10 s del primer byte, nunca iptv_timeout', async () => {
    for (const [gop, maxAt] of [
      [4, 10_500],
      [5, 11_500],
      [6, 13_500],
      [8, 17_500],
    ] as const) {
      const out = await arranqueConGop(gop);
      expect(out.code, `GOP ${gop} s`).toBeUndefined();
      expect(out.at, `GOP ${gop} s`).toBeGreaterThanOrEqual(10_000);
      expect(out.at, `GOP ${gop} s`).toBeLessThanOrEqual(maxAt);
    }
  });

  it('GOP de 12 s: con 1 segmento al vencer los 20 s; sin ninguno, iptv_timeout', async () => {
    const out = await arranqueConGop(12);
    expect(out.code).toBeUndefined();
    expect(out.at).toBeGreaterThanOrEqual(20_000);
    expect(out.at).toBeLessThan(21_000);
    const nada = await arranqueConGop(40);
    expect(nada.code).toBe('iptv_timeout');
  });

  it('«Could not find codec parameters» con 2 MB / 2 s: prepareRestart ANTES y un reinicio con 5 MB / 5 s', async () => {
    const { service, fake, clock, runtime, detached } = setup({
      launcher: { autoSegments: null },
    });
    const calls: string[] = [];
    const pending = service.ensure(
      iptvSource({
        prepareRestart: () => {
          calls.push(`prepare:${fake.alive()}`);
          return true;
        },
      }),
      'v',
    );
    await parked(clock);
    const first = fake.last();
    expect(first.args[first.args.indexOf('-probesize') + 1]).toBe('2000000');
    first.stderr('[mpegts] Could not find codec parameters for stream 1 (Audio: ac3)');
    await runtime.idle();
    /* Se preparó el relé con el ffmpeg viejo aún vivo (antes de matarlo). */
    expect(calls).toEqual(['prepare:1']);
    expect(first.killed).toBe(true);
    const second = fake.last();
    expect(second).not.toBe(first);
    expect(second.args[second.args.indexOf('-probesize') + 1]).toBe('5000000');
    second.writeSegments([1, 1, 1, 1]);
    const out = await settle(clock, pending);
    expect(out.value?.ready).toBe(true);
    expect(service.viewersOf('s_sesion0007')).toEqual(['v']);
    expect(detached).toEqual([]);
    /* Un solo reinicio: si el largo vuelve a quejarse, no hay otro. */
    second.stderr('Could not find codec parameters for stream 1 (Audio: ac3)');
    await runtime.idle();
    expect(fake.spawned).toHaveLength(2);
  });

  it('teletexto, subtítulos o datos sin parámetros: ni reinicio ni preparar el relé', async () => {
    const { service, fake, clock, runtime } = setup({ launcher: { autoSegments: null } });
    let prepared = 0;
    const pending = service.ensure(
      iptvSource({
        prepareRestart: () => {
          prepared += 1;
          return true;
        },
      }),
      'v',
    );
    await parked(clock);
    fake
      .last()
      .stderr(
        '[mpegts] Could not find codec parameters for stream 2 (Subtitle: dvb_teletext ([6][0][0][0] / 0x0006), none): unspecified size\n' +
          'Could not find codec parameters for stream 3 (Unknown: none ([12][0][0][0] / 0x000C)): unknown codec\n',
      );
    await runtime.idle();
    expect(prepared).toBe(0);
    expect(fake.spawned).toHaveLength(1);
    fake.last().writeSegments([1, 1, 1, 1]);
    expect((await settle(clock, pending)).value?.ready).toBe(true);
  });

  it('sin relé (prepareRestart da false) no se reinicia y sigue el error de siempre', async () => {
    const { service, fake, clock, runtime } = setup({ launcher: { autoSegments: null } });
    const pending = codeOf(service.ensure(iptvSource({ prepareRestart: () => false }), 'v'));
    await parked(clock);
    fake.last().stderr('Could not find codec parameters for stream 1 (Audio: ac3)');
    fake.last().exit(1);
    await runtime.idle();
    expect(fake.spawned).toHaveLength(1);
    expect(await pending).toBe('remux_died');
  });

  it('el motor (AceStream) nunca se reinicia por eso: ya analiza con 5 MB / 5 s', async () => {
    const { service, fake, clock, runtime } = setup({ launcher: { autoSegments: null } });
    let prepared = 0;
    const pending = codeOf(
      service.ensure(
        source(8, {
          prepareRestart: () => {
            prepared += 1;
            return true;
          },
        }),
        'v',
      ),
    );
    await parked(clock);
    fake.last().stderr('Could not find codec parameters for stream 1 (Audio: ac3)');
    fake.last().exit(1);
    await runtime.idle();
    expect(prepared).toBe(0);
    expect(fake.spawned).toHaveLength(1);
    expect(await pending).toBe('remux_died');
  });
});

describe('reutilización y relanzamiento (P9, B-226)', () => {
  it('reengancharse a la misma sesión reutiliza el ffmpeg vivo', async () => {
    const { service, fake } = setup();
    await service.ensure(source(1), 'visor-1');
    await service.ensure(source(1), 'visor-1');
    await service.ensure(source(1), 'visor-2');
    expect(fake.spawned).toHaveLength(1);
    expect(service.viewersOf('s_sesion0001')).toEqual(['visor-1', 'visor-2']);
  });

  it('si la sesión cambia de URL (pasa a HLS) se relanza con los mismos visores y sin avisar', async () => {
    const { service, fake, detached } = setup();
    await service.ensure(source(1), 'visor-1');
    const first = fake.last();
    await service.ensure(
      source(1, { playbackUrl: `/ace/m/${hex(1)}/p1.m3u8`, mode: 'hls' }),
      'visor-2',
    );
    expect(first.killed).toBe(true);
    expect(fake.spawned).toHaveLength(2);
    expect(fake.last().input).toContain('/ace/m/');
    expect(service.viewersOf('s_sesion0001')).toEqual(['visor-1', 'visor-2']);
    expect(detached).toEqual([]);
  });

  it('otra sesión del mismo canal sustituye a la anterior y avisa a sus visores', async () => {
    const { service, fake, detached } = setup();
    await service.ensure(source(1), 'visor-1');
    await service.ensure(source(1, { sessionId: 's_nueva00001' }), 'visor-2');
    expect(fake.spawned[0]?.killed).toBe(true);
    expect(detached).toEqual([
      { sessionId: 's_sesion0001', viewers: ['visor-1'], reason: 'stopped' },
    ]);
    expect(service.stats().sessions).toBe(1);
  });

  it('un ffmpeg atascado (45 s arrancado y 15 s sin tocar la lista) se relanza', async () => {
    const { service, fake, clock } = setup();
    await service.ensure(source(1), 'visor-1');
    await clock.advanceAsync(TIMEOUTS.remuxStartServerMs - 1000);
    await service.ensure(source(1), 'visor-1');
    expect(fake.spawned).toHaveLength(1);
    await clock.advanceAsync(REMUX_TIMINGS.staleMs + 2000);
    await service.ensure(source(1), 'visor-1');
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]?.killed).toBe(true);
  });

  it('pasados los 45 s sin lista en disco también cuenta como atascado', async () => {
    const { service, fake, clock, core } = setup();
    await service.ensure(source(1), 'visor-1');
    await clock.advanceAsync(TIMEOUTS.remuxStartServerMs + 1000);
    const { rmSync } = await import('node:fs');
    rmSync(path.join(core.config.paths.remuxDir, hex(1), 'index.m3u8'));
    await service.ensure(source(1), 'visor-1');
    expect(fake.spawned).toHaveLength(2);
  });

  it('un ffmpeg terminado se relanza al volver a pedirlo', async () => {
    const { service, fake } = setup();
    await service.ensure(source(1), 'visor-1');
    fake.last().exit(0);
    await service.ensure(source(1), 'visor-1');
    expect(fake.spawned).toHaveLength(2);
  });
});

describe('tope de 3 sesiones sin expulsar a nadie (T-112, B-223)', () => {
  it('con tres sesiones vistas, la cuarta recibe 503 remux_busy y nadie pierde la imagen', async () => {
    const { service, fake } = setup();
    for (let n = 1; n <= 3; n += 1) await service.ensure(source(n), `visor-${n}`);
    expect(await codeOf(service.ensure(source(4), 'visor-4'))).toBe('remux_busy');
    expect(fake.alive()).toBe(3);
    expect(fake.spawned).toHaveLength(3);
  });

  it('se desaloja la libre más antigua (ffmpeg terminado) y se avisa a quien quedara', async () => {
    const { service, fake, clock, detached } = setup();
    for (let n = 1; n <= 3; n += 1) {
      await service.ensure(source(n), `visor-${n}`);
      await clock.advanceAsync(1000);
    }
    fake.spawned[1]?.exit(1);
    expect(detached).toEqual([{ sessionId: 's_sesion0002', viewers: ['visor-2'], reason: 'died' }]);
    await service.ensure(source(4), 'visor-4');
    expect(service.viewersOf('s_sesion0002')).toEqual([]);
    expect(service.stats().sessions).toBe(3);
    expect(fake.alive()).toBe(3);
  });

  it('una sesión sin visores (un 0.6.x sin dev) también es desalojable', async () => {
    const { service, detached } = setup();
    await service.ensure(source(1), 'lr_anonimo', undefined, { legacy: { device: '' } });
    await service.ensure(source(2), 'visor-2');
    await service.ensure(source(3), 'visor-3');
    await service.ensure(source(4), 'visor-4');
    expect(detached).toEqual([
      { sessionId: 's_sesion0001', viewers: ['lr_anonimo'], reason: 'evicted' },
    ]);
  });
});

describe('visores, muerte de ffmpeg y diagnóstico (arquitectura §5.7)', () => {
  it('al soltarse el último visor se mata ffmpeg y se borra la carpeta', async () => {
    const { service, fake, core, detached } = setup();
    await service.ensure(source(1), 'visor-1');
    await service.ensure(source(1), 'visor-2');
    await service.detach('s_sesion0001', 'visor-1');
    expect(fake.last().alive).toBe(true);
    await service.detach('s_sesion0001', 'visor-2');
    expect(fake.last().killed).toBe(true);
    expect(existsSync(path.join(core.config.paths.remuxDir, hex(1)))).toBe(false);
    expect(service.stats().sessions).toBe(0);
    expect(detached).toEqual([]);
    await service.detach('s_sesion0001', 'visor-2');
  });

  it('si ffmpeg muere solo: aviso a los visores y el final del log a diagnóstico', async () => {
    const { service, fake, detached, reports, runtime } = setup();
    await service.ensure(source(1), 'visor-1');
    fake
      .last()
      .stderr('Stream #0:0: Video: hevc\n[hls] Invalid data found when processing input\n');
    fake.last().exit(1);
    expect(detached).toEqual([{ sessionId: 's_sesion0001', viewers: ['visor-1'], reason: 'died' }]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      cause: 'codec',
      code: 'remux_died',
      sessionId: 's_sesion0001',
      hash: hex(1),
    });
    expect(reports[0]?.message).toContain('Invalid data');
    expect(runtime.entries()[0]).toMatchObject({ exited: true });
    expect(runtime.entries()[0]?.log).toContain('hevc');
  });

  it('una muerte sin pistas de códec se achaca al motor; una muerte provocada no se anota', async () => {
    const { service, fake, reports } = setup();
    await service.ensure(source(1), 'visor-1');
    fake.last().stderr('Connection reset by peer\n');
    fake.last().exit(null, 'SIGSEGV');
    expect(reports[0]).toMatchObject({ cause: 'engine' });
    await service.ensure(source(2), 'visor-2');
    await service.detach('s_sesion0002', 'visor-2');
    expect(reports).toHaveLength(1);
  });

  it('sin ffmpeg: ffmpeg_missing, el remux queda desactivado y lo demás sigue', async () => {
    const { service, fake, detached } = setup({ launcher: { missing: true } });
    expect(await codeOf(service.ensure(source(1), 'visor-1'))).toBe('ffmpeg_missing');
    expect(await codeOf(service.ensure(source(2), 'visor-2'))).toBe('ffmpeg_missing');
    expect(fake.spawned).toHaveLength(1);
    expect(service.stats()).toMatchObject({ sessions: 0, ffmpegMissing: true });
    expect(detached).toEqual([]);
    expect(await service.legacyStop({ id: hex(1), dev: 'x' })).toEqual({
      success: true,
      stopped: false,
      detached: false,
    });
  });

  it('un spawn que lanza (ENOENT u otro fallo) da ffmpeg_missing o remux_died', async () => {
    const core = createTestCore();
    const make = (code: string) =>
      createRemuxRuntime({
        ...core,
        engine: notImplementedService<EngineService>('engine'),
        watchFiles: false,
        procRoot: null,
        launcher: {
          spawn() {
            throw Object.assign(new Error(code), { code });
          },
        },
      });
    const missing = make('ENOENT');
    expect(await codeOf(missing.service.ensure(source(1), 'v1'))).toBe('ffmpeg_missing');
    expect(missing.service.stats().ffmpegMissing).toBe(true);
    const broken = make('EACCES');
    expect(await codeOf(broken.service.ensure(source(1), 'v1'))).toBe('remux_died');
  });
});

describe('recolector y huérfanos (B-226)', () => {
  it('cada 15 s mata lo que lleva 90 s sin peticiones, salvo con visores de la app nativa', async () => {
    const { service, fake, clock, detached, runtime } = setup();
    await service.start();
    await service.start();
    await service.ensure(source(1), 'lr_movil', undefined, { legacy: { device: 'movil' } });
    await service.ensure(source(2), 'visor-ios');
    await clock.advanceAsync(REMUX_TIMINGS.idleMs + REMUX_TIMINGS.reaperIntervalMs);
    await runtime.idle();
    expect(fake.spawned[0]?.killed).toBe(true);
    expect(fake.spawned[1]?.alive).toBe(true);
    expect(detached).toEqual([
      { sessionId: 's_sesion0001', viewers: ['lr_movil'], reason: 'idle' },
    ]);
    await service.stop();
    expect(clock.pendingTimers()).toBe(0);
    expect(fake.alive()).toBe(0);
    expect(await codeOf(service.ensure(source(3), 'v'))).toBe('remux_died');
  });

  it('una sesión terminada se conserva para el periodo de gracia y la recoge el recolector', async () => {
    const { service, fake, runtime, clock } = setup();
    await service.ensure(source(1), 'visor-1');
    fake.last().exit(0);
    await runtime.reap();
    expect(service.stats().sessions).toBe(1);
    await clock.advanceAsync(REMUX_TIMINGS.idleMs + 1);
    await runtime.reap();
    expect(service.stats().sessions).toBe(0);
  });

  it('mata los ffmpeg con ace_session= que no están en el registro', async () => {
    const procRoot = tempDir('proc-');
    const { service, runtime, killed, fake } = setup({ procRoot });
    await service.ensure(source(1), 'visor-1');
    const add = (pid: number, session: string) => {
      mkdirSync(path.join(procRoot, String(pid)));
      writeFileSync(
        path.join(procRoot, String(pid), 'cmdline'),
        `ffmpeg\0-metadata\0ace_session=${session}\0`,
      );
    };
    add(501, 's_huerfana01');
    add(fake.last().pid, 's_sesion0001');
    await runtime.reap();
    expect(killed).toEqual([501]);
  });
});

describe('POST /api/remux/stop de la 0.6.59 (B-222, T-035, T-125)', () => {
  it('sin sesión: stopped false y detached false (T-035)', async () => {
    const { service } = setup();
    expect(await service.legacyStop({ id: hex(1), dev: 'test-device' })).toEqual({
      success: true,
      stopped: false,
      detached: false,
    });
    expect(await codeOf(service.legacyStop({ id: 'nada' }))).toBe('bad_request');
    expect(await codeOf(service.legacyStop(null as unknown as Record<string, unknown>))).toBe(
      'bad_request',
    );
  });

  it('un stop con la ficha de un enganche anterior responde stale y no toca la sesión (T-125)', async () => {
    const { service, fake } = setup();
    const old = await service.ensure(source(1), 'lr_movil', undefined, {
      legacy: { device: 'movil' },
    });
    const fresh = await service.ensure(source(1), 'lr_movil', undefined, {
      legacy: { device: 'movil' },
    });
    expect(old.legacyToken).toMatch(/^[a-f0-9]{16}$/);
    expect(fresh.legacyToken).not.toBe(old.legacyToken);
    expect(await service.legacyStop({ id: hex(1), dev: 'movil', token: old.legacyToken })).toEqual({
      success: true,
      stopped: false,
      detached: false,
      stale: true,
    });
    expect(fake.last().alive).toBe(true);
    expect(
      await service.legacyStop({ id: hex(1), dev: 'movil', token: fresh.legacyToken }),
    ).toEqual({
      success: true,
      stopped: true,
      detached: true,
    });
    expect(fake.last().killed).toBe(true);
  });

  it('detener el remux de un equipo no afecta a otro; keepAlive deja la sesión viva', async () => {
    const { service, fake, detached } = setup();
    await service.ensure(source(1), 'lr_movil', undefined, { legacy: { device: 'movil' } });
    await service.ensure(source(1), 'lr_tele', undefined, { legacy: { device: 'tele' } });
    expect(await service.legacyStop({ id: hex(1), dev: 'movil' })).toEqual({
      success: true,
      stopped: false,
      detached: true,
    });
    expect(detached).toEqual([
      { sessionId: 's_sesion0001', viewers: ['lr_movil'], reason: 'stopped' },
    ]);
    expect(await service.legacyStop({ id: hex(1), dev: 'tele', keepAlive: true })).toEqual({
      success: true,
      stopped: false,
      detached: true,
    });
    expect(fake.last().alive).toBe(true);
    expect(service.viewersOf('s_sesion0001')).toEqual(['lr_tele']);
    /* Sin dev y sin keepAlive se mata (server.js:4901) y se avisa a quien quede. */
    expect(await service.legacyStop({ id: hex(1) })).toEqual({
      success: true,
      stopped: true,
      detached: false,
    });
    expect(fake.last().killed).toBe(true);
    expect(detached.at(-1)).toEqual({
      sessionId: 's_sesion0001',
      viewers: ['lr_tele'],
      reason: 'stopped',
    });
  });

  it('v2: un stop antiguo nunca deja sin vídeo a un visor de la app nativa', async () => {
    const { service, fake } = setup();
    await service.ensure(source(1), 'visor-ios');
    await service.ensure(source(1), 'lr_movil', undefined, { legacy: { device: 'movil' } });
    expect(await service.legacyStop({ id: hex(1) })).toEqual({
      success: true,
      stopped: false,
      detached: false,
    });
    expect(await service.legacyStop({ id: hex(1), dev: 'movil' })).toEqual({
      success: true,
      stopped: false,
      detached: true,
    });
    expect(fake.last().alive).toBe(true);
  });
});

describe('apagado y arranque (arquitectura §5.16)', () => {
  it('stopAll mata todos los ffmpeg y avisa; cleanWorkDir vacía remux/', async () => {
    const { service, fake, core, detached } = setup();
    await service.ensure(source(1), 'visor-1');
    await service.ensure(source(2), 'visor-2');
    await service.stopAll();
    expect(fake.alive()).toBe(0);
    expect(detached.map((entry) => entry.reason)).toEqual(['shutdown', 'shutdown']);
    mkdirSync(path.join(core.config.paths.remuxDir, 'resto'), { recursive: true });
    await service.cleanWorkDir();
    expect(readdirSync(core.config.paths.remuxDir)).toEqual([]);
  });

  it('las funciones puras están también en el servicio', () => {
    const { service } = setup();
    expect(service.parseByteRange('bytes=0-0', 1)).toEqual({ start: 0, end: 0 });
    expect(service.buildArgs({ url: 'u', dir: 'd', sessionId: 's_x1234567' })).toContain(
      'ace_session=s_x1234567',
    );
  });

  it('un suscriptor que falla no rompe el remux y se puede dar de baja', async () => {
    const { service, fake } = setup();
    const off = service.subscribe({
      onDetached: () => {
        throw new Error('fallo');
      },
      onAccess: () => {
        throw new Error('fallo');
      },
    });
    await service.ensure(source(1), 'visor-1');
    fake.last().exit(1);
    off();
    expect(service.stats().sessions).toBe(1);
  });
});

describe('la sesión del motor cambia de URL: retarget (D5.3, arquitectura §5.5)', () => {
  it('relanza ffmpeg sobre la URL nueva con los mismos visores y fichas, y espera el colchón', async () => {
    const { service, fake, detached } = setup();
    const old = await service.ensure(source(1), 'lr_movil', undefined, {
      legacy: { device: 'movil' },
    });
    await service.ensure(source(1), 'visor-ios');
    const moved = source(1, { playbackUrl: `/ace/m/${hex(1)}/p1.m3u8`, mode: 'hls' });
    const handle = await service.retarget(moved);
    expect(handle).toMatchObject({ sessionId: 's_sesion0001', ready: true });
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]?.killed).toBe(true);
    expect(fake.last().input).toContain('/ace/m/');
    expect([...service.viewersOf('s_sesion0001')].sort()).toEqual(['lr_movil', 'visor-ios']);
    expect(detached).toEqual([]);
    /* La ficha del 0.6.x sigue valiendo: su stop no sale como `stale`. */
    expect(await service.legacyStop({ id: hex(1), dev: 'movil', token: old.legacyToken })).toEqual({
      success: true,
      stopped: false,
      detached: true,
    });
    /* Misma URL: no relanza; sesión sin remux: null. */
    await service.retarget(moved);
    expect(fake.spawned).toHaveLength(2);
    expect(await service.retarget(source(9))).toBeNull();
  });

  it('si ffmpeg no arranca en la URL nueva, falla y la sesión queda libre', async () => {
    const { service, fake } = setup();
    await service.ensure(source(1), 'visor-ios');
    fake.setMissing(true);
    const moved = source(1, { playbackUrl: `/ace/m/${hex(1)}/p1.m3u8`, mode: 'hls' });
    expect(await codeOf(service.retarget(moved))).toBe('ffmpeg_missing');
  });

  it('soltar a un 0.6.x por su visor quita también su ficha', async () => {
    const { service, fake } = setup();
    await service.ensure(source(1), 'lr_movil', undefined, { legacy: { device: 'movil' } });
    await service.detach('s_sesion0001', 'lr_movil');
    expect(fake.last().killed).toBe(true);
    expect(service.stats().sessions).toBe(0);
  });
});
