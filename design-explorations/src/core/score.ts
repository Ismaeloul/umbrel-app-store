import type { LiveScore, Match } from './types';

/* Marcador y minuto de un partido en un instante. 45 + 15 de descanso + 45,
   con hasta 4 min de añadido en cada parte. */

const HALF = 45 * 60_000;
const BREAK = 15 * 60_000;
const ADDED_1 = 2 * 60_000;
const ADDED_2 = 4 * 60_000;

export function scoreAt(match: Match, nowMs: number): LiveScore {
  const elapsed = nowMs - match.start;
  const untilKickoffMs = -elapsed;
  const base = { home: 0, away: 0, goals: [] as LiveScore['goals'] };
  if (elapsed < 0) {
    return { ...base, state: 'pre', clock: '', minute: 0, detail: '', half: 0, halftime: false, progress: 0, untilKickoffMs };
  }
  const end1 = HALF + ADDED_1;
  const start2 = end1 + BREAK;
  const end2 = start2 + HALF + ADDED_2;
  let minute: number;
  let clock: string;
  let detail: string;
  let half: LiveScore['half'];
  let halftime = false;
  let state: LiveScore['state'] = 'in';
  if (elapsed < end1) {
    minute = Math.floor(elapsed / 60_000) + 1;
    half = 1;
    clock = minute > 45 ? `45+${minute - 45}'` : `${minute}'`;
    detail = '1ª parte';
  } else if (elapsed < start2) {
    minute = 45;
    half = 1;
    halftime = true;
    clock = 'Desc.';
    detail = 'Descanso';
  } else if (elapsed < end2) {
    minute = 45 + Math.floor((elapsed - start2) / 60_000) + 1;
    half = 2;
    clock = minute > 90 ? `90+${minute - 90}'` : `${minute}'`;
    detail = '2ª parte';
  } else {
    minute = 90;
    half = 3;
    state = 'post';
    clock = 'Final';
    detail = 'Final';
  }
  const goals = state === 'post' ? match.goals : match.goals.filter((g) => g.minute <= minute && !(halftime && g.minute > 45));
  const home = goals.filter((g) => g.side === 'home').length;
  const away = goals.filter((g) => g.side === 'away').length;
  const progress = state === 'post' ? 1 : Math.min(1, elapsed / end2);
  return { home, away, state, clock, minute, detail, half, halftime, progress, untilKickoffMs, goals };
}

export type MatchPhase = 'live' | 'upcoming' | 'finished';

export function phaseOf(match: Match, nowMs: number): MatchPhase {
  const s = scoreAt(match, nowMs);
  if (s.state === 'in') return 'live';
  if (s.state === 'pre') return 'upcoming';
  return 'finished';
}
