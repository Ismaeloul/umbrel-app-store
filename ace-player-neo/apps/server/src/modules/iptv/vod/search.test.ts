/* Búsqueda, listas y orden de Películas y series (docs/vod.md §6 y §15.1). */

import { describe, expect, it } from 'vitest';
import { VOD_SEARCH } from '@ace/shared';
import {
  listPage,
  parseVodQuery,
  relevance,
  searchCached,
  searchPage,
  searchTable,
} from './search.js';
import { listRow, tableOf } from './test-support.js';
import { tagBit } from './titles.js';

const CATS = ['Acción', 'XXX'];

async function catalog() {
  return tableOf(
    [
      listRow(1, 'Dune', { year: 2021, added: 100, category: 'Acción', tags: tagBit('4k') }),
      listRow(2, 'Dune: Parte Dos', { year: 2024, added: 300, category: 'Acción' }),
      listRow(3, 'La duna perdida', { year: 1999, added: 50 }),
      listRow(4, 'Spider-Man: No Way Home', { year: 2021, added: 200, tags: tagBit('latino') }),
      listRow(5, 'Amélie', { year: 2001, added: 10, tags: tagBit('vose') }),
      listRow(6, 'Dunas adultas', { added: 500, adult: true, category: 'XXX' }),
      listRow(7, 'Parte de Dune', { added: 20 }),
      listRow(8, 'Dune', { year: 1984, added: 5 }),
    ],
    CATS,
  );
}

const titles = (table: Awaited<ReturnType<typeof catalog>>, rows: ArrayLike<number>) =>
  Array.from(rows, (row) => table.title(row as number));

describe('parseVodQuery', () => {
  it('2-80 caracteres (si no, empty_query) y el mismo plegado', () => {
    expect(() => parseVodQuery('a')).toThrowError(expect.objectContaining({ code: 'empty_query' }));
    expect(() => parseVodQuery('  ')).toThrowError(
      expect.objectContaining({ code: 'empty_query' }),
    );
    expect(parseVodQuery('  Amélie  PARÍS ')).toMatchObject({
      words: ['amelie', 'paris'],
      compact: 'amelieparis',
    });
    expect(parseVodQuery('x'.repeat(200)).words[0]).toHaveLength(80);
  });
});

describe('relevance (niveles 0-4)', () => {
  it('un caso por nivel', () => {
    expect(relevance('dune', ['dune'])).toBe(0);
    expect(relevance('dune: parte dos', ['dune'])).toBe(1);
    expect(relevance('la duna perdida', ['duna', 'perd'])).toBe(2);
    expect(relevance('parte de dune', ['dune', 'parte'])).toBe(3);
    expect(relevance('spider-man', ['iderm'])).toBe(4);
  });
});

describe('searchTable', () => {
  it('orden por nivel, lo más reciente y el título; adultos incluidos', async () => {
    const table = await catalog();
    const hits = searchTable(table, parseVodQuery('dune'), null);
    expect(titles(table, hits.rows)).toEqual(['Dune', 'Dune', 'Dune: Parte Dos', 'Parte de Dune']);
    /* Los dos «Dune» (nivel 0): el más reciente primero. */
    expect(table.yearOf(hits.rows[0] as number)).toBe(2021);
    const duna = searchTable(table, parseVodQuery('dun'), null);
    expect(titles(table, duna.rows)).toContain('Dunas adultas');
  });

  it('«spiderman» encuentra «Spider-Man»; varias palabras', async () => {
    const table = await catalog();
    expect(titles(table, searchTable(table, parseVodQuery('spiderman'), null).rows)).toEqual([
      'Spider-Man: No Way Home',
    ]);
    expect(titles(table, searchTable(table, parseVodQuery('way spider'), null).rows)).toEqual([
      'Spider-Man: No Way Home',
    ]);
    expect(searchTable(table, parseVodQuery('amelie'), null).total).toBe(1);
  });

  it('el año es un filtro («dune 2021»)', async () => {
    const table = await catalog();
    const hits = searchTable(table, parseVodQuery('dune 2021'), null);
    expect(hits.total).toBe(1);
    expect(table.yearOf(hits.rows[0] as number)).toBe(2021);
    expect(searchTable(table, parseVodQuery('2001'), null).total).toBe(1);
  });

  it('filtro de categoría y cuenta de distintivos', async () => {
    const table = await catalog();
    const hits = searchTable(table, parseVodQuery('dune'), 0);
    expect(titles(table, hits.rows)).toEqual(['Dune', 'Dune: Parte Dos']);
    expect(hits.tagCounts).toEqual([{ tag: '4k', count: 1 }]);
    const page = searchPage(hits, table, { bucket: 0, tagBit: tagBit('4k') }, 0, 10);
    expect(page.total).toBe(1);
  });

  it('más de 2 000 aciertos → capped y los 2 000 mejores', async () => {
    const rows = Array.from({ length: 2_100 }, (_, i) =>
      listRow(i + 1, `Película ${i}`, { added: i }),
    );
    const table = await tableOf(rows);
    const hits = searchCached(table, parseVodQuery('pelicula'), null);
    expect(hits.total).toBe(2_100);
    expect(hits.rows).toHaveLength(VOD_SEARCH.rowsMax);
    const page = searchPage(hits, table, { bucket: null, tagBit: 0 }, 1_990, 60);
    expect(page.rows).toHaveLength(10);
    expect(page.capped).toBe(true);
    expect(page.more).toBe(false);
    /* La caché devuelve lo mismo. */
    expect(searchCached(table, parseVodQuery('Película'), null)).toBe(hits);
  });
});

describe('listPage (sin texto)', () => {
  it('«Novedades» sin adultos en «Todas»; en su categoría, sí', async () => {
    const table = await catalog();
    const all = listPage(table, { bucket: null, tagBit: 0 }, 'added', 0, 3);
    expect(titles(table, all.rows)).toEqual(['Dune: Parte Dos', 'Spider-Man: No Way Home', 'Dune']);
    expect(all.total).toBe(7);
    expect(all.more).toBe(true);
    const adult = listPage(table, { bucket: 1, tagBit: 0 }, 'added', 0, 10);
    expect(titles(table, adult.rows)).toEqual(['Dunas adultas']);
    const none = listPage(table, { bucket: 2, tagBit: 0 }, 'added', 0, 10);
    expect(none.total).toBe(5);
  });

  it('A-Z plegado, distintivo y página siguiente', async () => {
    const table = await catalog();
    const az = listPage(table, { bucket: null, tagBit: 0 }, 'name', 0, 2);
    expect(titles(table, az.rows)).toEqual(['Amélie', 'Dune']);
    const next = listPage(table, { bucket: null, tagBit: 0 }, 'name', 2, 2);
    expect(titles(table, next.rows)).toEqual(['Dune', 'Dune: Parte Dos']);
    const vose = listPage(table, { bucket: null, tagBit: tagBit('vose') }, 'added', 0, 10);
    expect(titles(table, vose.rows)).toEqual(['Amélie']);
    /* Los chips cuentan sin el filtro de distintivo. */
    expect(vose.tagCounts.map((item) => item.tag)).toEqual(['latino', 'vose', '4k']);
  });
});
