/* Emparejado IPTV ↔ canal (docs/iptv.md §4.3 y §4.4) con la MISMA función
   de la resolución (`scoreResolutionCandidate`) y un corpus de nombres
   reales de listas españolas (anonimizados, sin URLs). */

import { describe, expect, it } from 'vitest';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, hasUrlMacros, type RawChannel } from './catalog.js';
import { windowFrom, type StoredProgramme } from './guide.js';
import { guideGroupMatches, mergeIptvMatches } from './layer.js';
import {
  matchIptvChannels,
  planVariants,
  relayVariants,
  sameChannel,
  sameChannelScore,
  withoutTrailingNote,
  type ChannelScorer,
} from './match.js';

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

  it('umbral 92: un canal por grupo, con un cartel por resolución (FHD, HD, la reserva al final; HEVC sin cartel)', () => {
    const [match, ...rest] = matchIptvChannels(cat, ['DAZN LaLiga'], { scorer });
    expect(rest.map((item) => item.best.display)).not.toContain('DAZN LaLiga');
    expect(match?.best.display).toBe('DAZN LaLiga');
    expect(match?.best.quality).toBe('fhd');
    expect(match?.best.hevc).toBe(false);
    expect(match?.score).toBeGreaterThanOrEqual(92);
    expect(match?.posters.map((entry) => entry.title)).toEqual([
      'ES: DAZN LaLiga FHD',
      'ES: DAZN LaLiga HD',
      'ES: DAZN LaLiga (Backup)',
    ]);
    /* La HEVC no tiene cartel (la web no la reproduce, D6): queda de respaldo. */
    expect(match?.hidden.map((entry) => entry.title)).toEqual(['ES: DAZN LaLiga HEVC']);
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
    /* «DAZN 1» de España, del Reino Unido y de Italia: tres canales del mismo nombre, ninguno «DAZN F1». */
    expect([...new Set(names(matchIptvChannels(cat, ['DAZN 1'], { scorer })))]).toEqual(['DAZN 1']);
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

  it('país: preferencia, no filtro; «DAZN 1» de España va antes que «UK: DAZN 1» e «IT: DAZN 1»', () => {
    const matches = matchIptvChannels(cat, ['DAZN 1'], { scorer });
    expect(matches.map((match) => [match.best.display, match.bucket])).toEqual([
      ['DAZN 1', ''],
      ['DAZN 1', 'UK'],
      ['DAZN 1', 'IT'],
    ]);
    expect(matches[0]?.best.country).toBe('ES');
    /* Si solo existe el extranjero y casa por nombre, sale. */
    const foreign = catalog(['UK: DAZN 1', 'IT: DAZN 1 HD']);
    expect(matchIptvChannels(foreign, ['DAZN 1'], { scorer }).map((match) => match.bucket)).toEqual(
      ['UK', 'IT'],
    );
    /* España y sin país son el mismo canal: sus variantes van juntas. */
    const mixed = matchIptvChannels(catalog(['DAZN 1 SD', 'ES: DAZN 1 FHD']), ['DAZN 1'], {
      scorer,
    });
    expect(mixed).toHaveLength(1);
    expect(mixed[0]?.posters.map((entry) => entry.title)).toEqual(['ES: DAZN 1 FHD', 'DAZN 1 SD']);
  });

  it('los gemelos de otro país salen detrás, cada uno con su país: la web no salta a ellos sola (§16)', () => {
    /* El catálogo del verificador: la española solo en SD. */
    const list = catalog(['DAZN 1 SD', 'DE: DAZN 1 FHD', 'UK: DAZN 1 4K']);
    const layer = mergeIptvMatches([], matchIptvChannels(list, ['DAZN 1'], { scorer }));
    expect(
      layer.matches.flatMap((match) =>
        match.posters.map((entry) => [entry.title, match.key, match.bucket]),
      ),
    ).toEqual([
      ['DAZN 1 SD', 'dazn 1', ''],
      ['DE: DAZN 1 FHD', 'dazn 1', 'DE'],
      ['UK: DAZN 1 4K', 'dazn 1', 'UK'],
    ]);
  });

  it('Hypermotion y el umbral siguen igual con cualquier país', () => {
    const list = catalog(['DE: LaLiga TV Hypermotion', 'UK: LaLiga TV', 'IT: DAZN']);
    expect(names(matchIptvChannels(list, ['LaLiga TV'], { scorer }))).toEqual(['LaLiga TV']);
    expect(matchIptvChannels(list, ['LaLiga TV'], { scorer })[0]?.bucket).toBe('UK');
    expect(matchIptvChannels(list, ['DAZN 1'], { scorer })).toEqual([]);
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

describe('planVariants (§16)', () => {
  it('un cartel por resolución: 1080p, 4K, 720p y SD; la reserva y la HEVC, de respaldo; la fiabilidad desempata', () => {
    const list = catalog([
      'DAZN LaLiga SD',
      'DAZN LaLiga 4K',
      'DAZN LaLiga HD',
      'DAZN LaLiga FHD HEVC',
      'DAZN LaLiga FHD backup',
      'DAZN LaLiga FHD',
    ]).group('dazn laliga');
    const plan = planVariants(list);
    expect(plan?.posters.map((entry) => entry.title)).toEqual([
      'DAZN LaLiga FHD',
      'DAZN LaLiga 4K',
      'DAZN LaLiga HD',
      'DAZN LaLiga SD',
    ]);
    expect(plan?.hidden.map((entry) => entry.title)).toEqual([
      'DAZN LaLiga FHD backup',
      'DAZN LaLiga FHD HEVC',
    ]);
    const twins = catalog(['X HD', 'X HD']).group('x');
    const second = twins[1]?.id as string;
    const byReliability = planVariants(twins, {
      reliability: (id) => (id === second ? 0.9 : 0.1),
    });
    expect(byReliability?.posters[0]?.id).toBe(second);
    expect(byReliability?.hidden).toHaveLength(1);
  });

  it('con sitio, la reserva tiene su cartel al final; las copias de una resolución, no', () => {
    const list = catalog([
      'ES: DAZN 1 (backup)',
      'ES: DAZN 1 HD',
      'ES: DAZN 1 FHD',
      'DAZN 1 FHD (2)',
    ]).group('dazn 1');
    const plan = planVariants(list);
    expect(plan?.posters.map((entry) => entry.title)).toEqual([
      'ES: DAZN 1 FHD',
      'ES: DAZN 1 HD',
      'ES: DAZN 1 (backup)',
    ]);
    /* «(2)» es la segunda copia (reserva) de la 1080p: la del cartel 1080p la prueba el relé antes de caer. */
    expect(plan?.hidden.map((entry) => entry.title)).toEqual(['DAZN 1 FHD (2)']);
  });

  it('la calidad real del stream manda sobre la del nombre', () => {
    const list = catalog(['DAZN 1 HD', 'DAZN 1 SD']).group('dazn 1');
    const hd = list.find((entry) => entry.title === 'DAZN 1 HD') as (typeof list)[number];
    const sd = list.find((entry) => entry.title === 'DAZN 1 SD') as (typeof list)[number];
    /* El «SD» es en realidad 1080 (lo dijo la maestra HLS): arranca primero. */
    const plan = planVariants(list, {
      qualityOf: (entry) => (entry.id === sd.id ? 'fhd' : entry.quality),
    });
    expect(plan?.posters.map((entry) => entry.id)).toEqual([sd.id, hd.id]);
  });

  it('el relé prueba detrás de un cartel solo las variantes sin cartel que le tocan', () => {
    const list = catalog([
      'DAZN 1 FHD',
      'DAZN 1 FHD alt',
      'DAZN 1 1080p (2)',
      'DAZN 1 4K',
      'DAZN 1 HD',
      'DAZN 1 SD',
      'DAZN 1 576p',
    ]).group('dazn 1');
    const plan = planVariants(list);
    expect(plan).not.toBe(null);
    const titles = (entries: readonly { title: string }[]) => entries.map((entry) => entry.title);
    expect(titles(plan?.posters ?? [])).toEqual([
      'DAZN 1 FHD',
      'DAZN 1 4K',
      'DAZN 1 HD',
      'DAZN 1 SD',
    ]);
    const at = (title: string) =>
      list.find((entry) => entry.title === title) as (typeof list)[number];
    expect(titles(relayVariants(plan!, at('DAZN 1 FHD')))).toEqual([
      'DAZN 1 FHD',
      'DAZN 1 FHD alt',
      'DAZN 1 1080p (2)',
    ]);
    expect(titles(relayVariants(plan!, at('DAZN 1 SD')))).toEqual(['DAZN 1 SD', 'DAZN 1 576p']);
    expect(titles(relayVariants(plan!, at('DAZN 1 4K')))).toEqual(['DAZN 1 4K']);
  });
});

/* Nombres de variantes como los de las listas de verdad (anonimizados): todas
   las de un canal dan la misma clave, y nunca se juntan canales distintos. */
describe('grupos de variantes: corpus', () => {
  /* La clave de `title` en una lista que también trae el canal sin adornos (así una copia «(2)» lo es). */
  const key = (title: string) => catalog([raw(title), raw('Otro canal')]).entries[0]?.key;
  const VARIANTS: readonly (readonly [string, readonly string[]])[] = [
    [
      'dazn 1',
      [
        'DAZN 1',
        'DAZN 1 FHD',
        'DAZN 1 HD',
        'DAZN 1 SD',
        'DAZN 1 4K',
        'DAZN 1 UHD',
        'DAZN 1 (backup)',
        'DAZN 1 [BACKUP]',
        'DAZN 1 BK',
        'DAZN 1 bk2',
        'DAZN 1 ALT',
        'DAZN 1 (1)',
        'DAZN 1 (2)',
        'ES: DAZN 1 1080p',
        'ES: DAZN 1 720p',
        'ES | DAZN 1 HD',
        '|ES| DAZN 1 FHD',
        '[ES] DAZN 1',
        'ES- DAZN 1 SD',
        'DAZN 1 [ES]',
        'DAZN 1 |ES|',
        'DAZN 1 HEVC',
        'DAZN 1 H265',
        'DAZN 1 H.265 FHD',
        'DAZN 1 50FPS',
        'DAZN 1 FHD 50 fps',
        'DAZN 1 1080p50',
        'DAZN 1 VIP',
        'VIP | ES: DAZN 1 FHD',
        'FHD | ES: DAZN 1',
        'ES: DAZN 1 ᶠᴴᴰ',
        '★ DAZN 1 ★ HD+',
        'DAZN 1 Full HD',
        'DAZN 1 FullHD',
        'DAZN 1 HDR',
        'DAZN 1 H264',
        'ES • DAZN 1 HD',
        /* Verificador (26-sep): fps pegados sin «p», país sin separador o con » y ➤, ES al final, copia tras la calidad. */
        'DAZN 1 FHD50',
        'DAZN 1 HD50',
        'DAZN 1 1080 50',
        'DAZN 1 FHD 50',
        'ES DAZN 1',
        'ES » DAZN 1',
        'ES ➤ DAZN 1 HD',
        'DAZN 1 ES',
        'DAZN 1 - ES',
        'DAZN 1 BK 2',
        'DAZN 1 HD 2',
        'DAZN 1 ⁴ᴷ',
      ],
    ],
    [
      'movistar laliga tv',
      [
        'M+ LaLiga TV',
        'M+ LaLiga TV FHD',
        'ES: M+ LALIGA TV HD',
        'M+ LaLiga (backup)',
        'Movistar LaLiga 1080p',
        'M+ La Liga TV UHD',
        'ES: M+ LaLiga TV (1)',
      ],
    ],
    ['movistar laliga tv 2', ['M+ LaLiga TV 2', 'M+ LaLiga TV 2 FHD', 'ES: M+ LaLiga TV 2 HD']],
    [
      'laliga tv hypermotion',
      ['LaLiga TV Hypermotion', 'ES: LaLiga TV Hypermotion FHD', 'M+ Hypermotion HD'],
    ],
    ['laliga tv', ['LaLiga TV', 'LaLiga TV FHD', 'ES: LaLiga TV HD']],
    ['dazn 2', ['DAZN 2', 'DAZN 2 FHD', 'ES: DAZN 2 HD']],
  ];

  it.each(VARIANTS)('«%s»: todas sus variantes son un grupo', (expected, titles) => {
    const list = catalog(titles.map((title) => raw(title)));
    for (const entry of list.entries)
      expect([entry.title, entry.key]).toEqual([entry.title, expected]);
    expect(list.buckets(expected)).toHaveLength(1);
    /* Y sin la copia «(n)» (o «HD 2»: sola, el número es parte del nombre), cada una sola da la misma clave. */
    for (const title of titles.filter((item) => !/\(\d\)$|HD \d$/.test(item)))
      expect([title, key(title)]).toEqual([title, expected]);
  });

  it('nunca junta canales distintos', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['DAZN 1 FHD', 'DAZN 2 FHD'],
      ['DAZN 1', 'DAZN F1'],
      ['DAZN 1 HD', 'DAZN 12 HD'],
      ['LaLiga TV FHD', 'LaLiga TV Hypermotion FHD'],
      ['M+ LaLiga FHD', 'M+ LaLiga 2 FHD'],
      ['M+ LaLiga TV', 'M+ LaLiga TV 2'],
      ['M+ LaLiga TV (1)', 'M+ LaLiga TV 2'],
      ['La 1 HD', 'La 2 HD'],
      ['Antena 3 FHD', 'Antena 3 Internacional'],
      ['M+ Deportes HD', 'M+ Deportes 2 HD'],
      ['Eurosport 1 HD', 'Eurosport 2 HD'],
      ['DAZN 1 HD 2', 'DAZN 2 HD'],
      ['LaLiga TV HD 2', 'LaLiga TV HD'],
      ['RAI - 1', 'TNT - Sports 1'],
      ['DE PELICULA', 'PELICULA'],
    ];
    for (const [a, b] of pairs) expect([a, b, key(a) === key(b)]).toEqual([a, b, false]);
  });

  it('las variantes con otro país son otro canal del mismo nombre (mismo grupo, otro país)', () => {
    const list = catalog(['ES: DAZN 1 HD', 'DE: DAZN 1 HD', 'DAZN 1 FHD']);
    expect(list.buckets('dazn 1').map((item) => [item.bucket, item.entries.length])).toEqual([
      ['', 2],
      ['DE', 1],
    ]);
  });

  it('«Canal Sur (2)» sin un «Canal Sur» al lado es otro canal («Canal Sur 2»), no una copia', () => {
    const lone = catalog(['Canal Sur (2)', 'Otro']);
    expect(lone.entries[0]?.key).toBe('canal sur 2');
    expect(lone.entries[0]?.display).toBe('Canal Sur (2)');
    expect(lone.entries[0]?.backup).toBe(false);
    const both = catalog(['Canal Sur', 'Canal Sur (2)']);
    expect(both.group('canal sur')).toHaveLength(2);
    expect(both.group('canal sur')[1]?.backup).toBe(true);
  });

  it('«Canal Sur (2) HD» y «Canal Sur (2) FHD» sin «Canal Sur» son Canal Sur 2 en dos resoluciones', () => {
    const list = catalog(['Canal Sur (2) HD', 'Canal Sur (2) FHD', 'Otro']);
    const group = list.group('canal sur 2');
    expect(group.map((entry) => [entry.quality, entry.backup])).toEqual([
      ['fhd', false],
      ['hd', false],
    ]);
    expect(list.group('canal sur')).toHaveLength(0);
    /* Con números distintos son copias de Canal Sur. */
    const copies = catalog(['Canal Sur (1)', 'Canal Sur (2)']);
    expect(copies.group('canal sur')).toHaveLength(2);
  });

  it('un «(1)» solo nunca es parte del nombre: «Antena 3 (1)» es Antena 3', () => {
    const list = catalog(['Antena 3 (1)', 'Otro']);
    expect(list.entries[0]?.key).toBe('antena 3');
    expect(list.entries[0]?.backup).toBe(false);
  });

  it('una sigla de 3 letras que no es un país no parte el canal («TDT | NACIONALES», «TVE - La 1»)', () => {
    const list = catalog([
      raw('La 1', 'TDT | NACIONALES'),
      raw('ES: La 1 HD'),
      raw('TVE - La 1 FHD'),
    ]);
    expect(list.buckets('la 1').map((item) => [item.bucket, item.entries.length])).toEqual([
      ['', 3],
    ]);
    expect(key('RAI - 1')).toBe('rai 1');
    expect(key('TNT - Sports 1')).toBe('tnt sports 1');
    expect(key('NBA: Lakers')).toBe('nba lakers');
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

describe('sameChannel: la regla única del buscador (docs/iptv.md §14.3)', () => {
  const same = (base: string, other: string) => sameChannel(base, other, scorer);
  const score = (base: string, other: string) => sameChannelScore(base, other, scorer);

  it('«DAZN LA LIGA 1080» es «DAZN LaLiga»; «La 1 HD --> ELCANO» es «La 1»', () => {
    expect(same('DAZN LaLiga', 'DAZN LA LIGA 1080')).toBe(true);
    expect(same('DAZN LaLiga', 'ES: DAZN LA LIGA FHD')).toBe(true);
    expect(same('La 1', 'La 1 HD --> ELCANO')).toBe(true);
    expect(same('Antena 3', 'Antena 3 HD')).toBe(true);
  });

  it('Hypermotion ≤ 58: «LaLiga TV Hypermotion» nunca es «LaLiga TV»', () => {
    expect(score('LaLiga TV', 'LaLiga TV Hypermotion --> NEW ERA')).toBeLessThanOrEqual(58);
    expect(score('LaLiga TV Hypermotion', 'LaLiga TV')).toBeLessThanOrEqual(58);
    expect(same('LaLiga TV', 'M+ Hypermotion')).toBe(false);
  });

  it('los números: «DAZN 1» no es «DAZN 2» ni «DAZN F1»; «DAZN» no es «DAZN 1»', () => {
    expect(same('DAZN 1', 'DAZN 2')).toBe(false);
    expect(same('DAZN 1', 'DAZN F1')).toBe(false);
    expect(same('DAZN', 'DAZN 1')).toBe(false);
    expect(same('DAZN 1', 'DAZN')).toBe(false);
  });

  it('« 1» final solo si el otro no lleva número', () => {
    expect(same('M+ LaLiga TV', 'M+ LaLiga TV 1 HD')).toBe(true);
    expect(same('M+ LaLiga TV 1', 'M+ LaLiga TV')).toBe(true);
    expect(same('M+ LaLiga TV 2', 'M+ LaLiga TV 1')).toBe(false);
  });

  it('otro idioma al final es otro canal: «Real Madrid TV EN» no es «Real Madrid TV»', () => {
    expect(score('Real Madrid TV', 'Real Madrid TV EN')).toBeLessThanOrEqual(58);
    expect(score('Real Madrid TV EN', 'Real Madrid TV')).toBeLessThanOrEqual(58);
    expect(same('Real Madrid TV', 'Real Madrid TV (ENG)')).toBe(false);
    expect(same('Real Madrid TV EN', 'Real Madrid TV (EN)')).toBe(true);
    expect(same('Real Madrid TV', 'Real Madrid TV HD')).toBe(true);
  });

  it('números pegados: «Esport3» es «Esport 3» y «Antena3» es «Antena 3»; «DAZN 1» sigue sin ser «DAZN12» ni «DAZN F1»', () => {
    expect(same('Esport 3', 'Esport3')).toBe(true);
    expect(same('Esport3', 'Esport 3')).toBe(true);
    expect(same('Esport 3', 'ESPORT3 HD')).toBe(true);
    expect(same('Antena 3', 'Antena3')).toBe(true);
    expect(same('La 1', 'La1')).toBe(true);
    expect(same('DAZN 1', 'DAZN1')).toBe(true);
    expect(same('DAZN 1', 'DAZN12')).toBe(false);
    expect(same('DAZN 1', 'DAZN F1')).toBe(false);
    expect(same('Esport 3', 'Esport2')).toBe(false);
  });

  it('otro país no se limpia: «UK: DAZN 1» no pasa por «DAZN 1» limpio', () => {
    expect(score('DAZN 1', 'UK: DAZN 1')).toBeLessThan(score('DAZN 1', 'ES: DAZN 1'));
    expect(same('Telecinco', '')).toBe(false);
  });
});

/* Formas de una lista pública real de canales en abierto (sin copiarla): el mismo canal dos veces, una con la
   URL oficial y otra con macros de un servidor de anuncios sin sustituir; «GEO» al final; la cadena entre
   paréntesis; y la agenda con «La 1 TVE», «RTVE Play» o «TV Canaria». */
describe('lista pública de canales en abierto', () => {
  const at = (title: string, url: string, tvgId = ''): RawChannel => ({
    ...raw(title, '', tvgId),
    ref: url,
  });

  it('la URL con macros sin sustituir va detrás de la oficial del mismo canal, aunque salga antes', () => {
    const list = catalog([
      at('Uno', 'https://ads.example/playlist.m3u8?id=7&ip=[IP]&ua=[UA]&did=[DEVICE_ID]'),
      at('Uno', 'https://oficial.example/uno/main.m3u8'),
      at('Deportes Uno GEO', 'https://oficial.example/dep/main.m3u8'),
      at('Deportes Uno', 'https://ads.example/playlist.m3u8?id=8&is_lat=[LMT]'),
      at('Solo Anuncios', 'https://ads.example/playlist.m3u8?cb=[CACHEBUSTER]'),
    ]);
    const uno = planVariants(list.group(list.entries[0]?.key as string));
    /* La misma resolución: la de macros no tiene cartel, es el respaldo del relé. */
    expect(uno?.posters.map((entry) => entry.ref)).toEqual([
      'https://oficial.example/uno/main.m3u8',
    ]);
    expect(uno?.hidden.map((entry) => entry.ref)).toEqual([
      'https://ads.example/playlist.m3u8?id=7&ip=[IP]&ua=[UA]&did=[DEVICE_ID]',
    ]);
    /* «Deportes Uno GEO» y «Deportes Uno» son un solo grupo. */
    const deportes = matchIptvChannels(list, ['Deportes Uno'], { scorer });
    expect(deportes).toHaveLength(1);
    expect(deportes[0]?.best.ref).toBe('https://oficial.example/dep/main.m3u8');
    expect(deportes[0]?.hidden).toHaveLength(1);
    /* Un canal con solo la URL con macros sigue saliendo (esos servidores responden con el texto tal cual). */
    expect(names(matchIptvChannels(list, ['Solo Anuncios'], { scorer }))).toEqual([
      'Solo Anuncios',
    ]);
    expect(hasUrlMacros('https://ads.example/p.m3u8?cb=[CACHEBUSTER]')).toBe(true);
    expect(hasUrlMacros('https://oficial.example/uno/main.m3u8')).toBe(false);
    expect(hasUrlMacros('12345')).toBe(false);
  });

  it('agenda: «La 1 TVE» es «La 1»; «RTVE Play» (una plataforma) no empareja por nombre', () => {
    const list = catalog(['La 1', 'La 1 Canarias', 'En Play (RTVE)', 'Clan']);
    expect(names(matchIptvChannels(list, ['La 1 TVE'], { scorer }))).toEqual(['La 1']);
    expect(matchIptvChannels(list, ['RTVE Play'], { scorer })).toEqual([]);
    expect(names(matchIptvChannels(list, ['RTVE Play', 'Clan RTVE'], { scorer }))).toEqual([
      'Clan',
    ]);
  });

  it('la cadena entre paréntesis del final no la pone la agenda; una nota con competición sí cuenta', () => {
    /* «Canal Sur (2)» sin «Canal Sur» al lado es «Canal Sur 2» (§16): no casa con «Canal Sur». */
    const list = catalog(['TV Canaria (RTVC)', 'LaLiga TV (Hypermotion)', 'Canal Sur (2)']);
    expect(names(matchIptvChannels(list, ['TV Canaria'], { scorer }))).toEqual([
      'TV Canaria (RTVC)',
    ]);
    expect(matchIptvChannels(list, ['LaLiga TV'], { scorer })).toEqual([]);
    expect(matchIptvChannels(list, ['Canal Sur'], { scorer })).toEqual([]);
    expect(withoutTrailingNote('TV Canaria (RTVC)')).toBe('TV Canaria');
    expect(withoutTrailingNote('LaLiga TV (Hypermotion)')).toBe('LaLiga TV (Hypermotion)');
    expect(withoutTrailingNote('(RTVE)')).toBe('(RTVE)');
  });

  it('guía: un generalista sin país se confirma si la agenda lo anuncia como «La 1 TVE»', () => {
    const kickoff = Date.UTC(2026, 8, 26, 18, 45);
    const list = catalog([
      at('La 1', 'https://oficial.example/la1.m3u8', 'Uno.TV'),
      at('Otro', 'https://oficial.example/otro.m3u8', 'Otro.TV'),
    ]);
    const programme = (start: number, minutes: number): StoredProgramme => ({
      channel: 'uno.tv',
      start,
      stop: start + minutes * 60_000,
      title: 'UEFA Nations League: Inglaterra - España',
      subTitle: '',
      desc: '',
      categories: ['SPORTS'],
      previouslyShown: false,
      live: false,
    });
    const replay = kickoff + 14 * 3_600_000;
    const window = windowFrom(
      [
        programme(kickoff - 10 * 60_000, 125),
        /* La repetición de la mañana siguiente, de 30 min y sin marca. */
        programme(replay - 10 * 60_000, 30),
      ],
      kickoff - 3_600_000,
    );
    const match = {
      id: 'm1',
      home: 'Inglaterra',
      away: 'España',
      competition: 'UEFA Nations League',
      title: 'Inglaterra - España',
      start: kickoff,
      channels: ['La 1 TVE', 'RTVE Play'],
    };
    expect(guideGroupMatches(list, window, match).map((item) => item.best.display)).toEqual([
      'La 1',
    ]);
    /* Si la agenda solo dice «RTVE Play», un canal sin país no se pone primero por la guía. */
    expect(guideGroupMatches(list, window, { ...match, channels: ['RTVE Play'] })).toEqual([]);
    /* Con el saque a la hora de la repetición tampoco: dura 30 min. */
    expect(guideGroupMatches(list, window, { ...match, start: replay })).toEqual([]);
  });
});
