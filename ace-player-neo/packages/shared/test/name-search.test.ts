/* Buscar por nombre (0.9.0, docs/buscador.md): las palabras de un nombre tal
   cual lo da un panel IPTV, lo que escribe una persona, el nivel de
   parecido, el orden, el resaltado, el corpus de nombres raros (consulta →
   los primeros) y el rendimiento con 20 000 canales. */

import { describe, expect, it } from 'vitest';
import {
  NAME_TIER,
  compareNameRank,
  leadingCountry,
  nameFacts,
  nameFactsOf,
  nameHighlights,
  nameSearchKey,
  nameSearchWords,
  nameTier,
  nameTierWithAliases,
  parseNameQuery,
  rankByName,
  regionRank,
  wordMatch,
  type NameFacts,
} from '../src/index.js';
import { corpusIptv, corpusIptvGrande, type CanalCorpus } from './corpus/canales-iptv.js';
import { ESPERADOS, checkEsperado } from './corpus/esperados.js';

describe('nameSearchWords: las palabras de un nombre tal cual lo da el panel', () => {
  it.each([
    /* El país delante, en todas sus formas. */
    ['ES 4K LA 1', 'la 1'],
    ['ES: LA 1 4K', 'la 1'],
    ['|ES| LA 1 FHD', 'la 1'],
    ['ES► LA 1 HD', 'la 1'],
    ['ES ┃ LA 1 ᴴᴰ', 'la 1'],
    ['[ES] LA 1 FHD ⁺', 'la 1'],
    ['◉ ES: LA 1 FHD', 'la 1'],
    ['ES ★ LA 1 ★', 'la 1'],
    ['ES ✪ LA 1', 'la 1'],
    ['ESPAÑA - LA 1 HD', 'la 1'],
    ['VIP ES: LA 1', 'la 1'],
    ['4K | ES: LA 1', 'la 1'],
    ['ES TI - LA 1 HD', 'la 1'],
    ['ES-M.LALIGA 2 HD', 'movistar laliga 2'],
    ['UK: DAZN 1', 'dazn 1'],
    /* Calidad, códec, fotogramas y adornos. */
    ['ES - LA 1 HEVC', 'la 1'],
    ['ES: LA 1 H265', 'la 1'],
    ['ES: LA 1 50FPS', 'la 1'],
    ['ES: LA 1 1080p50', 'la 1'],
    ['ES: LA 1 4K HDR', 'la 1'],
    ['ES: LA 1 FULL HD', 'la 1'],
    ['ES: LA 1 ⚽', 'la 1'],
    ['LA 1 HD --> ELCANO', 'la 1'],
    /* Reservas y copias (el número de la copia no es el del canal). */
    ['ES: LA 1 (backup)', 'la 1'],
    ['ES: LA 1 #2', 'la 1'],
    ['ES: LA 1 (2)', 'la 1'],
    ['DAZN 1 (2) HD', 'dazn 1'],
    ['ES » TELECINCO HD #2 ★', 'telecinco'],
    ['ES - M. LALIGA HD (BK-1)', 'movistar laliga'],
    ['ES - LASEXTA ᴿᴬᵂ', 'lasexta'],
    /* Grafías: Movistar, LaLiga, Telecinco, Antena 3, RTVE, Ñ. */
    ['ES: M+ LALIGA TV FHD', 'movistar laliga tv'],
    ['ES: MOVISTAR PLUS+ 4K', 'movistar'],
    ['ES: M+ PLUS HD', 'movistar'],
    ['ES: M+ #0 HD', 'movistar 0'],
    ['ES: #VAMOS FHD', 'vamos'],
    ['LALIGA+ PPV 1', 'laligaplus ppv 1'],
    ['ES: TELE5 SD', 'telecinco'],
    ['DE: TELE 5 HD', 'telecinco'],
    ['ES - TELE CINCO', 'telecinco'],
    ['ES: A3 HD', 'antena 3'],
    ['ES: A3 SERIES HD', 'atreseries'],
    ['ES: ANTENA3 FHD', 'antena 3'],
    ['ES: LA 1 TVE HD', 'la 1'],
    ['TVE - LA 1', 'la 1'],
    ['ES - BEIN SPORTS Ñ FHD', 'bein sports'],
    ['BARÇA TV', 'barca tv'],
    ['À PUNT', 'a punt'],
    ['3/24', '3 24'],
    /* Números con letra detrás de otra palabra; delante, la palabra es el canal. */
    ['IT: RAI UNO SD', 'rai 1'],
    ['UK: BBC ONE HD', 'bbc 1'],
    ['IT: SKY SPORT UNO', 'sky sport 1'],
    ['la uno', 'la 1'],
    ['dazn cuatro', 'dazn 4'],
    ['CUATRO', 'cuatro'],
    ['TEN', 'ten'],
    ['cero', '0'],
    ['#0', '0'],
    /* Otros alfabetos: se pliegan igual a los dos lados. */
    ['RU: ПЕРВЫЙ КАНАЛ', 'первыи канал'],
    /* Nada que buscar. */
    ['HD', ''],
    ['4K FHD', ''],
  ])('«%s» → «%s»', (name, words) => {
    expect(nameSearchWords(name).join(' ')).toBe(words);
  });

  it('lo que no es un país no se quita: «TNT - Sports 1», «RAI - 1», «LA LIGA 1», «DE PELÍCULA»', () => {
    expect(nameSearchKey('TNT - Sports 1')).toBe('tnt sports 1');
    expect(nameSearchKey('RAI - 1')).toBe('rai 1');
    expect(nameSearchKey('LA LIGA 1')).toBe('laliga 1');
    expect(nameSearchKey('DE PELÍCULA')).toBe('de pelicula');
    expect(nameSearchKey('TV-3')).toBe('tv 3');
  });

  it('el país escrito delante (los adornos no son un país)', () => {
    expect(leadingCountry('UK: DAZN 1')).toBe('UK');
    expect(leadingCountry('ES► LA 1')).toBe('ES');
    expect(leadingCountry('ESPAÑA - LA 1')).toBe('ES');
    expect(leadingCountry('ES 4K LA 1')).toBe('ES');
    expect(leadingCountry('VIP - DE: DAZN 1')).toBe('DE');
    expect(leadingCountry('VIP - MOVISTAR LALIGA 4K')).toBeNull();
    expect(leadingCountry('LA LIGA 1')).toBeNull();
    expect(leadingCountry('LAT: ESPN')).toBe('LAT');
  });
});

describe('parseNameQuery: lo que escribe una persona', () => {
  it('el país pedido delante, en cualquier caja; España es «de casa»', () => {
    expect(parseNameQuery('uk: la liga tv')).toMatchObject({ key: 'laliga tv', country: 'UK' });
    expect(parseNameQuery('[es] dazn 1')).toMatchObject({ key: 'dazn 1', country: '' });
    expect(parseNameQuery('de: dazn 1')).toMatchObject({ key: 'dazn 1', country: 'DE' });
    expect(parseNameQuery('de dazn')).toMatchObject({ key: 'de dazn', country: '' });
    expect(parseNameQuery('es').key).toBe('es');
  });

  it('«m», «mov», «m.», «m+» y «movistar plus» delante son Movistar', () => {
    for (const q of ['m laliga', 'mov laliga', 'm. laliga', 'm+ laliga', 'movistar plus laliga'])
      expect(parseNameQuery(q).key, q).toBe('movistar laliga');
  });

  it('«tv», «canal» y «channel» no hace falta encontrarlas (pero se recuerdan)', () => {
    const q = parseNameQuery('laliga tv');
    expect(q.required).toEqual(['laliga']);
    expect(q.typedOptional).toEqual(['tv']);
    expect(parseNameQuery('tv').required).toEqual(['tv']);
  });

  it('alias: Champions, TVE, A3 y TDP buscan además otra cosa', () => {
    expect(parseNameQuery('champions').aliases.map((alias) => alias.query.key)).toEqual([
      'liga de campeones',
    ]);
    expect(parseNameQuery('ucl').aliases.map((alias) => alias.query.key)).toEqual([
      'liga de campeones',
    ]);
    expect(parseNameQuery('champions tour').aliases).toEqual([]);
    expect(parseNameQuery('tve').aliases.map((alias) => alias.query.key)).toContain('la 1');
    expect(parseNameQuery('tdp').aliases.map((alias) => alias.query.key)).toEqual(['teledeporte']);
    /* «a3» ya es Antena 3 por la grafía. */
    expect(parseNameQuery('a3').key).toBe('antena 3');
  });
});

describe('wordMatch y nameTier', () => {
  it.each([
    ['1', '1', 3],
    ['10', '1', 0],
    ['100', '1', 0],
    ['24h', '24', 2],
    ['f10', 'f1', 0],
    ['f1', 'f', 2],
    ['laliga', 'la', 2],
    ['laliga', 'liga', 1],
    ['lasexta', 'sexta', 1],
    ['baloncesto', 'nba', 0],
    ['eurosport', 'sport', 1],
  ] as const)('palabra «%s» con «%s» → %i', (token, word, how) => {
    expect(wordMatch(token, word)).toBe(how);
  });

  const tier = (q: string, name: string): number => nameTier(parseNameQuery(q), nameFactsOf(name));

  it.each([
    ['la 1', 'ES: LA 1 FHD', NAME_TIER.exact],
    ['la1', 'LA 1', NAME_TIER.exact],
    ['la 1', 'LA 1 CATALUNYA', NAME_TIER.prefix],
    ['la1', 'LA 1 CATALUNYA', NAME_TIER.prefix],
    ['la 1', 'LALIGA TV 1', NAME_TIER.partial],
    ['la 1', 'LATINO SPORTS 1', NAME_TIER.partial],
    ['la 1', 'LA 10', -1],
    ['la1', 'LA 10', -1],
    ['la 1', 'LA 100 RADIO', -1],
    ['dazn', 'DAZN 1', NAME_TIER.family],
    ['dazn', 'DAZN LALIGA', NAME_TIER.prefix],
    ['laliga', 'DAZN LALIGA', NAME_TIER.family],
    ['laliga 2', 'DAZN LALIGA 2', NAME_TIER.family],
    ['hypermotion', 'LALIGA TV HYPERMOTION', NAME_TIER.words],
    ['sexta', 'LA SEXTA', NAME_TIER.inside],
    ['tv3', 'M+ LALIGA TV 3', NAME_TIER.partial],
    ['m+ laliga', 'M+ LALIGA TV', NAME_TIER.exact],
    ['m+ laliga', 'M+ LALIGA TV 2', NAME_TIER.family],
    ['m+ vamos', '#VAMOS', NAME_TIER.brandless],
    ['movistar ellas', 'LAS ESTRELLAS', -1],
    ['tve', 'REAL MADRID TV EN', -1],
    ['madridtven', 'REAL MADRID TV EN', NAME_TIER.partial],
  ] as const)('«%s» con «%s» → %i', (q, name, expected) => {
    expect(tier(q, name)).toBe(expected);
  });

  it('un alias como igual o de la familia va delante («champions» → M+ Liga de Campeones)', () => {
    const q = parseNameQuery('champions');
    expect(nameTierWithAliases(q, nameFactsOf('M+ LIGA DE CAMPEONES 2'))).toEqual({
      tier: NAME_TIER.family,
      lead: true,
    });
    expect(nameTierWithAliases(q, nameFactsOf('CHAMPIONS TV'))).toEqual({
      tier: NAME_TIER.exact,
      lead: false,
    });
  });
});

describe('compareNameRank', () => {
  const rank = (tier: number, country: string | null, favorite = false, asked = '') => ({
    tier,
    region: regionRank(country, asked),
    favorite,
  });

  it('lo flojo detrás de todo lo bueno, sea del país que sea', () => {
    const weakHome = rank(NAME_TIER.partial, 'ES');
    const exactAbroad = rank(NAME_TIER.exact, 'SE');
    expect(compareNameRank(exactAbroad, weakHome)).toBeLessThan(0);
  });

  it('entre lo bueno, España (o sin país) antes; luego América en español; el país pedido, el primero', () => {
    expect(compareNameRank(rank(NAME_TIER.words, null), rank(NAME_TIER.exact, 'DE'))).toBeLessThan(
      0,
    );
    expect(compareNameRank(rank(1, 'MX'), rank(1, 'UK'))).toBeLessThan(0);
    expect(compareNameRank(rank(1, 'DE', false, 'DE'), rank(0, 'ES', false, 'DE'))).toBeLessThan(0);
  });

  it('lo igual primero; luego tus favoritos; luego el nivel', () => {
    expect(compareNameRank(rank(0, 'ES'), rank(2, 'ES', true))).toBeLessThan(0);
    expect(compareNameRank(rank(3, 'ES', true), rank(2, 'ES'))).toBeLessThan(0);
    expect(compareNameRank(rank(2, 'ES'), rank(3, 'ES'))).toBeLessThan(0);
  });
});

describe('nameHighlights', () => {
  it.each([
    ['la 1', 'LA 1 CATALUNYA', ['LA', '1']],
    ['laliga', 'DAZN LA LIGA', ['LA LIGA']],
    ['m+ laliga', 'M+ LaLiga TV', ['M', 'LaLiga']],
    ['dazn', 'DAZN 1', ['DAZN']],
    ['la se', 'La Sexta', ['La', 'Se']],
    ['tele 5', 'TELECINCO', ['TELECINCO']],
    ['zzz', 'La 1', []],
  ] as const)('«%s» en «%s»', (q, text, parts) => {
    expect(nameHighlights(q, text).map(([start, end]) => text.slice(start, end))).toEqual(parts);
  });
});

/* --- El corpus: una fila por canal (palabras y país), como hace el servidor --- */

function groupCountry(group: string): string | null {
  const parts = group.split('|').map((part) => part.trim().toUpperCase());
  if (parts.length >= 2 && ['EU', 'AM', 'AS', 'AF'].includes(parts[0] as string))
    return parts[1] as string;
  if (/^LATINO\b/.test(parts[0] as string)) return 'LAT';
  return /^[A-Z]{2,4}$/.test(parts[0] as string) ? (parts[0] as string) : null;
}

interface Row {
  readonly key: string;
  readonly country: string | null;
  readonly facts: NameFacts;
}

function rowsOf(corpus: readonly CanalCorpus[]): Row[] {
  const rows = new Map<string, Row>();
  for (const { title, group } of corpus) {
    const words = nameSearchWords(title);
    if (!words.length || /#{3,}|no match|:\s.*\b(?:am|pm)\b/i.test(title)) continue;
    const raw = leadingCountry(title) ?? groupCountry(group);
    const country = raw === 'ES' ? null : raw;
    /* Una fila por canal: las mismas palabras que cuentan (sin «tv»), como junta el servidor «M. LALIGA» y «M+
       LaLiga TV». */
    const facts = nameFacts(words);
    const id = `${facts.sig}|${country ?? ''}`;
    if (!rows.has(id)) rows.set(id, { key: words.join(' '), country, facts });
  }
  return [...rows.values()];
}

const label = (row: Row): string => `${row.facts.sig}${row.country ? `/${row.country}` : ''}`;

describe('el corpus de nombres raros: consulta → los primeros (esperados.ts)', () => {
  const rows = rowsOf(corpusIptv());

  it('cada forma de «La 1» es la misma fila', () => {
    const la1 = rows.filter((row) => row.key === 'la 1' && !row.country);
    expect(la1).toHaveLength(1);
    expect(rows.filter((row) => /^es\b|\bes$/.test(row.key))).toEqual([]);
  });

  it.each(ESPERADOS.map((item) => [item.q, item] as const))('«%s»', (_q, esperado) => {
    const found = rankByName(rows, esperado.q, (row) => ({
      name: row.key,
      facts: row.facts,
      country: row.country,
    })).map(label);
    checkEsperado(found, esperado);
  });

  it('un favorito pasa delante de lo que no es igual, pero nunca de lo igual', () => {
    const favorite = (row: Row) => row.key === 'la 1 catalunya';
    const found = rankByName(rows, 'la 1', (row) => ({
      name: row.key,
      facts: row.facts,
      country: row.country,
      favorite: favorite(row),
    })).map(label);
    expect(found.slice(0, 2)).toEqual(['la 1', 'la 1 catalunya']);
  });
});

describe('@lento rendimiento: 20 000 canales al teclear', () => {
  it('cada tecla (con los nombres ya preparados) en menos de 40 ms (mediana)', () => {
    const corpus = corpusIptvGrande(20_000);
    expect(corpus).toHaveLength(20_000);
    const start = performance.now();
    const rows = rowsOf(corpus);
    const prepared = performance.now() - start;
    /* Preparar los nombres es una vez por sincronización: con margen, menos de 3 s. */
    expect(prepared).toBeLessThan(3000);
    const typed = [
      'l',
      'la',
      'la ',
      'la 1',
      'd',
      'da',
      'daz',
      'dazn',
      'dazn 1',
      'm+',
      'm+ la',
      'm+ laliga',
    ];
    const times: number[] = [];
    for (const q of typed) {
      const t0 = performance.now();
      rankByName(rows, q, (row) => ({ name: row.key, facts: row.facts, country: row.country }));
      times.push(performance.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(40);
  });
});
