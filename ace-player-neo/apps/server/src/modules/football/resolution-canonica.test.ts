/* La resolución con la tubería única de nombres (docs/iptv.md §4.8): lo que
   el servicio hace desde la 0.9.9 y la fachada antigua NO (la matriz 0.6.59
   sigue congelada en `legacy-exports`). Los nombres son los de la agenda y
   las listas de Isma del 2026-10-22. */

import { describe, expect, it } from 'vitest';
import { RESOLUTION_EXACT_SCORE, type ResolutionCandidate } from '@ace/shared';
import { asVectorStore, unavailableEmbedder } from './ai.js';
import {
  CANONICAL_MATCHER,
  CLASSIC_MATCHER,
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
    ['LaLiga TV Bar', ID_A],
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

  it('con el canal exacto, la hermana numerada no entra (LaLiga TV Bar no trae M+ LALIGA 2)', async () => {
    const result = await resolveFootballChannel(library, ['LaLiga TV Bar'], deps());
    expect(ids(result.candidates)).toEqual([ID_A]);
  });

  it('LaLiga TV M2 no es M+ LALIGA (diales distintos)', async () => {
    const result = await resolveFootballChannel(library, ['LaLiga TV M2'], deps());
    expect(ids(result.candidates)).toEqual([ID_D]);
  });

  it('la fachada antigua sigue con el clásico: «LaLiga TV Bar» no era «M+ LALIGA»', () => {
    const item = { id: ID_A, title: 'M+ LALIGA --> ELCANO' };
    expect(scoreResolutionCandidate(['LaLiga TV Bar'], item, 'm3u').score).toBeLessThan(70);
    expect(
      scoreResolutionCandidate(['LaLiga TV Bar'], item, 'm3u', CLASSIC_MATCHER).score,
    ).toBeLessThan(70);
    expect(scoreResolutionCandidate(['LaLiga TV Bar'], item, 'm3u', CANONICAL_MATCHER).score).toBe(
      100,
    );
  });
});

describe('canales pedidos y consultas al motor', () => {
  it('resolutionChannels junta «M+ LALIGA», «M+ LALIGA HDR» y «LaLiga TV Bar» en uno', () => {
    expect(
      resolutionChannels(['M+ LALIGA', 'M+ LALIGA HDR', 'LaLiga TV Bar'], CANONICAL_MATCHER),
    ).toEqual(['M+ LALIGA']);
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
