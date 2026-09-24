/* Servicio `teams` (informe de fase 2, §10.6-10.8): decoración pura, vuelta
   de resolución con cola única, fallos, pausa por 429, poda y salud. Reloj
   falso, `net` de verdad sobre transporte falso y DATA_DIR temporal. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FootballScheduleSchema, type FootballSchedule } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import type { DiagnosticReport } from '../../core/bus.js';
import {
  TEAMS_NOT_FOUND_RETRY_MS,
  TEAMS_RATE_LIMIT_PAUSE_MS,
  TEAMS_REQUEST_GAP_MS,
  TEAMS_RETRY_BACKOFF_MS,
  TEAMS_REVALIDATE_MS,
} from './constants.js';
import { etagOf, type TeamsIndex } from './store.js';
import {
  BADGE_URL,
  LEAGUE_BADGE_URL,
  apiTeam,
  createTeams,
  encodePng,
  fixture,
  flush,
  json,
  lookupLeagueUrl,
  lookupTeamUrl,
  match,
  png,
  runRound,
  schedule,
  searchTeamsUrl,
  solidPng,
  twoTonePng,
  type Rgba,
  type TeamsHarnessOptions,
} from './test-support.js';

const BLUE: Rgba = [0, 82, 159, 255];
const RED: Rgba = [203, 53, 36, 255];
/* Sin correcciones de equipos; "Fútbol" (la competición por defecto de `match`) en `skip`. */
const NONE = { teams: {}, competitions: { futbol: { skip: true as const } } };
const HOUR = 60 * 60 * 1000;

/** `nextRetryAt` cae a `delay` de cuando se anotó (el reloj del arnés puede haber avanzado unos segundos más). */
function retryIn(entry: { nextRetryAt: string | null } | undefined, from: number, delay: number) {
  const at = Date.parse(entry?.nextRetryAt ?? '');
  expect(at).toBeGreaterThan(from + delay - 10_000);
  expect(at).toBeLessThanOrEqual(from + delay);
}

function reports(harness: ReturnType<typeof createTeams>): DiagnosticReport[] {
  const seen: DiagnosticReport[] = [];
  harness.core.bus.on('diagnostics.report', (report) => seen.push(report));
  return seen;
}

/** Getafe resuelto por búsqueda (sin override) con escudo y colores de la API; Elche no existe. */
function getafeElche(extra: Partial<TeamsHarnessOptions> = {}) {
  const badge = twoTonePng(8, 8, BLUE, RED);
  const harness = createTeams({
    overrides: NONE,
    schedule: schedule([match('Getafe', 'Elche')]),
    routes: {
      [searchTeamsUrl('Getafe')]: json({
        teams: [
          apiTeam({
            idTeam: '133730',
            strTeam: 'Getafe',
            strTeamShort: 'GET',
            strAlternate: 'Getafe CF',
            strColour1: '#005999',
            strColour2: '#ffffff',
          }),
        ],
      }),
      [searchTeamsUrl('Elche')]: json({ teams: null }),
      [`${BADGE_URL}/small`]: png(badge),
    },
    ...extra,
  });
  return { ...harness, badge, diagnostics: reports(harness) };
}

describe('decorateSchedule', () => {
  it('es pura y síncrona: no toca la agenda original, valida con el esquema y añade lo que sabe', async () => {
    const { teams, core, badge } = getafeElche();
    const agenda = schedule([match('Getafe', 'Elche')]);
    const copy = structuredClone(agenda);
    const before = teams.decorateSchedule(agenda);
    expect(before.days[0]?.matches[0]?.homeTeam).toBeUndefined();
    expect(before).not.toBe(agenda);
    await runRound({ teams, core });
    const after = teams.decorateSchedule(agenda);
    expect(agenda).toEqual(copy);
    expect(FootballScheduleSchema.parse(after)).toEqual(after);
    const decorated = after.days[0]?.matches[0];
    expect(decorated?.homeTeam).toEqual({
      id: '133730',
      name: 'Getafe',
      short: 'GET',
      crest: `/api/v1/football/teams/133730/crest?v=${etagOf(badge)}`,
      colors: { primary: '#005999', secondary: '#ffffff' },
    });
    expect(decorated?.awayTeam).toBeUndefined();
    expect(decorated?.competitionBadge).toBeUndefined();
    expect(decorated?.home).toBe('Getafe');
    expect(decorated?.away).toBe('Elche');
  });

  it('en demo o con ACE_TEAM_CRESTS=false devuelve la misma agenda, no toca red ni disco y la salud dice disabled', async () => {
    for (const env of [{ FOOTBALL_DEMO_ONLY: 'true' }, { ACE_TEAM_CRESTS: 'false' }]) {
      const harness = createTeams({ env, schedule: schedule([match('Getafe', 'Elche')]) });
      const agenda = schedule([match('Getafe', 'Elche')]);
      expect(harness.teams.decorateSchedule(agenda)).toBe(agenda);
      await harness.teams.start();
      await harness.teams.runOnce();
      harness.core.clock.advance(10 * 60 * 1000);
      await flush();
      expect(harness.transport.requests).toHaveLength(0);
      expect(harness.football.schedule).not.toHaveBeenCalled();
      expect(existsSync(harness.core.config.paths.teamsDir)).toBe(false);
      expect(harness.teams.healthInfo()).toEqual({
        status: 'disabled',
        teams: 0,
        crests: 0,
        pending: 0,
        lastRefreshAt: null,
        detail: null,
      });
      await harness.teams.stop();
    }
  });

  it('lo que la agenda pide y el índice no conoce entra en la siguiente vuelta aunque ya no esté en la agenda', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([]),
      routes: { [searchTeamsUrl('Osasuna')]: json({ teams: null }) },
    });
    harness.teams.decorateSchedule(schedule([match('Osasuna', '')]));
    await runRound(harness);
    expect(harness.transport.requests.map((request) => request.url.href)).toEqual([
      searchTeamsUrl('Osasuna'),
    ]);
    expect(harness.teams.snapshot().teams.osasuna).toMatchObject({
      status: 'not_found',
      attempts: 0,
    });
  });

  it('colores fijados por override salen aunque no haya escudo (id k-<clave>)', async () => {
    const harness = createTeams({
      overrides: {
        teams: { 'cd mitico': { colors: ['#112233', '#445566'], skip: true } },
        competitions: NONE.competitions,
      },
      schedule: schedule([match('CD Mítico', 'Otro')]),
      routes: { [searchTeamsUrl('Otro')]: json({ teams: null }) },
    });
    const first = harness.teams.decorateSchedule(schedule([match('CD Mítico', 'Otro')]));
    expect(first.days[0]?.matches[0]?.homeTeam).toEqual({
      id: 'k-cd-mitico',
      name: 'CD Mítico',
      short: null,
      crest: null,
      colors: { primary: '#112233', secondary: '#445566' },
    });
    await runRound(harness);
    expect(harness.teams.snapshot().teams['cd mitico']?.status).toBe('skipped');
    expect(harness.transport.requests.map((request) => request.url.href)).toEqual([
      searchTeamsUrl('Otro'),
    ]);
  });
});

describe('runOnce', () => {
  it('usa lookupteam.php con override de id y saca los colores del fixture real', async () => {
    const harness = createTeams({
      schedule: schedule([match('Real Madrid', '')]),
      routes: {
        [lookupTeamUrl('133738')]: { status: 200, body: fixture('thesportsdb-searchteams.json') },
        ['https://r2.thesportsdb.com/images/media/team/badge/vwvwrw1473502969.png/small']: png(
          solidPng(2, 2, [255, 255, 255, 255]),
        ),
      },
    });
    await runRound(harness);
    expect(harness.teams.snapshot().teams['real madrid']).toMatchObject({
      idTeam: '133738',
      apiName: 'Real Madrid',
      short: 'MAD',
      status: 'resolved',
      colors: { primary: '#ffffff', secondary: '#00529f', source: 'thesportsdb' },
    });
    expect(harness.teams.healthInfo()).toMatchObject({
      status: 'ready',
      teams: 1,
      crests: 1,
      pending: 0,
    });
  });

  it('sin colores en la API los saca del PNG; con override, el override manda', async () => {
    const badge = encodePng({
      width: 8,
      height: 8,
      colorType: 6,
      sample: (x) => (x < 6 ? BLUE : RED),
    });
    const routes = {
      [searchTeamsUrl('Getafe')]: json({
        teams: [
          apiTeam({ idTeam: '133730', strTeam: 'Getafe', strColour1: null, strColour2: null }),
        ],
      }),
      [`${BADGE_URL}/small`]: png(badge),
    };
    const fromImage = createTeams({
      overrides: NONE,
      schedule: schedule([match('Getafe', '')]),
      routes,
    });
    await runRound(fromImage);
    expect(fromImage.teams.snapshot().teams.getafe?.colors).toEqual({
      primary: '#00529f',
      secondary: '#cb3524',
      source: 'image',
    });
    const fromOverride = createTeams({
      overrides: { teams: { getafe: { colors: ['#123456', null] } }, competitions: {} },
      schedule: schedule([match('Getafe', '')]),
      routes,
    });
    await runRound(fromOverride);
    expect(fromOverride.teams.snapshot().teams.getafe?.colors).toEqual({
      primary: '#123456',
      secondary: null,
      source: 'override',
    });
  });

  it('cola única: entre dos resoluciones espera 1,5 s con el reloj inyectado', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('Uno', 'Dos')]),
      routes: {
        [searchTeamsUrl('Uno')]: json({ teams: null }),
        [searchTeamsUrl('Dos')]: json({ teams: null }),
      },
    });
    const run = harness.teams.runOnce();
    await flush();
    expect(harness.transport.requests.map((request) => request.url.href)).toEqual([
      searchTeamsUrl('Uno'),
    ]);
    expect(harness.core.clock.pendingTimers()).toBe(1);
    await harness.core.clock.advanceAsync(TEAMS_REQUEST_GAP_MS);
    await flush();
    expect(harness.transport.requests).toHaveLength(2);
    await run;
    expect(harness.core.clock.pendingTimers()).toBe(0);
  });

  it('respeta el presupuesto por vuelta y sigue por donde iba en la siguiente', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('A', 'B'), match('C', 'D', { date: '2026-01-03' })]),
      routes: () => json({ teams: null }),
    });
    await runRound(harness, { budget: 1 });
    expect(harness.transport.requests.map((request) => request.url.search)).toEqual(['?t=A']);
    await runRound(harness, { budget: 2 });
    expect(harness.transport.requests.map((request) => request.url.search)).toEqual([
      '?t=A',
      '?t=B',
      '?t=C',
    ]);
  });

  it('not_found reintenta a la semana; una imagen mala deja bad_image sin escudo', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('Getafe', 'Elche')]),
      routes: {
        [searchTeamsUrl('Getafe')]: json({
          teams: [apiTeam({ idTeam: '133730', strTeam: 'Getafe' })],
        }),
        [searchTeamsUrl('Elche')]: json({ teams: null }),
        [`${BADGE_URL}/small`]: { status: 200, body: 'no soy un png' },
        [BADGE_URL]: { status: 200, body: 'tampoco' },
      },
    });
    const diagnostics = reports(harness);
    await runRound(harness);
    const start = harness.core.clock.now();
    const index = harness.teams.snapshot();
    expect(index.teams.elche).toMatchObject({ status: 'not_found', attempts: 0 });
    retryIn(index.teams.elche, start, TEAMS_NOT_FOUND_RETRY_MS);
    expect(index.teams.getafe).toMatchObject({
      status: 'bad_image',
      idTeam: '133730',
      crest: null,
      colors: { primary: '#004d98', secondary: '#a50044' },
    });
    expect(diagnostics).toEqual([]);
    expect(harness.teams.healthInfo().status).toBe('ready');
    /* Con colores pero sin escudo, la agenda lleva los colores. */
    const decorated = harness.teams.decorateSchedule(schedule([match('Getafe', 'Elche')]));
    expect(decorated.days[0]?.matches[0]?.homeTeam).toMatchObject({ id: '133730', crest: null });
    /* Antes de la semana no se vuelve a pedir; después, sí. */
    harness.transport.requests.length = 0;
    await runRound(harness);
    expect(harness.transport.requests).toHaveLength(0);
    harness.core.clock.advance(TEAMS_NOT_FOUND_RETRY_MS);
    await runRound(harness);
    expect(harness.transport.requests.map((request) => request.url.search)).toContain('?t=Elche');
  });

  it('un 429 para la vuelta, pausa una hora y deja un aviso; después se reanuda', async () => {
    let limited = 0;
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('A', 'B')]),
      routes: {
        /* Solo la primera consulta de A da 429; después TheSportsDB vuelve a responder. */
        [searchTeamsUrl('A')]: () => {
          limited += 1;
          return limited === 1 ? { status: 429 } : json({ teams: null });
        },
        [searchTeamsUrl('B')]: json({ teams: null }),
      },
    });
    const diagnostics = reports(harness);
    await runRound(harness);
    expect(harness.transport.requests.map((request) => request.url.search)).toEqual(['?t=A']);
    expect(diagnostics).toEqual([
      expect.objectContaining({ cause: 'network', code: 'crest_rate_limited' }),
    ]);
    expect(harness.teams.healthInfo()).toMatchObject({ status: 'degraded', pending: 2 });
    expect(harness.teams.healthInfo().detail).toContain('429');
    await runRound(harness);
    expect(harness.transport.requests).toHaveLength(1);
    harness.core.clock.advance(TEAMS_RATE_LIMIT_PAUSE_MS);
    await runRound(harness);
    expect(harness.transport.requests.map((request) => request.url.search)).toEqual([
      '?t=A',
      '?t=A',
      '?t=B',
    ]);
    /* La vuelta tras la pausa fue bien: ni aviso nuevo ni `degraded`. */
    expect(diagnostics).toHaveLength(1);
    expect(harness.teams.healthInfo()).toMatchObject({ status: 'ready', pending: 0 });
  });

  it('fallos de red: espera 10 min, luego 1 h; un solo aviso por vuelta aunque fallen varios', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('A', 'B')]),
      routes: () => ({ status: 503 }),
    });
    const diagnostics = reports(harness);
    await runRound(harness);
    const t0 = harness.core.clock.now();
    expect(harness.transport.requests).toHaveLength(2);
    expect(diagnostics).toEqual([
      expect.objectContaining({ cause: 'network', code: 'crest_lookup_failed' }),
    ]);
    expect(diagnostics[0]?.message).toContain('http_503');
    expect(harness.teams.snapshot().teams.a).toMatchObject({ status: 'failed', attempts: 1 });
    retryIn(harness.teams.snapshot().teams.a, t0, TEAMS_RETRY_BACKOFF_MS[0] as number);
    expect(harness.teams.healthInfo()).toMatchObject({ status: 'degraded', pending: 0 });
    await runRound(harness);
    expect(harness.transport.requests).toHaveLength(2);
    harness.core.clock.advance(TEAMS_RETRY_BACKOFF_MS[0] as number);
    await runRound(harness);
    const t1 = harness.core.clock.now();
    expect(harness.transport.requests).toHaveLength(4);
    expect(harness.teams.snapshot().teams.a).toMatchObject({ attempts: 2 });
    retryIn(harness.teams.snapshot().teams.a, t1, TEAMS_RETRY_BACKOFF_MS[1] as number);
    expect(diagnostics).toHaveLength(2);
  });

  it('una vuelta buena tras una mala vuelve a ready; sin agenda no pasa nada', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: null,
    });
    await runRound(harness);
    expect(harness.teams.healthInfo()).toMatchObject({ status: 'ready', teams: 0 });
    expect(harness.transport.requests).toHaveLength(0);
  });

  it('stop() aborta la vuelta en curso y espera a que termine', async () => {
    let release: (() => void) | null = null;
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('A', 'B')]),
      routes: () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, body: JSON.stringify({ teams: null }) });
        }),
    });
    await harness.teams.start();
    harness.core.clock.advance(30 * 1000); // primera vuelta a los 30 s
    await flush();
    expect(harness.transport.requests).toHaveLength(1);
    expect(release).not.toBeNull();
    await harness.teams.stop();
    expect(harness.core.clock.pendingTimers()).toBe(0);
    expect(harness.teams.healthInfo()).toMatchObject({ status: 'warming', lastRefreshAt: null });
    expect(harness.teams.snapshot().teams.a?.status).toBe('pending');
    (release as unknown as () => void)();
    await flush();
    expect(harness.transport.requests).toHaveLength(1);
  });

  it('start programa 30 s y 5 min con unref; la vuelta también lee overrides.json del volumen', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('Getafe', '')]),
      routes: {
        [lookupTeamUrl('133730')]: json({
          teams: [apiTeam({ idTeam: '133730', strTeam: 'Getafe', strBadge: null })],
        }),
      },
    });
    const dir = harness.core.config.paths.teamsDir;
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'overrides.json'),
      JSON.stringify({ teams: { getafe: { idTeam: '133730' } } }),
    );
    await harness.teams.start();
    expect(harness.core.clock.pendingTimers()).toBe(2);
    harness.core.clock.advance(30 * 1000);
    await flush();
    await harness.teams.stop();
    expect(harness.transport.requests.map((request) => request.url.href)).toEqual([
      lookupTeamUrl('133730'),
    ]);
    expect(harness.teams.snapshot().teams.getafe).toMatchObject({
      status: 'resolved',
      crest: null,
      idTeam: '133730',
    });
  });

  it('persiste el índice y el PNG en data/v2/teams y los revalida a los 90 días', async () => {
    const harness = getafeElche();
    await runRound(harness);
    await harness.teams.stop();
    const dir = harness.core.config.paths.teamsDir;
    const onDisk = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as TeamsIndex;
    expect(onDisk.teams.getafe?.crest?.file).toBe('133730.png');
    expect(readFileSync(path.join(dir, '133730.png')).equals(harness.badge)).toBe(true);
    expect(onDisk.teams.getafe?.nextRetryAt).toBe(
      new Date(
        Date.parse(onDisk.teams.getafe?.resolvedAt ?? '') + TEAMS_REVALIDATE_MS,
      ).toISOString(),
    );
    harness.transport.requests.length = 0;
    harness.core.clock.advance(TEAMS_REVALIDATE_MS);
    await runRound(harness);
    expect(harness.transport.requests.map((request) => request.url.search)).toContain('?t=Getafe');
  });
});

describe('competiciones', () => {
  it('con override de idLeague usa lookupleague.php y decora competitionBadge con el logo', async () => {
    const logo = solidPng(3, 3, [255, 0, 0, 255]);
    const agenda: FootballSchedule = schedule([match('A', 'B', { competition: 'LaLiga' })]);
    const harness = createTeams({
      overrides: { teams: {}, competitions: { laliga: { idLeague: '4335' } } },
      schedule: agenda,
      routes: {
        [searchTeamsUrl('A')]: json({ teams: null }),
        [searchTeamsUrl('B')]: json({ teams: null }),
        [lookupLeagueUrl('4335')]: { status: 200, body: fixture('thesportsdb-lookupleague.json') },
        [`${LEAGUE_BADGE_URL}/small`]: png(logo),
      },
    });
    await runRound(harness);
    const decorated = harness.teams.decorateSchedule(agenda);
    expect(decorated.days[0]?.matches[0]?.competitionBadge).toEqual({
      id: '4335',
      name: 'Spanish La Liga',
      logo: `/api/v1/football/competitions/4335/logo?v=${etagOf(logo)}`,
    });
    expect(FootballScheduleSchema.parse(decorated)).toEqual(decorated);
    expect(
      existsSync(path.join(harness.core.config.paths.teamsDir, 'competitions', '4335.png')),
    ).toBe(true);
  });

  it('sin id busca por país y nombre; si no está, not_found sin aviso', async () => {
    const harness = createTeams({
      overrides: NONE,
      schedule: schedule([match('A', 'B', { competition: 'Copa del Rey' })]),
      routes: {
        [searchTeamsUrl('A')]: json({ teams: null }),
        [searchTeamsUrl('B')]: json({ teams: null }),
        ['https://www.thesportsdb.com/api/v1/json/123/search_all_leagues.php?s=Soccer&c=Spain']:
          json({
            countries: [{ idLeague: '4335', strLeague: 'Spanish La Liga', strSport: 'Soccer' }],
          }),
      },
    });
    const diagnostics = reports(harness);
    await runRound(harness);
    expect(harness.teams.snapshot().competitions['copa del rey']).toMatchObject({
      status: 'not_found',
      query: 'Copa del Rey',
    });
    expect(diagnostics).toEqual([]);
  });
});

describe('poda', () => {
  it('sobran las entradas y los escudos de lastSeenAt más viejo', async () => {
    const badge = solidPng(1, 1, [0, 0, 0, 255]);
    const harness = createTeams({
      overrides: NONE,
      limits: { maxEntries: 2, maxCrests: 1 },
      schedule: () => Promise.resolve(current),
      routes: (request) => {
        const query = request.url.searchParams.get('t');
        if (query) {
          return json({
            teams: [
              apiTeam({ idTeam: `9${query.charCodeAt(0)}`, strTeam: query, strAlternate: null }),
            ],
          });
        }
        return png(badge);
      },
    });
    let current = schedule([match('Alfa', 'Beta')]);
    await runRound(harness);
    expect(Object.keys(harness.teams.snapshot().teams).sort()).toEqual(['alfa', 'beta']);
    /* Dos escudos con tope de uno: el más viejo (empate → el primero) lo pierde y vuelve a la cola. */
    expect(harness.teams.snapshot().teams.alfa).toMatchObject({ crest: null, status: 'pending' });
    expect(harness.teams.snapshot().teams.beta?.crest?.file).toBe('966.png');
    harness.core.clock.advance(HOUR);
    current = schedule([match('Gamma', '')]);
    await runRound(harness);
    const keys = Object.keys(harness.teams.snapshot().teams).sort();
    expect(keys).toHaveLength(2);
    expect(keys).toContain('gamma');
    const dir = harness.core.config.paths.teamsDir;
    await harness.teams.stop();
    const onDisk = readFileSync(path.join(dir, 'index.json'), 'utf8');
    expect(onDisk).toContain('"gamma"');
    expect(existsSync(path.join(dir, '965.png'))).toBe(false);
  });
});
