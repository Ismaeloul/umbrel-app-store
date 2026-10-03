/* Idioma de las películas y series (docs/vod.md §4.10): la tabla de casos
   reales de paneles Xtream y los falsos amigos («EN busca de…», «LA casa de
   papel», «CINE DE TERROR», «FROZEN»…). */

import { describe, expect, it } from 'vitest';
import {
  combineVodLangs,
  detectVodLangs,
  parseVodLangsParam,
  VOD_LANG_ALL,
  VOD_LANGS,
  vodLangBits,
  vodLangsOf,
  vodLangsParam,
  VodLangsParamSchema,
  type VodLang,
} from '../src/index.js';

const cat = (text: string): VodLang[] => vodLangsOf(detectVodLangs(text, 'categoria').bits);
const marks = (text: string): VodLang[] => vodLangsOf(detectVodLangs(text, 'titulo').bits);

describe('idioma por el nombre de la categoría', () => {
  const cases: ReadonlyArray<readonly [string, VodLang[]]> = [
    // Castellano
    ['ES | ACCIÓN', ['castellano']],
    ['ES - ACCION', ['castellano']],
    ['ES: TERROR', ['castellano']],
    ['|ES| COMEDIA', ['castellano']],
    ['[ES] DRAMA', ['castellano']],
    ['ES-INFANTIL', ['castellano']],
    ['ES ACCIÓN', ['castellano']],
    ['ACCIÓN | ES', ['castellano']],
    ['PELÍCULAS 4K ES', ['castellano']],
    ['ES 4K', ['castellano']],
    ['CASTELLANO', ['castellano']],
    ['Películas en castellano', ['castellano']],
    ['CINE ESPAÑOL', ['castellano']],
    ['CINE ESPANOL', ['castellano']],
    ['SERIES ESPAÑOLAS', ['castellano']],
    ['SPAIN | MOVIES', ['castellano']],
    ['ESPAÑA', ['castellano']],
    ['ESP ESTRENOS', ['castellano']],
    ['SPA | KIDS', ['castellano']],
    ['CAST | ACCION', ['castellano']],
    ['Audio: es-ES', ['castellano']],
    // Latino, siempre aparte
    ['|LAT| TERROR', ['latino']],
    ['LAT | ACCION', ['latino']],
    ['LATINO', ['latino']],
    ['PELIS LATINO', ['latino']],
    ['ESTRENOS LATINO', ['latino']],
    ['ESPAÑOL LATINO', ['latino']],
    ['ES | LATINO', ['latino']],
    ['LATINO | ES', ['latino']],
    ['ES LAT', ['latino']],
    ['LATAM', ['latino']],
    ['Latinoamérica', ['latino']],
    ['MEXICO', ['latino']],
    ['MÉXICO | CINE', ['latino']],
    ['CINE MEXICANO', ['latino']],
    ['CINE ARGENTINO', ['latino']],
    ['MX | ACCION', ['latino']],
    ['MX ESTRENOS', ['latino']],
    ['CO | NOVELAS', ['latino']],
    ['Audio es-419', ['latino']],
    ['SPANISH LATINO', ['latino']],
    // Castellano firme y latino: los dos
    ['CASTELLANO Y LATINO', ['castellano', 'latino']],
    ['DUAL CAST/LAT', ['castellano', 'latino']],
    // VOSE
    ['VOSE', ['vose']],
    ['V.O.S.E.', ['vose']],
    ['VOS', ['vose']],
    ['SERIES VOSE', ['vose']],
    ['ES | VOSE', ['vose']],
    ['VOSE | ESPAÑOL', ['vose']],
    ['SUBTITULADAS EN ESPAÑOL', ['vose']],
    ['Subtitulado', ['vose']],
    ['PELÍCULAS SUB ESP', ['vose']],
    ['Versión original subtitulada', ['vose']],
    ['ES | MULTI | VOSE', ['castellano', 'vose']],
    // Inglés / V.O.
    ['EN | ACTION', ['ingles']],
    ['|EN| MOVIES', ['ingles']],
    ['[EN] DRAMA', ['ingles']],
    ['ACTION (EN)', ['ingles']],
    ['ENG MOVIES', ['ingles']],
    ['ENGLISH', ['ingles']],
    ['ENGLISH MOVIES', ['ingles']],
    ['UK | DOCUMENTARIES', ['ingles']],
    ['USA | MOVIES', ['ingles']],
    ['V.O.', ['ingles']],
    ['VO', ['ingles']],
    ['PELÍCULAS VO', ['ingles']],
    ['Versión original', ['ingles']],
    ['EN INGLÉS', ['ingles']],
    ['PELICULAS EN INGLES', ['ingles']],
    ['VOSTFR', ['ingles']],
    ['ES/EN', ['castellano', 'ingles']],
    ['ES | EN', ['castellano', 'ingles']],
    // Francés
    ['FR | FILMS', ['frances']],
    ['|FR| ACTION', ['frances']],
    ['FRANCÉS', ['frances']],
    ['FRANCAIS', ['frances']],
    ['FRENCH MOVIES', ['frances']],
    ['VF | FILMS', ['frances']],
    ['PELÍCULAS EN FRANCÉS', ['frances']],
    ['TRUEFRENCH', ['frances']],
    ['FRA ACTION', ['frances']],
    ['VFQ', ['frances']],
    // Italiano, alemán, portugués, catalán
    ['IT | FILM', ['italiano']],
    ['|IT| CINEMA', ['italiano']],
    ['ITALIA 4K', ['italiano']],
    ['ITALIANO', ['italiano']],
    ['ITA AZIONE', ['italiano']],
    ['DE | FILME', ['aleman']],
    ['[DE] KINO', ['aleman']],
    ['DEUTSCH', ['aleman']],
    ['GER MOVIES', ['aleman']],
    ['ALEMÁN', ['aleman']],
    ['PT | FILMES', ['portugues']],
    ['BR | FILMES', ['portugues']],
    ['PORTUGUÉS', ['portugues']],
    ['BRASIL', ['portugues']],
    ['PT-BR', ['portugues']],
    ['CAT | PEL·LÍCULES', ['catalan']],
    ['CATALÀ', ['catalan']],
    ['EN CATALÁN', ['catalan']],
    // Otros
    ['AR | أفلام', ['otros']],
    ['TR | DIZI', ['otros']],
    ['PL | FILMY', ['otros']],
    ['|NL| FILMS', ['otros']],
    ['RU | КИНО', ['otros']],
    ['EXYU FILMOVI', ['otros']],
    ['ÁRABE', ['otros']],
    ['TURCO', ['otros']],
    ['HINDI', ['otros']],
    ['BOLLYWOOD', ['otros']],
    ['EUSKERA', ['otros']],
    // Sin idioma
    ['ACCIÓN', []],
    ['ESTRENOS 2024', []],
    ['VOD | 4K', []],
    ['4K UHD', []],
    ['NETFLIX', []],
    ['DISNEY+', []],
    ['INFANTIL', []],
    ['XXX | ADULTOS', []],
    ['MULTI', []],
    ['DUAL', []],
    ['MULTI AUDIO', []],
    ['|VIP| ESTRENOS', []],
  ];
  for (const [name, expected] of cases) {
    it(`«${name}» → ${expected.join(', ') || 'sin indicar'}`, () => {
      expect(cat(name)).toEqual(expected);
    });
  }
});

describe('falsos amigos en una categoría: no son idioma', () => {
  const cases: ReadonlyArray<readonly [string, VodLang[]]> = [
    ['PELÍCULAS EN ESPAÑOL', ['castellano']],
    ['SERIES EN CASTELLANO', ['castellano']],
    ['EN BUSCA DEL ARCA', []],
    ['EN FAMILIA', []],
    ['CINE DE TERROR', []],
    ['DE TODO UN POCO', []],
    ['LA CASA DE PAPEL', []],
    ['LO MEJOR DE LA SEMANA', []],
    ['PELÍCULAS POR GÉNERO', []],
    ['NO TE LO PIERDAS', []],
    ['SE BUSCA', []],
    ['AL ROJO VIVO', []],
    ['FROZEN', []],
    ['IT CROWD', []],
    ['CAT. ACCIÓN', []],
    ['FIN DE AÑO', []],
    ['SERIES USA', []],
    ['CINE USA', []],
    ['SERIES DE USA', []],
    ['SERIES UK', []],
    ['CINE FRANCÉS', []],
    ['PELÍCULAS FRANCESAS', []],
    ['CINE ITALIANO', []],
    ['SERIES TURCAS', []],
    ['ANIME JAPONÉS', []],
    ['CINE ASIÁTICO', []],
    ['DORAMAS COREANOS', []],
    ['Para vos', []],
    ['Sub-zero', []],
    ['LATIN LOVERS', []],
    ['CHINA', []],
    ['PELÍCULAS ES', ['castellano']],
  ];
  for (const [name, expected] of cases) {
    it(`«${name}» → ${expected.join(', ') || 'sin indicar'}`, () => {
      expect(cat(name)).toEqual(expected);
    });
  }
});

describe('idioma por las marcas del título (lo que quita la limpieza)', () => {
  const cases: ReadonlyArray<readonly [string, VodLang[]]> = [
    ['ES - ', ['castellano']],
    ['|ES| ', ['castellano']],
    [' (LAT)', ['latino']],
    [' (lat)', ['latino']],
    [' [VOSE]', ['vose']],
    [' 4K ES', ['castellano']],
    ['ES - LAT: ', ['latino']],
    ['[ES] 4K -  [MULTI] (VOSE)', ['castellano', 'vose']],
    [' [Castellano]', ['castellano']],
    [' LATINO', ['latino']],
    ['UK - ', ['ingles']],
    ['US: ', ['ingles']],
    ['EN - ', ['ingles']],
    [' (VO)', ['ingles']],
    ['FR - ', ['frances']],
    [' [FR]', ['frances']],
    [' VF', ['frances']],
    ['IT - ', ['italiano']],
    ['DE - ', ['aleman']],
    ['PT - ', ['portugues']],
    ['MX - ', ['latino']],
    ['|NL| ', ['otros']],
    ['TR - ', ['otros']],
    ['AR - ', ['otros']],
    ['[4K] ', []],
    ['|4K| ', []],
    [' HEVC 1080p', []],
    [' (MULTI)', []],
  ];
  for (const [text, expected] of cases) {
    it(`«${text}» → ${expected.join(', ') || 'sin indicar'}`, () => {
      expect(marks(text)).toEqual(expected);
    });
  }
});

describe('el título manda sobre la categoría', () => {
  const both = (title: string, category: string): VodLang[] =>
    vodLangsOf(
      combineVodLangs(detectVodLangs(title, 'titulo'), detectVodLangs(category, 'categoria')),
    );

  it('sin marcas en el título, el de la categoría', () => {
    expect(both('', 'ES | ACCIÓN')).toEqual(['castellano']);
    expect(both('[4K] ', '|LAT| TERROR')).toEqual(['latino']);
    expect(both('', 'ESTRENOS')).toEqual([]);
  });

  it('una marca en el título gana', () => {
    expect(both(' (FR)', 'ES | ANIMACIÓN')).toEqual(['frances']);
    expect(both(' (LAT)', 'ES | ACCIÓN')).toEqual(['latino']);
    expect(both(' [VOSE]', 'ES | DRAMA')).toEqual(['vose']);
  });

  it('un castellano flojo en una categoría VOSE es VOSE, salvo firme o MULTI (M3)', () => {
    expect(both('ES - ', 'VOSE')).toEqual(['vose']);
    expect(both('ES| ', 'PELÍCULAS VOSE')).toEqual(['vose']);
    expect(both(' [Castellano]', 'VOSE')).toEqual(['castellano']);
    expect(both('[ES] [MULTI] ', 'VOSE')).toEqual(['castellano']);
    /* Una categoría que dice castellano: el título decide. */
    expect(both('ES - ', 'VOSE | CASTELLANO')).toEqual(['castellano']);
  });

  it('un castellano flojo en una categoría latina es latino', () => {
    expect(both('ES| ', 'PELIS LATINO')).toEqual(['latino']);
    expect(both('ES - ', '|LAT| TERROR')).toEqual(['latino']);
    /* Castellano firme: lo dice el título y vale. */
    expect(both(' [Castellano]', 'PELIS LATINO')).toEqual(['castellano']);
    /* En una categoría con los dos, el título decide. */
    expect(both('ES - ', 'CASTELLANO Y LATINO')).toEqual(['castellano']);
  });
});

describe('bits y parámetro', () => {
  it('bits en el orden de VOD_LANGS', () => {
    expect(vodLangsOf(vodLangBits(['frances', 'castellano']))).toEqual(['castellano', 'frances']);
    expect(vodLangsOf(VOD_LANG_ALL)).toEqual([...VOD_LANGS]);
  });

  it('el parámetro `langs`: en su orden fijo, sin repetir y sin inventar', () => {
    expect(vodLangsParam(['frances', 'castellano', 'frances'])).toBe('castellano,frances');
    expect(parseVodLangsParam('frances,castellano,klingon,frances')).toEqual([
      'castellano',
      'frances',
    ]);
    expect(parseVodLangsParam('')).toEqual([]);
    expect(parseVodLangsParam(undefined)).toEqual([]);
  });

  it('el esquema del parámetro solo acepta idiomas conocidos separados por comas', () => {
    expect(VodLangsParamSchema.safeParse('castellano,latino').success).toBe(true);
    expect(VodLangsParamSchema.safeParse(VOD_LANGS.join(',')).success).toBe(true);
    expect(VodLangsParamSchema.safeParse('castellano,').success).toBe(false);
    expect(VodLangsParamSchema.safeParse('es').success).toBe(false);
    expect(VodLangsParamSchema.safeParse('castellano latino').success).toBe(false);
    expect(VodLangsParamSchema.safeParse('').success).toBe(false);
  });
});
