import { describe, expect, it } from 'vitest';
import {
  addCustomValue,
  chipsFor,
  cleanCustomValue,
  cleanPreferenceList,
  draftFrom,
  flagFor,
  followedLeague,
  followedTeam,
  hasAny,
  LEAGUE_OPTIONS,
  NATIONALITY_OPTIONS,
  preferenceSummary,
  preferencesBody,
  TEAM_OPTIONS,
  toggleFollow,
  toggleValue,
} from './model.ts';

const empty = { leagues: [], teams: [], nationalities: [] };

describe('catálogo de la 0.6.59', () => {
  it('9 ligas, 12 equipos y 14 países con bandera; los tuyos con el globo', () => {
    expect(LEAGUE_OPTIONS).toHaveLength(9);
    expect(TEAM_OPTIONS).toHaveLength(12);
    expect(NATIONALITY_OPTIONS).toHaveLength(14);
    expect(flagFor('España')).toBe('🇪🇸');
    expect(flagFor('Japón')).toBe('🌍');
  });
});

describe('limpieza (cleanPreferenceList)', () => {
  it('sin vacíos ni repetidos por clave, cortado y con tope', () => {
    expect(
      cleanPreferenceList(['  Real  Madrid ', 'real madrid', '', null, 'Barça'], 24, 80),
    ).toEqual(['Real Madrid', 'Barça']);
    expect(
      cleanPreferenceList(
        Array.from({ length: 30 }, (_, i) => `Equipo ${i}`),
        24,
        80,
      ),
    ).toHaveLength(24);
    expect(cleanPreferenceList(['x'.repeat(100)], 12, 60)[0]).toHaveLength(60);
    expect(cleanPreferenceList(undefined, 12, 60)).toEqual([]);
  });

  it('un valor tuyo de menos de 2 caracteres se ignora', () => {
    expect(cleanCustomValue(' a ', 'teams')).toBeNull();
    expect(cleanCustomValue('  Getafe  CF ', 'teams')).toBe('Getafe CF');
    expect(cleanCustomValue('y'.repeat(90), 'nationalities')).toHaveLength(60);
  });
});

describe('borrador', () => {
  it('parte de lo guardado y conmuta cada chip', () => {
    const draft = draftFrom({ leagues: ['LaLiga'], teams: [], nationalities: ['España'] });
    const on = toggleValue(draft, 'teams', 'Inter');
    expect(on.teams).toEqual(['Inter']);
    expect(toggleValue(on, 'teams', 'Inter').teams).toEqual([]);
    expect(hasAny(draft)).toBe(true);
    expect(hasAny(empty)).toBe(false);
  });

  it('con la lista llena no se añade nada', () => {
    const full = { ...empty, leagues: Array.from({ length: 12 }, (_, i) => `Liga ${i}`) };
    expect(toggleValue(full, 'leagues', 'Serie A')).toBe(full);
    expect(addCustomValue(full, 'leagues', 'Eredivisie')).toMatchObject({
      added: null,
      full: true,
    });
  });

  it('añadir a mano marca el chip que ya existe con la misma clave en vez de duplicarlo', () => {
    const first = addCustomValue(empty, 'teams', 'real madrid');
    expect(first.draft.teams).toEqual(['Real Madrid']);
    const custom = addCustomValue(first.draft, 'teams', 'Getafe');
    expect(custom.draft.teams).toEqual(['Real Madrid', 'Getafe']);
    expect(chipsFor('teams', custom.draft).at(-1)).toBe('Getafe');
    expect(addCustomValue(custom.draft, 'teams', 'GETAFE').draft.teams).toHaveLength(2);
    expect(addCustomValue(empty, 'nationalities', 'Japón').draft.nationalities).toEqual(['Japón']);
    expect(addCustomValue(empty, 'teams', 'x')).toMatchObject({ added: null, full: false });
  });
});

describe('resumen de Ajustes (index.html:2832-2840)', () => {
  it('singular, plural y la conjunción', () => {
    expect(preferenceSummary(empty)).toBe(
      'Personaliza la agenda con tus ligas, equipos y nacionalidades.',
    );
    expect(
      preferenceSummary({ leagues: ['LaLiga'], teams: ['A', 'B'], nationalities: ['España'] }),
    ).toBe('Tu agenda prioriza 1 liga, 2 equipos y 1 nacionalidad.');
    expect(preferenceSummary({ leagues: [], teams: [], nationalities: ['A', 'B'] })).toBe(
      'Tu agenda prioriza 2 nacionalidades.',
    );
  });
});

describe('guardar y seguir', () => {
  it('el PUT sustituye: va siempre entero y con onboardingComplete', () => {
    expect(
      preferencesBody({ country: 'Spain' }, { leagues: ['LaLiga'], teams: [], nationalities: [] }),
    ).toEqual({
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['LaLiga'],
      teams: [],
      nationalities: [],
    });
    expect(preferencesBody(null, empty).country).toBe('Spain');
  });

  it('seguir y dejar de seguir con las reglas de «Para ti» (alias, nunca «incluye»)', () => {
    const prefs = { leagues: ['LaLiga'], teams: ['Barcelona'], nationalities: [] };
    expect(followedTeam(prefs, 'FC Barcelona')).toBe('Barcelona');
    expect(followedTeam(prefs, 'Barcelona SC')).toBeNull();
    expect(followedLeague(prefs, 'La Liga EA Sports')).toBe('LaLiga');
    expect(toggleFollow(prefs, 'teams', 'FC Barcelona')?.teams).toEqual([]);
    expect(toggleFollow(prefs, 'teams', 'Girona')?.teams).toEqual(['Barcelona', 'Girona']);
    expect(toggleFollow(prefs, 'leagues', 'LaLiga')?.leagues).toEqual([]);
    const full = { ...prefs, teams: Array.from({ length: 24 }, (_, i) => `Equipo ${i}`) };
    expect(toggleFollow(full, 'teams', 'Girona')).toBeNull();
  });
});
