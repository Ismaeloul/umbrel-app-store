/* Buscador «como Google» en la IPTV (docs/iptv.md §20): erratas, alias,
   prefijos y «Quizás quisiste decir» en `searchCatalog` (lo que responde
   /api/v1/iptv/channels) y en la pestaña IPTV (`browseIndex`); lo que NO debe
   casar; el emparejado automático sigue SIN erratas ni alias; y 30 000
   canales en menos de 50 ms. Lista sintética con la forma de la real. */

import { describe, expect, it } from 'vitest';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { bigCatalog } from '../../../test/fake-iptv/catalogo-grande.js';
import { browseIndex, buildBrowseIndex } from './browse.js';
import { Catalog, type RawChannel } from './catalog.js';
import { matchIptvChannels, type ChannelScorer } from './match.js';
import { libraryCandidates, searchCatalog, suggestCatalog } from './search.js';

const scorer: ChannelScorer = (channels, item) => scoreResolutionCandidate(channels, item, 'iptv');

let seq = 0;
function raw(title: string, group: string): RawChannel {
  seq += 1;
  return {
    id: seq.toString(16).padStart(40, '0'),
    title,
    group,
    tvgId: '',
    ref: String(seq),
    tvgShift: null,
    userAgent: null,
    referrer: null,
  };
}

const TDT = 'EU | ES | TDT ESPAÑA VIP';
const DEP = 'EU | ES | DEPORTES';
const MOV = 'EU | ES | MOVISTAR+';
const LISTA: readonly (readonly [string, string])[] = [
  ['LA 1', TDT],
  ['LA 2', TDT],
  ['ANTENA 3', TDT],
  ['TELECINCO', TDT],
  ['CUATRO', TDT],
  ['LA SEXTA', TDT],
  ['TELEDEPORTE', TDT],
  ['M. LALIGA', MOV],
  ['M. LALIGA 1', MOV],
  ['M. LALIGA 2', MOV],
  ['M. LIGA DE CAMPEONES 1', MOV],
  ['M. LIGA DE CAMPEONES 2', MOV],
  ['M. DEPORTES', MOV],
  ['DAZN 1', DEP],
  ['DAZN 2', DEP],
  ['DAZN F1', DEP],
  ['DAZN LaLIGA', DEP],
  ['LALIGA HYPERMOTION 1', DEP],
  ['LALIGA HYPERMOTION 2', DEP],
  ['1 FEDERACION (MOVISTAR+)', DEP],
  ['EUROSPORT 1', DEP],
  ['BEIN SPORTS Ñ FHD', DEP],
  ['R. MADRID TV', DEP],
  ['REAL SOCIEDAD TV', DEP],
  ['GETAFE TV', DEP],
  ['GIRONA TV', DEP],
  ['GOL PLAY', DEP],
  ['LIGA F TV', DEP],
  ['VIX 01 PPV : FIA FORMULA 2 CHAMPIONSHIP', 'AM | VIX'],
];
const cat = new Catalog(
  'p_Ab3dE5gH',
  1,
  'xtream',
  0,
  [],
  'ts',
  LISTA.map(([title, group]) => raw(title, group)),
);
const titles = (q: string): string[] => searchCatalog(cat, q).groups.map((g) => g.best.display);
const first = (q: string): string | undefined => titles(q)[0];

describe('erratas (§20)', () => {
  it.each([
    ['telecinko', 'TELECINCO'],
    ['telecinco', 'TELECINCO'],
    ['dasn 1', 'DAZN 1'],
    ['dazm 2', 'DAZN 2'],
    ['eurosprot', 'EUROSPORT 1'],
    ['antna 3', 'ANTENA 3'],
    ['teledeprote', 'TELEDEPORTE'],
    ['la sesta', 'LA SEXTA'],
    ['bein sprots', 'BEIN SPORTS'],
    ['m+ liga de campeone', 'M. LIGA DE CAMPEONES 1'],
    ['liga de campeonse', 'M. LIGA DE CAMPEONES 1'],
    ['movistar lalija', 'M. LALIGA'],
    ['laliga hypermotin', 'LALIGA HYPERMOTION 1'],
    ['real madrid tb', 'R. MADRID TV'],
  ])('«%s» → %s', (q, title) => {
    expect(titles(q)).toContain(title);
  });

  it('con erratas va detrás de lo que casa sin ellas', () => {
    /* «champion» casa por el principio con CHAMPIONSHIP; la errata de «champions» (Liga de Campeones), detrás. */
    const found = titles('champion');
    expect(found[0]).toBe('VIX 01 PPV : FIA FORMULA 2 CHAMPIONSHIP');
    expect(found).toContain('M. LIGA DE CAMPEONES 1');
  });

  it('una palabra que casa exacta no se corrige: «getafe» no es «Gerona»', () => {
    expect(titles('getafe')).toEqual(['GETAFE TV']);
    expect(titles('girona')).toEqual(['GIRONA TV']);
  });
});

describe('alias (§20)', () => {
  it.each([
    ['t5', 'TELECINCO'],
    ['tele 5', 'TELECINCO'],
    ['la 6', 'LA SEXTA'],
    ['tdp', 'TELEDEPORTE'],
    ['rmtv', 'R. MADRID TV'],
    ['a3', 'ANTENA 3'],
    ['antena tres', 'ANTENA 3'],
    ['champions', 'M. LIGA DE CAMPEONES 1'],
    ['ucl', 'M. LIGA DE CAMPEONES 1'],
    ['movistar champions', 'M. LIGA DE CAMPEONES 1'],
    ['segunda division', 'LALIGA HYPERMOTION 1'],
    ['1 rfef', '1 FEDERACION (MOVISTAR+)'],
    ['formula uno', 'DAZN F1'],
  ])('«%s» → %s primero', (q, title) => {
    expect(first(q)).toBe(title);
  });

  it('lo que NO debe casar', () => {
    /* DAZN 1 frente a DAZN 2. */
    expect(titles('dazn 1')).not.toContain('DAZN 2');
    expect(titles('dasn 2')).not.toContain('DAZN 1');
    /* Real Madrid frente a Real Sociedad. */
    expect(titles('real madrid')).not.toContain('REAL SOCIEDAD TV');
    expect(titles('real sociedad')).not.toContain('R. MADRID TV');
    /* «Liga F» no es «LaLiga». */
    expect(titles('liga f')).toEqual(['LIGA F TV']);
    /* «Hypermotion» no es Primera, y «primera» no trae la Hypermotion. */
    expect(titles('hypermotion').every((t) => t.includes('HYPERMOTION'))).toBe(true);
    expect(titles('primera').some((t) => t.includes('HYPERMOTION'))).toBe(false);
  });

  it('«Quizás quisiste decir» solo si no sale nada (y con algo que sí sale)', () => {
    expect(searchCatalog(cat, 'telecinko').total).toBeGreaterThan(0);
    expect(searchCatalog(cat, 'tlcnco').total).toBe(0);
    expect(suggestCatalog(cat, 'tlcnco')).toBeNull();
    expect(searchCatalog(cat, 'eurspot').total).toBe(0);
    expect(suggestCatalog(cat, 'eurspot')).toBe('eurosport');
  });
});

describe('pestaña IPTV (§20)', () => {
  const index = buildBrowseIndex(cat);
  const browse = (q: string): string[] =>
    browseIndex(index, { q, offset: 0, limit: 50, withSummary: false }).rows.map(
      (row) => (index.best[row] as { display: string }).display,
    );
  it('erratas y alias también en la pestaña', () => {
    expect(browse('telecinko')[0]).toBe('TELECINCO');
    expect(browse('t5')[0]).toBe('TELECINCO');
    expect(browse('champions')).toContain('M. LIGA DE CAMPEONES 1');
    expect(browse('dasn 1')[0]).toBe('DAZN 1');
    expect(browse('dazn 1')).not.toContain('DAZN 2');
  });
});

describe('biblioteca (§20): el mismo filtro que la web', () => {
  const items = [
    { id: 'a'.repeat(40), title: 'Telecinco HD', category: 'TDT' },
    { id: 'b'.repeat(40), title: 'Mi DAZN 1', category: 'Deportes' },
    { id: 'c'.repeat(40), title: 'Telecinco', category: 'IPTV' },
  ];
  it('erratas, alias y la categoría IPTV solo con «ipt»', () => {
    expect(libraryCandidates(items, 'telecinko').map((i) => i.title)).toContain('Telecinco HD');
    expect(libraryCandidates(items, 't5').map((i) => i.title)).toContain('Telecinco HD');
    expect(libraryCandidates(items, 'tv').map((i) => i.title)).toEqual([]);
    expect(libraryCandidates(items, 'iptv').map((i) => i.title)).toEqual(['Telecinco']);
  });
});

describe('SEGURIDAD: el emparejado automático no usa erratas ni alias', () => {
  const names = (channels: string[]) =>
    matchIptvChannels(cat, channels, { scorer }).map((m) => m.best.display);
  it.each([
    ['Telecinko'],
    ['T5'],
    ['Tele 5'],
    ['La 6'],
    ['TDP'],
    ['RMTV'],
    ['Champions'],
    ['UCL'],
    ['Dasn 1'],
  ])('«%s» no empareja con nada (el buscador sí lo encuentra)', (channel) => {
    expect(names([channel])).toEqual([]);
    expect(searchCatalog(cat, channel).total).toBeGreaterThan(0);
  });
  it('lo de siempre sigue igual', () => {
    expect(names(['Telecinco'])).toEqual(['TELECINCO']);
    expect(names(['M+ Liga de Campeones'])).toEqual(['M. LIGA DE CAMPEONES 1']);
    expect(names(['DAZN 1'])).toEqual(['DAZN 1']);
  });
});

describe('@lento rendimiento (§20)', () => {
  it('30 000 canales: erratas, alias y prefijos en menos de 50 ms (índice ya montado)', () => {
    const big = bigCatalog(30_000 - LISTA.length);
    const categories = new Map(big.categories.map((c) => [c.id, c.name]));
    const huge = new Catalog('p_Ab3dE5gH', 2, 'xtream', 0, [], 'ts', [
      ...LISTA.map(([title, group]) => raw(title, group)),
      ...big.channels.map((c) => raw(c.name, categories.get(c.category) ?? c.category)),
    ]);
    searchCatalog(huge, 'calentar indice');
    const queries = [
      'telecinko',
      't5',
      'champions',
      'm+ liga de campeone',
      'dasn 1',
      'eurosprot',
      'la 6',
      'inglatera',
      'deportes',
      'canal 123',
    ];
    const times: number[] = [];
    for (const q of queries) {
      const start = performance.now();
      searchCatalog(huge, q);
      times.push(performance.now() - start);
    }
    const sorted = [...times].sort((a, b) => a - b);
    /* Con margen en la CI: la mediana por debajo de 50 ms (en este PC, 2-12 ms). */
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(50);
  });
});
