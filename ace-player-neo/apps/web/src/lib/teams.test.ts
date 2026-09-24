import type { FootballMatch } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { parseHex, rgbToOklch } from './color.ts';
import {
  colorDistance,
  competitionLogo,
  competitionShort,
  matchVersusPair,
  paletteOf,
  teamCrest,
  teamInitials,
  teamPalette,
  teamShort,
  VERSUS_DELTA,
  versusPair,
} from './teams.ts';

function match(overrides: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id: 'demo-1',
    date: '2026-09-23',
    time: '21:00',
    title: 'FC Barcelona vs Juventus',
    home: 'FC Barcelona',
    away: 'Juventus',
    competition: 'Amistoso',
    country: 'España',
    channels: [],
    ...overrides,
  };
}

const BARCA = {
  id: 'k-fc-barcelona',
  name: 'FC Barcelona',
  short: 'BAR',
  crest: null,
  colors: { primary: '#a50044', secondary: '#004d98' },
};
const JUVE = {
  id: '133676',
  name: 'Juventus',
  short: 'JUV',
  crest: '/api/v1/football/teams/133676/crest?v=abc',
  colors: { primary: '#101010', secondary: '#ffffff' },
};
const SEVILLA = { primary: '#d4021d', secondary: '#ffffff', source: 'api' as const };
const GIRONA = { primary: '#cd2534', secondary: '#ffffff', source: 'api' as const };

const lightness = (hex: string) => rgbToOklch(parseHex(hex)!).l;

describe('teamInitials', () => {
  it('siglas dadas o sacadas del nombre', () => {
    expect(teamInitials('Atlético de Madrid', 'atm')).toBe('ATM');
    expect(teamInitials('Tottenham')).toBe('TOT');
    expect(teamInitials('Real Madrid')).toBe('RM');
    expect(teamInitials('FC Barcelona')).toBe('BAR');
    expect(teamInitials('')).toBe('?');
  });
});

describe('colores, siglas y escudos de un partido', () => {
  it('con datos de la API: colores, sigla y escudo del backend', () => {
    const m = match({ homeTeam: BARCA, awayTeam: JUVE });
    expect(teamPalette(m, 'home')).toEqual({
      primary: '#a50044',
      secondary: '#004d98',
      source: 'api',
    });
    expect(teamShort(m, 'home')).toBe('BAR');
    expect(teamCrest(m, 'home')).toBeNull();
    expect(teamCrest(m, 'away')).toBe('/api/v1/football/teams/133676/crest?v=abc');
  });

  it('sin datos: tono estable sacado del nombre e iniciales', () => {
    const m = match();
    const home = teamPalette(m, 'home');
    expect(home.source).toBe('name');
    expect(home.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(home.secondary).toBeNull();
    expect(teamPalette(m, 'home')).toEqual(home);
    expect(teamPalette(m, 'away').primary).not.toBe(home.primary);
    expect(teamShort(m, 'home')).toBe('BAR');
    expect(teamShort(m, 'away')).toBe('JUV');
    expect(teamCrest(m, 'home')).toBeNull();
    expect(competitionLogo(m)).toBeNull();
  });

  it('nunca enlaza a terceros: solo rutas relativas del mismo origen', () => {
    const m = match({
      homeTeam: { ...BARCA, crest: 'https://example.com/crest.png' },
      competitionBadge: { id: '4335', name: 'LaLiga', logo: '//cdn.example.com/logo.png' },
    });
    expect(teamCrest(m, 'home')).toBeNull();
    expect(competitionLogo(m)).toBeNull();
    expect(
      competitionLogo(
        match({
          competitionBadge: {
            id: '4335',
            name: 'LaLiga',
            logo: '/api/v1/football/competitions/4335/logo?v=1',
          },
        }),
      ),
    ).toBe('/api/v1/football/competitions/4335/logo?v=1');
  });

  it('paletteOf normaliza el hex y acepta colores sin almohadilla', () => {
    expect(paletteOf({ name: 'X', colors: { primary: 'CB3524', secondary: null } })).toEqual({
      primary: '#cb3524',
      secondary: null,
      source: 'api',
    });
  });

  it('competitionShort', () => {
    expect(competitionShort('Champions League')).toBe('UCL');
    expect(competitionShort('LaLiga')).toBe('LaLiga');
    expect(competitionShort('Premier League')).toBe('PL');
    expect(competitionShort('Amistoso')).toBe('Amistoso');
    expect(competitionShort('Clasificación para el Mundial')).toBe('Mundial');
    expect(competitionShort('Supercopa de Cataluña')).toBe('SC');
    expect(competitionShort('')).toBe('Fútbol');
  });
});

describe('versusPair: los dos colores de la tarjeta', () => {
  it('Barça (azulgrana) vs Juventus (negro): cada uno con su color', () => {
    const pair = versusPair(paletteOf(BARCA), paletteOf(JUVE));
    expect(pair).toEqual({ home: '#a50044', away: '#101010', swapped: false, darkened: false });
  });

  it('dos rojos (Sevilla vs Girona): el visitante pasa a su segundo color', () => {
    expect(colorDistance(SEVILLA.primary, GIRONA.primary)).toBeLessThan(VERSUS_DELTA);
    const pair = versusPair(SEVILLA, GIRONA);
    expect(pair).toEqual({ home: '#d4021d', away: '#ffffff', swapped: true, darkened: false });
  });

  it('dos rojos sin segundo color: se oscurece la mitad más clara', () => {
    const pair = versusPair({ ...SEVILLA, secondary: null }, { ...GIRONA, secondary: null });
    expect(pair.swapped).toBe(false);
    expect(pair.darkened).toBe(true);
    // Girona es la más clara de las dos: baja ~0,18 de luminosidad.
    expect(pair.home).toBe('#d4021d');
    expect(lightness(pair.away)).toBeCloseTo(lightness('#cd2534') - 0.18, 1);
    expect(colorDistance(pair.home, pair.away)).toBeGreaterThanOrEqual(VERSUS_DELTA);
  });

  it('el segundo color no vale si también se parece: entonces se oscurece', () => {
    const pair = versusPair(SEVILLA, { ...GIRONA, secondary: '#e02030' });
    expect(pair.swapped).toBe(false);
    expect(pair.darkened).toBe(true);
  });

  it('sin datos ninguno: dos tonos del nombre, distintos y sin tocar', () => {
    const pair = matchVersusPair(match({ home: 'Equipo A', away: 'Equipo B' }));
    expect(pair.home).not.toBe(pair.away);
    expect(pair.swapped).toBe(false);
  });
});
