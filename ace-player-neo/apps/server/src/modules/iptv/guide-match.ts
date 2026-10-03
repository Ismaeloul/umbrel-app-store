/* La guía para encontrar el canal del partido (docs/iptv.md §4.5). Puro.

   Una entrada IPTV queda CONFIRMADA POR LA GUÍA solo si TODO esto se cumple:

   1. Hora: el programa empieza entre 60 min antes y 15 min después del
      saque, dura entre 80 y 240 min y acaba al menos 90 min después del
      saque. Si empieza más de 30 min antes (la previa dentro del mismo
      programa, agenda híbrida, decisiones.md D27; en la 0.8.3 el tope eran esos
      30 min), tiene que cubrir el partido entero: acabar al menos 105 min
      después del saque. Un programa en directo de 20:15 a 22:30 no es un
      partido de las 21:00 (acabaría a las 22:50): es uno de antes.
   2. Equipos: los dos en el MISMO campo (título, subtítulo o descripción), a
      menos de 40 caracteres uno de otro y separados por un separador de
      enfrentamiento (-, –, vs, v, x, ×, contra, /), sin tildes, en minúsculas
      y por palabra completa. Alias: la clave del equipo, la clave sin
      prefijos (real, club, cd…) si queda con 5 letras o más, la forma corta
      de las guías («R. Madrid», «At. Madrid», «Ath. Club», «Dep. Alavés»),
      la tabla curada `EPG_TEAM_ALIASES` y, si llegan, los nombres
      alternativos y cortos. Los puntos y las partículas (de, del, la, el)
      no cuentan: «Bayern de Múnich» es «Bayern Múnich». Las abreviaturas de
      3 letras solo valen en el patrón compacto `AAA-BBB`. Nunca valen solos
      real, madrid, sporting, racing, union, deportivo, club ni city. Un alias
      seguido de B, C, II, Femenino, Sub-19, Juvenil, Castilla, Atlético,
      Deportivo, Promesas… es el filial: no cuenta.
   3. Marcas de «no es el partido»: (R), [R], «R:», (D), (Dif.), repetición,
      diferido, resumen, previa, rueda de prensa, análisis, partidos
      históricos o un año entre paréntesis («(2010)»)…, el elemento
      `<previously-shown/>` o una categoría de noticias, magazine o
      documental. Tampoco valen otros deportes (baloncesto, ACB, Euroliga,
      fútbol sala, balonmano…), el femenino (salvo que el partido lo sea) ni
      las categorías inferiores (Youth League, juvenil, Sub-19…), en
      cualquier campo o categoría.
   4. Competición: el texto (título, subtítulo, descripción o categorías)
      nombra la familia del partido y ninguna otra; si no nombra ninguna, la
      tiene que nombrar el canal («DAZN LaLiga»). Sin familia conocida del
      partido (un amistoso), no se exige.
   5. Canal: país ES explícito (o sin país si casa ≥ 70 con un canal de la
      agenda) y su nombre no puede nombrar otra competición (la regla
      Hypermotion ampliada a todas las familias).
   6. Ambigüedad: con más de 3 canales distintos, solo los que además casan
      (≥ 70) con la agenda; si no queda ninguno, no se confirma nada. */

import { IPTV_GUIDE_AMBIGUOUS_CHANNELS, LIBRARY_MIN_SCORE, footballTeamKey } from '@ace/shared';

const MINUTE = 60_000;

/** Regla 1: lo antes que puede empezar el programa respecto al saque. */
export const GUIDE_EARLY_MS = 60 * MINUTE;
/** Regla 1: lo más tarde que puede empezar el programa respecto al saque. */
export const GUIDE_LATE_MS = 15 * MINUTE;
/** Regla 1: duración de un programa que es un partido. */
export const GUIDE_MIN_DURATION_MS = 80 * MINUTE;
export const GUIDE_MAX_DURATION_MS = 240 * MINUTE;
/** Regla 1: el programa sigue al menos esto después del saque. */
export const GUIDE_AFTER_KICKOFF_MS = 90 * MINUTE;
/** Regla 1: un programa que empieza antes de esto (respecto al saque) lleva la previa dentro... */
export const GUIDE_PREVIA_MS = 30 * MINUTE;
/** ...y tiene que cubrir el partido entero (45 + descanso + 45 y el añadido). */
export const GUIDE_PREVIA_AFTER_KICKOFF_MS = 105 * MINUTE;

/** Un programa de la ventana útil de la guía (guide.ts). */
export interface GuideProgramme {
  readonly start: number;
  readonly stop: number;
  readonly title: string;
  readonly subTitle: string;
  readonly desc: string;
  readonly categories: readonly string[];
  readonly previouslyShown: boolean;
  readonly live: boolean;
}

export interface GuideMatchInput {
  readonly home: string;
  readonly away: string;
  readonly competition: string;
  /** Título del partido de la agenda (para detectar Hypermotion). */
  readonly title?: string;
  /** Saque, epoch ms. */
  readonly start: number;
  /** Canales que anuncia la agenda (pueden faltar). */
  readonly channels: readonly string[];
  /** Nombres alternativos y cortos de cada equipo (TheSportsDB), si se saben. */
  readonly homeAliases?: readonly string[];
  readonly awayAliases?: readonly string[];
}

export interface GuideChannelCandidate {
  /** Clave del grupo de variantes. */
  readonly key: string;
  /** Nombre limpio del canal IPTV («M+ LaLiga TV 2»). */
  readonly display: string;
  readonly country: string | null;
  readonly programmes: readonly GuideProgramme[];
}

export interface GuideConfirmation {
  readonly key: string;
  readonly display: string;
  readonly programme: GuideProgramme;
  /** Mejor casamiento del canal con los de la agenda (0 si no hay agenda). */
  readonly agendaScore: number;
}

export interface GuideMatchOptions {
  /** Puntuación del nombre de un canal contra los de la agenda (`channelMatchScore` máximo). */
  readonly agendaScore: (display: string) => number;
}

// --- Texto ---

/* Los títulos y las categorías de una guía se repiten mucho («Deportes», «Telediario», el título de
   una serie): los cortos se normalizan una vez. Con tope: la memoria no crece sin límite. */
const NORMALIZED_MEMO = new Map<string, string>();
const NORMALIZED_MEMO_MAX = 8192;
const NORMALIZED_MEMO_LENGTH = 160;

/** Minúsculas, sin tildes y con los separadores unificados. */
export function normalizeGuideText(value: string): string {
  const raw = String(value ?? '');
  if (raw.length > NORMALIZED_MEMO_LENGTH) return computeNormalized(raw);
  let normalized = NORMALIZED_MEMO.get(raw);
  if (normalized === undefined) {
    normalized = computeNormalized(raw);
    if (NORMALIZED_MEMO.size >= NORMALIZED_MEMO_MAX) NORMALIZED_MEMO.clear();
    NORMALIZED_MEMO.set(raw, normalized);
  }
  return normalized;
}

function computeNormalized(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/×/g, ' x ')
    .replace(/[^a-z0-9()[\]/:.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Equipos ---

/** Palabras que nunca valen como alias sueltos. */
export const WEAK_TEAM_WORDS: ReadonlySet<string> = new Set([
  'real',
  'madrid',
  'sporting',
  'racing',
  'union',
  'deportivo',
  'club',
  'city',
  /* «Atlético» solo es ambiguo (Sevilla Atlético, Atlético Nacional…): va con su ciudad. */
  'atletico',
  'united',
  'fc',
  'cf',
]);

const TEAM_PREFIXES = new Set([
  'real',
  'club',
  'cd',
  'ud',
  'sd',
  'rcd',
  'rc',
  'ca',
  'fc',
  'cf',
  'sad',
]);

/**
 * Alias curados de la guía (clave `footballTeamKey` → formas que usan las
 * guías). Pocos y con test; se amplía solo con casos reales.
 */
export const EPG_TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  barcelona: ['barcelona', 'barca', 'fc barcelona'],
  'atletico madrid': ['atletico de madrid', 'atletico madrid', 'atleti', 'at madrid', 'at. madrid'],
  'athletic club': ['athletic club', 'athletic bilbao', 'athletic club de bilbao', 'athletic'],
  'real betis': ['real betis', 'betis'],
  'celta vigo': ['celta de vigo', 'celta vigo', 'celta', 'rc celta'],
  celta: ['celta de vigo', 'celta vigo', 'celta', 'rc celta'],
  espanyol: ['espanyol', 'rcd espanyol'],
  'rcd espanyol': ['espanyol', 'rcd espanyol'],
  'rayo vallecano': ['rayo vallecano', 'rayo'],
  osasuna: ['osasuna', 'ca osasuna'],
  'ca osasuna': ['osasuna', 'ca osasuna'],
  'real sociedad': ['real sociedad'],
  'real madrid': ['real madrid'],
  villarreal: ['villarreal', 'villarreal cf'],
  sevilla: ['sevilla', 'sevilla fc'],
  valencia: ['valencia', 'valencia cf'],
  mallorca: ['mallorca', 'rcd mallorca'],
  'rcd mallorca': ['mallorca', 'rcd mallorca'],
  'deportivo alaves': ['alaves', 'deportivo alaves'],
  alaves: ['alaves', 'deportivo alaves'],
  'las palmas': ['las palmas', 'ud las palmas'],
  'ud las palmas': ['las palmas', 'ud las palmas'],
  'real valladolid': ['real valladolid', 'valladolid'],
  'real oviedo': ['real oviedo', 'oviedo'],
  'real zaragoza': ['real zaragoza', 'zaragoza'],
  'deportivo la coruna': ['deportivo de la coruna', 'deportivo la coruna', 'depor', 'rc deportivo'],
  'sporting gijon': ['sporting de gijon', 'sporting gijon'],
  'racing santander': ['racing de santander', 'racing santander'],
  inter: ['inter', 'inter de milan', 'inter milan', 'internazionale'],
  'manchester city': ['manchester city', 'man city'],
  'manchester united': ['manchester united', 'man united', 'man utd'],
  'paris saint germain': ['paris saint germain', 'psg', 'paris sg'],
  'bayern munich': ['bayern munich', 'bayern munchen', 'bayern'],
  /* Los nombres en castellano de las guías de Movistar+ («Nápoles», «Oporto»…). */
  napoli: ['napoli', 'napoles', 'ssc napoli'],
  'ssc napoli': ['napoli', 'napoles', 'ssc napoli'],
  juventus: ['juventus', 'juve'],
  'as roma': ['roma', 'as roma'],
  roma: ['roma', 'as roma'],
  lazio: ['lazio', 'ss lazio'],
  'ss lazio': ['lazio', 'ss lazio'],
  'fc porto': ['porto', 'oporto', 'fc porto'],
  porto: ['porto', 'oporto', 'fc porto'],
  'sporting cp': ['sporting cp', 'sporting de portugal', 'sporting lisboa', 'sporting de lisboa'],
  'sporting de portugal': ['sporting cp', 'sporting de portugal', 'sporting lisboa'],
  'sporting portugal': ['sporting cp', 'sporting de portugal', 'sporting lisboa'],
  benfica: ['benfica', 'sl benfica'],
  'sl benfica': ['benfica', 'sl benfica'],
  'olympique marseille': ['olympique de marsella', 'marsella', 'olympique marseille', 'marseille'],
  marseille: ['olympique de marsella', 'marsella', 'olympique marseille', 'marseille'],
  /* «O. Lyonnais», como lo abrevia futbolenlatv (football/scores.ts). */
  'olympique lyonnais': ['olympique de lyon', 'olympique lyonnais', 'lyon', 'o lyonnais'],
  lyon: ['olympique de lyon', 'olympique lyonnais', 'lyon', 'o lyonnais'],
  'club brugge': ['club brugge', 'brujas', 'club brujas'],
  'borussia dortmund': ['borussia dortmund', 'dortmund', 'b dortmund'],
  'bayer leverkusen': ['bayer leverkusen', 'leverkusen'],
  'rb leipzig': ['rb leipzig', 'leipzig'],
  'tottenham hotspur': ['tottenham hotspur', 'tottenham', 'spurs'],
  tottenham: ['tottenham hotspur', 'tottenham', 'spurs'],
  spurs: ['tottenham hotspur', 'tottenham', 'spurs'],
  'newcastle united': ['newcastle united', 'newcastle'],
  newcastle: ['newcastle united', 'newcastle'],
  'west ham united': ['west ham united', 'west ham'],
  'psv eindhoven': ['psv eindhoven', 'psv'],
  psv: ['psv eindhoven', 'psv'],
  /* Formas de las guías que la agenda escribe de otra manera (revisión de la agenda híbrida). */
  'brighton hove albion': ['brighton hove albion', 'brighton'],
  brighton: ['brighton hove albion', 'brighton'],
  'wolverhampton wanderers': ['wolverhampton wanderers', 'wolverhampton', 'wolves'],
  wolverhampton: ['wolverhampton wanderers', 'wolverhampton', 'wolves'],
  wolves: ['wolverhampton wanderers', 'wolverhampton', 'wolves'],
  'nottingham forest': ['nottingham forest', 'nottingham', 'nott m forest'],
  nottingham: ['nottingham forest', 'nottingham', 'nott m forest'],
  'borussia monchengladbach': [
    'borussia monchengladbach',
    'monchengladbach',
    'moenchengladbach',
    'b monchengladbach',
    'gladbach',
  ],
  monchengladbach: ['borussia monchengladbach', 'monchengladbach', 'b monchengladbach', 'gladbach'],
  'b monchengladbach': [
    'borussia monchengladbach',
    'monchengladbach',
    'b monchengladbach',
    'gladbach',
  ],
  gladbach: ['borussia monchengladbach', 'monchengladbach', 'b monchengladbach', 'gladbach'],
  'eintracht frankfurt': ['eintracht frankfurt', 'eintracht francfort', 'frankfurt', 'francfort'],
  'eintracht francfort': ['eintracht frankfurt', 'eintracht francfort', 'frankfurt', 'francfort'],
  colonia: ['colonia', 'koln', 'koeln', 'cologne', '1 fc koln'],
  koln: ['colonia', 'koln', 'koeln', 'cologne', '1 fc koln'],
  '1 fc koln': ['colonia', 'koln', 'koeln', 'cologne', '1 fc koln'],
  maguncia: ['maguncia', 'mainz', 'mainz 05', 'fsv mainz 05'],
  mainz: ['maguncia', 'mainz', 'mainz 05', 'fsv mainz 05'],
  'mainz 05': ['maguncia', 'mainz', 'mainz 05', 'fsv mainz 05'],
  '1 fsv mainz 05': ['maguncia', 'mainz', 'mainz 05', 'fsv mainz 05'],
  atalanta: ['atalanta', 'atalanta bc'],
  'atalanta bc': ['atalanta', 'atalanta bc'],
  fiorentina: ['fiorentina', 'acf fiorentina'],
  'acf fiorentina': ['fiorentina', 'acf fiorentina'],
  /* La Champions: futbolenlatv los escribe en castellano y las guías, muchas veces, como en su país
     (revisión de la agenda híbrida; football/scores.ts tiene los mismos con ESPN). */
  'crvena zvezda': [
    'crvena zvezda',
    'estrella roja',
    'estrella roja de belgrado',
    'red star belgrade',
    'red star belgrado',
  ],
  olympiacos: ['olympiacos', 'olympiakos', 'olympiacos pireo', 'olympiakos pireo'],
  'sparta praha': ['sparta praha', 'sparta de praga', 'sparta praga', 'sparta prague'],
  'slavia praha': ['slavia praha', 'slavia de praga', 'slavia praga', 'slavia prague'],
  'red bull salzburg': [
    'red bull salzburg',
    'rb salzburg',
    'salzburg',
    'salzburgo',
    'red bull salzburgo',
    'rb salzburgo',
  ],
  copenhagen: ['copenhagen', 'fc copenhagen', 'copenhague', 'fc copenhague'],
};

/* Forma de búsqueda de una entrada de la tabla (sin puntos ni partículas: «at. madrid» → «at madrid»). */
function aliasLookupKeys(value: string): string[] {
  const raw = normalizeGuideText(value)
    .replace(/[()[\]/:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const bare = raw
    .split(' ')
    .filter((word) => !['de', 'del', 'la', 'el'].includes(word))
    .join(' ');
  return [...new Set([raw, bare])].filter(Boolean);
}

/*
 * La tabla vale en los dos sentidos: cualquier forma de un grupo trae el grupo
 * entero. Así «Nápoles», «Oporto», «Brujas» o «Estrella Roja» (como escribe
 * futbolenlatv) encuentran «Napoli», «Porto», «Club Brugge» o «Crvena Zvezda»
 * (como escriben muchas guías), y al revés.
 */
const EPG_ALIAS_GROUPS: ReadonlyMap<string, readonly string[]> = (() => {
  const groups = new Map<string, Set<string>>();
  for (const [key, aliases] of Object.entries(EPG_TEAM_ALIASES)) {
    for (const form of [key, ...aliases]) {
      for (const lookup of aliasLookupKeys(form)) {
        const group = groups.get(lookup) ?? new Set<string>();
        for (const alias of aliases) group.add(alias);
        groups.set(lookup, group);
      }
    }
  }
  return new Map([...groups].map(([lookup, group]) => [lookup, [...group]]));
})();

/** Las formas de la tabla curada para un nombre (en cualquiera de sus formas). */
function epgAliases(base: string): readonly string[] {
  return EPG_ALIAS_GROUPS.get(base) ?? [];
}

/*
 * La forma corta con la que las guías escriben el primer nombre de un club:
 * «R. Madrid», «At. Madrid», «Atl. Madrid», «Ath. Club», «Dep. Alavés»,
 * «Sp. Gijón». Solo si lo que queda detrás no es una palabra débil.
 */
const SHORT_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  real: ['r'],
  atletico: ['at', 'atl'],
  athletic: ['ath'],
  deportivo: ['dep'],
  sporting: ['sp'],
};

/* Lo que va detrás del alias y lo convierte en el filial o el femenino. */
const RESERVE_AFTER_RE =
  /^\s*[([]?\s*(?:b|c|ii|iii|femenino|femenina|fem|femeni|women|sub[\s-]?\d{2}|u[\s-]?\d{2}|juvenil|atletic|castilla|atletico|deportivo|promesas|mestalla|academy|sc|leyendas|legends|veteranos)\b/;
/* Lo que va delante del alias y lo convierte en otro equipo («Bilbao Athletic», «Leyendas del Real Madrid»). */
const RESERVE_BEFORE_RE = /\b(?:bilbao|leyendas|legends|veteranos)\s*$/;

/* Partículas que unas guías ponen y otras no («Bayern de Múnich», «Celta de Vigo»). */
const TEAM_PARTICLES_RE = /(?<![a-z0-9])(?:de|del|la|el)(?![a-z0-9])/g;

/**
 * Texto para buscar equipos: el de `normalizeGuideText` sin puntos («R.
 * Madrid» → «r madrid») ni partículas. Los alias pasan por lo mismo, así que
 * «Bayern de Múnich» y «Bayern Múnich» se encuentran el uno al otro.
 */
export function teamSearchText(value: string): string {
  return teamSearchFromNormalized(normalizeGuideText(value));
}

/** `teamSearchText` sobre un texto ya pasado por `normalizeGuideText` (para no normalizarlo dos veces). */
function teamSearchFromNormalized(normalized: string): string {
  return normalized
    .replace(/[()[\]/:.]/g, (char) => (char === '/' ? ' / ' : ' '))
    .replace(TEAM_PARTICLES_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alias de un equipo para buscarlo en la guía (sin los débiles), en la forma de `teamSearchText`. */
export function teamAliases(name: string, extra: readonly string[] = []): string[] {
  const out = new Set<string>();
  const add = (value: string): void => {
    const alias = teamSearchText(value).replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
    if (!alias || WEAK_TEAM_WORDS.has(alias) || alias.length < 3) return;
    out.add(alias);
  };
  const raw = normalizeGuideText(name)
    .replace(/[()[\]/:.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  add(raw);
  const key = footballTeamKey(name);
  add(key);
  /* «Racing de Santander» también es «Racing Santander» en las guías. */
  const withoutParticles = raw
    .split(' ')
    .filter((word) => !['de', 'del', 'la', 'el'].includes(word))
    .join(' ');
  for (const base of [raw, key, withoutParticles]) {
    const words = base.split(' ').filter(Boolean);
    const stripped = words.filter((word) => !TEAM_PREFIXES.has(word)).join(' ');
    if (stripped.replace(/\s/g, '').length >= 5) add(stripped);
    for (const alias of epgAliases(base)) add(alias);
    /* «R. Madrid», «At. Madrid», «Ath. Club»: la forma corta del primer nombre
       (con lo de detrás, «r madrid» ya no es la palabra débil «madrid»). */
    const [first = '', ...rest] = words;
    const tail = rest.filter((word) => !['de', 'del', 'la', 'el'].includes(word)).join(' ');
    if (tail) for (const short of SHORT_PREFIXES[first] ?? []) add(`${short} ${tail}`);
  }
  for (const alias of epgAliases(key)) add(alias);
  for (const value of extra) {
    const clean = normalizeGuideText(value);
    /* Las abreviaturas de 3 letras van aparte (solo en el patrón compacto). */
    if (/^[a-z]{3}$/.test(clean)) continue;
    add(value);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Abreviaturas de 3 letras (solo del nombre corto de TheSportsDB). */
export function teamAbbreviations(extra: readonly string[] = []): string[] {
  return [
    ...new Set(
      extra.map((value) => normalizeGuideText(value)).filter((value) => /^[a-z]{3}$/.test(value)),
    ),
  ];
}

interface Occurrence {
  readonly start: number;
  readonly end: number;
}

/* Apariciones de un alias como palabras completas que no son el filial. */
function occurrences(text: string, alias: string): Occurrence[] {
  const out: Occurrence[] = [];
  const re = new RegExp(`(?<![a-z0-9])${escapeRe(alias)}(?![a-z0-9])`, 'g');
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (RESERVE_AFTER_RE.test(text.slice(end, end + 16))) continue;
    if (RESERVE_BEFORE_RE.test(text.slice(Math.max(0, start - 12), start))) continue;
    out.push({ start, end });
  }
  return out;
}

const SEPARATOR_RE = /^\s*(?:-|vs\.?|v\.?|x|contra|\/)\s*$/;
const MAX_GAP = 40;
/* Siglas de club que pueden quedar entre el alias y el separador: «Girona FC - Sevilla FC», «Napoli - AS Roma»,
   «Atalanta BC - ACF Fiorentina», «Sporting CP - SL Benfica», «SC Freiburg», «VfB Stuttgart». */
const CLUB_AFFIXES: ReadonlySet<string> = new Set([
  'fc',
  'cf',
  'ud',
  'cd',
  'sd',
  'rcd',
  'rc',
  'ac',
  'afc',
  'acf',
  'bc',
  'sad',
  'ssc',
  'as',
  'ss',
  'sl',
  'cp',
  'sc',
  'sv',
  'bsc',
  'vfb',
  'vfl',
  'tsg',
  'fk',
  'us',
  'ogc',
]);

/**
 * Las palabras que de verdad nombran a un equipo, sin siglas de club,
 * prefijos (real, club…) ni partículas: «Atalanta BC» → [atalanta], «ACF
 * Fiorentina» → [fiorentina], «Brighton & Hove Albion» → [brighton, hove,
 * albion]. Para saber si dos grafías pueden ser el mismo equipo (agenda
 * híbrida: no añadir dos veces un partido), no para emparejar.
 */
export function teamCoreWords(name: string): string[] {
  return teamSearchText(name)
    .replace(/\//g, ' ')
    .split(' ')
    .filter((word) => word && !CLUB_AFFIXES.has(word) && !TEAM_PREFIXES.has(word));
}

/** El hueco entre dos equipos sin las siglas de club de los bordes. */
function bareGap(gap: string): string {
  const words = gap.trim().split(/\s+/);
  while (words.length > 1 && CLUB_AFFIXES.has(words[0] as string)) words.shift();
  while (words.length > 1 && CLUB_AFFIXES.has(words[words.length - 1] as string)) words.pop();
  return words.join(' ');
}

/**
 * ¿Están los dos equipos en este texto (ya pasado por `teamSearchText`),
 * cerca y separados por un separador de enfrentamiento?
 */
export function teamsInText(
  text: string,
  home: readonly string[],
  away: readonly string[],
): boolean {
  const homeHits = home.flatMap((alias) => occurrences(text, alias));
  if (!homeHits.length) return false;
  const awayHits = away.flatMap((alias) => occurrences(text, alias));
  for (const h of homeHits) {
    for (const a of awayHits) {
      const [first, second] = h.end <= a.start ? [h, a] : a.end <= h.start ? [a, h] : [null, null];
      if (!first || !second) continue;
      const gap = text.slice(first.end, second.start);
      if (gap.length <= MAX_GAP && SEPARATOR_RE.test(bareGap(gap))) return true;
    }
  }
  return false;
}

/* Patrón compacto de abreviaturas: «RSO-VIL», «RSO v VIL». */
function abbreviationsInText(
  text: string,
  home: readonly string[],
  away: readonly string[],
): boolean {
  for (const h of home) {
    for (const a of away) {
      const re = new RegExp(
        `(?<![a-z0-9])(?:${h}\\s*(?:-|v|vs)\\s*${a}|${a}\\s*(?:-|v|vs)\\s*${h})(?![a-z0-9])`,
      );
      if (re.test(text)) return true;
    }
  }
  return false;
}

// --- Marcas de «no es el partido» ---

const NOT_LIVE_RE = new RegExp(
  [
    '\\((?:r|d)\\)',
    '\\[(?:r|d)\\]',
    '^r:',
    '\\b(?:repeticion|reemision|diferido|grabado|replay)\\b',
    '\\(dif\\.?\\)|\\[dif\\.?\\]|\\bdif\\.',
    '\\b(?:resumen|resumenes|highlights|mejores momentos|goles de)\\b',
    '\\b(?:previa|prepartido|pre-partido|postpartido|post partido|post-partido)\\b',
    '\\b(?:rueda de prensa|analisis|tertulia|magazine)\\b',
    /* Partidos de archivo: «Partidos históricos», «Real Madrid - Barcelona (2010)». */
    '\\b(?:historico|historicos|partidos para la historia)\\b',
    '\\((?:19|20)\\d\\d\\)',
  ].join('|'),
);
const NOT_LIVE_CATEGORY_RE =
  /\b(?:news|magazine|talk|noticias|informativo|entrevista|documental|documentary)\b/;
const LIVE_MARK_RE = /\b(?:directo|en vivo|live)\b|\(l\)/;

/** ¿El programa dice que no es el partido en directo? */
export function isNotLive(programme: GuideProgramme): boolean {
  const cached = NOT_LIVE_MEMO.get(programme);
  if (cached !== undefined) return cached;
  const value = computeNotLive(programme);
  NOT_LIVE_MEMO.set(programme, value);
  return value;
}

/* Los programas de una guía no cambian (son de solo lectura): lo que se
   calcula de su texto se guarda junto a ellos y se va con ellos. La agenda
   híbrida mira cada programa una vez por partido de hoy y mañana. */
const NOT_LIVE_MEMO = new WeakMap<GuideProgramme, boolean>();
const TEXTS_MEMO = new WeakMap<GuideProgramme, string[]>();
const TEAM_TEXTS_MEMO = new WeakMap<GuideProgramme, string[]>();
const LIVE_MEMO = new WeakMap<GuideProgramme, boolean>();

function computeNotLive(programme: GuideProgramme): boolean {
  if (programme.previouslyShown) return true;
  /* Los textos normalizados de `programmeTexts` (título, subtítulo, descripción y categorías), con memoria. */
  const texts = programmeTexts(programme);
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] ?? '';
    if ((index < 3 ? NOT_LIVE_RE : NOT_LIVE_CATEGORY_RE).test(text)) return true;
  }
  return false;
}

// --- Otros deportes, femenino y categorías inferiores ---

/* Mismos equipos, otro deporte: el Real Madrid - Barça de la ACB o del balonmano. Y lo que se
   llama como una competición de fútbol sin serlo: «EHF Champions League», «Premier League Darts»,
   «Mundial de Snooker», «eLaLiga», «Mundial de Fútbol 7». */
const OTHER_SPORT_RE = new RegExp(
  String.raw`\b(?:${[
    'baloncesto|basket|basketball|basquet|acb|liga endesa|euroliga|euroleague|eurocup|nba',
    'futsal|futbol sala|balonmano|handball|asobal|ehf|voleibol|voley|volleyball|waterpolo',
    'hockey|rugby|tenis|padel|futbol playa|beach soccer',
    'futbol 7|futbol siete|futbol 5|futbol para ciegos|futbol de ciegos',
    'futbol americano|american football|nfl|beisbol|baseball|mlb|cricket',
    'darts|dardos|snooker|billar|golf|boxeo|boxing|ufc|mma',
    'formula 1|formula uno|motogp|moto gp|motociclismo|automovilismo|ciclismo',
    'esports|e-sports|efootball|elaliga|kings league|queens league',
  ].join('|')})\b`,
);
/* El femenino, también entre paréntesis: «(Femenino)», «(Fem.)». */
const WOMEN_RE = /\b(?:femenino|femenina|femeni|fem|women|womens|ladies)\b/;
/* Categorías inferiores (la «Premier League 2» es la liga sub-21; la «Primavera», la juvenil italiana). */
const YOUTH_RE =
  /\b(?:youth league|uefa youth|juvenil|sub[\s-]?\d{2}|u[\s-]?\d{2}|premier league 2|pl2|campionato primavera|primavera 1|next ?gen)\b/;

/** Título, subtítulo, descripción y categorías, normalizados. */
export function programmeTexts(programme: GuideProgramme): string[] {
  let texts = TEXTS_MEMO.get(programme);
  if (!texts) {
    texts = [programme.title, programme.subTitle, programme.desc, ...programme.categories].map(
      (field) => normalizeGuideText(field),
    );
    TEXTS_MEMO.set(programme, texts);
  }
  return texts;
}

/** Título, subtítulo y descripción en la forma de `teamSearchText` (para buscar equipos). */
export function programmeTeamTexts(programme: GuideProgramme): string[] {
  let texts = TEAM_TEXTS_MEMO.get(programme);
  if (!texts) {
    const normalized = programmeTexts(programme);
    texts = [0, 1, 2].map((index) => {
      const text = normalized[index] ?? '';
      return text ? teamSearchFromNormalized(text) : '';
    });
    TEAM_TEXTS_MEMO.set(programme, texts);
  }
  return texts;
}

/** ¿El programa es de otro deporte, del femenino o de una categoría inferior (y el partido no)? */
export function isOtherEvent(
  programme: GuideProgramme,
  input: GuideMatchInput,
  /** Lo del partido ya calculado (`matchEventKind`), para no repetirlo en cada programa. */
  kind: MatchEventKind = matchEventKind(input),
): boolean {
  const marks = programmeEventMarks(programme);
  return marks.otherSport || (!kind.women && marks.women) || (!kind.youth && marks.youth);
}

/** ¿El partido es femenino o de categorías inferiores? */
export interface MatchEventKind {
  readonly women: boolean;
  readonly youth: boolean;
}

export function matchEventKind(
  input: Pick<GuideMatchInput, 'competition' | 'title'>,
): MatchEventKind {
  const matchText = normalizeGuideText(`${input.competition} ${input.title ?? ''}`);
  return {
    women: WOMEN_RE.test(matchText) || matchFamily(input) === 'ligaf',
    youth: YOUTH_RE.test(matchText),
  };
}

const EVENT_MARKS_MEMO = new WeakMap<
  GuideProgramme,
  { readonly otherSport: boolean; readonly women: boolean; readonly youth: boolean }
>();

/* Otro deporte, femenino o cantera en algún campo o categoría del programa (una vez por programa). */
function programmeEventMarks(programme: GuideProgramme): {
  readonly otherSport: boolean;
  readonly women: boolean;
  readonly youth: boolean;
} {
  let marks = EVENT_MARKS_MEMO.get(programme);
  if (!marks) {
    const texts = programmeTexts(programme);
    marks = {
      otherSport: texts.some((text) => OTHER_SPORT_RE.test(text)),
      women: texts.some((text) => WOMEN_RE.test(text)),
      youth: texts.some((text) => YOUTH_RE.test(text)),
    };
    EVENT_MARKS_MEMO.set(programme, marks);
  }
  return marks;
}

/** ¿La guía dice que va en directo? (`<live/>`, «directo», «en vivo» o «(L)» en el título o el subtítulo). */
export function hasLiveMark(programme: GuideProgramme): boolean {
  if (programme.live) return true;
  let value = LIVE_MEMO.get(programme);
  if (value === undefined) {
    value = [programme.title, programme.subTitle].some((field) =>
      LIVE_MARK_RE.test(normalizeGuideText(field)),
    );
    LIVE_MEMO.set(programme, value);
  }
  return value;
}

// --- Competiciones ---

export type CompetitionFamily =
  | 'laliga'
  | 'hypermotion'
  | 'ligaf'
  | 'champions'
  | 'europa'
  | 'conference'
  | 'copa'
  | 'supercopa'
  | 'premier'
  | 'seriea'
  | 'bundesliga'
  | 'ligue1'
  | 'nations'
  | 'mundial'
  | 'euro';

/* Orden: las más concretas antes (Hypermotion antes que LaLiga, Liga F antes que LaLiga). */
export const COMPETITION_FAMILIES: readonly (readonly [CompetitionFamily, RegExp])[] = [
  [
    'hypermotion',
    /\b(?:(?:laliga |la liga )?(?:hypermotion|smartbank)|segunda division|laliga 2)\b/,
  ],
  ['ligaf', /\b(?:liga f|primera (?:division )?femenina|liga femenina)\b/],
  ['champions', /\b(?:champions(?: league)?|liga de campeones)\b/],
  ['europa', /\beuropa league\b/],
  ['conference', /\bconference league\b/],
  ['supercopa', /\bsupercopa\b/],
  ['copa', /\bcopa del rey\b/],
  ['premier', /\bpremier(?: league)?\b/],
  ['seriea', /\bserie a\b/],
  ['bundesliga', /\bbundesliga\b/],
  ['ligue1', /\bligue 1\b/],
  ['nations', /\b(?:nations league|liga de (?:las )?naciones)\b/],
  ['mundial', /\b(?:mundial|copa del mundo|world cup)\b/],
  ['euro', /\b(?:eurocopa|euro 20\d\d)\b/],
  ['laliga', /\b(?:laliga|la liga|primera division|liga ea sports)\b/],
];

/** Familia de competición que nombra un texto, o null. */
export function competitionFamily(value: string): CompetitionFamily | null {
  const cached = FAMILY_MEMO.get(value);
  if (cached !== undefined) return cached;
  const text = normalizeGuideText(value);
  let found: CompetitionFamily | null = null;
  if (text) {
    for (const [family, re] of COMPETITION_FAMILIES) {
      if (re.test(text)) {
        found = family;
        break;
      }
    }
  }
  /* Los nombres de canal se repiten mucho; la memoria no crece sin tope. */
  if (FAMILY_MEMO.size >= 4096) FAMILY_MEMO.clear();
  FAMILY_MEMO.set(value, found);
  return found;
}

const FAMILY_MEMO = new Map<string, CompetitionFamily | null>();

/**
 * Todas las familias que nombra un texto. Cada acierto se quita antes de
 * seguir, para que «LaLiga Hypermotion» no cuente también como LaLiga.
 */
export function competitionFamilies(value: string): Set<CompetitionFamily> {
  let text = normalizeGuideText(value);
  const out = new Set<CompetitionFamily>();
  if (!text) return out;
  for (const [family, re] of COMPETITION_FAMILIES) {
    const global = new RegExp(re.source, 'g');
    if (!global.test(text)) continue;
    out.add(family);
    text = text.replace(new RegExp(re.source, 'g'), ' ');
  }
  return out;
}

/** Familia del partido (competición y título; Hypermotion también por el título). */
export function matchFamily(
  input: Pick<GuideMatchInput, 'competition' | 'title'>,
): CompetitionFamily | null {
  return competitionFamily(`${input.competition} ${input.title ?? ''}`);
}

// --- Hora ---

/** ¿Dura lo que un partido? (regla 1, sin mirar la hora). */
export function programmeLastsAMatch(programme: Pick<GuideProgramme, 'start' | 'stop'>): boolean {
  const duration = programme.stop - programme.start;
  return duration >= GUIDE_MIN_DURATION_MS && duration <= GUIDE_MAX_DURATION_MS;
}

/** Regla 1: el programa cae a la hora del partido y dura lo de un partido. */
export function programmeFitsKickoff(programme: GuideProgramme, kickoff: number): boolean {
  const withPrevia = programme.start < kickoff - GUIDE_PREVIA_MS;
  return (
    programme.start >= kickoff - GUIDE_EARLY_MS &&
    programme.start <= kickoff + GUIDE_LATE_MS &&
    programmeLastsAMatch(programme) &&
    programme.stop >=
      kickoff + (withPrevia ? GUIDE_PREVIA_AFTER_KICKOFF_MS : GUIDE_AFTER_KICKOFF_MS)
  );
}

const QUARTER = 15 * MINUTE;

/**
 * Saque que se deduce de un programa (agenda híbrida, cuando la guía mueve la
 * hora o trae un partido que no está en la agenda): las guías empiezan el
 * programa unos minutos antes, así que se redondea al cuarto de hora
 * siguiente (20:50 → 21:00, 18:25 → 18:30, 21:00 → 21:00). Si así el
 * programa ya no cubre el partido entero (regla 1), su inicio tal cual; si
 * tampoco, null.
 */
export function kickoffFromProgramme(programme: GuideProgramme): number | null {
  if (!programmeLastsAMatch(programme)) return null;
  const start = Math.floor(programme.start / MINUTE) * MINUTE;
  const rounded = Math.ceil(start / QUARTER) * QUARTER;
  if (programmeFitsKickoff(programme, rounded)) return rounded;
  if (programmeFitsKickoff(programme, start)) return start;
  return null;
}

/** Alias de los dos equipos de un partido, listos para `programmeHasTeams`. */
export interface TeamCache {
  readonly home: string[];
  readonly away: string[];
  readonly homeAbbr: string[];
  readonly awayAbbr: string[];
}

export function teamCache(
  input: Pick<GuideMatchInput, 'home' | 'away' | 'homeAliases' | 'awayAliases'>,
): TeamCache {
  return {
    home: teamAliases(input.home, input.homeAliases),
    away: teamAliases(input.away, input.awayAliases),
    homeAbbr: teamAbbreviations(input.homeAliases),
    awayAbbr: teamAbbreviations(input.awayAliases),
  };
}

/**
 * Regla 2: los dos equipos en el mismo campo (título, subtítulo o
 * descripción). Con `'title'`, solo en el título o el subtítulo: lo que pide
 * la agenda híbrida para MOVER la hora de un partido (la descripción de un
 * partido nombra a menudo otro: «Esta noche, Real Madrid - Barcelona»).
 */
export function programmeHasTeams(
  programme: GuideProgramme,
  cache: TeamCache,
  where: 'all' | 'title' = 'all',
): boolean {
  const texts = programmeTeamTexts(programme);
  const fields =
    where === 'title'
      ? [programme.title, programme.subTitle]
      : [programme.title, programme.subTitle, programme.desc];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const text = texts[index] ?? '';
    if (!field || !text) continue;
    /* Antes de las expresiones regulares, la cuenta barata: algún alias de cada equipo dentro. */
    if (
      cache.home.some((alias) => text.includes(alias)) &&
      cache.away.some((alias) => text.includes(alias)) &&
      teamsInText(text, cache.home, cache.away)
    ) {
      return true;
    }
    if (
      cache.homeAbbr.length &&
      cache.awayAbbr.length &&
      abbreviationsInText(normalizeGuideText(field), cache.homeAbbr, cache.awayAbbr)
    ) {
      return true;
    }
  }
  return false;
}

/** Reglas 1 a 4 para un programa (sin mirar el canal). */
export function programmeShowsMatch(
  programme: GuideProgramme,
  input: GuideMatchInput,
  cache: TeamCache,
  family: CompetitionFamily | null,
  /** Familia que nombra el canal («DAZN LaLiga» → laliga), o null. */
  channelFamily: CompetitionFamily | null = null,
  kind: MatchEventKind = matchEventKind(input),
): boolean {
  if (!programmeFitsKickoff(programme, input.start)) return false;
  if (isNotLive(programme)) return false;
  if (isOtherEvent(programme, input, kind)) return false;
  if (!programmeHasTeams(programme, cache)) return false;
  if (family) {
    /* La familia del partido sale en el texto (y ninguna otra) o, si el texto
       no nombra ninguna, en el nombre del canal. Mejor no emparejar que mal. */
    const named = programmeFamilies(programme);
    if (named.size) return named.size === 1 && named.has(family);
    return channelFamily === family;
  }
  return true;
}

const FAMILIES_MEMO = new WeakMap<GuideProgramme, ReadonlySet<CompetitionFamily>>();

/** Las familias de competición que nombra el programa (título, subtítulo, descripción y categorías). */
export function programmeFamilies(programme: GuideProgramme): ReadonlySet<CompetitionFamily> {
  let families = FAMILIES_MEMO.get(programme);
  if (!families) {
    families = competitionFamilies(programmeTexts(programme).join(' | '));
    FAMILIES_MEMO.set(programme, families);
  }
  return families;
}

/**
 * Canales IPTV confirmados por la guía para un partido, de más a menos
 * seguros. Vacío si no hay ninguno o si hay demasiados sin apoyo de la agenda.
 */
export function confirmByGuide(
  input: GuideMatchInput,
  candidates: readonly GuideChannelCandidate[],
  options: GuideMatchOptions,
): GuideConfirmation[] {
  if (!Number.isFinite(input.start) || !input.home.trim() || !input.away.trim()) return [];
  const cache = teamCache(input);
  if (!cache.home.length || !cache.away.length) return [];
  const family = matchFamily(input);
  const kind = matchEventKind(input);
  const hasAgenda = input.channels.some((channel) => channel.trim() !== '');
  const confirmed: (GuideConfirmation & { readonly liveMark: boolean })[] = [];
  for (const candidate of candidates) {
    /* Regla 1 primero (solo números): casi ningún canal tiene algo a esa hora,
       y así lo caro (el nombre del canal) se mira solo cuando hace falta. */
    const timely = candidate.programmes.filter((programme) =>
      programmeFitsKickoff(programme, input.start),
    );
    if (!timely.length) continue;
    /* Regla 5: país y competición del nombre del canal (otro país, fuera ya; sin país, abajo). */
    if (candidate.country !== 'ES' && candidate.country !== null) continue;
    const channelFamily = competitionFamily(candidate.display);
    if (family && channelFamily && channelFamily !== family) continue;
    const shows = timely.filter((programme) =>
      programmeShowsMatch(programme, input, cache, family, channelFamily, kind),
    );
    if (!shows.length) continue;
    /* El casamiento con la agenda (lo caro del nombre), solo para los canales que dan el partido. */
    const agendaScore = hasAgenda ? options.agendaScore(candidate.display) : 0;
    if (candidate.country === null && (!hasAgenda || agendaScore < LIBRARY_MIN_SCORE)) continue;
    const best =
      shows.find(hasLiveMark) ??
      [...shows].sort(
        (a, b) => Math.abs(a.start - input.start) - Math.abs(b.start - input.start),
      )[0];
    if (!best) continue;
    confirmed.push({
      key: candidate.key,
      display: candidate.display,
      programme: best,
      agendaScore,
      liveMark: hasLiveMark(best),
    });
  }
  /* Regla 6: demasiados canales distintos → solo los que apoya la agenda. */
  let kept = confirmed;
  if (new Set(confirmed.map((item) => item.key)).size > IPTV_GUIDE_AMBIGUOUS_CHANNELS) {
    kept = confirmed.filter((item) => item.agendaScore >= LIBRARY_MIN_SCORE);
  }
  return kept
    .sort(
      (a, b) =>
        Number(b.liveMark) - Number(a.liveMark) ||
        b.agendaScore - a.agendaScore ||
        Math.abs(a.programme.start - input.start) - Math.abs(b.programme.start - input.start),
    )
    .map(({ liveMark: _liveMark, ...item }) => item);
}

// --- Partidos que solo trae la guía (agenda híbrida) ---

/** Rótulo de una familia cuando la agenda no trae ningún partido de ella. */
export const COMPETITION_FAMILY_LABELS: Readonly<Record<CompetitionFamily, string>> = {
  laliga: 'LaLiga EA Sports',
  hypermotion: 'LaLiga Hypermotion',
  ligaf: 'Liga F',
  champions: 'Champions League',
  europa: 'Europa League',
  conference: 'Conference League',
  copa: 'Copa del Rey',
  supercopa: 'Supercopa de España',
  premier: 'Premier League',
  seriea: 'Serie A',
  bundesliga: 'Bundesliga',
  ligue1: 'Ligue 1',
  nations: 'Nations League',
  mundial: 'Mundial',
  euro: 'Eurocopa',
};

/* Separadores de enfrentamiento CON espacios alrededor: el guion de
   «Paris Saint-Germain» no separa nada. */
const MATCHUP_SEPARATOR_RE = /\s+(?:-|–|—|vs\.?|v\.?|contra)\s+/giu;
/* Un punto que cierra una frase, no el de una abreviatura («R. Sociedad», «At. Madrid», «C.F.»). */
const SENTENCE_DOT = String.raw`(?<!(?:^|[\s(.])\p{L}{1,4})\.(?:\s|$)`;
/* Lo que va antes del local («LaLiga EA Sports. Jornada 7: …», «Fútbol | …»). */
const BEFORE_HOME_RE = new RegExp(
  String.raw`^.*(?::|\||»|·|${SENTENCE_DOT}|\)\s|\]\s|\s[-–—]\s)`,
  'u',
);
/* Lo que va después del visitante («… (Directo)», «…, desde el Camp Nou», «…. Jornada 7»). */
const AFTER_AWAY_RE = new RegExp(String.raw`(?:\s*[([|,:·]|${SENTENCE_DOT}|\s[-–—]\s).*$`, 'u');
/* Si así no sale un nombre, cualquier punto corta («Villarreal CF. Jornada 7»). */
const AFTER_AWAY_LOOSE_RE = /\.(?:\s|$).*$/u;
/* «Directo:», «(Directo)», «En vivo», «(L)» al principio o al final (palabras enteras: «Liverpool» no). */
const LIVE_PREFIX_RE =
  /^(?:\(\s*)?(?:en\s+)?(?:directo|en vivo|live)(?![\p{L}\p{N}])(?:\s*\))?\s*[:\-–]?\s*/iu;
const LIVE_SUFFIX_RE =
  /(?:\s+(?:en\s+)?(?:directo|vivo|live)|\s*\(\s*(?:en\s+)?(?:directo|vivo|live|l)\s*\))\s*$/iu;
/* Palabras que no forman parte del nombre de un equipo. */
const NOT_A_TEAM_RE =
  /\b(?:jornada|futbol|liga|copa|partido|partidos|temporada|grupo|final|semifinal|semifinales|cuartos|octavos|dieciseisavos|directo|resumen|previa|programa|especial|highlights|league|serie|campeonato|torneo|amistoso|sports|deportes|confirmar|determinar|definir|tbd|tba|ganador|perdedor|vencedor|winner|loser)\b/;
/* Otro enfrentamiento dentro de un nombre: «Real Madrid vs Barcelona» no es un equipo. */
const INNER_SEPARATOR_RE = /\s(?:-|–|—|vs\.?|v\.?|contra|\/)\s/iu;
/* En un título con varios enfrentamientos, «Juventus y Liverpool» tampoco. */
const INNER_LIST_RE = /\s(?:y|e|and|&)\s|,/iu;

function withoutLiveWords(value: string): string {
  return value.replace(LIVE_PREFIX_RE, '').replace(LIVE_SUFFIX_RE, '').trim();
}

/** Mayúsculas de guía («REAL MADRID») a nombre normal («Real Madrid»); siglas de 2-3 letras, tal cual. */
function tidyTeamName(value: string): string {
  const name = value
    .replace(/\s+/g, ' ')
    .replace(/[\s.\-–—]+$/u, '')
    .trim();
  if (name !== name.toUpperCase() || !/\p{L}{4}/u.test(name)) return name;
  return name
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (['de', 'del', 'la', 'el', 'y'].includes(lower)) return lower;
      if (word.length <= 3 && /^\p{Lu}+$/u.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function plausibleTeam(name: string, severalMatchups = false): boolean {
  if (name.length < 3 || name.length > 40) return false;
  if (!/\p{L}{2}/u.test(name)) return false;
  if (name.split(/\s+/).length > 5) return false;
  if (INNER_SEPARATOR_RE.test(name) || (severalMatchups && INNER_LIST_RE.test(name))) return false;
  const text = normalizeGuideText(name);
  if (!text || WEAK_TEAM_WORDS.has(text)) return false;
  return !NOT_A_TEAM_RE.test(text) && competitionFamily(text) === null;
}

/**
 * Los dos equipos de un texto de la guía («LaLiga EA Sports. Jornada 7: Real
 * Sociedad - Villarreal», «Fútbol: Real Madrid vs. Barcelona (Directo)»), con
 * sus nombres tal cual (sin las mayúsculas de guía), o null si no hay un
 * enfrentamiento claro. Prueba cada separador, de izquierda a derecha. Nada
 * de dos enfrentamientos en un título («Real Madrid - Juventus y Liverpool -
 * Bayern»), equipos por decidir («Por confirmar», «Ganador A») ni el mismo
 * nombre a los dos lados.
 */
export function extractGuideMatchup(value: string): { home: string; away: string } | null {
  const text = withoutLiveWords(String(value ?? '').replace(/\s+/g, ' '));
  if (!text) return null;
  const separators = [...text.matchAll(MATCHUP_SEPARATOR_RE)];
  const several = separators.length > 1;
  for (const separator of separators) {
    const at = separator.index ?? 0;
    const left = text.slice(0, at).replace(BEFORE_HOME_RE, '');
    const right = text.slice(at + separator[0].length).replace(AFTER_AWAY_RE, '');
    const home = tidyTeamName(withoutLiveWords(left));
    let away = tidyTeamName(withoutLiveWords(right));
    if (!plausibleTeam(away, several))
      away = tidyTeamName(withoutLiveWords(right.replace(AFTER_AWAY_LOOSE_RE, '')));
    if (!plausibleTeam(home, several) || !plausibleTeam(away, several)) continue;
    if (normalizeGuideText(home) === normalizeGuideText(away)) continue;
    return { home, away };
  }
  return null;
}
