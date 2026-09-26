/* Normalización compartida por el buscador y el emparejado de la IPTV (docs/iptv.md §18), con una lista
   SINTÉTICA que tiene la misma forma que la lista real de Isma del 26-sep: prefijos «ES - », «ES| », «ES-»
   pegado, «ES TI - » (Tivify), «VIP - », categorías `CONTINENTE | PAÍS | TEMA`, «M.» por Movistar, ᴿᴬᵂ, ᵛᶦᵖ,
   «(BK-1)», «4K/UHD», la «Ñ» final, notas entre corchetes, cabeceras «##### … #####», «NO MATCH» y filas de
   evento con horario. Ningún nombre ni categoría sale de la lista real: están escritos a mano con su forma. */

import { describe, expect, it } from 'vitest';
import { channelSpelling, stripQualityMarks } from '@ace/shared';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, type RawChannel } from './catalog.js';
import {
  isPlatformChannel,
  isUmbrellaBrand,
  matchIptvChannels,
  sameChannelScore,
  type ChannelScorer,
} from './match.js';
import {
  aceChannelTitle,
  cleanIptvTitle,
  groupCountry,
  iptvAskedChannel,
  iptvPlatform,
  iptvSearchSpelling,
  isEventTitle,
  isFillerTitle,
} from './names.js';
import { categorySearchWords, searchCatalog, searchQueryKey } from './search.js';

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

const DEP = 'EU | ES | DEPORTES';
const EVT = 'EU | ES | EVENTOS';
const TDT = 'EU\u00a0| ES | TDT ESPAÑA VIP';
const LISTA: readonly (readonly [string, string])[] = [
  ['##### ES - M. LALIGA #####', DEP],
  ['ES - M. LALIGA FHD', DEP],
  ['ES - M. LALIGA HD', DEP],
  ['ES - M. LALIGA HEVC', DEP],
  ['ES - M. LALIGA HD (BK-1)', DEP],
  ['ES - M. LALIGA 1 FHD', DEP],
  ['ES - M. LALIGA 2 FHD', DEP],
  ['ES - M. LALIGA 3 HD', DEP],
  ['ES-M.LALIGA 4 HD', DEP],
  ['VIP - MOVISTAR LALIGA 4K', 'VIP | 4K ULTRA HD'],
  ['ES - M. LIGA DE CAMPEONES 1 FHD', DEP],
  ['ES - M. LIGA DE CAMPEONES 2 HD', EVT],
  ['ES - M. DEPORTES FHD', DEP],
  ['ES - M. FUTBOL FHD', DEP],
  ['ES - M. GOLF HD', DEP],
  ['ES - M. SUPER CUPA HD', EVT],
  ['ES - M .COPA AMERICA 1 HEVC', EVT],
  ['ES - M. PLUS+ FHD', 'EU | ES | MOVISTAR'],
  ['ES - MOVISTAR FHD', 'EU | ES | MOVISTAR'],
  ['ES - #VAMOS HD', 'EU | ES | MOVISTAR'],
  ['ES - M. ELLAS #V HD', 'EU | ES | MOVISTAR'],
  ['ES| M+ SERIES 1 ᴴᴰ', 'EU | ES | M+ SERIES & ESTRENOS'],
  ['ES - DAZN 1 FHD', DEP],
  ['ES - DAZN 2 FHD', DEP],
  ['ES - DAZN F1 FHD', DEP],
  ['ES - DAZN LaLIGA FHD', DEP],
  ['ES - DAZN LaLIGA 2 HD', DEP],
  ['ES - DAZN HD [ PREMIERELEAGUE ]', DEP],
  ['ES - DAZN 1 BAR HD', DEP],
  ['ES - LALIGA HYPERMOTION 1 FHD', DEP],
  ['ES - LALIGA HYPERMOTION TV ᴿᴬᵂ', DEP],
  ['ES - LALIGA+ PPV 1', 'EU | ES | LALIGA+ PPV'],
  ['ES - LALIGA+ PPV 10', 'EU | ES | LALIGA+ PPV'],
  ['ES - LALIGA REPLAY 1', 'EU | ES | LALIGA REPLAY'],
  ['LA LIGA 1', 'EU | ES | RAKUTEN TV'],
  ['LA LIGA 2', 'EU | ES | RAKUTEN TV'],
  ['ES - LA 1 FHD', TDT],
  ['ES - LA 1 4K/UHD', TDT],
  ['VIP - LA 1 4K', 'VIP | 4K ULTRA HD'],
  ['ES TI - LA 1 HD', 'EU | ES | TIVIFY GOLD'],
  ['ES - LA 2 HD', TDT],
  ['ES - ANTENA 3 FHD', TDT],
  ['ES - TELECINCO HD', TDT],
  ['ES - TELE CINCO SD', TDT],
  ['ES - CUATRO HD', TDT],
  ['ES - LA SEXTA HD', TDT],
  ['ES - LASEXTA ᴿᴬᵂ', TDT],
  ['ES - TELEDEPORTE HD', TDT],
  ['ES TI - TELEMADRID HD', 'EU | ES | TIVIFY GOLD'],
  ['ES TI - TVG HD', 'EU | ES | TIVIFY GOLD'],
  ['ES TI - IB3 FHD', 'EU | ES | TIVIFY GOLD'],
  ['ES - TV GALICIA HD', 'EU | ES | GENERAL'],
  ['ES - BEIN SPORTS Ñ FHD', DEP],
  ['ES - R. MADRID TV HD', DEP],
  ['ES - REAL MADRID TV FHD', DEP],
  ['ES - RALLY TV (not 24/7)', DEP],
  ['ES - FEF TV 1 (SOLO EVENTOS)', 'EU | ES | FEF TV'],
  ['ES - CANAL FUTBOL REPLAY', 'EU | ES | TV FOOTBALL PPV'],
  ['ES - GOL TV FOOTBALL 1', 'EU | ES | TV FOOTBALL PPV'],
  ['ES - CLAN HD', 'EU | ES | NIÑOS'],
  ['ES - DISNEY JUNIOR HD', 'EU | ES | NIÑOS'],
  ['DISNEY CHANNEL', 'EU | ES | NIÑOS'],
  ['VIX - REAL MADRID TV', 'AM | LAT | VIX'],
  ['Pluto TV Series', 'EU | ES | PLUTO TV'],
  ['ES - NO MATCH', 'VIP | LA LIGA'],
  ['XX - NO MATCH', 'VIP | UEFA CHAMPIONS LEAGUE'],
  [
    'ESPN PLUS 12 : SOCCER: REAL MADRID B @ X SEP 25 – 3:00 PM ET / 8:00 PM UK',
    'AM | USA | ESPN PLUS',
  ],
  ['DE - DAZN 1 HD', 'EU | DE | SPORT'],
  ['AR - BEIN SPORTS 1', 'AR | SPORTS'],
];

function lista(extra: readonly (readonly [string, string])[] = []): Catalog {
  return new Catalog(
    'p_Ab3dE5gH',
    1,
    'xtream',
    0,
    [],
    'ts',
    [...LISTA, ...extra].map(([title, group]) => raw(title, group)),
  );
}

describe('channelSpelling (@ace/shared)', () => {
  it.each([
    ['M. LALIGA', 'Movistar LaLiga'],
    ['M .COPA AMERICA 1', 'Movistar COPA AMERICA 1'],
    ['M.LALIGA', 'Movistar LaLiga'],
    ['M+ LaLiga TV', 'Movistar LaLiga TV'],
    ['MOVISTAR+ LALIGA', 'Movistar LaLiga'],
    ['MOVISTAR PLUS+ LIGA DE CAMPEONES', 'Movistar LIGA DE CAMPEONES'],
    ['Movistar Plus+', 'Movistar Plus+'],
    ['MOVIESTAR DEPORTES', 'Movistar DEPORTES'],
    ['LA LIGA', 'LaLiga'],
    ['LALIGA+ PPV 3', 'LaLiga Plus PPV 3'],
    ['LA SEXTA', 'LaSexta'],
    ['lasexta', 'LaSexta'],
    ['TELE CINCO', 'Telecinco'],
    ['TELE DEPORTE', 'Teledeporte'],
    ['TRECETV', 'Trece TV'],
    ['M. SUPER CUPA', 'Movistar Supercopa'],
    ['R. MADRID TV', 'Real MADRID TV'],
    ['ANTENA 3 INT.', 'ANTENA 3 Internacional'],
  ])('%s → %s', (input, output) => {
    expect(channelSpelling(input)).toBe(output);
  });

  it('no toca lo que no es Movistar: M6, M95, MTV, «M» suelto', () => {
    expect(channelSpelling('M6')).toBe('M6');
    expect(channelSpelling('M95 TV')).toBe('M95 TV');
    expect(channelSpelling('MTV')).toBe('MTV');
    expect(channelSpelling('M LALIGA')).toBe('M LaLiga');
    expect(channelSpelling('MOVISTAR')).toBe('MOVISTAR');
  });

  it('stripQualityMarks: la calidad y el códec fuera, el número del canal no', () => {
    expect(stripQualityMarks('La 1 TVE 720p')).toBe('La 1 TVE');
    expect(stripQualityMarks('DAZN 1 1080p50 HEVC')).toBe('DAZN 1');
    expect(stripQualityMarks('M+ LaLiga TV 2 FHD')).toBe('M+ LaLiga TV 2');
    expect(stripQualityMarks('La 1 TVE 720p *')).toBe('La 1 TVE');
    expect(stripQualityMarks('Eurosport 4K / UHD')).toBe('Eurosport');
    expect(stripQualityMarks('1080p')).toBe('1080p');
  });
});

describe('cleanIptvTitle con la forma de la lista real', () => {
  it.each([
    /* título, categoría, nombre, clave, calidad, reserva, país */
    ['ES - M. LALIGA 1 FHD', DEP, 'M. LALIGA 1', 'movistar laliga 1', 'fhd', false, 'ES'],
    ['ES-M.LALIGA 4 HD', DEP, 'M.LALIGA 4', 'movistar laliga 4', 'hd', false, 'ES'],
    ['ES - M. LALIGA HD (BK-1)', DEP, 'M. LALIGA', 'movistar laliga tv', 'hd', true, 'ES'],
    [
      'ES - M .COPA AMERICA 1 HEVC',
      EVT,
      'M .COPA AMERICA 1',
      'movistar copa america 1',
      null,
      false,
      'ES',
    ],
    ['ES| M+ SERIES 1 ᴴᴰ', DEP, 'M+ SERIES 1', 'movistar series 1', 'hd', false, 'ES'],
    [
      'ES TI - TELEMADRID HD',
      'EU | ES | TIVIFY GOLD',
      'TELEMADRID',
      'telemadrid',
      'hd',
      false,
      'ES',
    ],
    [
      'VIP - MOVISTAR LALIGA 4K',
      'VIP | 4K ULTRA HD',
      'MOVISTAR LALIGA',
      'movistar laliga tv',
      'uhd',
      false,
      null,
    ],
    ['ES - LA 1 4K/UHD', TDT, 'LA 1', 'la 1', 'uhd', false, 'ES'],
    ['ES - LASEXTA ᴿᴬᵂ', TDT, 'LASEXTA', 'lasexta', null, true, 'ES'],
    ['ES - LA SEXTA HD', TDT, 'LA SEXTA', 'lasexta', 'hd', false, 'ES'],
    ['ES - BEIN SPORTS Ñ FHD', DEP, 'BEIN SPORTS', 'bein sports', 'fhd', false, 'ES'],
    ['BEIN SPORTS Ñ', '', 'BEIN SPORTS', 'bein sports', null, false, 'ES'],
    ['MOVISTAR DEPORTES ᵛᶦᵖ', DEP, 'MOVISTAR DEPORTES', 'movistar deportes', null, false, 'ES'],
    ['ES - DAZN HD [ PREMIERELEAGUE ]', DEP, 'DAZN', 'dazn', 'hd', false, 'ES'],
    ['ES - RALLY TV (not 24/7)', DEP, 'RALLY TV', 'rally tv', null, false, 'ES'],
    ['ES - FEF TV 1 (SOLO EVENTOS)', DEP, 'FEF TV 1', 'fef tv 1', null, false, 'ES'],
    ['ES - #VAMOS HD', DEP, 'VAMOS', 'vamos', 'hd', false, 'ES'],
    ['ES - R. MADRID TV HD', DEP, 'R. MADRID TV', 'real madrid tv', 'hd', false, 'ES'],
    ['ES - TELE CINCO SD', TDT, 'TELE CINCO', 'telecinco', 'sd', false, 'ES'],
    ['ES - M. SUPER CUPA HD', EVT, 'M. SUPER CUPA', 'movistar supercopa', 'hd', false, 'ES'],
    ['ES - LALIGA+ PPV 1', DEP, 'LALIGA+ PPV 1', 'laliga plus ppv 1', null, false, 'ES'],
    ['ES TI - TVG HD', 'EU | ES | TIVIFY GOLD', 'TVG', 'tv galicia', 'hd', false, 'ES'],
    ['LA 1', TDT, 'LA 1', 'la 1', null, false, 'ES'],
  ] as const)('%s', (title, group, display, key, quality, backup, country) => {
    const clean = cleanIptvTitle(title, group);
    expect(clean.display).toBe(display);
    expect(clean.key).toBe(key);
    expect(clean.quality).toBe(quality);
    expect(clean.backup).toBe(backup);
    expect(clean.country).toBe(country);
  });

  it('«(BK-1)» es una reserva de M. LALIGA, no M. LALIGA 1', () => {
    expect(cleanIptvTitle('ES - M. LALIGA HD (BK-1)').key).not.toBe(
      cleanIptvTitle('ES - M. LALIGA 1 FHD').key,
    );
    expect(cleanIptvTitle('M. LALIGA BK-2').key).toBe(cleanIptvTitle('M. LALIGA').key);
    expect(cleanIptvTitle('M. LALIGA BK-2').backup).toBe(true);
  });

  it('país de la categoría CONTINENTE | PAÍS | TEMA; VIP y AR no son España', () => {
    expect(groupCountry('EU | ES | TDT ESPAÑA VIP')).toBe('ES');
    expect(groupCountry('EU\u00a0| ES | DEPORTES')).toBe('ES');
    expect(groupCountry('AM | USA | ESPN PLUS')).toBe('USA');
    expect(groupCountry('EU | DE | SPORT')).toBe('DE');
    expect(groupCountry('VIP | LA LIGA')).toBe(null);
    expect(groupCountry('AR | SPORTS')).toBe('AR');
    expect(groupCountry('EU | 4K | CINE')).toBe(null);
  });

  it('filas que no son canales, eventos y plataformas', () => {
    expect(isFillerTitle('##### ES - M. LALIGA #####')).toBe(true);
    expect(isFillerTitle('###### DE - APPLE TV ######')).toBe(true);
    expect(isFillerTitle('#### F1 - HELI FEED####')).toBe(true);
    expect(isFillerTitle('==== CINE ====')).toBe(true);
    expect(isFillerTitle('XX - NO MATCH')).toBe(true);
    expect(isFillerTitle('NO EVENT')).toBe(true);
    expect(isFillerTitle('#VAMOS')).toBe(false);
    expect(isFillerTitle('M. ELLAS #V')).toBe(false);
    expect(isEventTitle('ESPN PLUS 12 : SOCCER: A @ B SEP 25 – 3:00 PM ET / 8:00 PM UK')).toBe(
      true,
    );
    expect(isEventTitle('M. LALIGA 1')).toBe(false);
    expect(iptvPlatform('LA LIGA 1', 'EU | ES | RAKUTEN TV')).toBe('rakuten');
    expect(iptvPlatform('VIX - REAL MADRID TV', 'AM | LAT | VIX')).toBe('vix');
    expect(iptvPlatform('Pluto TV Series', '')).toBe('pluto');
    expect(iptvPlatform('GOLD TV 24/7 NINOS 1', 'EU | ES | GOLD')).toBe('gold');
    expect(iptvPlatform('ES - DAZN 1 FHD', DEP)).toBe(null);
  });

  it('el catálogo no guarda cabeceras ni «NO MATCH»', () => {
    const c = lista();
    const titles = c.entries.map((entry) => entry.title);
    expect(titles.some((title) => title.includes('#####'))).toBe(false);
    expect(titles.some((title) => /NO MATCH/.test(title))).toBe(false);
    expect(titles).toContain('ES - #VAMOS HD');
  });
});

describe('lado AceStream (biblioteca y agenda)', () => {
  it.each([
    ['LA 1 4K --> NEW ERA', 'LA 1'],
    ['La 1 TVE 720p *', 'La 1'],
    ['DAZN 2 1080p **', 'DAZN 2'],
    ['M+ Vamos 1080p *', 'M+ Vamos'],
    ['Teledeporte RTVE HD', 'Teledeporte'],
    ['La 1 TVE', 'La 1'],
    ['TVE Internacional', 'TVE Internacional'],
  ])('%s → %s', (input, output) => {
    expect(aceChannelTitle(input)).toBe(output);
  });

  it('plataformas de la agenda: nunca por nombre', () => {
    for (const name of [
      'Disney+',
      'Disney Plus',
      'Prime Video',
      'Apple TV',
      'FANSEAT',
      'RTVE Play',
      'Netflix',
      'HBO Max',
      'ViX',
    ]) {
      expect(iptvAskedChannel(name), name).toBe(null);
    }
    for (const name of ['Movistar Plus+', 'M+ LaLiga TV', 'DAZN 1', 'La 1 TVE', 'GOL', 'TV3']) {
      expect(iptvAskedChannel(name), name).not.toBe(null);
    }
    expect(iptvAskedChannel('La 1 TVE 720p *')).toBe('La 1');
  });

  it('«DAZN» a secas es la marca paraguas; «DAZN 1» no', () => {
    expect(isUmbrellaBrand('DAZN')).toBe(true);
    expect(isUmbrellaBrand('DAZN 1')).toBe(false);
    expect(isUmbrellaBrand('DAZN LaLiga')).toBe(false);
  });

  it('sameChannel: la biblioteca de AceStream encuentra la IPTV', () => {
    expect(sameChannelScore('LA 1', 'La 1 TVE 720p *', scorer)).toBeGreaterThanOrEqual(92);
    expect(sameChannelScore('LA 1', 'LA 1 4K --> NEW ERA', scorer)).toBeGreaterThanOrEqual(92);
    expect(sameChannelScore('LaSexta', 'LA SEXTA HD', scorer)).toBeGreaterThanOrEqual(92);
    expect(sameChannelScore('M+ LaLiga TV', 'M. LALIGA', scorer)).toBeGreaterThanOrEqual(92);
    /* Lo que NO es el mismo canal. */
    expect(sameChannelScore('LA 1', 'La 2 TVE 720p *', scorer)).toBeLessThan(92);
    expect(sameChannelScore('DAZN 1', 'DAZN 2 1080p *', scorer)).toBeLessThan(92);
    expect(sameChannelScore('DAZN 1', 'DAZN F1 1080p', scorer)).toBeLessThan(92);
    expect(sameChannelScore('LaLiga TV', 'LaLiga TV Hypermotion 1080p *', scorer)).toBeLessThan(92);
    expect(sameChannelScore('M+ Liga de Campeones', 'M+ LaLiga TV *', scorer)).toBeLessThan(92);
  });
});

describe('buscador con la forma de la lista real (§18)', () => {
  const c = lista();
  const top = (q: string, n = 10): string[] =>
    searchCatalog(c, q)
      .groups.slice(0, n)
      .map((group) => group.best.display);

  it('la consulta pasa por la grafía del buscador, sin los alias del emparejado', () => {
    expect(searchQueryKey('movistar laliga')).toBe('movistar laliga');
    expect(searchQueryKey('m+ laliga')).toBe('movistar laliga');
    expect(searchQueryKey('m. laliga')).toBe('movistar laliga');
    expect(searchQueryKey('m laliga')).toBe('movistar laliga');
    expect(searchQueryKey('mov laliga')).toBe('movistar laliga');
    expect(searchQueryKey('movistar plus laliga')).toBe('movistar laliga');
    expect(searchQueryKey('movistar la liga')).toBe('movistar laliga');
    expect(iptvSearchSpelling('m+ laliga tv')).toBe('Movistar LaLiga tv');
  });

  it.each([
    'movistar laliga',
    'm+ laliga',
    'm. laliga',
    'm laliga',
    'mov laliga',
    'movistar plus laliga',
    'movistar la liga',
    'm+ laliga tv',
    'MOVISTAR+ LALIGA',
  ])('«%s» encuentra la familia M. LALIGA, en orden y primero', (q) => {
    const found = top(q, 6);
    expect(found[0]).toMatch(/^(M\. LALIGA|MOVISTAR LALIGA)$/);
    expect(found.slice(0, 5)).toEqual([
      expect.stringMatching(/^(M\. LALIGA|MOVISTAR LALIGA)$/),
      'M. LALIGA 1',
      'M. LALIGA 2',
      'M. LALIGA 3',
      'M.LALIGA 4',
    ]);
  });

  it('«movistar liga de campeones» y «m+ liga de campeones» dan M. LIGA DE CAMPEONES', () => {
    expect(top('movistar liga de campeones', 2)).toEqual([
      'M. LIGA DE CAMPEONES 1',
      'M. LIGA DE CAMPEONES 2',
    ]);
    expect(top('m+ liga de campeones', 1)).toEqual(['M. LIGA DE CAMPEONES 1']);
  });

  it('«laliga»: la familia de canal (DAZN y M.) antes que Rakuten, PPV y replay', () => {
    const found = top('laliga', 20);
    const rakuten = found.indexOf('LA LIGA 1');
    const ppv = found.indexOf('LALIGA+ PPV 1');
    for (const name of ['DAZN LaLIGA', 'M. LALIGA', 'M. LALIGA 1']) {
      expect(found.indexOf(name), name).toBeGreaterThanOrEqual(0);
      expect(found.indexOf(name), name).toBeLessThan(rakuten);
      expect(found.indexOf(name), name).toBeLessThan(ppv);
    }
  });

  it('otros de Movistar: deportes, futbol, golf, supercopa y #VAMOS sin la marca', () => {
    expect(top('movistar deportes', 1)).toEqual(['M. DEPORTES']);
    expect(top('m+ futbol', 1)).toEqual(['M. FUTBOL']);
    expect(top('movistar golf', 1)).toEqual(['M. GOLF']);
    expect(top('m+ supercopa', 1)).toEqual(['M. SUPER CUPA']);
    expect(top('m+ vamos', 1)).toEqual(['VAMOS']);
    expect(top('movistar vamos', 1)).toEqual(['VAMOS']);
    expect(top('m+ ellas', 1)).toEqual(['M. ELLAS V']);
    expect(top('movistar plus', 1)[0]).toMatch(/^(M\. PLUS\+|MOVISTAR)$/);
  });

  it('por categoría: «tdt» trae los de TDT; «futbol» también la categoría de fútbol; «infantil» = NIÑOS', () => {
    expect(top('tdt')).toEqual(
      expect.arrayContaining(['LA 1', 'LA 2', 'ANTENA 3', 'TELECINCO', 'CUATRO', 'LA SEXTA']),
    );
    expect(top('canales tdt')).toContain('LA 1');
    const futbol = top('futbol');
    expect(futbol[0]).toBe('M. FUTBOL');
    expect(futbol).toContain('GOL TV FOOTBALL 1');
    expect(top('infantil')).toEqual(expect.arrayContaining(['CLAN', 'DISNEY JUNIOR']));
    expect(top('tivify')).toEqual(expect.arrayContaining(['TELEMADRID', 'IB3']));
    expect(categorySearchWords('EU | ES | TV FOOTBALL PPV')).toEqual(['futbol', 'ppv']);
    expect(categorySearchWords('EU\u00a0| ES | TDT ESPAÑA VIP')).toEqual(['tdt', 'vip']);
    expect(categorySearchWords('EU | ES | M+ SERIES & ESTRENOS')).toEqual([
      'movistar',
      'series',
      'estrenos',
    ]);
  });

  it('números enteros, compuestos por dentro y la consulta pegada', () => {
    expect(top('la 1', 1)).toEqual(['LA 1']);
    expect(top('la 1', 20)).not.toContain('LALIGA+ PPV 10');
    expect(top('la1', 1)).toEqual(['LA 1']);
    expect(top('antena3', 1)).toEqual(['ANTENA 3']);
    expect(top('lasexta', 1)).toEqual(['LA SEXTA']);
    expect(top('la sexta', 1)).toEqual(['LA SEXTA']);
    expect(top('sexta', 1)).toEqual(['LA SEXTA']);
    expect(top('telecinco')).toEqual(['TELECINCO']);
    expect(top('tele cinco')).toEqual(['TELECINCO']);
    expect(top('dazn 1', 1)).toEqual(['DAZN 1']);
    expect(top('dazn 1')).toContain('DAZN 1 BAR');
    expect(top('dazn 1', 20)).not.toContain('DAZN F1');
    expect(top('laliga+')).toEqual(['LALIGA+ PPV 1', 'LALIGA+ PPV 10']);
    expect(top('beIN sports', 1)).toEqual(['BEIN SPORTS']);
    expect(top('real madrid tv', 1)[0]).toMatch(/MADRID TV/);
  });

  it('España antes que otro país; eventos, plataformas y feeds ᴿᴬᵂ detrás', () => {
    const found = searchCatalog(c, 'dazn 1').groups;
    expect(found[0]?.bucket).toBe('');
    expect(found.find((group) => group.bucket === 'DE')).toBeDefined();
    const madrid = top('real madrid', 10);
    expect(madrid.indexOf('REAL MADRID TV')).toBeLessThan(
      madrid.findIndex((name) => name.startsWith('ESPN PLUS')),
    );
    const hyper = top('hypermotion');
    expect(hyper[0]).toBe('LALIGA HYPERMOTION 1');
  });

  it('las cabeceras «##### … #####» y «NO MATCH» no salen', () => {
    expect(top('laliga', 50).some((name) => name.includes('#'))).toBe(false);
    expect(top('no match')).toEqual([]);
  });
});

describe('emparejado automático con la forma de la lista real (§18)', () => {
  const c = lista();
  const pick = (channel: string): string[] =>
    matchIptvChannels(c, [channel], { scorer }).map(
      (match) => `${match.best.display}${match.bucket ? ` (${match.bucket})` : ''}`,
    );

  it.each([
    ['M+ LaLiga TV', 'M. LALIGA'],
    ['Movistar LaLiga', 'M. LALIGA'],
    ['M+ Liga de Campeones', 'M. LIGA DE CAMPEONES 1'],
    ['M+ Vamos', 'VAMOS'],
    ['M+ Supercopa', 'M. SUPER CUPA'],
    ['DAZN LaLiga', 'DAZN LaLIGA'],
    ['DAZN LaLiga 2', 'DAZN LaLIGA 2'],
    ['DAZN 1', 'DAZN 1'],
    ['laSexta', 'LA SEXTA'],
    ['TVG', 'TVG'],
    ['IB3', 'IB3'],
    ['beIN Sports', 'BEIN SPORTS'],
    ['Real Madrid TV', 'REAL MADRID TV'],
    ['La 1 TVE', 'LA 1'],
    ['Teledeporte', 'TELEDEPORTE'],
    ['LALIGA TV Hypermotion', 'LALIGA HYPERMOTION 1'],
  ])('«%s» → %s', (channel, expected) => {
    expect(pick(channel)[0]).toBe(expected);
  });

  it('«TVG» de la agenda es el canal «TV GALICIA» (con «ES TI - TVG» dentro); «TVG 2» sería otro', () => {
    const match = matchIptvChannels(c, ['TVG'], { scorer })[0];
    expect(match?.key).toBe('tv galicia');
    expect(match?.posters.length).toBeGreaterThanOrEqual(1);
    expect(cleanIptvTitle('TVG 2').key).toBe('tvg 2');
  });

  it('sin juntar canales distintos', () => {
    /* Rakuten no es Movistar (plataforma y sin la marca de cadena). */
    expect(pick('M+ LaLiga TV')).not.toContain('LA LIGA 1');
    expect(pick('M+ LaLiga TV 2')).not.toContain('LA LIGA 2');
    expect(pick('M+ LaLiga TV 2')[0]).toBe('M. LALIGA 2');
    /* Liga de Campeones ≠ LaLiga; Hypermotion ≠ LaLiga; los números mandan. */
    expect(pick('M+ Liga de Campeones')).not.toContain('M. LALIGA');
    expect(pick('LaLiga TV')).not.toContain('LALIGA HYPERMOTION 1');
    expect(pick('LALIGA TV Hypermotion')).not.toContain('M. LALIGA');
    expect(pick('DAZN 1')).not.toContain('DAZN 2');
    expect(pick('DAZN 1')).not.toContain('DAZN F1');
    expect(pick('DAZN 2')).not.toContain('DAZN 1');
    /* LaLiga+ PPV y replay nunca son LaLiga TV. */
    expect(pick('LaLiga TV').some((name) => /PPV|REPLAY/.test(name))).toBe(false);
    /* «DAZN» a secas no casa con nada (tampoco con el «DAZN» de la lista). */
    expect(pick('DAZN')).toEqual([]);
    /* Plataformas de la agenda. */
    expect(pick('Disney+')).toEqual([]);
    expect(pick('Apple TV')).toEqual([]);
    expect(pick('FANSEAT')).toEqual([]);
  });

  it('plataformas de la lista: no se emparejan por nombre', () => {
    const rakuten = c.buckets('laliga 1')[0]?.entries ?? [];
    expect(isPlatformChannel(rakuten)).toBe(true);
    expect(pick('LaLiga 1')).not.toContain('LA LIGA 1');
    expect(pick('Real Madrid TV')).not.toContain('REAL MADRID TV (LAT)');
  });
});
