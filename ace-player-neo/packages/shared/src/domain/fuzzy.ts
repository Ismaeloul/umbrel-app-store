/* Buscador «como Google» (docs/iptv.md §20): tolerante a erratas, sin tildes
   ni mayúsculas, con prefijos y con los alias de `search-aliases.ts`. Puro y
   sin estado global salvo la tabla de alias compilada (una vez). Lo usan el
   servidor (IPTV, pestaña IPTV, consulta al motor AceStream y los candidatos
   de la biblioteca) y la web (Buscar, filtro de Canales y los partidos).

   SOLO PARA BUSCAR. El emparejado automático (partido → IPTV/AceStream) no
   importa este módulo: `sameChannel`, `channelMatchScore` y compañía siguen
   con sus reglas estrictas (umbral 92, Hypermotion, números…).

   Cómo casa una palabra de la consulta con una del texto:
   1. exacta (sin tildes ni mayúsculas: «Fútbol» = «futbol»);
   2. por el principio («barc» → «Barcelona», «ingl» → «Inglaterra»); un
      número solo entero («1» no es «10»);
   3. por un alias (tabla de datos: «esp» → «España», «t5» → «Telecinco»,
      «champions» → «Liga de Campeones»);
   4. con una errata, solo si la palabra no casa de ninguna de las formas de
      arriba con nada de lo que hay: 1 error desde 4 letras y 2 desde 8
      (Damerau: cambio, letra de más, de menos o dos letras cambiadas de
      orden), letras dobles y sencillas («Inglatera», «Villareal») y las
      confusiones del español (b/v, y/ll, c/z/s/k, qu/k, h muda, ñ/n:
      «barsa», «telecinko», «dasn»). Nunca en palabras con números.

   Orden: exacta, luego por prefijo, luego por alias y luego por errata. Un
   alias escrito entero («madrid» → Real Madrid, «esp» → España, «segunda»
   → Hypermotion) cuenta como exacto y, si empata con otra cosa exacta, va
   delante: «madrid» da el Real Madrid y luego el Atlético; «segunda», la
   Hypermotion y luego la Segunda Federación. Con el mismo nivel, lo de
   España primero. */

import { channelSpelling } from './channel-names.js';
import { SEARCH_ALIASES, type SearchAliasGroup } from './search-aliases.js';

// --- Plegado ---

const EXTRA_FOLD: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/**
 * El texto listo para buscar: la grafía única de los canales
 * (`channelSpelling`: «M+»/«M.» → Movistar, «la liga» → LaLiga…), sin tildes
 * ni mayúsculas (NFKD, así también «ᴿᴬᵂ», «1ª» o «²»), «+» → «plus», números
 * y letras separados («antena3» → «antena 3», «t5» → «t 5») y solo letras y
 * números separados por un espacio.
 */
export function searchFold(value: unknown): string {
  let text = channelSpelling(String(value ?? ''));
  text = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  text = text.replace(/[ßæœøłđðþı]/g, (char) => EXTRA_FOLD[char] ?? char);
  text = text.replace(/\+/g, ' plus ');
  text = text.replace(/(\p{L})(?=\p{N})/gu, '$1 ').replace(/(\p{N})(?=\p{L})/gu, '$1 ');
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return text.replace(/\bplus(?: plus)+\b/g, 'plus');
}

/** Las palabras de `searchFold`. */
export function searchWords(value: unknown): string[] {
  const text = searchFold(value);
  return text ? text.split(' ') : [];
}

/*
 * Compuestos que las listas escriben juntos: el texto también se puede
 * encontrar por sus partes («liga» encuentra «LaLiga», «sexta» encuentra
 * «laSexta»). Solo en el lado del texto, nunca en la consulta.
 */
const COMPOUND_SPLITS: Readonly<Record<string, readonly string[]>> = {
  laliga: ['la', 'liga'],
  lasexta: ['la', 'sexta'],
  telecinco: ['tele', 'cinco'],
  teledeporte: ['tele', 'deporte'],
  telemadrid: ['tele', 'madrid'],
  motogp: ['moto', 'gp'],
  onetoro: ['one', 'toro'],
  bemad: ['be', 'mad'],
  realmadrid: ['real', 'madrid'],
};

/** Las palabras de un texto para indexarlo: las de `searchWords` y las partes de los compuestos. */
export function documentWords(value: unknown): string[] {
  const words = searchWords(value);
  const out = [...words];
  for (const word of words) for (const part of COMPOUND_SPLITS[word] ?? []) out.push(part);
  return out;
}

/* Palabras que no hace falta encontrar: artículos con 2 palabras de verdad o más («atlético de madrid» =
   «Atlético Madrid»; «la 1» sigue pidiendo el «la»), y «tv», «canal» o «club» con una ya basta («gol tv» =
   «Gol»). */
const ARTICLES: ReadonlySet<string> = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'the',
  'of',
  'en',
  'da',
  'do',
  'di',
]);
const WEAK_WORDS: ReadonlySet<string> = new Set([
  'tv',
  'canal',
  'channel',
  'fc',
  'cf',
  'cd',
  'sd',
  'ud',
  'sc',
  'club',
]);

const DIGIT_RE = /\d/;

/** Qué palabras de la consulta hay que encontrar (las demás, si casan, bien; si no, también). */
export function requiredWords(words: readonly string[]): boolean[] {
  const strong = words.filter((word) => !ARTICLES.has(word) && !WEAK_WORDS.has(word)).length;
  return words.map((word) => {
    if (ARTICLES.has(word)) return strong < 2;
    if (WEAK_WORDS.has(word)) return strong < 1;
    return true;
  });
}

// --- Erratas ---

/**
 * Clave fonética del español para comparar erratas: «ch» se queda, qu/k/c
 * dura → k, c suave/z/s → s, g suave → j, ll → y, v → b, h muda fuera, x →
 * ks y las letras dobles, sencillas. «Inglaterra» e «Inglatera», «barsa» y
 * «barza», «telecinco» y «telecinko», «dazn» y «dasn» dan lo mismo. Las
 * palabras con números no se tocan.
 */
export function phoneticKey(word: string): string {
  if (!word || DIGIT_RE.test(word)) return word;
  return word
    .replace(/ch/g, 'C')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/q/g, 'k')
    .replace(/gu(?=[ei])/g, 'G')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/G/g, 'g')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/ll/g, 'y')
    .replace(/v/g, 'b')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

/** Errores que se toleran en una palabra de `length` letras: 0, 1 desde 4 y 2 desde 8. */
export function typoBudget(length: number): number {
  if (length >= 8) return 2;
  if (length >= 4) return 1;
  return 0;
}

/**
 * Distancia de Damerau (la de «alineamiento óptimo»: cambio, inserción,
 * borrado y dos letras seguidas cambiadas de orden). Si pasa de `max`,
 * devuelve `max + 1` sin terminar la cuenta.
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (!la) return lb;
  if (!lb) return la;
  let before = new Array<number>(lb + 1).fill(0);
  let previous = Array.from({ length: lb + 1 }, (_, j) => j);
  let current = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i += 1) {
    current[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j += 1) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        value = Math.min(value, (before[j - 2] as number) + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    [before, previous, current] = [previous, current, before];
  }
  return previous[lb] as number;
}

/**
 * ¿Es `token` la palabra `word` con una errata tolerada? Devuelve la distancia
 * (0 si solo cambia la «ortografía»: letras dobles, b/v, c/z/s…) o null.
 * `extra` suma errores al presupuesto (para «Quizás quisiste decir»).
 */
export function typoDistance(word: string, token: string, extra = 0): number | null {
  if (word === token || DIGIT_RE.test(word) || DIGIT_RE.test(token)) return null;
  /* Las letras dobles no cuentan («inglatera» e «inglaterra»): ni para el presupuesto ni para la longitud.
     Así «zzzz» (una letra) no tiene erratas y no es «sg». */
  const single = (text: string): number => text.replace(/(.)\1+/g, '$1').length;
  const letters = single(word);
  const budget = typoBudget(letters) + (extra && letters >= 3 ? extra : 0);
  if (Math.abs(letters - single(token)) > Math.max(budget, 1)) return null;
  const pw = phoneticKey(word);
  const pt = phoneticKey(token);
  /* Misma fonética: desde 3 letras, o con 2 si es la misma letra que suena igual («tb» = «tv»). */
  if (word.length >= 2 && token.length >= 2 && pw.length >= 2 && pw === pt) return 0;
  if (!budget) return null;
  const distance = Math.min(editDistance(word, token, budget), editDistance(pw, pt, budget));
  return distance <= budget ? distance : null;
}

function trigrams(key: string): string[] {
  const padded = `^^${key}$$`;
  const out: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i += 1) out.push(padded.slice(i, i + 3));
  return out;
}

/** Una corrección posible de una palabra. */
export interface FuzzyCorrection {
  readonly token: string;
  readonly distance: number;
}

/* Primera posición de `sorted` que no es menor que `word`. */
function lowerBound(sorted: readonly string[], word: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as string) < word) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Índice de palabras para buscar por prefijo y encontrar erratas deprisa: las
 * palabras ordenadas (prefijos con búsqueda binaria), su clave fonética y un
 * índice de trigramas de esa clave (las candidatas a errata comparten
 * trigramas; solo esas se comparan con Damerau). Con las ~20 000 palabras de
 * una lista IPTV de 30 000 canales responde en milisegundos.
 */
export class FuzzyVocabulary {
  private readonly sorted: readonly string[];
  private readonly known: ReadonlySet<string>;
  private readonly weight: ReadonlyMap<string, number>;
  private readonly phonetic: readonly string[];
  private readonly byPhonetic = new Map<string, number[]>();
  private readonly grams = new Map<string, number[]>();

  constructor(tokens: Iterable<string>, weights?: ReadonlyMap<string, number>) {
    const unique = new Set<string>();
    for (const token of tokens) if (token) unique.add(token);
    this.sorted = [...unique].sort();
    this.known = unique;
    this.weight = weights ?? new Map();
    this.phonetic = this.sorted.map((token) => phoneticKey(token));
    this.phonetic.forEach((key, index) => {
      if (DIGIT_RE.test(key)) return;
      const same = this.byPhonetic.get(key);
      if (same) same.push(index);
      else this.byPhonetic.set(key, [index]);
      for (const gram of new Set(trigrams(key))) {
        const list = this.grams.get(gram);
        if (list) list.push(index);
        else this.grams.set(gram, [index]);
      }
    });
  }

  get size(): number {
    return this.sorted.length;
  }

  has(word: string): boolean {
    return this.known.has(word);
  }

  /** ¿Hay alguna palabra MÁS LARGA que empiece por `word`? */
  hasPrefix(word: string): boolean {
    const at = lowerBound(this.sorted, word);
    for (let i = at; i < this.sorted.length; i += 1) {
      const token = this.sorted[i] as string;
      if (!token.startsWith(word)) return false;
      if (token.length > word.length) return true;
    }
    return false;
  }

  /** Las palabras que empiezan por `word` (sin ella misma), en orden. */
  prefixed(word: string, max = Number.POSITIVE_INFINITY): string[] {
    const out: string[] = [];
    for (let i = lowerBound(this.sorted, word); i < this.sorted.length; i += 1) {
      const token = this.sorted[i] as string;
      if (!token.startsWith(word)) break;
      if (token !== word) out.push(token);
      if (out.length >= max) break;
    }
    return out;
  }

  /** ¿Casa `word` con algo sin errata (exacta o por el principio)? Un número, solo entero. */
  matchesPlain(word: string): boolean {
    return this.has(word) || (!DIGIT_RE.test(word) && this.hasPrefix(word));
  }

  /**
   * Las palabras que son `word` con una errata tolerada, de la más cercana a
   * la más lejana (y, a igual distancia, la más frecuente). `extra` amplía el
   * presupuesto (para «Quizás quisiste decir»).
   */
  corrections(
    word: string,
    options: { readonly max?: number; readonly extra?: number } = {},
  ): FuzzyCorrection[] {
    const max = options.max ?? 5;
    const extra = options.extra ?? 0;
    if (!word || DIGIT_RE.test(word) || this.known.has(word)) return [];
    const budget = typoBudget(word.length) + (extra && word.length >= 3 ? extra : 0);
    const key = phoneticKey(word);
    const candidates = new Set<number>();
    if (word.length >= 2) for (const index of this.byPhonetic.get(key) ?? []) candidates.add(index);
    if (budget > 0) {
      const grams = trigrams(key);
      const threshold = Math.max(1, grams.length - 4 * budget);
      const shared = new Map<number, number>();
      for (const gram of new Set(grams)) {
        for (const index of this.grams.get(gram) ?? []) {
          shared.set(index, (shared.get(index) ?? 0) + 1);
        }
      }
      for (const [index, count] of shared) if (count >= threshold) candidates.add(index);
    }
    const out: { token: string; distance: number }[] = [];
    for (const index of candidates) {
      const token = this.sorted[index] as string;
      const distance = typoDistance(word, token, extra);
      if (distance !== null) out.push({ token, distance });
    }
    out.sort(
      (a, b) =>
        a.distance - b.distance ||
        (this.weight.get(b.token) ?? 0) - (this.weight.get(a.token) ?? 0) ||
        Math.abs(a.token.length - word.length) - Math.abs(b.token.length - word.length) ||
        (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
    );
    return out.slice(0, max);
  }
}

// --- Alias ---

interface CompiledName {
  readonly words: readonly string[];
  /** Como está en la tabla, sin la «~». */
  readonly raw: string;
  /** «~» en la tabla: solo de la consulta (nunca identifica un texto ni se usa como lectura). */
  readonly loose: boolean;
  readonly group: number;
}

interface AliasTable {
  readonly groups: readonly SearchAliasGroup[];
  /** Nombres de cada grupo, en palabras plegadas. */
  readonly names: readonly (readonly CompiledName[])[];
  /** Primera palabra → nombres que empiezan por ella, del más largo al más corto. */
  readonly byFirst: ReadonlyMap<string, readonly CompiledName[]>;
  /** Todas las palabras de todos los nombres (para las erratas). */
  readonly words: ReadonlySet<string>;
}

let ALIAS_TABLE: AliasTable | null = null;

/** Un nombre de la tabla sin su marca «~». */
export function aliasDisplayName(name: string): string {
  return name.replace(/^~/, '');
}

/** La tabla de alias compilada (plegada una vez). */
function aliasTable(): AliasTable {
  if (ALIAS_TABLE) return ALIAS_TABLE;
  const names: CompiledName[][] = [];
  const byFirst = new Map<string, CompiledName[]>();
  const words = new Set<string>();
  SEARCH_ALIASES.forEach((group, index) => {
    const own: CompiledName[] = [];
    for (const raw of group.names) {
      const folded = searchWords(aliasDisplayName(raw));
      if (!folded.length) continue;
      const name: CompiledName = {
        words: folded,
        raw: aliasDisplayName(raw),
        loose: raw.startsWith('~'),
        group: index,
      };
      own.push(name);
      for (const word of folded) words.add(word);
      const first = folded[0] as string;
      const list = byFirst.get(first);
      if (list) list.push(name);
      else byFirst.set(first, [name]);
    }
    names.push(own);
  });
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  ALIAS_TABLE = { groups: SEARCH_ALIASES, names, byFirst, words };
  return ALIAS_TABLE;
}

/** Las palabras de los alias (para que una errata de «champions» encuentre el alias). */
export function aliasWords(): ReadonlySet<string> {
  return aliasTable().words;
}

let ALIAS_VOCABULARY: FuzzyVocabulary | null = null;

/** Las palabras de la tabla de alias como vocabulario de erratas (una vez). */
export function aliasVocabulary(): FuzzyVocabulary {
  ALIAS_VOCABULARY ??= new FuzzyVocabulary(aliasWords());
  return ALIAS_VOCABULARY;
}

/**
 * Las formas de leer una palabra con erratas (§20): si casa exacta, ninguna;
 * si solo casa por el principio («champion» → «championship»), además las
 * erratas de los ALIAS («champions»), por si era eso; si no casa con nada,
 * sus erratas en todo el vocabulario. `max` por palabra.
 */
export function wordTypos(
  word: string,
  vocabulary: FuzzyVocabulary,
  options: { readonly exact: boolean; readonly plain: boolean; readonly max?: number },
): string[] {
  const max = options.max ?? 3;
  if (DIGIT_RE.test(word) || options.exact) return [];
  if (options.plain) {
    return (
      aliasVocabulary()
        .corrections(word, { max })
        .map((item) => item.token)
        /* Solo las que completan la palabra con una errata, nunca una más corta («teled» no es «tele»). */
        .filter((token) => token !== word && token.length >= word.length && !word.startsWith(token))
    );
  }
  return vocabulary.corrections(word, { max }).map((item) => item.token);
}

/** Un alias encontrado: las palabras `start`…`end` (sin incluir) son un nombre del grupo. */
export interface AliasHit {
  readonly start: number;
  readonly end: number;
  readonly group: SearchAliasGroup;
}

function scanAliases(words: readonly string[], strictOnly: boolean): AliasHit[] {
  const table = aliasTable();
  const hits: AliasHit[] = [];
  let i = 0;
  while (i < words.length) {
    let found: AliasHit | null = null;
    for (const name of table.byFirst.get(words[i] as string) ?? []) {
      if (strictOnly && name.loose) continue;
      if (name.words.length > words.length - i) continue;
      if (name.words.every((word, k) => words[i + k] === word)) {
        found = {
          start: i,
          end: i + name.words.length,
          group: table.groups[name.group] as SearchAliasGroup,
        };
        break;
      }
    }
    if (found) {
      hits.push(found);
      i = found.end;
    } else {
      i += 1;
    }
  }
  return hits;
}

/** Los alias de una CONSULTA (palabras plegadas), el más largo primero y sin solaparse. */
export function findAliases(words: readonly string[]): AliasHit[] {
  return scanAliases(words, false);
}

/**
 * Qué nombra un TEXTO (palabras plegadas): los grupos de sus nombres «de
 * verdad», el más largo primero. «LaLiga Hypermotion» nombra Hypermotion (no
 * LaLiga); «Atlético de Madrid» nombra al Atlético (no al Real Madrid).
 */
export function namedGroups(words: readonly string[]): Set<string> {
  return new Set(scanAliases(words, true).map((hit) => hit.group.id));
}

/** El grupo de alias cuyo nombre es EXACTAMENTE toda la consulta, o null. */
export function aliasOf(query: string): SearchAliasGroup | null {
  const words = searchWords(query);
  const hits = findAliases(words);
  const hit = hits[0];
  return hit && hits.length === 1 && hit.start === 0 && hit.end === words.length ? hit.group : null;
}

/** Otra forma de leer la consulta: cada alias cambiado por otro nombre de su grupo. */
export interface AliasReading {
  readonly words: readonly string[];
  /** La misma lectura escrita con los nombres de la tabla («F1», no «f 1»): para quien limpia a su manera. */
  readonly text: string;
  /** Los grupos de alias usados: un texto solo vale si los nombra (`namedGroups`). */
  readonly groups: readonly string[];
}

/**
 * Las lecturas de la consulta con cada alias cambiado por los nombres «de
 * verdad» de su grupo («t 5» → «telecinco»; «esp» → «espana», «spain»…),
 * `max` como mucho, sin repetir. Nunca por un nombre que sea parte del que
 * se escribió («real madrid» no se lee «madrid»). La consulta tal cual no va
 * (es la lectura 0 de quien llama).
 */
export function aliasReadings(words: readonly string[], max = 16): AliasReading[] {
  const hits = findAliases(words);
  if (!hits.length) return [];
  const table = aliasTable();
  let readings: { words: string[]; text: string[]; groups: string[] }[] = [
    { words: [], text: [], groups: [] },
  ];
  let at = 0;
  for (const hit of hits) {
    const between = words.slice(at, hit.start);
    const own = words.slice(hit.start, hit.end);
    const ownSet = new Set(own);
    const index = table.groups.indexOf(hit.group);
    const options = (table.names[index] ?? []).filter(
      (name) =>
        !name.loose &&
        name.words.join(' ') !== own.join(' ') &&
        !name.words.every((word) => ownSet.has(word)),
    );
    const next: { words: string[]; text: string[]; groups: string[] }[] = [];
    for (const reading of readings) {
      /* También la lectura sin cambiar este alias (si hay otros). */
      next.push({
        words: [...reading.words, ...between, ...own],
        text: [...reading.text, ...between, ...own],
        groups: reading.groups,
      });
      for (const name of options) {
        next.push({
          words: [...reading.words, ...between, ...name.words],
          text: [...reading.text, ...between, name.raw],
          groups: [...reading.groups, hit.group.id],
        });
      }
    }
    readings = next.slice(0, max * 4);
    at = hit.end;
  }
  const tail = words.slice(at);
  const seen = new Set<string>();
  const out: AliasReading[] = [];
  for (const reading of readings) {
    if (!reading.groups.length) continue;
    const full = [...reading.words, ...tail];
    const key = full.join(' ');
    if (seen.has(key) || key === words.join(' ')) continue;
    seen.add(key);
    out.push({ words: full, text: [...reading.text, ...tail].join(' '), groups: reading.groups });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * La consulta con cada alias cambiado por el nombre de siempre del grupo
 * (el primero de la tabla, con sus tildes): «t5» → «Telecinco»,
 * «champions» → «Liga de Campeones». null si no hay alias o si ya lo es.
 */
export function canonicalAliasText(query: string): string | null {
  const words = searchWords(query);
  const hits = findAliases(words);
  if (!hits.length) return null;
  const parts: string[] = [];
  let at = 0;
  for (const hit of hits) {
    parts.push(...words.slice(at, hit.start), aliasDisplayName(hit.group.names[0] as string));
    at = hit.end;
  }
  parts.push(...words.slice(at));
  const text = parts.join(' ');
  return searchFold(text) === words.join(' ') ? null : text;
}

// --- Corrección de una consulta ---

export interface QueryCorrection {
  /** La consulta con las erratas corregidas (en palabras plegadas). */
  readonly text: string;
  /** ¿Se ha cambiado alguna palabra? */
  readonly changed: boolean;
}

/**
 * Corrige las erratas de una consulta contra un vocabulario: cada palabra que
 * no casa con nada (ni exacta ni por el principio) pasa a la palabra más
 * cercana con una errata tolerada. Con `extra`, más tolerante (para
 * «Quizás quisiste decir»). Las palabras con números no se tocan.
 */
export function correctQuery(
  query: string,
  vocabulary: FuzzyVocabulary,
  options: { readonly extra?: number } = {},
): QueryCorrection {
  const words = searchWords(query);
  let changed = false;
  const out = words.map((word) => {
    if (DIGIT_RE.test(word) || vocabulary.matchesPlain(word)) return word;
    const [best] = vocabulary.corrections(word, { max: 1, extra: options.extra ?? 0 });
    if (!best) return word;
    changed = true;
    return best.token;
  });
  return { text: out.join(' '), changed };
}

// --- Índice de documentos ---

/** Nivel de un acierto: 0 exacta, 1 prefijo, 2 alias, 3 errata. */
export type FuzzyTier = 0 | 1 | 2 | 3;

export interface FuzzyHit<T> {
  readonly item: T;
  /** Posición en la lista de entrada. */
  readonly index: number;
  readonly tier: FuzzyTier;
  /** Lo nombra un alias exacto de la consulta («madrid» → Real Madrid). */
  readonly preferred: boolean;
  /** Para ordenar: 0 exacta o alias exacto (este delante si empatan), 1 prefijo, 2 alias, 3 errata. */
  readonly rank: number;
}

export interface FuzzyIndexOptions<T> {
  /** Lo de España va primero cuando empata (canales sin país o de España, partidos de aquí…). */
  readonly spain?: (item: T) => boolean;
}

interface Reading {
  readonly words: readonly string[];
  /** Grupos de alias de esta lectura (vacío: la consulta tal cual o con erratas corregidas). */
  readonly groups: readonly string[];
  readonly typo: boolean;
}

/**
 * Buscador sobre una lista pequeña o mediana (la biblioteca, los partidos de
 * la agenda, la demo): cada elemento da uno o varios textos (título,
 * categoría, equipos, siglas…) y la consulta casa si CADA palabra que hay
 * que encontrar casa con alguna palabra de alguno de ellos (en cualquier
 * orden). Se monta una vez por lista y cada búsqueda cuesta milisegundos.
 */
export class FuzzySearchIndex<T> {
  readonly items: readonly T[];
  private readonly postings = new Map<string, number[]>();
  private readonly docVocabulary: FuzzyVocabulary;
  private readonly vocabulary: FuzzyVocabulary;
  private readonly lengths: readonly number[];
  private readonly spain: readonly boolean[];
  private readonly named: readonly (ReadonlySet<string> | null)[];
  private readonly display = new Map<string, string>();

  constructor(
    items: readonly T[],
    fieldsOf: (item: T) => readonly (string | null | undefined)[],
    options: FuzzyIndexOptions<T> = {},
  ) {
    this.items = items;
    const lengths: number[] = [];
    const weights = new Map<string, number>();
    const named: (Set<string> | null)[] = [];
    items.forEach((item, index) => {
      const seen = new Set<string>();
      let count = 0;
      let groups: Set<string> | null = null;
      for (const field of fieldsOf(item)) {
        if (!field) continue;
        const words = documentWords(field);
        const plain = searchWords(field);
        count += plain.length;
        for (const id of namedGroups(plain)) (groups ??= new Set()).add(id);
        for (const word of words) {
          if (seen.has(word)) continue;
          seen.add(word);
          const list = this.postings.get(word);
          if (list) list.push(index);
          else this.postings.set(word, [index]);
          weights.set(word, (weights.get(word) ?? 0) + 1);
        }
        this.noteDisplay(field);
      }
      lengths.push(count);
      named.push(groups);
    });
    this.lengths = lengths;
    this.named = named;
    this.spain = items.map((item) => options.spain?.(item) ?? false);
    this.docVocabulary = new FuzzyVocabulary(this.postings.keys(), weights);
    for (const group of SEARCH_ALIASES) {
      for (const name of group.names) this.noteDisplay(aliasDisplayName(name));
    }
    this.vocabulary = new FuzzyVocabulary([...this.postings.keys(), ...aliasWords()], weights);
  }

  /* Cómo se escribe una palabra plegada (con sus tildes), para «Quizás quisiste decir». */
  private noteDisplay(text: string): void {
    for (const raw of String(text).split(/[\s/|·,;:()[\]{}]+/)) {
      const folded = searchFold(raw);
      if (folded && !folded.includes(' ') && !this.display.has(folded)) {
        this.display.set(folded, raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
      }
    }
  }

  /* Documentos en los que casa cada palabra: exacta (0) o por el principio (1). */
  private evaluate(words: readonly string[]): Map<number, 0 | 1> {
    const required = requiredWords(words);
    const perWord: Map<number, 0 | 1>[] = [];
    words.forEach((word, position) => {
      if (!required[position]) return;
      const docs = new Map<number, 0 | 1>();
      for (const doc of this.postings.get(word) ?? []) docs.set(doc, 0);
      /* Por el principio desde 2 letras: «liga f» no es «FC … LaLiga». */
      if (!DIGIT_RE.test(word) && word.length >= 2) {
        for (const token of this.docVocabulary.prefixed(word)) {
          for (const doc of this.postings.get(token) ?? []) if (!docs.has(doc)) docs.set(doc, 1);
        }
      }
      perWord.push(docs);
    });
    if (!perWord.length) return new Map();
    perWord.sort((a, b) => a.size - b.size);
    const [first, ...rest] = perWord as [Map<number, 0 | 1>, ...Map<number, 0 | 1>[]];
    const out = new Map<number, 0 | 1>();
    for (const [doc, kind] of first) {
      let worst: 0 | 1 = kind;
      let ok = true;
      for (const other of rest) {
        const how = other.get(doc);
        if (how === undefined) {
          ok = false;
          break;
        }
        if (how > worst) worst = how;
      }
      if (ok) out.set(doc, worst);
    }
    return out;
  }

  /* La consulta con cada palabra que no casa con nada cambiada por sus erratas (8 lecturas como mucho). */
  private typoVariants(words: readonly string[]): (readonly string[])[] {
    const options = words.map((word) => {
      const found = wordTypos(word, this.vocabulary, {
        exact: this.vocabulary.has(word),
        plain: this.vocabulary.matchesPlain(word),
      });
      if (!found.length) return [word];
      /* Si ya casaba por el principio, también tal cual (la errata es otra lectura más). */
      return this.vocabulary.matchesPlain(word) ? [word, ...found] : found;
    });
    if (options.every((list, i) => list.length === 1 && list[0] === words[i])) return [];
    let variants: string[][] = [[]];
    for (const list of options) {
      const next: string[][] = [];
      for (const variant of variants) for (const word of list) next.push([...variant, word]);
      variants = next.slice(0, 8);
    }
    return variants.filter((variant) => variant.some((word, i) => word !== words[i]));
  }

  private readings(words: readonly string[]): Reading[] {
    const out: Reading[] = [];
    const add = (base: readonly string[], typo: boolean): void => {
      out.push({ words: base, groups: [], typo });
      /* Dos palabras seguidas que el texto escribe juntas («gol play» → «golplay»). */
      for (let i = 0; i + 1 < base.length; i += 1) {
        const joined = `${base[i]}${base[i + 1]}`;
        if (this.postings.has(joined)) {
          out.push({
            words: [...base.slice(0, i), joined, ...base.slice(i + 2)],
            groups: [],
            typo,
          });
        }
      }
      for (const reading of aliasReadings(base)) {
        out.push({ words: reading.words, groups: reading.groups, typo });
      }
    };
    add(words, false);
    for (const variant of this.typoVariants(words)) add(variant, true);
    return out;
  }

  /** Busca y ordena (ver la cabecera). Sin palabras, nada. */
  search(query: string, options: { readonly limit?: number } = {}): FuzzyHit<T>[] {
    const words = searchWords(query);
    if (!words.length) return [];
    const best = new Map<number, { rank: number; tier: FuzzyTier; preferred: boolean }>();
    for (const reading of this.readings(words)) {
      for (const [doc, kind] of this.evaluate(reading.words)) {
        /* Por un alias, solo lo que de verdad nombra ese grupo: «primera» no es «LaLiga Hypermotion». */
        if (reading.groups.length && !reading.groups.every((id) => this.named[doc]?.has(id)))
          continue;
        let rank: number;
        let tier: FuzzyTier;
        let preferred = false;
        if (reading.typo) {
          rank = 3;
          tier = 3;
        } else if (reading.groups.length) {
          /* Un alias escrito entero cuenta como exacto y, si empata con otra cosa exacta, va delante. */
          preferred = kind === 0;
          rank = preferred ? 0 : 2;
          tier = 2;
        } else {
          rank = kind;
          tier = kind;
        }
        const known = best.get(doc);
        if (!known) {
          best.set(doc, { rank, tier, preferred });
        } else {
          if (rank < known.rank) {
            known.rank = rank;
            known.tier = tier;
          }
          known.preferred ||= preferred;
        }
      }
    }
    const hits: FuzzyHit<T>[] = [...best].map(([index, value]) => ({
      item: this.items[index] as T,
      index,
      tier: value.tier,
      preferred: value.preferred,
      rank: value.rank,
    }));
    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.preferred) - Number(a.preferred) ||
        Number(this.spain[b.index]) - Number(this.spain[a.index]) ||
        (this.lengths[a.index] as number) - (this.lengths[b.index] as number) ||
        a.index - b.index,
    );
    return options.limit !== undefined ? hits.slice(0, Math.max(0, options.limit)) : hits;
  }

  /** ¿Casa este elemento? (lo mismo que buscar, para filtrar sin cambiar el orden). */
  matches(query: string): Set<number> {
    return new Set(this.search(query).map((hit) => hit.index));
  }

  /**
   * «Quizás quisiste decir»: la consulta con las palabras que no casan con
   * nada cambiadas por la más parecida (con un error más de lo que tolera la
   * búsqueda), escrita como en el texto («inglatrrea» → «Inglaterra»). Solo
   * si con ella sale algo; si no, null.
   */
  suggest(query: string): string | null {
    const words = searchWords(query);
    if (!words.length) return null;
    const corrected = correctQuery(words.join(' '), this.vocabulary, { extra: 1 });
    if (!corrected.changed) return null;
    const text = corrected.text
      .split(' ')
      .map((word) => this.display.get(word) ?? word)
      .join(' ');
    return this.search(text, { limit: 1 }).length ? text : null;
  }
}

/** Atajo: filtra una lista con el buscador y la devuelve en el orden del buscador. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => readonly (string | null | undefined)[],
  options: FuzzyIndexOptions<T> = {},
): T[] {
  return new FuzzySearchIndex(items, fieldsOf, options).search(query).map((hit) => hit.item);
}

// --- Biblioteca ---

/** La categoría de los canales de tu IPTV guardados desde el buscador: una marca, no una categoría tuya. */
export const IPTV_LIBRARY_CATEGORY = 'IPTV';

/** Por qué se busca un elemento de la biblioteca: su título y su categoría (menos «IPTV»). */
export function libraryFields(item: {
  readonly title: string;
  readonly category?: string | null | undefined;
}): (string | null)[] {
  return [
    item.title,
    item.category && item.category !== IPTV_LIBRARY_CATEGORY ? item.category : null,
  ];
}

const LIBRARY_INDEXES = new WeakMap<readonly object[], FuzzySearchIndex<object>>();

function libraryIndex<
  T extends { readonly title: string; readonly category?: string | null | undefined },
>(items: readonly T[]): FuzzySearchIndex<T> {
  let index = LIBRARY_INDEXES.get(items) as FuzzySearchIndex<T> | undefined;
  if (!index) {
    index = new FuzzySearchIndex(items, libraryFields);
    LIBRARY_INDEXES.set(items, index as unknown as FuzzySearchIndex<object>);
  }
  return index;
}

/** «Quizás quisiste decir» sobre la biblioteca (misma lista, mismo índice que `filterLibrary`). */
export function suggestLibrary<
  T extends { readonly title: string; readonly category?: string | null | undefined },
>(items: readonly T[], query: string): string | null {
  return libraryIndex(items).suggest(query);
}

/**
 * El filtro de la biblioteca (Canales, «En tu biblioteca» de Buscar y los
 * candidatos del servidor): el buscador «como Google» por título y categoría,
 * en su orden. La categoría «IPTV» es una marca: solo casa con «ipt» o
 * «iptv» (si no, «tv» sacaría todos tus favoritos IPTV). El índice se guarda
 * por lista (misma lista, mismo índice).
 */
export function filterLibrary<
  T extends { readonly title: string; readonly category?: string | null | undefined },
>(items: readonly T[], query: string): T[] {
  const out = libraryIndex(items)
    .search(query)
    .map((hit) => hit.item);
  const q = searchFold(query);
  if (q.length >= 3 && 'iptv'.startsWith(q)) {
    const seen = new Set(out);
    for (const item of items) {
      if (item.category === IPTV_LIBRARY_CATEGORY && !seen.has(item)) out.push(item);
    }
  }
  return out;
}
