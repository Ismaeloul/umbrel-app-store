/* Arnés de los tests de integración del backend (paso 1.3).

   Monta el backend ENTERO con `createServices` y servicios reales: estado en
   una carpeta temporal, cliente y vigilante del motor contra el motor
   AceStream falso (test/fake-engine) por HTTP en ::1, remux con un ffmpeg
   falso, comprobador contra un segundo motor falso, hub SSE, salud, auth…
   Arranca con `startServices` (el mismo código que main.ts) y se apaga con
   `stopServices`. Solo hay tres cosas que no son "de verdad":

   - el reloj (FakeClock: 2 h pasan en segundos);
   - ffmpeg (FakeFfmpeg escribe la lista y los segmentos en disco);
   - engine_control: un servidor HTTP mínimo que, al pedirle `/restart`,
     reinicia el motor falso (como `docker restart`).

   Los servicios con trabajos en segundo plano (motor, remux, playback) se
   crean aquí con su `*Runtime` para poder esperar a que terminen (`idle`);
   se pasan a `createServices` como sustitutos y el resto los crea él con sus
   dependencias de verdad. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { DomainEvents, DomainEventType } from '../../src/core/bus.js';
import type { Logger } from '../../src/core/logger.js';
import { FakeClock } from '../../src/core/clock.js';
import { startServices, stopServices } from '../../src/main.js';
import { createEngineRuntime, type EngineRuntime } from '../../src/modules/engine/service.js';
import { createHub, type EventsHubInternal } from '../../src/modules/events/hub.js';
import { scoreResolutionCandidate } from '../../src/modules/football/resolution.js';
import { IptvServiceImpl } from '../../src/modules/iptv/service.js';
import { createNetClient } from '../../src/modules/net/index.js';
import type { NetResolver, NetTransport } from '../../src/modules/net/types.js';
import { FakeSink } from '../../src/modules/events/test-support.js';
import { createPlaybackRuntime, type PlaybackRuntime } from '../../src/modules/playback/service.js';
import { createRemuxRuntime, type RemuxRuntime } from '../../src/modules/remux/service.js';
import { createFakeLauncher, type FakeLauncher } from '../../src/modules/remux/test-support.js';
import type { ProcessLauncher } from '../../src/modules/remux/types.js';
import { createScannerService } from '../../src/modules/scanner/index.js';
import {
  createHttpScannerTransport,
  type ProbeSpawner,
} from '../../src/modules/scanner/transport.js';
import { createStateService } from '../../src/modules/state/index.js';
import { createServices, type Services } from '../../src/services.js';
import type { FakeContentInput } from '../fake-engine/catalog.js';
import { createFakeEngine, type FakeEngine } from '../fake-engine/engine.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import { createTestCore, type TestCore } from '../helpers/index.js';

/** Vueltas del bucle de eventos para que acabe la E/S real en curso (fs, sockets). */
export async function ioTurns(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Espera en tiempo REAL (sockets de verdad) a que se cumpla algo; falla a los `maxMs`. */
export async function until(what: string, check: () => boolean, maxMs = 5000): Promise<void> {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > maxMs) throw new Error(`no ha pasado a tiempo: ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

/** ffprobe de mentira para el comprobador: H.264 + AAC (no hay ffprobe en el PC de Isma). */
export const fakeFfprobe: ProbeSpawner = () => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const stdoutListeners: ((chunk: Buffer) => void)[] = [];
  const child = {
    stdout: {
      on(event: string, listener: (chunk: Buffer) => void) {
        if (event === 'data') stdoutListeners.push(listener);
        return child.stdout;
      },
    },
    exitCode: null as number | null,
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return child;
    },
    kill() {
      child.exitCode = 137;
      return true;
    },
  };
  queueMicrotask(() => {
    const streams = [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ];
    for (const listener of stdoutListeners) listener(Buffer.from(JSON.stringify({ streams })));
    child.exitCode = 0;
    for (const listener of listeners.get('close') ?? []) listener(0);
  });
  return child as unknown as ReturnType<ProbeSpawner>;
};

/** engine_control falso: `POST /restart` reinicia el motor falso (sin sesiones) y responde 200. */
export interface FakeEngineControl {
  readonly port: number;
  readonly host: string;
  /** Peticiones de reinicio recibidas. */
  restarts(): number;
  close(): Promise<void>;
}

async function startFakeEngineControl(
  engine: FakeEngine,
  engineClock: FakeClock,
  host: string,
): Promise<FakeEngineControl> {
  let restarts = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/restart') {
      res.statusCode = 404;
      res.end();
      return;
    }
    restarts += 1;
    void (async () => {
      /* `docker restart`: el contenedor vuelve limpio, sin modos de fallo. */
      await engine.control.clearMode('*');
      const restarted = engine.control.restart({ downMs: 0 });
      engineClock.advance(0);
      await restarted;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    host,
    restarts: () => restarts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface HarnessOptions {
  /** Catálogo del motor principal (por defecto, los 8 canales inventados). */
  readonly catalog?: readonly FakeContentInput[];
  /** Con comprobador: un segundo motor falso con este catálogo (comparte el reloj del backend). */
  readonly scannerCatalog?: readonly FakeContentInput[];
  /** Caducidad sin lectores del motor principal (por defecto la del motor, 60 s de SU reloj). */
  readonly idleTimeoutMs?: number;
  /** Variables de entorno de más. */
  readonly env?: Record<string, string>;
  /** DNS y transporte del cliente saliente (la IPTV contra el proveedor falso). */
  readonly net?: { readonly resolver: NetResolver; readonly transport: NetTransport };
  /** Lanzador de ffmpeg propio (por defecto, el falso que escribe segmentos al lanzarse). */
  readonly launcher?: (fallback: FakeLauncher) => ProcessLauncher;
  /** Reloj del backend (para crear antes piezas que lo comparten). */
  readonly clock?: FakeClock;
  /** Logger del backend (por defecto, mudo). */
  readonly logger?: Logger;
}

/** Lo que llega por el bus, en orden (para comprobar el cableado entre módulos). */
export interface BusRecorder {
  readonly all: { readonly type: DomainEventType; readonly data: unknown; readonly at: number }[];
  of<T extends DomainEventType>(type: T): DomainEvents[T][];
  clear(): void;
}

export interface SettleOptions {
  /** Tope de espera real por vuelta (por defecto 2 s). */
  readonly maxRealMs?: number;
}

export interface Harness {
  readonly core: TestCore;
  /** Reloj del backend (y del motor comprobador). */
  readonly clock: FakeClock;
  /** Reloj propio del motor principal: solo avanza cuando el test lo pide. */
  readonly engineClock: FakeClock;
  readonly fake: FakeEngine;
  readonly scannerEngine: FakeEngine | null;
  readonly control: FakeEngineControl;
  readonly services: Services;
  readonly app: FastifyInstance;
  readonly engine: EngineRuntime;
  readonly playback: PlaybackRuntime;
  readonly remux: RemuxRuntime;
  readonly ffmpeg: FakeLauncher;
  readonly hub: EventsHubInternal;
  readonly iptv: IptvServiceImpl;
  readonly bus: BusRecorder;
  /** Abre una conexión SSE simulada contra el hub real. */
  sse(options?: {
    readonly origin?: 'web' | 'native';
    readonly deviceId?: string | null;
  }): FakeSink;
  /**
   * Espera a que terminen los trabajos en curso (sondas del vigilante,
   * reaperturas, remux). Con un tope en tiempo real: con el motor colgado hay
   * peticiones que solo acaban cuando avanza el reloj falso.
   */
  settle(options?: SettleOptions): Promise<void>;
  /** Avanza el reloj del backend a pasos, dejando terminar la E/S real entre paso y paso. */
  advance(ms: number, step?: number, options?: SettleOptions): Promise<void>;
  /** Apagado limpio (el de main.ts) y cierre de los motores falsos. */
  close(): Promise<void>;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const host = await loopbackHost();
  const clock = options.clock ?? new FakeClock();
  const engineClock = new FakeClock();
  const fake = await createFakeEngine({
    host,
    clock: engineClock,
    ...(options.catalog ? { catalog: options.catalog } : {}),
    ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
  });
  const scannerEngine = options.scannerCatalog
    ? await createFakeEngine({ host, clock, catalog: options.scannerCatalog })
    : null;
  const control = await startFakeEngineControl(fake, engineClock, host);

  const base = createTestCore({
    clock,
    ...(options.logger ? { logger: options.logger } : {}),
    env: {
      ...(scannerEngine ? { ACESTREAM_SCANNER_HOST: 'comprobador' } : {}),
      ...options.env,
    },
  });
  /* El saneado de ACESTREAM_HOST quita los ":" de "::1": se pone a mano. */
  const config = {
    ...base.config,
    engine: {
      ...base.config.engine,
      host: fake.host,
      port: fake.port,
      controlHost: control.host,
      controlPort: control.port,
    },
    scanner: scannerEngine
      ? { ...base.config.scanner, host: scannerEngine.host, port: scannerEngine.port }
      : base.config.scanner,
  };
  const core: TestCore = { ...base, config };

  const engine = createEngineRuntime(core);
  const ffmpeg = createFakeLauncher();
  const state = createStateService(core);
  const net = createNetClient({
    ...core,
    ...(options.net ? { resolver: options.net.resolver, transport: options.net.transport } : {}),
  });
  const iptv = new IptvServiceImpl({
    ...core,
    state,
    net,
    relayHost: host === '::1' ? '::1' : '127.0.0.1',
    /* Como services.ts: la IPTV puntúa con la función de la resolución (§14.3). */
    scorer: (channels, item) => scoreResolutionCandidate(channels, item, 'iptv'),
  });
  const remux = createRemuxRuntime({
    ...core,
    engine: engine.service,
    launcher: options.launcher ? options.launcher(ffmpeg) : ffmpeg.launcher,
    procRoot: null,
    watchFiles: false,
    redact: (text) => iptv.redact(text),
  });
  const scanner = createScannerService({
    ...core,
    engine: engine.service,
    iptv,
    ...(scannerEngine
      ? {
          transport: createHttpScannerTransport({
            host: scannerEngine.host,
            port: scannerEngine.port,
            clock,
            spawn: fakeFfprobe,
          }),
        }
      : {}),
  });
  const playback = createPlaybackRuntime({
    ...core,
    engine: engine.service,
    remux: remux.service,
    state,
    scanner,
    iptv,
  });
  const hub = createHub(core);

  const recorded: BusRecorder['all'][number][] = [];
  const types: DomainEventType[] = [
    'engine.status',
    'playback.activity',
    'playback.handoff',
    'playback.nowPlaying',
    'stream.ready',
    'stream.reopened',
    'stream.modeChanged',
    'stream.closed',
    'scan.verdict',
    'scan.jobDone',
    'state.changed',
    'diagnostics.report',
    'diagnostics.new',
    'devices.changed',
    'iptv.status',
    'stream.stats',
  ];
  for (const type of types) {
    core.bus.on(type, (data) => recorded.push({ type, data, at: clock.now() }));
  }

  const services = createServices(core, {
    engine: engine.service,
    remux: remux.service,
    state,
    net,
    iptv,
    scanner,
    playback: playback.service,
    events: hub,
  });
  await startServices(services);
  const app = await buildApp({ services });
  await app.ready();

  const settle = async (settleOptions: SettleOptions = {}): Promise<void> => {
    const maxRealMs = settleOptions.maxRealMs ?? 2000;
    for (let round = 0; round < 3; round += 1) {
      await ioTurns();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxRealMs);
      });
      await Promise.race([
        Promise.all([engine.watchdog.idle(), playback.idle(), remux.idle()]),
        cap,
      ]);
      clearTimeout(timer);
    }
  };

  let closed = false;
  return {
    core,
    clock,
    engineClock,
    fake,
    scannerEngine,
    control,
    services,
    app,
    engine,
    playback,
    remux,
    ffmpeg,
    hub,
    iptv,
    bus: {
      all: recorded,
      of: <T extends DomainEventType>(type: T) =>
        recorded
          .filter((event) => event.type === type)
          .map((event) => event.data as DomainEvents[T]),
      clear: () => {
        recorded.length = 0;
      },
    },
    sse(connect = {}) {
      const sink = new FakeSink();
      void hub.attach(sink, {
        origin: connect.origin ?? 'web',
        deviceId: connect.deviceId ?? null,
        lastEventId: null,
        signal: new AbortController().signal,
      });
      return sink;
    },
    settle,
    async advance(ms, step = 1000, settleOptions = {}) {
      let left = ms;
      while (left > 0) {
        const delta = Math.min(step, left);
        await clock.advanceAsync(delta);
        await settle(settleOptions);
        left -= delta;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await stopServices(services, app);
      await control.close();
      await fake.close();
      await scannerEngine?.close();
    },
  };
}

/** Cabeceras web para `app.inject` (lo que pone nginx). */
export const WEB = { 'x-ace-origin': 'web' } as const;
