/* Lo que necesita una tarjeta versus para pintar un partido (plan Palco fase
   2, decisiones D4 y W4): los dos lados con sus colores, siglas y escudos
   (`lib/teams.ts`), el chip de cuándo («HOY 21:00», «EN DIRECTO · 13'»,
   «Final», «Por confirmar»), la palabra y el tono de la cápsula de señal, y
   la luz de los dos clubes (`matchGlow`) que tiñe la fila en directo y viaja
   al reproductor. Funciones puras: se prueban solas en cards.test.ts.

   `matchGlow(match)` sustituye a `teamGlow(nombre)` (MatchRow.tsx): usa la
   paleta de la API cuando el backend la da y, si no, el tono del nombre; el
   valor es un `oklch()` con la luz normalizada (lib/color.ts › teamLight)
   que sirve en los dos temas como velo al 16 %. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { hueFromName, oklchCss, teamLight } from '../../lib/color.ts';
import {
  teamBadge,
  teamCrest,
  teamName,
  teamPalette,
  teamShort,
  type MatchSide,
  type TeamLike,
} from '../../lib/teams.ts';
import type { CapsuleTone, SignalState, VersusWhen } from '../../ui/index.ts';
import { dayLabel, liveMinute, matchStatus, type MatchSignal } from './domain.ts';

/** Un lado de la tarjeta: nombre (o siglas en la compacta), colores, escudo. */
export function versusSide(
  match: FootballMatch,
  side: MatchSide,
  options: { short?: boolean } = {},
): TeamLike {
  const badge = teamBadge(match, side);
  const fullName = teamName(match, side) || (side === 'home' ? match.title : '');
  const short = badge?.short ?? null;
  return {
    name: options.short && fullName ? teamShort(match, side) : fullName || '…',
    short,
    // La paleta ya resuelta (API o nombre completo): así la tarjeta compacta
    // con siglas pinta los mismos colores que la grande con el nombre.
    colors: teamPalette(match, side),
    crest: teamCrest(match, side),
  };
}

/** Chip de arriba de la tarjeta versus. */
export function versusWhen(
  match: FootballMatch,
  now: number,
  score: LiveScore | null | undefined,
  today: string,
): VersusWhen {
  const status = matchStatus(match, now, score);
  if (status?.phase === 'live') {
    const minute = liveMinute(score);
    if (minute?.halftime) return { kind: 'live', label: 'Descanso' };
    return minute
      ? { kind: 'live', label: 'En directo', minute: minute.minute }
      : { kind: 'live', label: 'En directo' };
  }
  if (status?.phase === 'done') return { kind: 'done', label: 'Final' };
  if (!/^\d{2}:\d{2}$/.test(match.time)) return { kind: 'tbc', label: 'Por confirmar' };
  const day = dayLabel(match.date, today);
  return { kind: 'time', label: `${day.primary} ${match.time}` };
}

/* Palabras de la cápsula de señal de un partido (DESIGN.md › «Señal de una
   fuente», en la agenda): «Señal» cuando hay fuentes verificadas; el resto,
   las del medidor. Una etiqueta propia («Sin fuentes», «Sin comprobar»,
   «Sin señal · reintento 20:51») manda sobre la palabra. */
const MATCH_SIGNAL_WORD: Record<SignalState, string> = {
  ok: 'Señal',
  weak: 'Floja',
  fail: 'Sin señal',
  checking: 'Comprobando',
  pending: 'Pendiente',
};

export function signalWord(signal: Pick<MatchSignal, 'state' | 'label'>): string {
  return signal.label ?? MATCH_SIGNAL_WORD[signal.state];
}

/** Tono de la cápsula: el semáforo para lo que ya se sabe; neutro mientras se mira. */
export function signalTone(state: SignalState): CapsuleTone {
  switch (state) {
    case 'ok':
      return 'ok';
    case 'weak':
      return 'weak';
    case 'fail':
      return 'fail';
    default:
      return 'neutral';
  }
}

function glowOf(match: FootballMatch, side: MatchSide): string {
  const palette = teamPalette(match, side);
  const light = teamLight(palette.primary, palette.secondary, 'dark') ?? {
    l: 0.66,
    c: 0.13,
    h: hueFromName(teamName(match, side) || '?'),
  };
  return oklchCss(light);
}

/**
 * Luz de los dos clubes para los velos (`--ta` / `--tb` de la fila y el
 * escenario; `sources/session.ts` puede usarla para la luz ambiental del
 * reproductor). Sin visitante, las dos luces son las del local.
 */
export function matchGlow(match: FootballMatch): { home: string; away: string } {
  const home = glowOf(match, 'home');
  return { home, away: match.away ? glowOf(match, 'away') : home };
}
