/* Agenda híbrida sobre la agenda (D27; docs/iptv.md §4.7). Puro.

   La IPTV dice qué sabe su guía de hoy y mañana (`IptvService.guideAgenda`,
   iptv/guide-agenda.ts) y aquí se pinta sobre la agenda de siempre:
   - un partido CONFIRMADO lleva `guide` («Confirmado en tu guía: M+ LaLiga TV
     2 · 21:00») y el canal de la guía va el PRIMERO en `channels` (el de la
     agenda si es el mismo canal, con su nombre; si no, uno nuevo con el
     nombre de la IPTV). Así la resolución busca primero por ese canal, en la
     IPTV y en AceStream, y la tarjeta lo enseña delante;
   - si la guía MUEVE la hora, cambian `time` y `start` (el id no) y `guide`
     guarda la que decía la agenda (`agendaTime`);
   - un partido que solo trae la guía entra en su día con id `guia-…`, sus
     canales y `guide.added`.
   Sin nada de la guía, la agenda sale tal cual (el MISMO objeto). */

import { footballCompetitionIsMinor, type FootballMatch, type FootballSchedule } from '@ace/shared';
import { competitionFamily, matchEventKind } from '../iptv/guide-match.js';
import type {
  GuideAgendaAddition,
  GuideAgendaConfirmation,
  GuideAgendaMatch,
  GuideAgendaRequest,
  GuideAgendaResult,
} from '../iptv/types.js';
import { stableMatchId } from './agenda-sources.js';
import { FOOTBALL_SPAIN } from './constants.js';
import { addIsoDays, isoDateInMadrid, madridClock, madridLocalToEpoch } from './time.js';

/** «Es el mismo canal» de la IPTV (≥ 92), en los dos sentidos. */
const SAME_CHANNEL = 92;

type FootballChannelRef = FootballMatch['channels'][number];

/** Lo más largo que puede ser `guide.channel` (el contrato). */
const GUIDE_CHANNEL_MAX = 200;

/** Saque de un partido de la agenda (el de futbolenlatv o, sin él, su fecha y hora de Madrid). */
export function matchKickoff(match: Pick<FootballMatch, 'start' | 'date' | 'time'>): number | null {
  const start = Number(match.start);
  if (Number.isFinite(start) && start > 0) return start;
  return madridLocalToEpoch(match.date, match.time);
}

/**
 * Lo que se le pregunta a la guía: los partidos de hoy, mañana y pasado
 * (pasado solo para no añadir uno que ya está), con hoy y mañana como días
 * en los que manda. `key` cambia con la agenda (la caché de la IPTV).
 */
export function guideAgendaRequest(payload: FootballSchedule, now: number): GuideAgendaRequest {
  const today = isoDateInMadrid(now);
  const dates = [today, addIsoDays(today, 1)];
  const around = new Set([...dates, addIsoDays(today, 2)]);
  const matches: GuideAgendaMatch[] = [];
  for (const day of payload.days) {
    if (!around.has(day.date)) continue;
    for (const match of day.matches) {
      matches.push({
        id: match.id,
        date: match.date,
        home: match.home,
        away: match.away,
        competition: match.competition,
        title: match.title,
        start: matchKickoff(match),
        channels: match.channels.map((channel) => channel.name).filter(Boolean),
      });
    }
  }
  return { matches, dates, dateOf: isoDateInMadrid, key: `${payload.generatedAt}|${today}` };
}

export interface GuideOverlayOptions {
  /** `sameChannelScore` de la IPTV (docs/iptv.md §14.3): ≥ 92 es el mismo canal. */
  readonly sameChannel: (base: string, other: string) => number;
}

/** Los canales con los de la guía delante (el de la agenda si es el mismo, con su nombre). */
function guideFirst(
  match: FootballMatch,
  names: readonly string[],
  options: GuideOverlayOptions,
): FootballChannelRef[] {
  const rest = [...match.channels];
  const front: FootballChannelRef[] = [];
  for (const name of names) {
    const index = rest.findIndex(
      (channel) =>
        Math.max(
          options.sameChannel(channel.name, name),
          options.sameChannel(name, channel.name),
        ) >= SAME_CHANNEL,
    );
    const found = index >= 0 ? rest.splice(index, 1)[0] : undefined;
    front.push(found ?? { id: `${match.id}-guia-${front.length}`, name });
  }
  return [...front, ...rest];
}

function confirmMatch(
  match: FootballMatch,
  confirmation: GuideAgendaConfirmation,
  options: GuideOverlayOptions,
): FootballMatch {
  const channels = guideFirst(match, confirmation.channels, options);
  const label = channels[0]?.name ?? confirmation.channels[0] ?? '';
  if (!label) return match;
  const time = confirmation.moved ? madridClock(confirmation.start) : match.time;
  return {
    ...match,
    ...(confirmation.moved
      ? { date: isoDateInMadrid(confirmation.start), time, start: confirmation.start }
      : {}),
    channels,
    guide: {
      channel: label.slice(0, GUIDE_CHANNEL_MAX),
      time,
      ...(confirmation.moved ? { agendaTime: match.time } : {}),
      added: false,
    },
  };
}

/**
 * Rótulo de la competición: el que ya usa la agenda para esa familia («La
 * Liga EA Sports») o el de la guía. Nunca el de la femenina o la cantera de
 * esa familia («Liga de Campeones Femenina», «Mundial Sub-20», «Copa del Rey
 * Juvenil»): un partido que añade la guía es del primer equipo (salvo Liga F,
 * que ya es femenina).
 */
function competitionLabel(payload: FootballSchedule, addition: GuideAgendaAddition): string {
  for (const day of payload.days) {
    for (const match of day.matches) {
      if (competitionFamily(match.competition) !== addition.family) continue;
      const kind = matchEventKind({ competition: match.competition });
      const minor = footballCompetitionIsMinor(match.competition) || kind.women || kind.youth;
      if (minor && addition.family !== 'ligaf') continue;
      return match.competition;
    }
  }
  return addition.competition;
}

function addedMatch(payload: FootballSchedule, addition: GuideAgendaAddition): FootballMatch {
  const time = madridClock(addition.start);
  const id = stableMatchId('guia', addition.date, time, addition.home, addition.away);
  return {
    id,
    date: addition.date,
    time,
    start: addition.start,
    title: `${addition.home} - ${addition.away}`,
    home: addition.home,
    away: addition.away,
    competition: competitionLabel(payload, addition),
    country: FOOTBALL_SPAIN,
    channels: addition.channels.map((name, index) => ({ id: `${id}-${index}`, name })),
    guide: { channel: (addition.channels[0] ?? '').slice(0, GUIDE_CHANNEL_MAX), time, added: true },
  };
}

/** Por hora de saque; los que no la tienen («Por confirmar»), donde estaban. */
function byKickoff(matches: readonly FootballMatch[]): FootballMatch[] {
  return matches
    .map((match, index) => ({ match, index, at: matchKickoff(match) }))
    .sort((a, b) => {
      if (a.at === null || b.at === null) return a.index - b.index;
      return a.at - b.at || a.index - b.index;
    })
    .map((item) => item.match);
}

/** La agenda con lo que dice la guía; la misma agenda (el mismo objeto) si la guía no dice nada. */
export function applyGuideAgenda(
  payload: FootballSchedule,
  result: GuideAgendaResult | null,
  options: GuideOverlayOptions,
): FootballSchedule {
  if (!result || (!result.confirmations.length && !result.additions.length)) return payload;
  const confirmed = new Map(result.confirmations.map((item) => [item.matchId, item]));
  let changed = false;
  const days = payload.days.map((day) => {
    let dayChanged = false;
    const matches = day.matches.map((match) => {
      const confirmation = confirmed.get(match.id);
      if (!confirmation) return match;
      const next = confirmMatch(match, confirmation, options);
      if (next !== match) dayChanged = true;
      return next;
    });
    const additions = result.additions
      .filter((addition) => addition.date === day.date && addition.channels.length)
      .map((addition) => addedMatch(payload, addition))
      .filter((added) => !matches.some((match) => match.id === added.id));
    if (!dayChanged && !additions.length) return day;
    changed = true;
    return { ...day, matches: byKickoff([...matches, ...additions]) };
  });
  return changed ? { ...payload, days } : payload;
}

/** La agenda para la ruta antigua: lo mismo, sin `guide` (la forma exacta de la 0.6.59). */
export function withoutGuideInfo(payload: FootballSchedule): FootballSchedule {
  if (!payload.days.some((day) => day.matches.some((match) => match.guide))) return payload;
  return {
    ...payload,
    days: payload.days.map((day) => ({
      ...day,
      matches: day.matches.map((match) => {
        if (!match.guide) return match;
        const { guide: _guide, ...rest } = match;
        return rest;
      }),
    })),
  };
}
