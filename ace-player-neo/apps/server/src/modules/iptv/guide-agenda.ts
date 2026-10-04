/* Agenda híbrida (decisiones.md D27; docs/iptv.md §4.7). Puro.

   Días 1-14, futbolenlatv como siempre. HOY y MAÑANA (lo que cubre la guía),
   la guía de la IPTV:

   1. CONFIRMA un partido de la agenda y su canal exacto, con las mismas
      reglas y los mismos candidatos que la resolución (`confirmByGuide` sobre
      `guideCandidates`): lo que se enseña en la agenda es lo que luego suena
      primero. Un programa cuyo título trae OTRO enfrentamiento no confirma
      este partido por lo que diga su descripción, y el que ya es de otro
      partido de la agenda (sus dos equipos en el título) no vale para este.
   2. MUEVE la hora si futbolenlatv se equivoca: a su hora no hay nada (o un
      programa que no puede ser un partido de esa hora, regla 1 de
      guide-match.ts), pero ese mismo día la guía tiene el partido EN DIRECTO
      (marca de directo obligatoria: las repeticiones sin marca son muy
      comunes, §15) con los dos equipos en el TÍTULO o el subtítulo (nunca
      solo en la descripción, que a menudo anuncia el partido siguiente) y en
      un programa que no es ya de otro partido de la agenda. Manda el primer
      programa así del día; el saque sale de él (`kickoffFromProgramme`).
      También si a su hora solo hay el partido SIN marca y la guía lo tiene en
      directo antes ese día: lo de la hora de la agenda es la repetición (una
      repetición va siempre después del directo).
   3. AÑADE un partido que la guía trae y la agenda no, con cuidado: solo en
      directo (marca obligatoria), de una competición que la agenda conoce
      (familia del texto o, si el texto no nombra ninguna, del canal), en un
      canal de España, con los dos equipos reconocibles en el título o el
      subtítulo, sin filiales, cantera ni femenino (salvo Liga F), y solo si
      no es un partido de la agenda escrito de otra forma (`sameMatch`: un
      equipo en común ese día o los de al lado, nombres que se parecen, el
      mismo canal a esa hora o, con la hora mal, el mismo canal y la misma
      competición de un partido que la guía no encuentra). La misma
      competición a la misma hora, sola, no basta: en una noche de Champions
      la guía añade el partido que le falta a la agenda.

   Sin IPTV, en pausa o sin guía, el servicio ni llama aquí; sin nada de la
   guía para un partido, ese partido queda tal cual. La guía solo suma. */

import { LIBRARY_MIN_SCORE, footballTeamIsVariant, footballTeamKey } from '@ace/shared';
import type { Catalog } from './catalog.js';
import type { GuideWindow } from './guide.js';
import {
  COMPETITION_FAMILY_LABELS,
  GUIDE_EARLY_MS,
  GUIDE_LATE_MS,
  WEAK_TEAM_WORDS,
  programmeFamilies,
  competitionFamily,
  confirmByGuide,
  extractGuideMatchup,
  hasLiveMark,
  isNotLive,
  kickoffFromProgramme,
  matchFamily,
  programmeFitsKickoff,
  programmeHasTeams,
  programmeLastsAMatch,
  programmeTeamTexts,
  programmeTexts,
  teamAliases,
  teamCache,
  teamCoreWords,
  teamsInText,
  type CompetitionFamily,
  type GuideChannelCandidate,
  type GuideConfirmation,
  type GuideMatchInput,
  type GuideProgramme,
  type TeamCache,
} from './guide-match.js';
import { agendaScorer, channelVariantKey, guideCandidates } from './layer.js';

/** Un partido de la agenda, como lo mira la guía. */
export interface GuideAgendaMatch {
  readonly id: string;
  /** Día del partido en Madrid (YYYY-MM-DD). */
  readonly date: string;
  readonly home: string;
  readonly away: string;
  readonly competition: string;
  readonly title: string;
  /** Saque (epoch ms), o null si la agenda no lo sabe. */
  readonly start: number | null;
  readonly channels: readonly string[];
}

export interface GuideAgendaRequest {
  /**
   * Los partidos de la agenda de los días que se miran y de los de al lado
   * (para no añadir uno que ya está escrito de otra forma).
   */
  readonly matches: readonly GuideAgendaMatch[];
  /** Días en los que manda la guía: hoy y mañana, en Madrid. */
  readonly dates: readonly string[];
  /** Día de Madrid de un instante. */
  readonly dateOf: (ms: number) => string;
  /** Cambia cuando cambia la agenda (la caché del servicio). */
  readonly key: string;
}

/** Un partido de la agenda que la guía confirma (y si le cambia la hora). */
export interface GuideAgendaConfirmation {
  readonly matchId: string;
  /** Canales que lo confirman, del más seguro al menos (2 como mucho, un canal una vez). */
  readonly channels: readonly string[];
  /** Saque: el de la agenda o, si la guía lo mueve, el suyo. */
  readonly start: number;
  readonly moved: boolean;
}

/** Un partido que solo trae la guía. */
export interface GuideAgendaAddition {
  readonly home: string;
  readonly away: string;
  readonly family: CompetitionFamily;
  /** Rótulo por defecto de su competición («LaLiga EA Sports»). */
  readonly competition: string;
  /** Día en Madrid. */
  readonly date: string;
  readonly start: number;
  readonly channels: readonly string[];
}

export interface GuideAgendaResult {
  readonly confirmations: readonly GuideAgendaConfirmation[];
  readonly additions: readonly GuideAgendaAddition[];
}

export interface GuideAgendaOptions {
  /** Cuánto casa un canal IPTV con los canales que anuncia un partido (`agendaScorer` de layer.ts). */
  readonly agendaScorer: (channels: readonly string[]) => (display: string) => number;
}

const DAY_MS = 86_400_000;
const MAX_CHANNELS = 2;
/** «Es el mismo canal» (como `SAME_CHANNEL` de football/guide-overlay.ts). */
const SAME_CHANNEL_SCORE = 92;

/** Los canales de una confirmación: 2 como mucho y uno por canal («M+ LaLiga TV» y su «Bar», uno). */
function distinctChannels(list: readonly GuideConfirmation[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = channelVariantKey(item.display);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.display);
    if (out.length >= MAX_CHANNELS) break;
  }
  return out;
}

/*
 * Un separador de enfrentamiento en el texto TAL CUAL (sin normalizar, que es
 * lo caro): «-», «–», «—», «×», «/», «vs», «v», «x» o «contra». Es un
 * superconjunto de lo que aceptan `programmeHasTeams` (los separadores salen
 * de estos al normalizar) y `extractGuideMatchup`.
 */
const RAW_SEPARATOR_RE = /[-–—×/]|(?<![\p{L}\p{N}])(?:vs|v|x|contra)(?![\p{L}\p{N}])/iu;

function mayShowMatchup(programme: GuideProgramme): boolean {
  return (
    RAW_SEPARATOR_RE.test(programme.title) ||
    RAW_SEPARATOR_RE.test(programme.subTitle) ||
    RAW_SEPARATOR_RE.test(programme.desc)
  );
}

/**
 * Solo lo que puede ser un partido de esos días: dura lo de un partido, su
 * saque posible cae en uno de los días, tiene un separador de enfrentamiento
 * y no dice que no lo es. Es un superconjunto de lo que `confirmByGuide`
 * acepta para esos días, así que el resultado es el mismo que con la guía
 * entera (y mucho más rápido): lo barato (números y una expresión sobre el
 * texto tal cual) va antes que normalizar el texto.
 */
function slimCandidates(
  candidates: readonly GuideChannelCandidate[],
  dates: ReadonlySet<string>,
  dateOf: (ms: number) => string,
): GuideChannelCandidate[] {
  const out: GuideChannelCandidate[] = [];
  for (const candidate of candidates) {
    const programmes = candidate.programmes.filter(
      (programme) =>
        programmeLastsAMatch(programme) &&
        (dates.has(dateOf(programme.start + GUIDE_EARLY_MS)) ||
          dates.has(dateOf(programme.start - GUIDE_LATE_MS))) &&
        mayShowMatchup(programme) &&
        !isNotLive(programme),
    );
    if (programmes.length) out.push({ ...candidate, programmes });
  }
  return out;
}

const QUARTER_MS = 15 * 60_000;

/**
 * `dateOf` con memoria por cuarto de hora: el día cambia siempre en un cuarto
 * de hora exacto (los desfases de todas las zonas horarias son múltiplos de 15
 * min), así que es exacto. Formatear una fecha de Madrid es lo más caro de
 * mirar una guía grande programa a programa.
 */
function quarterMemo(dateOf: (ms: number) => string): (ms: number) => string {
  const memo = new Map<number, string>();
  return (ms: number): string => {
    const bucket = Math.floor(ms / QUARTER_MS);
    let value = memo.get(bucket);
    if (value === undefined) {
      value = dateOf(bucket * QUARTER_MS);
      memo.set(bucket, value);
    }
    return value;
  };
}

function dayNumber(date: string): number | null {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed) ? Math.round(parsed / DAY_MS) : null;
}

/**
 * Un programa EN DIRECTO de la guía, preparado una vez por cálculo: los textos
 * para buscar equipos y, si los tiene, sus dos equipos (lo caro, una sola vez
 * y no una por partido de la agenda).
 */
export interface LiveShow {
  readonly candidate: GuideChannelCandidate;
  readonly programme: GuideProgramme;
  /** Título, subtítulo y descripción en la forma de `teamSearchText`. */
  readonly texts: readonly string[];
  readonly kickoff: number | null;
  /** Día de Madrid del saque ('' sin saque). */
  readonly date: string;
  readonly pair: { readonly home: string; readonly away: string } | null;
  /** Alias, claves y nombres sin siglas de los dos equipos del título (si los hay). */
  readonly pairAliases: readonly string[];
  readonly pairKeys: readonly string[];
  readonly pairCores: readonly string[];
  /** Cada equipo del título en palabras, local y visitante (para «se parece»). */
  readonly pairTeams: readonly TeamName[];
}

function liveShows(
  candidates: readonly GuideChannelCandidate[],
  dateOf: (ms: number) => string,
): LiveShow[] {
  const out: LiveShow[] = [];
  for (const candidate of candidates) {
    for (const programme of candidate.programmes) {
      if (!hasLiveMark(programme)) continue;
      const pair = extractGuideMatchup(programme.title) ?? extractGuideMatchup(programme.subTitle);
      const kickoff = kickoffFromProgramme(programme);
      out.push({
        candidate,
        programme,
        texts: programmeTeamTexts(programme),
        kickoff,
        date: kickoff === null ? '' : dateOf(kickoff),
        pair,
        pairAliases: pair ? [...teamAliases(pair.home), ...teamAliases(pair.away)] : [],
        pairKeys: pair ? [footballTeamKey(pair.home), footballTeamKey(pair.away)] : [],
        pairCores: pair ? teamCores(pair.home, pair.away) : [],
        pairTeams: pair ? [teamName(pair.home), teamName(pair.away)] : [],
      });
    }
  }
  return out;
}

/**
 * Regla 2 sobre un programa preparado, solo en el título o el subtítulo (lo
 * que nombra la descripción no dice de qué partido es el programa: «Sevilla -
 * Betis» con «Esta noche, Real Madrid - Barcelona» en la descripción). Antes
 * de las expresiones regulares, la cuenta barata (algún alias de cada equipo
 * dentro del texto).
 */
function showHasTeams(show: LiveShow, cache: TeamCache): boolean {
  for (const text of show.texts.slice(0, 2)) {
    if (!text) continue;
    if (!cache.home.some((alias) => text.includes(alias))) continue;
    if (!cache.away.some((alias) => text.includes(alias))) continue;
    if (teamsInText(text, cache.home, cache.away)) return true;
  }
  return false;
}

const MATCHUP_MEMO = new WeakMap<GuideProgramme, boolean>();

/** ¿El título o el subtítulo traen un enfrentamiento («Sevilla - Betis»)? */
function titleHasMatchup(programme: GuideProgramme): boolean {
  let value = MATCHUP_MEMO.get(programme);
  if (value === undefined) {
    value =
      extractGuideMatchup(programme.title) !== null ||
      extractGuideMatchup(programme.subTitle) !== null;
    MATCHUP_MEMO.set(programme, value);
  }
  return value;
}

/**
 * ¿Puede la agenda usar este programa para este partido? Si el título o el
 * subtítulo traen un enfrentamiento, tiene que ser el suyo: la descripción no
 * convierte en este partido el programa de otro. Sin enfrentamiento en el
 * título («El Clásico (Directo)», «Fútbol»), vale lo de la descripción, como
 * en la resolución.
 */
function programmeIsThisMatch(programme: GuideProgramme, cache: TeamCache): boolean {
  return programmeHasTeams(programme, cache, 'title') || !titleHasMatchup(programme);
}

/** Lo que encuentra la guía en directo a otra hora: el saque y los programas. */
interface GuideMove {
  readonly start: number;
  readonly found: readonly GuideConfirmation[];
}

/**
 * Saque de un partido que la guía tiene en directo ese día a otra hora (regla
 * 2), o null. Con `before`, solo los directos que empiezan antes de esa hora.
 * Para mover, los dos equipos tienen que estar en el título o el subtítulo
 * (nunca solo en la descripción) y el programa no puede ser el que ya
 * confirma otro partido de la agenda (`free`).
 */
function moveByGuide(
  input: GuideMatchInput,
  cache: TeamCache,
  date: string,
  candidates: readonly GuideChannelCandidate[],
  shows: readonly LiveShow[],
  agendaScore: (display: string) => number,
  free: (programme: GuideProgramme) => boolean,
  before: number | null = null,
): GuideMove | null {
  const kickoffs = new Set<number>();
  for (const show of shows) {
    const kickoff = show.kickoff;
    if (kickoff === null || kickoff === input.start || show.date !== date) continue;
    if (before !== null && kickoff >= before) continue;
    if (free(show.programme) && showHasTeams(show, cache)) kickoffs.add(kickoff);
  }
  for (const start of [...kickoffs].sort((a, b) => a - b)) {
    const found = confirmByGuide({ ...input, start }, candidates, { agendaScore }).filter(
      (item) =>
        hasLiveMark(item.programme) &&
        free(item.programme) &&
        programmeHasTeams(item.programme, cache, 'title'),
    );
    if (found.length) return { start, found };
  }
  return null;
}

interface AgendaTeams {
  /** Id del partido de la agenda ('' para uno que acaba de añadir la guía). */
  readonly id: string;
  readonly day: number;
  readonly cache: TeamCache;
  readonly aliases: ReadonlySet<string>;
  readonly keys: readonly string[];
  /** Cada equipo sin siglas ni prefijos (`teamCoreWords`): «Atalanta BC» y «Atalanta» son «atalanta». */
  readonly cores: readonly string[];
  /** Cada equipo en palabras, local y visitante (para «se parece»). */
  readonly teams: readonly TeamName[];
  /** Saque (null sin hora) y lo que se mira de él para no duplicarlo. */
  readonly start: number | null;
  readonly family: CompetitionFamily | null;
  readonly channels: readonly string[];
}

function teamCores(home: string, away: string): string[] {
  return [teamCoreWords(home).join(' '), teamCoreWords(away).join(' ')].filter(Boolean);
}

function agendaTeams(
  day: number,
  match: {
    readonly id?: string;
    readonly home: string;
    readonly away: string;
    readonly start?: number | null;
    readonly competition?: string;
    readonly title?: string;
    readonly channels?: readonly string[];
  },
): AgendaTeams {
  const cache = teamCache(match);
  return {
    id: match.id ?? '',
    day,
    cache,
    aliases: new Set([...cache.home, ...cache.away]),
    keys: [footballTeamKey(match.home), footballTeamKey(match.away)].filter(Boolean),
    cores: teamCores(match.home, match.away),
    teams: [teamName(match.home), teamName(match.away)],
    start: match.start ?? null,
    family: matchFamily({ competition: match.competition ?? '', title: match.title ?? '' }),
    channels: match.channels ?? [],
  };
}

/* --- «Se parece» (solo para no añadir dos veces un partido que la agenda escribe de otra forma) --- */

/** ¿Están a `limit` cambios de letra o menos (Levenshtein)? Para en cuanto ya no puede ser. */
function withinEdits(a: string, b: string, limit: number): boolean {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      current[j] = value;
      if (value < best) best = value;
    }
    if (best > limit) return false;
    previous = current;
  }
  return (previous[b.length] as number) <= limit;
}

/** ¿Están las letras de `short` en `long`, en orden? («utd» en «united»). */
function isSubsequence(short: string, long: string): boolean {
  let at = 0;
  for (const char of long) if (char === short[at]) at += 1;
  return at === short.length;
}

/**
 * ¿Son la misma palabra escrita de otra forma? La inicial («O.» de
 * «Olympique», «B.» de «Borussia»), el principio («Wed» y «Wednesday»,
 * «Salzburg» y «Salzburgo»), la abreviatura («Utd» y «United») o una o dos
 * letras cambiadas en una palabra larga («Olympiakos» y «Olympiacos»,
 * «Copenhagen» y «Copenhague»).
 */
function wordsAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 1) return long.startsWith(short);
  if (short.length < 3) return false;
  if (long.startsWith(short)) return true;
  if (short.length <= 4 && long.length >= short.length + 2 && short[0] === long[0]) {
    if (isSubsequence(short, long)) return true;
  }
  if (short.length < 5) return false;
  const limit = short.length >= 8 ? 2 : 1;
  return long.length - short.length <= limit && withinEdits(short, long, limit);
}

/* Una pareja de palabras que pesa: ninguna débil («madrid», «city», «united»…) y no son siglas sueltas. */
function strongPair(a: string, b: string): boolean {
  return (
    Math.min(a.length, b.length) >= 3 &&
    Math.max(a.length, b.length) >= 4 &&
    !WEAK_TEAM_WORDS.has(a) &&
    !WEAK_TEAM_WORDS.has(b)
  );
}

/**
 * ¿Pueden ser el mismo equipo? Cada palabra del nombre más corto se parece a
 * una palabra distinta del otro, y alguna de esas parejas pesa. «Sheffield
 * Wed» y «Sheffield Wednesday», «Leeds Utd» y «Leeds United», «O. Lyonnais» y
 * «Olympique Lyonnais», sí; «Manchester City» y «Manchester United» o
 * «Newcastle United» y «Newcastle Jets», no (sobra «city» o «jets»); «Real
 * Madrid» y «Atlético de Madrid», tampoco («madrid» sola no pesa).
 */
function teamsAlike(a: TeamName, b: TeamName): boolean {
  if (!a.words.length || !b.words.length) return false;
  if (a.name === b.name) return true;
  const [short, long] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words];
  let used = 0;
  let strong = false;
  for (const word of short) {
    let found = -1;
    for (let index = 0; index < long.length && index < 30; index += 1) {
      if (used & (1 << index)) continue;
      if (wordsAlike(word, long[index] as string)) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    used |= 1 << found;
    if (strongPair(word, long[found] as string)) strong = true;
  }
  return strong;
}

/** El nombre de un equipo sin siglas ni prefijos, en palabras (`teamCoreWords`). */
interface TeamName {
  readonly name: string;
  readonly words: readonly string[];
}

function teamName(value: string): TeamName {
  const words = teamCoreWords(value);
  return { name: words.join(' '), words };
}

const NO_TEAM: TeamName = { name: '', words: [] };

/**
 * Cuántos de los dos equipos del programa se parecen a los del partido (0, 1
 * o 2; local y visitante, o al revés). Los nombres se repiten mucho (cada
 * equipo de la guía contra cada partido del día): cada pareja de nombres se
 * compara una vez por cálculo (`memo`).
 */
function alikeTeams(show: LiveShow, match: AgendaTeams, memo: Map<string, boolean>): number {
  const alike = (a: TeamName = NO_TEAM, b: TeamName = NO_TEAM): number => {
    const key = a.name < b.name ? `${a.name}\n${b.name}` : `${b.name}\n${a.name}`;
    let value = memo.get(key);
    if (value === undefined) {
      value = teamsAlike(a, b);
      memo.set(key, value);
    }
    return value ? 1 : 0;
  };
  const [home, away] = show.pairTeams;
  const [matchHome, matchAway] = match.teams;
  const straight = alike(home, matchHome) + alike(away, matchAway);
  if (straight === 2) return 2;
  return Math.max(straight, alike(home, matchAway) + alike(away, matchHome));
}

/** ¿Juega alguno de los dos equipos del programa en ese partido? (clave, alias o nombre sin siglas). */
function sharesTeam(show: LiveShow, match: AgendaTeams): boolean {
  return (
    show.pairKeys.some((key) => key && match.keys.includes(key)) ||
    show.pairAliases.some((alias) => match.aliases.has(alias)) ||
    show.pairCores.some((core) => match.cores.includes(core))
  );
}

/* Partidos que no son los de la agenda aunque lo parezcan: de leyendas, benéficos, de homenaje o
   de exhibición (otros deportes, cantera y femenino ya los aparta `confirmByGuide`). */
const NOT_AGENDA_MATCH_RE =
  /\b(?:leyendas|legends|veteranos|benefico|solidario|homenaje|despedida|exhibicion|all stars|celebrities|famosos)\b/;
/* Una categoría de deportes («Deportes», «Fútbol», «Sports»…). */
const SPORT_CATEGORY_RE = /\b(?:deporte|deportes|deportivo|sport|sports|futbol|football|soccer)\b/;

/**
 * ¿Puede ser un partido de los que sigue la agenda? (solo para añadir uno: lo
 * que la guía confirma ya lo trae la agenda). Nada de leyendas ni benéficos y,
 * si el programa trae categorías, alguna tiene que ser de deportes: un
 * «Barça - Veszprém» en la categoría «Cine» no es un partido.
 */
function isAgendaFootball(programme: GuideProgramme): boolean {
  const texts = programmeTexts(programme);
  if (texts.some((text) => NOT_AGENDA_MATCH_RE.test(text))) return false;
  if (!programme.categories.length) return true;
  return texts.slice(3).some((category) => SPORT_CATEGORY_RE.test(category));
}

/** Lo que separa dos saques para que sean «la misma franja». */
const SAME_SLOT_MS = 30 * 60_000;

/** ¿Cae el programa a la hora de ese partido de la agenda? */
function sameSlot(show: LiveShow, match: AgendaTeams): boolean {
  if (match.start === null) return false;
  if (programmeFitsKickoff(show.programme, match.start)) return true;
  return show.kickoff !== null && Math.abs(show.kickoff - match.start) <= SAME_SLOT_MS;
}

/**
 * Lo de la guía que no depende de la agenda: los programas que pueden ser un
 * partido de esos días y los que van en directo, ya preparados. Es lo caro
 * con una guía grande; se calcula una vez por guía y días (`buildGuideAgenda`)
 * y no cada vez que cambia la agenda.
 */
export interface GuideAgendaIndex {
  readonly dates: ReadonlySet<string>;
  readonly candidates: readonly GuideChannelCandidate[];
  readonly shows: readonly LiveShow[];
  /** Cada canal con su guía entera (por `key`), para mirar qué hay a una hora. */
  readonly channels: ReadonlyMap<string, GuideChannelCandidate>;
}

export function prepareGuideAgenda(
  allCandidates: readonly GuideChannelCandidate[],
  dates: readonly string[],
  dateOf: (ms: number) => string,
): GuideAgendaIndex {
  const set = new Set(dates);
  if (!set.size || !allCandidates.length) {
    return { dates: set, candidates: [], shows: [], channels: new Map() };
  }
  const dayOf = quarterMemo(dateOf);
  const candidates = slimCandidates(allCandidates, set, dayOf);
  /* Solo los canales que pueden dar un partido esos días (pocos), con su guía entera. */
  const wanted = new Set(candidates.map((candidate) => candidate.key));
  const channels = new Map<string, GuideChannelCandidate>();
  for (const candidate of allCandidates) {
    if (wanted.has(candidate.key) && !channels.has(candidate.key)) {
      channels.set(candidate.key, candidate);
    }
  }
  return { dates: set, candidates, shows: liveShows(candidates, dayOf), channels };
}

/**
 * La guía de hoy y mañana sobre la agenda: confirmaciones (con la hora
 * movida si hace falta) y partidos que solo trae la guía.
 */
export function guideAgenda(
  allCandidates: readonly GuideChannelCandidate[],
  request: GuideAgendaRequest,
  options: GuideAgendaOptions,
): GuideAgendaResult {
  return guideAgendaFrom(
    prepareGuideAgenda(allCandidates, request.dates, request.dateOf),
    request,
    options,
  );
}

/** `guideAgenda` sobre lo ya preparado (`prepareGuideAgenda` con los mismos días). */
export function guideAgendaFrom(
  index: GuideAgendaIndex,
  request: GuideAgendaRequest,
  options: GuideAgendaOptions,
): GuideAgendaResult {
  const { dates, candidates, shows } = index;
  if (!dates.size || !candidates.length) return { confirmations: [], additions: [] };
  /* Muchos partidos anuncian los mismos canales: una puntuación por canales y nombre, una vez. */
  const scorers = new Map<string, (display: string) => number>();
  const scorerFor = (channels: readonly string[]): ((display: string) => number) => {
    const key = channels.join('\n');
    let scorer = scorers.get(key);
    if (!scorer) {
      const base = options.agendaScorer(channels);
      const memo = new Map<string, number>();
      scorer = (display: string): number => {
        let value = memo.get(display);
        if (value === undefined) {
          value = base(display);
          memo.set(display, value);
        }
        return value;
      };
      scorers.set(key, scorer);
    }
    return scorer;
  };

  // 1 y 2: confirmar (y mover) los partidos de la agenda.
  interface Pending {
    readonly match: GuideAgendaMatch;
    readonly start: number;
    readonly input: GuideMatchInput;
    readonly cache: TeamCache;
    readonly agendaScore: (display: string) => number;
    readonly found: readonly GuideConfirmation[];
  }
  const pending: Pending[] = [];
  /* Los programas que confirman un partido de la agenda a su hora con sus dos equipos en el
     título: son de ese partido y no pueden mover otro (ni confirmarlo por la descripción). */
  const owners = new Map<GuideProgramme, Set<string>>();
  for (const match of request.matches) {
    if (!dates.has(match.date) || match.start === null) continue;
    if (!match.home.trim() || !match.away.trim()) continue;
    const input: GuideMatchInput = {
      home: match.home,
      away: match.away,
      competition: match.competition,
      title: match.title,
      start: match.start,
      channels: match.channels,
    };
    const cache = teamCache(input);
    const agendaScore = scorerFor(match.channels);
    const found = confirmByGuide(input, candidates, { agendaScore }).filter((item) =>
      programmeIsThisMatch(item.programme, cache),
    );
    for (const item of found) {
      if (!programmeHasTeams(item.programme, cache, 'title')) continue;
      const set = owners.get(item.programme) ?? new Set<string>();
      set.add(match.id);
      owners.set(item.programme, set);
    }
    pending.push({ match, start: match.start, input, cache, agendaScore, found });
  }
  const confirmations: GuideAgendaConfirmation[] = [];
  /* Los programas de la guía que ya son un partido de la agenda (para no añadirlos otra vez). */
  const used = new Set<GuideProgramme>();
  const confirm = (
    matchId: string,
    found: readonly GuideConfirmation[],
    start: number,
    moved: boolean,
  ): void => {
    for (const item of found) used.add(item.programme);
    confirmations.push({ matchId, channels: distinctChannels(found), start, moved });
  };
  for (const { match, start, input, cache, agendaScore, found: atItsTime } of pending) {
    const free = (programme: GuideProgramme): boolean => {
      const set = owners.get(programme);
      return !set || [...set].every((id) => id === match.id);
    };
    const found = atItsTime.filter((item) => free(item.programme));
    /* Lo de la hora de la agenda no lleva la marca de directo y la guía tiene
       el partido EN DIRECTO ese mismo día, antes: lo de la hora de la agenda
       es la repetición (una repetición siempre va después del directo). */
    const earlier =
      found.length && !found.some((item) => hasLiveMark(item.programme))
        ? moveByGuide(input, cache, match.date, candidates, shows, agendaScore, free, start)
        : null;
    if (earlier) {
      confirm(match.id, earlier.found, earlier.start, true);
      continue;
    }
    if (found.length) {
      confirm(match.id, found, start, false);
      continue;
    }
    const moved = moveByGuide(input, cache, match.date, candidates, shows, agendaScore, free);
    if (moved) confirm(match.id, moved.found, moved.start, true);
  }
  const confirmedIds = new Set(confirmations.map((item) => item.matchId));
  const alikeMemo = new Map<string, boolean>();

  // 3: lo que solo trae la guía.
  const agenda: AgendaTeams[] = [];
  for (const match of request.matches) {
    const day = dayNumber(match.date);
    if (day === null || !match.home.trim() || !match.away.trim()) continue;
    agenda.push(agendaTeams(day, match));
  }
  /**
   * ¿Es este programa ese partido de la agenda, escrito de otra forma? Mejor no
   * añadir uno que añadirlo dos veces, pero sin perder los que de verdad no
   * están (una jornada de Champions con ocho partidos a la vez):
   * - un equipo juega en él ese día, el anterior o el siguiente (clave, alias o
   *   nombre sin siglas; un equipo no juega dos días seguidos);
   * - los dos equipos se parecen (`teamsAlike`), ese día, a la hora que sea;
   * - uno se parece y es de la misma competición, ese día («Crvena Zvezda -
   *   Olympiakos» y «Estrella Roja - Olympiacos»);
   * - a esa hora y en ese canal (≥ 70): un canal da un partido a la vez;
   * - en ese mismo canal (≥ 92), de la misma competición, ese día, la guía no
   *   confirma el de la agenda y a la hora de la agenda ese canal no tiene
   *   nada que pueda ser un partido: es él, con la hora mal y los dos nombres
   *   de otra forma («Estrella Roja - Olympiacos» a las 18:45 y «Crvena Zvezda
   *   - Olympiakos» a las 21:00, en el mismo canal).
   * La misma competición a la misma hora, sola, ya no basta.
   */
  /* «Algo que pueda ser un partido»: dura lo de un partido a esa hora, no es una repetición y,
     en un canal sin competición en el nombre («La 1», «DAZN 1»), trae un enfrentamiento o una
     competición (una película a esa hora no cuenta). */
  const slotTaken = (candidate: GuideChannelCandidate, start: number): boolean => {
    const sportsChannel = competitionFamily(candidate.display) !== null;
    return (index.channels.get(candidate.key) ?? candidate).programmes.some(
      (programme) =>
        programmeFitsKickoff(programme, start) &&
        !isNotLive(programme) &&
        (sportsChannel || titleHasMatchup(programme) || programmeFamilies(programme).size > 0),
    );
  };
  const sameMatch = (
    show: LiveShow,
    match: AgendaTeams,
    day: number,
    family: CompetitionFamily,
  ): boolean => {
    if (
      Math.abs(match.day - day) <= 1 &&
      (sharesTeam(show, match) || showHasTeams(show, match.cache))
    ) {
      return true;
    }
    if (match.day !== day) return false;
    const channelScore = scorerFor(match.channels)(show.candidate.display);
    if (channelScore >= LIBRARY_MIN_SCORE && sameSlot(show, match)) return true;
    const sameFamily = match.family === family;
    const alike = alikeTeams(show, match, alikeMemo);
    if (alike === 2 || (alike === 1 && sameFamily)) return true;
    return (
      sameFamily &&
      channelScore >= SAME_CHANNEL_SCORE &&
      match.id !== '' &&
      !confirmedIds.has(match.id) &&
      (match.start === null || !slotTaken(show.candidate, match.start))
    );
  };
  const groups = new Map<
    string,
    {
      readonly show: LiveShow;
      readonly home: string;
      readonly away: string;
      readonly family: CompetitionFamily;
      readonly start: number;
      readonly date: string;
    }
  >();
  const channelFamilies = new Map<GuideChannelCandidate, CompetitionFamily | null>();
  for (const show of shows) {
    const { candidate, programme, pair } = show;
    if (candidate.country !== 'ES' || !pair || show.kickoff === null) continue;
    if (used.has(programme)) continue;
    if (footballTeamIsVariant(pair.home) || footballTeamIsVariant(pair.away)) continue;
    if (!isAgendaFootball(programme)) continue;
    let channelFamily = channelFamilies.get(candidate);
    if (channelFamily === undefined) {
      channelFamily = competitionFamily(candidate.display);
      channelFamilies.set(candidate, channelFamily);
    }
    const named = programmeFamilies(programme);
    const family = named.size === 1 ? [...named][0] : named.size === 0 ? channelFamily : null;
    if (!family || (channelFamily && channelFamily !== family)) continue;
    const start = show.kickoff;
    const date = show.date;
    const day = dayNumber(date);
    if (!dates.has(date) || day === null) continue;
    if (agenda.some((match) => sameMatch(show, match, day, family))) continue;
    const key = `${date}|${[...show.pairKeys].sort().join('|')}`;
    const previous = groups.get(key);
    if (!previous || start < previous.start) {
      groups.set(key, { show, home: pair.home, away: pair.away, family, start, date });
    }
  }
  const additions: GuideAgendaAddition[] = [];
  const added: AgendaTeams[] = [];
  for (const group of [...groups.values()].sort((a, b) => a.start - b.start)) {
    const day = dayNumber(group.date) as number;
    /* Dos grafías del mismo partido («Barça - R. Madrid» y «Barcelona - Real Madrid»,
       «Sheffield Wed» y «Sheffield Wednesday»): uno. */
    if (added.some((other) => sameMatch(group.show, other, day, group.family))) continue;
    const competition = COMPETITION_FAMILY_LABELS[group.family];
    const input: GuideMatchInput = {
      home: group.home,
      away: group.away,
      competition,
      title: `${group.home} - ${group.away}`,
      start: group.start,
      channels: [],
    };
    const cache = teamCache(input);
    /* Sus canales: los programas en directo con los dos equipos en el título, que no son ya un
       partido de la agenda. */
    const found = confirmByGuide(input, candidates, { agendaScore: () => 0 }).filter(
      (item) =>
        hasLiveMark(item.programme) &&
        !used.has(item.programme) &&
        programmeHasTeams(item.programme, cache, 'title'),
    );
    if (!found.length) continue;
    const channels = distinctChannels(found);
    additions.push({
      home: group.home,
      away: group.away,
      family: group.family,
      competition,
      date: group.date,
      start: group.start,
      channels,
    });
    for (const item of found) used.add(item.programme);
    added.push(agendaTeams(day, { ...group, competition, channels }));
  }
  return { confirmations, additions };
}

/* Lo preparado de cada guía (la ventana es la misma mientras no se descarga otra). */
const INDEX_MEMO = new WeakMap<
  GuideWindow,
  { readonly catalog: Catalog; readonly dates: string; readonly index: GuideAgendaIndex }
>();

/**
 * La agenda híbrida con el catálogo y la guía del servicio (los mismos
 * candidatos que la resolución). Lo caro (mirar la guía entera) se hace una
 * vez por guía, catálogo y días; cada cambio de la agenda solo repasa lo
 * preparado.
 */
export function buildGuideAgenda(
  catalog: Catalog,
  window: GuideWindow | null,
  request: GuideAgendaRequest,
): GuideAgendaResult {
  if (!window) return { confirmations: [], additions: [] };
  const dates = request.dates.join(',');
  let memo = INDEX_MEMO.get(window);
  if (!memo || memo.catalog !== catalog || memo.dates !== dates) {
    memo = {
      catalog,
      dates,
      index: prepareGuideAgenda(guideCandidates(catalog, window), request.dates, request.dateOf),
    };
    INDEX_MEMO.set(window, memo);
  }
  return guideAgendaFrom(memo.index, request, { agendaScorer });
}
