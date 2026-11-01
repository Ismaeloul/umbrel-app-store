/* «Avisos» de Ajustes: de qué partidos se avisa y cuándo (lo puro). */

import type { FootballMatch, FootballSchedule, Preferences } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { fixture } from '../../test/fetch.ts';
import { minutesToMatch } from '../agenda/domain.ts';
import { alertText, dueAlerts } from './match-alerts.tsx';

const schedule = fixture<FootballSchedule>('footballSchedule');
const match = schedule.days
  .flatMap((day) => day.matches)
  .find((m) => m.home && m.time) as FootballMatch;
const one: Pick<FootballSchedule, 'days'> = {
  days: [{ ...(schedule.days[0] as FootballSchedule['days'][number]), matches: [match] }],
};
const prefs = (teams: string[]): Preferences =>
  ({
    ...fixture<{ preferences: Preferences }>('preferencesGet').preferences,
    teams,
  }) as Preferences;

/** Un «ahora» al que le faltan `minutes` para el partido. */
function nowFor(minutes: number): number {
  const base = Date.parse(`${match.date}T12:00:00Z`);
  const left = minutesToMatch(match, base) as number;
  return base + (left - minutes) * 60_000;
}

describe('avisos de Mis equipos', () => {
  const mine = prefs([match.home]);

  it('avisa dentro del plazo elegido, una vez, y no de lo que ya empezó hace rato', () => {
    expect(dueAlerts(one, mine, 5, nowFor(6), new Set())).toEqual([]);
    expect(dueAlerts(one, mine, 5, nowFor(5), new Set())).toEqual([{ match, minutes: 5 }]);
    expect(dueAlerts(one, mine, 5, nowFor(0), new Set())).toEqual([{ match, minutes: 0 }]);
    expect(dueAlerts(one, mine, 5, nowFor(-5), new Set())).toEqual([]);
    expect(dueAlerts(one, mine, 5, nowFor(5), new Set([match.id]))).toEqual([]);
  });

  it('«Nunca», sin equipos o con otro equipo: nada', () => {
    expect(dueAlerts(one, mine, null, nowFor(0), new Set())).toEqual([]);
    expect(dueAlerts(one, prefs([]), 5, nowFor(0), new Set())).toEqual([]);
    expect(dueAlerts(one, prefs(['Equipo que no juega']), 5, nowFor(0), new Set())).toEqual([]);
  });

  it('un partido con aviso en la campana («Te aviso») no avisa otra vez aquí', () => {
    expect(dueAlerts(one, mine, 5, nowFor(5), new Set(), new Set([match.id]))).toEqual([]);
    expect(dueAlerts(one, mine, 5, nowFor(5), new Set(), new Set(['otro']))).toEqual([
      { match, minutes: 5 },
    ]);
  });

  it('«Al empezar» avisa justo a la hora', () => {
    expect(dueAlerts(one, mine, 0, nowFor(1), new Set())).toEqual([]);
    expect(dueAlerts(one, mine, 0, nowFor(0), new Set())).toEqual([{ match, minutes: 0 }]);
  });

  it('el texto', () => {
    expect(alertText({ match, minutes: 5 })).toMatch(/ empieza en 5 min$/);
    expect(alertText({ match, minutes: 0 })).toMatch(/ empieza ya$/);
  });
});
