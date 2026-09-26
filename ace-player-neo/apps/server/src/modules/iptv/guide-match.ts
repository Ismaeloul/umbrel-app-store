/* La guía para encontrar el canal del partido (docs/iptv.md §4.5). Puro.

   Una entrada IPTV queda CONFIRMADA POR LA GUÍA solo si TODO esto se cumple:

   1. Hora: el programa empieza entre 30 min antes y 15 min después del
      saque, dura entre 80 y 240 min y acaba al menos 90 min después del saque.
   2. Equipos: los dos en el MISMO campo (título, subtítulo o descripción), a
      menos de 40 caracteres uno de otro y separados por un separador de
      enfrentamiento (-, –, vs, v, x, ×, contra, /), sin tildes, en minúsculas
      y por palabra completa. Alias: la clave del equipo, la clave sin
      prefijos (real, club, cd…) si queda con 5 letras o más, la tabla curada
      `EPG_TEAM_ALIASES` y, si llegan, los nombres alternativos y cortos. Las
      abreviaturas de 3 letras solo valen en el patrón compacto `AAA-BBB`.
      Nunca valen solos real, madrid, sporting, racing, union, deportivo,
      club ni city. Un alias seguido de B, C, II, Femenino, Sub-19, Juvenil,
      Castilla, Atlético, Deportivo, Promesas… es el filial: no cuenta.
   3. Marcas de «no es el partido»: (R), [R], «R:», (D), repetición,
      diferido, resumen, previa, rueda de prensa, análisis…, el elemento
      `<previously-shown/>` o una categoría de noticias/magazine.
   4. Competición: si el texto nombra otra familia que la del partido, fuera.
   5. Canal: país ES explícito (o sin país si casa ≥ 70 con un canal de la
      agenda) y su nombre no puede nombrar otra competición (la regla
      Hypermotion ampliada a todas las familias).
   6. Ambigüedad: con más de 3 canales distintos, solo los que además casan
      (≥ 70) con la agenda; si no queda ninguno, no se confirma nada. */

import { IPTV_GUIDE_AMBIGUOUS_CHANNELS, LIBRARY_MIN_SCORE, footballTeamKey } from '@ace/shared';

const MINUTE = 60_000;

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
};

/* Lo que va detrás del alias y lo convierte en el filial o el femenino. */
const RESERVE_AFTER_RE =
  /^\s*(?:b|c|ii|iii|femenino|fem|femeni|sub[\s-]?\d{2}|u[\s-]?\d{2}|juvenil|atletic|castilla|atletico|deportivo|promesas|mestalla|academy)\b/;
/* Lo que va delante del alias y lo convierte en otro equipo («Bilbao Athletic»). */
const RESERVE_BEFORE_RE = /\b(?:bilbao)\s*$/;

/** Alias de un equipo para buscarlo en la guía (sin los débiles). */
export function teamAliases(name: string, extra: readonly string[] = []): string[] {
  const out = new Set<string>();
  const add = (value: string): void => {
    const alias = normalizeGuideText(value)
      .replace(/[()[\]/:.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  if (withoutParticles.split(' ').length >= 2) add(withoutParticles);
  for (const base of [raw, key, withoutParticles]) {
    const words = base.split(' ').filter(Boolean);
    const stripped = words.filter((word) => !TEAM_PREFIXES.has(word)).join(' ');
    if (stripped.replace(/\s/g, '').length >= 5) add(stripped);
    for (const alias of EPG_TEAM_ALIASES[base] ?? []) add(alias);
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

/* ¿Están los dos equipos en este texto, cerca y separados por un separador? */
function teamsInText(text: string, home: readonly string[], away: readonly string[]): boolean {
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
    '\\b(?:resumen|resumenes|highlights|mejores momentos|goles de)\\b',
    '\\b(?:previa|prepartido|pre-partido|postpartido|post partido|post-partido)\\b',
    '\\b(?:rueda de prensa|analisis|tertulia|magazine)\\b',
  ].join('|'),
);
const NOT_LIVE_CATEGORY_RE = /\b(?:news|magazine|talk|noticias|informativo|entrevista)\b/;
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

function hasLiveMark(programme: GuideProgramme): boolean {
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
  ['hypermotion', /\b(?:hypermotion|smartbank|segunda division|laliga 2)\b/],
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

/** Familia del partido (competición y título; Hypermotion también por el título). */
export function matchFamily(
  input: Pick<GuideMatchInput, 'competition' | 'title'>,
): CompetitionFamily | null {
  return competitionFamily(`${input.competition} ${input.title ?? ''}`);
}

// --- Hora ---

/** Regla 1: el programa cae a la hora del partido y dura lo de un partido. */
export function programmeFitsKickoff(programme: GuideProgramme, kickoff: number): boolean {
  const duration = programme.stop - programme.start;
  return (
    programme.start >= kickoff - 30 * MINUTE &&
    programme.start <= kickoff + 15 * MINUTE &&
    duration >= 80 * MINUTE &&
    duration <= 240 * MINUTE &&
    programme.stop >= kickoff + 90 * MINUTE
  );
}

/** Reglas 1 a 4 para un programa (sin mirar el canal). */
export function programmeShowsMatch(
  programme: GuideProgramme,
  input: GuideMatchInput,
  cache: {
    readonly home: string[];
    readonly away: string[];
    readonly homeAbbr: string[];
    readonly awayAbbr: string[];
  },
  family: CompetitionFamily | null,
): boolean {
  if (!programmeFitsKickoff(programme, input.start)) return false;
  if (isNotLive(programme)) return false;
  let teams = false;
  for (const field of [programme.title, programme.subTitle, programme.desc]) {
    const text = normalizeGuideText(field);
    if (!text) continue;
    if (teamsInText(text, cache.home, cache.away)) {
      teams = true;
      break;
    }
    if (
      cache.homeAbbr.length &&
      cache.awayAbbr.length &&
      abbreviationsInText(text, cache.homeAbbr, cache.awayAbbr)
    ) {
      teams = true;
      break;
    }
  }
  if (!teams) return false;
  if (family) {
    const named = competitionFamily(`${programme.title} ${programme.subTitle} ${programme.desc}`);
    if (named && named !== family) return false;
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
  const cache = {
    home: teamAliases(input.home, input.homeAliases),
    away: teamAliases(input.away, input.awayAliases),
    homeAbbr: teamAbbreviations(input.homeAliases),
    awayAbbr: teamAbbreviations(input.awayAliases),
  };
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
    if (family) {
      const channelFamily = competitionFamily(candidate.display);
      if (channelFamily && channelFamily !== family) continue;
    }
    const shows = candidate.programmes.filter((programme) =>
      programmeShowsMatch(programme, input, cache, family),
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
