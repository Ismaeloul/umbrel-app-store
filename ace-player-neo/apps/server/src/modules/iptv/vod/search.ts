/* Búsqueda, listas y orden de Películas y series (docs/vod.md §6, D-VOD5).
   Puro (la caché es por tabla y se tira con ella).

   Con texto:
   - la consulta se limpia como la del buscador de canales (2-80 caracteres;
     si no, `empty_query`) y se pliega igual que `folded`;
   - candidatas: `indexOf` de la palabra más larga sobre `folded` (cada
     acierto da su fila por `offsets` y se comprueba que estén las demás
     palabras) y de las palabras juntas sobre `compact` («spiderman» encuentra
     «Spider-Man»);
   - una palabra de 4 dígitos entre 1880 y 2100 vale si es el año de la fila
     o está en el título («dune 2021»);
   - orden por niveles 0-4 (§6.2), luego lo más reciente y luego el título;
     se guardan los 2 000 mejores (`capped`), con caché LRU de 16 consultas.
   Sin texto: `byAdded` («Novedades») o A-Z perezoso, con el filtro de
   categoría (`byCat`) y de distintivo (`tags`). Los adultos no salen en
   «Todas» sin texto (D-VOD7), sí en su categoría y en la búsqueda. */

import { VOD_SEARCH, VOD_TAGS, type VodTag } from '@ace/shared';
import { cleanChannelsQuery } from '../search.js';
import { countTags, foldKeepLength, compactOf, rowAt, type VodTable } from './table.js';
import { VOD_YEAR_MAX, VOD_YEAR_MIN } from './titles.js';

const WORD = /[\p{L}\p{N}]+/gu;

export interface VodQuery {
  /** Palabras plegadas, en orden. */
  readonly words: readonly string[];
  /** Las palabras juntas («spiderman»). */
  readonly compact: string;
  /** Clave de la caché. */
  readonly key: string;
}

/** Limpia y pliega la consulta (§6.1). Lanza `empty_query` con menos de 2 caracteres. */
export function parseVodQuery(value: unknown): VodQuery {
  const q = cleanChannelsQuery(value);
  const folded = foldKeepLength(q);
  const words = folded.match(WORD) ?? [];
  const compact = compactOf(folded);
  return { words, compact, key: words.join(' ') };
}

function yearWord(word: string): number | null {
  if (!/^\d{4}$/.test(word)) return null;
  const year = Number(word);
  return year >= VOD_YEAR_MIN && year <= VOD_YEAR_MAX ? year : null;
}

/** Filtro de una consulta: cubeta de categoría (o null = todas) y bit de distintivo (0 = ninguno). */
export interface VodFilter {
  readonly bucket: number | null;
  readonly tagBit: number;
}

export interface VodHits {
  /** Las mejores filas (2 000 como mucho), ya ordenadas, SIN el filtro de distintivo. */
  readonly rows: Uint32Array;
  /** Aciertos en total (sin el filtro de distintivo). */
  readonly total: number;
  /** Aciertos por distintivo (para los chips y el total con distintivo). */
  readonly tagCounts: ReadonlyArray<{ readonly tag: VodTag; readonly count: number }>;
}

function bucketOf(table: VodTable, row: number): number {
  const value = table.cat[row] as number;
  return value >= table.cats.length ? table.cats.length : value;
}

/**
 * Todos los aciertos de una consulta en una tabla, ordenados, con los 2 000
 * mejores. `bucket` filtra por categoría; los adultos se incluyen (§4.9).
 */
export function searchTable(table: VodTable, query: VodQuery, bucket: number | null): VodHits {
  const { words } = query;
  const { folded, offsets, n } = table;
  const years = words.map(yearWord);
  const hasYears = years.some((year) => year !== null);
  const textWords = words.filter((_, index) => years[index] === null);
  /* 0 sin mirar, 1 mirada y descartada; luego, nivel + 2 si casa. */
  const state = new Uint8Array(n);
  const matched: number[] = [];
  const single = words.length === 1 && !hasYears;
  /* Varias palabras (o años): se comprueba la fila y se calcula su nivel con
     el mismo recorte del título (una vista: no copia). Para el nivel cuentan
     las palabras que están en el título (un año que casó por la fila no). */
  const accept = (row: number): void => {
    if (state[row]) return;
    state[row] = 1;
    if (bucket !== null && bucketOf(table, row) !== bucket) return;
    const title = table.foldedTitle(row);
    let rankWords: readonly string[] = words;
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index] as string;
      if (title.includes(word)) continue;
      const year = years[index];
      if (year !== null && year !== undefined && table.year[row] === year) {
        rankWords = rankWords.filter((item) => item !== word);
        continue;
      }
      return;
    }
    state[row] = relevance(title, rankWords) + 2;
    matched.push(row);
  };
  const longest = [...textWords].sort((a, b) => b.length - a.length)[0];
  if (single && longest) {
    singleWordLevels(table, longest, bucket, state, matched);
  } else if (longest) {
    /* Tras un acierto se sigue en la fila siguiente: cada fila se mira una vez. */
    let hint = 0;
    for (let at = folded.indexOf(longest); at >= 0;) {
      const row = rowAt(offsets, n, at, hint);
      hint = row;
      accept(row);
      at = folded.indexOf(longest, offsets[row + 1] as number);
    }
  } else {
    /* Solo años («1917»): se mira fila a fila (título o año). */
    for (let row = 0; row < n; row += 1) accept(row);
  }
  /* Las palabras juntas sobre `compact` (nivel 4 si no casó ya). */
  if (query.compact.length >= 3) {
    const { compact, compactOffsets } = table;
    let hint = 0;
    for (let at = compact.indexOf(query.compact); at >= 0;) {
      const row = rowAt(compactOffsets, n, at, hint);
      hint = row;
      at = compact.indexOf(query.compact, compactOffsets[row + 1] as number);
      if ((state[row] as number) >= 2) continue;
      if (bucket !== null && bucketOf(table, row) !== bucket) continue;
      state[row] = 6;
      matched.push(row);
    }
  }
  const count = matched.length;
  /* Sin ordenar decenas de miles de filas: se recorre `byAdded` (lo más
     reciente primero) repartiendo por nivel, y solo los empates de fecha se
     ordenan por título. */
  const buckets: number[][] = [[], [], [], [], []];
  for (let index = 0; index < n && count; index += 1) {
    const row = table.byAdded[index] as number;
    const level = state[row] as number;
    if (level >= 2) (buckets[level - 2] as number[]).push(row);
  }
  const rows = new Uint32Array(Math.min(count, VOD_SEARCH.rowsMax));
  let kept = 0;
  for (const bucket of buckets) {
    for (let start = 0; start < bucket.length && kept < rows.length;) {
      const added = table.added[bucket[start] as number];
      let end = start + 1;
      while (end < bucket.length && table.added[bucket[end] as number] === added) end += 1;
      const run = end - start > 1 ? bucket.slice(start, end) : [bucket[start] as number];
      if (run.length > 1) {
        run.sort((a, b) => {
          const titleA = table.foldedTitle(a);
          const titleB = table.foldedTitle(b);
          return titleA < titleB ? -1 : titleA > titleB ? 1 : a - b;
        });
      }
      for (const row of run) {
        if (kept >= rows.length) break;
        rows[kept] = row;
        kept += 1;
      }
      start = end;
    }
  }
  return { rows, total: count, tagCounts: countTags(table, matched) };
}

/**
 * Una sola palabra: los niveles salen del propio recorrido de `indexOf`, sin
 * recortar títulos (con «la» son decenas de miles de filas). Deja en
 * `state[row]` el nivel + 2 de cada fila que casa y la apunta en `matched`.
 */
function singleWordLevels(
  table: VodTable,
  word: string,
  bucket: number | null,
  state: Uint8Array,
  matched: number[],
): void {
  const { folded, offsets, n } = table;
  let row = -1;
  let rowEnd = -1;
  let lead = -1;
  let skip = false;
  for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) {
    if (at >= rowEnd) {
      row = rowAt(offsets, n, at, Math.max(0, row));
      rowEnd = (offsets[row + 1] as number) - 1;
      lead = offsets[row] as number;
      while (lead < rowEnd && !isWordUnit(folded.charCodeAt(lead))) lead += 1;
      skip = bucket !== null && bucketOf(table, row) !== bucket;
      if (!skip && !state[row]) {
        state[row] = 6;
        matched.push(row);
      }
    }
    if (skip || at + word.length > rowEnd) continue;
    let level: number;
    if (at === lead) {
      let end = at + word.length;
      const endsWord = end >= rowEnd || !isWordUnit(folded.charCodeAt(end));
      while (endsWord && end < rowEnd && !isWordUnit(folded.charCodeAt(end))) end += 1;
      level = endsWord && end >= rowEnd ? 0 : 1;
    } else {
      level = isWordUnit(folded.charCodeAt(at - 1)) ? 4 : 2;
    }
    if (level + 2 < (state[row] as number)) state[row] = level + 2;
  }
}

/** ¿Letra o número? (ASCII exacto; lo de fuera de ASCII cuenta como letra). */
function isWordUnit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    code > 127
  );
}

/** Posición de `word` empezando palabra en `title` desde `from`, o -1. */
function wordStart(title: string, word: string, from: number): number {
  for (let at = title.indexOf(word, from); at >= 0; at = title.indexOf(word, at + 1)) {
    if (at === 0 || !isWordUnit(title.charCodeAt(at - 1))) return at;
  }
  return -1;
}

/**
 * Nivel de relevancia de una fila (§6.2): 0 igual, 1 empieza por la
 * consulta, 2 todas las palabras empiezan palabra en orden, 3 en cualquier
 * orden, 4 el resto. Sin expresiones regulares: «la» da decenas de miles de
 * filas.
 */
export function relevance(title: string, words: readonly string[]): number {
  if (!words.length) return 4;
  const prefix = prefixLevel(title, words);
  if (prefix !== null) return prefix;
  let from = 0;
  let inOrder = true;
  for (const word of words) {
    const at = wordStart(title, word, from);
    if (at < 0) {
      inOrder = false;
      break;
    }
    from = at + word.length;
  }
  if (inOrder) return 2;
  return words.every((word) => wordStart(title, word, 0) >= 0) ? 3 : 4;
}

/**
 * Niveles 0 y 1 recorriendo el título una vez: las palabras de la consulta
 * son las primeras del título, seguidas (la última puede ser el principio de
 * una palabra). 0 si no queda nada detrás; null si no es el caso.
 */
function prefixLevel(title: string, words: readonly string[]): number | null {
  let at = 0;
  const end = title.length;
  const skip = (): void => {
    while (at < end && !isWordUnit(title.charCodeAt(at))) at += 1;
  };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    skip();
    if (!title.startsWith(word, at)) return null;
    at += word.length;
    const last = index === words.length - 1;
    const endsWord = at >= end || !isWordUnit(title.charCodeAt(at));
    if (!last && !endsWord) return null;
    if (last) {
      if (!endsWord) return 1;
      skip();
      return at >= end ? 0 : 1;
    }
  }
  return null;
}

/** Caché de consultas por tabla (LRU de 16, §6.3): se va con la tabla. */
const caches = new WeakMap<VodTable, Map<string, VodHits>>();

/** `searchTable` con la caché LRU de 16 consultas. */
export function searchCached(table: VodTable, query: VodQuery, bucket: number | null): VodHits {
  let cache = caches.get(table);
  if (!cache) {
    cache = new Map();
    caches.set(table, cache);
  }
  const key = `${bucket ?? 'all'}|${query.key}|${query.compact}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = searchTable(table, query, bucket);
  cache.set(key, result);
  while (cache.size > VOD_SEARCH.cacheQueries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return result;
}

export interface VodPage {
  readonly rows: readonly number[];
  readonly total: number;
  readonly capped: boolean;
  readonly tagCounts: ReadonlyArray<{ readonly tag: VodTag; readonly count: number }>;
  /** Hay más detrás de esta página. */
  readonly more: boolean;
}

/** Una página de una búsqueda (con el filtro de distintivo aplicado sobre los 2 000 mejores). */
export function searchPage(
  hits: VodHits,
  table: VodTable,
  filter: VodFilter,
  offset: number,
  limit: number,
): VodPage {
  let rows: ArrayLike<number> = hits.rows;
  let total = hits.total;
  if (filter.tagBit) {
    const filtered: number[] = [];
    for (const row of hits.rows)
      if ((table.tags[row] as number) & filter.tagBit) filtered.push(row);
    rows = filtered;
    const tagIndex = VOD_TAGS.findIndex((_, index) => 1 << index === filter.tagBit);
    total =
      hits.tagCounts.find((item) => item.tag === VOD_TAGS[tagIndex])?.count ?? filtered.length;
  }
  const page: number[] = [];
  for (let index = offset; index < rows.length && page.length < limit; index += 1) {
    page.push(rows[index] as number);
  }
  return {
    rows: page,
    total,
    capped: total > rows.length || hits.total > VOD_SEARCH.rowsMax,
    tagCounts: hits.tagCounts,
    more: offset + page.length < rows.length,
  };
}

/**
 * Una página sin texto (§6.3): «Novedades» (`byAdded`) o A-Z, con los
 * filtros. Sin categoría (`bucket` null) los adultos no salen.
 */
export function listPage(
  table: VodTable,
  filter: VodFilter,
  sort: 'added' | 'name',
  offset: number,
  limit: number,
): VodPage {
  const excludeAdult = filter.bucket === null;
  let order: ArrayLike<number>;
  if (filter.bucket !== null && sort === 'added') order = table.categoryRows(filter.bucket);
  else order = sort === 'name' ? table.byTitle() : table.byAdded;
  const page: number[] = [];
  const counts = new Array<number>(VOD_TAGS.length).fill(0);
  let total = 0;
  for (let index = 0; index < order.length; index += 1) {
    const row = order[index] as number;
    if (excludeAdult && table.isAdult(row)) continue;
    if (filter.bucket !== null && bucketOf(table, row) !== filter.bucket) continue;
    const bits = table.tags[row] as number;
    if (bits) {
      for (let tag = 0; tag < VOD_TAGS.length; tag += 1) {
        if (bits & (1 << tag)) counts[tag] = (counts[tag] as number) + 1;
      }
    }
    if (filter.tagBit && !(bits & filter.tagBit)) continue;
    if (total >= offset && page.length < limit) page.push(row);
    total += 1;
  }
  return {
    rows: page,
    total,
    capped: false,
    tagCounts: VOD_TAGS.map((tag, index) => ({ tag, count: counts[index] as number })).filter(
      (item) => item.count > 0,
    ),
    more: offset + page.length < total,
  };
}

/** Cuántas filas casan con una consulta en la otra tabla («Ver 3 series», §6.1). */
export function otherKindTotal(table: VodTable, query: VodQuery): number {
  return searchCached(table, query, null).total;
}
