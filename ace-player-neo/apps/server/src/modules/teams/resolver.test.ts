/* Resolución contra TheSportsDB (informe de fase 2, §10.2) con `net` de
   verdad sobre DNS de tabla y transporte falso: nada sale a la red. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import type { NetClient } from '../net/types.js';
import {
  BadgeImageError,
  apiUrl,
  chooseLeague,
  chooseTeam,
  fetchBadge,
  leagueKey,
  leagueMatches,
  lookupLeague,
  readApiLeagues,
  readApiTeams,
  scoreTeam,
  searchTeams,
  type ApiTeam,
} from './resolver.js';
import {
  BADGE_URL,
  apiLeague,
  apiTeam,
  createTeams,
  fixture,
  lookupLeagueUrl,
  png,
  searchTeamsUrl,
  solidPng,
} from './test-support.js';

const deps = (net: NetClient) => ({ net, apiKey: '123' });

function team(overrides: Record<string, unknown>): ApiTeam {
  return readApiTeams({ teams: [apiTeam(overrides)] })[0] as ApiTeam;
}

const BARCA = team({});
const BARCA_SC = team({
  idTeam: '138159',
  strTeam: 'Barcelona SC',
  strTeamShort: null,
  strAlternate: 'Barcelona Sporting Club',
  strLeague: 'Ecuadorian Serie A',
  idLeague: '4686',
  strCountry: 'Ecuador',
  strColour1: null,
  strColour2: null,
});
const REAL_SOCIEDAD = team({ idTeam: '133728', strTeam: 'Real Sociedad', strAlternate: null });
const REAL_SOCIEDAD_B = team({ idTeam: '145000', strTeam: 'Real Sociedad B', strAlternate: null });

describe('lectura de la API', () => {
  it('readApiTeams tolera `teams: null`, filas sin id y campos vacíos', () => {
    expect(readApiTeams({ teams: null })).toEqual([]);
    expect(readApiTeams(null)).toEqual([]);
    expect(readApiTeams({ teams: [{ strTeam: 'Sin id' }, null, 'x'] })).toEqual([]);
    expect(readApiTeams({ teams: [apiTeam({ idTeam: '1 2' })] })).toEqual([]);
    const [row] = readApiTeams(JSON.parse(fixture('thesportsdb-searchteams.json')));
    expect(row).toMatchObject({
      idTeam: '133738',
      strTeam: 'Real Madrid',
      strTeamShort: 'MAD',
      strCountry: 'Spain',
      strColour1: '#ffffff',
      strColour2: '#00529F',
    });
    expect(
      readApiTeams({ teams: [apiTeam({ strTeamShort: '', strColour1: null })] })[0],
    ).toMatchObject({
      strTeamShort: null,
      strColour1: null,
    });
  });

  it('readApiLeagues lee `leagues` (lookupleague) y `countries` (search_all_leagues, sic)', () => {
    const [league] = readApiLeagues(JSON.parse(fixture('thesportsdb-lookupleague.json')));
    expect(league).toMatchObject({
      idLeague: '4335',
      strLeague: 'Spanish La Liga',
      strCountry: 'Spain',
    });
    expect(
      readApiLeagues({ countries: [apiLeague({ idLeague: '4483', strLeague: 'Copa del Rey' })] }),
    ).toHaveLength(1);
    expect(readApiLeagues({ leagues: null })).toEqual([]);
  });

  it('las URLs llevan la clave y el término escapado', () => {
    expect(apiUrl('123', 'searchteams.php', { t: 'Real Madrid' })).toBe(
      'https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Real%20Madrid',
    );
    expect(apiUrl('abc', 'search_all_leagues.php', { s: 'Soccer', c: 'Spain' })).toContain(
      '/abc/search_all_leagues.php?s=Soccer&c=Spain',
    );
  });

  it('searchTeams y lookupLeague pasan por net (DNS de tabla, transporte falso)', async () => {
    const { net, transport } = createTeams({
      routes: {
        [searchTeamsUrl('Real Madrid')]: {
          status: 200,
          body: fixture('thesportsdb-searchteams.json'),
        },
        [lookupLeagueUrl('4335')]: { status: 200, body: fixture('thesportsdb-lookupleague.json') },
      },
    });
    expect((await searchTeams(deps(net), 'Real Madrid'))[0]?.idTeam).toBe('133738');
    expect((await lookupLeague(deps(net), '4335'))[0]?.strLeague).toBe('Spanish La Liga');
    expect(transport.requests.map((request) => request.url.pathname)).toEqual([
      '/api/v1/json/123/searchteams.php',
      '/api/v1/json/123/lookupleague.php',
    ]);
    expect(transport.requests[0]?.headers['User-Agent']).toMatch(/^AcePlayerNeo\//);
  });

  it('un 429 o un JSON roto salen como error de red (lo decide el servicio)', async () => {
    const { net } = createTeams({
      routes: {
        [searchTeamsUrl('A')]: { status: 429 },
        [searchTeamsUrl('B')]: { status: 200, body: '<html>' },
      },
    });
    await expect(searchTeams(deps(net), 'A')).rejects.toThrowError(
      expect.objectContaining({ code: 'http_429' }),
    );
    await expect(searchTeams(deps(net), 'B')).rejects.toThrowError('bad_response');
    await expect(searchTeams(deps(net), 'C')).rejects.toThrow(AppError);
  });
});

describe('elección del candidato', () => {
  it('elige el que se parece y da bonus por país y liga', () => {
    const ctx = { name: 'Barcelona', query: 'Barcelona', country: 'España', competition: 'LaLiga' };
    const choice = chooseTeam([BARCA_SC, BARCA], ctx);
    expect(choice).toMatchObject({ kind: 'chosen', team: { idTeam: '133739' } });
    expect(scoreTeam(BARCA, ctx)).toBeGreaterThan(scoreTeam(BARCA_SC, ctx));
  });

  it('Barcelona SC: con el país del override gana el de Ecuador; sin nada, ambiguo', () => {
    const base = {
      name: 'Barcelona SC',
      query: 'Barcelona SC',
      country: null,
      competition: 'Amistoso',
    };
    expect(chooseTeam([BARCA, BARCA_SC], base)).toMatchObject({ kind: 'ambiguous' });
    expect(
      chooseTeam([BARCA, BARCA_SC], { ...base, override: { country: 'Ecuador' } }),
    ).toMatchObject({
      kind: 'chosen',
      team: { idTeam: '138159' },
    });
  });

  it('sin parecido suficiente, none; otro deporte y filiales, fuera', () => {
    expect(
      chooseTeam([BARCA], {
        name: 'Getafe',
        query: 'Getafe',
        country: 'España',
        competition: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      chooseTeam([team({ strSport: 'Basketball' })], {
        name: 'Barcelona',
        query: 'Barcelona',
        country: null,
        competition: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      chooseTeam([REAL_SOCIEDAD], {
        name: 'Real Sociedad B',
        query: 'Real Sociedad B',
        country: 'España',
        competition: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      chooseTeam([REAL_SOCIEDAD_B, REAL_SOCIEDAD], {
        name: 'Real Sociedad',
        query: 'Real Sociedad',
        country: 'España',
        competition: null,
      }),
    ).toMatchObject({ kind: 'chosen', team: { idTeam: '133728' } });
    expect(chooseTeam([], { name: 'X', query: 'X', country: null, competition: null })).toEqual({
      kind: 'none',
    });
  });

  it('los nombres alternativos también cuentan (O. Lyonnais → Lyon)', () => {
    const lyon = team({
      idTeam: '133713',
      strTeam: 'Lyon',
      strAlternate: 'Olympique Lyonnais, Olympique Lyon, OL',
      strCountry: 'France',
      strLeague: 'French Ligue 1',
    });
    expect(
      chooseTeam([lyon], {
        name: 'O. Lyonnais',
        query: 'Lyonnais',
        country: 'España',
        competition: 'Ligue 1',
      }),
    ).toMatchObject({ kind: 'chosen', team: { idTeam: '133713' } });
  });

  it('ligas: clave compacta sin gentilicio y elección exacta antes que parcial', () => {
    expect(leagueKey('Spanish La Liga')).toBe('laliga');
    expect(leagueKey('LaLiga')).toBe('laliga');
    expect(leagueKey('English Premier League')).toBe('premierleague');
    expect(leagueMatches('Spanish La Liga', 'LaLiga')).toBe(true);
    expect(leagueMatches('Spanish La Liga 2', 'LaLiga Hypermotion')).toBe(false);
    expect(leagueMatches('Copa del Rey', 'LaLiga')).toBe(false);
    const leagues = readApiLeagues({
      countries: [
        apiLeague({ idLeague: '4400', strLeague: 'Spanish La Liga 2' }),
        apiLeague({ idLeague: '4483', strLeague: 'Copa del Rey' }),
        apiLeague(),
        apiLeague({ idLeague: '9', strLeague: 'Spanish La Liga', strSport: 'Basketball' }),
      ],
    });
    expect(chooseLeague(leagues, { name: 'LaLiga', query: 'LaLiga' })?.idLeague).toBe('4335');
    expect(
      chooseLeague(leagues, { name: 'LaLiga Hypermotion', query: 'La Liga 2' })?.idLeague,
    ).toBe('4400');
    expect(chooseLeague(leagues, { name: 'Copa del Rey', query: 'Copa del Rey' })?.idLeague).toBe(
      '4483',
    );
    expect(chooseLeague(leagues, { name: 'Bundesliga', query: 'Bundesliga' })).toBeNull();
  });
});

describe('fetchBadge', () => {
  const small = solidPng(2, 2, [1, 2, 3, 255]);
  const original = solidPng(4, 4, [1, 2, 3, 255]);

  it('pide primero la versión /small', async () => {
    const { net, transport } = createTeams({
      routes: { [`${BADGE_URL}/small`]: png(small), [BADGE_URL]: png(original) },
    });
    expect((await fetchBadge(deps(net), BADGE_URL)).equals(small)).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.headers.Accept).toBe('image/png,image/*;q=0.8');
  });

  it('si /small no existe o no es un PNG legible, baja la original', async () => {
    const missing = createTeams({ routes: { [BADGE_URL]: png(original) } });
    expect((await fetchBadge(deps(missing.net), BADGE_URL)).equals(original)).toBe(true);
    expect(missing.transport.requests.map((request) => request.url.href)).toEqual([
      `${BADGE_URL}/small`,
      BADGE_URL,
    ]);
    const broken = createTeams({
      routes: {
        [`${BADGE_URL}/small`]: { status: 200, body: 'no soy un png' },
        [BADGE_URL]: png(original),
      },
    });
    expect((await fetchBadge(deps(broken.net), BADGE_URL)).equals(original)).toBe(true);
  });

  it('las dos malas o inexistentes: BadgeImageError; un 429 sale tal cual', async () => {
    const bad = createTeams({
      routes: {
        [`${BADGE_URL}/small`]: { status: 200, body: 'x' },
        [BADGE_URL]: { status: 200, body: 'y' },
      },
    });
    await expect(fetchBadge(deps(bad.net), BADGE_URL)).rejects.toMatchObject({
      name: 'BadgeImageError',
      reason: 'bad_signature',
    });
    const none = createTeams();
    await expect(fetchBadge(deps(none.net), BADGE_URL)).rejects.toBeInstanceOf(BadgeImageError);
    const limited = createTeams({ routes: { [`${BADGE_URL}/small`]: { status: 429 } } });
    await expect(fetchBadge(deps(limited.net), BADGE_URL)).rejects.toThrowError(
      expect.objectContaining({ code: 'http_429' }),
    );
    const huge = createTeams({
      routes: {
        [`${BADGE_URL}/small`]: png(original),
        [BADGE_URL]: png(original),
      },
    });
    /* Un PNG que dice 5000×5000 en la cabecera se descarta sin decodificarlo. */
    const header = solidPng(1, 1, [0, 0, 0, 0]);
    header.writeUInt32BE(5000, 16);
    header.writeUInt32BE(5000, 20);
    const giant = createTeams({
      routes: { [`${BADGE_URL}/small`]: png(header), [BADGE_URL]: png(header) },
    });
    await expect(fetchBadge(deps(giant.net), BADGE_URL)).rejects.toMatchObject({
      reason: 'too_large',
    });
    expect((await fetchBadge(deps(huge.net), BADGE_URL)).length).toBe(original.length);
  });
});
