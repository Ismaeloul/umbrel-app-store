/* «Partidos» en Buscar (docs/iptv.md §20): qué partidos salen con cada
   consulta y en qué orden (el que está en directo o el más próximo, primero). */

import { describe, expect, it } from 'vitest';
import { matchAt, NOW, scheduleOf } from '../agenda/test-utils.tsx';
import {
  isSpanishMatch,
  matchIndex,
  matchesLiveText,
  moreMatchesText,
  scheduleMatches,
  searchMatches,
} from './matches.ts';

const inglaterra = matchAt(120, {
  home: 'Inglaterra',
  away: 'España',
  competition: 'UEFA Nations League',
  channels: [{ id: 'c1', name: 'La 1' }],
});
const egipto = matchAt(-30, {
  home: 'Egipto',
  away: 'Inglaterra',
  competition: 'Amistoso Sub-18',
  channels: [{ id: 'c2', name: 'Teledeporte' }],
});
const espanyol = matchAt(24 * 60, {
  home: 'Espanyol',
  away: 'Getafe',
  competition: 'LaLiga',
  homeTeam: { id: '1', name: 'Espanyol', short: 'ESP', crest: null, colors: null },
});
const madrid = matchAt(300, {
  home: 'Real Madrid',
  away: 'Manchester City',
  competition: 'Champions League',
  channels: [{ id: 'c3', name: 'M+ Liga de Campeones' }],
});
const atletico = matchAt(60, { home: 'Atlético de Madrid', away: 'Girona', competition: 'LaLiga' });
const barca = matchAt(-500, { home: 'FC Barcelona', away: 'Juventus', competition: 'Amistoso' });
const oviedo = matchAt(1500, {
  home: 'Real Oviedo',
  away: 'Sporting de Gijón',
  competition: 'LaLiga Hypermotion',
});
const ligaF = matchAt(200, {
  home: 'Real Sociedad Femenino',
  away: 'Real Madrid Femenino',
  competition: 'Liga F',
});

const schedule = scheduleOf({
  '2026-09-23': [inglaterra, egipto, madrid, atletico, barca, ligaF],
  '2026-09-24': [espanyol, oviedo, inglaterra],
});
const index = matchIndex(scheduleMatches(schedule));
const found = (query: string) => searchMatches(index, query, NOW).map((hit) => hit.match.id);

describe('partidos en Buscar', () => {
  it('toda la agenda, sin repetir', () => {
    expect(scheduleMatches(schedule)).toHaveLength(8);
    expect(scheduleMatches(undefined)).toEqual([]);
  });

  it('«inglatera» encuentra los de Inglaterra: primero el que está en directo', () => {
    expect(found('inglatera')).toEqual([egipto.id, inglaterra.id]);
    expect(found('Inglaterra')).toEqual([egipto.id, inglaterra.id]);
    expect(found('ing')).toEqual([egipto.id, inglaterra.id]);
  });

  it('«esp» encuentra España (antes que el Espanyol, que también es ESP)', () => {
    const ids = found('esp');
    expect(ids[0]).toBe(inglaterra.id);
    expect(ids).toContain(espanyol.id);
    expect(ids.indexOf(inglaterra.id)).toBeLessThan(ids.indexOf(espanyol.id));
  });

  it('apodos, alias y erratas', () => {
    expect(found('barsa')).toEqual([barca.id]);
    expect(found('champions')).toEqual([madrid.id]);
    expect(found('m+ liga de campeone')).toEqual([madrid.id]);
    expect(found('atleti')).toEqual([atletico.id]);
    expect(found('segunda')).toEqual([oviedo.id]);
    expect(found('la roja')).toEqual([inglaterra.id]);
  });

  it('«madrid»: los del Real Madrid primero y luego el Atlético', () => {
    const ids = found('madrid');
    expect(ids.slice(0, 2).sort()).toEqual([madrid.id, ligaF.id].sort());
    expect(ids[2]).toBe(atletico.id);
  });

  it('lo que no debe casar', () => {
    expect(found('liga f')).toEqual([ligaF.id]);
    expect(found('hypermotion')).toEqual([oviedo.id]);
    expect(found('getafe')).toEqual([espanyol.id]);
    expect(found('real sociedad')).toEqual([ligaF.id]);
    expect(found('zzzz')).toEqual([]);
  });

  it('los terminados, al final', () => {
    const ids = found('amistoso');
    expect(ids.at(-1)).toBe(barca.id);
  });

  it('de aquí: la selección y las competiciones españolas', () => {
    expect(isSpanishMatch(inglaterra)).toBe(true);
    expect(isSpanishMatch(oviedo)).toBe(true);
    expect(isSpanishMatch(madrid)).toBe(false);
  });

  it('textos', () => {
    expect(moreMatchesText(1)).toBe('Ver 1 partido más');
    expect(moreMatchesText(3)).toBe('Ver 3 partidos más');
    expect(matchesLiveText(0)).toBe('');
    expect(matchesLiveText(2)).toBe('2 partidos. ');
  });
});
