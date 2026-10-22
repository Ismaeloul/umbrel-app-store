/* La resolución con la tubería única de nombres (docs/iptv.md §4.8): lo que
   el servicio hace desde la 0.9.9 y la fachada antigua NO (la matriz 0.6.59
   sigue congelada en `legacy-exports`). Los nombres son los de la agenda y
   las listas de Isma del 2026-10-22. */

import { describe, expect, it } from 'vitest';
import { RESOLUTION_EXACT_SCORE, type ResolutionCandidate } from '@ace/shared';
import {
  applySemanticCandidateScores,
  asVectorStore,
  unavailableEmbedder,
  type SemanticOptions,
} from './ai.js';
import {
  CANONICAL_MATCHER,
  CLASSIC_MATCHER,
  SEMANTIC_ALLOW,
  resolutionChannels,
  resolveFootballChannel,
  scoreResolutionCandidate,
  type BaseCandidate,
  type ResolutionIptv,
  type ResolvableItem,
  type ResolveDeps,
} from './resolution.js';
import { ID_A, ID_B, ID_C, withStreams } from './test-support.js';

const ID_D = 'd'.repeat(40);
const ID_E = 'e'.repeat(40);
const ID_F = 'f'.repeat(40);
const IPTV_1 = '1'.repeat(40);
const IPTV_2 = '2'.repeat(40);
const IPTV_3 = '3'.repeat(40);
const IPTV_4 = '4'.repeat(40);
const IPTV_5 = '5'.repeat(40);

const library = withStreams([
  { id: ID_A, title: 'M+ LALIGA --> ELCANO', alias: 'M+ LaLiga HD' },
  { id: ID_B, title: 'MOVISTAR VAMOS --> ELCANO' },
  { id: ID_C, title: 'DAZN 1 BAR FHD --> NEW ERA' },
  { id: ID_D, title: 'M+ LALIGA 2 --> ELCANO' },
  { id: ID_E, title: 'ESPORT 3 FHD --> NEW ERA' },
]);

function deps(overrides: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    search: async () => [],
    applyLearned: (_channels, candidates) =>
      candidates.map((candidate) => ({
        ...candidate,
        learned: false,
        reported: false,
        rejectedByLearning: false,
        quarantined: false,
      })) as unknown as ResolutionCandidate[],
    refreshLists: () => {},
    semantic: { enabled: false, cache: asVectorStore(new Map()), embed: unavailableEmbedder },
    model: 'none',
    programChannels: [],
    matcher: CANONICAL_MATCHER,
    ...overrides,
  };
}

const ids = (candidates: readonly { id: string }[]): string[] => candidates.map((c) => c.id);

describe('la tubería única en la biblioteca', () => {
  it.each([
    ['M+ LALIGA HDR', ID_A],
    ['M+ #Vamos Bar', ID_B],
    ['DAZN 1', ID_C],
    ['DAZN 1 Bar', ID_C],
    ['LaLiga TV M2', ID_D],
    ['M+ LALIGA HDR 2', ID_D],
    ['Esport3', ID_E],
  ])('%s arranca %s', async (channel, id) => {
    const result = await resolveFootballChannel(library, [channel], deps());
    expect(result.status).toBe('found');
    expect(result.candidate?.id).toBe(id);
    expect(result.candidate?.score).toBeGreaterThanOrEqual(RESOLUTION_EXACT_SCORE);
  });

  it('cada tag busca solo lo suyo: «LaLiga TV Bar» no trae M+ LALIGA ni DAZN LaLiga', async () => {
    const result = await resolveFootballChannel(library, ['LaLiga TV Bar'], deps());
    expect(result.status).toBe('not_found');
    expect(ids(result.candidates)).toEqual([]);
    /* Con un canal que se llame así, sí (y con sus grafías). */
    const conBar = withStreams([
      { id: ID_A, title: 'M+ LALIGA --> ELCANO' },
      { id: ID_F, title: 'M+ LALIGA TV BAR FHD --> NEW ERA' },
    ]);
    const found = await resolveFootballChannel(conBar, ['LaLiga TV Bar'], deps());
    expect(ids(found.candidates)).toEqual([ID_F]);
  });

  it('con varios tags se buscan todos y cada uno trae lo suyo', async () => {
    const result = await resolveFootballChannel(
      library,
      ['DAZN LaLiga', 'DAZN', 'LaLiga TV Bar', 'M+ #Vamos Bar'],
      deps(),
    );
    const porCanal = new Map<string, string[]>();
    for (const candidate of result.candidates) {
      porCanal.set(candidate.matchedChannel, [
        ...(porCanal.get(candidate.matchedChannel) ?? []),
        candidate.id,
      ]);
    }
    expect(porCanal.get('M+ #Vamos Bar')).toEqual([ID_B]);
    expect(porCanal.get('DAZN')).toEqual([ID_C]);
    expect(porCanal.has('LaLiga TV Bar')).toBe(false);
    expect(ids(result.candidates)).not.toContain(ID_A);
  });

  it('con el canal exacto, la hermana numerada no entra (M+ LALIGA no trae M+ LALIGA 2)', async () => {
    const result = await resolveFootballChannel(library, ['M+ LALIGA HDR'], deps());
    expect(ids(result.candidates)).toEqual([ID_A]);
  });

  it('LaLiga TV M2 no es M+ LALIGA (diales distintos)', async () => {
    const result = await resolveFootballChannel(library, ['LaLiga TV M2'], deps());
    expect(ids(result.candidates)).toEqual([ID_D]);
  });

  it('la fachada antigua sigue con el clásico: «LaLiga TV M2» no era «M+ LALIGA 2»', () => {
    const item = { id: ID_D, title: 'M+ LALIGA 2 --> ELCANO' };
    expect(scoreResolutionCandidate(['LaLiga TV M2'], item, 'm3u').score).toBe(0);
    expect(scoreResolutionCandidate(['LaLiga TV M2'], item, 'm3u', CLASSIC_MATCHER).score).toBe(0);
    expect(scoreResolutionCandidate(['LaLiga TV M2'], item, 'm3u', CANONICAL_MATCHER).score).toBe(
      100,
    );
  });
});

describe('canales pedidos y consultas al motor', () => {
  it('resolutionChannels junta «M+ LALIGA» y «M+ LALIGA HDR»; «LaLiga TV Bar» es otro canal', () => {
    expect(
      resolutionChannels(['M+ LALIGA', 'M+ LALIGA HDR', 'LaLiga TV Bar'], CANONICAL_MATCHER),
    ).toEqual(['M+ LALIGA', 'LaLiga TV Bar']);
    expect(resolutionChannels(['LaLiga TV Bar', 'M+ LALIGA 2'], CANONICAL_MATCHER)).toEqual([
      'LaLiga TV Bar',
      'M+ LALIGA 2',
    ]);
    /* El clásico, como siempre (la fachada antigua y el contraste con la 0.6.59). */
    expect(resolutionChannels(['M+ LALIGA', 'LaLiga TV Bar'])).toEqual([
      'M+ LALIGA',
      'LaLiga TV Bar',
    ]);
  });

  it('el buscador recibe también el nombre canónico y sus resultados con enlaces puntúan', async () => {
    const queries: string[] = [];
    const result = await resolveFootballChannel(
      withStreams([]),
      ['LaLiga TV M2'],
      deps({
        search: async (query): Promise<readonly ResolvableItem[]> => {
          queries.push(query);
          return [
            {
              id: ID_F,
              title: 'M+ LALIGA 2 elcano.top https://x.com/ace_stream_ https://t.me/acestreamf1',
              availability: 1,
            },
          ];
        },
      }),
    );
    expect(queries).toContain('LaLiga TV M2');
    expect(queries).toContain('LaLiga TV 2');
    expect(result.status).toBe('found');
    expect(result.candidate?.id).toBe(ID_F);
    expect(result.candidate?.source).toBe('acestream');
    expect(result.candidate?.score).toBe(100);
  });
});

describe('la IA no levanta otro producto de la misma marca', () => {
  /* Un embed que confunde a propósito: todo lo que lleva «dazn» cae en el mismo vector. */
  const embed = async (texts: string[]): Promise<number[][]> =>
    texts.map((text) =>
      /dazn/.test(text) ? [1, 0] : /campeones|ucl/.test(text) ? [0, 1] : [0.5, 0.5],
    );
  const semantic = (allow?: SemanticOptions['allow']) => ({
    enabled: true,
    cache: asVectorStore(new Map()),
    embed,
    ...(allow ? { allow } : {}),
  });
  const candidates = [
    { title: 'DAZN F1 --> ELCANO', alias: null, score: 58 },
    { title: 'DAZN Baloncesto SDp *', alias: null, score: 58 },
    { title: 'UCL Principal --> ELCANO', alias: null, score: 0 },
  ];

  it('sin la guarda (la 0.6.59) promociona DAZN F1 por «DAZN»', async () => {
    const result = await applySemanticCandidateScores(
      ['DAZN'],
      candidates,
      ['DAZN', 'M+ LALIGA'],
      semantic(),
    );
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(70);
  });

  it('con la guarda del servicio, DAZN F1 y DAZN Baloncesto se quedan en 58; «UCL Principal» sí se rescata', async () => {
    const result = await applySemanticCandidateScores(
      ['DAZN', 'M+ Liga de Campeones'],
      candidates,
      ['DAZN', 'M+ Liga de Campeones', 'M+ LALIGA'],
      semantic(SEMANTIC_ALLOW),
    );
    expect(result.candidates.map((candidate) => candidate.score)).toEqual([
      58,
      58,
      expect.any(Number),
    ]);
    const rescued = result.candidates[2] as { score: number; matchedChannel?: string };
    expect(rescued.score).toBeGreaterThanOrEqual(70);
    expect(rescued.matchedChannel).toBe('M+ Liga de Campeones');
  });
});

describe('el tope de 4 carteles IPTV se reparte por canal pedido', () => {
  function iptvCandidate(id: string, title: string, matchedChannel: string): BaseCandidate {
    return {
      id,
      title: `${title} --> Iptv`,
      alias: null,
      ih: false,
      source: 'iptv',
      score: 100,
      matchedChannel,
      soloFamilia: false,
      familyFallbackAllowed: false,
      listaId: 'iptv',
      availability: null,
      bitrate: null,
      iptv: { provider: 'Iptv', quality: null, backup: false, guide: false, channel: title },
    } as BaseCandidate;
  }

  const iptvIds = new Set([IPTV_1, IPTV_2, IPTV_3, IPTV_4, IPTV_5]);
  const layer: ResolutionIptv = {
    resolve: () => ({
      candidates: [
        iptvCandidate(IPTV_1, 'M+: DAZN 2', 'DAZN 2'),
        iptvCandidate(IPTV_2, 'DAZN 2', 'DAZN 2'),
        iptvCandidate(IPTV_3, 'DAZN 2', 'DAZN 2'),
        iptvCandidate(IPTV_4, 'DAZN 2', 'DAZN 2'),
        iptvCandidate(IPTV_5, 'VAMOS 2', 'M+ Vamos 2'),
      ],
      hints: [],
      consulted: true,
    }),
    classify: (id) => (iptvIds.has(id) ? 'owned' : 'engine'),
    convert: () => null,
    tapped: () => [],
    sameChannel: () => 0,
  };

  it('«VAMOS 2» conserva su cartel aunque «DAZN 2» tenga cuatro', async () => {
    const result = await resolveFootballChannel(
      withStreams([]),
      ['DAZN', 'M+ Vamos 2', 'DAZN 2', 'DAZN 2 Bar'],
      deps({ iptv: layer }),
    );
    const iptv = result.candidates.filter((candidate) => candidate.source === 'iptv');
    expect(iptv).toHaveLength(4);
    expect(ids(iptv)).toContain(IPTV_5);
    expect(ids(iptv)).toContain(IPTV_1);
  });
});
