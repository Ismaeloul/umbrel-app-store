/* Índice y consulta de la pestaña IPTV de Canales (docs/iptv.md §16.3 y §16.5).

   Puro: lo monta `iptv` al aplicar una sincronización y al cargar
   `catalogo.enc`, y lo consulta `iptvBrowse`. Nada recorre el catálogo entero
   más de una vez por consulta.

   - Fila = un canal: las variantes con la misma clave limpia (§3.4) Y el mismo
     país deducido (§16.4); España y sin país son el mismo (como en el
     buscador, §17; desde la 0.9.0, docs/buscador.md: antes salían dos filas
     iguales, «M+ LaLiga TV» de «ES: …» y la de «VIP - …» sin país). La fila
     dice España si alguna de sus variantes lo dice, y cuenta en los dos
     valores de la faceta. Su mejor variante es la primera por
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
   - Texto: lo mismo que el buscador (search.ts y el módulo común de buscar
     por nombre, docs/buscador.md): las mismas palabras (sin país, calidad
     ni adornos; «la uno» = «la 1»), los mismos candidatos (principio de
     palabra, un número solo entero, por dentro en compuestos, lo escrito
     pegado y sin la marca), los mismos alias y el mismo orden
     (`compareRankedHits`: lo flojo detrás, España primero, lo igual, tus
     favoritos, el nivel…; al final, el del proveedor). Antes (0.8.x) era
     otro orden más sencillo y «la 1» daba «La 10» delante de «LaLiga TV 1».
   - Las filas ya ordenadas de una consulta se guardan (16 consultas) para
     servir las páginas siguientes con un trozo del array. */

import { createHash } from 'node:crypto';
import {
  IPTV_BROWSE,
  IPTV_BROWSE_QUALITIES,
  IPTV_SPORTS,
  IPTV_TYPES,
  MOVISTAR_WORDS,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  NAME_TIER,
  parseNameQuery,
  regionRank,
  type IptvFacetName,
  type IptvQuality,
  type NameFacts,
  type NameQuery,
  type NameQueryWords,
} from '@ace/shared';
import { channelIdOf, compareVariants, type Catalog, type CatalogEntry } from './catalog.js';
import { FacetDeriver, variantQuality } from './facets.js';
import {
  bestNameTier,
  cachedKeyNames,
  compareRankedHits,
  entriesPenalty,
  foldText,
  keyNames,
  literalMiss,
  rankTier,
  tokensForWord,
  type RankContext,
  type RankedHit,
} from './search.js';

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
  /** Texto: palabras distintas de los nombres de las claves (`keyNames`), ordenadas, y las claves de cada una. */
  readonly tokens: readonly string[];
  readonly byToken: ReadonlyMap<string, number | number[]>;
  /** Claves distintas (poca memoria: arrays paralelos y sin un objeto por clave). */
  readonly keyText: readonly string[];
  /** Las palabras de la clave pegadas («lasexta»). */
  readonly keyCompact: readonly string[];
  /** Primera fila de cada clave; las demás (otros países), en `keyMoreRows`. */
  readonly keyRow: Int32Array;
  /** La clave (posición en `keyText`) de cada fila. */
  readonly rowKey: Int32Array;
  readonly keyMoreRows: ReadonlyMap<number, readonly number[]>;
  /** Consultas ya ordenadas (LRU). */
  readonly cache: Map<string, CachedQuery>;
  /** Los nombres de las claves que han salido en una consulta (`cachedKeyNames`: no se guardan todos). */
  readonly names: Map<string, readonly NameFacts[]>;
  /** Lo que resta a cada fila para ordenar (`entriesPenalty`), calculado al hacer falta; -1 sin calcular. */
  readonly penalty: Int8Array;
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
  /* Fila por clave (la del primer país que aparece) y, si la clave sale con otro país, por clave y país (España
     y sin país, uno: `homeOf`). */
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
      nameCountry: entry.country,
    });
    const bucket = homeOf(derived.country);
    let row = firstRow.get(entry.key);
    if (row !== undefined && homeOf(country[row] ?? null) !== bucket) {
      row = otherRows.get(`${entry.key}\n${bucket}`);
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
        /* Las palabras de sus nombres (no se guardan: `BrowseIndex.names`). */
        const names = keyNames(entry.key);
        keyCompact.push((names[0] as NameFacts).compact);
        keyFirst.push(row);
        for (const word of new Set(names.flatMap((name) => name.words))) {
          const list = byToken.get(word);
          if (list === undefined) byToken.set(word, position);
          else if (typeof list === 'number') byToken.set(word, [list, position]);
          else list.push(position);
        }
      } else {
        otherRows.set(`${entry.key}\n${bucket}`, row);
        const position = keyOfRow[first] as number;
        keyOfRow.push(position);
        const more = keyMoreRows.get(position);
        if (more) more.push(row);
        else keyMoreRows.set(position, [row]);
      }
    } else {
      /* Otra variante de la misma fila: España manda sobre sin país, y cuenta en los dos. */
      if (derived.country === 'ES' && country[row] === null) country[row] = 'ES';
      mark('country', derived.country ?? NONE, row);
      if (compareVariants(entry, best[row] as CatalogEntry) < 0) best[row] = entry;
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
  const rowKey = Int32Array.from(keyOfRow);
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
    rowKey,
    keyMoreRows,
    cache: new Map(),
    names: new Map(),
    penalty: new Int8Array(rowCount).fill(-1),
  };
}

/** El «país» de una fila: España y sin país son el mismo (''); otro país, su código. */
function homeOf(country: string | null): string {
  return country === null || country === 'ES' ? '' : country;
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
  /** Canales (`channelIdOf`) de tus favoritos IPTV: con texto, desempatan delante (nunca de lo igual). */
  readonly favorites?: ReadonlySet<string> | undefined;
  /** Sello de `favorites` para la caché (cambia si cambian tus favoritos). */
  readonly favoritesKey?: string | undefined;
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

/* Claves (posición en `keyText`) con alguna palabra que casa con `word` (`tokensForWord` del buscador). */
function keysForWord(index: BrowseIndex, word: string, inside = true): Set<number> {
  const out = new Set<number>();
  for (const token of tokensForWord(index, word, inside)) {
    const items = index.byToken.get(token);
    if (typeof items === 'number') out.add(items);
    else if (items) for (const item of items) out.add(item);
  }
  return out;
}

function intersect(sets: readonly Set<number>[]): Set<number> {
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  const [first, ...rest] = sorted;
  const out = new Set<number>();
  if (!first) return out;
  for (const item of first) if (rest.every((set) => set.has(item))) out.add(item);
  return out;
}

/*
 * Candidatas de una consulta (sin alias), como el buscador: sus palabras, lo
 * escrito pegado y sin la marca. Las que casan seguro (todas sus palabras en
 * el nombre, o sin la marca por el principio) van a `sure`; las que hay que
 * mirar con `bestNameTier` (lo pegado, que puede cortar un número), a
 * `unsure`.
 */
function keyCandidates(
  index: BrowseIndex,
  q: NameQueryWords,
  sure: Set<number>,
  unsure: Set<number>,
): void {
  if (!q.required.length) return;
  for (const item of intersect(q.required.map((word) => keysForWord(index, word)))) sure.add(item);
  if (q.compact.length >= 3) {
    index.keyCompact.forEach((compact, item) => {
      if (!sure.has(item) && compact.includes(q.compact)) unsure.add(item);
    });
  }
  const brandless = q.required.filter((word) => !MOVISTAR_WORDS.has(word));
  if (
    brandless.length < q.required.length &&
    brandless.some((word) => word.length >= 3 && !/^\d+$/.test(word))
  ) {
    for (const item of intersect(brandless.map((word) => keysForWord(index, word, false)))) {
      sure.add(item);
    }
  }
}

/* La mejor calidad de una fila para desempatar (bits uhd 1, fhd 2, hd 4, sd 8 → 4, 3, 2, 1). */
function rowQuality(bits: number): number {
  if (bits & 1) return 4;
  if (bits & 2) return 3;
  if (bits & 4) return 2;
  return bits & 8 ? 1 : 0;
}

function rowPenalty(index: BrowseIndex, row: number, words: readonly string[]): number {
  const known = index.penalty[row] as number;
  if (known >= 0) return known;
  const best = index.best[row] as CatalogEntry;
  const value = entriesPenalty(best, [best], words, index.catalog);
  index.penalty[row] = value;
  return value;
}

interface TextMatch {
  /** Filas que casan (mapa de bits). */
  readonly bits: Uint32Array;
  readonly query: NameQuery;
}

/**
 * Filas que casan con el texto, con los mismos candidatos que el buscador
 * (`searchCatalog`) y sus alias. Aquí solo se decide QUÉ casa (barato): el
 * orden se calcula después con `rankRows`, solo para las filas que quedan tras
 * los filtros (con 100 000 canales, «canal» casa con 90 000).
 */
function textMatch(index: BrowseIndex, query: string): TextMatch {
  const bits = new Uint32Array(index.words);
  const q = parseNameQuery(query);
  if (!q.key) return { bits, query: q };
  const sure = new Set<number>();
  const unsure = new Set<number>();
  keyCandidates(index, q, sure, unsure);
  /* Lo de un alias puede quedarse fuera por su nivel máximo: se mira. */
  for (const alias of q.aliases) keyCandidates(index, alias.query, unsure, unsure);
  for (const item of unsure) {
    if (sure.has(item)) continue;
    if (bestNameTier(q, cachedKeyNames(index.names, index.keyText[item] as string)).tier >= 0)
      sure.add(item);
  }
  for (const item of sure) {
    setBit(bits, index.keyRow[item] as number);
    for (const row of index.keyMoreRows.get(item) ?? []) setBit(bits, row);
  }
  return { bits, query: q };
}

/**
 * Lo que ordena cada fila que casa y ha quedado tras los filtros
 * (`compareRankedHits`, el orden del buscador): su nivel con la consulta y sus
 * alias, el país, tus favoritos, lo que resta, el relleno escrito, la familia
 * (y su orden entre estas filas), el número, la calidad y el orden del
 * proveedor.
 */
function rankRows(
  index: BrowseIndex,
  rows: readonly number[],
  q: NameQuery,
  favorites: ReadonlySet<string> | undefined,
): Map<number, RankedHit> {
  const byItem = new Map<number, { tier: number; lead: boolean; main: NameFacts }>();
  const familyOrder = new Map<string, number>();
  const familyWords = new Map<string, Set<string>>();
  for (const row of rows) {
    const item = index.rowKey[row] as number;
    if (byItem.has(item)) continue;
    const key = index.keyText[item] as string;
    const names = cachedKeyNames(index.names, key);
    const found = bestNameTier(q, names);
    const main = names[0] as NameFacts;
    /* Casa por sus palabras aunque no por el nivel de un solo nombre (un alias del emparejado): lo más flojo. */
    byItem.set(item, {
      tier: found.tier < 0 ? NAME_TIER.inside : found.tier,
      lead: found.lead,
      main,
    });
    const first = index.keyRow[item] as number;
    familyOrder.set(main.family, Math.min(familyOrder.get(main.family) ?? first, first));
    if (q.typedOptional.length) {
      const words = familyWords.get(main.family) ?? new Set<string>();
      for (const word of key.split(' ')) words.add(word);
      familyWords.set(main.family, words);
    }
  }
  const context: RankContext = { query: q, familyWords };
  const hits = new Map<number, RankedHit>();
  for (const row of rows) {
    const item = index.rowKey[row] as number;
    const { tier, lead, main } = byItem.get(item) as {
      tier: number;
      lead: boolean;
      main: NameFacts;
    };
    const country = index.country[row] ?? null;
    const best = index.best[row] as CatalogEntry;
    const first = index.keyRow[item] as number;
    hits.set(row, {
      rank: {
        tier: rankTier(context, tier),
        lead,
        region: regionRank(country, q.country),
        favorite: Boolean(favorites?.has(channelIdOf(best))),
      },
      penalty: rowPenalty(index, row, main.words),
      miss: literalMiss(context, main.family),
      familyLength: main.family.length,
      familyOrder: familyOrder.get(main.family) ?? first,
      number: main.number,
      quality: rowQuality(index.qualities[row] as number),
      keyLength: (index.keyText[item] as string).length,
      keyOrder: first,
      abroad: regionRank(country) === 0 ? 0 : 1,
      order: row,
    });
  }
  return hits;
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
    /* Con texto, tus favoritos cambian el orden. */
    text ? (request.favoritesKey ?? '') : '',
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

  /* Orden: el del proveedor; con texto, el del buscador (`compareRankedHits`) y, al final, el del proveedor. */
  const rows = rowsOf(result);
  if (!text) return { order: Int32Array.from(rows), categories, facets, text: query };
  const hits = rankRows(index, rows, text.query, request.favorites);
  const hit = (row: number): RankedHit => hits.get(row) as RankedHit;
  rows.sort((a, b) => compareRankedHits(hit(a), hit(b)));
  return { order: Int32Array.from(rows), categories, facets, text: query };
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
