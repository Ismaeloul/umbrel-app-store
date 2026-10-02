/* «Para ti» con los gustos del dueño (fix/agenda-filtrado): LaLiga, el
   Barça y la selección. Los partidos son los que daba futbolenlatv el
   2026-10-02 (parón de selecciones: ni LaLiga ni Champions ese fin de semana)
   y los de TheSportsDB del mismo día. Antes, «España» colaba LaLiga Futures
   (cantera) porque "laliga futures" contiene "laliga". */

import { describe, expect, it } from 'vitest';
import {
  footballCompetitionIsMinor,
  footballMatchHighlighted,
  footballMatchInScope,
  footballMatchIsMinor,
  footballTeamIsVariant,
  type ForYouMatch,
  type ForYouPreferences,
} from '../src/index.js';

const DUENO: ForYouPreferences = {
  leagues: ['LaLiga'],
  teams: ['Barcelona'],
  nationalities: ['España'],
};

function partido(
  competition: string,
  home: string,
  away: string,
  extra: Partial<ForYouMatch> = {},
): ForYouMatch {
  return {
    competition,
    title: `${home} - ${away}`,
    home,
    away,
    channels: [{ name: 'M+ LALIGA' }],
    ...extra,
  };
}

describe('Para ti: cantera, filiales y femenino fuera salvo que los sigas', () => {
  const fuera: [string, ForYouMatch][] = [
    [
      'LaLiga Futures (cantera)',
      partido('LaLiga Futures', 'FC Barcelona Academy', 'Real Betis Academy'),
    ],
    [
      'Liga Nacional Juvenil',
      partido('Liga Nacional Juvenil', 'FC Barcelona Academy', 'UE Olot Academy'),
    ],
    [
      'Juvenil A',
      partido('División Honor Juvenil', 'FC Barcelona Juvenil A', 'RCD Espanyol Juvenil A'),
    ],
    [
      'UEFA Youth League',
      partido('UEFA Youth League', 'Galatasaray Academy', 'FC Barcelona Academy'),
    ],
    ['Superliga Alevín', partido('Superliga Alevín', 'Real Madrid Academy', 'Las Rozas Academy')],
    ['filial (Barcelona Atlètic)', partido('Segunda Federación', 'Tudelano', 'Barcelona Atlètic')],
    ['filial sin tilde', partido('Segunda Federación', 'Barcelona Atlétic', 'SD Logroñés')],
    ['FC Barcelona Femení', partido('Liga F', 'FC Barcelona Femení', 'Real Madrid Femenino')],
    [
      'filial femenino',
      partido('Primera Federación Femenina', 'FC Barcelona B Femenino', 'Alhama CF'),
    ],
    ['Barcelona SC de Ecuador', partido('Liga Pro Ecuador', 'LDU Quito', 'Barcelona SC')],
    ['Europeo Sub-21', partido('Europeo Sub-21', 'España', 'Rumanía')],
    ['selección femenina', partido('Amistoso Femenino', 'Estados Unidos', 'España')],
    ['Spain U21', partido('Amistoso', 'Spain U21', 'Italy U21')],
    ['Hypermotion por la selección', partido('LaLiga Hypermotion', 'Eldense', 'Real Oviedo')],
  ];
  for (const [nombre, match] of fuera) {
    it(`fuera: ${nombre}`, () => {
      expect(footballMatchInScope(match, DUENO)).toBe(false);
      expect(footballMatchHighlighted(match, DUENO)).toBe(false);
    });
  }

  const dentro: [string, ForYouMatch][] = [
    ['LaLiga de futbolenlatv', partido('La Liga EA Sports', 'Málaga', 'Espanyol')],
    ['LaLiga de TheSportsDB', partido('Spanish La Liga', 'Rayo Vallecano', 'Athletic Bilbao')],
    ['LaLiga con su rótulo nuevo', partido('LaLiga EA Sports', 'Elche', 'Celta Vigo')],
    ['el Barça en Champions', partido('Champions League', 'Galatasaray', 'FC Barcelona')],
    ['la selección absoluta', partido('UEFA Nations League', 'España', 'República Checa')],
    ['la selección en inglés', partido('UEFA Nations League', 'Spain', 'Czech Republic')],
    ['Copa del Rey', partido('Copa del Rey', 'Baztán', 'Atlético Calatayud')],
    ['Supercopa', partido('Supercopa de España', 'Barcelona', 'Atlético Madrid')],
  ];
  for (const [nombre, match] of dentro) {
    it(`dentro: ${nombre}`, () => {
      expect(footballMatchInScope(match, DUENO)).toBe(true);
    });
  }

  it('quien sigue la cantera o el femenino por su nombre los ve', () => {
    expect(
      footballMatchInScope(partido('Liga F', 'FC Barcelona Femení', 'Real Madrid Femenino'), {
        leagues: [],
        teams: ['FC Barcelona Femení'],
        nationalities: [],
      }),
    ).toBe(true);
    expect(
      footballMatchInScope(partido('Liga F', 'Levante Femenino', 'Sevilla Femenino'), {
        leagues: ['Liga F'],
        teams: [],
        nationalities: [],
      }),
    ).toBe(true);
    expect(
      footballMatchInScope(partido('Segunda Federación', 'Tudelano', 'Barcelona Atlètic'), {
        leagues: [],
        teams: ['Barcelona Atlètic'],
        nationalities: [],
      }),
    ).toBe(true);
  });
});

describe('favoritos por idTeam de TheSportsDB', () => {
  const soloBarca: ForYouPreferences = { leagues: [], teams: ['Barcelona'], nationalities: [] };

  it('«Barcelona» es el FC Barcelona (133739) aunque la agenda lo llame «Barça»', () => {
    const match = partido('Champions League', 'Galatasaray', 'Barça', {
      awayTeam: { id: '133739' },
    });
    expect(footballMatchHighlighted(match, soloBarca)).toBe(true);
  });

  it('un «Barcelona» con el escudo de otro club no es el Barça', () => {
    const match = partido('Liga Pro Ecuador', 'Barcelona', 'Emelec', {
      homeTeam: { id: '138159' },
    });
    expect(footballMatchHighlighted(match, soloBarca)).toBe(false);
  });

  it('la cantera no casa aunque el escudo resuelto sea el del primer equipo', () => {
    const match = partido('LaLiga Futures', 'FC Barcelona Academy', 'Villarreal Academy', {
      homeTeam: { id: '133739' },
    });
    expect(footballMatchHighlighted(match, soloBarca)).toBe(false);
  });

  it('sin escudo, por nombre exacto (FC Barcelona sí, Barcelona SC no)', () => {
    expect(footballMatchHighlighted(partido('LaLiga', 'FC Barcelona', 'Getafe'), soloBarca)).toBe(
      true,
    );
    expect(footballMatchHighlighted(partido('Copa', 'Barcelona SC', 'Emelec'), soloBarca)).toBe(
      false,
    );
  });
});

describe('detección de variantes', () => {
  it('equipos', () => {
    for (const name of [
      'Barcelona Atlètic',
      'FC Barcelona B',
      'FC Barcelona Femení',
      'FC Barcelona Femenino',
      'Barcelona Women',
      'Barcelona W',
      'FC Barcelona Juvenil A',
      'FC Barcelona U19',
      'Barcelona Sub-19',
      'FC Barcelona Academy',
      'Real Madrid Castilla',
      'Spain U21',
      'Central Córdoba Reserva',
    ]) {
      expect(footballTeamIsVariant(name), name).toBe(true);
    }
    /* Primeros equipos con nombre de filial (revisión): «Atlètic» solo
       cuenta al final y «Willem II» es de la Eredivisie. */
    for (const name of [
      'FC Barcelona',
      'Barcelona',
      'Athletic Club',
      'Atlético de Madrid',
      'España',
      'Atlètic Lleida',
      'Willem II',
    ]) {
      expect(footballTeamIsVariant(name), name).toBe(false);
    }
  });

  it('competiciones', () => {
    for (const name of [
      'LaLiga Futures',
      'Liga F',
      'División Honor Juvenil',
      'UEFA Youth League',
      'Europeo Sub-21',
      'U20 Elite League',
      'Amistoso Femenino',
      'Torneo Proyección',
      'Regionalliga',
      'Primera Federación Femenina',
    ]) {
      expect(footballCompetitionIsMinor(name), name).toBe(true);
    }
    for (const name of [
      'La Liga EA Sports',
      'LaLiga Hypermotion',
      'Copa del Rey',
      'UEFA Nations League',
      'Champions League',
      'Primera Federación',
      'Amistoso',
      // la «F» suelta de un grupo no es la Liga F (revisión)
      'Mundial · Grupo F',
    ]) {
      expect(footballCompetitionIsMinor(name), name).toBe(false);
    }
    expect(footballCompetitionIsMinor('Liga F Moeve')).toBe(true);
    expect(footballMatchInScope(partido('Mundial · Grupo F', 'España', 'Uruguay'), DUENO)).toBe(
      true,
    );
    expect(footballMatchIsMinor(partido('Amistoso', 'Real Madrid', 'Real Madrid Castilla'))).toBe(
      true,
    );
  });
});
