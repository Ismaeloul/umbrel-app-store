import type { FootballMatch, LiveScore } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  broadcastsMatch,
  isHalftime,
  liveMinute,
  madridClock,
  matchStatus,
  minutesUntil,
  needsScores,
  onAirFor,
  todaysMatches,
} from './on-air.ts';

function match(id: string, time: string, channels: string[], date = '2026-09-23'): FootballMatch {
  return {
    id,
    date,
    time,
    title: `${id} local - ${id} visitante`,
    home: `${id} local`,
    away: `${id} visitante`,
    competition: 'LaLiga',
    country: 'Spain',
    channels: channels.map((name, i) => ({ id: `${id}-${i}`, name })),
  };
}

const score = (state: string, clock = "72'"): LiveScore => ({
  home: 1,
  away: 0,
  state,
  clock,
  detail: '',
  confidence: 0.9,
});

describe('hora de Madrid (regla 28)', () => {
  it('saca la fecha y los minutos de Madrid, no los del dispositivo', () => {
    // 23-sep-2026 19:30 UTC = 21:30 en Madrid (horario de verano).
    const clock = madridClock(Date.UTC(2026, 8, 23, 19, 30));
    expect(clock).toEqual({ date: '2026-09-23', minutes: 21 * 60 + 30 });
    // 22:30 UTC ya es el día siguiente en Madrid.
    expect(madridClock(Date.UTC(2026, 8, 23, 22, 30)).date).toBe('2026-09-24');
  });

  it('minutos hasta el partido y estado sin marcador (2 h de ventana)', () => {
    const clock = { date: '2026-09-23', minutes: 21 * 60 };
    expect(minutesUntil({ date: '2026-09-23', time: '21:30' }, clock)).toBe(30);
    expect(minutesUntil({ date: '2026-09-24', time: '00:15' }, clock)).toBe(195);
    expect(minutesUntil({ date: '2026-09-23', time: 'Por confirmar' }, clock)).toBeNull();
    expect(matchStatus(30, null)).toBe('upcoming');
    expect(matchStatus(-30, null)).toBe('live');
    expect(matchStatus(-130, null)).toBe('done');
    expect(matchStatus(null, null)).toBe('upcoming');
  });

  it('el marcador de ESPN manda sobre la hora', () => {
    expect(matchStatus(20, score('in'))).toBe('live');
    expect(matchStatus(-30, score('post'))).toBe('done');
  });
});

describe('qué da cada canal', () => {
  it('solo cuenta el mismo canal sin duda (≥ 92): la familia no basta', () => {
    const m = match('a', '21:00', ['DAZN']);
    expect(broadcastsMatch({ title: 'DAZN' }, m)).toBe(true);
    expect(broadcastsMatch({ title: 'DAZN 1' }, m)).toBe(false);
    expect(
      broadcastsMatch(
        { title: 'M. LaLiga', alias: 'M+ LaLiga' },
        match('b', '21:00', ['M+ LaLiga']),
      ),
    ).toBe(true);
  });

  it('en directo, siguiente y después, en orden de hora', () => {
    const clock = { date: '2026-09-23', minutes: 21 * 60 };
    const matches = [
      match('tarde', '18:00', ['DAZN 1']),
      match('ahora', '20:30', ['DAZN 1']),
      match('luego', '23:00', ['DAZN 1']),
      match('antes', '21:45', ['DAZN 1']),
      match('otro', '21:10', ['La 1']),
    ];
    const result = onAirFor({ title: 'DAZN 1 HD' }, matches, {}, clock);
    expect(result.live?.match.id).toBe('ahora');
    expect(result.next).toBeNull();
    expect(result.later.map((m) => m.match.id)).toEqual(['antes', 'luego']);

    const quiet = onAirFor({ title: 'DAZN 1' }, matches.slice(2), {}, clock);
    expect(quiet.live).toBeNull();
    expect(quiet.next?.match.id).toBe('antes');
    expect(quiet.later.map((m) => m.match.id)).toEqual(['luego']);
  });

  it('partidos de hoy (y los de ayer que siguen) y la ventana de marcadores', () => {
    const clock = { date: '2026-09-23', minutes: 30 };
    const days = [
      {
        date: '2026-09-22',
        matches: [
          match('ayer-tarde', '22:45', ['X'], '2026-09-22'),
          match('ayer', '18:00', ['X'], '2026-09-22'),
        ],
      },
      { date: '2026-09-23', matches: [match('hoy', '21:00', ['X'])] },
    ];
    expect(todaysMatches(days, clock).map((m) => m.id)).toEqual(['ayer-tarde', 'hoy']);
    expect(
      needsScores([match('hoy', '21:00', ['X'])], { date: '2026-09-23', minutes: 20 * 60 + 50 }),
    ).toBe(true);
    expect(
      needsScores([match('hoy', '21:00', ['X'])], { date: '2026-09-23', minutes: 18 * 60 }),
    ).toBe(false);
  });

  it('minuto y descanso del reloj de ESPN', () => {
    expect(liveMinute(score('in', "72'"))).toBe("72'");
    expect(liveMinute(score('in', '45+2’'))).toBe("45+2'");
    expect(liveMinute(score('in', ''))).toBeNull();
    expect(liveMinute(null)).toBeNull();
    expect(isHalftime({ ...score('in', 'HT'), detail: 'Halftime' })).toBe(true);
    expect(isHalftime(score('in'))).toBe(false);
  });
});
