/* El buscador de la IPTV (docs/iptv.md §14.3, §18 y, desde la 0.9.0,
   docs/buscador.md). Puro: lo llama `iptv.search()`; la pestaña IPTV de
   Canales (browse.ts) ordena igual con `compareRankedHits`.

   1. Qué casa. Lo escrito y los nombres pasan por el módulo común de buscar
      por nombre (`@ace/shared`, name-search.ts): las mismas palabras (sin
      país, calidad ni adornos; «m+ la liga» = «movistar laliga»; «tele 5»
      = «telecinco»; «la uno» = «la 1»), el mismo nivel de parecido
      (`nameTier`: igual, familia, empieza por, palabras enteras, en otro
      orden, por dentro, sin la marca) y el mismo orden
      (`compareNameRank`). Un grupo del catálogo casa por su NOMBRE (su clave
      y los nombres que la apuntan en `IPTV_CHANNEL_ALIASES`: «TVG» es «TV
      GALICIA») o por su CATEGORÍA (nivel 7, detrás). Se buscan candidatos
      en un índice de palabras propio (todas las palabras de cada clave,
      también «la» o «1», que la preselección de §3.4 no guarda) y otro de
      categorías: nada recorre las 100 000 entradas.
   2. Sale TODO (Isma, 26-sep: «déjalo todo desbloqueado»; D25 y §17): los
      canales de cualquier país y también los grupos para adultos.
   3. Una fila por CANAL (§17): las variantes de resolución («DAZN 1 FHD»,
      «DAZN 1 HD», «ES: DAZN 1 1080p», «DAZN 1 (backup)»…) son una fila, con
      sus calidades. España y sin país son un canal; cada otro país, otro
      («DE: DAZN 1» es otra fila, con su país).
   4. Orden (`compareRankedHits`): lo flojo (en otro orden, por dentro, sin
      la marca o por la categoría) detrás de todo; dentro, el país pedido,
      España o sin país, América en español y el resto; lo que casa por un
      alias; lo igual; tus favoritos; el nivel; el canal principal antes que
      bar, PPV, reservas, plataformas y eventos; la familia que tiene la
      palabra de relleno escrita («laliga tv» → «M+ LaLiga TV»); la familia
      más corta y junta; el número del final; la mejor calidad; la clave más
      corta y el orden del catálogo.
   5. Alias de la consulta (Champions, TVE, A3, TDP): en el módulo común.
   6. `library`: los elementos de tu biblioteca que son ese canal
      (`sameChannelScore` ≥ 92), de mejor a peor, 20 como mucho.

   El índice se monta una vez por catálogo (WeakMap) y se tira con él; el
   servicio lo precalienta a trozos tras la sincronización
   (`searchIndexStepper`), y si alguien busca antes se termina en ese momento. */

import {
  CHANNEL_SEARCH_KEY_MIN,
  IPTV_MIN_SCORE,
  IPTV_SEARCH,
  MOVISTAR_WORDS,
  NAME_TIER,
  OPTIONAL_SEARCH_WORDS,
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  channelSearchKey,
  compareNameRank,
  keySearchWords,
  nameFacts,
  nameQueryAliases,
  nameSearchWords,
  nameTier,
  nameTierWithAliases,
  normalizeChannelKey,
  parseNameQuery,
  regionRank,
  significantWords,
  wordMatch,
  type Item,
  type NameFacts,
  type NameQuery,
  type NameQueryWords,
  type NameRank,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { channelIdOf, type Catalog, type CatalogEntry } from './catalog.js';
import { sameChannelScore, type ChannelScorer } from './match.js';
import {
  IPTV_CHANNEL_ALIASES,
  cleanIptvTitle,
  countryBucket,
  iptvSearchSpelling,
  isEventTitle,
  qualityHeightRank,
} from './names.js';

/** El país de un título cualquiera, como el de un canal IPTV: '' para España o sin país (§17). */
export function titleBucket(title: string): string {
  return countryBucket(cleanIptvTitle(title).country);
}

/** Minúsculas y sin tildes (lo mismo que el filtro de la web, `foldText`). */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
  /** Las palabras de su clave para buscar (`nameSearchWords`). */
  readonly words: readonly string[];
  /** La clave sin espacios («lasexta»). */
  readonly compact: string;
}

/** Lo que el índice sabe de cada canal para ordenar (docs/iptv.md §18 y docs/buscador.md). */
export interface GroupFacts {
  /** La familia del canal por su clave («movistar laliga 1» → «movistar laliga»). */
  readonly family: string;
  /** 0 normal; 1 bar, PPV, replay, resúmenes o solo reservas (ᴿᴬᵂ); 2 plataforma; 3 evento con horario. */
  readonly penalty: number;
  /** El orden del catálogo del primero de su nombre (los del mismo nombre, juntos). */
  readonly keyOrder: number;
  /** El número del final («M. LALIGA 3» → 3; sin número, 0): la familia va en orden numérico. */
  readonly number: number;
  /** La mejor calidad por el nombre de sus variantes (`qualityScore`), para desempatar. */
  readonly quality: number;
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
  /** Familia → todas las palabras de sus claves, también «tv» o «canal» (para `literalMiss`). */
  readonly familyWords: ReadonlyMap<string, ReadonlySet<string>>;
  /** Clave → sus canales (primero el de España o sin país). */
  readonly byKey: ReadonlyMap<string, readonly SearchGroup[]>;
  /** `channelIdOf` → canal. */
  readonly byChannel: ReadonlyMap<string, SearchGroup>;
  /** Palabras distintas de todos los nombres, ordenadas (búsqueda por prefijo). */
  readonly tokens: readonly string[];
  /** Palabra → posiciones en `groups`. */
  readonly byToken: ReadonlyMap<string, readonly number[]>;
  /** Categoría del proveedor (tal cual) → sus palabras y sus canales. */
  readonly categories: ReadonlyMap<string, CategoryInfo>;
  /**
   * Los nombres de cada clave (`keyNames`), calculados al hacer falta: guardarlos todos costaría ~50 MB con
   * 100 000 canales; se calculan solo los de los candidatos (3-4 µs cada uno) y se guardan hasta 20 000.
   */
  readonly names: Map<string, readonly NameFacts[]>;
}

/** Cuántos nombres calculados guarda un índice antes de empezar de cero. */
export const NAME_CACHE_MAX = 20_000;

/** Los nombres de una clave, de la caché de un índice (o calculados y guardados). */
export function cachedKeyNames(
  cache: Map<string, readonly NameFacts[]>,
  key: string,
): readonly NameFacts[] {
  const known = cache.get(key);
  if (known) return known;
  if (cache.size >= NAME_CACHE_MAX) cache.clear();
  const names = keyNames(key);
  cache.set(key, names);
  return names;
}

/** Desde la 0.9.0, por la categoría es el nivel 7 (detrás de los del nombre, que llegan a 6). */
export const CATEGORY_TIER = 7;

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
    .filter((word) => word && !OPTIONAL_SEARCH_WORDS.has(word));
  return [...new Set(words.map(categoryWord))];
}

const INDEXES = new WeakMap<Catalog, SearchIndex>();
/** Montajes a medias del precalentado (`searchIndexStepper`). */
const BUILDING = new WeakMap<Catalog, Generator<void, SearchIndex, void>>();

/** Las palabras que hay que encontrar: sin «tv», «canal» ni «channel» si hay otras (también la pestaña IPTV, §16.3). */
export function significant(words: readonly string[]): string[] {
  return significantWords(words);
}

/* Los nombres que apuntan a cada clave en los alias del emparejado: «tv galicia» ← «tvg». */
const ALIAS_NAMES: ReadonlyMap<string, readonly string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const [from, to] of Object.entries(IPTV_CHANNEL_ALIASES)) {
    const key = normalizeChannelKey(iptvSearchSpelling(to));
    const list = out.get(key) ?? [];
    list.push(from);
    out.set(key, list);
  }
  return out;
})();

/**
 * Los nombres con los que se busca una clave del catálogo: la propia clave y,
 * si la apuntan alias del emparejado, esos nombres («TV GALICIA» también es
 * «tvg»). Los dos índices (buscador y pestaña IPTV) los calculan igual.
 */
export function keyNames(key: string): NameFacts[] {
  const words = keySearchWords(key);
  const names = [nameFacts(words.length ? words : key.split(' ').filter(Boolean))];
  for (const alias of ALIAS_NAMES.get(key) ?? []) {
    const aliasWords = nameSearchWords(alias);
    if (aliasWords.length && aliasWords.join(' ') !== names[0]?.words.join(' '))
      names.push(nameFacts(aliasWords));
  }
  return names;
}

/** 0 normal; 1 bar, PPV, replay, resúmenes o solo reservas; 2 plataforma; 3 evento con horario. */
export function entriesPenalty(
  best: CatalogEntry,
  entries: readonly CatalogEntry[],
  words: readonly string[],
  catalog: Pick<Catalog, 'inPlatformGroup'>,
): number {
  if (best.title.includes(':') && isEventTitle(best.title)) return 3;
  /* En el buscador, detrás todo lo de una categoría de plataforma, también la que mezcla canales de la TDT
     («LA LIGA 1» de «RAKUTEN TV» detrás de «DAZN LaLiga» y «M. LALIGA»); se encuentra igual («tvg 2»). */
  if (entries.every((entry) => catalog.inPlatformGroup(entry))) return 2;
  if (words.some((word) => SECONDARY_WORDS.has(word))) return 1;
  if (entries.every((entry) => entry.backup)) return 1;
  return 0;
}

/** La mejor calidad por el nombre de unas variantes (`qualityScore`). */
function bestQuality(entries: readonly CatalogEntry[]): number {
  let best = 0;
  for (const entry of entries) best = Math.max(best, qualityHeightRank(entry.quality));
  return best;
}

/** Índice del buscador de un catálogo (se monta una vez y se reutiliza; si se estaba precalentando, se termina). */
export function searchIndex(catalog: Catalog): SearchIndex {
  const known = INDEXES.get(catalog);
  if (known) return known;
  const steps = BUILDING.get(catalog) ?? buildSearchIndexSteps(catalog, Number.POSITIVE_INFINITY);
  let next: IteratorResult<void, SearchIndex>;
  try {
    do next = steps.next();
    while (!next.done);
  } finally {
    /* Si el montaje falla, el generador queda cerrado: la próxima vez se empieza de cero. */
    BUILDING.delete(catalog);
  }
  INDEXES.set(catalog, next.value);
  return next.value;
}

/** ¿Está ya montado el índice del buscador de este catálogo? (para las pruebas del precalentado). */
export function searchIndexReady(catalog: Catalog): boolean {
  return INDEXES.has(catalog);
}

/**
 * Precalienta el índice a trozos (docs/diagnostico-iptv-0.8.2.md, E4): cada
 * llamada monta `chunk` claves más y devuelve `true` cuando el índice ya está
 * listo. El servicio cede el hilo con `setImmediate` entre llamada y llamada;
 * una búsqueda que llega a medias termina el mismo montaje (`searchIndex`).
 */
export function searchIndexStepper(catalog: Catalog, chunk: number): () => boolean {
  return () => {
    if (INDEXES.has(catalog)) return true;
    let steps = BUILDING.get(catalog);
    if (!steps) {
      steps = buildSearchIndexSteps(catalog, chunk);
      BUILDING.set(catalog, steps);
    }
    let next: IteratorResult<void, SearchIndex>;
    try {
      next = steps.next();
    } catch (error) {
      BUILDING.delete(catalog);
      throw error;
    }
    if (!next.done) return false;
    BUILDING.delete(catalog);
    INDEXES.set(catalog, next.value);
    return true;
  };
}

/**
 * Monta el índice del buscador a trozos: cada `yield` (cada `chunk` claves)
 * es un punto en el que se puede ceder el hilo. Pura: no guarda nada; con
 * `chunk` infinito es el montaje de una vez.
 */
export function* buildSearchIndexSteps(
  catalog: Catalog,
  chunk: number,
): Generator<void, SearchIndex, void> {
  const groups: SearchGroup[] = [];
  const facts: GroupFacts[] = [];
  const byKey = new Map<string, SearchGroup[]>();
  const byChannel = new Map<string, SearchGroup>();
  const byToken = new Map<string, number[]>();
  const categories = new Map<string, CategoryInfo>();
  const familyOrder = new Map<string, number>();
  const familyWords = new Map<string, Set<string>>();
  let done = 0;
  for (const key of catalog.groupKeys()) {
    done += 1;
    if (done % chunk === 0) yield;
    /* Los nombres se calculan aquí para las palabras del índice, pero no se guardan (`SearchIndex.names`). */
    const names = keyNames(key);
    const main = names[0] as NameFacts;
    if (!main.words.length) continue;
    const words = main.words;
    const tokens = new Set(names.flatMap((name) => name.words));
    const keyOrder = catalog
      .group(key)
      .reduce((min, entry) => Math.min(min, entry.order), Number.POSITIVE_INFINITY);
    familyOrder.set(main.family, Math.min(familyOrder.get(main.family) ?? keyOrder, keyOrder));
    const known = familyWords.get(main.family);
    const keyWords = key.split(' ').filter(Boolean);
    if (known) for (const word of keyWords) known.add(word);
    else familyWords.set(main.family, new Set(keyWords));
    const channels: SearchGroup[] = [];
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
        compact: main.compact,
      };
      groups.push(group);
      facts.push({
        family: main.family,
        penalty: entriesPenalty(best, entries, words, catalog),
        keyOrder,
        number: main.number,
        quality: bestQuality(entries),
      });
      channels.push(group);
      byChannel.set(group.channel, group);
      for (const word of tokens) {
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
  return {
    groups,
    facts,
    familyOrder,
    familyWords,
    byKey,
    byChannel,
    tokens: [...byToken.keys()].sort(),
    byToken,
    categories,
    names: new Map(),
  };
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

/** Un índice de palabras: las palabras ordenadas y, de cada una, dónde está. */
export interface TokenIndex<T> {
  readonly tokens: readonly string[];
  readonly byToken: ReadonlyMap<string, T>;
}

/**
 * Las palabras del índice que casan con una palabra escrita (`wordMatch`):
 * igual o por el principio (un número, solo entero o seguido de letras:
 * «1» no es «10», sí «24» de «24h») y, con `inside`, por dentro (compuestos o
 * 4 letras o más). La comparten el buscador y la pestaña IPTV.
 */
export function tokensForWord<T>(index: TokenIndex<T>, word: string, inside = true): string[] {
  const out: string[] = [];
  for (let i = lowerBound(index.tokens, word); i < index.tokens.length; i += 1) {
    const token = index.tokens[i] as string;
    if (!token.startsWith(word)) break;
    if (wordMatch(token, word) >= 2) out.push(token);
  }
  if (inside && word.length >= 2 && !/^\d+$/.test(word)) {
    for (const token of index.tokens) if (wordMatch(token, word) === 1) out.push(token);
  }
  return out;
}

/* Grupos con alguna palabra que casa con `word`. */
function groupsForWord(index: SearchIndex, word: string, inside = true): Set<number> {
  const out = new Set<number>();
  for (const token of tokensForWord(index, word, inside)) {
    for (const position of index.byToken.get(token) ?? []) out.add(position);
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

/**
 * Un alias de la consulta: otra clave que buscar y el peor nivel que se le
 * acepta (`nameQueryAliases` del módulo común; se deja aquí por las pruebas de
 * siempre).
 */
export interface QueryAlias {
  readonly key: string;
  readonly maxTier: number;
}

/** Otras claves que buscar para una consulta ya limpia (Champions, TVE, A3, TDP). */
export function searchQueryAliases(key: string): QueryAlias[] {
  return nameQueryAliases(key);
}

/**
 * Lo que escribe una persona sin el país de delante («uk: la liga tv» → «la
 * liga tv» y «UK»; «[es] dazn 1» → «dazn 1» y ''), como lo lee el módulo común.
 */
export function searchQueryText(query: string): {
  readonly text: string;
  readonly country: string;
} {
  const parsed = parseNameQuery(query);
  return { text: parsed.text, country: parsed.country };
}

/** La consulta limpia para el buscador: sus palabras (sin país, calidad ni reserva) unidas. */
export function searchQueryKey(query: string): string {
  return parseNameQuery(query).key;
}

/** El mejor nivel de un grupo con la consulta y sus alias (`nameTierWithAliases` sobre cada nombre). */
export function bestNameTier(
  query: NameQuery,
  names: readonly NameFacts[],
): { readonly tier: number; readonly lead: boolean } {
  let tier = -1;
  let lead = false;
  for (const name of names) {
    const found = nameTierWithAliases(query, name);
    if (found.tier < 0) continue;
    if (tier < 0 || found.tier < tier) tier = found.tier;
    lead ||= found.lead;
  }
  return { tier, lead };
}

/* Candidatos por el nombre de una consulta (sin alias): sus palabras, lo escrito pegado y sin la marca. */
function nameCandidates(index: SearchIndex, q: NameQueryWords, out: Set<number>): void {
  if (!q.required.length) return;
  for (const position of intersect(q.required.map((word) => groupsForWord(index, word)))) {
    out.add(position);
  }
  /* Lo escrito pegado, desde el principio de una palabra: «antena3» → «ANTENA 3», «la1» → «LA 1». */
  if (q.compact.length >= 3) {
    index.groups.forEach((group, position) => {
      if (group.compact.includes(q.compact)) out.add(position);
    });
  }
  /* Sin Movistar delante («movistar vamos» → «#VAMOS»): solo por el principio de una palabra. */
  const brandless = q.required.filter((word) => !MOVISTAR_WORDS.has(word));
  if (
    brandless.length < q.required.length &&
    brandless.some((word) => word.length >= 3 && !/^\d+$/.test(word))
  ) {
    for (const position of intersect(brandless.map((word) => groupsForWord(index, word, false)))) {
      out.add(position);
    }
  }
}

/**
 * Lo que casa por el NOMBRE, con su nivel y si viene de un alias: posición en
 * el índice → resultado. Lo usa `searchCatalog`.
 */
function matchByName(
  index: SearchIndex,
  q: NameQuery,
): Map<number, { tier: number; lead: boolean }> {
  const candidates = new Set<number>();
  nameCandidates(index, q, candidates);
  for (const alias of q.aliases) nameCandidates(index, alias.query, candidates);
  const out = new Map<number, { tier: number; lead: boolean }>();
  for (const position of candidates) {
    const group = index.groups[position] as SearchGroup;
    const found = bestNameTier(q, cachedKeyNames(index.names, group.key));
    if (found.tier >= 0) out.set(position, found);
  }
  return out;
}

/** Lo que decide el orden de un resultado del buscador o de la pestaña IPTV (`compareRankedHits`). */
export interface RankedHit {
  /** Nivel, país, alias y favorito (`compareNameRank`). */
  readonly rank: NameRank;
  /** `GroupFacts.penalty`. */
  readonly penalty: number;
  /** Palabras de relleno escritas que no tiene su familia («laliga tv» y «DAZN LaLiga»: 1). */
  readonly miss: number;
  /** Largo de su familia; -1 si casa por la categoría (ahí manda el orden del catálogo). */
  readonly familyLength: number;
  /** Orden del catálogo de su familia (la familia sale junta). */
  readonly familyOrder: number;
  readonly number: number;
  /** Mejor calidad (`qualityScore`): más alta, antes. */
  readonly quality: number;
  readonly keyLength: number;
  readonly keyOrder: number;
  /** 0 España o sin país; 1 otro país (a igualdad de todo, el de aquí). */
  readonly abroad: number;
  /** El último desempate (orden del catálogo de su mejor variante, o de la fila). */
  readonly order: number;
}

/** Orden del buscador y de la pestaña IPTV (cabecera, punto 4). */
export function compareRankedHits(a: RankedHit, b: RankedHit): number {
  return (
    compareNameRank(a.rank, b.rank) ||
    a.penalty - b.penalty ||
    a.miss - b.miss ||
    (a.familyLength < 0 || b.familyLength < 0 ? 0 : a.familyLength - b.familyLength) ||
    a.familyOrder - b.familyOrder ||
    a.number - b.number ||
    b.quality - a.quality ||
    a.keyLength - b.keyLength ||
    a.keyOrder - b.keyOrder ||
    a.abroad - b.abroad ||
    a.order - b.order
  );
}

/* Topes de cada campo en `packRankedHit` (lo que pasa del tope empata y decide el campo siguiente). */
const PACK_ORDER = 2 ** 18;
const PACK_NUMBER = 1024;
const PACK_LENGTH = 128;

/**
 * El orden de `compareRankedHits` en dos números (para ordenar muchas filas
 * deprisa, la pestaña IPTV): a < b por `compareRankedHits` ⇔ [a1, a2] < [b1,
 * b2] por orden lexicográfico, mientras los órdenes del catálogo quepan en 18
 * bits (262 143), el número del final en 10 (1 023) y los largos en 7 (127);
 * si no, esos campos empatan y decide el siguiente. No vale para lo que casa
 * por la categoría (la pestaña no la usa).
 */
export function packRankedHit(hit: RankedHit): readonly [number, number] {
  const { rank } = hit;
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max - 1));
  let first = Number(rank.tier >= NAME_TIER.partial);
  first = first * 4 + clamp(rank.region + 1, 4);
  first = first * 2 + Number(!rank.lead);
  first = first * 2 + Number(rank.tier !== NAME_TIER.exact);
  first = first * 2 + Number(!rank.favorite);
  first = first * 8 + clamp(rank.tier, 8);
  first = first * 4 + clamp(hit.penalty, 4);
  first = first * 4 + clamp(hit.miss, 4);
  first = first * PACK_LENGTH + clamp(hit.familyLength, PACK_LENGTH);
  first = first * PACK_ORDER + clamp(hit.familyOrder, PACK_ORDER);
  first = first * PACK_NUMBER + clamp(hit.number, PACK_NUMBER);
  first = first * 8 + clamp(7 - hit.quality, 8);
  let second = clamp(hit.keyLength, PACK_LENGTH);
  second = second * PACK_ORDER + clamp(hit.keyOrder, PACK_ORDER);
  second = second * 2 + clamp(hit.abroad, 2);
  second = second * PACK_ORDER + clamp(hit.order, PACK_ORDER);
  return [first, second];
}

/** Lo que la consulta pide aparte de las palabras: el país, los favoritos y el relleno escrito. */
export interface RankContext {
  readonly query: NameQuery;
  /** Familia → palabras de sus claves (`literalMiss`). */
  readonly familyWords: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Las palabras de relleno que se escribieron («laliga tv»): la familia que las
 * lleva en alguna de sus claves va antes («M+ LaLiga TV 2» antes que «DAZN
 * LaLiga 2»), y «igual» y «misma familia» cuentan lo mismo (si no, «LA LIGA
 * 2» de Rakuten, que es igual sin el «tv», ganaba a «M+ LaLiga TV 2»).
 */
export function literalMiss(context: RankContext, family: string): number {
  const typed = context.query.typedOptional;
  if (!typed.length) return 0;
  const words = [...(context.familyWords.get(family) ?? [])];
  /* Vale también pegada delante de otra («tv 3» → «TV3»). */
  return typed.filter((word) => !words.some((token) => token.startsWith(word))).length;
}

/** El nivel que cuenta para ordenar: con relleno escrito, «igual» es «misma familia». */
export function rankTier(context: RankContext, tier: number): number {
  return context.query.typedOptional.length && tier === NAME_TIER.exact ? NAME_TIER.family : tier;
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

export interface CatalogSearchOptions {
  /** Canales (`channelIdOf`) de tus favoritos IPTV: desempatan delante (nunca delante de lo igual). */
  readonly favorites?: ReadonlySet<string>;
}

/**
 * Busca en el catálogo (docs/iptv.md §14.3 y §18; docs/buscador.md):
 * 1. Por el NOMBRE: `nameTier` del módulo común con la consulta y sus alias,
 *    sobre los candidatos del índice de palabras (cada palabra escrita casa
 *    con el principio de una palabra del nombre, entera si es un número, o
 *    por dentro de un compuesto; o lo escrito pegado; o sin la marca).
 * 2. Por la CATEGORÍA: «tdt» trae los canales de «EU | ES | TDT ESPAÑA
 *    VIP», con sinónimos («futbol» → «TV FOOTBALL»), detrás de los que casan
 *    por el nombre (nivel 7).
 * Orden: `compareRankedHits`.
 */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  limit: number = IPTV_SEARCH.limit,
  options: CatalogSearchOptions = {},
): CatalogSearchResult {
  const q = parseNameQuery(query);
  const key = q.key;
  if (!key) return { key, total: 0, capped: false, groups: [] };
  const index = searchIndex(catalog);
  const found = matchByName(index, q);
  /* 2. Por la categoría (lo que ya casa por el nombre se queda con su nivel). */
  const categoryWords = q.required.map(categoryWord);
  for (const info of index.categories.values()) {
    const matches = categoryWords.every((word) =>
      info.words.some((token) =>
        /^\d+$/.test(word) ? token === word : token.startsWith(word) && word.length >= 2,
      ),
    );
    if (!matches) continue;
    for (const position of info.groups) {
      if (!found.has(position)) found.set(position, { tier: CATEGORY_TIER, lead: false });
    }
  }

  const context: RankContext = { query: q, familyWords: index.familyWords };
  const favorites = options.favorites;
  const ranked = [...found].map(([position, { tier, lead }]) => {
    const group = index.groups[position] as SearchGroup;
    const fact = index.facts[position] as GroupFacts;
    const category = tier === CATEGORY_TIER;
    const hit: RankedHit = {
      rank: {
        tier: rankTier(context, tier),
        lead,
        region: regionRank(group.bucket, q.country),
        favorite: Boolean(favorites?.has(group.channel)),
      },
      penalty: fact.penalty,
      miss: literalMiss(context, fact.family),
      familyLength: category ? -1 : fact.family.length,
      familyOrder: category ? 0 : (index.familyOrder.get(fact.family) ?? fact.keyOrder),
      number: category ? 0 : fact.number,
      quality: fact.quality,
      keyLength: category ? 0 : group.key.length,
      keyOrder: fact.keyOrder,
      abroad: group.bucket === '' ? 0 : 1,
      order: group.best.order,
    };
    return { group, hit };
  });
  ranked.sort((a, b) => compareRankedHits(a.hit, b.hit));
  return {
    key,
    total: Math.min(ranked.length, IPTV_SEARCH.totalCap),
    capped: ranked.length > IPTV_SEARCH.totalCap,
    groups: ranked.slice(0, Math.max(0, limit)).map((item) => item.group),
  };
}

/**
 * Parecido de un título con la consulta, con las mismas palabras y niveles que
 * el buscador de la IPTV (docs/diagnostico-iptv-0.8.2.md, E2; para ordenar
 * los resultados del motor AceStream): 0 igual; 1 misma familia (sin el
 * número del final o sin la marca de delante); 2 empieza por la consulta; 3
 * tiene todas las palabras (en orden o no, o por dentro); 4 el resto. El
 * título se mira sin lo que va tras «-->».
 */
export function searchRelevance(query: string, title: string): number {
  return searchRelevanceFor(query)(title);
}

/** `searchRelevance` con la consulta preparada una vez (para ordenar muchos títulos). */
export function searchRelevanceFor(query: string): (title: string) => number {
  const q = parseNameQuery(query);
  if (!q.key) return () => 4;
  return (title) => {
    const words = nameSearchWords(String(title ?? ''));
    if (!words.length) return 4;
    const tier = nameTier(q, nameFacts(words));
    if (tier < 0 || tier >= NAME_TIER.brandless) return 4;
    return Math.min(tier, 3);
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
 * categoría, o su clave en la del título (`channelSearchKey`, 3 letras o
 * más: «m+ laliga» encuentra «M. LALIGA 1»); lo mismo que enseñan «En tu
 * biblioteca» y el filtro de Canales (`filterItems`). Sin repetir y 200 como
 * mucho.
 */
export function libraryCandidates(
  items: readonly LibraryCandidate[],
  query: string,
): LibraryCandidate[] {
  const q = foldText(query);
  if (!q) return [];
  const key = channelSearchKey(query);
  const byKey = key.length >= CHANNEL_SEARCH_KEY_MIN;
  const seen = new Set<string>();
  const out: LibraryCandidate[] = [];
  for (const item of items) {
    if (out.length >= IPTV_SEARCH.libraryCandidatesMax) break;
    if (seen.has(item.id)) continue;
    if (
      !foldText(item.title).includes(q) &&
      !categoryMatches(item.category, q) &&
      !(byKey && channelSearchKey(item.title).includes(key))
    ) {
      continue;
    }
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
