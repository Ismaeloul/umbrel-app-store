import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { matchAt, NOW, TODAY } from '../agenda/test-utils.tsx';
import {
  addRecent,
  highlightParts,
  logoText,
  highlightRange,
  readRecents,
  RECENTS_MAX,
  removeRecent,
  saveRecents,
  searchMatches,
  seeAllText,
  stepIndex,
  visibleCount,
} from './quick-model.ts';

beforeEach(() => {
  localStorage.clear();
  resetMemoryStorage();
});

describe('resaltado sin tildes ni mayúsculas', () => {
  it('marca el trozo del texto original', () => {
    expect(highlightRange('Real Madrid – Barcelona', 'barc')).toEqual([14, 18]);
    expect(highlightParts('Barça TV', 'barç')).toEqual(['', 'Barç', 'a TV']);
    // «barc» también encuentra «Barç»: se compara sin la cedilla.
    expect(highlightParts('Barça TV', 'barc')).toEqual(['', 'Barç', 'a TV']);
    expect(highlightParts('Atlético', 'TLETI')).toEqual(['A', 'tléti', 'co']);
  });

  it('sin coincidencia, el texto entero sin marca', () => {
    expect(highlightRange('DAZN 1', 'movistar')).toBeNull();
    expect(highlightParts('DAZN 1', '')).toEqual(['DAZN 1', '', '']);
  });
});

describe('partidos de la agenda', () => {
  const days = () => {
    const later = matchAt(90, { home: 'Barcelona', away: 'Inter', competition: 'Champions' });
    const live = matchAt(-30, { home: 'Real Madrid', away: 'Barcelona' });
    const done = matchAt(-200, { home: 'Barcelona SC', away: 'Emelec' });
    const other = matchAt(20, { home: 'Sevilla', away: 'Betis' });
    const yesterday = {
      ...matchAt(-60, { home: 'Barcelona', away: 'Getafe' }),
      date: '2026-09-22',
    };
    return {
      ids: { later: later.id, live: live.id, done: done.id },
      days: [
        { date: '2026-09-22', matches: [yesterday] },
        { date: TODAY, matches: [later, done, other, live] },
      ],
    };
  };

  it('el directo primero, luego por hora y lo terminado al final; ayer no', () => {
    const { ids, days: list } = days();
    const found = searchMatches(list, 'barc', NOW, TODAY);
    expect(found.map((item) => item.match.id)).toEqual([ids.live, ids.later, ids.done]);
    expect(found.map((item) => item.phase)).toEqual(['live', 'next', 'done']);
  });

  it('busca también por competición y pide 2 letras', () => {
    const { days: list } = days();
    expect(searchMatches(list, 'champ', NOW, TODAY)).toHaveLength(1);
    expect(searchMatches(list, 'b', NOW, TODAY)).toEqual([]);
  });
});

describe('grupos y chips', () => {
  it('con «Todo» se ven unos pocos de cada grupo; con su chip, todos', () => {
    expect(visibleCount('partidos', 7, 'todo')).toBe(3);
    expect(visibleCount('titulos', 7, 'todo')).toBe(4);
    expect(visibleCount('canales', 2, 'todo')).toBe(2);
    expect(visibleCount('canales', 9, 'canales')).toBe(9);
    expect(visibleCount('canales', 9, 'partidos')).toBe(0);
    expect(seeAllText('partidos', 3)).toBe('Ver los 3');
    expect(seeAllText('titulos', 4)).toBe('Ver las 4');
  });

  it('las flechas dan la vuelta', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe('recientes', () => {
  it('arriba lo último, sin repetir (sin tildes) y como mucho 5', () => {
    let list: string[] = [];
    for (const text of ['dazn', 'Real Madrid', 'dune', 'la 1', 'barça', 'movistar']) {
      list = addRecent(list, text);
    }
    expect(list).toHaveLength(RECENTS_MAX);
    expect(list[0]).toBe('movistar');
    list = addRecent(list, '  BARCA ');
    expect(list[0]).toBe('BARCA');
    expect(list.filter((item) => item.toLowerCase().startsWith('bar'))).toHaveLength(1);
    expect(addRecent(list, 'x')).toEqual(list);
    expect(removeRecent(list, 'BARCA')).not.toContain('BARCA');
  });

  it('se guardan en este navegador', () => {
    expect(readRecents()).toEqual([]);
    saveRecents(['dazn', 'dune']);
    expect(readRecents()).toEqual(['dazn', 'dune']);
  });
});

describe('la pastilla del canal', () => {
  it('lleva el nombre si cabe y, si no, la sigla y el número', () => {
    expect(logoText('Barça TV')).toBe('Barça TV');
    expect(logoText('DAZN LaLiga 1080p')).toBe('DAZN LaLiga');
    expect(logoText('M+ Liga de Campeones 2')).toBe('M+ 2');
    expect(logoText('LaLiga TV Hypermotion')).toBe('LALIGA');
  });
});
