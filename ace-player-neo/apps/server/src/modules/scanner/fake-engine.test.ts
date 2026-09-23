/* Sondas de verdad contra el motor AceStream falso (test/fake-engine), por
   HTTP en ::1 y con el mismo reloj falso: verificada, floja por caudal,
   sin pares, sin vídeo, HEVC, motor colgado y sesión que se escapa. En todas
   se comprueba con las métricas del motor que la sesión se para
   (B-014, B-017, B-018, B-020, B-021; arquitectura §5.8). */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../core/clock.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { demoContentId, type FakeContentInput } from '../../../test/fake-engine/catalog.js';
import { createFakeEngine, type FakeEngine } from '../../../test/fake-engine/engine.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import type { ScannerServiceImpl } from './service.js';
import { createTestScanner, pumpUntil } from './test-support.js';
import {
  createHttpScannerTransport,
  type ProbeProcess,
  type ProbeSpawner,
  type ScannerTransport,
} from './transport.js';

const STARVED = 'bad5a1de'.padEnd(40, '0');

const CATALOG: FakeContentInput[] = [
  { id: demoContentId(1), title: 'Canal Deportes 1 HD --> ALFA', bitrateKbps: 3500, peers: 14 },
  { id: demoContentId(4), title: 'Canal Fútbol FHD --> BETA', video: 'hevc', bitrateKbps: 6000 },
  { id: demoContentId(8), title: 'Canal Liga Extra SD --> DELTA', bitrateKbps: 1200, peers: 0 },
  { id: STARVED, title: 'Canal Lento --> GAMMA', bitrateKbps: 3000, intakeRatio: 0.5 },
];

/** ffprobe de mentira: responde con los flujos que se le digan. */
function fakeFfprobe(streams: { codec_type: string; codec_name: string }[]): ProbeSpawner {
  return () => {
    const events = new EventEmitter();
    const stdout = new EventEmitter();
    const child = {
      stdout,
      exitCode: null as number | null,
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return child;
      },
      kill() {
        child.exitCode = 137;
        return true;
      },
    };
    queueMicrotask(() => {
      stdout.emit('data', Buffer.from(JSON.stringify({ streams })));
      child.exitCode = 0;
      events.emit('close');
    });
    return child as unknown as ProbeProcess;
  };
}

let clock: FakeClock;
let engine: FakeEngine;

beforeEach(async () => {
  clock = new FakeClock();
  engine = await createFakeEngine({ clock, host: await loopbackHost(), catalog: CATALOG });
});

afterEach(async () => {
  await engine.close();
});

function scannerWith(transport?: ScannerTransport): ScannerServiceImpl {
  const core = createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner' }, clock });
  return createTestScanner(
    core,
    transport ?? createHttpScannerTransport({ host: engine.host, port: engine.port, clock }),
  );
}

/** Lanza un trabajo de un candidato y deja correr la sonda hasta el final. */
async function probeOne(scanner: ScannerServiceImpl, id: string) {
  const ref = scanner.enqueue({ kind: 'research', candidates: [{ id, ih: false }], force: true });
  const job = new Promise<void>((resolve) => {
    const wait = (): void => {
      const status = scanner.job(ref?.id ?? '').status;
      if (status === 'complete' || status === 'waiting') resolve();
      else setImmediate(wait);
    };
    wait();
  });
  await pumpUntil(clock, job);
  await scanner.stop();
  return scanner.job(ref?.id ?? '').candidates[0];
}

function sessionsClosed(): void {
  const metrics = engine.control.metrics();
  expect(metrics.sessionsOpen).toBe(0);
  expect(metrics.stopsReceived).toBe(metrics.sessionsOpened);
  expect(metrics.stopsUnknown).toBe(0);
}

describe('sonda real contra el motor falso', () => {
  it('H.264 con caudal de sobra: verificada, con códec y bitrate del propio TS, y sesión parada', async () => {
    const candidate = await probeOne(scannerWith(), demoContentId(1));
    expect(candidate).toMatchObject({
      state: 'working',
      reason: 'playable_media',
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      mediaValid: true,
      browserCompatible: true,
      attempts: 1,
    });
    expect(candidate?.streamKbps).toBeGreaterThan(3000);
    expect(candidate?.intakeKbps).toBeGreaterThan(3500);
    expect(candidate?.bytes).toBeGreaterThan(128 * 1024);
    expect(candidate?.peers).toBe(14);
    sessionsClosed();
    expect(engine.control.metrics().sessionsOpened).toBe(1);
  });

  it('con la mitad del caudal que pide el canal: floja por "starved" (B-020)', async () => {
    const candidate = await probeOne(scannerWith(), STARVED);
    expect(candidate).toMatchObject({ state: 'weak', reason: 'starved', videoCodec: 'h264' });
    expect(candidate?.intakeKbps).toBeLessThan(0.85 * (candidate?.streamKbps ?? 0));
    sessionsClosed();
  });

  it('sin pares no llega ni un byte: fallida por plazo, con reintento, y la sesión se para', async () => {
    const candidate = await probeOne(scannerWith(), demoContentId(8));
    expect(candidate).toMatchObject({ state: 'failed', reason: 'timeout', bytes: 0, peers: 0 });
    expect(candidate?.retryAt).not.toBeNull();
    sessionsClosed();
  });

  it('HEVC: fallida por códec para la web, reproducible en iOS (D6), sin reintento', async () => {
    const scanner = scannerWith();
    const candidate = await probeOne(scanner, demoContentId(4));
    expect(candidate).toMatchObject({
      state: 'failed',
      reason: 'unsupported_codec',
      videoCodec: 'hevc',
      retryAt: null,
    });
    expect(scanner.verdict(demoContentId(4))?.playableOn).toEqual({ web: false, ios: true });
    sessionsClosed();
  });

  it('un TS sin PMT legible: ffprobe dice que no hay vídeo → fallida no_video', async () => {
    const http = createHttpScannerTransport({
      host: engine.host,
      port: engine.port,
      clock,
      spawn: fakeFfprobe([{ codec_type: 'audio', codec_name: 'aac' }]),
    });
    /* La muestra de verdad, pero como si la PMT no hubiera llegado. */
    const transport: ScannerTransport = {
      ...http,
      sample: async (...args) => ({ ...(await http.sample(...args)), videoCodec: '' }),
    };
    const candidate = await probeOne(scannerWith(transport), demoContentId(1));
    expect(candidate).toMatchObject({ state: 'failed', reason: 'no_video', mediaValid: false });
    sessionsClosed();
  });

  it('motor colgado: la meta vence a los 12 s, fallida por plazo y se avisa de una posible fuga', async () => {
    await engine.control.setMode('*', 'stall');
    const scanner = scannerWith();
    const candidate = await probeOne(scanner, demoContentId(1));
    expect(candidate).toMatchObject({ state: 'failed', reason: 'timeout' });
    expect(candidate?.durationMs).toBeGreaterThanOrEqual(12_000);
    expect(candidate?.durationMs).toBeLessThan(12_500);
    expect(scanner.stats().leakedSessionsLastHour).toBe(1);
    await engine.control.clearMode('*');
  });

  it('la meta tarda más que el plazo: el motor abrió la sesión y queda sin parar (fuga contada)', async () => {
    await engine.control.setMode(demoContentId(1), { kind: 'slowStart', ms: 15_000 });
    const scanner = scannerWith();
    const candidate = await probeOne(scanner, demoContentId(1));
    expect(candidate).toMatchObject({ state: 'failed', reason: 'timeout' });
    expect(scanner.stats().leakedSessionsLastHour).toBe(1);
    expect(engine.control.metrics()).toMatchObject({ sessionsOpened: 1, stopsReceived: 0 });
  });
});
