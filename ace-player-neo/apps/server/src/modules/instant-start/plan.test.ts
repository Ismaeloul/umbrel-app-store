/* Reglas puras de «Arranque instantáneo» (D24): qué partidos cuentan (solo
   tus EQUIPOS), cuál se prepara si coinciden, qué toca en cada momento y qué
   fuente se elige. */

import { describe, expect, it } from 'vitest';
import type { ResolutionCandidate } from '@ace/shared';
import {
  EMPTY_MEMORY,
  chooseTarget,
  favoriteMatches,
  pickPrewarmCandidate,
  planStep,
  type FavoriteMatch,
} from './plan.js';

const MIN = 60_000;
const KICKOFF = Date.UTC(2026, 9, 4, 19, 0);

function match(id: string, home: string, away: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    start: KICKOFF,
    home,
    away,
    title: `${home} - ${away}`,
    competition: 'LaLiga EA Sports',
    channels: [{ id: 'c1', name: 'DAZN LaLiga' }],
    ...extra,
  };
}

const schedule = (...matches: unknown[]) => ({ days: [{ date: '2026-10-04', matches }] });

describe('qué partidos cuentan: solo los de tus equipos', () => {
  const payload = schedule(
    match('rm', 'Real Madrid', 'Getafe'),
    match('fem', 'FC Barcelona Femení', 'Levante Femenino', { competition: 'Liga F' }),
    match('bar', 'Barcelona', 'Sevilla'),
    match('esp', 'España', 'Georgia', { competition: 'Clasificación Mundial' }),
    match('otro', 'Osasuna', 'Alavés'),
  );

  it('ni la liga ni la selección que sigues como liga o país: nada sin equipos', () => {
    expect(favoriteMatches(payload, [])).toEqual([]);
  });

  it('el primer equipo, nunca su femenino o filial; la selección solo si la sigues como equipo', () => {
    expect(favoriteMatches(payload, ['Barcelona']).map((item) => item.id)).toEqual(['bar']);
    expect(favoriteMatches(payload, ['FC Barcelona Femení']).map((item) => item.id)).toEqual([
      'fem',
    ]);
    expect(favoriteMatches(payload, ['España', 'Real Madrid'])).toEqual([
      { id: 'rm', start: KICKOFF, title: 'Real Madrid - Getafe', rank: 1 },
      { id: 'esp', start: KICKOFF, title: 'España - Georgia', rank: 0 },
    ]);
  });

  it('el escudo manda: un «Barcelona» con el idTeam de otro club no es el tuyo', () => {
    const sc = match('sc', 'Barcelona', 'Emelec', { homeTeam: { id: '134262' } });
    const fcb = match('fcb', 'Barcelona', 'Sevilla', { homeTeam: { id: '133739' } });
    expect(favoriteMatches(schedule(sc, fcb), ['Barcelona']).map((item) => item.id)).toEqual([
      'fcb',
    ]);
  });

  it('sin saque conocido no hay nada que programar', () => {
    expect(
      favoriteMatches(schedule(match('x', 'Real Madrid', 'Getafe', { start: null })), [
        'Real Madrid',
      ]),
    ).toEqual([]);
  });
});

describe('cuál se prepara (una sola fuente a la vez)', () => {
  const at = (id: string, start: number, rank: number): FavoriteMatch => ({
    id,
    start,
    rank,
    title: id,
  });

  it('el de saque más temprano; a igual saque, el equipo que va antes en tus gustos', () => {
    const now = KICKOFF - 5 * MIN;
    expect(chooseTarget([at('b', KICKOFF + 5 * MIN, 0), at('a', KICKOFF, 1)], now)?.id).toBe('a');
    expect(chooseTarget([at('b', KICKOFF, 1), at('a', KICKOFF, 0)], now)?.id).toBe('a');
  });

  it('fuera de la ventana (antes de T-10 o después de T+10), ninguno', () => {
    const one = [at('a', KICKOFF, 0)];
    expect(chooseTarget(one, KICKOFF - 10 * MIN - 1)).toBeNull();
    expect(chooseTarget(one, KICKOFF - 10 * MIN)?.id).toBe('a');
    expect(chooseTarget(one, KICKOFF + 10 * MIN)?.id).toBe('a');
    expect(chooseTarget(one, KICKOFF + 10 * MIN + 1)).toBeNull();
  });
});

describe('qué toca en cada vuelta', () => {
  const target: FavoriteMatch = { id: 'a', start: KICKOFF, rank: 0, title: 'a' };

  it('T-10 resuelve una vez; T-3 prepara; a T+5 deja de intentarlo', () => {
    expect(planStep(KICKOFF - 11 * MIN, target, EMPTY_MEMORY, null)).toEqual({
      refresh: false,
      prewarm: false,
      release: false,
    });
    expect(planStep(KICKOFF - 10 * MIN, target, EMPTY_MEMORY, null)).toMatchObject({
      refresh: true,
      prewarm: false,
    });
    const refreshed = { ...EMPTY_MEMORY, refreshed: true };
    expect(planStep(KICKOFF - 4 * MIN, target, refreshed, null)).toMatchObject({
      refresh: false,
      prewarm: false,
    });
    expect(planStep(KICKOFF - 3 * MIN, target, refreshed, null)).toMatchObject({ prewarm: true });
    expect(planStep(KICKOFF + 5 * MIN, target, refreshed, null)).toMatchObject({ prewarm: true });
    expect(planStep(KICKOFF + 5 * MIN + 1, target, refreshed, null)).toMatchObject({
      prewarm: false,
    });
  });

  it('ya preparada no se repite; terminada (usada, cedida) o con 2 fallos, tampoco', () => {
    const active = { matchId: 'a', start: KICKOFF };
    expect(planStep(KICKOFF - 2 * MIN, target, EMPTY_MEMORY, active)).toMatchObject({
      prewarm: false,
      release: false,
    });
    expect(planStep(KICKOFF, target, { ...EMPTY_MEMORY, done: true }, null).prewarm).toBe(false);
    expect(planStep(KICKOFF, target, { ...EMPTY_MEMORY, failures: 2 }, null).prewarm).toBe(false);
    expect(planStep(KICKOFF, target, { ...EMPTY_MEMORY, failures: 1 }, null).prewarm).toBe(true);
  });

  it('se suelta a los 10 min del saque, o si el partido ya no es el elegido', () => {
    const active = { matchId: 'a', start: KICKOFF };
    expect(planStep(KICKOFF + 10 * MIN, target, EMPTY_MEMORY, active).release).toBe(false);
    expect(planStep(KICKOFF + 10 * MIN + 1, null, EMPTY_MEMORY, active).release).toBe(true);
    expect(
      planStep(KICKOFF, { ...target, id: 'b' }, EMPTY_MEMORY, { matchId: 'a', start: null })
        .release,
    ).toBe(true);
  });
});

describe('qué fuente se prepara (la que va a pedir «Ver»)', () => {
  const candidate = (id: string, source: ResolutionCandidate['source'], extra = {}) =>
    ({
      id: id.repeat(40),
      title: id,
      source,
      ih: false,
      quarantined: false,
      reported: null,
      rejectedByLearning: false,
      ...extra,
    }) as unknown as ResolutionCandidate;
  const verdicts =
    (map: Record<string, string>) =>
    (hash: string): string | null =>
      map[hash[0] ?? ''] ?? null;

  it('IPTV primero salvo que el comprobador la dé por caída', () => {
    const list = [candidate('a', 'acestream'), candidate('b', 'iptv'), candidate('c', 'iptv')];
    expect(pickPrewarmCandidate(list, verdicts({ a: 'working' }), true)?.title).toBe('b');
    expect(pickPrewarmCandidate(list, verdicts({ a: 'working', b: 'failed' }), true)?.title).toBe(
      'c',
    );
  });

  it('AceStream: la primera que funciona, luego una floja; sin veredicto, ninguna', () => {
    const list = [candidate('a', 'acestream'), candidate('b', 'm3u'), candidate('c', 'acestream')];
    expect(pickPrewarmCandidate(list, verdicts({ b: 'weak', c: 'working' }), true)?.title).toBe(
      'c',
    );
    expect(pickPrewarmCandidate(list, verdicts({ b: 'weak' }), true)?.title).toBe('b');
    expect(pickPrewarmCandidate(list, verdicts({}), true)).toBeNull();
  });

  it('sin comprobador, la mejor colocada; lo reportado o en cuarentena, nunca', () => {
    const list = [
      candidate('a', 'acestream', { quarantined: true }),
      candidate('b', 'acestream', { reported: { reason: 'audio' } }),
      candidate('c', 'acestream'),
    ];
    expect(pickPrewarmCandidate(list, verdicts({}), false)?.title).toBe('c');
  });
});
