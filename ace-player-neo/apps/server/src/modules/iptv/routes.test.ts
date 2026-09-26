/* Esqueleto de Ajustes → IPTV por HTTP (docs/iptv.md §5.3): sin proveedor
   guardado, las 5 rutas responden con el contrato. La parte «servidor»
   sustituye estos casos por los de service.test.ts y la integración. */

import { describe, expect, it } from 'vitest';
import { IptvViewSchema } from '@ace/shared';
import { createTestApp, web } from '../../../test/helpers/index.js';

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
