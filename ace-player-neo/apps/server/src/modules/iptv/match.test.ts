/* Emparejado IPTV ↔ canal (docs/iptv.md §4.3 y §4.4) con la MISMA función
   de la resolución (`scoreResolutionCandidate`) y un corpus de nombres
   reales de listas españolas (anonimizados, sin URLs). */

import { describe, expect, it } from 'vitest';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, type RawChannel } from './catalog.js';
import { matchIptvChannels, pickVariants, type ChannelScorer } from './match.js';

const scorer: ChannelScorer = (channels, item) => scoreResolutionCandidate(channels, item, 'iptv');

let seq = 0;
function raw(title: string, group = '', tvgId = ''): RawChannel {
  seq += 1;
  return {
    id: seq.toString(16).padStart(40, '0'),
    title,
    group,
    tvgId,
    ref: String(seq),
    tvgShift: null,
    userAgent: null,
    referrer: null,
  };
}

function catalog(titles: readonly (string | RawChannel)[]): Catalog {
  return new Catalog(
    'p_Ab3dE5gH',
    1,
    'xtream',
    0,
    [],
    'ts',
    titles.map((title) => (typeof title === 'string' ? raw(title) : title)),
  );
}

function names(list: ReturnType<typeof matchIptvChannels>): string[] {
  return list.map((match) => match.best.display);
}

/* Corpus: nombres como los de las listas de verdad (anonimizados). */
const CORPUS = [
  'ES: DAZN LaLiga FHD',
  'ES: DAZN LaLiga HD',
  'ES: DAZN LaLiga (Backup)',
  'ES: DAZN LaLiga HEVC',
  'ES: DAZN LA LIGA 2 FHD',
  'ES: M+ LaLiga TV FHD',
  'ES: M+ LaLiga TV 1 HD',
  'ES: M+ LaLiga TV 2 FHD',
  'ES: M+ LaLiga TV 3',
  'ES: LaLiga TV Hypermotion FHD',
  'ES: LaLiga TV Hypermotion 2',
  'ES: M+ Liga de Campeones FHD',
  'ES: M+ Liga de Campeones 1 FHD',
  'ES: M+ Liga de Campeones 2',
  'ES: Movistar Liga de Campeones 3 SD',
  'ES: DAZN 1 FHD',
  'ES: DAZN 2 FHD',
  'ES: DAZN F1 FHD',
  'ES: La 1 HD',
  'ES: La 2',
  'ES: Antena 3 FHD',
  'ES: Antena 3 Internacional',
  'ES: Telecinco HD',
  'ES: Cuatro',
  'ES: laSexta HD',
  'ES: M+ Vamos FHD',
  'ES: M+ Deportes',
  'ES: M+ Deportes 2',
  'ES: Eurosport 1',
  'ES: GOL PLAY',
  'ES: M+ LaLiga TV Bar',
  '|ES| TEN',
  'UK: Sky Sports Main Event',
  'UK: DAZN 1',
  'IT: DAZN 1 HD',
  'PT: Sport TV 1',
  'FR: Canal+ Sport',
  'DE: Sky Bundesliga 1',
];

describe('matchIptvChannels', () => {
  const cat = catalog(CORPUS);

  it('umbral 92: un canal por grupo, la mejor variante (FHD, no HEVC, no reserva)', () => {
    const [match, ...rest] = matchIptvChannels(cat, ['DAZN LaLiga'], { scorer });
    expect(rest.map((item) => item.best.display)).not.toContain('DAZN LaLiga');
    expect(match?.best.display).toBe('DAZN LaLiga');
    expect(match?.best.quality).toBe('fhd');
    expect(match?.best.hevc).toBe(false);
    expect(match?.score).toBeGreaterThanOrEqual(92);
    /* Respaldo: HD y la reserva (la HEVC no entra si hay 2 mejores). */
    expect(match?.variants.map((entry) => entry.title)).toEqual([
      'ES: DAZN LaLiga HD',
      'ES: DAZN LaLiga (Backup)',
    ]);
  });

  it('«LaLiga TV Hypermotion» no casa con «LaLiga TV» (ni al revés)', () => {
    expect(names(matchIptvChannels(cat, ['LaLiga TV'], { scorer }))).not.toContain(
      'LaLiga TV Hypermotion',
    );
    expect(names(matchIptvChannels(cat, ['LaLiga TV Hypermotion'], { scorer }))).toEqual([
      'LaLiga TV Hypermotion',
    ]);
  });

  it('«DAZN» no casa con «DAZN 1» (familia 78 < 92); «DAZN 1» no casa con «DAZN F1»', () => {
    expect(matchIptvChannels(cat, ['DAZN'], { scorer })).toEqual([]);
    expect(names(matchIptvChannels(cat, ['DAZN 1'], { scorer }))).toEqual(['DAZN 1']);
    expect(names(matchIptvChannels(cat, ['DAZN F1'], { scorer }))).toEqual(['DAZN F1']);
  });

  it('«M+ LaLiga TV 1» casa con «M+ LaLiga TV» pedido sin número, pero no al revés', () => {
    const plain = names(matchIptvChannels(cat, ['M+ LaLiga TV'], { scorer }));
    expect(plain).toContain('M+ LaLiga TV');
    expect(plain).toContain('M+ LaLiga TV 1');
    expect(plain).not.toContain('M+ LaLiga TV 2');
    expect(names(matchIptvChannels(cat, ['M+ Liga de Campeones'], { scorer }))).toContain(
      'M+ Liga de Campeones 1',
    );
    const one = names(
      matchIptvChannels(catalog(['ES: DAZN LaLiga']), ['DAZN LaLiga 1'], { scorer }),
    );
    expect(one).toEqual([]);
  });

  it('«DAZN LA LIGA» casa con «DAZN LaLiga» y «M+ La Liga TV» pedido con espacio también', () => {
    expect(names(matchIptvChannels(cat, ['DAZN LaLiga 2'], { scorer }))).toEqual([
      'DAZN LA LIGA 2',
    ]);
    expect(names(matchIptvChannels(cat, ['M+ La Liga TV'], { scorer }))).toContain('M+ LaLiga TV');
  });

  it('filtro de país: «UK: DAZN 1» e «IT: DAZN 1» no casan con «DAZN 1»', () => {
    const matches = matchIptvChannels(cat, ['DAZN 1'], { scorer });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.best.country).toBe('ES');
    const foreign = catalog(['UK: DAZN 1', 'IT: DAZN 1']);
    expect(matchIptvChannels(foreign, ['DAZN 1'], { scorer })).toEqual([]);
  });

  it('trampas medidas: «Bar», «Antena 3 Internacional»', () => {
    expect(names(matchIptvChannels(cat, ['Antena 3'], { scorer }))).toEqual(['Antena 3']);
    expect(names(matchIptvChannels(cat, ['M+ LaLiga TV'], { scorer }))).not.toContain(
      'M+ LaLiga TV Bar',
    );
  });

  it('canales en abierto del corpus', () => {
    expect(names(matchIptvChannels(cat, ['La 1'], { scorer }))).toEqual(['La 1']);
    expect(names(matchIptvChannels(cat, ['La 1 HD'], { scorer }))).toEqual(['La 1']);
    expect(names(matchIptvChannels(cat, ['Telecinco'], { scorer }))).toEqual(['Telecinco']);
    expect(names(matchIptvChannels(cat, ['M+ Vamos'], { scorer }))).toEqual(['M+ Vamos']);
    expect(names(matchIptvChannels(cat, ['Movistar Liga de Campeones 3'], { scorer }))).toEqual([
      'Movistar Liga de Campeones 3',
    ]);
  });
});

describe('pickVariants', () => {
  it('FHD > HD > 4K > SD, no HEVC antes que HEVC, reserva al final; la fiabilidad desempata', () => {
    const list = catalog([
      'DAZN LaLiga SD',
      'DAZN LaLiga 4K',
      'DAZN LaLiga HD',
      'DAZN LaLiga FHD HEVC',
      'DAZN LaLiga FHD backup',
      'DAZN LaLiga FHD',
    ]).group('dazn laliga');
    const picked = pickVariants(list);
    expect(picked?.best.title).toBe('DAZN LaLiga FHD');
    /* Mismos desempates: la reserva FHD va antes que la HD normal (calidad antes que reserva). */
    expect(picked?.variants.map((entry) => entry.title)).toEqual([
      'DAZN LaLiga FHD backup',
      'DAZN LaLiga HD',
    ]);
    const twins = catalog(['X HD', 'X HD']).group('x');
    const second = twins[1]?.id as string;
    expect(pickVariants(twins, (id) => (id === second ? 0.9 : 0.1))?.best.id).toBe(second);
  });
});

describe('catálogo', () => {
  it('ida y vuelta por la forma guardada, con índice por tvg-id', () => {
    const cat = catalog([
      raw('ES: DAZN LaLiga FHD', '', 'DAZNLaLiga.es'),
      raw('ES: La 1', '', 'La1.es'),
    ]);
    const again = Catalog.fromStored(JSON.parse(JSON.stringify(cat.toStored())));
    expect(again?.size).toBe(2);
    expect(again?.groupsByTvgId('daznlaliga.es')).toEqual(['dazn laliga']);
    expect(Catalog.fromStored({ v: 2 })).toBe(null);
  });
});
