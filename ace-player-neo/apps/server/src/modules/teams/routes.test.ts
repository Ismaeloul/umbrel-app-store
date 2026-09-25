/* Rutas del módulo `teams` por HTTP con app.inject (informe de fase 2, §6 y
   §10.8): la agenda v1 decorada, la antigua intacta y los PNG con sus cabeceras. */

import { FootballScheduleSchema, LegacyFootballResponseSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp, native, web } from '../../../test/helpers/index.js';
import type { FootballService } from '../football/types.js';
import { TEAMS_CACHE_PLAIN, TEAMS_CACHE_VERSIONED } from './constants.js';
import { LEGACY_ROUTES, V1_ROUTE_IDS } from './routes.js';
import { etagOf } from './store.js';
import {
  BADGE_URL,
  LEAGUE_BADGE_URL,
  apiTeam,
  createTeams,
  fixture,
  json,
  lookupLeagueUrl,
  match,
  png,
  runRound,
  schedule,
  searchTeamsUrl,
  solidPng,
} from './test-support.js';

const CREST = solidPng(4, 4, [0, 82, 159, 255]);
const LOGO = solidPng(2, 2, [255, 0, 0, 255]);

async function setup() {
  const agenda = schedule([match('Getafe', 'Elche', { competition: 'LaLiga' })]);
  const harness = createTeams({
    overrides: { teams: {}, competitions: { laliga: { idLeague: '4335' } } },
    schedule: agenda,
    routes: {
      [searchTeamsUrl('Getafe')]: json({
        teams: [apiTeam({ idTeam: '133730', strTeam: 'Getafe', strTeamShort: 'GET' })],
      }),
      [searchTeamsUrl('Elche')]: json({ teams: null }),
      [`${BADGE_URL}/small`]: png(CREST),
      [lookupLeagueUrl('4335')]: { status: 200, body: fixture('thesportsdb-lookupleague.json') },
      [`${LEAGUE_BADGE_URL}/small`]: png(LOGO),
    },
  });
  await runRound(harness);
  const { app } = await createTestApp({
    services: {
      teams: harness.teams,
      football: harness.football as unknown as FootballService,
    },
  });
  return { app, harness };
}

describe('tabla', () => {
  it('declara sus dos rutas v1 y ninguna antigua', () => {
    expect(V1_ROUTE_IDS).toEqual(['footballTeamCrest', 'footballCompetitionLogo']);
    expect(LEGACY_ROUTES).toEqual([]);
  });
});

describe('agenda', () => {
  it('GET /api/v1/football lleva homeTeam y competitionBadge cuando el índice sabe, y nada cuando no', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/v1/football', headers: web() });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(FootballScheduleSchema.parse(data)).toEqual(data);
    const decorated = data.days[0].matches[0];
    expect(decorated.homeTeam).toEqual({
      id: '133730',
      name: 'Getafe',
      short: 'GET',
      crest: `/api/v1/football/teams/133730/crest?v=${etagOf(CREST)}`,
      colors: { primary: '#004d98', secondary: '#a50044' },
    });
    expect(decorated.awayTeam).toBeUndefined();
    expect(decorated.competitionBadge).toEqual({
      id: '4335',
      name: 'Spanish La Liga',
      logo: `/api/v1/football/competitions/4335/logo?v=${etagOf(LOGO)}`,
    });
  });

  it('GET /api/football (antigua) sale sin homeTeam ni competitionBadge', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/football', headers: web() });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(LegacyFootballResponseSchema.parse(data)).toEqual(data);
    expect(data.days[0].matches[0].homeTeam).toBeUndefined();
    expect(data.days[0].matches[0].competitionBadge).toBeUndefined();
  });
});

describe('escudo y logo', () => {
  it('200 image/png con etag, content-length, last-modified y caché privada sin ?v=', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/football/teams/133730/crest',
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-length']).toBe(String(CREST.length));
    expect(response.headers.etag).toBe(`"${etagOf(CREST)}"`);
    expect(response.headers['cache-control']).toBe(TEAMS_CACHE_PLAIN);
    expect(response.headers['last-modified']).toBe(
      new Date('2026-01-01T00:00:00.000Z').toUTCString(),
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload.equals(CREST)).toBe(true);
  });

  it('con ?v=<etag> la respuesta es inmutable un año', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/football/teams/133730/crest?v=${etagOf(CREST)}`,
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe(TEAMS_CACHE_VERSIONED);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/football/teams/133730/crest?v=ZZZ',
      headers: web(),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_error');
  });

  it('If-None-Match → 304 sin cuerpo con etag y cache-control', async () => {
    const { app } = await setup();
    for (const header of [
      `"${etagOf(CREST)}"`,
      `W/"${etagOf(CREST)}"`,
      `"otro", "${etagOf(CREST)}"`,
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/football/teams/133730/crest?v=${etagOf(CREST)}`,
        headers: web({ 'if-none-match': header }),
      });
      expect(response.statusCode, header).toBe(304);
      expect(response.rawPayload).toHaveLength(0);
      expect(response.headers.etag).toBe(`"${etagOf(CREST)}"`);
      expect(response.headers['cache-control']).toBe(TEAMS_CACHE_VERSIONED);
    }
    const stale = await app.inject({
      method: 'GET',
      url: '/api/v1/football/teams/133730/crest',
      headers: web({ 'if-none-match': '"0123456789abcdef"' }),
    });
    expect(stale.statusCode).toBe(200);
  });

  it('id desconocido → 404 not_found (JSON v1); id con caracteres raros → 400', async () => {
    const { app } = await setup();
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/football/teams/999999/crest',
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(missing.headers['cache-control']).toBe('no-store');
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/football/teams/no%20vale/crest',
      headers: web(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('desde /native hace falta el Bearer (401 sin él)', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/native/api/v1/football/teams/133730/crest',
      headers: native(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('el logo de la competición sale por el mismo circuito', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/football/competitions/4335/logo?v=${etagOf(LOGO)}`,
      headers: web(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers.etag).toBe(`"${etagOf(LOGO)}"`);
    expect(response.rawPayload.equals(LOGO)).toBe(true);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/football/competitions/1/logo',
      headers: web(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('un HEAD da 404 (exposeHeadRoutes: false): los navegadores no lo hacen con imágenes', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'HEAD',
      url: '/api/v1/football/teams/133730/crest',
      headers: web(),
    });
    expect(response.statusCode).toBe(404);
  });
});
