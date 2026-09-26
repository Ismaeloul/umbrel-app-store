/* Esqueleto de Ajustes → IPTV por HTTP (docs/iptv.md §5.3): sin proveedor
   guardado, las 5 rutas responden con el contrato. La parte «servidor»
   sustituye estos casos por los de service.test.ts y la integración. */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { IptvBrowseResponseSchema, IptvViewSchema } from '@ace/shared';
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
