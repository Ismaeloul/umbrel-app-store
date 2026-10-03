/* Buscar por nombre (0.9.0, docs/buscador.md): las palabras de un nombre tal
   cual lo da un panel IPTV, lo que escribe una persona, el nivel de
   parecido, el orden, el resaltado, el corpus de nombres raros (consulta →
   los primeros) y el rendimiento con 20 000 canales. */

import { describe, expect, it } from 'vitest';
import {
  NAME_TIER,
  compareNameRank,
  keySearchTokens,
  keySearchWords,
  leadingCountry,
  nameFacts,
  nameFactsOf,
  nameHighlights,
  nameSearchKey,
  nameSearchTokens,
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
    ['LA1HD', 'la1'],
    ['DAZN1FHD', 'dazn1'],
    ['CANAL 24 HORAS', 'canal 24h'],
    /* Reservas y copias (el número de la copia no es el del canal). */
    ['ES: LA 1 (backup)', 'la 1'],
    ['ES: LA 1 (2)', 'la 1'],
    ['ES: LA 1 [2] ★', 'la 1'],
    ['DAZN 1 (2) HD', 'dazn 1'],
    /* «#N» sí es el número del canal: «LALIGA+ PPV #2» es otro evento que el #1. */
    ['ES: LALIGA+ PPV #2', 'laligaplus ppv 2'],
    ['US: NBA LEAGUE PASS #3 HD', 'nba league pass 3'],
    ['ES: LA 1 #2', 'la 1 2'],
    ['ES - M. LALIGA HD (BK-1)', 'movistar laliga'],
    ['ES - LASEXTA ᴿᴬᵂ', 'lasexta'],
    /* Grafías: Movistar, LaLiga, Telecinco, Antena 3, RTVE, Ñ. */
    ['ES: M+ LALIGA TV FHD', 'movistar laliga tv'],
    ['ES: MOVISTAR PLUS+ 4K', 'movistar'],
    ['ES: M+ PLUS HD', 'movistar'],
    ['ES: M+ #0 HD', 'movistar 0'],
    ['ES: #VAMOS FHD', 'vamos'],
    ['LALIGA+ PPV 1', 'laligaplus ppv 1'],
    ['laliga+', 'laligaplus'],
    ['LALIGA+ ★', 'laligaplus'],
    /* Los apodos de España, solo si el nombre lo es (el TELE 5 alemán y el polaco no son Telecinco). */
    ['ES: TELE5 SD', 'telecinco'],
    ['ES - TELE 5 HD', 'telecinco'],
    ['DE: TELE 5 HD', 'tele 5'],
    ['TELE 5 FHD', 'tele 5'],
    ['PL| TELE 5', 'tele 5'],
    ['ES - TELE CINCO', 'telecinco'],
    ['TELE CINCO', 'telecinco'],
    ['ES: A3 HD', 'antena 3'],
    ['UK: A3', 'a3'],
    ['ES: A3 SERIES HD', 'atreseries'],
    ['ES: ANTENA3 FHD', 'antena 3'],
    ['RO: ANTENA3 CNN', 'antena 3 cnn'],
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

  it.each([
    /* Títulos de Pelis y series: la palabra de 2 o 3 letras de delante es del título. */
    ['Mr. Robot', 'mr robot'],
    ['Dr. Strange', 'dr strange'],
    ['St. Vincent', 'st vincent'],
    ['It: Capítulo 2', 'it capitulo 2'],
    ['No: la película', 'no la pelicula'],
    ['Up - Una aventura de altura', 'up una aventura de altura'],
    ['MR. ROBOT', 'mr robot'],
    ['TOP GUN: MAVERICK', 'top gun maverick'],
    /* Siglas pegadas a «&», «+», «!», «/» o «#»: parte del nombre. */
    ['AT&T SPORTSNET', 'at t sportsnet'],
    ['BT+ SPORT', 'bt sport'],
    ['GO! TV', 'go tv'],
    ['AC/DC LIVE', 'ac dc live'],
    ['PPV #3', 'ppv 3'],
    /* Los países de siempre se siguen quitando. */
    ['IT: RAI 1 HD', 'rai 1'],
    ['UK: AT&T SPORTSNET', 'at t sportsnet'],
    ['VIP ES: TELE 5', 'telecinco'],
  ])('«%s» → «%s» (no es un país)', (name, words) => {
    expect(nameSearchKey(name)).toBe(words);
  });

  it('rankByName encuentra «Mr. Robot», «Dr. Strange» o «It: Capítulo 2» como se escriben', () => {
    const titles = [
      'Mr. Robot',
      'Robot Wars',
      'Dr. Strange',
      'It: Capítulo 2',
      'St. Vincent',
      'Up - Una aventura de altura',
    ];
    const find = (q: string): string[] => rankByName(titles, q, (name) => ({ name }));
    expect(find('mr robot')).toEqual(['Mr. Robot']);
    expect(find('dr strange')).toEqual(['Dr. Strange']);
    expect(find('it capitulo 2')).toEqual(['It: Capítulo 2']);
    expect(find('st vincent')).toEqual(['St. Vincent']);
    expect(find('robot')[0]).toBe('Robot Wars');
    /* Escrito con la primera en mayúscula (el teclado del iPhone), igual. */
    expect(find('Mr. Robot')).toEqual(['Mr. Robot']);
    expect(find('It capitulo 2')).toEqual(['It: Capítulo 2']);
    expect(find('Up una aventura')).toEqual(['Up - Una aventura de altura']);
    expect(find('Up - Una aventura')).toEqual(['Up - Una aventura de altura']);
  });

  it('nameSearchTokens y keySearchTokens recuerdan los números escritos con letra', () => {
    expect(nameSearchTokens('UK: BBC ONE HD')).toEqual({
      words: ['bbc', '1'],
      spelled: { 1: 'one' },
    });
    expect(nameSearchTokens('Los Tres Mosqueteros').spelled).toEqual({ 3: 'tres' });
    expect(nameSearchTokens('LA 1').spelled).toEqual({});
    expect(keySearchTokens('rai uno')).toEqual({ words: ['rai', '1'], spelled: { 1: 'uno' } });
    /* La primera palabra no pasa a cifra: «Cuatro» es el canal. */
    expect(keySearchTokens('cuatro')).toEqual({ words: ['cuatro'], spelled: {} });
  });

  it('keySearchWords: lo mismo, más rápido, con una clave ya normalizada del catálogo', () => {
    expect(keySearchWords('rai uno')).toEqual(['rai', '1']);
    expect(keySearchWords('movistar laliga tv 2')).toEqual(['movistar', 'laliga', 'tv', '2']);
    expect(keySearchWords('cuatro')).toEqual(['cuatro']);
    /* La clave ya lleva los apodos si el canal es de España («a3» a secas es de otro sitio). */
    expect(keySearchWords('a3')).toEqual(['a3']);
    expect(keySearchWords('0')).toEqual(['0']);
    /* Con algo que no es una clave normalizada, como `nameSearchWords`. */
    expect(keySearchWords('ES: LA 1 HD')).toEqual(['la', '1']);
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
    expect(leadingCountry('VIP ES: LA 1')).toBe('ES');
    expect(leadingCountry('Mr. Robot')).toBeNull();
    expect(leadingCountry('It: Capítulo 2')).toBeNull();
    expect(leadingCountry('AT&T SPORTSNET')).toBeNull();
  });
});

describe('parseNameQuery: lo que escribe una persona', () => {
  it('el país pedido delante, en cualquier caja; España es «de casa»', () => {
    expect(parseNameQuery('uk: la liga tv')).toMatchObject({
      key: 'laliga tv',
      text: 'la liga tv',
      country: 'UK',
    });
    expect(parseNameQuery('[es] dazn 1')).toMatchObject({ key: 'dazn 1', country: '' });
    expect(parseNameQuery('de: dazn 1')).toMatchObject({ key: 'dazn 1', country: 'DE' });
    expect(parseNameQuery('de dazn')).toMatchObject({ key: 'de dazn', country: '' });
    expect(parseNameQuery('es').key).toBe('es');
  });

  it('la caja no cuenta: «Es la 1» o «Esp dazn» (el teclado del iPhone) son «es la 1» y «esp dazn»', () => {
    expect(parseNameQuery('Es la 1')).toMatchObject({ key: 'la 1', country: '' });
    expect(parseNameQuery('Esp dazn')).toMatchObject({ key: 'dazn', country: '' });
    expect(parseNameQuery('Es dazn')).toMatchObject({ key: 'dazn', country: '' });
    expect(parseNameQuery('Es tele 5').key).toBe('telecinco');
    expect(parseNameQuery('Es a3').key).toBe('antena 3');
    expect(parseNameQuery('Uk: la liga tv')).toMatchObject({ key: 'laliga tv', country: 'UK' });
    /* Lo que no es un país sigue siendo una palabra, con mayúscula o sin ella. */
    expect(parseNameQuery('Mr robot').key).toBe('mr robot');
    expect(parseNameQuery('It capitulo 2').key).toBe('it capitulo 2');
    expect(parseNameQuery('De dazn').key).toBe('de dazn');
    /* Toda la tabla de esperados.ts (y algunas más), en minúsculas, en mayúsculas y con la primera en mayúscula. */
    const parsed = (q: string) => {
      const { key, country, required, typedOptional, aliases } = parseNameQuery(q);
      return { key, country, required, typedOptional, aliases };
    };
    const extra = ['es la 1', 'esp dazn', 'es: dazn', 'mr. robot', 'up una aventura', 'it: rai 1'];
    for (const q of [...ESPERADOS.map((item) => item.q), ...extra]) {
      const lower = parsed(q.toLowerCase());
      expect(parsed(q.toUpperCase()), q).toEqual(lower);
      expect(parsed(q.charAt(0).toUpperCase() + q.slice(1).toLowerCase()), q).toEqual(lower);
    }
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

  it('alias: Champions, TVE, A3, A3 Series, Tele 5 y TDP buscan además otra cosa', () => {
    expect(parseNameQuery('champions').aliases.map((alias) => alias.query.key)).toEqual([
      'liga de campeones',
    ]);
    expect(parseNameQuery('ucl').aliases.map((alias) => alias.query.key)).toEqual([
      'liga de campeones',
    ]);
    expect(parseNameQuery('champions tour').aliases).toEqual([]);
    expect(parseNameQuery('tve').aliases.map((alias) => alias.query.key)).toContain('la 1');
    expect(parseNameQuery('tdp').aliases.map((alias) => alias.query.key)).toEqual(['teledeporte']);
    /* Los apodos de España se buscan como alias: lo escrito sigue encontrando el «TELE 5» alemán o el «A3» de fuera. */
    const aliasesOf = (q: string): string[] =>
      parseNameQuery(q).aliases.map((alias) => alias.query.key);
    expect(parseNameQuery('a3').key).toBe('a3');
    expect(aliasesOf('a3')).toEqual(['antena 3']);
    expect(aliasesOf('a3 series')).toEqual(['atreseries']);
    expect(aliasesOf('tele 5')).toEqual(['telecinco']);
    expect(aliasesOf('tele5')).toEqual(['telecinco']);
    expect(aliasesOf('telecinco')).toEqual([]);
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
    ['espnbasket', 'nba', 0],
    ['eurosport', 'sport', 1],
    /* Por dentro desde 4 letras: «liga» en LaLiga+, Bundesliga o Euroliga. */
    ['laligaplus', 'liga', 1],
    ['bundesliga', 'liga', 1],
    ['euroliga', 'liga', 1],
    ['motogp', 'gp', 1],
    ['estrellas', 'tre', 0],
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
    /* Los números escritos con letra se encuentran por su palabra, entera o al teclearla. */
    ['bbc on', 'UK: BBC ONE HD', NAME_TIER.prefix],
    ['bbc o', 'UK: BBC ONE HD', NAME_TIER.prefix],
    ['bbc one', 'UK: BBC ONE HD', NAME_TIER.exact],
    ['one', 'UK: BBC ONE HD', NAME_TIER.words],
    ['rai u', 'IT: RAI UNO SD', NAME_TIER.prefix],
    ['uno', 'IT: RAI UNO SD', NAME_TIER.words],
    ['tres mosqueteros', 'Los Tres Mosqueteros', NAME_TIER.words],
    ['uno', 'IT: RAI 1 SD', -1],
    ['ne', 'UK: BBC ONE HD', -1],
    /* Solo relleno escrito: el relleno del nombre también cuenta. */
    ['canal', 'CANAL 5', NAME_TIER.prefix],
    ['canal sur', 'CANAL SUR', NAME_TIER.exact],
    ['tv 3', 'TV3', NAME_TIER.exact],
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
    /* Lo que busca un alias también se marca. */
    ['tele 5', 'TELECINCO', ['TELECINCO']],
    ['tele 5', 'TELE 5', ['TELE', '5']],
    ['a3', 'ANTENA 3 HD', ['ANTENA', '3']],
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
    const { words, spelled } = nameSearchTokens(title);
    if (!words.length || /#{3,}|no match|:\s.*\b(?:am|pm)\b/i.test(title)) continue;
    const raw = leadingCountry(title) ?? groupCountry(group);
    const country = raw === 'ES' ? null : raw;
    /* Una fila por canal: las mismas palabras que cuentan (sin «tv»), como junta el servidor «M. LALIGA» y «M+
       LaLiga TV». */
    const facts = nameFacts(words, spelled);
    const id = `${facts.sig}|${country ?? ''}`;
    const known = rows.get(id);
    if (!known) {
      rows.set(id, { key: words.join(' '), country, facts });
      continue;
    }
    /* «RAI 1» y «RAI UNO» son la misma fila: la fila recuerda también cómo se escribía con letra. */
    if (!Object.keys(spelled).length) continue;
    const merged = { ...spelled, ...known.facts.spelled };
    rows.set(id, { ...known, facts: nameFacts(known.facts.words, merged) });
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
