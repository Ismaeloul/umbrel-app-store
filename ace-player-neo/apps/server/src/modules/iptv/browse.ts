/* Índice y consulta de la pestaña IPTV de Canales (docs/iptv.md §16.3 y §16.5).

   Puro: lo monta `iptv` al aplicar una sincronización y al cargar
   `catalogo.enc`, y lo consulta `iptvBrowse`. Nada recorre el catálogo entero
   más de una vez por consulta.

   - Fila = un canal: las variantes con la misma clave limpia (§3.4) Y el mismo
     país deducido (§16.4). Su mejor variante es la primera por
     `compareVariants` (§4.3); su orden, la primera aparición de cualquiera de
     sus variantes en la lista (el orden del proveedor).
   - Categoría = un nombre de grupo del proveedor, con id
     `sha256(provider.id + '\n' + nombre)[0..12]` (`none` sin nombre). Una
     fila está en todas las categorías de sus variantes. Orden: el de
     `get_live_categories` (Xtream) o la primera aparición (M3U); «Sin
     categoría», al final.
   - Facetas como mapas de bits: un `Uint32Array` de `ceil(filas / 32)`
     palabras por valor. Filtros: O dentro de una faceta, Y entre facetas.
     Recuentos disyuntivos: el de cada valor de F se cuenta con todo lo demás
     elegido MENOS F.
   - Texto: las mismas reglas que el buscador (§14.3): cada palabra de la
     consulta limpia es principio de alguna palabra de la clave (con 3 letras
     o más, también dentro), o la clave sin espacios contiene la consulta sin
     espacios. Orden por niveles (clave igual → empieza por → palabras en
     orden → el resto) y, dentro, el del proveedor.
   - Las filas ya ordenadas de una consulta se guardan (16 consultas) para
     servir las páginas siguientes con un trozo del array. */

import { createHash } from 'node:crypto';
import {
  IPTV_BROWSE,
  IPTV_BROWSE_QUALITIES,
  IPTV_SPORTS,
  IPTV_TYPES,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  type IptvFacetName,
  type IptvQuality,
} from '@ace/shared';
import { compareVariants, type Catalog, type CatalogEntry } from './catalog.js';
import { FacetDeriver, variantQuality } from './facets.js';
import { cleanIptvTitle } from './names.js';
import { foldText } from './search.js';

export const FACET_NAMES: readonly IptvFacetName[] = [
  'country',
  'language',
  'type',
  'sport',
  'quality',
];

const NONE = 'none';
const QUALITY_BIT: Readonly<Record<IptvQuality, number>> = { uhd: 1, fhd: 2, hd: 4, sd: 8 };

// --- Mapas de bits ---

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function countBits(bits: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < bits.length; i += 1) total += popcount(bits[i] as number);
  return total;
}

function countAnd(a: Uint32Array, b: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += popcount((a[i] as number) & (b[i] as number));
  return total;
}

function andInto(target: Uint32Array, other: Uint32Array): void {
  for (let i = 0; i < target.length; i += 1)
    target[i] = (target[i] as number) & (other[i] as number);
}

function andNotInto(target: Uint32Array, other: Uint32Array): void {
  for (let i = 0; i < target.length; i += 1)
    target[i] = (target[i] as number) & ~(other[i] as number);
}

function orInto(target: Uint32Array, other: Uint32Array): void {
  for (let i = 0; i < target.length; i += 1)
    target[i] = (target[i] as number) | (other[i] as number);
}

function setBit(bits: Uint32Array, row: number): void {
  const word = row >>> 5;
  bits[word] = (bits[word] as number) | (1 << (row & 31));
}

function hasBit(bits: Uint32Array, row: number): boolean {
  return ((bits[row >>> 5] as number) & (1 << (row & 31))) !== 0;
}

/** Filas con el bit puesto, de menor a mayor (el orden del proveedor). */
function rowsOf(bits: Uint32Array, out: number[] = []): number[] {
  for (let word = 0; word < bits.length; word += 1) {
    let value = bits[word] as number;
    while (value !== 0) {
      const low = value & -value;
      out.push(word * 32 + (31 - Math.clz32(low)));
      value ^= low;
    }
  }
  return out;
}

// --- Índice ---

export interface BrowseCategory {
  readonly index: number;
  readonly id: string;
  /** Nombre tal cual del proveedor (el servicio lo redacta al enseñarlo); vacío = «Sin categoría». */
  readonly name: string;
  /** Filas de la categoría, ordenadas. */
  readonly rows: Int32Array;
  /** Nombre plegado (sin tildes ni mayúsculas) para buscar categorías por texto. */
  readonly folded: string;
}

export interface BrowseIndex {
  readonly catalog: Catalog;
  readonly rowCount: number;
  readonly words: number;
  /** Mejor variante de cada fila. */
  readonly best: readonly CatalogEntry[];
  readonly key: readonly string[];
  readonly country: readonly (string | null)[];
  /** Calidades de la fila (bits: uhd 1, fhd 2, hd 4, sd 8). */
  readonly qualities: Uint8Array;
  /** Categoría de la mejor variante. */
  readonly category: Int32Array;
  readonly categories: readonly BrowseCategory[];
  readonly categoryById: ReadonlyMap<string, BrowseCategory>;
  readonly facets: Readonly<Record<IptvFacetName, ReadonlyMap<string, Uint32Array>>>;
  readonly all: Uint32Array;
  /** Texto: palabras distintas de las claves, ordenadas, y las claves de cada una. */
  readonly tokens: readonly string[];
  readonly byToken: ReadonlyMap<string, number | number[]>;
  /** Claves distintas (poca memoria: arrays paralelos y sin un objeto por clave). */
  readonly keyText: readonly string[];
  /** La clave sin espacios («lasexta»). */
  readonly keyCompact: readonly string[];
  /** Primera fila de cada clave; las demás (otros países), en `keyMoreRows`. */
  readonly keyRow: Int32Array;
  readonly keyMoreRows: ReadonlyMap<number, readonly number[]>;
  /** Consultas ya ordenadas (LRU). */
  readonly cache: Map<string, CachedQuery>;
}

interface CachedQuery {
  readonly order: Int32Array;
  readonly categories: readonly { readonly index: number; readonly count: number }[];
  readonly facets: BrowseFacets;
  readonly text: string;
}

export type BrowseFacets = Readonly<
  Record<
    IptvFacetName,
    readonly { readonly value: string; readonly count: number; readonly selected: boolean }[]
  >
>;

/** Id de una categoría: 12 hex del nombre con el proveedor; `none` sin nombre. */
export function categoryId(providerId: string, name: string): string {
  if (!name) return NONE;
  return createHash('sha256').update(`${providerId}\n${name}`).digest('hex').slice(0, 12);
}

/**
 * Monta el índice a trozos: cada `yield` es un punto en el que se puede ceder
 * el hilo (el servicio lo hace con `setImmediate`, §16.5). Una sola pasada
 * por el catálogo y nada por fila salvo números: con 100 000 canales, unos
 * pocos MB (el contenedor tiene `mem_limit: 768m`, §12.2).
 */
export function* buildBrowseIndexSteps(
  catalog: Catalog,
  chunk: number = IPTV_BROWSE.buildChunk,
): Generator<void, BrowseIndex, void> {
  const deriver = new FacetDeriver();
  const entries = catalog.entries;
  /* Categorías: primero el orden del proveedor, luego la primera aparición y «Sin categoría» al final. */
  const present = new Set<string>();
  for (const entry of entries) present.add(entry.group);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of catalog.groupOrder) {
    if (name && present.has(name) && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  for (const entry of entries) {
    if (entry.group && !seen.has(entry.group)) {
      seen.add(entry.group);
      names.push(entry.group);
    }
  }
  if (present.has('')) names.push('');
  present.clear();
  seen.clear();
  const categoryIndex = new Map(names.map((name, index) => [name, index]));

  /* Los mapas de bits se dimensionan por entradas (hay como mucho una fila por entrada). */
  const words = Math.max(1, Math.ceil(entries.length / 32));
  const facets: Record<IptvFacetName, Map<string, Uint32Array>> = {
    country: new Map(),
    language: new Map(),
    type: new Map(),
    sport: new Map(),
    quality: new Map(),
  };
  const mark = (facet: IptvFacetName, value: string, row: number): void => {
    let bits = facets[facet].get(value);
    if (!bits) {
      bits = new Uint32Array(words);
      facets[facet].set(value, bits);
    }
    setBit(bits, row);
  };
  const best: CatalogEntry[] = [];
  const key: string[] = [];
  const country: (string | null)[] = [];
  const qualities = new Uint8Array(entries.length);
  const categoryRows: number[][] = names.map(() => []);
  /* Fila por clave (la del primer país que aparece) y, si la clave sale con otro país, por clave y país. */
  const firstRow = new Map<string, number>();
  const otherRows = new Map<string, number>();
  const keyText: string[] = [];
  const keyCompact: string[] = [];
  const keyFirst: number[] = [];
  const keyMoreRows = new Map<number, number[]>();
  const keyOfRow: number[] = [];
  const byToken = new Map<string, number | number[]>();

  let done = 0;
  for (const entry of entries) {
    const derived = deriver.derive({
      title: entry.title,
      group: entry.group,
      tvgCountry: entry.tvgCountry,
      tvgLanguage: entry.tvgLanguage,
      quality: entry.quality,
    });
    let row = firstRow.get(entry.key);
    if (row !== undefined && country[row] !== derived.country) {
      row = otherRows.get(`${entry.key}\n${derived.country ?? ''}`);
    }
    if (row === undefined) {
      row = best.length;
      best.push(entry);
      key.push(entry.key);
      country.push(derived.country);
      mark('country', derived.country ?? NONE, row);
      const first = firstRow.get(entry.key);
      if (first === undefined) {
        firstRow.set(entry.key, row);
        const position = keyText.length;
        keyOfRow.push(position);
        keyText.push(entry.key);
        keyCompact.push(entry.key.replace(/ /g, ''));
        keyFirst.push(row);
        for (const word of new Set(entry.key.split(' ').filter(Boolean))) {
          const list = byToken.get(word);
          if (list === undefined) byToken.set(word, position);
          else if (typeof list === 'number') byToken.set(word, [list, position]);
          else list.push(position);
        }
      } else {
        otherRows.set(`${entry.key}\n${derived.country ?? ''}`, row);
        const position = keyOfRow[first] as number;
        keyOfRow.push(position);
        const more = keyMoreRows.get(position);
        if (more) more.push(row);
        else keyMoreRows.set(position, [row]);
      }
    } else if (compareVariants(entry, best[row] as CatalogEntry) < 0) {
      best[row] = entry;
    }
    (categoryRows[categoryIndex.get(entry.group) as number] as number[]).push(row);
    for (const code of derived.languages) mark('language', code, row);
    for (const type of derived.types) mark('type', type, row);
    for (const sport of derived.sports) mark('sport', sport, row);
    const quality = variantQuality(entry.title, entry.quality);
    if (quality) {
      qualities[row] = (qualities[row] as number) | QUALITY_BIT[quality];
      mark('quality', quality, row);
    }
    done += 1;
    if (done % chunk === 0) yield;
  }
  firstRow.clear();
  otherRows.clear();
  keyOfRow.length = 0;

  const rowCount = best.length;
  const all = new Uint32Array(words);
  for (let row = 0; row < rowCount; row += 1) setBit(all, row);
  /* Adultos es excluyente también en la fila (una variante lo es → la fila lo es). */
  const adult = facets.type.get('adultos');
  if (adult) {
    for (const facet of ['type', 'sport'] as const) {
      for (const [value, bits] of facets[facet]) {
        if (value === 'adultos') continue;
        andNotInto(bits, adult);
        if (!countBits(bits)) facets[facet].delete(value);
      }
    }
  }
  /* «Sin …»: las filas sin ningún valor de la faceta (el deporte no tiene «Sin deporte»). */
  for (const facet of ['language', 'type', 'quality'] as const) {
    const none = new Uint32Array(all);
    for (const bits of facets[facet].values()) andNotInto(none, bits);
    if (countBits(none)) facets[facet].set(NONE, none);
  }
  yield;

  const category = new Int32Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    category[row] = categoryIndex.get((best[row] as CatalogEntry).group) as number;
  }
  const categories: BrowseCategory[] = names.map((name, index) => {
    /* Una fila con dos variantes en la misma categoría cuenta una vez. */
    const sorted = Int32Array.from(categoryRows[index] as number[]).sort();
    let unique = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[unique++] = sorted[i] as number;
    }
    categoryRows[index] = [];
    return {
      index,
      id: categoryId(catalog.providerId, name),
      name,
      rows: sorted.slice(0, unique),
      folded: foldText(name),
    };
  });
  return {
    catalog,
    rowCount,
    words,
    best,
    key,
    country,
    qualities,
    category,
    categories,
    categoryById: new Map(categories.map((item) => [item.id, item])),
    facets,
    all,
    tokens: [...byToken.keys()].sort(),
    byToken,
    keyText,
    keyCompact,
    keyRow: Int32Array.from(keyFirst),
    keyMoreRows,
    cache: new Map(),
  };
}

/** El índice de una vez, sin ceder el hilo (tests y catálogos pequeños). */
export function buildBrowseIndex(catalog: Catalog): BrowseIndex {
  const steps = buildBrowseIndexSteps(catalog);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Calidades de una fila, de mejor a peor para enseñar (4K, 1080p, 720p, SD). */
export function rowQualities(index: BrowseIndex, row: number): IptvQuality[] {
  const bits = index.qualities[row] as number;
  return IPTV_BROWSE_QUALITIES.filter((quality) => bits & QUALITY_BIT[quality]);
}

/**
 * Las variantes de la fila de una entrada (§16.3, D31): las de su misma
 * clave y su mismo país deducido, de mejor a peor. Con todo desbloqueado,
 * «UK: DAZN 1» no es «ES: DAZN 1»: tocar uno nunca abre el otro.
 */
export function rowVariants(catalog: Catalog, entry: CatalogEntry): CatalogEntry[] {
  const deriver = new FacetDeriver();
  const country = deriver.country(entry);
  return catalog
    .group(entry.key)
    .filter((item) => item === entry || deriver.country(item) === country);
}

// --- Consulta ---

export interface BrowseRequest {
  /** Id de categoría (12 hex o `none`), o nada para toda la IPTV. */
  readonly category?: string | undefined;
  readonly q?: string | undefined;
  readonly country?: readonly string[] | undefined;
  readonly language?: readonly string[] | undefined;
  readonly type?: readonly string[] | undefined;
  readonly sport?: readonly string[] | undefined;
  readonly quality?: readonly string[] | undefined;
  readonly offset: number;
  readonly limit: number;
  /** Con categorías y facetas (primera página). */
  readonly withSummary: boolean;
}

export interface BrowseResult {
  /** La consulta limpia (vacía con menos de 2 letras). */
  readonly query: string;
  /** La categoría pedida; `missing` si se pidió y no existe. */
  readonly category: BrowseCategory | 'missing' | null;
  readonly total: number;
  readonly rows: readonly number[];
  /** Posición de la página siguiente, o null. */
  readonly nextOffset: number | null;
  readonly categories?: readonly { readonly category: BrowseCategory; readonly count: number }[];
  readonly facets?: BrowseFacets;
}

/** La consulta tal y como se usa: espacios colapsados, recortada, 80; con menos de 2 letras, vacía. */
export function cleanBrowseQuery(value: unknown): string {
  const q = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX);
  return q.length < SEARCH_QUERY_MIN ? '' : q;
}

/* Primera posición de `tokens` que no es menor que `word`. */
function lowerBound(tokens: readonly string[], word: string): number {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tokens[mid] as string) < word) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/* Palabras del índice que empiezan por `word` (o la contienen, con 3 letras o más). */
function tokensForWord(index: BrowseIndex, word: string): string[] {
  const out: string[] = [];
  for (let i = lowerBound(index.tokens, word); i < index.tokens.length; i += 1) {
    const token = index.tokens[i] as string;
    if (!token.startsWith(word)) break;
    out.push(token);
  }
  if (word.length >= 3) {
    for (const token of index.tokens) {
      if (!token.startsWith(word) && token.includes(word)) out.push(token);
    }
  }
  return out;
}

function inOrder(words: readonly string[], key: string): boolean {
  const keyWords = key.split(' ');
  let from = 0;
  for (const word of words) {
    let found = -1;
    for (let i = from; i < keyWords.length; i += 1) {
      if ((keyWords[i] as string).startsWith(word)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}

/**
 * Filas que casan con el texto (mapa de bits) y el nivel de cada una
 * (0 clave igual, 1 empieza por, 2 palabras en orden, 3 el resto).
 */
function textMatch(
  index: BrowseIndex,
  query: string,
): { readonly bits: Uint32Array; readonly rank: Uint8Array } {
  const bits = new Uint32Array(index.words);
  const rank = new Uint8Array(index.words * 32);
  const key = cleanIptvTitle(query).key;
  if (!key) return { bits, rank };
  const words = [...new Set(key.split(' ').filter(Boolean))].slice(0, 32);
  /* Cada palabra tiene que casar: se cuenta cuántas palabras casan con cada clave. */
  const count = index.keyText.length;
  const hits = new Uint8Array(count);
  const last = new Int8Array(count).fill(-1);
  const hit = (item: number, position: number): void => {
    if (last[item] === position) return;
    last[item] = position;
    hits[item] = (hits[item] as number) + 1;
  };
  words.forEach((word, position) => {
    for (const token of tokensForWord(index, word)) {
      const items = index.byToken.get(token);
      if (typeof items === 'number') hit(items, position);
      else if (items) for (const item of items) hit(item, position);
    }
  });
  /* O la clave sin espacios contiene la consulta sin espacios («la sexta» → «lasexta»). */
  const compact = key.replace(/ /g, '');
  const byCompact = compact.length >= SEARCH_QUERY_MIN;
  const mark = (row: number, level: number): void => {
    setBit(bits, row);
    rank[row] = level;
  };
  for (let position = 0; position < count; position += 1) {
    if (
      hits[position] !== words.length &&
      !(byCompact && (index.keyCompact[position] as string).includes(compact))
    ) {
      continue;
    }
    const text = index.keyText[position] as string;
    const level = text === key ? 0 : text.startsWith(key) ? 1 : inOrder(words, text) ? 2 : 3;
    mark(index.keyRow[position] as number, level);
    for (const row of index.keyMoreRows.get(position) ?? []) mark(row, level);
  }
  return { bits, rank };
}

function categoryBits(index: BrowseIndex, category: BrowseCategory): Uint32Array {
  const bits = new Uint32Array(index.words);
  for (const row of category.rows) setBit(bits, row);
  return bits;
}

function countRowsIn(category: BrowseCategory, bits: Uint32Array): number {
  let count = 0;
  for (const row of category.rows) if (hasBit(bits, row)) count += 1;
  return count;
}

const TYPE_ORDER = new Map<string, number>(IPTV_TYPES.map((type, i) => [type, i]));
const SPORT_ORDER = new Map<string, number>(IPTV_SPORTS.map((sport, i) => [sport, i]));
const QUALITY_ORDER = new Map<string, number>(
  [...IPTV_BROWSE_QUALITIES, NONE].map((quality, i) => [quality, i]),
);

function compareValues(facet: IptvFacetName) {
  return (a: { value: string; count: number }, b: { value: string; count: number }): number => {
    if (facet === 'quality') {
      return (QUALITY_ORDER.get(a.value) ?? 99) - (QUALITY_ORDER.get(b.value) ?? 99);
    }
    if ((a.value === NONE) !== (b.value === NONE)) return a.value === NONE ? 1 : -1;
    if (a.count !== b.count) return b.count - a.count;
    if (facet === 'type') return (TYPE_ORDER.get(a.value) ?? 99) - (TYPE_ORDER.get(b.value) ?? 99);
    if (facet === 'sport')
      return (SPORT_ORDER.get(a.value) ?? 99) - (SPORT_ORDER.get(b.value) ?? 99);
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  };
}

function cacheKey(request: BrowseRequest, text: string, category: number | null): string {
  const list = (values: readonly string[] | undefined) =>
    [...new Set(values ?? [])].sort().join(',');
  return [
    category ?? '*',
    text,
    list(request.country),
    list(request.language),
    list(request.type),
    list(request.sport),
    list(request.quality),
  ].join('|');
}

/** Consulta el índice (§16.5): filtra, cuenta y pagina. */
export function browseIndex(index: BrowseIndex, request: BrowseRequest): BrowseResult {
  const query = cleanBrowseQuery(request.q);
  let category: BrowseCategory | null = null;
  if (request.category !== undefined) {
    const found = index.categoryById.get(request.category);
    if (!found) {
      return { query, category: 'missing', total: 0, rows: [], nextOffset: null };
    }
    category = found;
  }
  const key = cacheKey(request, query, category?.index ?? null);
  let cached = index.cache.get(key);
  if (cached) {
    /* LRU: la usada pasa al final. */
    index.cache.delete(key);
    index.cache.set(key, cached);
  } else {
    cached = compute(index, request, query, category);
    index.cache.set(key, cached);
    while (index.cache.size > IPTV_BROWSE.cacheEntries) {
      const oldest = index.cache.keys().next().value;
      if (oldest === undefined) break;
      index.cache.delete(oldest);
    }
  }
  const total = cached.order.length;
  const offset = Math.max(0, request.offset);
  const limit = Math.max(0, Math.min(request.limit, IPTV_BROWSE.limitMax));
  const rows = limit ? Array.from(cached.order.subarray(offset, offset + limit)) : [];
  const nextOffset = limit && offset + limit < total ? offset + limit : null;
  return {
    query,
    category,
    total,
    rows,
    nextOffset,
    ...(request.withSummary
      ? {
          facets: cached.facets,
          ...(category
            ? {}
            : {
                categories: cached.categories.map((item) => ({
                  category: index.categories[item.index] as BrowseCategory,
                  count: item.count,
                })),
              }),
        }
      : {}),
  };
}

function compute(
  index: BrowseIndex,
  request: BrowseRequest,
  query: string,
  category: BrowseCategory | null,
): CachedQuery {
  const base = category ? categoryBits(index, category) : index.all;
  const text = query ? textMatch(index, query) : null;
  const scope = new Uint32Array(base);
  if (text) andInto(scope, text.bits);

  /* O dentro de cada faceta elegida. */
  const selected: Partial<Record<IptvFacetName, Uint32Array>> = {};
  const chosen: Record<IptvFacetName, readonly string[]> = {
    country: request.country ?? [],
    language: request.language ?? [],
    type: request.type ?? [],
    sport: request.sport ?? [],
    quality: request.quality ?? [],
  };
  for (const facet of FACET_NAMES) {
    const values = chosen[facet];
    if (!values.length) continue;
    const bits = new Uint32Array(index.words);
    for (const value of values) {
      const known = index.facets[facet].get(value);
      if (known) orInto(bits, known);
    }
    selected[facet] = bits;
  }
  /* Y entre facetas. */
  const result = new Uint32Array(scope);
  for (const facet of FACET_NAMES) {
    const bits = selected[facet];
    if (bits) andInto(result, bits);
  }

  /* Recuentos disyuntivos: cada faceta, con todo lo demás elegido menos ella. */
  const facets = {} as Record<IptvFacetName, { value: string; count: number; selected: boolean }[]>;
  for (const facet of FACET_NAMES) {
    let others = result;
    if (selected[facet]) {
      others = new Uint32Array(scope);
      for (const other of FACET_NAMES) {
        const bits = selected[other];
        if (other !== facet && bits) andInto(others, bits);
      }
    }
    const picked = new Set(chosen[facet]);
    const values: { value: string; count: number; selected: boolean }[] = [];
    for (const [value, bits] of index.facets[facet]) {
      const count = countAnd(others, bits);
      if (count > 0 || picked.has(value))
        values.push({ value, count, selected: picked.has(value) });
    }
    for (const value of picked) {
      if (!index.facets[facet].has(value)) values.push({ value, count: 0, selected: true });
    }
    values.sort(compareValues(facet));
    let shown = values.slice(0, IPTV_BROWSE.facetValuesMax);
    const missing = values.slice(IPTV_BROWSE.facetValuesMax).filter((item) => item.selected);
    if (missing.length)
      shown = [...shown.slice(0, IPTV_BROWSE.facetValuesMax - missing.length), ...missing];
    facets[facet] = shown;
  }

  /* Categorías (solo en la raíz): sin texto, las que tienen algo; con texto, las que lo llevan en el nombre. */
  const categories: { index: number; count: number }[] = [];
  if (!category) {
    if (!query) {
      for (const item of index.categories) {
        const count = countRowsIn(item, result);
        if (count > 0) categories.push({ index: item.index, count });
        if (categories.length >= IPTV_BROWSE.categoriesMax) break;
      }
    } else {
      const needle = foldText(query);
      /* Cuentan sin el texto (es lo que se verá al entrar), con los filtros. */
      const filtered = new Uint32Array(index.all);
      for (const facet of FACET_NAMES) {
        const bits = selected[facet];
        if (bits) andInto(filtered, bits);
      }
      for (const item of index.categories) {
        if (!item.name || !item.folded.includes(needle)) continue;
        const count = countRowsIn(item, filtered);
        if (count > 0) categories.push({ index: item.index, count });
        if (categories.length >= IPTV_BROWSE.categoriesMatchMax) break;
      }
    }
  }

  /* Orden: el del proveedor; con texto, por niveles y luego el del proveedor. */
  const rows = rowsOf(result);
  if (!text) return { order: Int32Array.from(rows), categories, facets, text: query };
  /* Por niveles sin comparar: cuatro cubos que ya vienen en el orden del proveedor. */
  const order = new Int32Array(rows.length);
  let at = 0;
  for (let level = 0; level <= 3; level += 1) {
    for (const row of rows) if (text.rank[row] === level) order[at++] = row;
  }
  return { order, categories, facets, text: query };
}

/** Filas de todo el catálogo (para `catalogTotal`). */
export function catalogRows(index: BrowseIndex): number {
  return countBits(index.all);
}

// --- Sello y cursor ---

/** Sello del catálogo (`[a-z0-9]{1,16}`): cambia con cada sincronización aplicada. */
export function catalogStamp(catalog: Pick<Catalog, 'builtAt' | 'revision'>): string {
  return `${Math.max(0, Math.floor(catalog.builtAt)).toString(36)}${Math.max(
    0,
    Math.floor(catalog.revision),
  ).toString(36)}`.slice(0, 16);
}

/** `base64url(<sello>.<posición>)`: la página N se calcula igual aunque el servidor se reinicie. */
export function encodeCursor(stamp: string, offset: number): string {
  return Buffer.from(`${stamp}.${offset}`, 'utf8').toString('base64url');
}

/** El cursor de `nextCursor`, o null si no tiene esa forma (la ruta responde 400). */
export function decodeCursor(cursor: string): { stamp: string; offset: number } | null {
  let text: string;
  try {
    text = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const match = /^([a-z0-9]{1,16})\.(\d{1,7})$/.exec(text);
  if (!match) return null;
  const offset = Number(match[2]);
  return offset > 0 ? { stamp: match[1] as string, offset } : null;
}
