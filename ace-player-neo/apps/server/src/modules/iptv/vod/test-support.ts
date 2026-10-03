/* Piezas de los tests de Películas y series (no es código de producto:
   solo lo importan los *.test.ts). */

import { RATING_NONE, type VodListRow } from './parse.js';
import { VodTableBuilder, type VodTable } from './table.js';

/** Una fila de lista con valores por defecto. */
export function listRow(
  source: number,
  title: string,
  extra: Partial<VodListRow> = {},
): VodListRow {
  return {
    source,
    title,
    year: 0,
    rating: RATING_NONE,
    added: 0,
    ext: 0,
    adult: false,
    poster: null,
    tags: 0,
    category: '',
    ...extra,
  };
}

/** Una tabla montada con esas filas (para los tests de la búsqueda y el códec). */
export async function tableOf(
  rows: readonly VodListRow[],
  categories: readonly string[] = [],
): Promise<VodTable> {
  const builder = new VodTableBuilder(1_000_000, categories);
  for (const row of rows) builder.add(row);
  return builder.build();
}
