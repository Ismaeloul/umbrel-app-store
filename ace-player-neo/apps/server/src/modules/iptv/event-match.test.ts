/* Huecos de evento (PPV) con el partido en el nombre (docs/iptv.md §4.9):
   nombres como los de la IPTV real de Isma (2026-10-22). */

import { describe, expect, it } from 'vitest';
import { Catalog, type RawChannel } from './catalog.js';
import {
  EVENT_TIME_TOLERANCE_MS,
  eventChannelLabel,
  eventStart,
  isEventChannel,
  isIdleEvent,
  matchEventChannels,
} from './event-match.js';
import type { IptvProgramInput } from './types.js';

let seq = 0;
function raw(title: string, group = ''): RawChannel {
  seq += 1;
  return {
    id: seq.toString(16).padStart(40, '0'),
    title,
    group,
    tvgId: '',
    ref: String(seq),
    tvgShift: null,
    userAgent: null,
    referrer: null,
  };
}

function catalog(rows: readonly RawChannel[]): Catalog {
  return new Catalog('p_Ab3dE5gH', 1, 'xtream', 0, [], 'ts', rows);
}

function program(home: string, away: string, start: number, extra: Partial<IptvProgramInput> = {}) {
  return {
    id: 'fltv-x',
    home,
    away,
    competition: '',
    title: `${home} - ${away}`,
    start,
    channels: [],
    ...extra,
  } satisfies IptvProgramInput;
}

const ROWS = [
  raw(
    'Next Paynesville FC vs. Down Town FC LFA First Division - Liberia 2026-10-21 16:00 (GMT) 8K EXCLUSIVE ES: DAZN PPV 2',
    'ES| DAZN PPV',
  ),
  raw('NO EVENT STREAMING NOW - 8K EXCLUSIVE ES: DAZN PPV 7', 'ES| DAZN PPV'),
  raw(
    'NEXT INTER MIAMI VS. ORLANDO CITY Thu 22 Oct 01:00 CEST (ES) 8K EXCLUSIVE ES: MLS PPV 1',
    'ES| MLS PPV',
  ),
  raw(
    'RFEF EVENTO 01 1ª RFEF FINALIZADO UD Logroñés VS Cultural Leonesa J8 18/10 19:55',
    'ES| RFEF PPV',
  ),
  raw('RFEF EVENTO 05 1ª RFEF UD Logroñés VS Cultural Leonesa J8 18/10 19:55', 'ES| RFEF PPV'),
  raw('RFEF EVENTO 06 No event', 'ES| RFEF PPV'),
  raw('América vs. Club Tijuana (2026-10-28 22:45:00)', 'ES| VIX PPV'),
  raw(
    'Next Sevilla vs. Real Betis LaLiga 2026-10-21 19:00 (GMT) 8K EXCLUSIVE ES: SOCCER PPV 3',
    'ES| SOCCER PPV',
  ),
  raw(
    'Next Sevilla vs. Real Betis LaLiga 2026-10-21 19:00 (GMT) 8K EXCLUSIVE ES: SOCCER PPV 3',
    'ES| SOCCER PPV ⁽ᴮᴷ⁾',
  ),
  raw('DE: Next Sevilla vs. Real Betis 2026-10-21 19:00 (GMT) DAZN PPV 4', 'DE| DAZN PPV'),
  raw('DAZN LaLiga', 'ES| DAZN ESPAÑA VIP'),
];

describe('eventStart · la hora que trae el nombre', () => {
  const kickoff = Date.UTC(2026, 9, 21, 16, 0);
  it.each([
    ['… Liberia 2026-10-21 16:00 (GMT) 8K EXCLUSIVE', Date.UTC(2026, 9, 21, 16, 0)],
    ['Next John Higgins - Jak Jones all 21-10-2026 14:00 (GMT) 8K', Date.UTC(2026, 9, 21, 14, 0)],
    ['NEXT CINCINNATI VS. D.C. Thu 22 Oct 01:00 CEST (ES) 8K', Date.UTC(2026, 9, 21, 23, 0)],
    /* Sin zona: hora de Madrid (CEST el 18 de octubre, CET el 28). */
    [
      'RFEF EVENTO 05 UD Logroñés VS Cultural Leonesa J8 18/10 19:55',
      Date.UTC(2026, 9, 18, 17, 55),
    ],
    ['América vs. Club Tijuana (2026-10-28 22:45:00)', Date.UTC(2026, 9, 28, 21, 45)],
    ['NO EVENT STREAMING NOW - 8K EXCLUSIVE ES: DAZN PPV 7', null],
    ['DAZN LaLiga', null],
  ])('%s', (title, expected) => {
    expect(eventStart(title, kickoff)).toBe(expected);
  });
});

describe('eventChannelLabel, isEventChannel, isIdleEvent', () => {
  it('el nombre corto del hueco', () => {
    expect(eventChannelLabel(ROWS[0]!.title)).toBe('DAZN PPV 2');
    expect(eventChannelLabel(ROWS[2]!.title)).toBe('MLS PPV 1');
    expect(eventChannelLabel(ROWS[4]!.title)).toBe('RFEF EVENTO 05');
    expect(eventChannelLabel('LIGA F EVENTO 03 No event')).toBe('LIGA F EVENTO 03');
    expect(eventChannelLabel(ROWS[6]!.title)).toBe(
      'América vs. Club Tijuana (2026-10-28 22:45:00)',
    );
  });

  it('qué es un hueco y cuándo está vacío', () => {
    expect(isEventChannel(ROWS[0]!.title, '')).toBe(true);
    expect(isEventChannel('América vs. Club Tijuana', 'ES| VIX PPV')).toBe(true);
    expect(isEventChannel('DAZN LaLiga', 'ES| DAZN ESPAÑA VIP')).toBe(false);
    expect(isIdleEvent('NO EVENT STREAMING NOW - 8K EXCLUSIVE ES: DAZN PPV 7')).toBe(true);
    expect(isIdleEvent('RFEF EVENTO 06 No event')).toBe(true);
    expect(isIdleEvent(ROWS[3]!.title)).toBe(true);
    expect(isIdleEvent(ROWS[0]!.title)).toBe(false);
  });
});

describe('matchEventChannels · los dos equipos y la hora', () => {
  const list = catalog(ROWS);

  it('encuentra el hueco de DAZN PPV por los equipos y la hora en GMT', () => {
    const found = matchEventChannels(
      list,
      program('Paynesville FC', 'Down Town FC', Date.UTC(2026, 9, 21, 16, 0)),
    );
    expect(found.map((match) => [match.matchedChannel, match.event, match.score])).toEqual([
      ['DAZN PPV 2', true, 100],
    ]);
    expect(found[0]?.best.title).toBe(ROWS[0]!.title);
  });

  it('a otra hora no vale: el hueco cambia de partido', () => {
    expect(
      matchEventChannels(
        list,
        program(
          'Paynesville FC',
          'Down Town FC',
          Date.UTC(2026, 9, 21, 16, 0) + EVENT_TIME_TOLERANCE_MS + 60_000,
        ),
      ),
    ).toEqual([]);
  });

  it('la hora en CEST y el día siguiente en Madrid (MLS a la 01:00)', () => {
    const found = matchEventChannels(
      list,
      program('Inter Miami', 'Orlando City', Date.UTC(2026, 9, 21, 23, 0)),
    );
    expect(found.map((match) => match.matchedChannel)).toEqual(['MLS PPV 1']);
  });

  it('RFEF: hora de Madrid sin año; el hueco FINALIZADO no cuenta', () => {
    const found = matchEventChannels(
      list,
      program('UD Logroñés', 'Cultural Leonesa', Date.UTC(2026, 9, 18, 18, 0)),
    );
    expect(found.map((match) => match.matchedChannel)).toEqual(['RFEF EVENTO 05']);
  });

  it('VIX: fecha entre paréntesis, hora de Madrid ya en CET', () => {
    const found = matchEventChannels(
      list,
      program('América', 'Club Tijuana', Date.UTC(2026, 9, 28, 21, 45)),
    );
    expect(found.map((match) => match.matchedChannel)).toEqual([
      'América vs. Club Tijuana (2026-10-28 22:45:00)',
    ]);
  });

  it('las copias del mismo hueco van juntas; otro país, fuera; un canal normal, nunca', () => {
    const found = matchEventChannels(
      list,
      program('Sevilla', 'Real Betis', Date.UTC(2026, 9, 21, 19, 0)),
    );
    expect(found).toHaveLength(1);
    const only = found[0]!;
    expect(only.matchedChannel).toBe('SOCCER PPV 3');
    expect(only.posters.length + only.hidden.length).toBe(2);
  });

  it('sin saque, sin equipos o con un solo equipo, nada', () => {
    expect(
      matchEventChannels(list, program('Sevilla', 'Real Betis', null as unknown as number)),
    ).toEqual([]);
    expect(
      matchEventChannels(list, program('', 'Real Betis', Date.UTC(2026, 9, 21, 19, 0))),
    ).toEqual([]);
    expect(
      matchEventChannels(list, program('Sevilla', 'Villarreal', Date.UTC(2026, 9, 21, 19, 0))),
    ).toEqual([]);
  });
});
