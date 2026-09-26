/* Utilidades de los tests de playback (no es código de producto: solo lo
   importan los *.test.ts).

   - `createMemoryState()`: un StateService en memoria con lo que usa
     playback (mando, aprendizaje, política y v2/sessions.json).
   - `setupPlayback()`: el motor falso de test/fake-engine en loopback (::1 si
     se puede) con su PROPIO reloj falso, el cliente real del motor, el remux
     con un ffmpeg falso y el SessionManager con el FakeClock del backend.
     Todo se cierra solo en el `afterEach` (el motor, en el `afterAll`). */

import { afterAll, afterEach } from 'vitest';
import {
  SCHEMA_VERSION,
  type EngineStatus,
  type SameChannelPolicy,
  type SessionsFile,
  type StateV1,
} from '@ace/shared';
import { createFakeEngine, type FakeEngine } from '../../../test/fake-engine/engine.js';
import { loopbackHost } from '../../../test/fake-engine/test-utils.js';
import { createTestCore, type TestCore } from '../../../test/helpers/index.js';
import { FakeClock } from '../../core/clock.js';
import { notImplemented } from '../../core/errors.js';
import type { DomainEvents, DomainEventType } from '../../core/bus.js';
import { createEngineRuntime } from '../engine/service.js';
import type { EngineService } from '../engine/types.js';
import { SerialLock } from '../remux/lock.js';
import { createRemuxRuntime, type RemuxRuntime } from '../remux/service.js';
import {
  createFakeLauncher,
  type FakeLauncher,
  type FakeLauncherOptions,
} from '../remux/test-support.js';
import type { ScannerService, SourceVerdict } from '../scanner/types.js';
import type { JsonDocumentStore, StateService } from '../state/types.js';
import { createPlaybackRuntime, type PlaybackRuntime } from './service.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/* Un motor falso por fichero de tests (y por opción), reiniciado entre test y
   test: menos servidores y conexiones que abrir y cerrar. En el PC de Isma los
   filtros de red tumban a veces el proceso de Node con muchas conexiones
   nuevas seguidas (test/fake-engine/README.md). */
const sharedEngines = new Map<string, Promise<{ engine: FakeEngine; clock: FakeClock }>>();

afterAll(async () => {
  const all = [...sharedEngines.values()];
  sharedEngines.clear();
  for (const entry of all) await (await entry).engine.close();
});

async function sharedEngine(
  unknownContent: 'play' | 'fail',
): Promise<{ engine: FakeEngine; clock: FakeClock }> {
  let entry = sharedEngines.get(unknownContent);
  if (!entry) {
    entry = (async () => {
      const clock = new FakeClock();
      const engine = await createFakeEngine({ host: await loopbackHost(), clock, unknownContent });
      return { engine, clock };
    })();
    sharedEngines.set(unknownContent, entry);
  }
  const shared = await entry;
  await shared.engine.control.reset({ sessions: true, metrics: true });
  return shared;
}

/** Servicio que lanza `not_implemented` en lo que no se le ha dado. */
function partial<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl as T, {
    get(target, property) {
      if (property in target) return (target as Record<PropertyKey, unknown>)[property];
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw notImplemented(`${name}.${String(property)}`);
      };
    },
  });
}

export interface MemoryState extends StateService {
  setPolicy(policy: SameChannelPolicy): void;
  setLearning(count: number): void;
  writes(): number;
}

export function createMemoryState(initial: { policy?: SameChannelPolicy } = {}): MemoryState {
  let current = { nowPlaying: null, channelFeedback: [] } as unknown as StateV1;
  let policy: SameChannelPolicy = initial.policy ?? 'share';
  let learning = 0;
  let writes = 0;
  const queue = new SerialLock();
  let sessionsDoc: SessionsFile = { schemaVersion: SCHEMA_VERSION, sessions: [] };
  const sessionsLock = new SerialLock();
  const sessionsStore: JsonDocumentStore<SessionsFile> = {
    read: () => sessionsDoc,
    update: (mutator) =>
      sessionsLock.run(async () => {
        const draft = structuredClone(sessionsDoc);
        const result = await mutator(draft);
        sessionsDoc = draft;
        writes += 1;
        return result;
      }),
  };
  return partial<MemoryState>('state', {
    get: () => current,
    enqueue: (mutator) =>
      queue.run(async () => {
        const draft = structuredClone(current) as StateV1;
        const result = await mutator(draft);
        current = draft;
        writes += 1;
        return result;
      }),
    learningCount: () => learning,
    sameChannelPolicy: () => policy,
    sessions: () => sessionsStore,
    flush: async () => {
      await queue.idle();
      await sessionsLock.idle();
    },
    setPolicy: (next: SameChannelPolicy) => {
      policy = next;
    },
    setLearning: (count: number) => {
      learning = count;
    },
    writes: () => writes,
  });
}

export function fakeScanner(verdicts: Map<string, SourceVerdict> = new Map()): ScannerService {
  return partial<ScannerService>('scanner', {
    verdict: (hash: string) => verdicts.get(hash) ?? null,
  });
}

/** Lo que se publica en el bus, para comprobarlo en los tests. */
export interface Recorded {
  readonly type: DomainEventType;
  readonly data: unknown;
}

export function recordEvents(core: TestCore): {
  all: Recorded[];
  of<T extends DomainEventType>(type: T): DomainEvents[T][];
} {
  const all: Recorded[] = [];
  const types: DomainEventType[] = [
    'playback.activity',
    'playback.handoff',
    'playback.nowPlaying',
    'playback.sessions',
    'stream.ready',
    'stream.reopened',
    'stream.modeChanged',
    'stream.closed',
    'stream.stats',
    'diagnostics.report',
  ];
  for (const type of types) core.bus.on(type, (data) => all.push({ type, data }));
  return {
    all,
    of: <T extends DomainEventType>(type: T) =>
      all.filter((event) => event.type === type).map((event) => event.data as DomainEvents[T]),
  };
}

export function engineStatus(status: EngineStatus['status']): EngineStatus {
  return {
    status,
    online: status === 'online',
    since: null,
    checkedAt: null,
    engineVersion: '3.2.3',
    autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
  };
}

export interface PlaybackSetup {
  readonly core: TestCore;
  readonly clock: FakeClock;
  /** Reloj del motor falso (aparte: el motor solo avanza cuando el test lo pide). */
  readonly engineClock: FakeClock;
  readonly fakeEngine: FakeEngine;
  readonly engine: EngineService;
  readonly state: MemoryState;
  readonly scanner: ScannerService;
  readonly remux: RemuxRuntime;
  readonly ffmpeg: FakeLauncher;
  readonly runtime: PlaybackRuntime;
  readonly events: ReturnType<typeof recordEvents>;
}

export interface PlaybackSetupOptions {
  readonly policy?: SameChannelPolicy;
  readonly launcher?: FakeLauncherOptions;
  readonly unknownContent?: 'play' | 'fail';
  readonly verdicts?: Map<string, SourceVerdict>;
  readonly state?: StateService;
  /** Sin `start()` del SessionManager (se prueba a mano). */
  readonly noStart?: boolean;
  /** C.4 encendido (docs/multidispositivo.md §4.6). */
  readonly shareViaRemux?: boolean;
}

export async function setupPlayback(options: PlaybackSetupOptions = {}): Promise<PlaybackSetup> {
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  const { engine: fakeEngine, clock: engineClock } = await sharedEngine(
    options.unknownContent ?? 'play',
  );
  const config = {
    ...core.config,
    engine: { ...core.config.engine, host: fakeEngine.host, port: fakeEngine.port },
  };
  const coreWithEngine: TestCore = { ...core, config };
  const engine = createEngineRuntime(coreWithEngine).service;
  const state = (options.state ??
    createMemoryState({ policy: options.policy ?? 'share' })) as MemoryState;
  const scanner = fakeScanner(options.verdicts);
  const ffmpeg = createFakeLauncher(options.launcher);
  const remux = createRemuxRuntime({
    ...coreWithEngine,
    engine,
    launcher: ffmpeg.launcher,
    procRoot: null,
    watchFiles: false,
  });
  const events = recordEvents(core);
  const runtime = createPlaybackRuntime({
    ...coreWithEngine,
    engine,
    remux: remux.service,
    state,
    scanner,
    ...(options.shareViaRemux === undefined ? {} : { shareViaRemux: options.shareViaRemux }),
  });
  if (!options.noStart) await runtime.service.start();
  cleanups.push(async () => {
    await runtime.service.stop();
    await remux.service.stop();
  });
  return {
    core: coreWithEngine,
    clock,
    engineClock,
    fakeEngine,
    engine,
    state,
    scanner,
    remux,
    ffmpeg,
    runtime,
    events,
  };
}
