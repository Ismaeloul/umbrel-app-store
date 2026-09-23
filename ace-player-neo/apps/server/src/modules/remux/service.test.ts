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

  it('espera a 2 segmentos y 6 s; con 1 segmento, pasados 20 s; nunca con la lista vacía', async () => {
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

  it('con 2 segmentos que suman 6 s se da por lista en la siguiente lectura', async () => {
    const { service, fake, clock } = setup({ launcher: { autoSegments: null } });
    const pending = service.ensure(source(1), 'visor-1');
    await parked(clock);
    fake.last().writeSegments([2.5, 3.5]);
    await clock.advanceAsync(READY_POLL_MS);
    expect((await pending).ready).toBe(true);
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
