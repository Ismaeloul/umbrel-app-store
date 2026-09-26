/* Lo que se pregunta al motor desde Buscar (docs/iptv.md §20): lo escrito
   siempre y, además, el alias o la errata corregida; y por HTTP. */

import { describe, expect, it, vi } from 'vitest';
import { SearchResponseSchema, type SearchResult } from '@ace/shared';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import type { EngineService } from '../engine/types.js';
import type { ScannerService } from '../scanner/types.js';
import {
  mergeEngineResults,
  planEngineQuery,
  suggestEngineQuery,
  titlesVocabulary,
} from './correct.js';
import { createSearchService } from './index.js';

const known = [titlesVocabulary(['Telecinco HD', 'DAZN 1', 'Eurosport 1', 'Real Madrid TV'])];

describe('planEngineQuery', () => {
  it.each([
    ['telecinko', { corrected: 'telecinco', alias: null, extra: 'telecinco' }],
    ['dasn 1', { corrected: 'dazn 1', alias: null, extra: 'dazn 1' }],
    ['eurosprot', { corrected: 'eurosport', alias: null, extra: 'eurosport' }],
    ['t5', { corrected: null, alias: 'Telecinco', extra: 'Telecinco' }],
    ['champions', { corrected: null, alias: 'Liga de Campeones', extra: 'Liga de Campeones' }],
    ['rmtv', { corrected: null, alias: 'Real Madrid TV', extra: 'Real Madrid TV' }],
    ['la 6', { corrected: null, alias: 'laSexta', extra: 'laSexta' }],
    ['dazn 1', { corrected: null, alias: null, extra: null }],
    ['telecinco', { corrected: null, alias: null, extra: null }],
    ['la 1', { corrected: null, alias: null, extra: null }],
  ])('«%s»', (query, plan) => {
    expect(planEngineQuery(query, known)).toEqual(plan);
  });

  it('lo que el motor conoce y nosotros no, no se toca: «roma», «benfica», «arsenal»', () => {
    for (const query of ['roma', 'benfica', 'arsenal', 'celtic']) {
      expect(planEngineQuery(query, known).extra).toBeNull();
    }
  });

  it('«Quizás quisiste decir» con un error más', () => {
    expect(suggestEngineQuery('telcnco', known)).toBe('telecinco');
    expect(suggestEngineQuery('telecinco', known)).toBeNull();
  });

  it('lo escrito primero, lo añadido detrás y sin repetir', () => {
    const r = (id: string, availability: number): SearchResult => ({
      id: id.repeat(40),
      title: id,
      category: '',
      availability,
      bitrate: null,
      ih: true,
    });
    expect(
      mergeEngineResults([r('a', 0.1), r('b', 0.2)], [r('b', 0.2), r('c', 0.9)]).map(
        (x) => x.title,
      ),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('GET /api/v1/search con erratas y alias (§20)', () => {
  const ENGINE: Record<string, { content_id: string; name: string; availability: number }[]> = {
    telecinco: [{ content_id: 'a'.repeat(40), name: 'Telecinco HD', availability: 0.9 }],
    t5: [],
    Telecinco: [{ content_id: 'a'.repeat(40), name: 'Telecinco HD', availability: 0.9 }],
    roma: [{ content_id: 'b'.repeat(40), name: 'Roma TV', availability: 0.5 }],
  };
  async function appWithEngine() {
    const core = createTestCore();
    const raw = vi.fn(async (query: string) => JSON.stringify({ result: ENGINE[query] ?? [] }));
    const engine = { client: () => ({ searchRaw: raw }) } as unknown as EngineService;
    const scanner = { isEnabled: () => false } as unknown as ScannerService;
    const search = createSearchService({ ...core, engine, scanner });
    const { app } = await createTestApp({ services: { search } });
    return { app, raw };
  }
  const get = async (q: string) => {
    const { app, raw } = await appWithEngine();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(q)}`,
      headers: web(),
    });
    expect(res.statusCode).toBe(200);
    return { body: SearchResponseSchema.parse(res.json()), asked: raw.mock.calls.map((c) => c[0]) };
  };

  it('«t5»: pregunta «t5» y «Telecinco» y junta', async () => {
    const { body, asked } = await get('t5');
    expect(asked.sort()).toEqual(['Telecinco', 't5']);
    expect(body.query).toBe('t5');
    expect(body.results.map((r) => r.title)).toEqual(['Telecinco HD']);
    expect(body.searched).toBe('Telecinco');
  });

  it('«roma»: solo lo escrito', async () => {
    const { body, asked } = await get('roma');
    expect(asked).toEqual(['roma']);
    expect(body.searched).toBeUndefined();
    expect(body.results.map((r) => r.title)).toEqual(['Roma TV']);
  });

  it('sin nada: «Quizás quisiste decir» con los nombres de la tabla', async () => {
    const { body } = await get('champiosn liga');
    expect(body.results).toEqual([]);
    expect(body.suggestion).toBe('champions liga');
  });

  it('la ruta antigua nunca corrige ni sugiere', async () => {
    const { app, raw } = await appWithEngine();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=t5', headers: web() });
    expect(res.json()).toEqual({ query: 't5', results: [] });
    expect(raw.mock.calls.map((c) => c[0])).toEqual(['t5']);
  });
});
