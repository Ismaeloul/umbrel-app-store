/* Tabla compacta de Películas y series (docs/vod.md §4.5 y §15.1). */

import { describe, expect, it } from 'vitest';
import { CAT_NONE } from './parse.js';
import { compactOf, foldKeepLength, rowAt, VodTable, VodTableBuilder } from './table.js';
import { listRow, tableOf } from './test-support.js';

describe('plegado que conserva la longitud', () => {
  it('sin tildes y en minúsculas, con la misma longitud en UTF-16', () => {
    for (const text of ['Amélie', 'ÁRBOL Ñandú', 'Spider-Man: ¡Ya!', '東京物語', 'Паразиты', 'ﬁn 😀 ǅ']) {
      const folded = foldKeepLength(text);
      expect(folded).toHaveLength(text.length);
    }
    expect(foldKeepLength('Amélie ÁRBOL Ñandú')).toBe('amelie arbol nandu');
    expect(compactOf(foldKeepLength('Spider-Man: No Way Home'))).toBe('spidermannowayhome');
  });
});

describe('VodTableBuilder', () => {
  it('arrays paralelos, textos unidos, carteles internados y búsqueda por `source`', async () => {
    const table = await tableOf(
      [
        listRow(30, 'Dune', { year: 2021, rating: 79, added: 300, category: 'B', poster: 'https://image.tmdb.org/t/p/w600/a.jpg' }),
        listRow(10, 'Amélie', { added: 100, category: 'A', poster: 'https://image.tmdb.org/t/p/w600/b.jpg' }),
        listRow(20, 'Solo', { added: 200, adult: true }),
      ],
      ['A', 'B'],
    );
    expect(table.n).toBe(3);
    expect(table.title(1)).toBe('Amélie');
    expect(table.foldedTitle(1)).toBe('amelie');
    expect(table.rowOf(20)).toBe(2);
    expect(table.rowOf(99)).toBe(-1);
    expect(table.posterUrl(0)).toBe('https://image.tmdb.org/t/p/w600/a.jpg');
    expect(table.posterUrl(2)).toBeNull();
    expect(table.dirs).toEqual(['https://image.tmdb.org/t/p/w600/']);
    expect(table.yearOf(0)).toBe(2021);
    expect(table.ratingOf(0)).toBeCloseTo(7.9);
    expect(table.ratingOf(1)).toBeNull();
    expect(table.isAdult(2)).toBe(true);
    expect(table.categoryName(0)).toBe('B');
    expect(table.cat[2]).toBe(CAT_NONE);
    /* «Novedades»: lo más reciente primero. */
    expect([...table.byAdded]).toEqual([0, 2, 1]);
    /* Por categoría, en orden de `byAdded`; la última cubeta es «Sin categoría». */
    expect([...table.categoryRows(0)]).toEqual([1]);
    expect([...table.categoryRows(1)]).toEqual([0]);
    expect([...table.categoryRows(2)]).toEqual([2]);
    /* A-Z plegado, perezoso. */
    expect([...table.byTitle()]).toEqual([1, 0, 2]);
    expect(rowAt(table.offsets, table.n, table.folded.indexOf('solo'))).toBe(2);
  });

  it('recorta en el tope y descarta los ids repetidos (cuentan como saltados)', async () => {
    const builder = new VodTableBuilder(2);
    expect(builder.add(listRow(1, 'A'))).toBe(true);
    expect(builder.add(listRow(1, 'A otra vez'))).toBe(false);
    expect(builder.duplicates).toBe(1);
    expect(builder.add(listRow(2, 'B'))).toBe(true);
    expect(builder.full).toBe(true);
    expect(builder.add(listRow(3, 'C'))).toBe(false);
    expect((await builder.build()).n).toBe(2);
  });

  it('una tabla vacía', async () => {
    const empty = await tableOf([]);
    expect(empty.n).toBe(0);
    expect(empty.rowOf(1)).toBe(-1);
    expect(VodTable.empty().byTitle()).toHaveLength(0);
  });
});
