/* Funciones puras del buscador: T-030 portado tal cual y el contraste con
   la `parseAceSearchResults` ORIGINAL de la 0.6.59 sobre muchas entradas
   (contratos §8.6). */

import { describe, expect, it } from 'vitest';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import { parseAceSearchResults as legacyExport } from './legacy-exports.js';
import { engineQuery, parseAceSearchResults, routeQuery } from './parse.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const ID_C = 'c'.repeat(40);

describe('T-030 · normaliza resultados planos y agrupados del buscador AceStream (B-211)', () => {
  it('agrupados (items con infohash) y planos (content_id), deduplicados, ih y name del item', () => {
    const results = parseAceSearchResults(
      JSON.stringify({
        result: {
          results: [
            { name: 'DAZN', items: [{ infohash: ID_A, name: 'DAZN HD', availability: 12 }] },
            { content_id: ID_B, name: 'M+ Deportes', availability: 3 },
            { infohash: ID_A, name: 'Duplicado' },
          ],
        },
      }),
    );
    expect(results.map((item) => item.id)).toEqual([ID_A, ID_B]);
    expect(results[0]?.ih).toBe(true);
    expect(results[0]?.title).toBe('DAZN HD');
  });

  it('la exportación antigua es la misma función', () => {
    expect(legacyExport).toBe(parseAceSearchResults);
  });
});

describe('parseAceSearchResults: resto de la forma (server.js:3599-3632)', () => {
  it('valores por defecto: título "Stream <8>", categoría "Busqueda", números o null', () => {
    const [item] = parseAceSearchResults(
      JSON.stringify({ result: [{ url: `acestream://${ID_C.toUpperCase()}`, bitrate: '900' }] }),
    );
    expect(item).toEqual({
      id: ID_C,
      title: `Stream ${ID_C.slice(0, 8)}`,
      category: 'Busqueda',
      availability: null,
      bitrate: null,
      ih: true,
    });
  });

  it('el título del grupo si el item no trae nombre; la primera categoría', () => {
    const [item] = parseAceSearchResults(
      JSON.stringify({
        results: [
          {
            name: '<b>Grupo</b> &amp; más',
            items: [{ infohash: ID_A, categories: ['sport', 'x'], bitrate: 5 }],
          },
        ],
      }),
    );
    expect(item).toMatchObject({ title: 'Grupo & más', category: 'sport', bitrate: 5 });
  });

  it('100 como máximo y ordenados por disponibilidad (sin ella, al final)', () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      infohash: index.toString(16).padStart(40, '0'),
      availability: index % 3 === 0 ? undefined : index,
    }));
    const results = parseAceSearchResults(JSON.stringify({ result: { results: many } }));
    expect(results).toHaveLength(100);
    const numbers = results.map((item) => item.availability ?? -1);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(results.at(-1)?.availability).toBeNull();
    const grouped = parseAceSearchResults(
      JSON.stringify({ result: { results: [{ items: many }, { infohash: ID_A }] } }),
    );
    expect(grouped).toHaveLength(100);
    expect(grouped.some((item) => item.id === ID_A)).toBe(false);
  });

  it('JSON inválido → engine_bad_response; sin resultados → []', () => {
    expect(() => parseAceSearchResults('<html>')).toThrow(
      expect.objectContaining({ code: 'engine_bad_response' }),
    );
    expect(parseAceSearchResults('null')).toEqual([]);
    expect(parseAceSearchResults('{"result": "nada"}')).toEqual([]);
    expect(
      parseAceSearchResults(JSON.stringify({ result: [1, 'x', null, { name: 'sin hash' }] })),
    ).toEqual([]);
  });

  it('da lo mismo que la 0.6.59 original en muchas entradas', () => {
    const legacy = loadLegacyServer() as unknown as {
      parseAceSearchResults(body: string): unknown;
    };
    const ids = [ID_A, ID_B, ID_C, ID_A.toUpperCase(), 'zz', `acestream://${ID_B}`];
    const names = ['DAZN HD', '<i>M+</i>  LaLiga', '', undefined, 'x'.repeat(200), 42];
    const bodies: string[] = [];
    let seed = 7;
    const pick = <T>(list: readonly T[]): T => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return list[seed % list.length] as T;
    };
    for (let round = 0; round < 200; round += 1) {
      const entries = Array.from({ length: 1 + (round % 7) }, () => {
        const item = {
          infohash: pick([...ids, undefined]),
          content_id: pick([...ids, undefined]),
          name: pick(names),
          availability: pick([0.5, 3, undefined, 'mucha', null]),
          bitrate: pick([1000, undefined, '1000']),
          categories: pick([['sport'], [], 'sport', undefined]),
        };
        return pick([true, false]) ? { name: pick(names), items: [item, item] } : item;
      });
      const shape = round % 3;
      bodies.push(
        JSON.stringify(
          shape === 0
            ? { result: { results: entries } }
            : shape === 1
              ? { result: entries }
              : { results: entries },
        ),
      );
    }
    bodies.push('no json', '[]', '{}', '{"result":{"results":"x"}}');
    for (const body of bodies) {
      let expected: unknown;
      let actual: unknown;
      try {
        expected = legacy.parseAceSearchResults(body);
      } catch (error) {
        expected = { error: (error as Error).message };
      }
      try {
        actual = parseAceSearchResults(body);
      } catch (error) {
        actual = { error: (error as Error).message };
      }
      expect(actual).toEqual(expected);
    }
  });
});

describe('limpieza de la consulta (server.js:4944-4945 y 3635-3640, B-209)', () => {
  it('colapsa espacios, recorta y corta a 80; menos de 2 → empty_query', () => {
    expect(routeQuery('  M+   Liga  ')).toBe('M+ Liga');
    expect(routeQuery('x'.repeat(100))).toHaveLength(80);
    for (const bad of ['', ' a ', '\n\t', undefined, null]) {
      expect(() => routeQuery(bad)).toThrow(expect.objectContaining({ code: 'empty_query' }));
    }
  });

  it('la que va al motor además quita etiquetas y entidades', () => {
    expect(engineQuery('<b>DAZN</b> &amp; F1')).toBe('DAZN & F1');
    expect(() => engineQuery('<b></b>')).toThrow(expect.objectContaining({ code: 'empty_query' }));
  });
});
