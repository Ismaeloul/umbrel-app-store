/* El buscador de la IPTV (docs/iptv.md §14.3). Puro: lo llama `iptv.search()`.

   1. Qué casa. La consulta pasa por la misma limpieza que un nombre IPTV
      (`cleanIptvTitle` e `iptvSpelling`: «m+ la liga» es «movistar laliga»)
      y se trocea en palabras. Un grupo del catálogo casa si CADA palabra es
      el principio de alguna palabra de su clave (en cualquier orden; con 3
      letras o más también vale dentro de una palabra: «liga» está en
      «laliga»), o si la clave sin espacios contiene la consulta sin espacios.
      Se busca en un índice de palabras propio (todas las palabras de cada
      clave, también «la» o «1», que la preselección de §3.4 no guarda): nada
      recorre las 100 000 entradas.
   2. Qué no sale nunca: canales con país distinto de ES (D25, el filtro de
      D9) y los grupos para adultos (xxx, adult, adulto/a, +18, 18+, porn…).
   3. Una fila por grupo (D23): la mejor variante (§4.3).
   4. Orden: clave igual → clave que empieza por la consulta → palabras en el
      mismo orden → el resto; dentro, la clave más corta y el orden del
      catálogo.
   5. `library`: los elementos de tu biblioteca que son ese canal
      (`sameChannelScore` ≥ 92), de mejor a peor, 20 como mucho.

   El índice se monta una vez por catálogo (WeakMap) y se tira con él. */

import {
  IPTV_MIN_SCORE,
  IPTV_SEARCH,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  type Item,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Catalog, CatalogEntry } from './catalog.js';
import { defaultCountryOk, sameChannelScore, type ChannelScorer } from './match.js';
import { cleanIptvTitle } from './names.js';

/** Minúsculas y sin tildes (lo mismo que el filtro de la web, `foldText`). */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/*
 * «+18» y «18+» sueltos, no el «+» de una marca seguido de un número:
 * «Canal+ 18» o «M+ 18 Series» no son para adultos («+» pegado a una letra).
 */
const ADULT_RE =
  /(?:^|[^a-z0-9])(?:xxx|adults?|adult[oa]s?|porn\w*)(?:$|[^a-z0-9])|(?:^|[^a-z0-9+])\+\s?18(?!\d)|(?<!\d)18\s?\+/;

/** ¿Es un canal (o un grupo) para adultos? Por palabra y sin tildes (§14.3). */
export function isAdultChannel(title: string, group: string): boolean {
  return ADULT_RE.test(foldText(`${group} ${title}`));
}

/**
 * La consulta tal y como la limpia `search` (espacios colapsados, recortada
 * y a 80). Con menos de 2 letras, `empty_query` (400).
 */
export function cleanChannelsQuery(value: unknown): string {
  const q = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX);
  if (q.length < SEARCH_QUERY_MIN) throw new AppError('empty_query');
  return q;
}

/** Un grupo que puede salir en el buscador. */
export interface SearchGroup {
  readonly key: string;
  /** La mejor variante que puede salir (ES o sin país, no para adultos). */
  readonly best: CatalogEntry;
  readonly words: readonly string[];
  /** La clave sin espacios («lasexta»). */
  readonly compact: string;
}

interface SearchIndex {
  readonly groups: readonly SearchGroup[];
  /** Clave → grupo (solo los que pueden salir). */
  readonly byKey: ReadonlyMap<string, SearchGroup>;
  /** Palabras distintas de todas las claves, ordenadas (búsqueda por prefijo). */
  readonly tokens: readonly string[];
  /** Palabra → posiciones en `groups`. */
  readonly byToken: ReadonlyMap<string, readonly number[]>;
}

const INDEXES = new WeakMap<Catalog, SearchIndex>();

/** Índice del buscador de un catálogo (se monta una vez y se reutiliza). */
export function searchIndex(catalog: Catalog): SearchIndex {
  const known = INDEXES.get(catalog);
  if (known) return known;
  const groups: SearchGroup[] = [];
  const byKey = new Map<string, SearchGroup>();
  const byToken = new Map<string, number[]>();
  /* Muchas entradas comparten grupo o categoría: se mira una vez cada uno. */
  const adultGroup = new Map<string, boolean>();
  const adultOf = (entry: CatalogEntry): boolean => {
    let group = adultGroup.get(entry.group);
    if (group === undefined) {
      group = isAdultChannel('', entry.group);
      adultGroup.set(entry.group, group);
    }
    return group || isAdultChannel(entry.title, '');
  };
  for (const key of catalog.groupKeys()) {
    const best = catalog
      .group(key)
      .find((entry) => defaultCountryOk(entry.country) && !adultOf(entry));
    if (!best) continue;
    const words = [...new Set(key.split(' ').filter(Boolean))];
    if (!words.length) continue;
    const index = groups.length;
    const group: SearchGroup = { key, best, words, compact: key.replace(/ /g, '') };
    groups.push(group);
    byKey.set(key, group);
    for (const word of words) {
      const list = byToken.get(word);
      if (list) list.push(index);
      else byToken.set(word, [index]);
    }
  }
  const index: SearchIndex = { groups, byKey, tokens: [...byToken.keys()].sort(), byToken };
  INDEXES.set(catalog, index);
  return index;
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

/* Grupos con alguna palabra que empieza por `word` (o la contiene, con 3 letras o más). */
function groupsForWord(index: SearchIndex, word: string): Set<number> {
  const out = new Set<number>();
  const add = (token: string): void => {
    for (const position of index.byToken.get(token) ?? []) out.add(position);
  };
  for (let i = lowerBound(index.tokens, word); i < index.tokens.length; i += 1) {
    const token = index.tokens[i] as string;
    if (!token.startsWith(word)) break;
    add(token);
  }
  if (word.length >= 3) {
    for (const token of index.tokens) {
      if (!token.startsWith(word) && token.includes(word)) add(token);
    }
  }
  return out;
}

/* ¿Salen las palabras de la consulta, como principio de palabra, en el mismo orden? */
function inOrder(words: readonly string[], group: SearchGroup): boolean {
  let from = 0;
  for (const word of words) {
    let found = -1;
    for (let i = from; i < group.words.length; i += 1) {
      if ((group.words[i] as string).startsWith(word)) {
        found = i;
        break;
      }
    }
    if (found < 0) return false;
    from = found + 1;
  }
  return true;
}

export interface CatalogSearchResult {
  /** La clave limpia de la consulta (vacía si no queda nada que buscar). */
  readonly key: string;
  /** Grupos que casan, hasta `IPTV_SEARCH.totalCap`. */
  readonly total: number;
  readonly capped: boolean;
  /** Los primeros `limit`, en orden. */
  readonly groups: readonly SearchGroup[];
}

/** Busca en el catálogo (§14.3, reglas 1 a 4). */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  limit: number = IPTV_SEARCH.limit,
): CatalogSearchResult {
  const key = cleanIptvTitle(query).key;
  if (!key) return { key, total: 0, capped: false, groups: [] };
  const index = searchIndex(catalog);
  const words = [...new Set(key.split(' ').filter(Boolean))];
  /* Cada palabra tiene que casar: se interseca empezando por la más escasa. */
  const sets = words.map((word) => groupsForWord(index, word)).sort((a, b) => a.size - b.size);
  const matched = new Set<number>();
  const [first, ...rest] = sets;
  if (first) {
    for (const position of first) {
      if (rest.every((set) => set.has(position))) matched.add(position);
    }
  }
  /* O la clave sin espacios contiene la consulta sin espacios («la sexta» → «lasexta»). */
  const compact = key.replace(/ /g, '');
  if (compact.length >= SEARCH_QUERY_MIN) {
    index.groups.forEach((group, position) => {
      if (group.compact.includes(compact)) matched.add(position);
    });
  }
  const rank = (group: SearchGroup): number => {
    if (group.key === key) return 0;
    if (group.key.startsWith(key)) return 1;
    if (inOrder(words, group)) return 2;
    return 3;
  };
  const ranked = [...matched]
    .map((position) => {
      const group = index.groups[position] as SearchGroup;
      return { group, rank: rank(group) };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.group.key.length - b.group.key.length ||
        a.group.best.order - b.group.best.order,
    );
  return {
    key,
    total: Math.min(ranked.length, IPTV_SEARCH.totalCap),
    capped: ranked.length > IPTV_SEARCH.totalCap,
    groups: ranked.slice(0, Math.max(0, limit)).map((item) => item.group),
  };
}

/** Lo que se mira de la biblioteca para `library` (§14.3, regla 5). */
export type LibraryCandidate = Pick<Item, 'id' | 'title' | 'category'>;

/**
 * ¿Casa la categoría con la consulta plegada? «IPTV» (la de los canales de tu
 * IPTV guardados desde el buscador) es una marca: solo con «ipt» o «iptv»,
 * no con «tv». Lo mismo que el filtro de la web (`categoryMatches`).
 */
function categoryMatches(category: string | undefined, q: string): boolean {
  if (category === 'IPTV') return q.length >= 3 && 'iptv'.startsWith(q);
  return foldText(category || '').includes(q);
}

/**
 * Elementos de la biblioteca que contienen la consulta en el título o la
 * categoría (lo que enseñan «En tu biblioteca» y el filtro de Canales), sin
 * repetir y 200 como mucho.
 */
export function libraryCandidates(
  items: readonly LibraryCandidate[],
  query: string,
): LibraryCandidate[] {
  const q = foldText(query);
  if (!q) return [];
  const seen = new Set<string>();
  const out: LibraryCandidate[] = [];
  for (const item of items) {
    if (out.length >= IPTV_SEARCH.libraryCandidatesMax) break;
    if (seen.has(item.id)) continue;
    if (!foldText(item.title).includes(q) && !categoryMatches(item.category, q)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Ids de la biblioteca que son ESTE canal (≥ 92), de mejor a peor, 20 como
 * mucho. Un id IPTV cuenta si es del mismo grupo (`groupOf`).
 */
export function libraryMatches(
  group: SearchGroup,
  items: readonly LibraryCandidate[],
  options: {
    readonly scorer: ChannelScorer;
    readonly isIptvId: (id: string) => boolean;
    readonly groupOf: (id: string) => string | null;
  },
): string[] {
  const base = group.best.base;
  const scored: { id: string; score: number }[] = [];
  for (const item of items) {
    if (options.isIptvId(item.id)) {
      if (options.groupOf(item.id) === group.key) scored.push({ id: item.id, score: 100 });
      continue;
    }
    const score = sameChannelScore(base, item.title, options.scorer);
    if (score >= IPTV_MIN_SCORE) scored.push({ id: item.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, IPTV_SEARCH.libraryMatchesMax)
    .map((item) => item.id);
}
