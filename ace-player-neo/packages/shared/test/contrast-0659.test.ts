/* Contraste de las funciones puras de @ace/shared con las ORIGINALES de la
   0.6.59, sobre muchas entradas raras: vacías, null, mayúsculas, tildes,
   `acestream://`, URLs con `?id=`, flechas de proveedor, coletillas de
   calidad… Si una sola difiere, el port no es fiel (plan §3, riesgo R1).

   - server.js: las exportadas se llaman tal cual; las que no exporta
     (`cleanTitle`, `channelDialNumbers`, `channelAllowsFamilyFallback`) se
     extraen del código fuente con el mismo truco de T-088.
   - index.html: las reglas de "Para ti" se extraen como hacía T-101.
   - player-controller.js: es UMD y se requiere tal cual. */

import { describe, expect, it } from 'vitest';
import {
  channelAllowsFamilyFallback,
  channelDialNumbers,
  channelMatchScore,
  cleanTitle,
  competitionKey,
  esFamiliaDe,
  footballMatchHighlighted,
  footballMatchInScope,
  footballTeamKey,
  leagueMatches,
  matchIsLaLigaHypermotion,
  motivoDeFallo,
  normalizeChannelKey,
  normalizeHash,
  normalizePreferenceKey,
  readSeekWindow,
  resolveLiveTarget,
  semanticChannelText,
  semanticNumbersCompatible,
  type ForYouMatch,
  type ForYouPreferences,
  type SeekWindow,
} from '../src/index.js';
import {
  compileLegacyPieces,
  extractBlock,
  extractFunction,
  loadLegacyPlayerCore,
  loadLegacyServer,
  readLegacyFile,
} from '../scripts/lib/legacy-0659.js';

const legacy = loadLegacyServer();
const serverSource = readLegacyFile('server.js');
const indexHtml = readLegacyFile('index.html');
const playerCore = loadLegacyPlayerCore();

const HEX = '0123456789abcdef'.repeat(2) + '01234567';
const HEX_UPPER = HEX.toUpperCase();

/** Entradas de texto raras que se prueban contra casi todo. */
const RAROS: unknown[] = [
  '',
  '   ',
  null,
  undefined,
  0,
  1,
  false,
  true,
  {},
  [],
  ['DAZN', '1'],
  'DAZN',
  'dazn 1',
  'DAZN 1 720p **',
  'DAZN F1',
  'DAZN LaLiga 2 FHD',
  'M+ Liga de Campeones',
  'M+ LIGA DE CAMPEONES 1 FHD --> ELCANO',
  'm + laliga',
  'Movistar Plus+ LaLiga',
  'MOVISTAR PLUS LALIGA TV',
  'LIGA DE CAMPEONES => SPORT TV',
  'LIGA DE CAMPEONES ==> SPORT TV',
  'LIGA DE CAMPEONES -> X',
  'LIGA DE CAMPEONES ⟹ X',
  'LaLiga TV Hypermotion',
  'LALIGA TV HYPERMOTION 2',
  'Gol Play HD',
  'GOL PLAY 4K',
  'Eurosport 1 UHD 1080p',
  'Eurosport 2 720p',
  'Canal+ España',
  'Teledeporte España HD',
  'La 1 (Spain)',
  'TV3 Catalunya',
  'Ñoño TV',
  'Fútbol Réplica',
  'Àçcèñtös Ümläut',
  'BEIN SPORTS 1 MENA',
  'beIN Sports Ñ',
  'Sky Sports Premier League',
  'Sky Sports Main Event',
  'The Channel of the Live',
  '***',
  '# 1',
  '<b>HTML</b> &amp; &nbsp; título',
  'a'.repeat(200),
  `acestream://${HEX}`,
  `acestream://${HEX_UPPER}`,
  `https://example.com/play?id=${HEX_UPPER}`,
  `https://example.com/play?content_id=${HEX}`,
  `https://example.com/play?id=zz&x=${HEX}`,
  `http://127.0.0.1:6878/ace/getstream?id=${HEX}&pid=1`,
  `  ${HEX}  `,
  `${HEX}0`,
  HEX.slice(0, 39),
  `texto ${HEX_UPPER} más texto`,
  'acestream://corto',
];

const textos = RAROS.filter((value): value is string => typeof value === 'string');

describe('contraste con server.js (exportadas)', () => {
  it('normalizeHash', () => {
    for (const value of RAROS)
      expect(normalizeHash(value), String(value)).toBe(legacy.normalizeHash(value));
  });

  it('normalizeChannelKey, semanticChannelText', () => {
    for (const value of RAROS) {
      expect(normalizeChannelKey(value), String(value)).toBe(legacy.normalizeChannelKey(value));
      expect(semanticChannelText(value), String(value)).toBe(legacy.semanticChannelText(value));
    }
  });

  it('channelMatchScore, esFamiliaDe y semanticNumbersCompatible en todos los pares', () => {
    const diferencias: string[] = [];
    for (const a of RAROS) {
      for (const b of RAROS) {
        const pair = `${String(a)} / ${String(b)}`;
        if (channelMatchScore(a, b) !== legacy.channelMatchScore(a, b))
          diferencias.push(`score ${pair}`);
        if (esFamiliaDe(a, b) !== legacy.esFamiliaDe(a, b)) diferencias.push(`familia ${pair}`);
        if (semanticNumbersCompatible(a, b) !== legacy.semanticNumbersCompatible(a, b))
          diferencias.push(`diales ${pair}`);
      }
    }
    expect(diferencias).toEqual([]);
  });

  it('motivoDeFallo', () => {
    const errores: unknown[] = [
      new Error('http_429'),
      new Error('fetch_timeout'),
      new Error('ECONNREFUSED 10.0.0.1:80'),
      new Error(''),
      new Error('A'.repeat(41)),
      new Error('a'.repeat(40)),
      { message: 'dns_failed' },
      { message: 42 },
      'http_500',
      null,
      undefined,
    ];
    for (const error of errores) expect(motivoDeFallo(error)).toBe(legacy.motivoDeFallo(error));
  });

  it('las constantes de puntuación coinciden', () => {
    expect(legacy.RESOLUTION_EXACT_SCORE).toBe(92);
    expect(legacy.SEMANTIC_MAX_SCORE).toBe(94);
  });
});

describe('contraste con server.js (no exportadas, extraídas del fuente)', () => {
  const original = compileLegacyPieces<{
    cleanTitle(value: unknown, fallback: string): string;
    channelDialNumbers(value: unknown): string[];
    channelAllowsFamilyFallback(value: unknown): boolean;
  }>(
    [
      extractBlock(serverSource, /const CHANNEL_FILLER_TOKENS = new Set\(\[[\s\S]*?\]\);/),
      extractFunction(serverSource, 'normalizeChannelKey'),
      extractFunction(serverSource, 'semanticChannelText'),
      extractFunction(serverSource, 'channelDialNumbers'),
      extractFunction(serverSource, 'channelAllowsFamilyFallback'),
      extractFunction(serverSource, 'cleanTitle'),
    ],
    '{ cleanTitle, channelDialNumbers, channelAllowsFamilyFallback }',
  );

  it('cleanTitle', () => {
    for (const value of RAROS) {
      expect(cleanTitle(value, 'Canal'), String(value)).toBe(original.cleanTitle(value, 'Canal'));
      expect(cleanTitle(value, ''), String(value)).toBe(original.cleanTitle(value, ''));
    }
  });

  it('channelDialNumbers y channelAllowsFamilyFallback', () => {
    for (const value of RAROS) {
      expect(channelDialNumbers(value), String(value)).toEqual(original.channelDialNumbers(value));
      expect(channelAllowsFamilyFallback(value), String(value)).toBe(
        original.channelAllowsFamilyFallback(value),
      );
    }
  });
});

describe('contraste con index.html ("Para ti")', () => {
  type Legacy = {
    inScope(match: ForYouMatch, preferences: ForYouPreferences): boolean;
    highlighted(match: ForYouMatch, preferences: ForYouPreferences): boolean;
    normalizePreferenceKey(value: unknown): string;
    competitionKey(value: unknown): string;
    leagueMatches(preference: unknown, competition: unknown): boolean;
    matchIsLaLigaHypermotion(match: unknown): boolean;
    footballTeamKey(value: unknown): string;
  };
  /* `S` es el estado global de la página: se le cambian las preferencias
     antes de cada llamada, como haría la interfaz. */
  const original = compileLegacyPieces<Legacy>(
    [
      extractBlock(indexHtml, /const competitionKey=\(value\)=>[\s\S]*?;\r?\n/),
      extractBlock(indexHtml, /const LEAGUE_ALIASES=\{[\s\S]*?\r?\n\};/),
      extractBlock(indexHtml, /const NATIONALITY_RULES=\{[\s\S]*?\r?\n\};/),
      extractBlock(indexHtml, /const TEAM_PREFERENCE_ALIASES=\{[\s\S]*?\r?\n\};/),
      extractFunction(indexHtml, 'normalizePreferenceKey'),
      extractFunction(indexHtml, 'leagueMatches'),
      extractFunction(indexHtml, 'matchIsLaLigaHypermotion'),
      extractFunction(indexHtml, 'matchLeagueMatches'),
      extractFunction(indexHtml, 'footballTeamKey'),
      extractFunction(indexHtml, 'footballTeamNameMatches'),
      extractFunction(indexHtml, 'hasFootballPreferences'),
      extractFunction(indexHtml, 'hasScopePreferences'),
      extractFunction(indexHtml, 'footballMatchHasFavoriteTeam'),
      extractFunction(indexHtml, 'footballMatchInScope'),
      extractFunction(indexHtml, 'footballMatchHighlighted'),
    ],
    `{
      inScope: (match, preferences) => { S.preferences = preferences; return footballMatchInScope(match); },
      highlighted: (match, preferences) => { S.preferences = preferences; return footballMatchHighlighted(match); },
      normalizePreferenceKey, competitionKey, leagueMatches, matchIsLaLigaHypermotion, footballTeamKey,
    }`,
    'const S = { preferences: { leagues: [], teams: [], nationalities: [] } };',
  );

  const competiciones = [
    'La Liga EA Sports',
    'LaLiga',
    'LaLiga Hypermotion',
    'LaLiga SmartBank',
    'Primera División',
    'Segunda División',
    'Copa del Rey',
    'Supercopa de España',
    'UEFA Champions League',
    'Liga de Campeones',
    'Premier League',
    'Premier League Ucrania',
    'Serie A',
    'Serie A Brasil',
    'Bundesliga',
    '2. Bundesliga',
    'Ligue 1',
    'Eredivisie',
    'Liga MX',
    'MLS',
    'Amistoso',
    '',
  ];
  const equipos = [
    ['Real Madrid', 'FC Barcelona'],
    ['Barcelona SC', 'Emelec'],
    ['Atlético de Madrid', 'Sevilla FC'],
    ['Inter de Milán', 'AC Milan'],
    ['España', 'Francia'],
    ['Spain U21', 'Italy U21'],
    ['Brasil', 'Argentina'],
    ['Eibar', 'Granada CF'],
    ['', ''],
  ] as const;
  const canales = ['M+ LALIGA', 'LALIGA TV Hypermotion', 'DAZN 1', 'Movistar Liga de Campeones'];
  const preferencias: ForYouPreferences[] = [
    { leagues: [], teams: [], nationalities: [] },
    { leagues: [], teams: [], nationalities: ['España'] },
    { leagues: ['LaLiga'], teams: [], nationalities: [] },
    { leagues: ['LaLiga Hypermotion'], teams: [], nationalities: [] },
    { leagues: ['Premier League', 'Serie A'], teams: [], nationalities: [] },
    { leagues: [], teams: ['Barça', 'Atlético Madrid', 'Inter'], nationalities: [] },
    { leagues: [], teams: [], nationalities: ['Brasil', 'Estados Unidos', 'Países Bajos'] },
    { leagues: ['Bundesliga'], teams: ['Sevilla'], nationalities: ['Italia'] },
  ];

  it('footballMatchInScope y footballMatchHighlighted en una rejilla de partidos y gustos', () => {
    const diferencias: string[] = [];
    for (const competition of competiciones) {
      for (const [home, away] of equipos) {
        for (const canal of canales) {
          const match: ForYouMatch = {
            competition,
            title: `${home} - ${away}`,
            home,
            away,
            channels: [{ name: canal }, canal],
          };
          for (const prefs of preferencias) {
            const etiqueta = `${competition} | ${home}-${away} | ${canal} | ${JSON.stringify(prefs)}`;
            if (footballMatchInScope(match, prefs) !== original.inScope(match, prefs))
              diferencias.push(`alcance ${etiqueta}`);
            if (footballMatchHighlighted(match, prefs) !== original.highlighted(match, prefs))
              diferencias.push(`resaltado ${etiqueta}`);
          }
        }
      }
    }
    expect(diferencias).toEqual([]);
  });

  it('claves y alias de ligas y equipos', () => {
    for (const value of [...RAROS, ...competiciones, ...equipos.flat()]) {
      expect(normalizePreferenceKey(value)).toBe(original.normalizePreferenceKey(value));
      expect(competitionKey(value)).toBe(original.competitionKey(value));
      expect(footballTeamKey(value)).toBe(original.footballTeamKey(value));
    }
    for (const preference of [...competiciones, 'laliga', 'seriea', 'ligue1', 'Hypermotion']) {
      for (const competition of competiciones) {
        expect(leagueMatches(preference, competition)).toBe(
          original.leagueMatches(preference, competition),
        );
      }
    }
    for (const texto of textos) {
      const match = { competition: texto, title: texto, channels: [{ name: texto }, texto, null] };
      expect(matchIsLaLigaHypermotion(match)).toBe(original.matchIsLaLigaHypermotion(match));
    }
  });
});

describe('contraste con player-controller.js (directo)', () => {
  const tramos: [number, number][][] = [
    [],
    [[0, 20]],
    [
      [0, 20],
      [50, 110],
    ],
    [
      [10, 10],
      [30, 25],
    ],
    [[0, Number.POSITIVE_INFINITY]],
    [
      [Number.NaN, 5],
      [5, 9],
    ],
    [
      [100, 160],
      [160.2, 200],
    ],
  ];
  const tiempos = [
    0,
    5,
    19.9,
    20.2,
    35,
    72,
    110.25,
    160.1,
    300,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  function fake(entries: [number, number][], currentTime: number) {
    return {
      currentTime,
      seekable: {
        length: entries.length,
        start: (index: number) => entries[index]?.[0] ?? Number.NaN,
        end: (index: number) => entries[index]?.[1] ?? Number.NaN,
      },
    };
  }

  it('readSeekWindow', () => {
    for (const entries of tramos) {
      for (const time of tiempos) {
        const media = fake(entries, time);
        expect(readSeekWindow(media), `${JSON.stringify(entries)} @ ${time}`).toEqual(
          playerCore.readSeekWindow(media),
        );
      }
    }
    expect(readSeekWindow(null)).toBe(playerCore.readSeekWindow(null));
    expect(readSeekWindow({ currentTime: 3 })).toBe(playerCore.readSeekWindow({ currentTime: 3 }));
  });

  it('resolveLiveTarget', () => {
    const ventanas: (SeekWindow | null)[] = [
      null,
      { start: 0, end: 120, duration: 120 },
      { start: 20, end: 24, duration: 4 },
      { start: 5, end: 5.3, duration: 0.3 },
      { start: 0, end: 0, duration: 0 },
      { start: Number.NaN, end: 10, duration: 10 },
    ];
    const preferidos = [undefined, null, 0, 3, 104, 119, 500, -5, Number.NaN];
    const colchones = [undefined, 0, 1.2, 8, 12, -3, Number.NaN];
    for (const ventana of ventanas) {
      for (const preferido of preferidos) {
        for (const colchon of colchones) {
          expect(
            resolveLiveTarget(ventana, preferido, colchon),
            `${JSON.stringify(ventana)} ${preferido} ${colchon}`,
          ).toBe(playerCore.resolveLiveTarget(ventana, preferido, colchon));
        }
      }
    }
  });
});
