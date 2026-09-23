/* Rutas del estado: las antiguas con la forma EXACTA de la 0.6.59 (api.md
   §4.1-4.3 y §4.7) y sus gemelas v1. Los tests portados llevan el nombre y
   comprueban lo mismo que en tests/server.test.js.

   Para no depender de los módulos que se escriben a la vez, la app se monta
   sin rutas de módulos (`moduleRoutes: false`) y se registran solo las de
   este módulo; los servicios ajenos son stubs o fakes. */

import { mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BootstrapResponseSchema,
  LegacyDirectoryResponseSchema,
  LegacyFavoritesResponseSchema,
  LegacyHistoryResponseSchema,
  LegacyPreferencesResponseSchema,
  LegacyPublicStateSchema,
  LibraryViewSchema,
  type DeviceRecord,
  type EngineStatus,
  type PlaybackStatus,
} from '@ace/shared';
import { createTestApp, native, web, type TestApp } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import { createLogger, type Logger } from '../../core/logger.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import type { RouteCollector } from '../../core/router.js';
import { notImplementedService } from '../../core/stub.js';
import type { Services } from '../../services.js';
import type { AuthService } from '../auth/types.js';
import type { EngineService } from '../engine/types.js';
import type { FootballService } from '../football/types.js';
import type { PlaybackService } from '../playback/types.js';
import { normalizeChannelBinding } from './normalize.js';
import { registerLegacyRoutes, registerV1Routes } from './routes.js';
import type { StateService } from './types.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const ID_C = 'c'.repeat(40);
const TOKEN = 'dev_iphone01.' + 'A'.repeat(43);
const DEVICE: DeviceRecord = {
  id: 'dev_iphone01',
  name: 'iPhone de prueba',
  platform: 'ios',
  secretSha256: 'b'.repeat(64),
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: null,
  revokedAt: null,
};

const OTHER_MODULES = [
  'net',
  'engine',
  'scanner',
  'search',
  'sources',
  'directories',
  'remux',
  'playback',
  'football',
  'auth',
  'events',
  'diagnostics',
  'health',
] as const;

type Overrides = Partial<Omit<Services, 'config' | 'clock' | 'logger' | 'bus'>>;

interface StateApp extends TestApp {
  readonly post: (url: string, body: unknown) => Promise<{ status: number; data: unknown }>;
  readonly get: (url: string) => Promise<{ status: number; data: unknown }>;
  readonly file: (name: string) => string;
}

/* App con el estado real (en un DATA_DIR temporal) y el resto en stub. */
async function stateApp(
  overrides: Overrides = {},
  extra?: (collector: RouteCollector, services: Services) => void,
  logger?: Logger,
): Promise<StateApp> {
  const holder: { services?: Services } = {};
  const lazy = new Proxy({} as Services, {
    get: (_target, key) => (holder.services as unknown as Record<PropertyKey, unknown>)[key],
  });
  const stubs: Overrides = {};
  for (const name of OTHER_MODULES) {
    (stubs as Record<string, unknown>)[name] = notImplementedService(name);
  }
  const test = await createTestApp({
    moduleRoutes: false,
    ...(logger ? { logger } : {}),
    services: { ...stubs, ...overrides },
    register: (collector) => {
      registerLegacyRoutes(collector.legacy, lazy);
      registerV1Routes(collector.v1, lazy);
      extra?.(collector, lazy);
    },
  });
  holder.services = test.services;
  await test.services.state.load();
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
    const res = await test.app.inject({
      method,
      url,
      headers: web(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    return { status: res.statusCode, data: res.body ? (res.json() as unknown) : null };
  };
  return {
    ...test,
    post: (url, body) => call('POST', url, body),
    get: (url) => call('GET', url),
    file: (name) => path.join(test.core.config.dataDir, name),
  };
}

/* seedState() de tests/server.test.js:31-49, con el servicio de la v2. */
async function seedState(state: StateService): Promise<void> {
  await state.enqueue(
    (draft) => {
      Object.assign(draft, {
        favorites: [{ id: ID_A, title: 'Favorito', type: 'fav' }],
        history: [{ id: ID_B, title: 'Reciente', type: 'recent' }],
        webSources: [
          {
            id: 'principal',
            name: 'Principal',
            url: 'https://example.com/list.m3u',
            type: 'm3u',
            streams: [
              { id: ID_A, title: 'Canal original', type: 'web', category: 'TV' },
              { id: ID_C, title: 'Otro canal', type: 'web', category: 'TV' },
            ],
          },
        ],
        activeWebSourceId: 'principal',
        nowPlaying: null,
      });
    },
    { scopes: ['library'] },
  );
}

/* Lo que hará la sincronización de directorios: reescribir los canales de la
   fuente con los títulos remotos (T-036). */
async function syncRemote(state: StateService, streams: unknown[]): Promise<void> {
  await state.enqueue(
    (draft) => {
      const [first] = draft.webSources;
      if (first) first.streams = streams as never;
    },
    { scopes: ['directories'] },
  );
}

describe('T-025 · guarda y normaliza las preferencias de fútbol entre dispositivos (B-142)', () => {
  it('POST /api/preferences deduplica y GET /api/state las devuelve', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    const { status, data } = await t.post('/api/preferences', {
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['LaLiga', 'LaLiga', 'Champions League'],
      teams: ['Real Madrid', '  Real   Madrid  ', 'Arsenal'],
      nationalities: ['España', 'España', 'Argentina'],
    });
    expect(status).toBe(200);
    const response = LegacyPreferencesResponseSchema.parse(data);
    expect(response.success).toBe(true);
    expect(response.preferences.leagues).toEqual(['LaLiga', 'Champions League']);
    expect(response.preferences.teams).toEqual(['Real Madrid', 'Arsenal']);
    expect(response.preferences.nationalities).toEqual(['España', 'Argentina']);
    const state = LegacyPublicStateSchema.parse((await t.get('/api/state')).data);
    expect(state.preferences.onboardingComplete).toBe(true);
    expect(state.preferences.teams).toEqual(['Real Madrid', 'Arsenal']);
    expect(state.preferences.nationalities).toEqual(['España', 'Argentina']);
  });

  it('sustituye, no fusiona: lo que no llega vuelve al defecto (api.md §4.7)', async () => {
    const t = await stateApp();
    await t.post('/api/preferences', { onboardingComplete: true, leagues: ['LaLiga'] });
    const { data } = await t.post('/api/preferences', { teams: ['Betis'] });
    expect(data).toEqual({
      success: true,
      preferences: {
        onboardingComplete: false,
        country: 'Spain',
        leagues: [],
        teams: ['Betis'],
        nationalities: [],
      },
    });
  });
});

describe('T-031 · las mutaciones HTTP no pisan colecciones de otros dispositivos (B-186)', () => {
  it('favorite-upsert deja el favorito nuevo primero y no toca el historial', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    const historyBefore = t.services.state.get().history;
    const { status, data } = await t.post('/api/library', {
      action: 'favorite-upsert',
      item: { id: ID_C, title: 'Nuevo favorito', type: 'fav' },
    });
    expect(status).toBe(200);
    expect(LegacyFavoritesResponseSchema.parse(data).success).toBe(true);
    expect(t.services.state.get().favorites[0]?.id).toBe(ID_C);
    expect(t.services.state.get().history).toEqual(historyBefore);
  });

  it('cada acción responde con su colección y los errores con su código (api.md §4.3)', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    const history = await t.post('/api/library', {
      action: 'history-upsert',
      item: { id: `acestream://${ID_C}`, title: 'Visto' },
    });
    expect(LegacyHistoryResponseSchema.parse(history.data).history.map((i) => i.id)).toEqual([
      ID_C,
      ID_B,
    ]);
    const renamed = await t.post('/api/library', {
      action: 'rename',
      collection: 'favorites',
      id: ID_A,
      title: '<b>Mi</b> favorito',
    });
    expect(LegacyFavoritesResponseSchema.parse(renamed.data).favorites[0]?.title).toBe(
      'Mi favorito',
    );
    const deleted = await t.post('/api/library', {
      action: 'delete',
      collection: 'history',
      id: ID_B,
    });
    expect(deleted.data).toEqual({
      success: true,
      history: [expect.objectContaining({ id: ID_C })],
    });
    const missing = await t.post('/api/library', {
      action: 'delete',
      collection: 'favorites',
      id: ID_C,
    });
    expect(missing.status).toBe(200);
    for (const [body, code] of [
      [{ action: 'favorite-upsert', item: { title: 'sin hash' } }, 'bad_request'],
      [{ action: 'rename', collection: 'nada', id: ID_A }, 'bad_collection'],
      [{ action: 'rename', collection: 'favorites', id: 'x' }, 'bad_request'],
      [{ action: 'rename', collection: 'favorites', id: ID_A, title: '  ' }, 'bad_title'],
      [{ action: 'rename', collection: 'web', id: ID_A, title: '<p></p>' }, 'bad_title'],
      [{ action: 'delete', collection: 'web', id: ID_A, sourceId: 'otra' }, 'source_not_found'],
      [null, 'bad_action'],
    ] as const) {
      const res = await t.post('/api/library', body);
      expect([res.status, res.data], JSON.stringify(body)).toEqual([400, { error: code }]);
    }
  });
});

describe('T-034 · un cliente 0.6.8 obsoleto no puede borrar datos actuales (B-205)', () => {
  it('PUT /api/state fusiona solo altas y conserva el título existente', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/state',
      headers: web({ 'content-type': 'application/json' }),
      payload: JSON.stringify({
        favorites: [
          { id: ID_C, title: 'Desde cliente antiguo' },
          { id: ID_A, title: 'Nombre obsoleto' },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(LegacyPublicStateSchema.safeParse(res.json()).success).toBe(true);
    const ids = t.services.state.get().favorites.map((item) => item.id);
    expect(ids).toEqual([ID_C, ID_A]);
    expect(t.services.state.get().favorites.find((item) => item.id === ID_A)?.title).toBe(
      'Favorito',
    );
  });

  it('el mando: uno nuevo se guarda con at creciente; el mismo dispositivo conserva el suyo', async () => {
    const t = await stateApp();
    const put = async (body: unknown) =>
      (
        await t.app.inject({
          method: 'PUT',
          url: '/api/state',
          headers: web({ 'content-type': 'application/json' }),
          payload: JSON.stringify(body),
        })
      ).json() as { nowPlaying: { id: string; dev: string; at: number } | null };
    const now = t.core.clock.now();
    const first = await put({ nowPlaying: { id: ID_A, dev: 'movil', title: 'Uno', at: 1 } });
    expect(first.nowPlaying).toMatchObject({ id: ID_A, dev: 'movil', at: now });
    const same = await put({ nowPlaying: { id: ID_A, dev: 'movil', title: 'Otro', at: 99 } });
    expect(same.nowPlaying).toEqual(first.nowPlaying);
    const other = await put({ nowPlaying: { id: ID_B, dev: 'tele', at: 5 } });
    expect(other.nowPlaying).toMatchObject({ id: ID_B, dev: 'tele', at: now + 1 });
    const ignored = await put({ nowPlaying: { id: ID_C }, cualquier: 'cosa' });
    expect(ignored.nowPlaying?.id).toBe(ID_B);
  });
});

describe('T-036 · renombres y borrados web sobreviven a una sincronizacion posterior (B-185)', () => {
  it('el renombre sigue tras reescribir la fuente y un borrado no vuelve', async () => {
    const t = await stateApp();
    const { state } = t.services;
    await seedState(state);
    let result = await t.post('/api/library', {
      action: 'rename',
      collection: 'web',
      sourceId: 'principal',
      id: ID_A,
      title: 'Mi nombre',
    });
    expect(result.status).toBe(200);
    const directory = LegacyDirectoryResponseSchema.parse(result.data);
    expect(directory.web.find((item) => item.id === ID_A)?.title).toBe('Mi nombre');
    expect(directory.streams).toEqual(directory.web);

    const remote = [
      { id: ID_A, title: 'Nombre remoto', type: 'web', category: 'TV' },
      { id: ID_C, title: 'Otro canal', type: 'web', category: 'TV' },
    ];
    await syncRemote(state, remote);
    expect(state.get().web.find((item) => item.id === ID_A)?.title).toBe('Mi nombre');

    result = await t.post('/api/library', {
      action: 'delete',
      collection: 'web',
      sourceId: 'principal',
      id: ID_A,
    });
    expect(result.status).toBe(200);
    await syncRemote(state, remote);
    expect(state.get().web.some((item) => item.id === ID_A)).toBe(false);
    expect(state.get().web.some((item) => item.id === ID_C)).toBe(true);
  });

  it('sin sourceId se usa el directorio activo, y renombrar un oculto lo vuelve a sacar', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    await t.post('/api/library', { action: 'delete', collection: 'web', id: ID_C });
    expect(t.services.state.get().webSources[0]?.hidden).toEqual([ID_C]);
    await t.post('/api/library', {
      action: 'rename',
      collection: 'web',
      id: ID_C,
      title: 'Vuelve',
    });
    expect(t.services.state.get().webSources[0]?.hidden).toEqual([]);
    expect(t.services.state.get().webSources[0]?.renames).toEqual({ [ID_C]: 'Vuelve' });
  });
});

describe('T-108 · el cuerpo se lee antes que el estado: una peticion lenta no pisa a la rapida (B-201)', () => {
  it('un bind con el cuerpo retrasado y unas preferencias rápidas entre medias: las dos quedan', async () => {
    /* En la v2 el vínculo lo guarda football; aquí un fake que hace lo mismo
       que saveChannelBinding (server.js:4463-4469) a través de la cola. */
    const t = await stateApp({}, (collector, services) => {
      collector.legacy.handle('POST', '/api/football/bind', async (req) => {
        const saved = await services.state.enqueue(
          (draft) => {
            const binding = normalizeChannelBinding(req.body, {
              nowIso: () => services.clock.date().toISOString(),
              defaultWebSyncUrl: '',
              footballCountry: 'Spain',
              randomHex: () => '',
            });
            if (!binding) throw new AppError('bad_request');
            draft.channelBindings = [
              binding,
              ...draft.channelBindings.filter((item) => item.channelKey !== binding.channelKey),
            ];
            return binding;
          },
          { scopes: ['bindings'] },
        );
        return { success: true, binding: saved };
      });
    });
    await seedState(t.services.state);
    /* Servidor real en ::1 (en este PC 127.0.0.1 corta conexiones). */
    await t.app.listen({ host: '::1', port: 0 });
    const { port } = t.app.server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: false });
    const body = Buffer.from(
      JSON.stringify({ channel: 'DAZN 1', id: ID_A, title: 'DAZN 1', ih: false }),
    );
    const slow = http.request({
      host: '::1',
      port,
      agent,
      method: 'POST',
      path: '/api/football/bind',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    });
    const slowResponse = new Promise<{ status: number }>((resolve, reject) => {
      slow.on('response', (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      });
      slow.on('error', reject);
    });
    slow.flushHeaders(); // cabeceras ya; el cuerpo, después
    const fast = await t.post('/api/preferences', {
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['LaLiga'],
      teams: [],
      nationalities: [],
    });
    expect(fast.status).toBe(200);
    slow.end(body);
    expect((await slowResponse).status).toBe(200);
    agent.destroy();
    const state = t.services.state.get();
    expect(state.preferences.leagues).toEqual(['LaLiga']);
    expect(state.channelBindings[0]?.id).toBe(ID_A);
  });
});

describe('T-110 · un fallo interno responde 500 con rastro en el log, no un 400 disfrazado (B-203)', () => {
  it('fallo de disco → 500 internal_error y al log; una acción desconocida → 400 bad_action', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'error',
      destination: { write: (l: string) => void lines.push(l) },
    });
    const t = await stateApp({}, undefined, logger);
    await seedState(t.services.state);
    const tmp = t.file('state.json.tmp');
    mkdirSync(tmp); // escribir sobre una carpeta revienta
    try {
      const { status, data } = await t.post('/api/preferences', { country: 'Spain' });
      expect(status).toBe(500);
      expect(data).toEqual({ error: 'internal_error' });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    expect(lines.some((line) => line.includes('"error interno"'))).toBe(true);
    const known = await t.post('/api/library', { action: 'nada' });
    expect(known.status).toBe(400);
    expect(known.data).toEqual({ error: 'bad_action' });
  });

  it('un repositorio que lanza un error cualquiera → 500 internal_error', async () => {
    const failing = {
      ...notImplementedService<StateService>('state'),
      load: async () => ({}),
      updatePreferences: async () => {
        throw new Error('disco lleno');
      },
    } as unknown as StateService;
    const t = await createTestApp({
      moduleRoutes: false,
      services: { state: failing },
      register: (collector) =>
        registerLegacyRoutes(collector.legacy, { state: failing } as Services),
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/preferences',
      headers: web({ 'content-type': 'application/json' }),
      payload: '{}',
    });
    expect([res.statusCode, res.json()]).toEqual([500, { error: 'internal_error' }]);
  });
});

describe('GET /api/state (api.md §4.1)', () => {
  it('todo el estado menos channelFeedback, con learningCount y los directorios resumidos', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    await t.services.state.enqueue(
      (draft) => {
        draft.channelFeedback = [
          {
            id: ID_A,
            channel: 'DAZN',
            verdict: 'incorrect',
            updatedAt: '2026-01-01T00:00:00.000Z',
          } as never,
        ];
      },
      { scopes: ['learning'] },
    );
    const { status, data } = await t.get('/api/state');
    expect(status).toBe(200);
    const state = LegacyPublicStateSchema.parse(data);
    expect(Object.keys(data as object)).toEqual([
      'favorites',
      'history',
      'web',
      'webSyncedAt',
      'webSources',
      'activeWebSourceId',
      'preferences',
      'channelBindings',
      'sourceReports',
      'sourceStats',
      'nowPlaying',
      'learningCount',
    ]);
    expect(state.learningCount).toBe(1);
    expect(state.webSources[0]).toEqual({
      id: 'principal',
      name: 'Principal',
      url: 'https://example.com/list.m3u',
      type: 'm3u',
      count: 2,
      syncedAt: null,
      lastErrorAt: null,
      lastError: null,
    });
  });
});

describe('rutas v1 del estado', () => {
  it('library, preferences y settings (lectura y cambio) con la forma de @ace/shared', async () => {
    const t = await stateApp();
    await seedState(t.services.state);
    const library = await t.get('/api/v1/library');
    expect(LibraryViewSchema.parse(library.data).favorites[0]?.id).toBe(ID_A);
    const mutated = await t.post('/api/v1/library', {
      action: 'favorite-upsert',
      item: { id: ID_C, title: 'Nuevo' },
    });
    expect(mutated.status).toBe(200);
    expect(LibraryViewSchema.parse(mutated.data).favorites.map((item) => item.id)).toEqual([
      ID_C,
      ID_A,
    ]);
    const invalid = await t.post('/api/v1/library', { action: 'nada' });
    expect(invalid.status).toBe(400);
    const notFound = await t.post('/api/v1/library', {
      action: 'delete',
      collection: 'web',
      id: ID_A,
      sourceId: 'otra',
    });
    expect([notFound.status, (notFound.data as { error: { code: string } }).error.code]).toEqual([
      404,
      'source_not_found',
    ]);
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/preferences',
      headers: web({ 'content-type': 'application/json' }),
      payload: JSON.stringify({ leagues: ['LaLiga', 'laliga'] }),
    });
    expect(put.json()).toMatchObject({ preferences: { leagues: ['LaLiga'] } });
    expect((await t.get('/api/v1/preferences')).data).toEqual(put.json());
    expect((await t.get('/api/v1/settings')).data).toEqual({
      settings: { sameChannelPolicy: 'share' },
      source: 'environment',
    });
    const settings = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: web({ 'content-type': 'application/json' }),
      payload: JSON.stringify({ sameChannelPolicy: 'handoff' }),
    });
    expect(settings.json()).toEqual({
      settings: { sameChannelPolicy: 'handoff' },
      source: 'saved',
    });
  });

  it('cada cambio emite state.changed por el bus tras guardar', async () => {
    const t = await stateApp();
    const events = vi.fn();
    t.services.bus.on('state.changed', events);
    await t.post('/api/library', { action: 'favorite-upsert', item: { id: ID_A } });
    await t.post('/api/library', { action: 'delete', collection: 'web', id: ID_A });
    await t.post('/api/preferences', {});
    expect(events.mock.calls.map(([payload]) => payload.scopes)).toEqual([
      ['library'],
      ['library', 'directories'],
      ['preferences'],
    ]);
  });
});

describe('GET /api/v1/bootstrap', () => {
  const playback: PlaybackStatus = {
    nowPlaying: null,
    learningCount: 0,
    serverTime: 1,
    sessions: [],
  };
  const engine: EngineStatus = {
    status: 'online',
    online: true,
    since: '2026-01-01T00:00:00.000Z',
    checkedAt: '2026-01-01T00:00:00.000Z',
    engineVersion: '3.2.3',
    autoRestarts: { lastHour: 0, max: 3, nextAllowedAt: null, exhausted: false },
  };

  it('web: versión, biblioteca, preferencias, mando, motor, ajustes y funciones', async () => {
    const t = await stateApp({
      playback: { status: () => playback } as unknown as PlaybackService,
      engine: { status: () => engine } as unknown as EngineService,
    });
    await seedState(t.services.state);
    const { status, data } = await t.get('/api/v1/bootstrap');
    expect(status).toBe(200);
    const boot = BootstrapResponseSchema.parse(data);
    expect(boot).toMatchObject({
      version: '0.7.0-test',
      origin: 'web',
      device: null,
      playback,
      engine,
      settings: { sameChannelPolicy: 'share' },
      features: { scanner: false, ai: false, demoSchedule: true },
    });
    expect(boot.library.favorites[0]?.id).toBe(ID_A);
  });

  it('native: el dispositivo emparejado sin su secreto; sin motor ni mando, valores neutros', async () => {
    const auth = {
      authenticateBearer: async (token: string): Promise<AuthenticatedDevice> => {
        if (token !== TOKEN) throw new AppError('unauthorized');
        return { deviceId: DEVICE.id, device: DEVICE, via: 'bearer' };
      },
    } as unknown as AuthService;
    const t = await stateApp({ auth, football: notImplementedService<FootballService>('f') });
    const res = await t.app.inject({
      method: 'GET',
      url: '/native/api/v1/bootstrap',
      headers: native(TOKEN),
    });
    expect(res.statusCode).toBe(200);
    const boot = BootstrapResponseSchema.parse(res.json());
    expect(boot.origin).toBe('native');
    expect(boot.device).toEqual({
      id: DEVICE.id,
      name: DEVICE.name,
      platform: 'ios',
      createdAt: DEVICE.createdAt,
      lastSeenAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(boot)).not.toContain(DEVICE.secretSha256);
    expect(boot.engine.status).toBe('unknown');
    expect(boot.playback.sessions).toEqual([]);
  });
});
