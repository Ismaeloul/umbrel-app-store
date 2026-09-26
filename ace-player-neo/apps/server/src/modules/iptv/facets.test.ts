/* País, idioma, tipo, deporte y calidad de un canal IPTV (docs/iptv.md §16.4):
   la tabla de casos del anexo entera, con nombres como los de la lista real de
   Isma, y las trampas (superíndices, frases antes que palabras, adultos
   excluyente, «AR», «CA», «CAT», «LA», marcas que nunca son país). */

import { describe, expect, it } from 'vitest';
import type { IptvQuality } from '@ace/shared';
import {
  FacetDeriver,
  deriveFacets,
  facetTokens,
  matchTerms,
  tvgCountryCode,
  tvgLanguageCodes,
  variantQuality,
} from './facets.js';
import { cleanIptvTitle } from './names.js';

interface Case {
  readonly title: string;
  readonly group: string;
  readonly country: string | null;
  readonly languages: readonly string[];
  readonly types: readonly string[];
  readonly sports: readonly string[];
  readonly quality: IptvQuality | null;
  readonly tvgCountry?: string;
  readonly tvgLanguage?: string;
}

/* La tabla de §16.4 («Casos que tienen que salir así»), fila a fila. */
const CASES: readonly Case[] = [
  {
    title: 'DAZN F1',
    group: 'ES | DAZN',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['f1'],
    quality: null,
  },
  {
    title: 'DAZN ACB 3',
    group: 'ES | DAZN',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['baloncesto'],
    quality: null,
  },
  {
    title: 'DAZN 1',
    group: 'ES | DEPORTES',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: 'LALIGA+ PPV 4',
    group: 'ES | LALIGA',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: null,
  },
  {
    title: 'LA LIGA TV BAR',
    group: 'ES | LALIGA',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: null,
  },
  {
    title: 'LA LIGA 1',
    group: 'ES | DEPORTES',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: null,
  },
  {
    title: 'MOVISTAR PLUS +2',
    group: 'ES | MOVISTAR',
    country: 'ES',
    languages: ['es'],
    types: ['entretenimiento'],
    sports: [],
    quality: null,
  },
  {
    title: 'MOVISTAR 2022 1',
    group: 'ES | MOVISTAR',
    country: 'ES',
    languages: ['es'],
    types: [],
    sports: [],
    quality: null,
  },
  {
    title: 'ANTENA 3 INTERNACIONAL',
    group: 'ES | GENERALISTAS',
    country: 'ES',
    languages: ['es'],
    types: ['generalistas'],
    sports: [],
    quality: null,
  },
  {
    title: 'DIRECTO ANTENA 3 ᴿᴬᵂ',
    group: 'ES | GENERALISTAS',
    country: 'ES',
    languages: ['es'],
    types: ['generalistas'],
    sports: [],
    quality: null,
  },
  {
    title: 'UK: SKY SPORTS F1 ᶠᴴᴰ',
    group: 'UK | SPORTS',
    country: 'UK',
    languages: ['en'],
    types: ['deportes'],
    sports: ['f1'],
    quality: 'fhd',
  },
  {
    title: 'AR | BEIN SPORTS 1',
    group: 'AR | BEIN',
    country: null,
    languages: ['ar'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: '|FR| CANAL+ SPORT 360',
    group: 'FRANCE',
    country: 'FR',
    languages: ['fr'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: '[IT] SKY CALCIO 1 HD',
    group: '[IT] CALCIO',
    country: 'IT',
    languages: ['it'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: 'hd',
  },
  {
    title: 'LAT | ESPN 2',
    group: 'LATINO DEPORTES',
    country: 'LAT',
    languages: ['es'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: 'VIP | DAZN 1',
    group: 'VIP',
    country: null,
    languages: [],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: 'CAT: ESPORT3',
    group: 'CATALUNYA',
    country: 'ES',
    languages: ['ca'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
  {
    title: 'US: NBA TV',
    group: 'USA SPORTS',
    country: 'US',
    languages: ['en'],
    types: ['deportes'],
    sports: ['baloncesto'],
    quality: null,
  },
  {
    title: 'REAL MADRID TV EN',
    group: 'ES | DEPORTES',
    country: 'ES',
    languages: ['en'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: null,
  },
  {
    title: 'PREMIER PADEL 1',
    group: 'ES | DEPORTES',
    country: 'ES',
    languages: ['es'],
    types: ['deportes'],
    sports: ['padel'],
    quality: null,
  },
  {
    title: 'DE: SKY BUNDESLIGA 1',
    group: 'DE | SPORT',
    country: 'DE',
    languages: ['de'],
    types: ['deportes'],
    sports: ['futbol'],
    quality: null,
  },
  {
    title: 'CLAN',
    group: 'ES | INFANTIL',
    country: 'ES',
    languages: ['es'],
    types: ['infantil'],
    sports: [],
    quality: null,
  },
  {
    title: 'CANAL 24 HORAS',
    group: 'ES | NOTICIAS',
    country: 'ES',
    languages: ['es'],
    types: ['noticias'],
    sports: [],
    quality: null,
  },
  {
    title: 'CANAL+ 18',
    group: 'FR | CINEMA',
    country: 'FR',
    languages: ['fr'],
    types: ['cine'],
    sports: [],
    quality: null,
  },
  {
    title: 'XXX: HOT 1',
    group: 'XXX | ADULTS',
    country: null,
    languages: [],
    types: ['adultos'],
    sports: [],
    quality: null,
  },
  {
    title: '4K: DAZN LALIGA UHD',
    group: '4K | UHD',
    country: null,
    languages: [],
    types: ['deportes'],
    sports: ['futbol'],
    quality: 'uhd',
  },
  {
    title: 'Teledeporte',
    group: 'Deportes',
    tvgCountry: 'ES',
    tvgLanguage: 'Spanish;English',
    country: 'ES',
    languages: ['es', 'en'],
    types: ['deportes'],
    sports: [],
    quality: null,
  },
];

/* La calidad de §4.2 (cleanIptvTitle) es la de la variante; la faceta la completa con NFKC. */
function facetsOf(item: Case) {
  return deriveFacets({
    title: item.title,
    group: item.group,
    tvgCountry: item.tvgCountry ?? null,
    tvgLanguage: item.tvgLanguage ?? null,
    quality: cleanIptvTitle(item.title, item.group).quality,
  });
}

describe('la tabla de casos de §16.4 (nombres como los de la lista real)', () => {
  it.each(CASES.map((item) => [`«${item.title}» en «${item.group}»`, item] as const))(
    '%s',
    (_label, item) => {
      const facets = facetsOf(item);
      expect(facets.country).toBe(item.country);
      expect(facets.languages).toEqual(item.languages);
      expect(facets.types).toEqual(item.types);
      expect(facets.sports).toEqual(item.sports);
      expect(facets.quality).toBe(item.quality);
    },
  );

  it('son las 27 filas del anexo', () => {
    expect(CASES).toHaveLength(27);
  });
});

describe('texto: NFKC, tildes y palabras', () => {
  it('las letras en superíndice se leen como letras («ᴿᴬᵂ» → raw, «ᶠᴴᴰ» → fhd, «⁴ᴷ» → 4k)', () => {
    expect(facetTokens('DIRECTO ANTENA 3 ᴿᴬᵂ')).toEqual(['directo', 'antena', '3', 'raw']);
    expect(facetTokens('SKY SPORTS F1 ᶠᴴᴰ')).toContain('fhd');
    expect(facetTokens('DAZN ⁴ᴷ')).toContain('4k');
  });

  it('«+» se queda pegado a la palabra de delante; «la liga» es «laliga»; sin tildes', () => {
    expect(facetTokens('LALIGA+ PPV 4')).toEqual(['laliga+', 'ppv', '4']);
    expect(facetTokens('M+ La Liga TV')).toEqual(['m+', 'laliga', 'tv']);
    expect(facetTokens('MOVISTAR PLUS +2')).toEqual(['movistar', 'plus', '2']);
    expect(facetTokens('Fútbol Pádel Niños')).toEqual(['futbol', 'padel', 'ninos']);
  });

  it('«RAW» no es calidad; «⁴ᴷ» sí (NFKC); la calidad de §4.2 manda si la hay', () => {
    expect(variantQuality('DIRECTO ANTENA 3 ᴿᴬᵂ', null)).toBe(null);
    expect(variantQuality('DAZN LALIGA ⁴ᴷ', null)).toBe('uhd');
    expect(variantQuality('DAZN 1 1080p', null)).toBe('fhd');
    expect(variantQuality('DAZN 1', 'hd')).toBe('hd');
    expect(variantQuality('DAZN 1', null)).toBe(null);
  });
});

describe('país', () => {
  const country = (title: string, group = '', tvgCountry: string | null = null) =>
    new FacetDeriver().country({ title, group, tvgCountry });

  it('todas las formas de prefijo del nombre', () => {
    for (const title of [
      'ES: DAZN 1',
      'ES | DAZN 1',
      '|ES| DAZN 1',
      '[ES] DAZN 1',
      '(ES) DAZN 1',
      'ES - DAZN 1',
      'ESPAÑA | DAZN 1',
      'SPAIN: DAZN 1',
      'ESP: DAZN 1',
    ]) {
      expect(country(title), title).toBe('ES');
    }
    expect(country('UNITED KINGDOM: SKY SPORTS')).toBe('UK');
    expect(country('EX-YU: ARENA SPORT 1')).toBe('EXYU');
    expect(country('GB: BBC ONE')).toBe('UK');
    expect(country('LATAM | ESPN')).toBe('LAT');
    expect(country('ARG: TYC SPORTS')).toBe('ARG');
  });

  it('prefijos y primera palabra de la categoría', () => {
    expect(country('DAZN 1', 'ES: DEPORTES')).toBe('ES');
    expect(country('SKY SPORTS', '|UK| SPORTS')).toBe('UK');
    expect(country('SKY CALCIO', '[IT] CALCIO')).toBe('IT');
    expect(country('SKY SPORTS', 'UK SPORTS')).toBe('UK');
    expect(country('CNN', 'USA NEWS')).toBe('US');
    expect(country('DAZN 1', 'SPAIN SPORTS')).toBe('ES');
    expect(country('LA 1', 'ESPAÑA')).toBe('ES');
    expect(country('ESPN', 'LATINO DEPORTES')).toBe('LAT');
    expect(country('TF1', 'FRANCE')).toBe('FR');
    expect(country('SRF 1', 'SWISS TV')).toBe('CH');
  });

  it('un código entre barras o corchetes en cualquier sitio', () => {
    expect(country('SKY SPORTS [UK]')).toBe('UK');
    expect(country('DAZN 1', 'DEPORTES |ES|')).toBe('ES');
  });

  it('tvg-country manda y acepta listas y nombres', () => {
    expect(country('UK: DAZN 1', 'UK | SPORTS', 'ES')).toBe('ES');
    expect(tvgCountryCode('es;ad')).toBe('ES');
    expect(tvgCountryCode('Spain')).toBe('ES');
    expect(tvgCountryCode('United Kingdom')).toBe('UK');
    expect(tvgCountryCode('hu')).toBe('HU');
    expect(tvgCountryCode('')).toBe(null);
    expect(tvgCountryCode('xx')).toBe(null);
  });

  it('marcas que nunca son país, ni con separador («VIP», «HD», «4K», «PPV», «TV», «RAW», «BAR»…)', () => {
    for (const title of [
      'VIP | DAZN 1',
      'HD: DAZN 1',
      'PPV | LALIGA',
      '4K | DAZN',
      'TV: CANAL',
      'RAW | ANTENA 3',
      'NEW: CANAL',
      'VOD | PELIS',
      'EPG | GUIA',
      'TOP: CANAL',
      'ALL | CANALES',
    ]) {
      expect(country(title), title).toBe(null);
    }
    expect(country('LA LIGA TV BAR')).toBe(null);
    expect(country('VIP | ES: DAZN 1')).toBe('ES');
  });

  it('trampas: «AR» es árabe, «CA» es Canadá, «CAT» es España, «LA» sin separador no, «IN» solo con separador', () => {
    expect(country('AR | BEIN SPORTS 1', 'AR | BEIN')).toBe(null);
    expect(country('ARG | TYC SPORTS')).toBe('ARG');
    expect(country('CA: TSN 1')).toBe('CA');
    expect(country('CAT: ESPORT3')).toBe('ES');
    expect(country('LA LIGA 1', 'LA LIGA')).toBe(null);
    expect(country('STAR SPORTS', 'IN SPORTS')).toBe(null);
    expect(country('IN: STAR SPORTS')).toBe('IN');
    expect(country('ANTENA 3 INTERNACIONAL')).toBe(null);
    expect(country('ANTENA 3 INTERNACIONAL', 'ES | GENERALISTAS')).toBe('ES');
  });

  it('otro ISO alfa-2 vale con separador y en mayúsculas; en minúsculas o sin separador, no', () => {
    expect(country('HU: M4 SPORT')).toBe('HU');
    expect(country('hu: m4 sport')).toBe(null);
    expect(country('HU M4 SPORT')).toBe(null);
  });
});

describe('idioma', () => {
  const languages = (title: string, group = '', tvgLanguage: string | null = null) =>
    deriveFacets({ title, group, tvgLanguage }).languages;

  it('tvg-language: nombres, códigos de 2 y 3 letras y otros ISO 639-1', () => {
    expect(tvgLanguageCodes('Spanish;English')).toEqual(['es', 'en']);
    expect(tvgLanguageCodes('cat')).toEqual(['ca']);
    expect(tvgLanguageCodes('Español, Català')).toEqual(['es', 'ca']);
    expect(tvgLanguageCodes('hu')).toEqual(['hu']);
    expect(tvgLanguageCodes('klingon')).toEqual([]);
  });

  it('marcas: prefijo de idioma, código entre paréntesis o al final, y palabras', () => {
    expect(languages('AR | BEIN SPORTS 1')).toEqual(['ar']);
    expect(languages('CAT: ESPORT3')).toEqual(['ca']);
    expect(languages('EN: ARENA SPORT')).toEqual(['en']);
    expect(languages('REAL MADRID TV (ENG)', 'ES | DEPORTES')).toEqual(['en']);
    expect(languages('EUROSPORT [EN]', 'ES | DEPORTES')).toEqual(['en']);
    expect(languages('REAL MADRID TV EN', 'ES | DEPORTES')).toEqual(['en']);
    expect(languages('CINE LATINO')).toEqual(['es']);
    expect(languages('TV3 CATALA')).toEqual(['ca']);
  });

  it('sin marcas, el idioma del país; los países con varios idiomas no dan ninguno', () => {
    expect(languages('BBC ONE', 'UK | GENERALISTAS')).toEqual(['en']);
    expect(languages('RTP 1', 'PT | CANAIS')).toEqual(['pt']);
    expect(languages('TSN 1', 'CA: SPORTS')).toEqual(['en']);
    expect(languages('RTS UN', 'CH | TV')).toEqual([]);
    expect(languages('ARENA SPORT 1', 'EXYU | SPORT')).toEqual([]);
    expect(languages('DAZN 1', 'VIP')).toEqual([]);
  });

  it('«CA» al final o entre paréntesis no es catalán (entre paréntesis es Canadá: inglés)', () => {
    expect(languages('TSN 1 CA')).toEqual([]);
    expect(languages('TSN 1 (CA)')).toEqual(['en']);
    expect(languages('TSN 1 (CAT)')).toEqual(['ca']);
  });
});

describe('tipo y deporte', () => {
  const facets = (title: string, group = '') => deriveFacets({ title, group });

  it('frases antes que palabras: «serie a» es fútbol y no Series; «premier padel» es pádel; «liga endesa», baloncesto', () => {
    expect(facets('SERIE A TIM').sports).toEqual(['futbol']);
    expect(facets('SERIE A TIM').types).toEqual(['deportes']);
    expect(facets('SERIES XTRA').types).toEqual(['series']);
    expect(facets('PREMIER PADEL 2').sports).toEqual(['padel']);
    expect(facets('PREMIER LEAGUE TV').sports).toEqual(['futbol']);
    expect(facets('LIGA ENDESA 1').sports).toEqual(['baloncesto']);
    expect(facets('NFL REDZONE').sports).toEqual(['futbol-americano']);
    expect(facets('AMERICAN FOOTBALL LIVE').sports).toEqual(['futbol-americano']);
    expect(facets('FORMULA E TV').sports).toEqual(['motor']);
    expect(facets('FORMULA 1 TV').sports).toEqual(['f1']);
    expect(facets('COMEDY CENTRAL').types).toEqual(['entretenimiento']);
    expect(facets('FOX NEWS').types).toEqual(['noticias']);
    expect(facets('FOX SPORTS 1').types).toEqual(['deportes']);
  });

  it('«liga» y «premier» solas no dan nada; «F1» solo como palabra entera; «DAZN 1» nunca es F1', () => {
    expect(facets('LIGA TV').sports).toEqual([]);
    expect(facets('PREMIER TV').sports).toEqual([]);
    expect(facets('SRF1').sports).toEqual([]);
    expect(facets('DAZN 1').sports).toEqual([]);
    expect(facets('DAZN F1').sports).toEqual(['f1']);
  });

  it('un deporte implica «deportes»; «ESPN», «BEIN» o «DAZN» solos son deportes sin deporte', () => {
    expect(facets('MOTOGP 1').types).toEqual(['deportes']);
    expect(facets('MOTOGP 1').sports).toEqual(['motos']);
    for (const title of ['ESPN', 'BEIN SPORTS 3', 'DAZN 2']) {
      expect(facets(title).types, title).toEqual(['deportes']);
      expect(facets(title).sports, title).toEqual([]);
    }
  });

  it('adultos excluyente: ni otro tipo ni deporte; «Canal+ 18» y «M+ 18» no son adultos', () => {
    const adult = facets('XXX FUTBOL CINE', 'ADULTS');
    expect(adult.types).toEqual(['adultos']);
    expect(adult.sports).toEqual([]);
    expect(facets('PLAYBOY TV').types).toEqual(['adultos']);
    expect(facets('CANAL +18').types).toEqual(['adultos']);
    expect(facets('M+ 18 SERIES').types).toEqual(['series']);
    expect(facets('CANAL+ 18', 'FR | CINEMA').types).toEqual(['cine']);
  });

  it('«24h» es noticias y «24/7» series; los números de canal no dan tipo', () => {
    expect(facets('CANAL 24H').types).toEqual(['noticias']);
    expect(facets('FRIENDS 24/7').types).toEqual(['series']);
    expect(facets('MOVISTAR 2022 1').types).toEqual([]);
  });

  it('un tipo de cada familia por sus palabras y marcas', () => {
    expect(facets('LA 1').types).toEqual(['generalistas']);
    expect(facets('TCM').types).toEqual(['cine']);
    expect(facets('AXN').types).toEqual(['series']);
    expect(facets('EURONEWS').types).toEqual(['noticias']);
    expect(facets('BOING').types).toEqual(['infantil']);
    expect(facets('NATIONAL GEOGRAPHIC').types).toEqual(['documentales']);
    expect(facets('MTV HITS').types).toEqual(['musica']);
    expect(facets('DIVINITY').types).toEqual(['entretenimiento']);
    expect(facets('EWTN').types).toEqual(['religion']);
    expect(facets('TELEDEPORTE').types).toEqual(['deportes']);
    expect(facets('CANAL', 'DOCUMENTALES').types).toEqual(['documentales']);
  });

  it('los 16 deportes por alguna de sus palabras', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['M+ LALIGA', 'futbol'],
      ['EUROLEAGUE TV', 'baloncesto'],
      ['DAZN F1', 'f1'],
      ['MOTO GP', 'motos'],
      ['NASCAR TV', 'motor'],
      ['TENNIS CHANNEL', 'tenis'],
      ['WPT 1', 'padel'],
      ['GOLF CHANNEL', 'golf'],
      ['GCN', 'ciclismo'],
      ['EHF HANDBALL', 'balonmano'],
      ['RUGBY PASS', 'rugby'],
      ['UFC FIGHT PASS', 'lucha'],
      ['NFL NETWORK', 'futbol-americano'],
      ['NHL TV', 'hockey'],
      ['MLB NETWORK', 'beisbol'],
      ['TOROS TV', 'toros'],
    ];
    for (const [title, sport] of cases) expect(facets(title).sports, title).toEqual([sport]);
  });

  it('las marcas de categoría y de nombre se suman; la categoría sola también cuenta', () => {
    expect(facets('MOVISTAR', 'ES | MOVISTAR').types).toEqual([]);
    expect(facets('CANAL 1', 'ES | DEPORTES').types).toEqual(['deportes']);
    const both = facets('DAZN F1', 'ES | NOTICIAS');
    expect(both.types).toEqual(['deportes', 'noticias']);
  });

  it('matchTerms gasta las palabras de una frase y la misma frase de dos tablas cuenta en las dos', () => {
    const match = matchTerms(['real', 'madrid', 'tv']);
    expect([...match.types]).toEqual(['deportes']);
    expect([...match.sports]).toEqual(['futbol']);
    expect([...matchTerms(['serie', 'a']).types]).toEqual([]);
  });
});

describe('caché por categoría', () => {
  it('muchos canales de la misma categoría dan lo mismo que de uno en uno', () => {
    const deriver = new FacetDeriver();
    for (const item of CASES) {
      const once = facetsOf(item);
      const cached = deriver.derive({
        title: item.title,
        group: item.group,
        tvgCountry: item.tvgCountry ?? null,
        tvgLanguage: item.tvgLanguage ?? null,
        quality: cleanIptvTitle(item.title, item.group).quality,
      });
      expect(cached).toEqual(once);
    }
  });

  it('30 000 canales en menos de 1,5 s (es lo más caro del índice)', () => {
    const deriver = new FacetDeriver();
    const groups = Array.from(
      { length: 300 },
      (_, i) => `${['ES', 'UK', 'FR', 'IT'][i % 4]} | GRUPO ${i}`,
    );
    const start = performance.now();
    for (let i = 0; i < 30_000; i += 1) {
      deriver.derive({
        title: `CANAL DE PRUEBA ${i} HD`,
        group: groups[i % groups.length] as string,
      });
    }
    expect(performance.now() - start).toBeLessThan(1_500);
  });
});
