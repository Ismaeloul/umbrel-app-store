/* Rutas de directorios por HTTP (app.inject, sin sockets): las antiguas con
   su forma exacta (api.md §4.24-4.26) y las gemelas /api/v1. Los demás
   servicios son esqueletos: así este test no depende de otros módulos. */

import {
  ApiErrorSchema,
  DirectoryViewSchema,
  LegacyDirectoryResponseSchema,
  type WebSource,
} from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { notImplementedService } from '../../core/stub.js';
import { SERVICE_ORDER, type Services } from '../../services.js';
import { createTestApp, web } from '../../../test/helpers/index.js';
import type { FakeHandler, FakeReply } from '../net/testing.js';
import { ID_A, ID_B, createHarness, seedPrincipal } from './test-support.js';

const LIST: FakeReply = {
  body: `#EXTM3U\n#EXTINF:-1,Canal A\nacestream://${ID_A}\n#EXTINF:-1,Canal B\nacestream://${ID_B}\n`,
};

async function setup(routes: Record<string, FakeReply | FakeHandler> = {}) {
  const harness = createHarness({ routes });
  seedPrincipal(harness.state);
  const overrides: Record<string, unknown> = {};
  for (const name of SERVICE_ORDER) overrides[name] = notImplementedService(name);
  overrides.state = harness.state;
  overrides.directories = harness.service;
  const { app } = await createTestApp({
    services: overrides as Partial<Omit<Services, 'config' | 'clock' | 'logger' | 'bus'>>,
  });
  return { app, ...harness };
}

function source(id: string, url: string): WebSource {
  return {
    id,
    name: id,
    url,
    type: 'm3u',
    streams: [],
    renames: {},
    hidden: [],
    syncedAt: null,
    lastErrorAt: null,
    lastError: null,
  };
}

describe('POST /api/streams/sync (api.md §4.24)', () => {
  it('200 con directoryResponse (web y streams iguales) y el directorio pasa a activo', async () => {
    const { app } = await setup({ 'https://lista.example/nueva.m3u': LIST });
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/sync',
      headers: web(),
      payload: { url: 'https://lista.example/nueva.m3u', name: 'Nueva' },
    });
    expect(res.statusCode).toBe(200);
    const body = LegacyDirectoryResponseSchema.parse(res.json());
    expect(body.success).toBe(true);
    expect(body.streams).toEqual(body.web);
    expect(body.web.map((item) => item.title)).toEqual(['Canal A', 'Canal B']);
    expect(body.webSources.map((item) => item.name)).toEqual(['Principal', 'Nueva']);
    expect(body.activeWebSourceId).toBe(body.webSources[1]?.id);
  });

  it.each([
    [{}, 'bad_url'],
    [{ url: 'ftp://x' }, 'bad_url'],
    [{ url: 'https://example.com/x', sourceId: 'no-existe' }, 'source_not_found'],
    [{ sourceId: 'principal', url: 'https://no-existe.invalid/list.m3u' }, 'dns_failed'],
    [{ url: 'http://192.168.1.10/lista.m3u' }, 'private_url'],
    [{ url: 'https://lista.example/429' }, 'http_429'],
    [{ url: 'https://lista.example/vacia' }, 'empty_directory'],
  ])('%j → 400 { error: %s } como la 0.6.59', async (payload, code) => {
    const { app } = await setup({
      'https://lista.example/429': { status: 429 },
      'https://lista.example/vacia': { body: '#EXTM3U\n' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/sync',
      headers: web(),
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: code });
  });

  it('un cuerpo null ya no da 500: se trata como {} → 400 bad_url (docs/compat.md)', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/sync',
      headers: { ...web(), 'content-type': 'application/json' },
      payload: 'null',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_url' });
  });

  it('source_limit con 8 directorios', async () => {
    const { app, state } = await setup();
    state.seed({
      webSources: Array.from({ length: 8 }, (_, index) =>
        source(`d${index}`, `https://example.com/${index}.m3u`),
      ),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/sync',
      headers: web(),
      payload: { url: 'https://example.com/nueva.m3u' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'source_limit' });
  });

  it('los ipfs_* y los fallos de socket salen como 500 internal_error, como hoy (api.md §4.24)', async () => {
    const { app } = await setup({
      'https://delegated-ipfs.dev/routing/v1/ipns/k51abc': { body: Buffer.from([0x0a, 0x00]) },
      'https://ipfs.io/ipns/k51abc/lista.m3u': { status: 429 },
      'https://dweb.link/ipns/k51abc/lista.m3u': { status: 429 },
      'https://lista.example/socket': () => {
        throw Object.assign(new Error('connect ECONNREFUSED 93.184.216.35:443'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    for (const url of ['https://ipfs.io/ipns/k51abc/lista.m3u', 'https://lista.example/socket']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/streams/sync',
        headers: web(),
        payload: { url },
      });
      expect(res.statusCode, url).toBe(500);
      expect(res.json()).toEqual({ error: 'internal_error' });
    }
  });
});

describe('POST /api/streams/activate y /api/streams/delete (api.md §4.25-4.26)', () => {
  it('activate: 200 con el nuevo activo; source_not_found si no existe o no es un texto', async () => {
    const { app, state } = await setup();
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u'),
        source('dos', 'https://example.com/2.m3u'),
      ],
    });
    let res = await app.inject({
      method: 'POST',
      url: '/api/streams/activate',
      headers: web(),
      payload: { sourceId: 'dos' },
    });
    expect(res.statusCode).toBe(200);
    expect(LegacyDirectoryResponseSchema.parse(res.json()).activeWebSourceId).toBe('dos');
    for (const payload of [{ sourceId: 'tres' }, { sourceId: 2 }, {}]) {
      res = await app.inject({
        method: 'POST',
        url: '/api/streams/activate',
        headers: web(),
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'source_not_found' });
    }
  });

  it('delete: 200; nunca el último (last_source)', async () => {
    const { app, state } = await setup();
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u'),
        source('dos', 'https://example.com/2.m3u'),
      ],
    });
    let res = await app.inject({
      method: 'POST',
      url: '/api/streams/delete',
      headers: web(),
      payload: { sourceId: 'uno' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, activeWebSourceId: 'dos' });
    res = await app.inject({
      method: 'POST',
      url: '/api/streams/delete',
      headers: web(),
      payload: { sourceId: 'dos' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'last_source' });
  });

  it('una petición de otro sitio se rechaza antes de llegar (anti-CSRF)', async () => {
    const { app, requested } = await setup({ 'https://lista.example/x.m3u': LIST });
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/sync',
      headers: web({ 'sec-fetch-site': 'cross-site' }),
      payload: { url: 'https://lista.example/x.m3u' },
    });
    expect(res.statusCode).toBe(403);
    expect(requested()).toEqual([]);
  });
});

describe('/api/v1/directories', () => {
  it('GET da la vista v1 (sin success ni streams)', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/directories', headers: web() });
    expect(res.statusCode).toBe(200);
    const view = DirectoryViewSchema.parse(res.json());
    expect(view.activeWebSourceId).toBe('principal');
    expect(res.json()).not.toHaveProperty('streams');
  });

  it('POST sync, activate y DELETE devuelven la vista', async () => {
    const { app } = await setup({ 'https://lista.example/nueva.m3u': LIST });
    let res = await app.inject({
      method: 'POST',
      url: '/api/v1/directories/sync',
      headers: web(),
      payload: { url: 'https://lista.example/nueva.m3u', type: 'm3u' },
    });
    expect(res.statusCode).toBe(200);
    const created = DirectoryViewSchema.parse(res.json());
    expect(created.web).toHaveLength(2);
    res = await app.inject({
      method: 'POST',
      url: '/api/v1/directories/principal/activate',
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    expect(DirectoryViewSchema.parse(res.json()).activeWebSourceId).toBe('principal');
    res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/directories/${created.activeWebSourceId}`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    expect(DirectoryViewSchema.parse(res.json()).webSources).toHaveLength(1);
  });

  it.each([
    [
      'POST',
      '/api/v1/directories/sync',
      { sourceId: 'principal', url: 'https://no-existe.invalid/x' },
      502,
      'dns_failed',
    ],
    ['POST', '/api/v1/directories/sync', { url: 'https://lista.example/429' }, 502, 'http_429'],
    ['POST', '/api/v1/directories/sync', { url: 'http://10.0.0.1/x' }, 400, 'private_url'],
    ['POST', '/api/v1/directories/sync', { url: 'https://x', extra: 1 }, 400, 'validation_error'],
    ['POST', '/api/v1/directories/nada/activate', undefined, 404, 'source_not_found'],
    ['DELETE', '/api/v1/directories/principal', undefined, 409, 'last_source'],
    ['DELETE', '/api/v1/directories/con%20espacio', undefined, 400, 'validation_error'],
  ])('%s %s → %s %s con el formato v1', async (method, url, payload, status, code) => {
    const { app } = await setup({ 'https://lista.example/429': { status: 429 } });
    const res = await app.inject({
      method: method as 'POST',
      url,
      headers: web(),
      ...(payload ? { payload } : {}),
    });
    expect(res.statusCode).toBe(status);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error.code).toBe(code);
  });

  it('un ipfs_* en v1 es 502 con su mensaje (no 500)', async () => {
    const { app } = await setup({
      'https://delegated-ipfs.dev/routing/v1/ipns/k51abc': { body: Buffer.from([0x0a, 0x00]) },
      'https://ipfs.io/ipns/k51abc/lista.m3u': { status: 404 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/directories/sync',
      headers: web(),
      payload: { url: 'https://ipfs.io/ipns/k51abc/lista.m3u' },
    });
    expect(res.statusCode).toBe(502);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('ipfs_bad_record');
  });
});
