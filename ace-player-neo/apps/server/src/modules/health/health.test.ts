/* Salud y versión (arquitectura §5.14; B-207, B-208, B-241). La forma de
   /api/health es la EXACTA de la 0.6.59 (la valida su esquema estricto),
   pero sale de las cachés de los servicios: aquí todo son fakes y las
   sondas de red cuentan cuántas veces se las llama. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HealthLiveResponseSchema,
  HealthResponseSchema,
  LegacyHealthResponseSchema,
  PingResponseSchema,
  type EngineStatus,
  type PlaybackStatus,
  type StateV1,
} from '@ace/shared';
import { createTestApp, createTestCore, web, type TestCore } from '../../../test/helpers/index.js';
import type { AppConfig } from '../../config/index.js';
import { notImplementedService } from '../../core/stub.js';
import type { Services } from '../../services.js';
import type { DiagnosticsService } from '../diagnostics/types.js';
import type { EngineService } from '../engine/types.js';
import type { EventsHub } from '../events/types.js';
import type { FootballService } from '../football/types.js';
import type { PlaybackService } from '../playback/types.js';
import type { RemuxService } from '../remux/types.js';
import type { ScannerService, ScannerStats } from '../scanner/types.js';
import { createStateService } from '../state/service.js';
import type { StateLoadReport, StateService } from '../state/types.js';
import { bindLegacyHealth } from './legacy-binding.js';
import { systemHealth } from './legacy-exports.js';
import { registerLegacyRoutes, registerV1Routes } from './routes.js';
import {
  HEALTH_PROBE_TTL_MS,
  WEB_SYNC_INTERVAL_MS,
  cachedProbe,
  createHealthService,
  defaultProbes,
} from './service.js';
import type { HealthDeps, HealthProbes, HealthService } from './types.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

afterEach(() => bindLegacyHealth(null));

function engineStatus(online: boolean, exhausted = false): EngineStatus {
  return {
    status: online ? 'online' : 'offline',
    online,
    since: null,
    checkedAt: null,
    engineVersion: online ? '3.2.3' : null,
    autoRestarts: { lastHour: exhausted ? 3 : 0, max: 3, nextAllowedAt: null, exhausted },
  };
}

const SCANNER_STATS: ScannerStats = {
  enabled: true,
  busy: true,
  queue: 2,
  activeJobs: 1,
  cachedSources: 7,
  leakedSessionsLastHour: 0,
  /* Recién arrancado el comprobador aún no ha preguntado su get_version. */
  online: null,
};

const AGENDA = {
  status: 'ready' as const,
  generatedAt: '2026-01-01T00:00:00.000Z',
  matches: 12,
  preheated: 3,
  aiEnabled: false,
};

interface Fakes {
  engine?: EngineStatus | (() => EngineStatus);
  scanner?: ScannerStats & { online?: boolean | null };
  football?: Record<string, unknown> | (() => never);
  playback?: PlaybackStatus;
  probes?: Partial<HealthProbes>;
  env?: Record<string, string>;
  state?: StateService;
}

interface Setup {
  readonly core: TestCore;
  readonly health: HealthService;
  readonly state: StateService;
  readonly probes: {
    ollamaTags: ReturnType<typeof vi.fn>;
    scannerVersion: ReturnType<typeof vi.fn>;
  };
}

function setup(fakes: Fakes = {}): Setup {
  const core = createTestCore({ env: fakes.env ?? {} });
  const state = fakes.state ?? createStateService(core);
  const probes = {
    ollamaTags: vi.fn(
      fakes.probes?.ollamaTags ??
        (async () => ({ ok: true, models: ['embeddinggemma:300m-qat-q4_0'] })),
    ),
    scannerVersion: vi.fn(fakes.probes?.scannerVersion ?? (async () => true)),
  };
  const engine = fakes.engine ?? engineStatus(true);
  const deps: HealthDeps = {
    ...core,
    state,
    engine: {
      status: typeof engine === 'function' ? engine : () => engine,
    } as unknown as EngineService,
    scanner: { stats: () => fakes.scanner ?? SCANNER_STATS } as unknown as ScannerService,
    football: {
      healthInfo:
        typeof fakes.football === 'function' ? fakes.football : () => fakes.football ?? AGENDA,
    } as unknown as FootballService,
    playback: {
      status: () =>
        fakes.playback ?? { nowPlaying: null, learningCount: 0, serverTime: 0, sessions: [] },
    } as unknown as PlaybackService,
    remux: { stats: () => ({ sessions: 1, max: 3 }) } as unknown as RemuxService,
    events: { connections: () => 4 } as unknown as EventsHub,
    diagnostics: {
      counts24h: () => ({ engine: 1, source: 2, network: 0, codec: 0, client: 5 }),
    } as unknown as DiagnosticsService,
    sources: notImplementedService('sources'),
    directories: notImplementedService('directories'),
    probes,
  };
  return { core, health: createHealthService(deps), state, probes };
}

const SCANNER_ENV = { ACESTREAM_SCANNER_HOST: 'scanner' };
const AI_ENV = { OLLAMA_BASE_URL: 'http://ollama:11434' };

describe('T-102 · servidor y service worker declaran la version del manifiesto (B-241)', () => {
  it('/api/health y /api/v1/ping dicen la versión inyectada por el build (APP_VERSION)', async () => {
    const { health, core } = setup();
    expect(core.config.appVersion).toBe('0.7.0-test');
    expect((await health.legacyHealth()).version).toBe('0.7.0-test');
    expect(health.ping().version).toBe('0.7.0-test');
    expect((await health.health()).version).toBe('0.7.0-test');
    const other = setup({ env: { APP_VERSION: '0.7.1' } });
    expect((await other.health.legacyHealth()).version).toBe('0.7.1');
  });
});

describe('GET /api/health: la forma exacta de la 0.6.59 sin red por petición (B-207, B-208)', () => {
  it('cumple el esquema estricto y sale de las cachés (ni motor ni comprobador por red)', async () => {
    const { health, probes } = setup({ env: SCANNER_ENV });
    const result = await health.legacyHealth();
    expect(LegacyHealthResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      success: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
      uptimeSeconds: 0,
      components: {
        backend: { status: 'ready', online: true },
        engine: { status: 'ready', online: true },
        scanner: {
          status: 'ready',
          online: true,
          busy: true,
          queue: 2,
          activeJobs: 1,
          cachedSources: 7,
        },
        ai: { status: 'disabled', online: false, model: 'embeddinggemma:300m-qat-q4_0' },
        agenda: { status: 'ready', generatedAt: AGENDA.generatedAt, matches: 12, preheated: 3 },
      },
    });
    /* Sin IA configurada no lleva modelReady (api.md §4.17). */
    expect('modelReady' in result.components.ai).toBe(false);
    /* El comprobador aún no sabe si está en línea (`online: null`): una sonda, y cacheada. */
    await health.legacyHealth();
    await health.legacyHealth();
    expect(probes.scannerVersion).toHaveBeenCalledTimes(1);
    expect(probes.ollamaTags).not.toHaveBeenCalled();
  });

  it('si el comprobador expone `online`, no se sondea nada', async () => {
    const { health, probes } = setup({
      env: SCANNER_ENV,
      scanner: { ...SCANNER_STATS, online: false },
    });
    const result = await health.legacyHealth();
    expect(result.components.scanner).toMatchObject({ status: 'offline', online: false });
    expect(probes.scannerVersion).not.toHaveBeenCalled();
  });

  it('sin comprobador configurado: disabled y online false (el vigilante del NAS lo mira)', async () => {
    const { health, probes } = setup();
    const result = await health.legacyHealth();
    expect(result.components.scanner).toMatchObject({ status: 'disabled', online: false });
    expect(probes.scannerVersion).not.toHaveBeenCalled();
  });

  it('motor caído y servicios que fallan: sigue respondiendo con lo que hay', async () => {
    const { health } = setup({
      engine: () => {
        throw new Error('sin vigilante');
      },
      football: () => {
        throw new Error('sin agenda');
      },
    });
    const result = await health.legacyHealth();
    expect(LegacyHealthResponseSchema.safeParse(result).success).toBe(true);
    expect(result.components.engine).toEqual({ status: 'offline', online: false });
    expect(result.components.agenda).toEqual({
      status: 'warming',
      generatedAt: null,
      matches: 0,
      preheated: 0,
    });
    const offline = setup({ engine: engineStatus(false) });
    expect((await offline.health.legacyHealth()).components.engine).toEqual({
      status: 'offline',
      online: false,
    });
  });

  it('directorios (rancio a las 4 h 30 min, degraded con error) e informes en cuarentena', async () => {
    const { health, state, core } = setup();
    const now = core.clock.now();
    await state.enqueue(
      (draft) => {
        Object.assign(draft, {
          webSources: [
            {
              id: 'principal',
              url: 'https://example.com/a.m3u',
              streams: [{ id: A }, { id: B }],
              syncedAt: new Date(now - 60_000).toISOString(),
            },
            {
              id: 'vieja',
              name: 'Vieja',
              url: 'https://example.com/b.m3u',
              streams: [{ id: A }],
              syncedAt: new Date(now - WEB_SYNC_INTERVAL_MS * 1.5 - 1).toISOString(),
              lastErrorAt: new Date(now).toISOString(),
              lastError: 'http_429',
            },
          ],
          sourceReports: [
            { reportId: 'r1', id: A, quarantineUntil: new Date(now + 60_000).toISOString() },
            { reportId: 'r2', id: B, quarantineUntil: new Date(now - 60_000).toISOString() },
          ],
          channelFeedback: [{ id: A, channel: 'X', verdict: 'correct' }],
        });
      },
      { scopes: ['directories'] },
    );
    const result = await health.legacyHealth();
    expect(result.components.directories).toEqual({
      status: 'degraded',
      total: 2,
      channels: 3,
      sources: [
        {
          id: 'principal',
          name: 'example.com',
          count: 2,
          syncedAt: new Date(now - 60_000).toISOString(),
          lastErrorAt: null,
          stale: false,
        },
        {
          id: 'vieja',
          name: 'Vieja',
          count: 1,
          syncedAt: new Date(now - WEB_SYNC_INTERVAL_MS * 1.5 - 1).toISOString(),
          lastErrorAt: new Date(now).toISOString(),
          stale: true,
        },
      ],
    });
    expect(result.reports).toEqual({ total: 2, quarantined: 1, learningCount: 1 });
  });

  it('uptimeSeconds cuenta con el reloj inyectado', async () => {
    const { health, core } = setup();
    core.clock.advance(90_400);
    expect((await health.legacyHealth()).uptimeSeconds).toBe(90);
  });
});

describe('IA (ollamaHealth, server.js:4594-4610) desde una sonda cacheada', () => {
  it.each([
    [{ ok: true, models: ['embeddinggemma:300m-qat-q4_0'] }, 'ready', true, true],
    [{ ok: true, models: ['embeddinggemma:latest'] }, 'ready', true, true],
    [{ ok: true, models: ['otro:1b'] }, 'model_missing', true, false],
    [{ ok: false, models: [] }, 'offline', false, false],
  ])('%j → %s', async (tags, status, online, modelReady) => {
    const { health } = setup({ env: AI_ENV, probes: { ollamaTags: async () => tags } });
    expect((await health.legacyHealth()).components.ai).toEqual({
      status,
      online,
      model: 'embeddinggemma:300m-qat-q4_0',
      modelReady,
    });
  });

  it('si Ollama no responde: offline; y como mucho una petición cada 30 s', async () => {
    const { health, probes, core } = setup({
      env: AI_ENV,
      probes: {
        ollamaTags: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    expect((await health.legacyHealth()).components.ai).toMatchObject({
      status: 'offline',
      modelReady: false,
    });
    await health.legacyHealth();
    expect(probes.ollamaTags).toHaveBeenCalledTimes(1);
    core.clock.advance(HEALTH_PROBE_TTL_MS);
    await health.legacyHealth();
    expect(probes.ollamaTags).toHaveBeenCalledTimes(2);
  });

  it('si football expone el estado de la IA, se usa sin sondear', async () => {
    const { health, probes } = setup({
      env: AI_ENV,
      football: { ...AGENDA, aiEnabled: true, ai: { status: 'model_missing' } },
    });
    expect((await health.legacyHealth()).components.ai).toEqual({
      status: 'model_missing',
      online: true,
      model: 'embeddinggemma:300m-qat-q4_0',
      modelReady: false,
    });
    expect(probes.ollamaTags).not.toHaveBeenCalled();
  });
});

describe('caché de sondas', () => {
  it('devuelve lo último al caducar y refresca por detrás; una sonda colgada se corta a tiempo', async () => {
    const core = createTestCore();
    let calls = 0;
    const probe = cachedProbe(
      core.clock,
      1000,
      500,
      async () => {
        calls += 1;
        return calls;
      },
      () => -1,
    );
    expect(await probe.get()).toBe(1);
    core.clock.advance(1000);
    expect(await probe.get()).toBe(1); // lo viejo, y refresca
    await Promise.resolve();
    expect(await probe.get()).toBe(2);

    const hung = cachedProbe(
      core.clock,
      1000,
      500,
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      () => -1,
    );
    const pending = hung.get();
    await core.clock.advanceAsync(500);
    expect(await pending).toBe(-1);
  });
});

describe('/api/v1/health, /health/live y /ping', () => {
  it('panel: cumple su esquema y junta motor, comprobador, estado, reproducción y diagnóstico', async () => {
    const { health } = setup({
      env: { ...SCANNER_ENV, ...AI_ENV },
      engine: engineStatus(true, true),
      scanner: { ...SCANNER_STATS, leakedSessionsLastHour: 2 },
      probes: { ollamaTags: async () => ({ ok: true, models: [] }) },
      playback: {
        nowPlaying: null,
        learningCount: 0,
        serverTime: 0,
        sessions: [
          {
            id: 's_abcdefgh',
            hash: A,
            mode: 'hls',
            openedAt: '2026-01-01T00:00:00.000Z',
            viewers: [
              {
                client: 'web',
                deviceId: 'd1',
                lastBeatAt: '2026-01-01T00:00:00.000Z',
                viewerId: 'v_web1',
                deviceName: 'Chrome · Windows',
                platform: 'web',
                playing: true,
              },
              {
                client: 'ios',
                deviceId: 'd2',
                lastBeatAt: '2026-01-01T00:00:00.000Z',
                viewerId: 'v_ios1',
                deviceName: 'iPhone',
                platform: 'ios',
                playing: null,
              },
            ],
            title: 'Canal',
            protocol: 'hls',
          },
        ],
      },
    });
    const result = await health.health();
    expect(HealthResponseSchema.safeParse(result).success).toBe(true);
    expect(result.components).toMatchObject({
      engine: { status: 'online', engineVersion: '3.2.3' },
      scanner: { status: 'degraded', leakedSessionsLastHour: 2 },
      ai: { status: 'model_missing' },
      state: { status: 'ready', recoveredFrom: null },
      playback: { sessions: 1, viewers: 2, remuxSessions: 1 },
      events: { connections: 4 },
    });
    expect(result.diagnostics.counts24h).toEqual({
      engine: 1,
      source: 2,
      network: 0,
      codec: 0,
      client: 5,
      state: 0,
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'engine_restart_quota',
      'scanner_leaked_sessions',
      'ai_model_missing',
    ]);
  });

  it('un estado recuperado o arrancado vacío se ve en el panel', async () => {
    const report = (status: StateLoadReport['status']): StateService =>
      ({
        get: () =>
          ({ webSources: [], sourceReports: [], channelFeedback: [] }) as unknown as StateV1,
        loadReport: () => ({
          status,
          recoveredFrom: status === 'recovered' ? 'state.json.bak' : null,
          quarantined: [],
          schemaVersionBefore: 1,
          schemaVersionAfter: 2,
          preMigrationCopy: false,
        }),
      }) as unknown as StateService;
    const recovered = await setup({ state: report('recovered') }).health.health();
    expect(recovered.components.state).toEqual({
      status: 'recovered',
      recoveredFrom: 'state.json.bak',
    });
    expect(recovered.warnings[0]?.code).toBe('state_recovered');
    const degraded = await setup({ state: report('degraded') }).health.health();
    expect(degraded.components.state.status).toBe('degraded');
    expect(degraded.warnings[0]?.code).toBe('state_unreadable');
    expect(degraded.components.directories.status).toBe('empty');
  });

  it('con todos los servicios en stub: 200 con avisos, nunca un 500', async () => {
    const core = createTestCore();
    const health = createHealthService({
      ...core,
      state: notImplementedService('state'),
      engine: notImplementedService('engine'),
      scanner: notImplementedService('scanner'),
      sources: notImplementedService('sources'),
      directories: notImplementedService('directories'),
      playback: notImplementedService('playback'),
      remux: notImplementedService('remux'),
      football: notImplementedService('football'),
      diagnostics: notImplementedService('diagnostics'),
      events: notImplementedService('events'),
      probes: {
        ollamaTags: async () => ({ ok: true, models: [] }),
        scannerVersion: async () => false,
      },
    });
    const legacy = await health.legacyHealth();
    expect(LegacyHealthResponseSchema.safeParse(legacy).success).toBe(true);
    expect(legacy.reports).toEqual({ total: 0, quarantined: 0, learningCount: 0 });
    const panel = await health.health();
    expect(HealthResponseSchema.safeParse(panel).success).toBe(true);
    expect(panel.warnings.every((warning) => warning.code === 'component_unavailable')).toBe(true);
    expect(panel.components.engine.status).toBe('unknown');
  });

  it('live y ping: sin red ni disco', () => {
    const { health, core } = setup();
    expect(HealthLiveResponseSchema.parse(health.live())).toEqual({ ok: true });
    core.clock.advance(5);
    expect(PingResponseSchema.parse(health.ping())).toEqual({
      ok: true,
      app: 'ace-player-neo',
      version: '0.7.0-test',
      apiVersion: 1,
      serverTime: core.clock.now(),
    });
  });
});

describe('rutas de la salud', () => {
  it('GET /api/health, /api/v1/health, /api/v1/health/live y /api/v1/ping por HTTP', async () => {
    const { health } = setup();
    const services = { health } as unknown as Services;
    const { app } = await createTestApp({
      moduleRoutes: false,
      services: { health },
      register: (collector) => {
        registerLegacyRoutes(collector.legacy, services);
        registerV1Routes(collector.v1, services);
      },
    });
    const legacy = await app.inject({ method: 'GET', url: '/api/health', headers: web() });
    expect(legacy.statusCode).toBe(200);
    expect(LegacyHealthResponseSchema.safeParse(legacy.json()).success).toBe(true);
    const panel = await app.inject({ method: 'GET', url: '/api/v1/health', headers: web() });
    expect(HealthResponseSchema.safeParse(panel.json()).success).toBe(true);
    /* El healthcheck de Docker va sin X-Ace-Origin (origen web). */
    const live = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect([live.statusCode, live.json()]).toEqual([200, { ok: true }]);
    const ping = await app.inject({ method: 'GET', url: '/native/api/v1/ping' });
    expect(ping.json()).toMatchObject({ ok: true, app: 'ace-player-neo' });
    const nativeHealth = await app.inject({ method: 'GET', url: '/native/api/v1/health/live' });
    expect(nativeHealth.statusCode).toBe(401);
  });

  it('systemHealth de la fachada llama al servicio enlazado', async () => {
    await expect(systemHealth()).rejects.toThrow('not_implemented');
    const { health } = setup();
    bindLegacyHealth(health);
    expect((await systemHealth()).success).toBe(true);
  });
});

describe('sondas reales (contra servidores falsos en ::1)', () => {
  it('ollamaTags lee los modelos y scannerVersion mira el HTTP', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ models: [{ name: 'a:1' }, { model: 'b:2' }, {}, null] }));
      } else if (req.url?.startsWith('/webui/api/service')) {
        res.end('{"result":{"version":"3.2.3"}}');
      } else {
        res.statusCode = 404;
        res.end('no');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const config = {
        ai: { ollamaBaseUrl: `http://[::1]:${port}` },
        scanner: { host: '[::1]', port },
      } as unknown as AppConfig;
      const probes = defaultProbes({ config });
      const signal = new AbortController().signal;
      expect(await probes.ollamaTags(signal)).toEqual({ ok: true, models: ['a:1', 'b:2', '', ''] });
      expect(await probes.scannerVersion(signal)).toBe(true);
      const broken = defaultProbes({
        config: { ...config, ai: { ollamaBaseUrl: `http://[::1]:${port}/nada` } } as AppConfig,
      });
      expect(await broken.ollamaTags(signal)).toEqual({ ok: false, models: [] });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
