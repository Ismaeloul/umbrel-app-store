/* La guía para encontrar el canal del partido (docs/iptv.md §4.5). Puro.

   Una entrada IPTV queda CONFIRMADA POR LA GUÍA solo si TODO esto se cumple:

   1. Hora: el programa empieza entre 60 min antes y 15 min después del
      saque, dura entre 80 y 240 min y acaba al menos 90 min después del saque
      (agenda híbrida, D-propuesta: antes eran 30 min antes; hay guías que
      meten la previa en el mismo programa y las dos reglas de la duración
      ya impiden que cuele otro programa).
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

/** Minúsculas, sin tildes y con los separadores unificados. */
export function normalizeGuideText(value: string): string {
  return String(value ?? '')
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
  benfica: ['benfica', 'sl benfica'],
  'sl benfica': ['benfica', 'sl benfica'],
  'olympique marseille': ['olympique de marsella', 'marsella', 'olympique marseille', 'marseille'],
  marseille: ['olympique de marsella', 'marsella', 'olympique marseille', 'marseille'],
  'olympique lyonnais': ['olympique de lyon', 'olympique lyonnais', 'lyon'],
  lyon: ['olympique de lyon', 'olympique lyonnais', 'lyon'],
  'club brugge': ['club brugge', 'brujas', 'club brujas'],
  'borussia dortmund': ['borussia dortmund', 'dortmund', 'b dortmund'],
  'bayer leverkusen': ['bayer leverkusen', 'leverkusen'],
  'rb leipzig': ['rb leipzig', 'leipzig'],
  'tottenham hotspur': ['tottenham hotspur', 'tottenham'],
  tottenham: ['tottenham hotspur', 'tottenham'],
  'newcastle united': ['newcastle united', 'newcastle'],
  newcastle: ['newcastle united', 'newcastle'],
  'west ham united': ['west ham united', 'west ham'],
  'psv eindhoven': ['psv eindhoven', 'psv'],
  psv: ['psv eindhoven', 'psv'],
};

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
  /^\s*[([]?\s*(?:b|c|ii|iii|femenino|femenina|fem|femeni|women|sub[\s-]?\d{2}|u[\s-]?\d{2}|juvenil|atletic|castilla|atletico|deportivo|promesas|mestalla|academy|sc)\b/;
/* Lo que va delante del alias y lo convierte en otro equipo («Bilbao Athletic»). */
const RESERVE_BEFORE_RE = /\b(?:bilbao)\s*$/;

/* Partículas que unas guías ponen y otras no («Bayern de Múnich», «Celta de Vigo»). */
const TEAM_PARTICLES_RE = /(?<![a-z0-9])(?:de|del|la|el)(?![a-z0-9])/g;

/**
 * Texto para buscar equipos: el de `normalizeGuideText` sin puntos («R.
 * Madrid» → «r madrid») ni partículas. Los alias pasan por lo mismo, así que
 * «Bayern de Múnich» y «Bayern Múnich» se encuentran el uno al otro.
 */
export function teamSearchText(value: string): string {
  return normalizeGuideText(value)
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
    for (const alias of EPG_TEAM_ALIASES[base] ?? []) add(alias);
    /* «R. Madrid», «At. Madrid», «Ath. Club»: la forma corta del primer nombre
       (con lo de detrás, «r madrid» ya no es la palabra débil «madrid»). */
    const [first = '', ...rest] = words;
    const tail = rest.filter((word) => !['de', 'del', 'la', 'el'].includes(word)).join(' ');
    if (tail) for (const short of SHORT_PREFIXES[first] ?? []) add(`${short} ${tail}`);
  }
  for (const alias of EPG_TEAM_ALIASES[key] ?? []) add(alias);
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
      if (gap.length <= MAX_GAP && SEPARATOR_RE.test(gap)) return true;
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
  if (programme.previouslyShown) return true;
  for (const field of [programme.title, programme.subTitle, programme.desc]) {
    if (NOT_LIVE_RE.test(normalizeGuideText(field))) return true;
  }
  return programme.categories.some((category) =>
    NOT_LIVE_CATEGORY_RE.test(normalizeGuideText(category)),
  );
}

// --- Otros deportes, femenino y categorías inferiores ---

/* Mismos equipos, otro deporte: el Real Madrid - Barça de la ACB o del balonmano. */
const OTHER_SPORT_RE =
  /\b(?:baloncesto|basket|basketball|basquet|acb|liga endesa|euroliga|euroleague|eurocup|nba|futsal|futbol sala|balonmano|handball|asobal|voleibol|voley|volleyball|waterpolo|hockey|rugby|tenis|padel|futbol playa|beach soccer)\b/;
/* El femenino, también entre paréntesis: «(Femenino)», «(Fem.)». */
const WOMEN_RE = /\b(?:femenino|femenina|femeni|fem|women|womens|ladies)\b/;
/* Categorías inferiores. */
const YOUTH_RE = /\b(?:youth league|juvenil|sub[\s-]?\d{2}|u[\s-]?\d{2})\b/;

/** Título, subtítulo, descripción y categorías, normalizados. */
export function programmeTexts(programme: GuideProgramme): string[] {
  return [programme.title, programme.subTitle, programme.desc, ...programme.categories].map(
    (field) => normalizeGuideText(field),
  );
}

/** ¿El programa es de otro deporte, del femenino o de una categoría inferior (y el partido no)? */
export function isOtherEvent(programme: GuideProgramme, input: GuideMatchInput): boolean {
  const matchText = normalizeGuideText(`${input.competition} ${input.title ?? ''}`);
  const womenMatch = WOMEN_RE.test(matchText) || matchFamily(input) === 'ligaf';
  const youthMatch = YOUTH_RE.test(matchText);
  return programmeTexts(programme).some(
    (text) =>
      OTHER_SPORT_RE.test(text) ||
      (!womenMatch && WOMEN_RE.test(text)) ||
      (!youthMatch && YOUTH_RE.test(text)),
  );
}

/** ¿La guía dice que va en directo? (`<live/>`, «directo», «en vivo» o «(L)» en el título o el subtítulo). */
export function hasLiveMark(programme: GuideProgramme): boolean {
  if (programme.live) return true;
  return [programme.title, programme.subTitle].some((field) =>
    LIVE_MARK_RE.test(normalizeGuideText(field)),
  );
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
  const text = normalizeGuideText(value);
  if (!text) return null;
  for (const [family, re] of COMPETITION_FAMILIES) if (re.test(text)) return family;
  return null;
}

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
  return (
    programme.start >= kickoff - GUIDE_EARLY_MS &&
    programme.start <= kickoff + GUIDE_LATE_MS &&
    programmeLastsAMatch(programme) &&
    programme.stop >= kickoff + GUIDE_AFTER_KICKOFF_MS
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

/** Regla 2: los dos equipos en el mismo campo (título, subtítulo o descripción). */
export function programmeHasTeams(programme: GuideProgramme, cache: TeamCache): boolean {
  for (const field of [programme.title, programme.subTitle, programme.desc]) {
    if (!field) continue;
    if (teamsInText(teamSearchText(field), cache.home, cache.away)) return true;
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
): boolean {
  if (!programmeFitsKickoff(programme, input.start)) return false;
  if (isNotLive(programme)) return false;
  if (isOtherEvent(programme, input)) return false;
  if (!programmeHasTeams(programme, cache)) return false;
  if (family) {
    /* La familia del partido sale en el texto (y ninguna otra) o, si el texto
       no nombra ninguna, en el nombre del canal. Mejor no emparejar que mal. */
    const named = competitionFamilies(programmeTexts(programme).join(' | '));
    if (named.size) return named.size === 1 && named.has(family);
    return channelFamily === family;
  }
  return true;
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
  const hasAgenda = input.channels.some((channel) => channel.trim() !== '');
  const confirmed: (GuideConfirmation & { readonly liveMark: boolean })[] = [];
  for (const candidate of candidates) {
    /* Regla 5: país y competición del nombre del canal. */
    const agendaScore = hasAgenda ? options.agendaScore(candidate.display) : 0;
    if (candidate.country !== 'ES') {
      if (candidate.country !== null || !hasAgenda || agendaScore < LIBRARY_MIN_SCORE) continue;
    }
    const channelFamily = competitionFamily(candidate.display);
    if (family && channelFamily && channelFamily !== family) continue;
    const shows = candidate.programmes.filter((programme) =>
      programmeShowsMatch(programme, input, cache, family, channelFamily),
    );
    if (!shows.length) continue;
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
  /\b(?:jornada|futbol|liga|copa|partido|partidos|temporada|grupo|final|semifinal|semifinales|cuartos|octavos|dieciseisavos|directo|resumen|previa|programa|especial|highlights|league|serie|campeonato|torneo|amistoso|sports|deportes)\b/;

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

function plausibleTeam(name: string): boolean {
  if (name.length < 3 || name.length > 40) return false;
  if (!/\p{L}{2}/u.test(name)) return false;
  if (name.split(/\s+/).length > 5) return false;
  const text = normalizeGuideText(name);
  if (!text || WEAK_TEAM_WORDS.has(text)) return false;
  return !NOT_A_TEAM_RE.test(text) && competitionFamily(text) === null;
}

/**
 * Los dos equipos de un texto de la guía («LaLiga EA Sports. Jornada 7: Real
 * Sociedad - Villarreal», «Fútbol: Real Madrid vs. Barcelona (Directo)»), con
 * sus nombres tal cual (sin las mayúsculas de guía), o null si no hay un
 * enfrentamiento claro. Prueba cada separador, de izquierda a derecha.
 */
export function extractGuideMatchup(value: string): { home: string; away: string } | null {
  const text = withoutLiveWords(String(value ?? '').replace(/\s+/g, ' '));
  if (!text) return null;
  for (const separator of text.matchAll(MATCHUP_SEPARATOR_RE)) {
    const at = separator.index ?? 0;
    const left = text.slice(0, at).replace(BEFORE_HOME_RE, '');
    const right = text.slice(at + separator[0].length).replace(AFTER_AWAY_RE, '');
    const home = tidyTeamName(withoutLiveWords(left));
    let away = tidyTeamName(withoutLiveWords(right));
    if (!plausibleTeam(away))
      away = tidyTeamName(withoutLiveWords(right.replace(AFTER_AWAY_LOOSE_RE, '')));
    if (plausibleTeam(home) && plausibleTeam(away)) return { home, away };
  }
  return null;
}
