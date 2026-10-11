/* Perfiles de competición: país y liga de TheSportsDB de cada liga de la
   agenda (futbolenlatv pone «España» en todos los partidos). */

import { describe, expect, it } from 'vitest';
import { competitionProfile, playsInProfile, profileKey } from './profiles.js';

describe('competitionProfile', () => {
  it('saca país y liga de la competición, no del país de la agenda', () => {
    expect(competitionProfile('La Liga EA Sports')).toMatchObject({
      country: 'Spain',
      leagues: ['Spanish La Liga'],
      rank: 0,
    });
    expect(competitionProfile('Premier League')).toMatchObject({ country: 'England', rank: 0 });
    expect(competitionProfile('Premier League Ucrania')).toMatchObject({ country: 'Ukraine' });
    expect(competitionProfile('Liga Pro Ecuador')).toMatchObject({ country: 'Ecuador' });
    expect(competitionProfile('2. Bundesliga')).toMatchObject({ country: 'Germany', rank: 1 });
  });

  it('copas, torneos internacionales y lo desconocido no tienen perfil', () => {
    for (const name of [
      'Champions League',
      'Copa del Rey',
      'UEFA Youth League',
      'Amistoso',
      '',
      null,
    ]) {
      expect(competitionProfile(name)).toBeNull();
    }
  });

  it('la clave ignora tildes, espacios y signos', () => {
    expect(profileKey('Primera División Argentina')).toBe('primeradivisionargentina');
    expect(profileKey('LaLiga  Hypermotion')).toBe('laligahypermotion');
  });
});

describe('playsInProfile', () => {
  const laLiga = competitionProfile('La Liga EA Sports');
  const rfef = competitionProfile('Primera Federación');

  it('casa por strLeague o strLeague2, y los grupos de la RFEF', () => {
    expect(playsInProfile({ strLeague: 'Spanish La Liga' }, laLiga)).toBe(true);
    expect(
      playsInProfile({ strLeague: 'UEFA Champions League', strLeague2: 'Spanish La Liga' }, laLiga),
    ).toBe(true);
    expect(playsInProfile({ strLeague: 'Spanish Primera RFEF Group 1' }, rfef)).toBe(true);
  });

  it('una liga parecida no vale (Segunda no es Primera) y sin perfil nunca', () => {
    expect(playsInProfile({ strLeague: 'Spanish La Liga 2' }, laLiga)).toBe(false);
    expect(playsInProfile({ strLeague: 'Spanish La Liga' }, null)).toBe(false);
  });
});
