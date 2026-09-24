/* Claves, términos de búsqueda y correcciones manuales (informe de fase 2, §10.2-10.3). */

import { describe, expect, it } from 'vitest';
import { BUNDLED_OVERRIDES } from './index.js';
import {
  badgeShort,
  competitionKey,
  countryMatches,
  englishCountry,
  isReserveName,
  keyId,
  mergeOverrides,
  nationalityQuery,
  parseOverrides,
  stripAbbreviation,
  teamKey,
  teamQuery,
} from './normalize.js';

describe('claves', () => {
  it('la clave del equipo es la de "Para ti" (footballTeamKey sobre el título limpio)', () => {
    expect(teamKey('Atlético de Madrid')).toBe('atletico madrid');
    expect(teamKey('FC Barcelona')).toBe('barcelona');
    expect(teamKey('  Real   Sociedad ')).toBe('real sociedad');
    expect(teamKey('Inter de Milán')).toBe('inter');
    expect(teamKey('<b>Getafe</b>&nbsp;CF')).toBe('getafe');
    expect(teamKey('')).toBe('');
    expect(teamKey(null)).toBe('');
  });

  it('la clave de la competición quita tildes y símbolos', () => {
    expect(competitionKey('LaLiga Hypermotion')).toBe('laliga hypermotion');
    expect(competitionKey('Supercopa de España')).toBe('supercopa de espana');
    expect(competitionKey('Fútbol')).toBe('futbol');
  });

  it('keyId da un SafeId estable a partir de la clave', () => {
    expect(keyId('real madrid')).toBe('k-real-madrid');
    expect(keyId('  ')).toBe('k-equipo');
    expect(keyId('a'.repeat(80))).toHaveLength(62);
    expect(keyId('paises bajos')).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe('término de búsqueda', () => {
  it('quita la abreviatura de futbolenlatv', () => {
    expect(stripAbbreviation('O. Lyonnais')).toBe('Lyonnais');
    expect(stripAbbreviation('B. Dortmund')).toBe('Dortmund');
    expect(stripAbbreviation('Real Sociedad')).toBe('Real Sociedad');
  });

  it('las selecciones se buscan en inglés', () => {
    expect(nationalityQuery('espana')).toBe('Spain');
    expect(nationalityQuery('inglaterra')).toBe('England');
    expect(nationalityQuery('paises bajos')).toBe('Netherlands');
    expect(nationalityQuery('estados unidos')).toBe('United States');
    expect(nationalityQuery('portugal')).toBe('Portugal');
    expect(nationalityQuery('spain')).toBe('Spain');
    expect(nationalityQuery('getafe')).toBeNull();
  });

  it('override → selección → nombre limpio', () => {
    expect(teamQuery('España', 'espana')).toBe('Spain');
    expect(teamQuery('O. Lyonnais', 'o lyonnais')).toBe('Lyonnais');
    expect(teamQuery('Inter', 'inter', { query: 'Inter Milan' })).toBe('Inter Milan');
    expect(teamQuery('Getafe CF', 'getafe')).toBe('Getafe CF');
  });

  it('el país de la agenda se traduce para TheSportsDB', () => {
    expect(englishCountry('España')).toBe('Spain');
    expect(englishCountry('Spain')).toBe('Spain');
    expect(englishCountry('Ecuador')).toBe('Ecuador');
  });

  it('countryMatches entiende los alias de las nacionalidades', () => {
    expect(countryMatches('Spain', 'España')).toBe(true);
    expect(countryMatches('Spain', 'Spain')).toBe(true);
    expect(countryMatches('England', 'Inglaterra')).toBe(true);
    expect(countryMatches('Ecuador', 'España')).toBe(false);
    expect(countryMatches(null, 'España')).toBe(false);
  });

  it('badgeShort respeta el tope de 4 caracteres del contrato', () => {
    expect(badgeShort('RMA')).toBe('RMA');
    expect(badgeShort(' FCB ')).toBe('FCB');
    expect(badgeShort('LARGO')).toBeNull();
    expect(badgeShort(null)).toBeNull();
  });

  it('isReserveName distingue filiales y categorías inferiores', () => {
    expect(isReserveName('Real Sociedad B')).toBe(true);
    expect(isReserveName('Real Madrid Castilla')).toBe(true);
    expect(isReserveName('Barcelona Atlètic')).toBe(true);
    expect(isReserveName('España Sub-21')).toBe(true);
    expect(isReserveName('Real Sociedad')).toBe(false);
    expect(isReserveName('Athletic Club')).toBe(false);
    expect(isReserveName('Atlético Madrid')).toBe(false);
  });
});

describe('correcciones manuales', () => {
  it('overrides.json empaquetado valida y trae los casos difíciles', () => {
    expect(BUNDLED_OVERRIDES.teams['barcelona sc']).toMatchObject({
      idTeam: '138159',
      country: 'Ecuador',
    });
    expect(BUNDLED_OVERRIDES.teams.inter?.idTeam).toBe('133681');
    expect(BUNDLED_OVERRIDES.teams['real sociedad b']?.skip).toBe(true);
    expect(BUNDLED_OVERRIDES.competitions.laliga?.idLeague).toBe('4335');
    expect(BUNDLED_OVERRIDES.competitions['champions league']?.idLeague).toBe('4480');
    expect(BUNDLED_OVERRIDES.competitions.futbol?.skip).toBe(true);
    /* Cada clave está normalizada: si no, nunca casaría con la agenda. */
    for (const key of Object.keys(BUNDLED_OVERRIDES.teams)) expect(teamKey(key)).toBe(key);
    for (const key of Object.keys(BUNDLED_OVERRIDES.competitions)) {
      expect(competitionKey(key)).toBe(key);
    }
  });

  it('rechaza claves desconocidas, ids raros y colores que no son #rrggbb', () => {
    expect(() => parseOverrides({ teams: { x: { idTeam: 'abc' } } })).toThrow();
    expect(() => parseOverrides({ teams: { x: { colour: '#000000' } } })).toThrow();
    expect(() => parseOverrides({ teams: { x: { colors: ['#FFFFFF', null] } } })).toThrow();
    expect(() => parseOverrides({ teams: { x: { skip: false } } })).toThrow();
    expect(parseOverrides({})).toEqual({ teams: {}, competitions: {} });
    expect(parseOverrides({ teams: { x: { colors: ['#112233', null] } } }).teams.x?.colors).toEqual(
      ['#112233', null],
    );
  });

  it('el fichero del volumen pisa clave a clave al empaquetado', () => {
    const merged = mergeOverrides(
      { teams: { a: { query: 'A' }, b: { skip: true } }, competitions: { l: { idLeague: '1' } } },
      { teams: { a: { idTeam: '9' } }, competitions: {} },
    );
    expect(merged.teams).toEqual({ a: { idTeam: '9' }, b: { skip: true } });
    expect(merged.competitions).toEqual({ l: { idLeague: '1' } });
  });
});
