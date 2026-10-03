/* Búsqueda, listas y orden de Películas y series (docs/vod.md §6 y §15.1). */

import { describe, expect, it } from 'vitest';
import { VOD_LANGS, VOD_SEARCH, vodLangBits, type VodLang } from '@ace/shared';
import {
  emptyHidden,
  hiddenLangs,
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
  it('«Novedades» en «Todas»: los adultos como los demás (D-VOD7 de hoy) o fuera; en su categoría, siempre', async () => {
    const table = await catalog();
    /* Decisión de Isma (VOD_ADULT_POLICY.all): salen como los demás. */
    const all = listPage(table, { bucket: null, tagBit: 0 }, 'added', 0, 3, { adults: true });
    expect(titles(table, all.rows)).toEqual([
      'Dunas adultas',
      'Dune: Parte Dos',
      'Spider-Man: No Way Home',
    ]);
    expect(all.total).toBe(8);
    expect(all.more).toBe(true);
    /* Con la regla de antes (`adults: false`), fuera de «Todas». */
    const without = listPage(table, { bucket: null, tagBit: 0 }, 'added', 0, 3, { adults: false });
    expect(titles(table, without.rows)).toEqual([
      'Dune: Parte Dos',
      'Spider-Man: No Way Home',
      'Dune',
    ]);
    expect(without.total).toBe(7);
    /* En su categoría salen con cualquiera de las dos. */
    for (const adults of [true, false]) {
      const adult = listPage(table, { bucket: 1, tagBit: 0 }, 'added', 0, 10, { adults });
      expect(titles(table, adult.rows)).toEqual(['Dunas adultas']);
    }
    const none = listPage(table, { bucket: 2, tagBit: 0 }, 'added', 0, 10);
    expect(none.total).toBe(5);
  });

  it('A-Z plegado, distintivo y página siguiente', async () => {
    const table = await catalog();
    const az = listPage(table, { bucket: null, tagBit: 0 }, 'name', 0, 2, { adults: false });
    expect(titles(table, az.rows)).toEqual(['Amélie', 'Dune']);
    const next = listPage(table, { bucket: null, tagBit: 0 }, 'name', 2, 2, { adults: false });
    expect(titles(table, next.rows)).toEqual(['Dune', 'Dune: Parte Dos']);
    const withAdults = listPage(table, { bucket: null, tagBit: 0 }, 'name', 0, 3);
    expect(titles(table, withAdults.rows)).toEqual(['Amélie', 'Dunas adultas', 'Dune']);
    const vose = listPage(table, { bucket: null, tagBit: tagBit('vose') }, 'added', 0, 10);
    expect(titles(table, vose.rows)).toEqual(['Amélie']);
    /* Los chips cuentan sin el filtro de distintivo. */
    expect(vose.tagCounts.map((item) => item.tag)).toEqual(['latino', 'vose', '4k']);
  });
});

describe('filtro de idiomas (docs/vod.md §4.10)', () => {
  const bits = (...langs: VodLang[]) => vodLangBits(langs);
  async function langCatalog() {
    return tableOf([
      listRow(1, 'Coco', { added: 100, langs: bits('castellano') }),
      listRow(2, 'Coco', { added: 90, langs: bits('latino') }),
      listRow(3, 'Coco', { added: 80, langs: bits('latino') }),
      listRow(4, 'Coco', { added: 70, langs: bits('vose') }),
      listRow(5, 'Coco y sus amigos', { added: 60 }),
      listRow(6, 'Amélie', { added: 50, langs: bits('frances') }),
      listRow(7, 'The Office', { added: 40, langs: bits('castellano', 'ingles') }),
      listRow(8, 'Le dîner de cons', { added: 30, langs: bits('frances') }),
    ]);
  }
  const only = (mask: number, unknown = true) => ({ mask, unknown });

  it('la búsqueda filtra DENTRO del recorrido y cuenta lo de fuera por idioma', async () => {
    const table = await langCatalog();
    const hits = searchTable(table, parseVodQuery('coco'), null, only(bits('castellano'), false));
    expect(Array.from(hits.rows)).toEqual([0]);
    expect(hits.total).toBe(1);
    expect(hits.hidden).toEqual({
      total: 4,
      byLang: VOD_LANGS.map((lang) => ({ latino: 2, vose: 1 })[lang as string] ?? 0),
      unknown: 1,
    });
    expect(hiddenLangs(hits.hidden ?? emptyHidden())).toEqual([
      { lang: 'latino', count: 2 },
      { lang: 'vose', count: 1 },
    ]);
    /* Con «también los que no lo indican», «Coco y sus amigos» entra. */
    const withUnknown = searchTable(table, parseVodQuery('coco'), null, only(bits('castellano')));
    expect(titles(table, withUnknown.rows)).toEqual(['Coco', 'Coco y sus amigos']);
    expect(withUnknown.hidden?.unknown).toBe(0);
    /* Sin filtro, todo y sin recuento de fuera. */
    const all = searchTable(table, parseVodQuery('coco'), null);
    expect(all.total).toBe(5);
    expect(all.hidden).toBeNull();
  });

  it('varias palabras y las palabras juntas también respetan el idioma', async () => {
    const table = await langCatalog();
    const french = only(bits('frances'), false);
    const words = searchTable(table, parseVodQuery('coco amigos'), null, french);
    expect(words.total).toBe(0);
    expect(words.hidden?.unknown).toBe(1);
    const compact = searchTable(table, parseVodQuery('lediner'), null, only(bits('castellano')));
    expect(compact.total).toBe(0);
    expect(compact.hidden?.byLang[VOD_LANGS.indexOf('frances')]).toBe(1);
    const inFrench = searchTable(table, parseVodQuery('lediner'), null, french);
    expect(titles(table, inFrench.rows)).toEqual(['Le dîner de cons']);
  });

  it('un título MULTI sale con cualquiera de sus idiomas', async () => {
    const table = await langCatalog();
    const english = searchTable(table, parseVodQuery('office'), null, only(bits('ingles'), false));
    expect(english.total).toBe(1);
    const spanish = searchTable(
      table,
      parseVodQuery('office'),
      null,
      only(bits('castellano'), false),
    );
    expect(spanish.total).toBe(1);
  });

  it('la caché distingue los filtros', async () => {
    const table = await langCatalog();
    const q = parseVodQuery('coco');
    const castellano = searchCached(table, q, null, only(bits('castellano'), false));
    const latino = searchCached(table, q, null, only(bits('latino'), false));
    expect(castellano.total).toBe(1);
    expect(latino.total).toBe(2);
    expect(searchCached(table, q, null, only(bits('castellano'), false))).toBe(castellano);
  });

  it('sin texto: la lista filtra y cuenta lo de fuera; los chips cuentan solo lo que se ve', async () => {
    const table = await langCatalog();
    const french = listPage(
      table,
      { bucket: null, tagBit: 0, lang: only(bits('frances'), false) },
      'added',
      0,
      10,
    );
    expect(titles(table, french.rows)).toEqual(['Amélie', 'Le dîner de cons']);
    expect(french.total).toBe(2);
    expect(french.hidden?.total).toBe(6);
    expect(french.hidden?.unknown).toBe(1);
    const none = listPage(table, { bucket: null, tagBit: 0 }, 'added', 0, 10);
    expect(none.total).toBe(8);
    expect(none.hidden).toBeNull();
  });

  it('con 3 000 aciertos de otro idioma delante, los de tu idioma no se pierden (no se filtra sobre los 2 000 mejores)', async () => {
    const rows = [];
    for (let index = 0; index < 3_000; index += 1) {
      rows.push(
        listRow(index + 1, `La película ${index}`, {
          added: 10_000 - index,
          langs: bits('latino'),
        }),
      );
    }
    rows.push(listRow(9_001, 'La película en castellano', { added: 1, langs: bits('castellano') }));
    const table = await tableOf(rows);
    const hits = searchTable(table, parseVodQuery('la'), null, only(bits('castellano'), false));
    expect(hits.total).toBe(1);
    expect(titles(table, hits.rows)).toEqual(['La película en castellano']);
    expect(hits.hidden?.total).toBe(3_000);
  });
});
