/* /api/search y /api/v1/search por HTTP (app.inject; api.md §4.20, B-209,
   B-216): la forma exacta de la 0.6.59 y los errores de cada formato. */

import { describe, expect, it, vi } from 'vitest';
import { SearchResponseSchema } from '@ace/shared';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { EngineService } from '../engine/types.js';
import type { ScannerService } from '../scanner/types.js';
import { createSearchService } from './index.js';

const ID_A = 'a'.repeat(40);
const BODY = JSON.stringify({ result: [{ content_id: ID_A, name: 'DAZN 1', availability: 1 }] });

async function appWith(searchRaw: (query: string, signal?: AbortSignal) => Promise<string>) {
  const core = createTestCore();
  const raw = vi.fn(searchRaw);
  const engine = { client: () => ({ searchRaw: raw }) } as unknown as EngineService;
  const scanner = { isEnabled: () => false } as unknown as ScannerService;
  const search = createSearchService({ ...core, engine, scanner });
  const { app } = await createTestApp({ services: { search } });
  return { app, raw };
}

describe('GET /api/search (api.md §4.20)', () => {
  it('200 { query, results } con la consulta limpia', async () => {
    const { app, raw } = await appWith(async () => BODY);
    const res = await app.inject({
      method: 'GET',
      url: '/api/search?q=%20DAZN%20%20%201%20',
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      query: 'DAZN 1',
      results: [
        {
          id: ID_A,
          title: 'DAZN 1',
          category: 'Busqueda',
          availability: 1,
          bitrate: null,
          ih: true,
        },
      ],
    });
    expect(raw).toHaveBeenCalledWith('DAZN 1', expect.any(AbortSignal));
  });

  it.each([
    ['/api/search', 400, 'empty_query'],
    ['/api/search?q=a', 400, 'empty_query'],
  ])('%s → %i %s', async (url, status, error) => {
    const { app, raw } = await appWith(async () => BODY);
    const res = await app.inject({ method: 'GET', url, headers: web() });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(raw).not.toHaveBeenCalled();
  });

  it.each([
    ['ace_timeout', 400],
    ['engine_unavailable', 503],
  ] as const)('el motor falla con %s → %i como en la 0.6.59', async (code, status) => {
    const { app } = await appWith(async () => {
      throw new AppError(code);
    });
    const res = await app.inject({ method: 'GET', url: '/api/search?q=DAZN', headers: web() });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: code });
  });

  it('respuesta del motor que no es JSON → 502 engine_bad_response', async () => {
    const { app } = await appWith(async () => '<html>');
    const res = await app.inject({ method: 'GET', url: '/api/search?q=DAZN', headers: web() });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'engine_bad_response' });
  });
});

describe('GET /api/v1/search', () => {
  it('200 con el esquema v1', async () => {
    const { app } = await appWith(async () => BODY);
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=DAZN', headers: web() });
    expect(res.statusCode).toBe(200);
    expect(SearchResponseSchema.parse(res.json()).results).toHaveLength(1);
  });

  it('errores con el formato v1: 400 empty_query, 504 ace_timeout, 503 engine_unavailable', async () => {
    const failures: AppError[] = [new AppError('ace_timeout'), new AppError('engine_unavailable')];
    const { app } = await appWith(async () => {
      throw failures.shift() as AppError;
    });
    const empty = await app.inject({ method: 'GET', url: '/api/v1/search', headers: web() });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('empty_query');
    const slow = await app.inject({ method: 'GET', url: '/api/v1/search?q=DAZN', headers: web() });
    expect(slow.statusCode).toBe(504);
    expect(slow.json().error.code).toBe('ace_timeout');
    const down = await app.inject({ method: 'GET', url: '/api/v1/search?q=DAZN', headers: web() });
    expect(down.statusCode).toBe(503);
    expect(down.json().error.code).toBe('engine_unavailable');
  });
});
