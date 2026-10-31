/* «Ver ficha» del popover de la Guía: qué programa es un partido de la Agenda. */

import type { FootballMatch } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { matchForProgramme, versusHalves } from './agenda-link.ts';

const HOUR = 60 * 60_000;
const KICKOFF = Date.UTC(2026, 9, 31, 19, 0);

function match(id: string, home: string, away: string, start = KICKOFF): FootballMatch {
  return {
    id,
    date: '2026-10-31',
    time: '20:00',
    start,
    title: `${home} - ${away}`,
    home,
    away,
    competition: 'LaLiga',
    country: 'España',
    channels: [],
  };
}

const MATCHES = [
  match('a', 'Real Madrid', 'FC Barcelona'),
  match('b', 'Valencia', 'Sevilla'),
  match('c', 'Atlético de Madrid', 'Osasuna', KICKOFF + 24 * HOUR),
];

describe('agenda-link', () => {
  it('parte «A - B», «A – B» y «A vs B»; lo demás no es un partido', () => {
    expect(versusHalves('Valencia - Sevilla')).toEqual(['Valencia', 'Sevilla']);
    expect(versusHalves('Arsenal – Man City')).toEqual(['Arsenal', 'Man City']);
    expect(versusHalves('Lakers vs Celtics')).toEqual(['Lakers', 'Celtics']);
    expect(versusHalves('Telediario 2')).toBeNull();
    expect(versusHalves('Ocho apellidos vascos')).toBeNull();
  });

  it('casa por los dos equipos y una hora cercana (también con la competición delante)', () => {
    const at = (title: string, start = KICKOFF) => ({ title, start, end: start + 2 * HOUR });
    expect(matchForProgramme(at('Valencia - Sevilla'), MATCHES)?.id).toBe('b');
    expect(matchForProgramme(at('LaLiga: Real Madrid - Barcelona'), MATCHES)?.id).toBe('a');
    // Al revés también (la guía a veces los da cambiados).
    expect(matchForProgramme(at('Sevilla - Valencia'), MATCHES)?.id).toBe('b');
    // La previa de media hora antes lleva a la ficha.
    expect(matchForProgramme(at('Valencia - Sevilla', KICKOFF - HOUR / 2), MATCHES)?.id).toBe('b');
  });

  it('no casa con otro día, con un solo equipo ni con un programa que no es un partido', () => {
    const at = (title: string, start = KICKOFF) => ({ title, start, end: start + 2 * HOUR });
    expect(matchForProgramme(at('Valencia - Sevilla', KICKOFF + 26 * HOUR), MATCHES)).toBeNull();
    expect(matchForProgramme(at('Valencia - Betis'), MATCHES)).toBeNull();
    expect(matchForProgramme(at('El día después'), MATCHES)).toBeNull();
  });

  it('sin `start`, la fecha y la hora de Madrid', () => {
    const { start: _drop, ...rest } = match('d', 'Mallorca', 'Espanyol');
    // 20:00 de Madrid el 31-oct (ya en horario de invierno, UTC+1) son las 19:00 UTC.
    const madrid: FootballMatch = rest;
    const programme = { title: 'Mallorca - Espanyol', start: KICKOFF, end: KICKOFF + 2 * HOUR };
    expect(matchForProgramme(programme, [madrid])?.id).toBe('d');
  });
});
