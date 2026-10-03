/* Esqueleto de Ajustes → IPTV por HTTP (docs/iptv.md §5.3): sin proveedor
   guardado, las 5 rutas responden con el contrato. La parte «servidor»
   sustituye estos casos por los de service.test.ts y la integración. */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  IptvBrowseResponseSchema,
  IptvViewSchema,
  VodBrowseResponseSchema,
  VodHomeSchema,
} from '@ace/shared';
import { createLogger } from '../../core/logger.js';
import { FAKE_TOKEN, createTestApp, native, web } from '../../../test/helpers/index.js';

const EMPTY = { provider: null, refreshHours: 6 };

describe('rutas de la IPTV (esqueleto del contrato)', () => {
  it('sin IPTV: ver y eliminar dan provider null; pausar y actualizar, iptv_not_configured', async () => {
    const { app } = await createTestApp();
    const get = await app.inject({ method: 'GET', url: '/api/v1/iptv', headers: web() });
    expect(get.statusCode).toBe(200);
    expect(IptvViewSchema.parse(get.json())).toEqual(EMPTY);

    const del = await app.inject({ method: 'DELETE', url: '/api/v1/iptv', headers: web() });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual(EMPTY);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/iptv',
      headers: web(),
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('iptv_not_configured');

    const sync = await app.inject({ method: 'POST', url: '/api/v1/iptv/sync', headers: web() });
    expect(sync.statusCode).toBe(409);
    expect(sync.json().error.code).toBe('iptv_not_configured');
  });

  it('pestaña (§16.2): sin IPTV, active false; consulta o cursor malos → 400; desde /native, 403; la consulta no va al registro', async () => {
    const logs: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          logs.push(chunk.toString());
          done();
        },
      }),
    });
    const { app } = await createTestApp({ logger });
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/iptv/browse?q=dazn&country=ES&limit=0',
      headers: web(),
    });
    expect(ok.statusCode).toBe(200);
    expect(IptvBrowseResponseSchema.parse(ok.json())).toMatchObject({
      active: false,
      catalog: '0',
      query: 'dazn',
      channels: [],
    });
    for (const query of ['country=es', 'sport=none', 'limit=101', 'grupo=x', 'cursor=no%2Bvale']) {
      const bad = await app.inject({
        method: 'GET',
        url: `/api/v1/iptv/browse?${query}`,
        headers: web(),
      });
      expect(bad.statusCode, query).toBe(400);
      expect(bad.json().error.code).toBe('validation_error');
    }
    const cursor = await app.inject({
      method: 'GET',
      url: '/api/v1/iptv/browse?cursor=bm8tdmFsZQ',
      headers: web(),
    });
    expect(cursor.statusCode).toBe(400);
    const nativeRes = await app.inject({
      method: 'GET',
      url: '/native/api/v1/iptv/browse',
      headers: native(FAKE_TOKEN),
    });
    expect([401, 403]).toContain(nativeRes.statusCode);
    const logged = logs.join('');
    expect(logged).toContain('/api/v1/iptv/browse?[consulta]');
    expect(logged).not.toContain('q=dazn');
  });

  it('guardar valida el cuerpo (claves de más → 400) sin repetir la entrada en el error', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/iptv',
      headers: web(),
      payload: { kind: 'xtream', password: 'Cl4ve-Secreta-E2E', url: 'http://x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
    expect(res.body).not.toContain('Cl4ve-Secreta-E2E');
  });
});

/* Películas y series (docs/vod.md §11.1). Sin IPTV: la portada y la rejilla
   responden 200 con `active: false` (no es un error); la ficha y el progreso,
   `vod_unavailable`; un cartel, `vod_not_found`. `vodStream` sigue en 501
   hasta los enganches de la reproducción (VOD-5). Con IPTV, vod-service.test.ts. */
describe('rutas de Películas y series sin IPTV', () => {
  const VOD_ID = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';

  it('portada y rejilla 200 con active false; ficha, cartel y progreso con su código; vodStream 501', async () => {
    const { app } = await createTestApp();
    const home = await app.inject({ method: 'GET', url: '/api/v1/vod', headers: web() });
    expect(home.statusCode).toBe(200);
    expect(VodHomeSchema.parse(home.json())).toMatchObject({ active: false, state: 'off' });
    const browse = await app.inject({
      method: 'GET',
      url: '/api/v1/vod/browse?kind=series&q=office',
      headers: web(),
    });
    expect(browse.statusCode).toBe(200);
    expect(VodBrowseResponseSchema.parse(browse.json())).toMatchObject({
      active: false,
      items: [],
    });
    const cases: Array<[string, number, string]> = [
      [`/api/v1/vod/titles/${VOD_ID}`, 503, 'vod_unavailable'],
      [`/api/v1/vod/titles/${VOD_ID}/art/poster?v=3fa9c210`, 404, 'vod_not_found'],
      [
        `/api/v1/vod/titles/${VOD_ID}/stream?client=web&viewer=viewer_tab01`,
        501,
        'not_implemented',
      ],
    ];
    for (const [url, status, code] of cases) {
      const res = await app.inject({ method: 'GET', url, headers: web() });
      expect(res.statusCode, url).toBe(status);
      expect(res.json().error.code, url).toBe(code);
    }
    const progress = await app.inject({
      method: 'POST',
      url: `/api/v1/vod/titles/${VOD_ID}/progress`,
      headers: web({ 'content-type': 'application/json' }),
      payload: { event: 'tick', posS: 60, durS: 5400 },
    });
    expect(progress.statusCode).toBe(503);
    const short = await app.inject({
      method: 'GET',
      url: '/api/v1/vod/browse?q=a',
      headers: web(),
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('empty_query');
  });

  it('entrada mala → 400 antes del manejador; desde /native, 403 o 401', async () => {
    const { app } = await createTestApp();
    for (const url of [
      '/api/v1/vod/browse?kind=episode',
      '/api/v1/vod/browse?limit=101',
      '/api/v1/vod/titles/123',
      `/api/v1/vod/titles/${VOD_ID}/art/logo`,
      `/api/v1/vod/titles/${VOD_ID}/stream?client=web`,
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: web() });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe('validation_error');
    }
    const badEvent = await app.inject({
      method: 'POST',
      url: `/api/v1/vod/titles/${VOD_ID}/progress`,
      headers: web({ 'content-type': 'application/json' }),
      payload: { event: 'play' },
    });
    expect(badEvent.statusCode).toBe(400);
    const nativeRes = await app.inject({
      method: 'GET',
      url: '/native/api/v1/vod',
      headers: native(FAKE_TOKEN),
    });
    expect([401, 403]).toContain(nativeRes.statusCode);
  });

  it('la búsqueda de vodBrowse no va al registro', async () => {
    const logs: string[] = [];
    const logger = createLogger({
      level: 'debug',
      destination: new Writable({
        write(chunk: Buffer, _encoding, done) {
          logs.push(chunk.toString());
          done();
        },
      }),
    });
    const { app } = await createTestApp({ logger });
    await app.inject({ method: 'GET', url: '/api/v1/vod/browse?q=oppenheimer', headers: web() });
    const logged = logs.join('');
    expect(logged).toContain('/api/v1/vod/browse?[consulta]');
    expect(logged).not.toContain('oppenheimer');
  });

  it('una ruta `empty` (vodProgress) responde 204 sin cuerpo cuando el manejador no devuelve nada', async () => {
    let seen: unknown = null;
    const { app } = await createTestApp({
      moduleRoutes: false,
      register: (collector) =>
        collector.v1.handle('vodProgress', (input) => {
          seen = input.body;
        }),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/vod/titles/${VOD_ID}/progress`,
      headers: web({ 'content-type': 'application/json' }),
      payload: { event: 'pause', posS: 120, durS: 5400 },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(seen).toEqual({ event: 'pause', posS: 120, durS: 5400 });
  });
});
