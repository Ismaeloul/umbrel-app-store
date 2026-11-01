/* «Ver ficha» del popover de la Guía: ¿este programa es un partido de la
   Agenda? Puro (se prueba en agenda-link.test.ts).

   La guía dice «Real Madrid - Barcelona» (a veces con la competición delante:
   «LaLiga: Real Madrid - Barcelona») y la Agenda tiene local y visitante con
   su hora. Casa si los dos equipos están en el título (por su clave de
   equipo, que ya junta «Atlético»/«Atlético de Madrid» y compañía) y el
   partido empieza cerca del programa: una previa de 30 min o un programa que
   arranca un rato antes del saque también llevan a su ficha. */

import { footballTeamKey, type FootballMatch } from '@ace/shared';

const HOUR = 60 * 60_000;
/** Lo más lejos que puede estar el saque del inicio del programa. */
const WINDOW_MS = 3 * HOUR;

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Las dos mitades de «A - B», «A – B» o «A vs B»; null si el título no es un enfrentamiento. */
export function versusHalves(title: string): [string, string] | null {
  const parts = title.split(/\s+(?:-|–|—|vs\.?|v)\s+/i);
  if (parts.length !== 2) return null;
  const [home = '', away = ''] = parts;
  return home.trim() && away.trim() ? [home, away] : null;
}

/** ¿El trozo del título nombra a este equipo? */
function names(part: string, team: string): boolean {
  const a = footballTeamKey(part);
  const b = footballTeamKey(team);
  if (a && b && a === b) return true;
  const text = fold(part);
  const name = fold(team);
  return name.length >= 4 && ` ${text} `.includes(` ${name} `);
}

const MADRID = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid',
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

/** Minutos que Madrid va por delante de UTC en ese instante (60 o 120). */
function madridOffset(at: number): number {
  const parts = Object.fromEntries(
    MADRID.formatToParts(at).map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
  );
  return Math.round((local - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** El instante del saque: `start` o la fecha y la hora de Madrid. */
function kickoffOf(match: FootballMatch): number | null {
  if (typeof match.start === 'number') return match.start;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(match.date);
  const time = /^(\d{1,2}):(\d{2})$/.exec(match.time);
  if (!date || !time) return null;
  const guess = Date.UTC(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]),
    Number(time[2]),
  );
  return guess - madridOffset(guess) * 60_000;
}

/** El partido de la Agenda que es este programa, o null. */
export function matchForProgramme(
  programme: { title: string; start: number; end: number },
  matches: readonly FootballMatch[],
): FootballMatch | null {
  const halves = versusHalves(programme.title);
  if (!halves) return null;
  const [first, second] = halves;
  let best: FootballMatch | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const match of matches) {
    if (!match.home || !match.away) continue;
    const kickoff = kickoffOf(match);
    if (kickoff === null) continue;
    const gap =
      kickoff < programme.start
        ? programme.start - kickoff
        : kickoff > programme.end
          ? kickoff - programme.end
          : 0;
    if (gap > WINDOW_MS) continue;
    const same =
      (names(first, match.home) && names(second, match.away)) ||
      (names(first, match.away) && names(second, match.home));
    if (same && gap < bestGap) {
      best = match;
      bestGap = gap;
    }
  }
  return best;
}
