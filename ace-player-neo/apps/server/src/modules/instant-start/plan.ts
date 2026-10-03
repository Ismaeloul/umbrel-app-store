/* Reglas puras de «Arranque instantáneo» (D24): qué partidos cuentan, cuál
   se prepara y qué toca hacer en cada vuelta. Sin reloj ni servicios: los
   tests las prueban con horas fijas.

   Solo cuentan los partidos de tus EQUIPOS favoritos (corrección de Isma,
   0.8.4): ni las ligas ni las selecciones que sigues como tales, porque
   preparar todos los partidos de una liga sobrecargaría el Umbrel. Un equipo
   casa como en «Para ti» (`footballMatchHasFavoriteTeam`): el primer equipo
   por su `idTeam` si el partido trae escudo, y nunca su cantera, filial o
   femenino salvo que sigas ese equipo tal cual. La selección solo entra si la
   sigues como equipo («España» en tus equipos). */

import {
  footballMatchHasFavoriteTeam,
  type ForYouMatch,
  type ResolutionCandidate,
} from '@ace/shared';
import { footballScheduleMatches } from '../football/agenda-sources.js';
import {
  INSTANT_START_LATE_START_MS,
  INSTANT_START_MAX_FAILURES,
  INSTANT_START_PREWARM_LEAD_MS,
  INSTANT_START_REFRESH_LEAD_MS,
  INSTANT_START_RELEASE_AFTER_MS,
} from './constants.js';

/** Un partido de un equipo favorito. */
export interface FavoriteMatch {
  readonly id: string;
  readonly start: number;
  readonly title: string;
  /** Posición del primer equipo favorito que juega, en el orden de tus gustos (desempate). */
  readonly rank: number;
}

/** Posición en `teams` del primer favorito que juega este partido, o -1. */
export function favoriteTeamRank(match: ForYouMatch, teams: readonly string[]): number {
  return teams.findIndex((team) =>
    footballMatchHasFavoriteTeam(match, { leagues: [], teams: [team], nationalities: [] }),
  );
}

/** Los partidos de la agenda que juega alguno de tus equipos (con saque conocido). */
export function favoriteMatches(payload: unknown, teams: readonly string[]): FavoriteMatch[] {
  if (!teams.length) return [];
  const output: FavoriteMatch[] = [];
  for (const match of footballScheduleMatches(payload)) {
    const id = typeof match.id === 'string' ? match.id : '';
    const start = Number(match.start);
    if (!id || !Number.isFinite(start) || start <= 0) continue;
    const rank = favoriteTeamRank(match as ForYouMatch, teams);
    if (rank < 0) continue;
    const title =
      String(match.title ?? '') || [match.home, match.away].filter(Boolean).join(' - ') || id;
    output.push({ id, start, title, rank });
  }
  return output;
}

/** ¿El partido está en la ventana de «Arranque instantáneo» (de T-10 a T+10)? */
export function inWindow(match: FavoriteMatch, now: number): boolean {
  return (
    now >= match.start - INSTANT_START_REFRESH_LEAD_MS &&
    now <= match.start + INSTANT_START_RELEASE_AFTER_MS
  );
}

/**
 * EL partido que se prepara ahora: de los que están en ventana, el de saque
 * más temprano; a igual saque, el del equipo que va antes en tus gustos.
 * Nunca más de uno (una sola fuente preparada a la vez, D5).
 */
export function chooseTarget(matches: readonly FavoriteMatch[], now: number): FavoriteMatch | null {
  let best: FavoriteMatch | null = null;
  for (const match of matches) {
    if (!inWindow(match, now)) continue;
    if (
      !best ||
      match.start < best.start ||
      (match.start === best.start && match.rank < best.rank)
    ) {
      best = match;
    }
  }
  return best;
}

/** Lo que se recuerda de un partido entre vueltas. */
export interface MatchMemory {
  /** Ya se resolvió a T-10. */
  refreshed: boolean;
  /** La preparación ya terminó para siempre (se usó, cedió o caducó). */
  done: boolean;
  failures: number;
}

export const EMPTY_MEMORY: MatchMemory = { refreshed: false, done: false, failures: 0 };

export interface PlanStep {
  readonly refresh: boolean;
  readonly prewarm: boolean;
  /** Soltar la preparación activa (es de otro partido o ya pasó su rato). */
  readonly release: boolean;
}

/**
 * Qué toca en esta vuelta. `active` es la preparación en curso (de
 * playback), con el saque de su partido si se conoce.
 */
export function planStep(
  now: number,
  target: FavoriteMatch | null,
  memory: MatchMemory,
  active: { readonly matchId: string; readonly start: number | null } | null,
): PlanStep {
  const release =
    active !== null &&
    (target === null ||
      active.matchId !== target.id ||
      now > (active.start ?? target.start) + INSTANT_START_RELEASE_AFTER_MS);
  if (!target) return { refresh: false, prewarm: false, release };
  const lateLimit = target.start + INSTANT_START_LATE_START_MS;
  const refresh =
    !memory.refreshed && now >= target.start - INSTANT_START_REFRESH_LEAD_MS && now <= lateLimit;
  const prewarm =
    (active === null || release) &&
    !memory.done &&
    memory.failures < INSTANT_START_MAX_FAILURES &&
    now >= target.start - INSTANT_START_PREWARM_LEAD_MS &&
    now <= lateLimit;
  return { refresh, prewarm, release };
}

/**
 * La fuente que va a pedir el «Ver» (la misma regla que `pickAutoSource` de
 * la web): la primera IPTV que el comprobador no da por caída; si no, la
 * primera AceStream que funciona y, si no, una floja. Sin comprobador, la
 * mejor colocada (como la web sin comprobador). Lo reportado o en cuarentena,
 * nunca.
 */
export function pickPrewarmCandidate(
  candidates: readonly ResolutionCandidate[],
  verdictOf: (hash: string) => string | null,
  scannerEnabled: boolean,
): ResolutionCandidate | null {
  const pool = candidates.filter(
    (candidate) => !candidate.quarantined && !candidate.reported && !candidate.rejectedByLearning,
  );
  const iptv = pool.find(
    (candidate) => candidate.source === 'iptv' && verdictOf(candidate.id) !== 'failed',
  );
  if (iptv) return iptv;
  const engine = pool.filter((candidate) => candidate.source !== 'iptv');
  if (!scannerEnabled) return engine[0] ?? null;
  return (
    engine.find((candidate) => verdictOf(candidate.id) === 'working') ??
    engine.find((candidate) => verdictOf(candidate.id) === 'weak') ??
    null
  );
}
