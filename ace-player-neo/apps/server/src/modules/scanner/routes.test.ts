/* GET /api/football/scan (forma exacta de la 0.6.59, api.md §4.10) y su
   gemela GET /api/v1/football/scans/:id (B-022, B-027). */

import { describe, expect, it } from 'vitest';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import { createTestScanner, scriptedTransport, tick } from './test-support.js';

const HASH = 'c'.repeat(40);

async function appWithJob() {
  const core = createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner' } });
  const scanner = createTestScanner(core, scriptedTransport().transport);
  const ref = scanner.enqueue({ kind: 'interactive', candidates: [{ id: HASH, ih: true }] });
  await tick(core.clock, 3000, 100);
  const { app } = await createTestApp({ services: { scanner } });
  return { app, id: ref?.id ?? '' };
}

describe('rutas del comprobador', () => {
  it('GET /api/football/scan?id= devuelve el trabajo con success delante (api.md §4.10)', async () => {
    const { app, id } = await appWithJob();
    const res = await app.inject({
      method: 'GET',
      url: `/api/football/scan?id=${id}`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body)[0]).toBe('success');
    expect(body).toMatchObject({
      success: true,
      id,
      kind: 'interactive',
      status: 'complete',
      total: 1,
      checked: 1,
      playable: 1,
      initialCount: 1,
    });
    expect(body.candidates[0]).toMatchObject({ id: HASH, state: 'working', videoCodec: 'h264' });
    expect(body.candidates[0]).not.toHaveProperty('playableOn');
    const upper = await app.inject({
      method: 'GET',
      url: `/api/football/scan?id=${id.toUpperCase()}&x=1`,
      headers: web(),
    });
    expect(upper.statusCode).toBe(200);
  });

  it('sin id, con otro formato o ya podado: 404 scan_not_found', async () => {
    const { app } = await appWithJob();
    for (const url of [
      '/api/football/scan',
      '/api/football/scan?id=zz',
      `/api/football/scan?id=${'e'.repeat(24)}`,
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: web() });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: 'scan_not_found' });
    }
  });

  it('sin comprobador configurado, igual: 404 scan_not_found', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/football/scan?id=${'0'.repeat(24)}`,
      headers: web(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'scan_not_found' });
  });

  it('GET /api/v1/football/scans/:id: el trabajo sin success; 404 y 400 con el error v1', async () => {
    const { app, id } = await appWithJob();
    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/football/scans/${id}`,
      headers: web(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).not.toHaveProperty('success');
    expect(ok.json()).toMatchObject({ id, status: 'complete', playable: 1 });
    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/football/scans/${'e'.repeat(24)}`,
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('scan_not_found');
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/football/scans/zz',
      headers: web(),
    });
    expect(bad.statusCode).toBe(400);
  });
});
