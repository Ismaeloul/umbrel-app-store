/* Protecciones y consultas de la prueba de Isma con su lista real (docs/iptv.md §19), con una lista SINTÉTICA
   de la misma forma: otros países con el mismo nombre («FR - DAZN 2», «SW - TV3», «PER - MOVISTAR DEPORTES»,
   «UK - LA LIGA TV»), una categoría «RAKUTEN TV» que mezcla canales de la TDT, categorías con el nombre del país
   («AM | LATINO», «AF | AFRICA») y «LALIGA+». Ningún nombre sale de la lista real: están escritos a mano. */

import { describe, expect, it } from 'vitest';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, type RawChannel } from './catalog.js';
import {
  isPlatformChannel,
  matchIptvChannels,
  sameChannelScore,
  type ChannelScorer,
} from './match.js';
import { aceChannelTitle, groupCountry } from './names.js';
import { searchCatalog, searchQueryText } from './search.js';

const scorer: ChannelScorer = (channels, item) => scoreResolutionCandidate(channels, item, 'iptv');

let seq = 0;
function raw(title: string, group: string): RawChannel {
  seq += 1;
  return {
    id: (0x19000 + seq).toString(16).padStart(40, '0'),
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
const TDT = 'EU | ES | TDT ESPAÑA VIP';
const MEZCLA = 'EU | ES | RAKUTEN TV';
const LISTA: readonly (readonly [string, string])[] = [
  ['ES - M. LALIGA FHD', DEP],
  ['ES - M. LALIGA HD (BK-1)', DEP],
  ['ES - MOVISTAR LALIGA FHD', DEP],
  ['ES - M. LALIGA 1 FHD', DEP],
  ['ES - M. LALIGA 3 HD', DEP],
  ['ES - M. DEPORTES FHD', DEP],
  ['ES - M. ELLAS #V HD', 'EU | ES | MOVISTAR'],
  ['ES - DAZN 1 FHD', DEP],
  ['ES - DAZN 2 FHD', DEP],
  ['ES - DAZN LaLIGA FHD', DEP],
  ['ES - LALIGA+ PPV 1', 'EU | ES | LALIGA+ PPV'],
  ['ES - LA 1 FHD', TDT],
  ['ES - LA 2 HD', TDT],
  ['ES - ANTENA 3 FHD', TDT],
  ['ES - CUATRO HD', TDT],
  ['ES - TV3 FHD', 'EU | ES | GENERAL'],
  ['ES - LAS ESTRELLAS', 'EU | ES | GENERAL'],
  /* «RAKUTEN TV» con canales de la TDT (como en la lista real) y sus «LA LIGA N». */
  ['ES - LA 2 FHD', MEZCLA],
  ['ES - ANTENA 3 FHD', MEZCLA],
  ['ES - CUATRO FHD', MEZCLA],
  ['ES - TVG 2', MEZCLA],
  ['ES - LA LIGA 3 FHD', MEZCLA],
  ['ES - RAKUTEN TV ACCION', MEZCLA],
  /* Solo de plataforma. */
  ['LA LIGA 1', 'EU | ES | PLUTO TV'],
  ['Pluto TV Series', 'EU | ES | PLUTO TV'],
  /* Otros países con el mismo nombre. */
  ['FR - DAZN 2 FHD', 'EU | FR | DAZN PPV'],
  ['PT - DAZN 2 FHD', 'EU | PT | ESPORTES'],
  ['SW - TV3 HD', 'EU | SE | SWEDEN'],
  ['PER - MOVISTAR DEPORTES HD', 'AM | LATINO'],
  ['UK - LA LIGA TV FHD', 'EU | UK | SPORTS'],
  ['LATINO - ESPORT3', 'AM | LATINO'],
  ['GHANA - TV3 GHANA SD', 'AF | AFRICA'],
];

const c = new Catalog(
  'p_Ab3dE5gH',
  1,
  'xtream',
  0,
  [],
  'ts',
  LISTA.map(([title, group]) => raw(title, group)),
);

const pick = (channel: string, anyCountry = false): string[] =>
  matchIptvChannels(c, [channel], { scorer, anyCountry }).map(
    (match) => `${match.best.display}${match.bucket ? ` (${match.bucket})` : ''}`,
  );
const top = (q: string, n = 5): string[] =>
  searchCatalog(c, q)
    .groups.slice(0, n)
    .map((group) => `${group.best.display}${group.bucket ? ` (${group.bucket})` : ''}`);

describe('emparejado automático: otro país es otra programación (§19)', () => {
  it.each([
    ['DAZN 2', ['DAZN 2']],
    ['TV3', ['TV3']],
    ['M+ Deportes', ['M. DEPORTES']],
    ['Movistar Deportes', ['M. DEPORTES']],
    ['M+ LaLiga TV', ['M. LALIGA']],
    ['Movistar LaLiga', ['M. LALIGA']],
    ['LaLiga TV', ['M. LALIGA']],
  ])('«%s» → %j y nunca el extranjero', (channel, expected) => {
    const found = pick(channel);
    for (const name of expected) expect(found).toContain(name);
    expect(found.filter((name) => /\([A-Z]+\)$/.test(name))).toEqual([]);
  });

  it('el re-emparejado de un favorito (anyCountry) sí mira los de otro país, detrás del de España', () => {
    expect(pick('DAZN 2', true)).toEqual(['DAZN 2', 'DAZN 2 (FR)', 'DAZN 2 (PT)']);
  });

  it('el nombre del país en la categoría («AM | LATINO», «AF | AFRICA») no es España', () => {
    expect(groupCountry('AM | LATINO')).toBe('LAT');
    expect(groupCountry('AM | MEXICO PRIME PPV')).toBe('MX');
    expect(groupCountry('EU | LATVIA')).toBe('EU');
    expect(groupCountry('AS | THAILAND')).toBe('AS');
    expect(groupCountry('AF | SOUTH AFRICA')).toBe('AF');
    /* Lo que no es un país sigue sin serlo. */
    expect(groupCountry('EU | 4K | CINE')).toBe(null);
    expect(groupCountry('EU | ES | DEPORTES')).toBe('ES');
    expect(pick('Esport3')).toEqual([]);
  });
});

describe('«LaLiga+» y la categoría de plataforma que mezcla la TDT (§19)', () => {
  it('«LaLiga+» es otra marca: no casa con Movistar LaLiga ni con LaLiga TV', () => {
    expect(pick('LaLiga+')).toEqual([]);
    expect(pick('LaLiga Plus')).toEqual([]);
    expect(pick('LaLiga TV').some((name) => name.includes('LALIGA+'))).toBe(false);
    expect(top('laliga+', 1)).toEqual(['LALIGA+ PPV 1']);
  });

  it('«RAKUTEN TV» con canales de la TDT no los esconde: «TVG 2» casa; «LA LIGA 3» no es Movistar', () => {
    expect(pick('TVG 2')).toEqual(['TVG 2']);
    expect(pick('M+ LaLiga TV 3')).toEqual(['M. LALIGA 3']);
    expect(pick('LaLiga TV')).not.toContain('LA LIGA 3');
    expect(isPlatformChannel(c.buckets('tvg 2')[0]?.entries ?? [], c)).toBe(false);
    /* Su canal con nombre de plataforma sigue siéndolo, y la categoría de solo plataforma también. */
    expect(isPlatformChannel(c.buckets('rakuten tv accion')[0]?.entries ?? [], c)).toBe(true);
    expect(isPlatformChannel(c.buckets('laliga 1')[0]?.entries ?? [], c)).toBe(true);
    expect(pick('LaLiga 1')).not.toContain('LA LIGA 1');
  });
});

describe('buscador: lo que escribe una persona (§19)', () => {
  it.each([
    ['es-m.laliga', 'M. LALIGA'],
    ['ES-M.LALIGA', 'M. LALIGA'],
    ['es: laliga', 'DAZN LaLIGA'],
    ['es| dazn 1', 'DAZN 1'],
    ['[es] dazn 1', 'DAZN 1'],
    ['es - m. laliga', 'M. LALIGA'],
    ['es dazn 1', 'DAZN 1'],
    ['la 1 tve', 'LA 1'],
    ['tve 1', 'LA 1'],
    ['tve1', 'LA 1'],
    ['La 2 TVE', 'LA 2'],
  ])('«%s» → «%s» el primero', (q, first) => {
    expect(top(q, 1)).toEqual([first]);
  });

  it('el país de delante en cualquier caja; «es» a secas o «de dazn» no se tocan', () => {
    expect(searchQueryText('uk: la liga tv')).toEqual({ text: 'la liga tv', country: 'UK' });
    expect(searchQueryText('[es] dazn 1')).toEqual({ text: 'dazn 1', country: '' });
    expect(searchQueryText('es').text).toBe('es');
    expect(searchQueryText('es:').text).toBe('es:');
    expect(searchQueryText('de dazn').text).toBe('de dazn');
  });

  it('con el país pedido, ese país primero; sin él, España antes que un extranjero que se llame igual', () => {
    expect(top('uk - la liga tv', 1)).toEqual(['LA LIGA TV (UK)']);
    const liga = top('la liga tv', 20);
    expect(liga.indexOf('LA LIGA TV (UK)')).toBeGreaterThan(liga.indexOf('M. LALIGA'));
    expect(liga.indexOf('LA LIGA TV (UK)')).toBeGreaterThan(liga.indexOf('DAZN LaLIGA'));
    /* Lo de una categoría de plataforma, detrás aunque se llame parecido. */
    expect(liga.indexOf('LA LIGA 3')).toBeGreaterThan(liga.indexOf('M. LALIGA'));
    expect(top('tvg 2')).toEqual(['TVG 2']);
    const dazn = top('dazn 2', 10);
    expect(dazn.indexOf('DAZN 2 (FR)')).toBeGreaterThan(dazn.indexOf('DAZN LaLIGA'));
  });

  it('«movistar ellas» no trae «LAS ESTRELLAS» (sin Movistar, solo por el principio de una palabra)', () => {
    expect(top('movistar ellas')).toEqual(['M. ELLAS V']);
    expect(top('m+ ellas')).toEqual(['M. ELLAS V']);
    /* Por dentro de una palabra sí, si no se quita la marca. */
    expect(top('estrellas')).toEqual(['LAS ESTRELLAS']);
  });
});

describe('el nombre de una lista de AceStream sin flecha (§19)', () => {
  it.each([
    ['LA 1 4K --> NEW ERA', 'LA 1'],
    ['LA 1 FHD [NEW ERA]', 'LA 1'],
    ['LA 1 (NEW ERA)', 'LA 1'],
    ['LA 1 | NEW ERA', 'LA 1'],
    ['LA 1 - NEW ERA', 'LA 1'],
    ['LA 1 1080 NEW ERA', 'LA 1'],
    ['LA 1 HD NEW ERA', 'LA 1'],
    ['TV Canaria (RTVC)', 'TV Canaria'],
    ['LaLiga TV (Hypermotion)', 'LaLiga TV (Hypermotion)'],
    ['M+ LaLiga TV - Bar', 'M+ LaLiga TV - Bar'],
    ['DAZN 1 HD BAR', 'DAZN 1 BAR'],
    ['Real Madrid TV EN', 'Real Madrid TV EN'],
    ['M+ LaLiga TV (M2)', 'M+ LaLiga TV (M2)'],
  ])('«%s» → «%s»', (title, expected) => {
    expect(aceChannelTitle(title)).toBe(expected);
  });

  it('cada forma de «LA 1 … NEW ERA» es el mismo canal que «LA 1» de la IPTV; «LA 2 [NEW ERA]» no', () => {
    for (const title of [
      'LA 1 4K --> NEW ERA',
      'LA 1 FHD [NEW ERA]',
      'LA 1 (NEW ERA)',
      'LA 1 | NEW ERA',
      'LA 1 - NEW ERA',
      'LA 1 1080 NEW ERA',
    ])
      expect(sameChannelScore('LA 1', title, scorer), title).toBeGreaterThanOrEqual(92);
    expect(sameChannelScore('LA 1', 'LA 2 [NEW ERA]', scorer)).toBeLessThan(92);
    expect(sameChannelScore('LaLiga TV', 'LaLiga TV (Hypermotion)', scorer)).toBeLessThan(92);
  });
});
