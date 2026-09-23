/* Contraste con la 0.6.59 ORIGINAL (plan E1.4): las mismas entradas contra
   el server.js de la release y contra la fachada de este módulo. Lo que la
   v2 cambia a propósito (ids estables, `start` en todas las fuentes) está en
   el servicio, no en la fachada, así que aquí todo tiene que ser igual. */

import { describe, expect, it } from 'vitest';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import * as v2 from './legacy-exports.js';
import { fixture, makeState, withStreams } from './test-support.js';

type AnyFn = (...args: never[]) => unknown;
const original = loadLegacyServer() as unknown as Record<string, AnyFn>;

function call<T = unknown>(name: string, ...args: unknown[]): T {
  const fn = original[name] as unknown as (...values: unknown[]) => T;
  if (typeof fn !== 'function') throw new Error(`la 0.6.59 no exporta ${name}`);
  return fn(...args);
}

const CHANNELS = [
  'M+ Liga de Campeones',
  'M+ Liga de Campeones 2',
  'M+ LALIGA',
  'M+ LALIGA HDR',
  'DAZN',
  'DAZN 1',
  'DAZN LaLiga',
  'DAZN LaLiga 2',
  'DAZN App Gratis',
  'LaLiga TV Bar',
  'LaLiga TV Hypermotion',
  'GOL Play',
  'Movistar Plus+',
  'Eurosport 1',
  'La 1 HD',
  '',
  '***',
];

const NAMES = [
  'M+ Liga de Campeones 1080p *',
  'LIGA DE CAMPEONES FHD → NEW ERA',
  'M. Liga de Campeones -> ELCANO',
  'LIGA DE CAMPEONES 2 --> ELCANO',
  'M+ LALIGA --> NEW ERA',
  'DAZN 1 720p',
  'DAZN 2',
  'DAZN LaLiga 1080p',
  'HYPERMOTION --> ELCANO',
  'LaLiga TV Bar HD',
  'GOL Play HD',
  'Eurosport 2',
  'UCL Principal --> ELCANO',
  'Canal cualquiera',
];

const hash = (index: number): string => (index + 1).toString(16).padStart(40, '0');

describe('Contraste con la 0.6.59: agenda', () => {
  it('parseFutbolEnLaTv con y sin ventana', () => {
    const html = fixture('futbolenlatv.html');
    for (const window of [null, new Set(['2026-01-01']), new Set(['2026-01-02', '2026-02-15'])]) {
      expect(v2.parseFutbolEnLaTv(html, window)).toEqual(call('parseFutbolEnLaTv', html, window));
    }
  });

  it('decodeHtml, epgSplitTeams y madridDateTime', () => {
    const texts = [
      'Fenerbah&#231;e',
      'Atl&eacute;tico &amp; Co',
      '&#x41;&unknown; &lt;b&gt;',
      '  espacios   raros  ',
      'Sevilla - Rayo',
      'Espanyol – Real Madrid',
      'A — B',
      'Real Sociedad B',
      'Uno - Dos - Tres',
      ' - B',
      '',
    ];
    for (const text of texts) {
      expect(v2.decodeHtml(text)).toBe(call('decodeHtml', text));
      expect(v2.epgSplitTeams(text)).toEqual(call('epgSplitTeams', text));
    }
    const dates = ['2026-08-17', '2026-01-17', '2026-03-29', '2026-10-25', 'no-fecha', ''];
    const times = ['19:30:00', '22:30', '0:05', '23:59:59', '24:00', '12:60', '', 'x'];
    for (const date of dates) {
      for (const time of times) {
        expect(v2.madridDateTime(date, time)).toEqual(call('madridDateTime', date, time));
      }
    }
  });

  it('normalizeFootballRows con filas generadas', () => {
    const rows = [];
    for (let index = 0; index < 60; index += 1) {
      rows.push({
        idEvent: index % 7 === 0 ? '' : String(9000 + (index % 13)),
        strSport: ['Soccer', 'Basketball', 'football', undefined][index % 4],
        strEvent: ['Barcelona vs Valencia', 'Madrid v Betis', 'Sin separador', ''][index % 4],
        strLeague: index % 3 ? 'LaLiga' : undefined,
        dateEvent: ['2026-08-16', '2026-01-10', 'mal'][index % 3],
        strTime: ['21:30:00', '23:15', '', '07:00'][index % 4],
        idChannel: String(index),
        strChannel: CHANNELS[index % CHANNELS.length],
        strCountry: index % 5 ? 'Spain' : '',
      });
    }
    expect(v2.normalizeFootballRows(rows)).toEqual(call('normalizeFootballRows', rows));
    expect(v2.normalizeFootballRows('nada')).toEqual(call('normalizeFootballRows', 'nada'));
  });

  it('normalizeEpgAirings con emisiones generadas', () => {
    const base = Date.UTC(2026, 7, 22, 14);
    const airings = Array.from({ length: 40 }, (_, index) => {
      const start = base + (index % 9) * 37 * 60_000;
      return {
        channel: { id: `C${index % 4}`, name: CHANNELS[index % 5] },
        start,
        date: index % 2 ? '2026-08-22' : '2026-08-23',
        time: new Date(start).toISOString().slice(11, 16),
        row: {
          ShowId: index % 3 ? index : undefined,
          Titulo: ['LALIGA', 'LIGA DE CAMPEONES', ''][index % 3],
        },
        ...(index % 4
          ? {
              detail: {
                teams: ['Sevilla - Rayo', 'Madrid - City', ''][index % 3],
                competition: index % 2 ? 'Liga' : '',
              },
            }
          : {}),
      };
    });
    const input = airings as unknown as Parameters<typeof v2.normalizeEpgAirings>[0];
    expect(v2.normalizeEpgAirings(input)).toEqual(call('normalizeEpgAirings', airings));
  });

  it('buildFootballDemoSchedule y footballProgramChannelNames', () => {
    for (const date of ['2026-08-19', '2026-12-30', '2027-02-27']) {
      const mine = v2.buildFootballDemoSchedule(date);
      const theirs = call<Record<string, unknown>>('buildFootballDemoSchedule', date);
      expect({ ...mine, generatedAt: '' }).toEqual({ ...theirs, generatedAt: '' });
      expect(v2.footballProgramChannelNames(mine)).toEqual(
        call('footballProgramChannelNames', theirs),
      );
    }
  });

  it('enrichFootballLeagues con el mismo `lookup`', async () => {
    const make = () =>
      Array.from({ length: 50 }, (_, index) => ({
        id: index % 6 ? String(index) : `x${index}`,
        competition: index % 5 ? 'Fútbol' : 'LaLiga',
      }));
    const lookup = async (id: string): Promise<string> => {
      if (Number(id) % 4 === 0) throw new Error('caido');
      return Number(id) % 3 ? `Liga ${id}` : '';
    };
    expect(await v2.enrichFootballLeagues(make(), lookup)).toEqual(
      await call<Promise<unknown>>('enrichFootballLeagues', make(), lookup),
    );
  });
});

describe('Contraste con la 0.6.59: marcadores', () => {
  const teams = [
    'Fenerbahçe',
    'Fenerbahce SK',
    'O. Lyonnais',
    'Olympique Lyonnais',
    'Lyon',
    'B. Dortmund',
    'Borussia Dortmund',
    'Inter de Milán',
    'Internazionale',
    'Real Madrid',
    'Real Sociedad',
    'Athletic Club',
    'Atlético de Madrid',
    'PSG',
    'Paris Saint-Germain',
    '',
  ];

  it('teamSimilarity, canonicalTeam y bestTeamSimilarity en toda la matriz', () => {
    for (const a of teams) {
      expect(v2.canonicalTeam(a)).toBe(call('canonicalTeam', a));
      for (const b of teams) {
        expect(v2.teamSimilarity(a, b)).toBe(call('teamSimilarity', a, b));
        const side = { displayName: b, shortDisplayName: b.slice(0, 5), name: a };
        expect(v2.bestTeamSimilarity(a, side)).toBe(call('bestTeamSimilarity', a, side));
      }
    }
  });

  it('espnLeaguesFor, readEspnEvent y matchIsInScoreWindow', () => {
    for (const competition of ['La Liga EA Sports', '  Champions League ', 'MLS', 'Nada', '']) {
      expect(v2.espnLeaguesFor(competition)).toEqual(call('espnLeaguesFor', competition));
    }
    const events = JSON.parse(fixture('espn-uefa-champions.json')).events as unknown[];
    for (const event of [...events, {}, { competitions: [] }]) {
      const mine = v2.readEspnEvent(event);
      const theirs = call('readEspnEvent', event);
      expect(mine).toEqual(theirs);
    }
    const saque = Date.UTC(2026, 7, 18, 19);
    for (let offset = -30; offset <= 240; offset += 5) {
      const now = saque + offset * 60_000;
      expect(v2.matchIsInScoreWindow({ start: saque }, now)).toBe(
        call('matchIsInScoreWindow', { start: saque }, now),
      );
    }
  });
});

describe('Contraste con la 0.6.59: resolución, IA y precalentado', () => {
  it('resolutionChannels y aceSearchQueries', () => {
    for (let size = 0; size < CHANNELS.length; size += 1) {
      const list = [...CHANNELS.slice(size), ...CHANNELS.slice(0, size)];
      expect(v2.resolutionChannels(list)).toEqual(call('resolutionChannels', list));
      for (const semantic of [false, true]) {
        expect(v2.aceSearchQueries(list, semantic)).toEqual(
          call('aceSearchQueries', list, semantic),
        );
      }
    }
    expect(v2.resolutionChannels('DAZN')).toEqual(call('resolutionChannels', 'DAZN'));
  });

  it('scoreResolutionCandidate en la matriz canal × nombre (con y sin alias)', () => {
    for (let a = 0; a < CHANNELS.length; a += 1) {
      const channels = [CHANNELS[a]!, CHANNELS[(a + 3) % CHANNELS.length]!].filter(Boolean);
      NAMES.forEach((title, index) => {
        const item = {
          id: hash(index),
          title,
          alias: index % 3 ? NAMES[(index + 5) % NAMES.length] : undefined,
          ih: index % 2 === 0,
          listaId: index % 4 ? 'lista' : undefined,
          availability: index % 5 ? index / 10 : undefined,
        };
        expect(v2.scoreResolutionCandidate(channels, item, 'm3u')).toEqual(
          call('scoreResolutionCandidate', channels, item, 'm3u'),
        );
      });
    }
  });

  it('semanticScore, cosineSimilarity y footballPreheatStage', () => {
    for (let similarity = 0.8; similarity <= 1; similarity += 0.005) {
      expect(v2.semanticScore(similarity)).toBe(call('semanticScore', similarity));
    }
    const vectors = [[1, 0], [0, 1], [1, 1], [0, 0], [1], [1, 'x'], null, [3, 4, 5]];
    for (const left of vectors) {
      for (const right of vectors) {
        expect(v2.cosineSimilarity(left, right)).toBe(call('cosineSimilarity', left, right));
      }
    }
    const kickoff = Date.UTC(2026, 0, 1, 20);
    for (let offset = -130; offset <= 50; offset += 1) {
      const now = kickoff + offset * 60_000;
      expect(v2.footballPreheatStage(kickoff, now)).toBe(
        call('footballPreheatStage', kickoff, now),
      );
    }
  });

  it('applySemanticCandidateScores con el mismo embedding', async () => {
    const embed = async (texts: string[]): Promise<number[][]> =>
      texts.map((text) => {
        const code = [...text].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
        if (/campeones|ucl/.test(text)) return [1, 0.02 * (code % 5), 0];
        if (/laliga|hypermotion/.test(text)) return [0, 1, 0.01 * (code % 7)];
        return [0.1 * (code % 3), 0, 1];
      });
    const candidates = NAMES.map((title, index) => ({
      id: hash(index),
      title,
      alias: index % 4 ? null : 'UCL HD',
      score: (index * 7) % 100,
      source: 'm3u',
      soloFamilia: index % 2 === 0,
    }));
    for (const requested of [['M+ Liga de Campeones'], ['M+ LALIGA'], ['DAZN'], ['GOL Play']]) {
      const program = ['M+ Liga de Campeones', 'M+ LALIGA', 'LaLiga TV Hypermotion', 'DAZN 1'];
      const mine = await v2.applySemanticCandidateScores(requested, candidates, program, {
        enabled: true,
        embed,
        cache: new Map(),
      });
      const theirs = await call<Promise<unknown>>(
        'applySemanticCandidateScores',
        requested,
        candidates,
        program,
        { enabled: true, embed, cache: new Map() },
      );
      expect(mine).toEqual(theirs);
    }
  });

  it('resolveFootballChannel con el mismo estado y el mismo buscador', async () => {
    const states = [
      makeState(),
      withStreams(NAMES.map((title, index) => ({ id: hash(index), title }))),
      withStreams(
        NAMES.slice(0, 6).map((title, index) => ({ id: hash(index), title })),
        {
          channelBindings: [
            {
              channel: 'DAZN',
              channelKey: 'dazn',
              id: hash(40),
              title: 'DAZN 1 720p',
              ih: false,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          favorites: [],
          history: [],
        },
      ),
    ];
    const search = async (query: string) =>
      /dazn/i.test(query)
        ? [
            { id: hash(30), title: 'DAZN Eventos', ih: true, availability: 30 },
            { id: hash(31), title: 'DAZN 1 --> PUBLIC', ih: true, availability: 0 },
          ]
        : [{ id: hash(32), title: `${query} --> PUBLIC`, ih: true, availability: 0.5 }];
    const requests = [
      ['M+ Liga de Campeones'],
      ['DAZN'],
      ['DAZN LaLiga', 'DAZN', 'LaLiga TV Bar'],
      ['M+ LALIGA', 'M+ LALIGA HDR', 'DAZN', 'DAZN App Gratis'],
      ['GOL Play', 'Eurosport 1'],
    ];
    for (const state of states) {
      for (const channels of requests) {
        for (const mode of ['default', 'research'] as const) {
          const options = { mode, semantic: { enabled: false } };
          const mine = await v2.resolveFootballChannel(state, channels, search, options);
          const theirs = await call<Promise<unknown>>(
            'resolveFootballChannel',
            structuredClone(state),
            channels,
            search,
            options,
          );
          expect(mine).toEqual(theirs);
        }
      }
    }
  });
});
