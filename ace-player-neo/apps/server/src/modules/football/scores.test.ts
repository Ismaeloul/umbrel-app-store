/* Marcadores en vivo de ESPN (server.js:2088-2337, 3355-3360; api.md §4.13;
   B-128, B-130, B-131, B-132). */

import { LegacyScoresResponseSchema, ScoresResponseSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { ESPN_BASE, FLTV_URL, SCORES_CACHE_MS, SCORES_CACHE_STALE_MS } from './constants.js';
import {
  bestTeamSimilarity,
  canonicalTeam,
  espnLeaguesFor,
  getLiveScores,
  matchIsInScoreWindow,
  pruneScoresCache,
  readEspnEvent,
  scoresCache,
  teamSimilarity,
} from './legacy-exports.js';
import { computeLiveScores, espnDateRange } from './scores.js';
import { createFootball, fixture } from './test-support.js';

const MIN = 60 * 1000;
const RANGE = '20251231-20260102';
const ESPN_UCL = `${ESPN_BASE}/uefa.champions/scoreboard?dates=`;
const ESPN_UCL_QUAL = `${ESPN_BASE}/uefa.champions_qual/scoreboard?dates=`;
const ESPN_ESP1 = `${ESPN_BASE}/esp.1/scoreboard?dates=`;

describe('T-039 · las competiciones de la agenda se mapean a ligas de ESPN (B-131)', () => {
  it('rótulos con tildes y espacios; lo que ESPN no cubre, null', () => {
    expect(espnLeaguesFor('La Liga EA Sports')).toEqual(['esp.1']);
    expect(espnLeaguesFor('LaLiga Hypermotion')).toEqual(['esp.2']);
    expect(espnLeaguesFor('  Serie A Italiana  ')).toEqual(['ita.1']);
    expect(espnLeaguesFor('Champions League')).toEqual(['uefa.champions', 'uefa.champions_qual']);
    expect(espnLeaguesFor('Torneo Proyección')).toBeNull();
    expect(espnLeaguesFor('MLS Next Pro')).toBeNull();
    expect(espnLeaguesFor('constructor')).toBeNull();
  });
});

describe('T-040 · los nombres de equipo casan pese a escribirse distinto (B-130)', () => {
  it('tildes, coletillas, abreviaturas y alias', () => {
    expect(teamSimilarity('Fenerbahçe', 'Fenerbahce')).toBe(1);
    expect(teamSimilarity('Atlético de Madrid', 'Atlético Madrid')).toBe(1);
    expect(teamSimilarity('GNK Dinamo Zagreb', 'Dinamo Zagreb')).toBe(1);
    expect(teamSimilarity('O. Lyonnais', 'Lyon')).toBe(1);
    expect(teamSimilarity('B. Dortmund', 'Borussia Dortmund')).toBe(1);
    expect(teamSimilarity('Inter de Milán', 'Internazionale')).toBe(1);
  });

  it('alias en los dos lados y rótulos de ESPN', () => {
    expect(canonicalTeam('Olympique Lyonnais')).toBe('lyon');
    expect(canonicalTeam('toString')).toBeNull();
    expect(teamSimilarity('Marsella', 'Olympique Marseille')).toBe(1);
    expect(teamSimilarity('Nápoles', 'Napoles')).toBe(1);
    expect(teamSimilarity('', 'Lyon')).toBe(0);
    expect(
      bestTeamSimilarity('Man City', {
        displayName: 'Manchester City',
        shortDisplayName: 'Man City',
      }),
    ).toBe(1);
    expect(bestTeamSimilarity('Man City', null)).toBe(0);
  });
});

describe('T-041 · dos equipos distintos no se confunden por compartir una palabra (B-130)', () => {
  it('Real Madrid/Real Sociedad < 0,6 y los que no comparten nada, 0', () => {
    expect(teamSimilarity('Real Madrid', 'Real Sociedad')).toBeLessThan(0.6);
    expect(teamSimilarity('Levski Sofia', 'AEK Athens')).toBe(0);
    expect(teamSimilarity('Athletic Club', 'Atlético Madrid')).toBe(0);
  });
});

describe('T-042 · solo se consulta el marcador dentro de la ventana del partido (B-128)', () => {
  it('de 15 min antes a 3 h 30 min después; sin `start`, nunca', () => {
    const saque = Date.UTC(2026, 7, 18, 19, 0, 0);
    expect(matchIsInScoreWindow({ start: saque }, saque - 60 * MIN)).toBe(false);
    expect(matchIsInScoreWindow({ start: saque }, saque - 10 * MIN)).toBe(true);
    expect(matchIsInScoreWindow({ start: saque }, saque + 60 * MIN)).toBe(true);
    expect(matchIsInScoreWindow({ start: saque }, saque + 200 * MIN)).toBe(true);
    expect(matchIsInScoreWindow({ start: saque }, saque + 300 * MIN)).toBe(false);
    expect(matchIsInScoreWindow({ start: undefined }, saque)).toBe(false);
    expect(matchIsInScoreWindow(null, saque)).toBe(false);
  });
});

describe('T-043 · se leen marcador, estado y reloj de un evento de ESPN (B-128)', () => {
  it('números, estado, reloj e inicio', () => {
    const evento = {
      date: '2026-08-18T19:00Z',
      status: { displayClock: "63'", type: { state: 'in', shortDetail: "63'" } },
      competitions: [
        {
          competitors: [
            {
              homeAway: 'home',
              score: '2',
              team: { displayName: 'Fenerbahce', shortDisplayName: 'Fenerbahce' },
            },
            {
              homeAway: 'away',
              score: '1',
              team: { displayName: 'Lyon', shortDisplayName: 'Lyon' },
            },
          ],
        },
      ],
    };
    const leido = readEspnEvent(evento);
    expect(leido?.homeScore).toBe(2);
    expect(leido?.awayScore).toBe(1);
    expect(leido?.state).toBe('in');
    expect(leido?.clock).toBe("63'");
    expect(leido?.start).toBe(Date.parse('2026-08-18T19:00Z'));
    expect(leido?.homeName).toBe('Fenerbahce');
  });
});

describe('T-044 · un evento sin los dos equipos se descarta en vez de romper (B-128)', () => {
  it('null sin competidores y con {}', () => {
    expect(readEspnEvent({ competitions: [{ competitors: [] }] })).toBeNull();
    expect(readEspnEvent({})).toBeNull();
    expect(readEspnEvent(null)).toBeNull();
  });
});

describe('T-114 · la cache de marcadores se poda (B-131)', () => {
  it('borra lo caducado hace dos días y conserva lo vigente y lo que está en vuelo', () => {
    const now = Date.UTC(2026, 0, 1);
    const cache = scoresCache();
    cache.set('liga@viejo', { payload: [], expiresAt: now - 2 * 24 * 3600 * 1000, pending: null });
    cache.set('liga@hoy', { payload: [], expiresAt: now + 60_000, pending: null });
    cache.set('liga@en-vuelo', { payload: null, expiresAt: 0, pending: Promise.resolve([]) });
    pruneScoresCache(now);
    expect(cache.has('liga@viejo')).toBe(false);
    expect(cache.has('liga@hoy')).toBe(true);
    expect(cache.has('liga@en-vuelo')).toBe(true);
    cache.clear();
  });
});

describe('getLiveScores del servicio (api.md §4.13, B-128, B-130, B-132)', () => {
  /* Agenda de futbolenlatv del fixture (Sevilla-Rayo 19:00Z, Madrid-City
     20:00Z, Atlético-Girona el día 2) y ESPN de Champions y LaLiga. */
  function harness(espn: Record<string, string | (() => string)> = {}) {
    return createFootball({
      net: {
        [FLTV_URL]: fixture('futbolenlatv.html'),
        [ESPN_UCL]: fixture('espn-uefa-champions.json'),
        [ESPN_ESP1]: fixture('espn-esp1.json'),
        ...espn,
      },
    });
  }

  it('sin partidos en su ventana: 200 sin `attribution` y 0 ligas', async () => {
    const { football, net } = harness();
    const scores = await football.legacyScores();
    expect(scores).toEqual({
      success: true,
      generatedAt: '2026-01-01T00:00:00.000Z',
      source: 'espn',
      leagues: 0,
      scores: {},
    });
    expect(LegacyScoresResponseSchema.parse(scores)).toEqual(scores);
    expect(net.calls.some((call) => call.url.startsWith(ESPN_BASE))).toBe(false);
  });

  it('en juego: empareja por saque y nombres y lee el marcador', async () => {
    const { football, core, net } = harness();
    await football.schedule();
    core.clock.set(Date.UTC(2026, 0, 1, 20, 30));
    const scores = await football.legacyScores();
    expect(LegacyScoresResponseSchema.parse(scores)).toEqual(scores);
    if (!scores.success || !('attribution' in scores)) throw new Error('forma inesperada');
    expect(scores.attribution).toBe('ESPN');
    expect(scores.leagues).toBe(3); // uefa.champions, uefa.champions_qual, esp.1
    const byTitle = await football.schedule();
    const [sevilla, madrid] = byTitle.days[0]!.matches;
    expect(scores.scores[madrid!.id]).toEqual({
      home: 2,
      away: 1,
      state: 'in',
      clock: "63'",
      detail: "63'",
      confidence: 1,
    });
    // "Sevilla FC" contra "Sevilla" y "Rayo Vallecano" igual: acabado
    expect(scores.scores[sevilla!.id]).toMatchObject({ home: 3, away: 3, state: 'post' });
    // la liga que falla (champions_qual, sin ruta) no tumba al resto
    expect(net.calls.some((call) => call.url === `${ESPN_UCL_QUAL}20251231-20260102`)).toBe(true);
    expect(net.calls.find((call) => call.url.startsWith(ESPN_UCL))?.options).toMatchObject({
      totalTimeoutMs: 6000,
      maxBytes: 512 * 1024,
    });
  });

  it('caché de 8 s por liga@rango; una liga que falla reutiliza su última respuesta', async () => {
    let esp1Down = false;
    const { football, core, net } = harness({
      [ESPN_ESP1]: () => {
        if (esp1Down) throw new Error('ECONNRESET');
        return fixture('espn-esp1.json');
      },
    });
    await football.schedule();
    core.clock.set(Date.UTC(2026, 0, 1, 20, 30));
    const first = await football.legacyScores();
    const espnCalls = (): number =>
      net.calls.filter((call) => call.url.startsWith(ESPN_BASE)).length;
    const before = espnCalls();
    await football.legacyScores();
    expect(espnCalls()).toBe(before);
    esp1Down = true;
    core.clock.advance(SCORES_CACHE_MS);
    const second = await football.legacyScores();
    expect(espnCalls()).toBeGreaterThan(before);
    expect(second.scores).toEqual(first.scores);
  });

  it('un JSON roto de ESPN también cae a la última respuesta (o a nada)', async () => {
    const { football, core } = harness({ [ESPN_UCL]: 'no es json', [ESPN_ESP1]: '{"events":{}}' });
    await football.schedule();
    core.clock.set(Date.UTC(2026, 0, 1, 20, 30));
    const scores = await football.legacyScores();
    expect(scores.scores).toEqual({});
  });

  it('dos peticiones a la vez comparten la descarga de cada liga', async () => {
    const { football, core, net } = harness();
    await football.schedule();
    core.clock.set(Date.UTC(2026, 0, 1, 20, 30));
    await Promise.all([football.legacyScores(), football.legacyScores()]);
    expect(net.calls.filter((call) => call.url.startsWith(ESPN_UCL)).length).toBe(1);
  });

  it('sin agenda: `success: false` con 200 en la antigua y `available: false` en v1', async () => {
    const { football } = createFootball();
    const legacy = await getLiveScores(football);
    expect(legacy).toEqual({ success: false, error: 'sin_agenda', scores: {} });
    expect(LegacyScoresResponseSchema.parse(legacy)).toEqual(legacy);
    const v1 = await football.scores();
    expect(v1).toEqual({
      available: false,
      generatedAt: null,
      source: 'espn',
      attribution: null,
      leagues: 0,
      scores: {},
    });
    expect(ScoresResponseSchema.parse(v1)).toEqual(v1);
  });

  it('v1 con marcadores: `available: true` y la atribución (null sin partidos en ventana)', async () => {
    const { football, core } = harness();
    expect(await football.scores()).toMatchObject({
      available: true,
      attribution: null,
      leagues: 0,
    });
    core.clock.set(Date.UTC(2026, 0, 1, 20, 30));
    const v1 = await football.scores();
    expect(ScoresResponseSchema.parse(v1)).toEqual(v1);
    expect(v1).toMatchObject({ available: true, attribution: 'ESPN', leagues: 3 });
    expect(Object.keys(v1.scores)).toHaveLength(2);
  });

  it('la poda del servicio corre en su temporizador de 60 s', async () => {
    const { football, core } = harness();
    await football.start();
    const cache = football.scoresCacheMap();
    cache.set(`esp.1@${RANGE}`, { payload: [], expiresAt: core.clock.now(), pending: null });
    core.clock.advance(SCORES_CACHE_STALE_MS + 60_000);
    expect(cache.size).toBe(0);
    await football.stop();
    await football.stop();
  });

  it('el rango de ESPN va de ayer a mañana en su fecha (UTC)', () => {
    expect(espnDateRange(Date.UTC(2026, 0, 1, 12))).toBe(RANGE);
  });

  it('la fachada sin servicio no puede dar marcadores', async () => {
    await expect(getLiveScores()).rejects.toMatchObject({ code: 'not_implemented' });
  });
});

/* Verificación del backend (23-09-2026): el ±45 min de deriva, el "uno de los
   dos equipos tiene que casar claro" y el tope de 8 ligas de B-128/B-130/B-131
   solo se veían a través del fixture de ESPN, que siempre casa. Aquí se prueban
   los bordes con eventos hechos a mano sobre `computeLiveScores`
   (server.js:2276-2337). */
describe('computeLiveScores: deriva de ±45 min, ancla de 0,6 y tope de 8 ligas (B-130, B-131)', () => {
  const SAQUE = Date.UTC(2026, 0, 1, 20, 0);
  const evento = (start: number, home: string, away: string, score = ['2', '1']) => ({
    date: new Date(start).toISOString(),
    status: { displayClock: "30'", type: { state: 'in', shortDetail: "30'" } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: score[0], team: { displayName: home } },
          { homeAway: 'away', score: score[1], team: { displayName: away } },
        ],
      },
    ],
  });
  const agenda = (matches: Record<string, unknown>[]) => ({
    days: [{ date: '2026-01-01', matches }],
  });
  function contexto(events: Record<string, unknown[]>) {
    const pedidas: string[] = [];
    const ctx = {
      cache: new Map(),
      now: () => SAQUE + 30 * MIN,
      nowIso: () => new Date(SAQUE + 30 * MIN).toISOString(),
      fetchText: async (url: string) => {
        pedidas.push(url);
        const liga = /soccer\/([^/]+)\/scoreboard/.exec(url)?.[1] ?? '';
        return JSON.stringify({ events: events[liga] ?? [] });
      },
    };
    return { ctx, pedidas };
  }

  it('un evento a 44 min del saque casa; a 46 min, no (es otro partido)', async () => {
    const partido = {
      id: 'm1',
      home: 'Real Madrid',
      away: 'Sevilla',
      competition: 'LaLiga',
      start: SAQUE,
    };
    const cerca = contexto({ 'esp.1': [evento(SAQUE + 44 * MIN, 'Real Madrid', 'Sevilla')] });
    const lejos = contexto({ 'esp.1': [evento(SAQUE - 46 * MIN, 'Real Madrid', 'Sevilla')] });
    expect((await computeLiveScores(cerca.ctx, agenda([partido]))).scores).toHaveProperty('m1');
    expect((await computeLiveScores(lejos.ctx, agenda([partido]))).scores).toEqual({});
  });

  it('dos parecidos flojos no valen: al menos un equipo tiene que casar con 0,6', async () => {
    const partido = {
      id: 'm2',
      home: 'Real Madrid',
      away: 'Real Betis',
      competition: 'LaLiga',
      start: SAQUE,
    };
    // "Real Sociedad"/"Real Oviedo" comparten solo "Real" con cada uno: 0,5 los
    // dos. La media (0,5) SÍ llega al mínimo de 0,5, así que lo único que lo
    // descarta es el ancla de 0,6 (server.js:2315).
    const flojo = contexto({ 'esp.1': [evento(SAQUE, 'Real Sociedad', 'Real Oviedo')] });
    expect(teamSimilarity('Real Madrid', 'Real Sociedad')).toBe(0.5);
    expect(teamSimilarity('Real Betis', 'Real Oviedo')).toBe(0.5);
    expect((await computeLiveScores(flojo.ctx, agenda([partido]))).scores).toEqual({});
    // Con un equipo claro (1) y el otro flojo (0,5) sí casa, con confianza 0,75.
    const claro = contexto({ 'esp.1': [evento(SAQUE, 'Real Madrid', 'Real Oviedo')] });
    expect((await computeLiveScores(claro.ctx, agenda([partido]))).scores).toMatchObject({
      m2: { home: 2, away: 1, confidence: 0.75 },
    });
  });

  it('la deriva de 45 min exactos todavía casa (el corte es "más de 45")', async () => {
    const partido = {
      id: 'm3',
      home: 'Real Madrid',
      away: 'Sevilla',
      competition: 'LaLiga',
      start: SAQUE,
    };
    const justo = contexto({ 'esp.1': [evento(SAQUE - 45 * MIN, 'Real Madrid', 'Sevilla')] });
    expect((await computeLiveScores(justo.ctx, agenda([partido]))).scores).toHaveProperty('m3');
  });

  it('como mucho 8 ligas por consulta, en el orden en que aparecen', async () => {
    const competiciones = [
      'LaLiga',
      'LaLiga Hypermotion',
      'Copa del Rey',
      'Premier League',
      'Championship',
      'Serie A Italiana',
      'Bundesliga',
      'Ligue 1',
      'Eredivisie',
    ];
    const partidos = competiciones.map((competition, index) => ({
      id: `m${index}`,
      home: `Local ${index}`,
      away: `Visitante ${index}`,
      competition,
      start: SAQUE,
    }));
    const { ctx, pedidas } = contexto({});
    const result = await computeLiveScores(ctx, agenda(partidos));
    expect(result).toMatchObject({ success: true, leagues: 8 });
    expect(pedidas).toHaveLength(8);
    expect(pedidas.some((url) => url.includes('/ned.1/'))).toBe(false);
  });
});
