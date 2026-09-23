/* El módulo `engine` entero contra el motor falso y un engine_control falso
   (plan E1.6: "reinicio con cupo y recuperación del canal"). El motor falso y
   el backend comparten el FakeClock: 60 s de motor caído pasan en
   milisegundos; solo las conexiones son reales (en loopback `::1`). */

import { describe, expect, it } from 'vitest';
import { ENGINE_WATCHDOG, TIMEOUTS, type EngineStatus } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { createTestCore, FakeClock } from '../../../test/helpers/index.js';
import type { DiagnosticReport } from '../../core/bus.js';
import { createEngineService } from './index.js';
import { createEngineRuntime, engineBaseUrl } from './service.js';
import { engineConfig, sendJson, startFakeEngine, startHttpServer } from './test-support.js';
import { READY_POLL_MS } from './watchdog.js';

const TICK = ENGINE_WATCHDOG.intervalMs;
const TOKEN = 'token-de-prueba';
const RESTART_DOWN_MS = 5_000;
const STEP_MS = 1_000;
const CHANNEL = demoContentId(1);

async function setup(
  options: { token?: string; controlStatus?: number; restartFixes?: boolean } = {},
) {
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  const engine = await startFakeEngine(clock);
  let restartDone: Promise<void> | null = null;
  const control = await startHttpServer((req, res) => {
    req.resume();
    if (options.controlStatus) {
      sendJson(res, options.controlStatus, { error: 'restart_failed' });
      return;
    }
    /* Como Docker: el contenedor se reinicia (y vuelve sin modos de fallo). */
    restartDone = engine.control.restart({ downMs: RESTART_DOWN_MS });
    if (options.restartFixes === false) {
      sendJson(res, 200, { restarted: true });
      return;
    }
    void engine.control.clearMode('*').then(() => sendJson(res, 200, { restarted: true }));
  });
  const config = engineConfig(core.config, {
    engine: { host: engine.host, port: engine.port },
    control: { host: control.host, port: control.port },
    token: options.token ?? TOKEN,
  });
  const runtime = createEngineRuntime({ ...core, config });
  const events: EngineStatus[] = [];
  const reports: DiagnosticReport[] = [];
  core.bus.on('engine.status', (status) => events.push(status));
  core.bus.on('diagnostics.report', (report) => reports.push(report));

  const settle = () => runtime.watchdog.idle();
  /* De segundo en segundo, esperando a la red en cada paso: un salto grande
     del reloj vencería el plazo de 3 s de una pregunta que acaba de salir
     antes de que la respuesta (real) llegue. */
  const advance = async (ms: number): Promise<void> => {
    for (let left = ms; left > 0; left -= STEP_MS) {
      clock.advance(Math.min(STEP_MS, left));
      await settle();
    }
  };
  const ticks = async (count: number): Promise<void> => {
    for (let index = 0; index < count; index += 1) await advance(TICK);
  };
  /* El reinicio del motor falso: pasan los 5 s y vuelve a escuchar. */
  const finishEngineRestart = async (): Promise<void> => {
    await advance(RESTART_DOWN_MS);
    await restartDone;
  };
  const watch = (watching: boolean): void =>
    core.bus.emit('playback.activity', { watching, hashes: [], viewers: watching ? 1 : 0 });
  await runtime.service.start();
  await settle();
  return {
    clock,
    core,
    engine,
    control,
    runtime,
    service: runtime.service,
    events,
    reports,
    advance,
    ticks,
    finishEngineRestart,
    watch,
    states: () => events.map((event) => event.status),
    codes: () => reports.map((report) => report.code),
  };
}

describe('vigilante contra el motor falso (B-011)', () => {
  it('online al arrancar; caído sin nadie viendo: offline al 3er fallo; vuelve con 2 aciertos', async () => {
    const t = await setup();
    expect(t.service.status()).toMatchObject({ status: 'online', engineVersion: '3.2.3' });
    expect(t.service.legacyStatus().online).toBe(true);
    expect(t.service.legacyStatus().raw).toContain('"version":"3.2.3"');
    await t.engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await t.ticks(2);
    expect(t.service.status().status).toBe('online');
    await t.ticks(1);
    expect(t.service.status().status).toBe('offline');
    await t.engine.control.clearMode('*');
    await t.ticks(1);
    expect(t.service.status().status).toBe('offline');
    await t.ticks(1);
    expect(t.service.status().status).toBe('online');
    expect(t.states()).toEqual(['online', 'offline', 'online']);
    await t.service.stop();
  });

  it('con alguien viendo, un solo silencio del motor NO lo pone offline', async () => {
    const t = await setup();
    t.watch(true);
    await t.engine.control.setMode('*', { kind: 'down', how: '503' });
    await t.ticks(1);
    await t.engine.control.clearMode('*');
    await t.ticks(1);
    await t.engine.control.setMode('*', { kind: 'down', how: '503' });
    await t.ticks(1);
    expect(t.service.status().status).toBe('online');
    await t.ticks(1);
    expect(t.service.status().status).toBe('offline');
    expect(t.states()).toEqual(['online', 'offline']);
    await t.service.stop();
  });

  it('un motor colgado que aún contesta get_version sigue online', async () => {
    const t = await setup();
    await t.engine.control.setMode('*', 'stall');
    await t.ticks(5);
    expect(t.service.status().status).toBe('online');
    await t.service.stop();
  });
});

describe('reinicio manual vía engine_control (T-118 del lado del backend, B-012, B-229)', () => {
  it('manda x-engine-token, pasa a restarting y vuelve con 2 respuestas buenas', async () => {
    const t = await setup();
    await t.service.client().openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    await expect(t.service.restartManual()).resolves.toEqual({ restarted: true });
    expect(t.control.requests).toHaveLength(1);
    expect(t.control.requests[0]).toMatchObject({ method: 'POST', url: '/restart' });
    expect(t.control.requests[0]?.headers['x-engine-token']).toBe(TOKEN);
    expect(t.service.status().status).toBe('restarting');
    expect(t.service.legacyStatus().online).toBe(false);
    const ready = t.service.waitUntilReady();
    await t.finishEngineRestart();
    expect(t.service.status().status).toBe('restarting');
    await t.advance(READY_POLL_MS);
    await t.advance(READY_POLL_MS);
    await ready;
    expect(t.service.status().status).toBe('online');
    expect(t.states()).toEqual(['online', 'restarting', 'online']);
    expect(t.engine.control.metrics()).toMatchObject({ restarts: 1, sessionsLostInRestart: 1 });
    // el enfriamiento de 15 s
    await expect(t.service.restartManual()).rejects.toMatchObject({ code: 'restart_cooldown' });
    await t.service.stop();
  });

  it('sin token configurado no manda la cabecera (engine_control 0.7.0 lo rechazará)', async () => {
    const t = await setup({ token: '' });
    await t.service.restartManual();
    expect(t.control.requests[0]?.headers).not.toHaveProperty('x-engine-token');
    await t.finishEngineRestart();
    await t.service.stop();
  });

  it('engine_control que responde fuera de 2xx o no está → restart_failed', async () => {
    const t = await setup({ controlStatus: 401 });
    await expect(t.service.restartManual()).rejects.toMatchObject({ code: 'restart_failed' });
    expect(t.service.status().status).toBe('online');
    await t.advance(ENGINE_WATCHDOG.manualRestartCooldownMs);
    await t.control.close();
    await expect(t.service.restartManual()).rejects.toMatchObject({ code: 'restart_failed' });
    await t.service.stop();
  });

  it('engine_control que no contesta en 8 s → restart_failed', async () => {
    const clock = new FakeClock();
    const core = createTestCore({ clock });
    const control = await startHttpServer(() => undefined);
    const service = createEngineService({
      ...core,
      config: engineConfig(core.config, { control: { host: control.host, port: control.port } }),
    });
    const pending = service.restartManual();
    const outcome = expect(pending).rejects.toMatchObject({ code: 'restart_failed' });
    clock.advance(TIMEOUTS.engineControlMs);
    await outcome;
  });
});

describe('reinicio automático contra el motor falso (arquitectura §5.5)', () => {
  it('motor caído 60 s con alguien viendo: reinicia, espera y avisa de que ha vuelto (B-013)', async () => {
    const t = await setup();
    t.watch(true);
    await t.engine.control.setMode('*', { kind: 'down', how: 'refuse' });
    await t.ticks(2);
    expect(t.service.status().status).toBe('offline');
    await t.ticks(5);
    expect(t.control.requests).toHaveLength(0);
    await t.ticks(1);
    expect(t.control.requests).toHaveLength(1);
    expect(t.service.status()).toMatchObject({
      status: 'restarting',
      autoRestarts: { lastHour: 1, exhausted: false },
    });
    await t.finishEngineRestart();
    await t.advance(READY_POLL_MS);
    await t.advance(READY_POLL_MS);
    expect(t.states()).toEqual(['online', 'offline', 'restarting', 'online']);
    expect(t.codes()).toEqual(['engine_auto_restart']);
    await t.service.stop();
  });

  it('motor que no vuelve: 3 reinicios por hora como mucho, con esperas, y aviso al agotarse', async () => {
    const t = await setup({ restartFixes: false });
    t.watch(true);
    await t.engine.control.setMode('*', { kind: 'down', how: '503' });
    const restartTimes: number[] = [];
    const seen = (): void => {
      while (restartTimes.length < t.control.requests.length) restartTimes.push(t.clock.now());
    };
    for (let tick = 0; tick < 360; tick += 1) {
      await t.ticks(1);
      seen();
    }
    expect(restartTimes).toHaveLength(3);
    const [first, second, third] = restartTimes as [number, number, number];
    expect(second - first).toBeGreaterThanOrEqual(60_000);
    expect(third - second).toBeGreaterThanOrEqual(120_000);
    expect(t.service.status()).toMatchObject({
      status: 'offline',
      autoRestarts: { lastHour: 3, max: 3, exhausted: true },
    });
    expect(t.codes().filter((code) => code === 'engine_auto_restart_exhausted')).toHaveLength(1);
    expect(t.codes().filter((code) => code === 'engine_not_ready')).toHaveLength(3);
    // pasada la hora del primero, vuelve a intentarlo
    await t.ticks(12);
    expect(t.control.requests).toHaveLength(4);
    await t.service.stop();
  });

  it('motor que contesta pero no entrega: 60 s de estadísticas colgadas → reinicio', async () => {
    const t = await setup();
    const client = t.service.client();
    const meta = await client.openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' });
    t.watch(true);
    await expect(client.getStat(meta.statUrl)).resolves.toMatchObject({ peers: 14 });
    expect(t.runtime.watchdog.isStalled()).toBe(false);
    await t.engine.control.setMode('*', 'stall');
    const stat = client.getStat(meta.statUrl).catch((error: unknown) => error);
    await t.advance(TIMEOUTS.engineStatMs);
    await expect(stat).resolves.toMatchObject({ code: 'engine_timeout' });
    // la sospecha empieza a los 3 s: el tick de los 60 s aún no llega a 60 s de silencio
    await t.ticks(6);
    expect(t.control.requests).toHaveLength(0);
    await t.ticks(1);
    expect(t.control.requests).toHaveLength(1);
    expect(t.codes()).toEqual(['engine_stalled', 'engine_auto_restart']);
    await t.finishEngineRestart();
    await t.advance(READY_POLL_MS);
    await t.advance(READY_POLL_MS);
    expect(t.service.status().status).toBe('online');
    await t.service.stop();
  });

  it('3 aperturas seguidas que vencen por culpa del motor → reinicio', async () => {
    const t = await setup();
    t.watch(true);
    await t.engine.control.setMode('*', 'stall');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const open = t.service
        .client()
        .openSession({ hash: CHANNEL, kind: 'id', mode: 'hls' })
        .catch((error: unknown) => error);
      await t.advance(TIMEOUTS.engineSessionMetaMs);
      await expect(open).resolves.toMatchObject({ code: 'engine_timeout' });
      t.service.reportOpenFailure(); // lo que hace playback
    }
    await t.runtime.watchdog.idle();
    expect(t.control.requests).toHaveLength(1);
    await t.finishEngineRestart();
    await t.advance(READY_POLL_MS);
    await t.advance(READY_POLL_MS);
    expect(t.service.status().status).toBe('online');
    t.service.reportOpenSuccess();
    await t.service.stop();
  });
});

describe('montaje', () => {
  it('no hace red ni programa nada hasta start(); la URL del motor sale de la config', async () => {
    const clock = new FakeClock();
    const core = createTestCore({ clock });
    const service = createEngineService(core);
    expect(clock.pendingTimers()).toBe(0);
    expect(service.status().status).toBe('unknown');
    expect(engineBaseUrl(core)).toBe('http://ismaeloul-ace-player-neo_acestream_1:6878');
    await service.stop();
  });
});
