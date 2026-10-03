/* Agenda híbrida (D-propuesta; docs/iptv.md §4.7). Puro.

   Días 1-14, futbolenlatv como siempre. HOY y MAÑANA (lo que cubre la guía),
   la guía de la IPTV:

   1. CONFIRMA un partido de la agenda y su canal exacto, con las mismas
      reglas y los mismos candidatos que la resolución (`confirmByGuide` sobre
      `guideCandidates`): lo que se enseña en la agenda es lo que luego suena
      primero.
   2. MUEVE la hora si futbolenlatv se equivoca: a su hora no hay nada, pero
      ese mismo día la guía tiene el partido EN DIRECTO (marca de directo
      obligatoria: las repeticiones sin marca son muy comunes, §15). Manda el
      primer programa así del día; el saque sale de él (`kickoffFromProgramme`).
   3. AÑADE un partido que la guía trae y la agenda no, con cuidado: solo en
      directo (marca obligatoria), de una competición que la agenda conoce
      (familia del texto o, si el texto no nombra ninguna, del canal), en un
      canal de España, con los dos equipos reconocibles en el título o el
      subtítulo, sin filiales, cantera ni femenino (salvo Liga F), y solo si
      ninguno de los dos equipos juega en la agenda ese día, el anterior o el
      siguiente (un equipo no juega dos días seguidos: así un nombre escrito
      de otra forma no duplica el partido).

   Sin IPTV, en pausa o sin guía, el servicio ni llama aquí; sin nada de la
   guía para un partido, ese partido queda tal cual. La guía solo suma. */

import { footballTeamIsVariant, footballTeamKey } from '@ace/shared';
import type { Catalog } from './catalog.js';
import type { GuideWindow } from './guide.js';
import {
  COMPETITION_FAMILY_LABELS,
  GUIDE_EARLY_MS,
  GUIDE_LATE_MS,
  competitionFamilies,
  competitionFamily,
  confirmByGuide,
  extractGuideMatchup,
  hasLiveMark,
  isNotLive,
  kickoffFromProgramme,
  programmeHasTeams,
  programmeLastsAMatch,
  programmeTexts,
  teamAliases,
  teamCache,
  type CompetitionFamily,
  type GuideChannelCandidate,
  type GuideConfirmation,
  type GuideMatchInput,
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

/**
 * Solo lo que puede ser un partido de esos días: dura lo de un partido, no
 * dice que no lo es y su saque posible cae en uno de los días. Es un
 * superconjunto de lo que `confirmByGuide` acepta para esos días, así que el
 * resultado es el mismo que con la guía entera (y mucho más rápido).
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
        !isNotLive(programme),
    );
    if (programmes.length) out.push({ ...candidate, programmes });
  }
  return out;
}

function dayNumber(date: string): number | null {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(parsed) ? Math.round(parsed / DAY_MS) : null;
}

/** Saque de un partido que la guía tiene en directo ese día a otra hora (regla 2), o null. */
function moveByGuide(
  input: GuideMatchInput,
  date: string,
  candidates: readonly GuideChannelCandidate[],
  agendaScore: (display: string) => number,
  dateOf: (ms: number) => string,
): { readonly start: number; readonly channels: string[] } | null {
  const cache = teamCache(input);
  const kickoffs = new Set<number>();
  for (const candidate of candidates) {
    for (const programme of candidate.programmes) {
      if (!hasLiveMark(programme) || !programmeHasTeams(programme, cache)) continue;
      const kickoff = kickoffFromProgramme(programme);
      if (kickoff === null || kickoff === input.start || dateOf(kickoff) !== date) continue;
      kickoffs.add(kickoff);
    }
  }
  for (const start of [...kickoffs].sort((a, b) => a - b)) {
    const found = confirmByGuide({ ...input, start }, candidates, { agendaScore }).filter((item) =>
      hasLiveMark(item.programme),
    );
    if (found.length) return { start, channels: distinctChannels(found) };
  }
  return null;
}

interface AgendaTeams {
  readonly day: number;
  readonly cache: TeamCache;
  readonly aliases: ReadonlySet<string>;
  readonly keys: readonly string[];
}

/** ¿Es este nombre uno de los dos equipos de ese partido? */
function sameTeam(name: string, match: AgendaTeams): boolean {
  if (match.keys.includes(footballTeamKey(name))) return true;
  return teamAliases(name).some((alias) => match.aliases.has(alias));
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
  const dates = new Set(request.dates);
  if (!dates.size || !allCandidates.length) return { confirmations: [], additions: [] };
  const candidates = slimCandidates(allCandidates, dates, request.dateOf);
  if (!candidates.length) return { confirmations: [], additions: [] };

  // 1 y 2: confirmar (y mover) los partidos de la agenda.
  const confirmations: GuideAgendaConfirmation[] = [];
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
    const agendaScore = options.agendaScorer(match.channels);
    const found = confirmByGuide(input, candidates, { agendaScore });
    if (found.length) {
      confirmations.push({
        matchId: match.id,
        channels: distinctChannels(found),
        start: match.start,
        moved: false,
      });
      continue;
    }
    const moved = moveByGuide(input, match.date, candidates, agendaScore, request.dateOf);
    if (moved) confirmations.push({ matchId: match.id, ...moved, moved: true });
  }

  // 3: lo que solo trae la guía.
  const agenda: AgendaTeams[] = [];
  for (const match of request.matches) {
    const day = dayNumber(match.date);
    if (day === null || !match.home.trim() || !match.away.trim()) continue;
    const cache = teamCache(match);
    agenda.push({
      day,
      cache,
      aliases: new Set([...cache.home, ...cache.away]),
      keys: [footballTeamKey(match.home), footballTeamKey(match.away)].filter(Boolean),
    });
  }
  const groups = new Map<
    string,
    {
      readonly home: string;
      readonly away: string;
      readonly family: CompetitionFamily;
      readonly start: number;
      readonly date: string;
    }
  >();
  for (const candidate of candidates) {
    if (candidate.country !== 'ES') continue;
    const channelFamily = competitionFamily(candidate.display);
    for (const programme of candidate.programmes) {
      if (!hasLiveMark(programme)) continue;
      const pair = extractGuideMatchup(programme.title) ?? extractGuideMatchup(programme.subTitle);
      if (!pair || footballTeamIsVariant(pair.home) || footballTeamIsVariant(pair.away)) continue;
      const named = competitionFamilies(programmeTexts(programme).join(' | '));
      const family = named.size === 1 ? [...named][0] : named.size === 0 ? channelFamily : null;
      if (!family || (channelFamily && channelFamily !== family)) continue;
      const start = kickoffFromProgramme(programme);
      if (start === null) continue;
      const date = request.dateOf(start);
      const day = dayNumber(date);
      if (!dates.has(date) || day === null) continue;
      const known = agenda.some(
        (match) =>
          Math.abs(match.day - day) <= 1 &&
          (programmeHasTeams(programme, match.cache) ||
            sameTeam(pair.home, match) ||
            sameTeam(pair.away, match)),
      );
      if (known) continue;
      const key = `${date}|${[footballTeamKey(pair.home), footballTeamKey(pair.away)].sort().join('|')}`;
      const previous = groups.get(key);
      if (!previous || start < previous.start) groups.set(key, { ...pair, family, start, date });
    }
  }
  const additions: GuideAgendaAddition[] = [];
  const added: AgendaTeams[] = [];
  for (const group of [...groups.values()].sort((a, b) => a.start - b.start)) {
    const day = dayNumber(group.date) as number;
    /* Dos grafías del mismo partido («Barça - R. Madrid» y «Barcelona - Real Madrid»): uno. */
    if (
      added.some(
        (other) =>
          other.day === day && (sameTeam(group.home, other) || sameTeam(group.away, other)),
      )
    ) {
      continue;
    }
    const competition = COMPETITION_FAMILY_LABELS[group.family];
    const found = confirmByGuide(
      {
        home: group.home,
        away: group.away,
        competition,
        title: `${group.home} - ${group.away}`,
        start: group.start,
        channels: [],
      },
      candidates,
      { agendaScore: () => 0 },
    ).filter((item) => hasLiveMark(item.programme));
    if (!found.length) continue;
    additions.push({
      home: group.home,
      away: group.away,
      family: group.family,
      competition,
      date: group.date,
      start: group.start,
      channels: distinctChannels(found),
    });
    const cache = teamCache(group);
    added.push({
      day,
      cache,
      aliases: new Set([...cache.home, ...cache.away]),
      keys: [footballTeamKey(group.home), footballTeamKey(group.away)].filter(Boolean),
    });
  }
  return { confirmations, additions };
}

/** La agenda híbrida con el catálogo y la guía del servicio (los mismos candidatos que la resolución). */
export function buildGuideAgenda(
  catalog: Catalog,
  window: GuideWindow | null,
  request: GuideAgendaRequest,
): GuideAgendaResult {
  return guideAgenda(guideCandidates(catalog, window), request, { agendaScorer });
}
