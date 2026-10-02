/* /api/search y /api/v1/search por HTTP (app.inject; api.md §4.20, B-209,
   B-216): la forma exacta de la 0.6.59 y los errores de cada formato. */

import { describe, expect, it, vi } from 'vitest';
import { SearchResponseSchema, type SearchResult } from '@ace/shared';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import { AppError } from '../../core/errors.js';
import type { EngineService } from '../engine/types.js';
import type { IptvService } from '../iptv/types.js';
import type { ScannerService } from '../scanner/types.js';
import { createSearchService } from './index.js';
import { rankForQuery } from './routes.js';

const ID_A = 'a'.repeat(40);
const BODY = JSON.stringify({ result: [{ content_id: ID_A, name: 'DAZN 1', availability: 1 }] });

async function appWith(
  searchRaw: (query: string, signal?: AbortSignal) => Promise<string>,
  iptv?: IptvService,
) {
  const core = createTestCore();
  const raw = vi.fn(searchRaw);
  const engine = { client: () => ({ searchRaw: raw }) } as unknown as EngineService;
  const scanner = { isEnabled: () => false } as unknown as ScannerService;
  const search = createSearchService({ ...core, engine, scanner });
  const { app } = await createTestApp({ services: { search, ...(iptv ? { iptv } : {}) } });
  return { app, raw };
}

const IPTV_LA1 = 'f'.repeat(40);
const LA1_BODY = JSON.stringify({
  result: [
    { content_id: 'b'.repeat(40), name: 'La 1 HD --> ELCANO', availability: 0.9 },
    { content_id: 'c'.repeat(40), name: 'LaLiga TV Hypermotion', availability: 0.5 },
  ],
});

/* La IPTV de mentira: el cálculo de verdad está en iptv/service.test.ts. */
function fakeIptv(active: boolean): IptvService {
  return {
    active: () => active,
    annotateSearch: (results) =>
      results.map((result) =>
        result.title.startsWith('La 1') ? { ...result, iptv: IPTV_LA1 } : result,
      ),
  } as Partial<IptvService> as IptvService;
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

describe('SearchResult.iptv (docs/iptv.md §14.3)', () => {
  it('con IPTV activa, /api/v1/search anota los resultados que son un canal de tu IPTV', async () => {
    const { app } = await appWith(async () => LA1_BODY, fakeIptv(true));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=la%201', headers: web() });
    expect(res.statusCode).toBe(200);
    const results = SearchResponseSchema.parse(res.json()).results;
    expect(results.map((result) => result.iptv ?? null)).toEqual([IPTV_LA1, null]);
  });

  it('la ruta antigua nunca lo lleva; sin IPTV activa, v1 tampoco', async () => {
    const withIptv = await appWith(async () => LA1_BODY, fakeIptv(true));
    const legacy = await withIptv.app.inject({
      method: 'GET',
      url: '/api/search?q=la%201',
      headers: web(),
    });
    expect(JSON.stringify(legacy.json())).not.toContain('iptv');
    const paused = await appWith(async () => LA1_BODY, fakeIptv(false));
    const v1 = await paused.app.inject({
      method: 'GET',
      url: '/api/v1/search?q=la%201',
      headers: web(),
    });
    expect(JSON.stringify(v1.json())).not.toContain('iptv');
  });
});

describe('orden por parecido en v1 (diagnóstico 0.8.2, E2)', () => {
  const result = (n: number, title: string, availability: number | null): SearchResult => ({
    id: String(n).repeat(40),
    title,
    category: 'Busqueda',
    availability,
    bitrate: null,
    ih: true,
  });
  const LIGA = [
    result(1, 'LaLiga Hypermotion 2 --> ELCANO', 1),
    result(2, 'DAZN 2', 0.95),
    result(3, 'Movistar LaLiga TV 2 --> NEW ERA', 0.8),
    result(4, 'LaLiga TV 2', 0.5),
    result(5, 'Liga Endesa 2', 0.4),
    result(6, 'M+ LaLiga TV 2 HD', 0),
  ];

  it('igual → familia → empieza → todas las palabras → el resto; disponibilidad 0 al final de su nivel', () => {
    expect(rankForQuery(LIGA, 'laliga tv 2').map((item) => item.title)).toEqual([
      'LaLiga TV 2',
      'Movistar LaLiga TV 2 --> NEW ERA',
      'M+ LaLiga TV 2 HD',
      'LaLiga Hypermotion 2 --> ELCANO',
      'DAZN 2',
      'Liga Endesa 2',
    ]);
  });

  it('la grafía del buscador de la IPTV: «m+ laliga» es «Movistar LaLiga»; lo de tras la flecha no cuenta', () => {
    const ranked = rankForQuery(
      [
        result(1, 'LaLiga Hypermotion --> MOVISTAR', 1),
        result(2, 'M. LALIGA 1 --> ELCANO', 0.6),
        result(3, 'Movistar LaLiga', 0.5),
      ],
      'm+ laliga',
    );
    expect(ranked.map((item) => item.id[0])).toEqual(['3', '2', '1']);
  });

  it('sin parecido, el orden por disponibilidad de siempre', () => {
    const plain = [result(1, 'Uno', 1), result(2, 'Dos', 0.5), result(3, 'Tres', null)];
    expect(rankForQuery(plain, 'zzz')).toEqual(plain);
  });

  it('/api/v1/search ordena por parecido; /api/search deja el orden del motor', async () => {
    const body = JSON.stringify({
      result: LIGA.map((item) => ({
        content_id: item.id,
        name: item.title,
        availability: item.availability,
      })),
    });
    const { app } = await appWith(async () => body);
    const url = 'search?q=laliga%20tv%202';
    const v1 = await app.inject({ method: 'GET', url: `/api/v1/${url}`, headers: web() });
    expect(SearchResponseSchema.parse(v1.json()).results[0]?.title).toBe('LaLiga TV 2');
    const legacy = await app.inject({ method: 'GET', url: `/api/${url}`, headers: web() });
    expect(legacy.json().results[0].title).toBe('LaLiga Hypermotion 2 --> ELCANO');
  });
});
