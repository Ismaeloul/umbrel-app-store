/* Vigilante del motor con FakeClock y un `get_version` guionizado: la
   histéresis, el cupo de reinicios, la espera exponencial, el motor que
   responde sin entregar y la espera a que vuelva (arquitectura §5.5).
   Los mismos casos contra el motor falso de verdad están en service.test.ts. */

import { describe, expect, it, vi } from 'vitest';
import { ENGINE_WATCHDOG, EngineStatusSchema, type EngineStatus } from '@ace/shared';
import { createTestCore, FakeClock } from '../../../test/helpers/index.js';
import type { DiagnosticReport } from '../../core/bus.js';
import { AppError } from '../../core/errors.js';
import {
  READY_POLL_MS,
  STALL_AFTER_MS,
  EngineWatchdog,
  type WatchdogProbeResult,
} from './watchdog.js';

const TICK = ENGINE_WATCHDOG.intervalMs;
const MINUTE = 60_000;
const VERSION_BODY = JSON.stringify({ result: { version: '3.2.3' }, error: null });

function setup(options: { restart?: () => Promise<void> } = {}) {
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  const events: EngineStatus[] = [];
  const reports: DiagnosticReport[] = [];
  core.bus.on('engine.status', (status) => events.push(status));
  core.bus.on('diagnostics.report', (report) => reports.push(report));
  let up = true;
  const probe = vi.fn(async (): Promise<WatchdogProbeResult> =>
    up ? { ok: true, raw: VERSION_BODY, version: '3.2.3' } : { ok: false, raw: '', version: null },
  );
  const restart = vi.fn(options.restart ?? (async () => undefined));
  const watchdog = new EngineWatchdog({
    clock,
    bus: core.bus,
    logger: core.logger,
    probe,
    restart,
  });
  const watch = (watching: boolean): void =>
    core.bus.emit('playback.activity', { watching, hashes: [], viewers: watching ? 1 : 0 });
  return {
    clock,
    core,
    events,
    reports,
    probe,
    restart,
    watchdog,
    watch,
    setUp: (value: boolean) => {
      up = value;
    },
    states: () => events.map((event) => event.status),
    codes: () => reports.map((report) => report.code),
  };
}

type Setup = ReturnType<typeof setup>;

/** Arranca y deja que la primera pregunta termine. */
async function started(options: Parameters<typeof setup>[0] = {}): Promise<Setup> {
  const t = setup(options);
  t.watchdog.start();
  await t.watchdog.idle();
  return t;
}

async function ticks(t: Setup, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await t.clock.advanceAsync(TICK);
    await t.watchdog.idle();
  }
}

async function advance(t: Setup, ms: number): Promise<void> {
  await t.clock.advanceAsync(ms);
  await t.watchdog.idle();
}

describe('histéresis del estado del motor (B-011)', () => {
  it('recién arrancado manda la primera respuesta; engine.status solo al cambiar', async () => {
    const t = setup();
    expect(t.watchdog.status().status).toBe('unknown');
    expect(t.watchdog.legacyStatus()).toEqual({ online: false, raw: '' });
    t.watchdog.start();
    t.watchdog.start(); // idempotente
    await t.watchdog.idle();
    expect(t.states()).toEqual(['online']);
    await ticks(t, 5);
    expect(t.states()).toEqual(['online']);
    expect(t.probe).toHaveBeenCalledTimes(6);
    const status = EngineStatusSchema.parse(t.watchdog.status());
    expect(status).toMatchObject({ status: 'online', online: true, engineVersion: '3.2.3' });
    expect(status.since).toBe(new Date(t.clock.now() - 5 * TICK).toISOString());
    expect(status.checkedAt).toBe(t.clock.date().toISOString());
    expect(t.watchdog.legacyStatus()).toEqual({ online: true, raw: VERSION_BODY });
    await t.watchdog.stop();
  });

  it('con alguien viendo, un solo silencio NO pone el motor offline; dos seguidos sí', async () => {
    const t = await started();
    t.watch(true);
    t.setUp(false);
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('online');
    t.setUp(true);
    await ticks(t, 1); // un acierto en medio pone el contador a cero
    t.setUp(false);
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('online');
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('offline');
    expect(t.watchdog.legacyStatus()).toEqual({ online: false, raw: '' });
    expect(t.states()).toEqual(['online', 'offline']);
    await t.watchdog.stop();
  });

  it('sin nadie viendo hacen falta 3 fallos seguidos', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 2);
    expect(t.watchdog.status().status).toBe('online');
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('offline');
    await t.watchdog.stop();
  });

  it('vuelve a online con 2 aciertos seguidos, no con uno', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 3);
    t.setUp(true);
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('offline');
    await ticks(t, 1);
    expect(t.watchdog.status().status).toBe('online');
    expect(t.states()).toEqual(['online', 'offline', 'online']);
    await t.watchdog.stop();
  });

  it('una pregunta que lanza cuenta como fallo y un motor caído al arrancar da offline', async () => {
    const t = setup();
    t.probe.mockRejectedValue(new Error('boom'));
    t.watchdog.start();
    await t.watchdog.idle();
    expect(t.watchdog.status()).toMatchObject({
      status: 'offline',
      online: false,
      engineVersion: null,
    });
    await t.watchdog.stop();
  });

  it('lee `playback.activity` y deja de escuchar el bus al parar', async () => {
    const t = await started();
    expect(t.core.bus.listenerCount('playback.activity')).toBe(1);
    t.watch(true);
    t.setUp(false);
    await ticks(t, 2);
    expect(t.watchdog.status().status).toBe('offline');
    await t.watchdog.stop();
    expect(t.core.bus.listenerCount('playback.activity')).toBe(0);
    expect(t.core.bus.listenerCount('stream.stats')).toBe(0);
    expect(t.clock.pendingTimers()).toBe(0);
    await t.watchdog.stop(); // idempotente
  });
});

describe('reinicio automático: motor offline 60 s con alguien viendo (arquitectura §5.5)', () => {
  it('sin nadie viendo no se reinicia nunca', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 30);
    expect(t.watchdog.status().status).toBe('offline');
    expect(t.restart).not.toHaveBeenCalled();
    await t.watchdog.stop();
  });

  it('reinicia a los 60 s offline, espera 2 respuestas buenas y avisa de que ha vuelto (B-013)', async () => {
    const t = await started();
    t.watch(true);
    t.setUp(false);
    await ticks(t, 2); // offline
    const offlineAt = t.clock.now();
    await ticks(t, 5);
    expect(t.restart).not.toHaveBeenCalled();
    await ticks(t, 1);
    expect(t.clock.now() - offlineAt).toBe(ENGINE_WATCHDOG.autoRestartAfterOfflineMs);
    expect(t.restart).toHaveBeenCalledTimes(1);
    expect(t.watchdog.status()).toMatchObject({
      status: 'restarting',
      autoRestarts: { lastHour: 1, max: 3, exhausted: false },
    });
    expect(t.watchdog.status().autoRestarts.nextAllowedAt).toBe(
      new Date(t.clock.now() + MINUTE).toISOString(),
    );
    expect(t.codes()).toEqual(['engine_auto_restart']);
    expect(t.reports[0]?.cause).toBe('engine');
    // tras reiniciar se pregunta cada 2 s; hacen falta 2 aciertos seguidos
    t.setUp(true);
    await advance(t, READY_POLL_MS);
    expect(t.watchdog.status().status).toBe('restarting');
    await advance(t, READY_POLL_MS);
    expect(t.watchdog.status().status).toBe('online');
    expect(t.states()).toEqual(['online', 'offline', 'restarting', 'online']);
    await t.watchdog.stop();
  });

  it('si no vuelve en 90 s queda offline y se anota en diagnóstico', async () => {
    const t = await started();
    t.watch(true);
    t.setUp(false);
    await ticks(t, 8);
    expect(t.watchdog.status().status).toBe('restarting');
    await advance(t, ENGINE_WATCHDOG.readyMaxWaitMs - 1);
    expect(t.watchdog.status().status).toBe('restarting');
    await advance(t, 1);
    expect(t.watchdog.status().status).toBe('offline');
    expect(t.codes()).toEqual(['engine_auto_restart', 'engine_not_ready']);
    await t.watchdog.stop();
  });

  it('como mucho 3 por hora; al agotarse avisa una vez y el cupo vuelve pasada la hora', async () => {
    const t = await started();
    t.watch(true);
    t.setUp(false);
    const restartTimes: number[] = [];
    t.restart.mockImplementation(async () => {
      restartTimes.push(t.clock.now());
    });
    // 1 h de motor caído, en saltos de 10 s
    await ticks(t, 360);
    expect(restartTimes).toHaveLength(3);
    const status = t.watchdog.status();
    expect(status.autoRestarts).toMatchObject({ lastHour: 3, max: 3, exhausted: true });
    const [first, second, third] = restartTimes as [number, number, number];
    // espera exponencial: al menos 1 min y 2 min entre uno y otro
    expect(second - first).toBeGreaterThanOrEqual(MINUTE);
    expect(third - second).toBeGreaterThanOrEqual(2 * MINUTE);
    expect(status.autoRestarts.nextAllowedAt).toBe(new Date(first + 60 * MINUTE).toISOString());
    expect(t.codes().filter((code) => code === 'engine_auto_restart_exhausted')).toHaveLength(1);
    expect(t.codes().filter((code) => code === 'engine_auto_restart')).toHaveLength(3);
    // pasada la hora del primero, vuelve a haber cupo
    await ticks(t, 12);
    expect(restartTimes).toHaveLength(4);
    expect(restartTimes[3]).toBeGreaterThanOrEqual(first + 60 * MINUTE);
    await t.watchdog.stop();
  });
});

describe('reinicio automático: 3 aperturas fallidas seguidas por culpa del motor', () => {
  async function onlineWatching(): Promise<Setup> {
    const t = await started();
    t.watch(true);
    return t;
  }

  it('un acierto en medio pone la cuenta a cero', async () => {
    const t = await onlineWatching();
    t.watchdog.reportOpenFailure();
    t.watchdog.reportOpenFailure();
    t.watchdog.reportOpenSuccess();
    t.watchdog.reportOpenFailure();
    t.watchdog.reportOpenFailure();
    await t.watchdog.idle();
    expect(t.restart).not.toHaveBeenCalled();
    t.watchdog.reportOpenFailure();
    await t.watchdog.idle();
    expect(t.restart).toHaveBeenCalledTimes(1);
    expect(t.watchdog.status().status).toBe('restarting');
    await t.watchdog.stop();
  });

  it('esperas de 1, 2 y 4 min entre reinicios', async () => {
    const t = await onlineWatching();
    const failThrice = (): void => {
      for (let index = 0; index < 3; index += 1) t.watchdog.reportOpenFailure();
    };
    const restartTimes: number[] = [];
    t.restart.mockImplementation(async () => {
      restartTimes.push(t.clock.now());
    });
    failThrice();
    await t.watchdog.idle();
    await advance(t, 2 * READY_POLL_MS); // vuelve a online
    expect(t.watchdog.status().status).toBe('online');
    failThrice();
    await t.watchdog.idle();
    expect(restartTimes).toHaveLength(1); // aún dentro del minuto
    expect(t.watchdog.status().autoRestarts.nextAllowedAt).toBe(
      new Date((restartTimes[0] as number) + MINUTE).toISOString(),
    );
    await ticks(t, 6);
    expect(restartTimes).toHaveLength(2);
    expect((restartTimes[1] as number) - (restartTimes[0] as number)).toBeGreaterThanOrEqual(
      MINUTE,
    );
    expect((restartTimes[1] as number) - (restartTimes[0] as number)).toBeLessThan(
      MINUTE + TICK + 1,
    );
    await advance(t, 2 * READY_POLL_MS);
    failThrice();
    await ticks(t, 11);
    expect(restartTimes).toHaveLength(2);
    await ticks(t, 2);
    expect(restartTimes).toHaveLength(3);
    expect((restartTimes[2] as number) - (restartTimes[1] as number)).toBeGreaterThanOrEqual(
      2 * MINUTE,
    );
    // el cuarto: la espera de 4 min ya no basta, manda la hora del primero
    await advance(t, 2 * READY_POLL_MS);
    failThrice();
    await ticks(t, 30);
    expect(restartTimes).toHaveLength(3);
    expect(t.watchdog.status().autoRestarts).toMatchObject({ lastHour: 3, exhausted: true });
    await t.watchdog.stop();
  });

  it('un reinicio automático que falla gasta el intento y se anota', async () => {
    const t = await onlineWatching();
    t.restart.mockRejectedValue(new AppError('restart_failed'));
    for (let index = 0; index < 3; index += 1) t.watchdog.reportOpenFailure();
    await t.watchdog.idle();
    expect(t.restart).toHaveBeenCalledTimes(1);
    expect(t.watchdog.status()).toMatchObject({ status: 'online', autoRestarts: { lastHour: 1 } });
    expect(t.codes()).toEqual(['engine_auto_restart', 'restart_failed']);
    await t.watchdog.stop();
  });
});

describe('motor que responde pero no entrega datos', () => {
  const stat = (
    overrides: Partial<{
      status: string;
      peers: number;
      speedDown: number;
      downloaded: number | null;
    }>,
  ) => ({
    status: 'dl',
    peers: 5,
    speedDown: 0,
    speedUp: 0,
    downloaded: 1000,
    ...overrides,
  });

  it('60 s de estadísticas que no contestan con alguien viendo → reinicio y aviso', async () => {
    const t = await started();
    t.watch(true);
    const from = t.clock.now();
    t.watchdog.noteStatTimeout('/ace/stat/x/1');
    await ticks(t, 5);
    expect(t.watchdog.isStalled()).toBe(false);
    await ticks(t, 1);
    expect(t.clock.now() - from).toBe(STALL_AFTER_MS);
    expect(t.restart).toHaveBeenCalledTimes(1);
    expect(t.codes()).toEqual(['engine_stalled', 'engine_auto_restart']);
    expect(t.reports[1]?.message).toMatch(/sin entregar datos/);
    await t.watchdog.stop();
  });

  it('`dl` con pares y velocidad 0 sin que crezca `downloaded` también cuenta', async () => {
    const t = await started();
    t.watch(true);
    t.watchdog.noteStat('a', stat({ downloaded: 5000 }));
    await ticks(t, 3);
    t.watchdog.noteStat('a', stat({ downloaded: 5000 }));
    await ticks(t, 3);
    expect(t.restart).toHaveBeenCalledTimes(1);
    await t.watchdog.stop();
  });

  it('una fuente sin pares o en prebuf NO es culpa del motor', async () => {
    const t = await started();
    t.watch(true);
    t.watchdog.noteStat('a', stat({ status: 'prebuf', peers: 0 }));
    t.watchdog.noteStat('b', stat({ peers: 0 }));
    await ticks(t, 10);
    expect(t.watchdog.isStalled()).toBe(false);
    expect(t.restart).not.toHaveBeenCalled();
    await t.watchdog.stop();
  });

  it('velocidad o `downloaded` que avanza borra la sospecha; sin nadie viendo no se cuenta', async () => {
    const t = await started();
    t.watch(true);
    t.watchdog.noteStat('a', stat({ downloaded: 100 }));
    await ticks(t, 5);
    t.watchdog.noteStat('a', stat({ downloaded: 200 })); // crece
    await ticks(t, 5);
    expect(t.restart).not.toHaveBeenCalled();
    t.watchdog.noteStatTimeout('a');
    await ticks(t, 5);
    t.watchdog.noteStat('a', stat({ speedDown: 800, downloaded: null }));
    await ticks(t, 5);
    expect(t.restart).not.toHaveBeenCalled();
    t.watch(false);
    t.watchdog.noteStatTimeout('a');
    await ticks(t, 10);
    expect(t.watchdog.isStalled()).toBe(false);
    expect(t.restart).not.toHaveBeenCalled();
    await t.watchdog.stop();
  });

  it('también escucha las `stream.stats` que publica playback', async () => {
    const t = await started();
    t.watch(true);
    const emit = (downloaded: number): void =>
      t.core.bus.emit('stream.stats', {
        sessionId: 'sess_1',
        viewerIds: [],
        status: 'dl',
        peers: 3,
        speedDown: 0,
        speedUp: 0,
        downloaded,
        at: t.clock.date().toISOString(),
      });
    emit(10);
    await ticks(t, 6);
    expect(t.restart).toHaveBeenCalledTimes(1);
    await t.watchdog.stop();
  });

  it('recuerda como mucho 32 sesiones', async () => {
    const t = await started();
    for (let index = 0; index < 40; index += 1)
      t.watchdog.noteStat(`k${index}`, stat({ downloaded: index }));
    t.watchdog.noteStat('k0', stat({ downloaded: 99 })); // olvidada: no cuenta como crecimiento
    expect(t.watchdog.isStalled()).toBe(false);
    await t.watchdog.stop();
  });
});

describe('reinicio manual (B-012)', () => {
  it('15 s de enfriamiento, marcado antes de llamar, y no gasta el cupo automático', async () => {
    const t = await started();
    await expect(t.watchdog.restartManual()).resolves.toEqual({ restarted: true });
    expect(t.watchdog.status()).toMatchObject({
      status: 'restarting',
      autoRestarts: { lastHour: 0 },
    });
    await expect(t.watchdog.restartManual()).rejects.toMatchObject({ code: 'restart_cooldown' });
    await advance(t, ENGINE_WATCHDOG.manualRestartCooldownMs - 1);
    await expect(t.watchdog.restartManual()).rejects.toMatchObject({ code: 'restart_cooldown' });
    await advance(t, 1);
    await expect(t.watchdog.restartManual()).resolves.toEqual({ restarted: true });
    expect(t.restart).toHaveBeenCalledTimes(2);
    expect(t.codes()).toEqual([]);
    await t.watchdog.stop();
  });

  it('si engine_control falla: restart_failed, el estado no cambia y el intento también enfría', async () => {
    const t = await started();
    t.restart.mockRejectedValueOnce(new AppError('restart_failed'));
    await expect(t.watchdog.restartManual()).rejects.toMatchObject({ code: 'restart_failed' });
    expect(t.watchdog.status().status).toBe('online');
    expect(t.states()).toEqual(['online']);
    await expect(t.watchdog.restartManual()).rejects.toMatchObject({ code: 'restart_cooldown' });
    await t.watchdog.stop();
  });

  it('mientras engine_control trabaja, los fallos del motor no cambian el estado', async () => {
    let release!: () => void;
    const t = await started({
      restart: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    t.watch(true);
    const pending = t.watchdog.restartManual();
    t.setUp(false);
    await t.clock.advanceAsync(3 * TICK);
    expect(t.watchdog.status().status).toBe('online');
    // un reinicio automático tampoco se cruza
    for (let index = 0; index < 3; index += 1) t.watchdog.reportOpenFailure();
    await expect(t.watchdog.restartManual()).rejects.toMatchObject({ code: 'restart_cooldown' });
    release();
    await expect(pending).resolves.toEqual({ restarted: true });
    expect(t.watchdog.status().status).toBe('restarting');
    expect(t.restart).toHaveBeenCalledTimes(1);
    await t.watchdog.stop();
  });

  it('el automático respeta los 15 s de un manual reciente', async () => {
    const t = await started();
    t.watch(true);
    await t.watchdog.restartManual();
    await advance(t, 2 * READY_POLL_MS); // online de nuevo
    expect(t.watchdog.status().status).toBe('online');
    for (let index = 0; index < 3; index += 1) t.watchdog.reportOpenFailure();
    await t.watchdog.idle();
    expect(t.restart).toHaveBeenCalledTimes(1);
    await ticks(t, 1); // t = 14 s: el tick de los 10 s aún está dentro de los 15 s
    expect(t.restart).toHaveBeenCalledTimes(1);
    await ticks(t, 1); // tick de los 20 s
    expect(t.restart).toHaveBeenCalledTimes(2);
    await t.watchdog.stop();
  });
});

describe('esperar a que el motor esté listo', () => {
  it('con el motor online resuelve al momento', async () => {
    const t = await started();
    await expect(t.watchdog.waitUntilReady()).resolves.toBeUndefined();
    await t.watchdog.stop();
  });

  it('mientras alguien espera se pregunta cada 2 s y resuelve con 2 aciertos', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 3);
    const calls = t.probe.mock.calls.length;
    let ready = false;
    const waiting = t.watchdog.waitUntilReady().then(() => {
      ready = true;
    });
    await t.watchdog.idle();
    expect(t.probe.mock.calls.length).toBe(calls + 1); // pregunta al momento
    t.setUp(true);
    await advance(t, READY_POLL_MS);
    expect(ready).toBe(false);
    await advance(t, READY_POLL_MS);
    await waiting;
    expect(ready).toBe(true);
    // sin nadie esperando vuelve al ritmo normal
    const after = t.probe.mock.calls.length;
    await advance(t, TICK - 1);
    expect(t.probe.mock.calls.length).toBeLessThanOrEqual(after + 1);
    await t.watchdog.stop();
  });

  it('90 s como máximo: engine_unavailable', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 3);
    const waiting = t.watchdog.waitUntilReady();
    const outcome = expect(waiting).rejects.toMatchObject({ code: 'engine_unavailable' });
    await advance(t, ENGINE_WATCHDOG.readyMaxWaitMs);
    await outcome;
    await t.watchdog.stop();
  });

  it('se cancela con la señal y el apagado rechaza a los que esperan', async () => {
    const t = await started();
    t.setUp(false);
    await ticks(t, 3);
    const controller = new AbortController();
    const cancelled = t.watchdog.waitUntilReady(controller.signal);
    controller.abort(new Error('cliente_ido'));
    await expect(cancelled).rejects.toThrow('cliente_ido');
    await expect(t.watchdog.waitUntilReady(controller.signal)).rejects.toThrow('cliente_ido');
    const pending = t.watchdog.waitUntilReady();
    await t.watchdog.stop();
    await expect(pending).rejects.toMatchObject({ code: 'engine_unavailable' });
    await expect(t.watchdog.waitUntilReady()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(t.clock.pendingTimers()).toBe(0);
  });
});
