/* El buscador de la IPTV (docs/iptv.md §14.3 y §18). Puro: lo llama `iptv.search()`.

   1. Qué casa. La consulta pasa por la misma limpieza que un nombre IPTV
      (`cleanIptvTitle`) y por la grafía del buscador (`iptvSearchSpelling`:
      «m+ la liga», «m. laliga» y «mov laliga» son «movistar laliga»; SIN los
      alias curados del emparejado, que añadían palabras) y se trocea en
      palabras. Un grupo del catálogo casa por su NOMBRE, sin Movistar
      delante o por su CATEGORÍA (detalle en `searchCatalog`). Se busca en un
      índice de palabras propio (todas las palabras de cada clave, también
      «la» o «1», que la preselección de §3.4 no guarda) y otro de
      categorías: nada recorre las 100 000 entradas.
   2. Sale TODO (Isma, 26-sep: «déjalo todo desbloqueado»; D25 y §17): los
      canales de cualquier país y también los grupos para adultos.
   3. Una fila por CANAL (§17): las variantes de resolución («DAZN 1 FHD»,
      «DAZN 1 HD», «ES: DAZN 1 1080p», «DAZN 1 (backup)»…) son una fila, con
      sus calidades. España y sin país son un canal; cada otro país, otro
      («DE: DAZN 1» es otra fila, con su país).
   4. Orden por parecido (§18): igual → misma familia → empieza por la
      consulta → mismo orden → el resto → sin Movistar → por la categoría;
      dentro, España o sin país, el canal principal antes que bar, PPV,
      reservas, plataformas y eventos, la clave más corta y el orden del
      catálogo.
   5. `library`: los elementos de tu biblioteca que son ese canal
      (`sameChannelScore` ≥ 92), de mejor a peor, 20 como mucho.

   El índice se monta una vez por catálogo (WeakMap) y se tira con él. */

import {
  IPTV_MIN_SCORE,
  IPTV_SEARCH,
  MOVISTAR_WORDS,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  normalizeChannelKey,
  type Item,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { channelIdOf, type Catalog, type CatalogEntry } from './catalog.js';
import { sameChannelScore, type ChannelScorer } from './match.js';
import {
  cleanIptvTitle,
  countryBucket,
  iptvPlatform,
  iptvSearchSpelling,
  isEventTitle,
} from './names.js';

/** El país de un título cualquiera, como el de un canal IPTV: '' para España o sin país (§17). */
export function titleBucket(title: string): string {
  return countryBucket(cleanIptvTitle(title).country);
}

/** Minúsculas y sin tildes (lo mismo que el filtro de la web, `foldText`). */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
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

/** Un canal del buscador: un grupo de variantes de un país (España y sin país son uno). */
export interface SearchGroup {
  readonly key: string;
  /** '' para España o sin país; si no, el código del país. */
  readonly bucket: string;
  /** `channelIdOf`: clave y país. */
  readonly channel: string;
  /** Sus variantes, de mejor a peor por el nombre (la calidad del stream real se aplica al pintar la fila). */
  readonly entries: readonly CatalogEntry[];
  /** La primera variante por el nombre (nombre limpio y orden del catálogo). */
  readonly best: CatalogEntry;
  readonly words: readonly string[];
  /** La clave sin espacios («lasexta»). */
  readonly compact: string;
}

/** Lo que el índice sabe de cada canal para ordenar (docs/iptv.md §18). */
interface GroupFacts {
  /** Palabras que cuentan (sin «tv», «canal», «channel»). */
  readonly sig: string;
  /** `sig` sin el número del final («movistar laliga 1» → «movistar laliga»). */
  readonly family: string;
  /** `family` sin la marca de delante si queda algo con letras («dazn laliga» → «laliga»). */
  readonly core: string;
  /** 0 España o sin país; 1 América en español; 2 el resto. */
  readonly countryRank: number;
  /** 0 normal; 1 bar, PPV, replay, resúmenes o solo reservas (ᴿᴬᵂ); 2 plataforma; 3 evento con horario. */
  readonly penalty: number;
  /** El orden del catálogo del primero de su nombre (los del mismo nombre, juntos). */
  readonly keyOrder: number;
  /** El número del final («M. LALIGA 3» → 3; sin número, 0): la familia va en orden numérico. */
  readonly number: number;
}

interface CategoryInfo {
  /** Palabras del tema de la categoría, con sus sinónimos ya en la forma única. */
  readonly words: readonly string[];
  /** Posiciones en `groups` de los canales con alguna variante en esta categoría. */
  readonly groups: number[];
}

interface SearchIndex {
  readonly groups: readonly SearchGroup[];
  readonly facts: readonly GroupFacts[];
  /** Familia (`GroupFacts.family`) → orden del catálogo de su primer canal: la familia sale junta. */
  readonly familyOrder: ReadonlyMap<string, number>;
  /** Clave → sus canales (primero el de España o sin país). */
  readonly byKey: ReadonlyMap<string, readonly SearchGroup[]>;
  /** `channelIdOf` → canal. */
  readonly byChannel: ReadonlyMap<string, SearchGroup>;
  /** Palabras distintas de todas las claves, ordenadas (búsqueda por prefijo). */
  readonly tokens: readonly string[];
  /** Palabra → posiciones en `groups`. */
  readonly byToken: ReadonlyMap<string, readonly number[]>;
  /** Categoría del proveedor (tal cual) → sus palabras y sus canales. */
  readonly categories: ReadonlyMap<string, CategoryInfo>;
}

/** Palabras que no hace falta encontrar: «m+ laliga tv» es «M. LALIGA 1» aunque la lista no diga «tv». */
const OPTIONAL_WORDS: ReadonlySet<string> = new Set([
  'tv',
  'canal',
  'canales',
  'channel',
  'channels',
]);
/** La marca de delante que se quita para comparar la familia («dazn laliga» y «movistar laliga» → «laliga»). */
const BRAND_WORDS: ReadonlySet<string> = new Set(['movistar', 'dazn', 'm']);
/** Palabras de un canal que no es el principal: van detrás de él. */
const SECONDARY_WORDS: ReadonlySet<string> = new Set([
  'bar',
  'ppv',
  'replay',
  'replays',
  'highlights',
  'resumen',
  'resumenes',
  'evento',
  'eventos',
  'event',
  'events',
]);
/** Países de América en español (van detrás de España y antes que el resto). */
const SPANISH_AMERICA: ReadonlySet<string> = new Set([
  'LAT',
  'LATAM',
  'LATINO',
  'MX',
  'MEX',
  'ARG',
  'CO',
  'COL',
  'CL',
  'CHI',
  'PE',
  'PER',
  'VE',
  'UY',
  'EC',
  'BO',
  'PY',
  'CR',
  'GT',
  'HN',
  'SV',
  'NI',
  'PA',
  'DO',
  'PR',
  'CU',
]);
/*
 * Compuestos que una palabra de la consulta puede encontrar por dentro
 * («liga» en «laliga», «sexta» en «lasexta»). Fuera de estos, dentro de una
 * palabra solo casa con 5 letras o más («nba» ya no casa con «dazn
 * baloncesto»).
 */
const COMPOUND_PARTS: Readonly<Record<string, readonly string[]>> = {
  laliga: ['liga'],
  lasexta: ['sexta'],
  telecinco: ['cinco'],
  teledeporte: ['deporte'],
  telemadrid: ['madrid'],
  motogp: ['gp'],
  onetoro: ['toro'],
  bemad: ['mad'],
};
/** Lo que va delante del tema en una categoría «EU | ES | TDT»: continente y país. */
const CATEGORY_CONTINENTS: ReadonlySet<string> = new Set(['EU', 'AM', 'AS', 'AF', 'OC', 'LATAM']);

/**
 * Sinónimos para buscar por CATEGORÍA (docs/iptv.md §18), en la forma única
 * de la izquierda. Se aplican a las palabras de la categoría y a las de la
 * consulta: «futbol» encuentra «TV FOOTBALL PPV», «infantil» encuentra
 * «NIÑOS» y «deportes» encuentra «SPORTS». Tabla de datos, con pruebas.
 */
export const IPTV_CATEGORY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  futbol: ['futbol', 'football', 'soccer', 'futebol', 'calcio'],
  deportes: ['deportes', 'deporte', 'sports', 'sport', 'esportes', 'desportos'],
  infantil: ['infantil', 'infantiles', 'ninos', 'nino', 'kids', 'kid', 'children', 'dibujos'],
  cine: ['cine', 'peliculas', 'pelicula', 'movies', 'movie', 'cinema', 'films', 'film'],
  documental: ['documental', 'documentales', 'docu', 'documentary', 'documentaries'],
  tenis: ['tenis', 'tennis'],
  noticias: ['noticias', 'news', 'informativos'],
  ciclismo: ['ciclismo', 'cycling', 'bike', 'bikes'],
  baloncesto: ['baloncesto', 'basket', 'basketball'],
  musica: ['musica', 'music', 'musicales'],
  series: ['series', 'serie'],
  entretenimiento: ['entretenimiento', 'entertainment', 'general', 'generalistas'],
};

const SYNONYM_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(IPTV_CATEGORY_SYNONYMS).flatMap(([canon, words]) =>
    words.map((word) => [word, canon] as const),
  ),
);

/** Una palabra de categoría (o de la consulta para buscar categorías) en su forma única. */
export function categoryWord(word: string): string {
  return SYNONYM_OF.get(word) ?? word;
}

/**
 * Las palabras del TEMA de una categoría del proveedor, para buscarla: sin
 * continente ni país («EU | ES | TDT ESPAÑA VIP» → «tdt espana vip»),
 * espacio en vez de NBSP, «&» y «+» separan, y con los sinónimos en su
 * forma única («EU | ES | TV FOOTBALL PPV» → «futbol ppv»).
 */
export function categorySearchWords(group: string): string[] {
  const parts = String(group ?? '')
    .replace(/\u00a0/g, ' ')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  let rest = parts;
  if (rest.length >= 2 && CATEGORY_CONTINENTS.has((rest[0] as string).toUpperCase())) {
    rest = rest.slice(2);
  } else if (rest.length >= 2 && /^[A-Z]{2,4}$/.test(rest[0] as string)) {
    rest = rest.slice(1);
  }
  const words = normalizeChannelKey(iptvSearchSpelling(rest.join(' ').replace(/[&+]/g, ' ')))
    .split(' ')
    .filter((word) => word && !OPTIONAL_WORDS.has(word));
  return [...new Set(words.map(categoryWord))];
}

const INDEXES = new WeakMap<Catalog, SearchIndex>();

/** Las palabras que hay que encontrar: sin «tv», «canal» ni «channel» si hay otras (también la pestaña IPTV, §16.3). */
export function significant(words: readonly string[]): string[] {
  const out = words.filter((word) => !OPTIONAL_WORDS.has(word));
  return out.length ? out : [...words];
}

function familyOf(sig: readonly string[]): string[] {
  return sig.length > 1 && /^\d+$/.test(sig[sig.length - 1] as string)
    ? sig.slice(0, -1)
    : [...sig];
}

function coreOf(family: readonly string[]): string[] {
  if (family.length > 1 && BRAND_WORDS.has(family[0] as string)) {
    const rest = family.slice(1);
    if (rest.some((word) => /[a-z]/.test(word))) return rest;
  }
  return [...family];
}

function countryRankOf(bucket: string): number {
  if (!bucket) return 0;
  return SPANISH_AMERICA.has(bucket) ? 1 : 2;
}

function penaltyOf(group: SearchGroup): number {
  const { best } = group;
  if (isEventTitle(best.title)) return 3;
  if (group.entries.every((entry) => iptvPlatform(entry.title, entry.group))) return 2;
  if (group.words.some((word) => SECONDARY_WORDS.has(word))) return 1;
  if (group.entries.every((entry) => entry.backup)) return 1;
  return 0;
}

/** Índice del buscador de un catálogo (se monta una vez y se reutiliza). */
export function searchIndex(catalog: Catalog): SearchIndex {
  const known = INDEXES.get(catalog);
  if (known) return known;
  const groups: SearchGroup[] = [];
  const facts: GroupFacts[] = [];
  const byKey = new Map<string, SearchGroup[]>();
  const byChannel = new Map<string, SearchGroup>();
  const byToken = new Map<string, number[]>();
  const categories = new Map<string, CategoryInfo>();
  const familyOrder = new Map<string, number>();
  for (const key of catalog.groupKeys()) {
    const words = [...new Set(key.split(' ').filter(Boolean))];
    if (!words.length) continue;
    const compact = key.replace(/ /g, '');
    const channels: SearchGroup[] = [];
    const keyOrder = catalog
      .group(key)
      .reduce((min, entry) => Math.min(min, entry.order), Number.POSITIVE_INFINITY);
    const sig = significant(key.split(' ').filter(Boolean));
    const family = familyOf(sig);
    const familyKey = family.join(' ');
    const trailing = sig.length > family.length ? Number(sig[sig.length - 1]) : 0;
    familyOrder.set(familyKey, Math.min(familyOrder.get(familyKey) ?? keyOrder, keyOrder));
    for (const { bucket, entries } of catalog.buckets(key)) {
      const best = entries[0];
      if (!best) continue;
      const index = groups.length;
      const group: SearchGroup = {
        key,
        bucket,
        channel: channelIdOf(best),
        entries,
        best,
        words,
        compact,
      };
      groups.push(group);
      facts.push({
        sig: sig.join(' '),
        family: familyKey,
        core: coreOf(family).join(' '),
        countryRank: countryRankOf(bucket),
        penalty: penaltyOf(group),
        keyOrder,
        number: Number.isFinite(trailing) ? trailing : 0,
      });
      channels.push(group);
      byChannel.set(group.channel, group);
      for (const word of words) {
        const list = byToken.get(word);
        if (list) list.push(index);
        else byToken.set(word, [index]);
      }
      const seenCategories = new Set<string>();
      for (const entry of entries) {
        if (seenCategories.has(entry.group)) continue;
        seenCategories.add(entry.group);
        let info = categories.get(entry.group);
        if (!info) {
          info = { words: categorySearchWords(entry.group), groups: [] };
          categories.set(entry.group, info);
        }
        info.groups.push(index);
      }
    }
    if (channels.length) byKey.set(key, channels);
  }
  const index: SearchIndex = {
    groups,
    facts,
    familyOrder,
    byKey,
    byChannel,
    tokens: [...byToken.keys()].sort(),
    byToken,
    categories,
  };
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

const NUMBER_RE = /^\d+$/;

/* ¿Casa la palabra de la consulta por DENTRO de esta palabra? Solo en compuestos conocidos o con 5 letras o más. */
function insideMatch(token: string, word: string): boolean {
  if (token.startsWith(word) || !token.includes(word)) return false;
  if (word.length >= 5) return true;
  return (COMPOUND_PARTS[token] ?? []).some((part) => part.startsWith(word));
}

/*
 * Cómo casa una palabra con una palabra del canal: 2 exacta o por el
 * principio, 1 por dentro, 0 no casa. Un número solo casa entero («1» no es
 * «10»).
 */
function wordMatch(token: string, word: string): number {
  if (NUMBER_RE.test(word)) return token === word ? 2 : 0;
  if (token.startsWith(word)) return 2;
  return insideMatch(token, word) ? 1 : 0;
}

/* Grupos con alguna palabra que casa con `word`. */
function groupsForWord(index: SearchIndex, word: string): Set<number> {
  const out = new Set<number>();
  const add = (token: string): void => {
    for (const position of index.byToken.get(token) ?? []) out.add(position);
  };
  if (NUMBER_RE.test(word)) {
    add(word);
    return out;
  }
  for (let i = lowerBound(index.tokens, word); i < index.tokens.length; i += 1) {
    const token = index.tokens[i] as string;
    if (!token.startsWith(word)) break;
    add(token);
  }
  if (word.length >= 2) {
    for (const token of index.tokens) if (insideMatch(token, word)) add(token);
  }
  return out;
}

function intersect(sets: readonly Set<number>[]): Set<number> {
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  const [first, ...rest] = sorted;
  const out = new Set<number>();
  if (!first) return out;
  for (const position of first) if (rest.every((set) => set.has(position))) out.add(position);
  return out;
}

/*
 * Nivel de un canal que casa por el nombre (docs/iptv.md §18): 0 igual; 1
 * misma familia (sin el número del final o sin la marca de delante: «m+
 * laliga» → «M. LALIGA 3», «laliga» → «DAZN LaLiga»); 2 empieza por la
 * consulta; 3 las palabras en el mismo orden; 4 en cualquier orden o por
 * dentro de una palabra.
 */
function nameTier(query: QueryWords, group: SearchGroup, fact: GroupFacts): number {
  if (fact.sig === query.sig) return 0;
  if (fact.family === query.sig || fact.core === query.sig || fact.core === query.core) return 1;
  let from = 0;
  let ordered = true;
  let inside = false;
  for (const word of query.required) {
    let found = -1;
    for (let i = from; i < group.words.length; i += 1) {
      const how = wordMatch(group.words[i] as string, word);
      if (how) {
        found = i;
        if (how === 1) inside = true;
        break;
      }
    }
    if (found < 0) {
      ordered = false;
      break;
    }
    from = found + 1;
  }
  if (!ordered || inside) return 4;
  return fact.sig.startsWith(query.sig) ? 2 : 3;
}

interface QueryWords {
  /** Palabras que tienen que casar (sin «tv», «canal» ni «channel» si hay otras). */
  readonly required: readonly string[];
  readonly sig: string;
  readonly core: string;
  readonly compact: string;
}

/** La consulta limpia para el buscador: sin país, calidad ni reserva, con `iptvSearchSpelling`. */
export function searchQueryKey(query: string): string {
  const clean = cleanIptvTitle(query);
  return normalizeChannelKey(iptvSearchSpelling(clean.display));
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

/**
 * Busca en el catálogo (docs/iptv.md §14.3 y §18):
 * 1. Por el NOMBRE: cada palabra de la consulta (menos «tv», «canal» y
 *    «channel», que no hace falta encontrar) casa con el principio de una
 *    palabra de la clave, en cualquier orden; un número, solo entero; por
 *    dentro de una palabra, solo en compuestos («liga» en «laliga») o con 5
 *    letras o más. También vale la consulta pegada a partir de un principio
 *    de palabra («antena3», «la1»).
 * 2. Sin la marca: «movistar vamos» o «m+ vamos» encuentran «#VAMOS» (detrás
 *    de los que sí llevan la marca).
 * 3. Por la CATEGORÍA: «tdt» trae los canales de «EU | ES | TDT ESPAÑA
 *    VIP», con sinónimos («futbol» → «TV FOOTBALL»), detrás de los que casan
 *    por el nombre.
 * Orden: nivel (igual, familia, empieza, mismo orden, cualquier orden, sin
 * marca, categoría); dentro, España o sin país, luego América en español y
 * luego el resto; el canal principal antes que bar, PPV, replay, reservas
 * ᴿᴬᵂ, plataformas y eventos; la clave más corta (en la categoría, el orden
 * del catálogo); y el orden del catálogo.
 */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  limit: number = IPTV_SEARCH.limit,
): CatalogSearchResult {
  const key = searchQueryKey(query);
  if (!key) return { key, total: 0, capped: false, groups: [] };
  const index = searchIndex(catalog);
  const words = [...new Set(key.split(' ').filter(Boolean))];
  const required = significant(words);
  const sig = significant(key.split(' ').filter(Boolean));
  const q: QueryWords = {
    required,
    sig: sig.join(' '),
    core: coreOf(familyOf(sig)).join(' '),
    compact: key.replace(/ /g, ''),
  };
  const tiers = new Map<number, number>();
  const put = (position: number, tier: number): void => {
    const current = tiers.get(position);
    if (current === undefined || tier < current) tiers.set(position, tier);
  };

  /* 1. Por el nombre. */
  const byWord = new Map(required.map((word) => [word, groupsForWord(index, word)] as const));
  for (const position of intersect([...byWord.values()])) {
    put(
      position,
      nameTier(q, index.groups[position] as SearchGroup, index.facts[position] as GroupFacts),
    );
  }
  /* La consulta pegada, desde el principio de una palabra: «antena3» → «ANTENA 3», «la1» → «LA 1». */
  if (q.compact.length >= 3) {
    index.groups.forEach((group, position) => {
      if (tiers.has(position) || !group.compact.includes(q.compact)) return;
      if (group.compact === q.compact) {
        put(position, 0);
        return;
      }
      for (let i = 0; i < group.words.length; i += 1) {
        if (group.words.slice(i).join('').startsWith(q.compact)) {
          put(position, 4);
          return;
        }
      }
    });
  }
  /* 2. Sin Movistar delante («movistar vamos» → «#VAMOS»): las listas no siempre lo escriben. */
  const brandless = required.filter((word) => !MOVISTAR_WORDS.has(word));
  if (
    brandless.length < required.length &&
    brandless.some((word) => word.length >= 3 && !NUMBER_RE.test(word))
  ) {
    for (const position of intersect(brandless.map((word) => byWord.get(word) as Set<number>))) {
      put(position, 5);
    }
  }
  /* 3. Por la categoría. */
  const categoryWords = required.map(categoryWord);
  for (const info of index.categories.values()) {
    const matches = categoryWords.every((word) =>
      info.words.some((token) =>
        NUMBER_RE.test(word) ? token === word : token.startsWith(word) && word.length >= 2,
      ),
    );
    if (!matches) continue;
    for (const position of info.groups) put(position, 6);
  }

  const familyOrderOf = (fact: GroupFacts): number =>
    index.familyOrder.get(fact.family) ?? fact.keyOrder;
  const ranked = [...tiers]
    .map(([position, tier]) => ({
      group: index.groups[position] as SearchGroup,
      fact: index.facts[position] as GroupFacts,
      tier,
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.fact.countryRank - b.fact.countryRank ||
        a.fact.penalty - b.fact.penalty ||
        (a.tier === 6 ? 0 : a.fact.family.length - b.fact.family.length) ||
        familyOrderOf(a.fact) - familyOrderOf(b.fact) ||
        a.fact.number - b.fact.number ||
        a.group.key.length - b.group.key.length ||
        a.fact.keyOrder - b.fact.keyOrder ||
        Number(a.group.bucket !== '') - Number(b.group.bucket !== '') ||
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
 * mucho. Un id IPTV cuenta si es del mismo canal (`channelOf`: mismo grupo y
 * mismo país). Un título de otro país («DE: DAZN 1») solo es un canal de otro
 * país, y uno sin país o de España, uno de España o sin país.
 */
export function libraryMatches(
  group: SearchGroup,
  items: readonly LibraryCandidate[],
  options: {
    readonly scorer: ChannelScorer;
    readonly isIptvId: (id: string) => boolean;
    readonly channelOf: (id: string) => string | null;
  },
): string[] {
  const base = group.best.base;
  const scored: { id: string; score: number }[] = [];
  for (const item of items) {
    if (options.isIptvId(item.id)) {
      if (options.channelOf(item.id) === group.channel) scored.push({ id: item.id, score: 100 });
      continue;
    }
    if (titleBucket(item.title) !== group.bucket) continue;
    const score = sameChannelScore(base, item.title, options.scorer);
    if (score >= IPTV_MIN_SCORE) scored.push({ id: item.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, IPTV_SEARCH.libraryMatchesMax)
    .map((item) => item.id);
}
