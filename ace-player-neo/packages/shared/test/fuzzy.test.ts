/* Buscador «como Google» (docs/iptv.md §20): plegado, erratas, alias, orden,
   «Quizás quisiste decir» y lo que NO debe casar. Estas pruebas son también
   los vectores que portará la app nativa. */

import { describe, expect, it } from 'vitest';
import {
  FuzzySearchIndex,
  FuzzyVocabulary,
  aliasReadings,
  canonicalAliasText,
  correctQuery,
  documentWords,
  editDistance,
  fuzzyFilter,
  namedGroups,
  phoneticKey,
  requiredWords,
  searchFold,
  searchWords,
  typoBudget,
  typoDistance,
} from '../src/index.js';

describe('searchFold', () => {
  it.each([
    ['Fútbol', 'futbol'],
    ['ESPAÑA', 'espana'],
    ['Barça', 'barca'],
    ['M+ LaLiga TV', 'movistar laliga tv'],
    ['M. LALIGA 1', 'movistar laliga 1'],
    ['La Liga', 'laliga'],
    ['LA SEXTA', 'lasexta'],
    ['Antena3 HD', 'antena 3 hd'],
    ['t5', 't 5'],
    ['LASEXTA ᴿᴬᵂ', 'lasexta raw'],
    ['1ª Federación', '1 a federacion'],
    ['  Real   Madrid  ', 'real madrid'],
    ['Canal+', 'canal plus'],
    ['LaLiga+', 'laligaplus'],
  ])('%s → %s', (input, output) => {
    expect(searchFold(input)).toBe(output);
  });

  it('las palabras de un texto incluyen las partes de sus compuestos', () => {
    expect(documentWords('Movistar LaLiga')).toEqual(['movistar', 'laliga', 'la', 'liga']);
    expect(documentWords('laSexta')).toContain('sexta');
    expect(searchWords('')).toEqual([]);
  });

  it('artículos opcionales con 2 palabras de verdad; «tv» y «canal» con una', () => {
    expect(requiredWords(['atletico', 'de', 'madrid'])).toEqual([true, false, true]);
    expect(requiredWords(['la', '1'])).toEqual([true, true]);
    expect(requiredWords(['gol', 'tv'])).toEqual([true, false]);
  });
});

describe('erratas', () => {
  it('presupuesto: 0 hasta 3 letras, 1 desde 4 y 2 desde 8', () => {
    expect([2, 3, 4, 7, 8, 12].map(typoBudget)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('Damerau: cambio, letra de más, de menos y letras cambiadas de orden cuentan 1', () => {
    expect(editDistance('eurosport', 'eurosprot')).toBe(1);
    expect(editDistance('antena', 'antna')).toBe(1);
    expect(editDistance('dazn', 'dazm')).toBe(1);
    expect(editDistance('ingalterra', 'inglaterra')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });

  it.each([
    ['inglaterra', 'inglatera'],
    ['villarreal', 'villareal'],
    ['barsa', 'barza'],
    ['telecinco', 'telecinko'],
    ['dazn', 'dasn'],
    ['valencia', 'balencia'],
    ['sevilla', 'seviya'],
    ['hypermotion', 'ypermotion'],
    ['quique', 'kike'],
    ['girona', 'jirona'],
  ])('clave fonética: %s = %s', (a, b) => {
    expect(phoneticKey(a)).toBe(phoneticKey(b));
  });

  it.each([
    ['inglatera', 'inglaterra', 0],
    ['ingalterra', 'inglaterra', 1],
    ['eurosprot', 'eurosport', 1],
    ['telecinko', 'telecinco', 0],
    ['dasn', 'dazn', 0],
    ['dazm', 'dazn', 1],
    ['antna', 'antena', 1],
    ['barsa', 'barca', 1],
    ['campeonse', 'campeones', 1],
    ['barcleona', 'barcelona', 1],
    ['barcelnoa', 'barcelona', 1],
  ])('%s → %s (distancia %i)', (word, token, distance) => {
    expect(typoDistance(word, token)).toBe(distance);
  });

  it.each([
    ['getafe', 'gerona'],
    ['dazn 1', 'dazn 2'],
    ['1', '2'],
    ['rma', 'rmb'],
    ['sociedad', 'madrid'],
    ['sevilla', 'mallorca'],
  ])('%s NO es una errata de %s', (word, token) => {
    expect(typoDistance(word, token)).toBeNull();
  });

  it('el vocabulario encuentra erratas y prefijos, y los números solo enteros', () => {
    const vocabulary = new FuzzyVocabulary([
      'inglaterra',
      'espana',
      'telecinco',
      'dazn',
      '1',
      '10',
    ]);
    expect(vocabulary.corrections('inglatera').map((item) => item.token)).toEqual(['inglaterra']);
    expect(vocabulary.corrections('telecinko')[0]?.token).toBe('telecinco');
    expect(vocabulary.corrections('inglaterra')).toEqual([]);
    expect(vocabulary.hasPrefix('ingl')).toBe(true);
    expect(vocabulary.matchesPlain('1')).toBe(true);
    expect(vocabulary.corrections('11')).toEqual([]);
    expect(correctQuery('dasn 1', vocabulary)).toEqual({ text: 'dazn 1', changed: true });
    expect(correctQuery('dazn 1', vocabulary)).toEqual({ text: 'dazn 1', changed: false });
  });
});

describe('alias', () => {
  it('lecturas: cada alias por los nombres «de verdad» de su grupo', () => {
    const readings = aliasReadings(searchWords('t5')).map((reading) => reading.words.join(' '));
    expect(readings).toEqual(['telecinco']);
    expect(aliasReadings(searchWords('m+ champions')).map((r) => r.words.join(' '))).toContain(
      'movistar liga de campeones',
    );
    /* Nunca por un nombre más corto que el escrito. */
    expect(aliasReadings(searchWords('real madrid')).map((r) => r.words.join(' '))).not.toContain(
      'madrid',
    );
  });

  it('el nombre de siempre para mandar al motor', () => {
    expect(canonicalAliasText('t5')).toBe('Telecinco');
    expect(canonicalAliasText('champions')).toBe('Liga de Campeones');
    expect(canonicalAliasText('la 6')).toBe('laSexta');
    expect(canonicalAliasText('rmtv')).toBe('Real Madrid TV');
    expect(canonicalAliasText('telecinco')).toBeNull();
    expect(canonicalAliasText('nada que ver')).toBeNull();
  });

  it('qué nombra un texto: el nombre más largo, y los «~» nunca', () => {
    expect([...namedGroups(searchWords('LaLiga Hypermotion'))]).toEqual(['hypermotion']);
    expect([...namedGroups(searchWords('Atlético de Madrid'))]).toEqual(['atletico-madrid']);
    expect([...namedGroups(searchWords('Madrid CFF'))]).toEqual([]);
    expect([...namedGroups(searchWords('Espanyol ESP'))]).toEqual(['espanyol']);
  });
});

/* Una agenda pequeña como la de verdad: cada partido con sus equipos, siglas, competición y canales. */
interface Match {
  home: string;
  away: string;
  competition: string;
  channels: string[];
  shorts: string[];
}
const MATCHES: Match[] = [
  {
    home: 'Inglaterra',
    away: 'España',
    competition: 'Amistoso',
    channels: ['La 1 TVE'],
    shorts: ['ING', 'ESP'],
  },
  {
    home: 'Espanyol',
    away: 'Getafe',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga'],
    shorts: ['ESP', 'GET'],
  },
  {
    home: 'Real Madrid',
    away: 'Manchester City',
    competition: 'Champions League',
    channels: ['M+ Liga de Campeones'],
    shorts: ['RMA', 'MCI'],
  },
  {
    home: 'Atlético de Madrid',
    away: 'Girona',
    competition: 'LaLiga',
    channels: ['DAZN LaLiga'],
    shorts: ['ATM', 'GIR'],
  },
  {
    home: 'Real Sociedad',
    away: 'Villarreal',
    competition: 'LaLiga',
    channels: ['M+ LaLiga TV'],
    shorts: ['RSO', 'VIL'],
  },
  {
    home: 'FC Barcelona',
    away: 'Juventus',
    competition: 'Amistoso',
    channels: ['DAZN'],
    shorts: ['FCB', 'JUV'],
  },
  {
    home: 'Real Oviedo',
    away: 'Sporting de Gijón',
    competition: 'LaLiga Hypermotion',
    channels: ['LaLiga TV Hypermotion'],
    shorts: ['OVI', 'SPO'],
  },
  {
    home: 'Barcelona',
    away: 'Madrid CFF',
    competition: 'Liga F',
    channels: ['DAZN 1'],
    shorts: ['BAR', 'MAD'],
  },
  {
    home: 'Levante',
    away: 'Eibar',
    competition: 'LaLiga Hypermotion',
    channels: ['DAZN 2'],
    shorts: ['LEV', 'EIB'],
  },
  {
    home: 'Noruega',
    away: 'Portugal',
    competition: 'Nations League',
    channels: ['Teledeporte'],
    shorts: ['NOR', 'POR'],
  },
];
const matchIndex = new FuzzySearchIndex(MATCHES, (match) => [
  match.home,
  match.away,
  match.competition,
  ...match.channels,
  ...match.shorts,
]);
const titles = (query: string) =>
  matchIndex.search(query).map((hit) => `${hit.item.home} – ${hit.item.away}`);

describe('buscar partidos (lo que pide Isma)', () => {
  it.each([
    ['inglatera', 'Inglaterra – España'],
    ['Inglatera', 'Inglaterra – España'],
    ['ingalterra', 'Inglaterra – España'],
    ['esp', 'Inglaterra – España'],
    ['ESP', 'Inglaterra – España'],
    ['españa', 'Inglaterra – España'],
    ['espana', 'Inglaterra – España'],
    ['la roja', 'Inglaterra – España'],
    ['ing esp', 'Inglaterra – España'],
    ['ingl', 'Inglaterra – España'],
    ['barsa', 'FC Barcelona – Juventus'],
    ['barça', 'FC Barcelona – Juventus'],
    ['barc', 'FC Barcelona – Juventus'],
    ['fcb', 'FC Barcelona – Juventus'],
    ['champions', 'Real Madrid – Manchester City'],
    ['ucl', 'Real Madrid – Manchester City'],
    ['liga de campeones', 'Real Madrid – Manchester City'],
    ['m+ liga de campeone', 'Real Madrid – Manchester City'],
    ['madrid', 'Real Madrid – Manchester City'],
    ['rma', 'Real Madrid – Manchester City'],
    ['atleti', 'Atlético de Madrid – Girona'],
    ['atletico madrid', 'Atlético de Madrid – Girona'],
    ['la real', 'Real Sociedad – Villarreal'],
    ['villareal', 'Real Sociedad – Villarreal'],
    ['el submarino', 'Real Sociedad – Villarreal'],
    ['liga f', 'Barcelona – Madrid CFF'],
    ['nations league', 'Noruega – Portugal'],
    ['unl', 'Noruega – Portugal'],
    ['tdp', 'Noruega – Portugal'],
    ['dasn 1', 'Barcelona – Madrid CFF'],
  ])('«%s» → %s primero', (query, first) => {
    expect(titles(query)[0]).toBe(first);
  });

  it('«madrid» → el Real Madrid primero y luego el Atlético', () => {
    const found = titles('madrid');
    expect(found[0]).toBe('Real Madrid – Manchester City');
    expect(found).toContain('Atlético de Madrid – Girona');
  });

  it('«esp» → España antes que el Espanyol (que también es ESP)', () => {
    const found = titles('esp');
    expect(found.indexOf('Inglaterra – España')).toBeLessThan(found.indexOf('Espanyol – Getafe'));
  });

  it('lo que NO debe casar', () => {
    /* DAZN 1 frente a DAZN 2. */
    expect(titles('dazn 1')).toEqual(['Barcelona – Madrid CFF']);
    expect(titles('dazn 2')).toEqual(['Levante – Eibar']);
    /* Real Madrid frente a Real Sociedad. */
    expect(titles('real madrid')).toEqual(['Real Madrid – Manchester City']);
    expect(titles('real sociedad')).toEqual(['Real Sociedad – Villarreal']);
    /* «Getafe» no es «Gerona». */
    expect(titles('getafe')).toEqual(['Espanyol – Getafe']);
    expect(titles('gerona')).toEqual(['Atlético de Madrid – Girona']);
    /* «Liga F» no es «LaLiga». */
    expect(titles('liga f')).toEqual(['Barcelona – Madrid CFF']);
    /* «Hypermotion» no es Primera, y «primera» no trae Hypermotion. */
    expect(new Set(titles('hypermotion'))).toEqual(
      new Set(['Real Oviedo – Sporting de Gijón', 'Levante – Eibar']),
    );
    expect(new Set(titles('segunda'))).toEqual(
      new Set(['Real Oviedo – Sporting de Gijón', 'Levante – Eibar']),
    );
    expect(titles('primera')).not.toContain('Real Oviedo – Sporting de Gijón');
    expect(titles('primera')).not.toContain('Levante – Eibar');
    expect(titles('primera')).toContain('Espanyol – Getafe');
  });

  it('orden: exacta → prefijo → alias → errata', () => {
    const hits = matchIndex.search('madrid');
    expect(hits[0]?.preferred).toBe(true);
    expect(matchIndex.search('ingl')[0]?.tier).toBe(1);
    expect(matchIndex.search('inglatera')[0]?.tier).toBe(3);
  });

  it('«Quizás quisiste decir» solo cuando no sale nada, con la palabra bien escrita', () => {
    expect(matchIndex.search('nroega')).toEqual([]);
    expect(matchIndex.suggest('nroega')).toBe('Noruega');
    expect(matchIndex.suggest('xyzzy')).toBeNull();
  });
});

describe('fuzzyFilter (biblioteca y canales)', () => {
  const library = [
    { title: 'Telecinco HD', category: 'TDT' },
    { title: 'M. LALIGA 1', category: 'Deportes' },
    { title: 'DAZN 1 FHD', category: 'Deportes' },
    { title: 'DAZN 2 FHD', category: 'Deportes' },
    { title: 'LA SEXTA', category: 'TDT' },
    { title: 'Real Madrid TV', category: 'Clubes' },
    { title: 'Teledeporte', category: 'TDP' },
  ];
  const filter = (query: string) =>
    fuzzyFilter(library, query, (item) => [item.title, item.category]).map((item) => item.title);

  it.each([
    ['telecinko', 'Telecinco HD'],
    ['tele 5', 'Telecinco HD'],
    ['t5', 'Telecinco HD'],
    ['m+ laliga', 'M. LALIGA 1'],
    ['movistar la liga', 'M. LALIGA 1'],
    ['la 6', 'LA SEXTA'],
    ['lasexta', 'LA SEXTA'],
    ['rmtv', 'Real Madrid TV'],
    ['tdp', 'Teledeporte'],
    ['dasn', 'DAZN 1 FHD'],
  ])('«%s» → %s', (query, first) => {
    expect(filter(query)[0]).toBe(first);
  });

  it('DAZN 1 no trae DAZN 2', () => {
    expect(filter('dazn 1')).toEqual(['DAZN 1 FHD']);
  });

  it('rápido: 5000 canales en milisegundos', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      title: `Canal ${i} Deportes`,
      category: `Grupo ${i % 40}`,
    }));
    const index = new FuzzySearchIndex(many, (item) => [item.title, item.category]);
    const started = performance.now();
    for (const query of ['deprotes', 'canal 42', 'grupo 7', 'depo']) index.search(query);
    expect(performance.now() - started).toBeLessThan(400);
  });
});
