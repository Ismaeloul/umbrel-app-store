/* El catálogo de muestra (docs/vod.md §12.11) cumple el contrato: cada
   respuesta pasa su esquema zod, y sigue las reglas del servidor que la web
   enseña (adultos, búsqueda, cursor, distintivos, progreso). */

import {
  VodBrowseResponseSchema,
  VodHomeSchema,
  VodTitleSchema,
  type VodMovie,
  type VodSeries,
} from '@ace/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEMO_VOD_IDS,
  demoProgress,
  demoVodBrowse,
  demoVodHome,
  demoVodTitle,
  resetDemoVod,
} from './demo-data.ts';
import { demoArtSrc, demoArtSvg } from './demo-art.ts';

afterEach(() => resetDemoVod());

describe('demo de Películas y series', () => {
  it('63 películas y 14 series; la portada cumple su esquema', () => {
    const home = VodHomeSchema.parse(demoVodHome());
    expect(home.counts).toEqual({ movies: 63, series: 14 });
    expect(home.continue.length).toBeGreaterThanOrEqual(4);
    expect(home.continue.some((entry) => entry.isNext)).toBe(true);
    // «Seguir viendo» con solo cartel (Dune: Parte dos no tiene fondo).
    expect(home.continue.some((entry) => entry.art?.art === 'poster')).toBe(true);
    // Las categorías de adultos, al final.
    expect(home.categories.movie.at(-1)?.adult).toBe(true);
  });

  it('rejilla por páginas con cursor; los adultos, en «Todas» como los demás (0.9.0)', () => {
    const first = VodBrowseResponseSchema.parse(demoVodBrowse({ kind: 'movie', limit: 25 }));
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(63);
    expect(first.items.some((card) => card.poster === null)).toBe(true);
    const second = demoVodBrowse({ kind: 'movie', limit: 25, cursor: first.nextCursor ?? '' });
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    const adults = demoVodBrowse({ kind: 'movie', cat: DEMO_VOD_IDS.adultCategory });
    expect(adults.items.every((card) => card.adult)).toBe(true);
    expect(demoVodBrowse({ kind: 'movie', q: 'adultos' }).total).toBe(2);
    expect(
      demoVodBrowse({ kind: 'movie', sort: 'name', limit: 100 }).items.some((c) => c.adult),
    ).toBe(true);
  });

  it('fichas completas y casos pobres, como en las listas reales', () => {
    const oppenheimer = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.movie)) as VodMovie;
    expect(oppenheimer.plot).toMatch(/Oppenheimer/);
    expect(oppenheimer.cast.length).toBeGreaterThanOrEqual(8);
    expect(oppenheimer.releaseDate).toBe('2023-07-21');
    expect(oppenheimer.trailer).toMatch(/^[\w-]{11}$/);
    const poor = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.moviePoor));
    expect(poor).toMatchObject({
      poster: null,
      backdrop: null,
      plot: null,
      year: null,
      rating: null,
      cast: [],
    });
    expect(VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.movieLong)).title.length).toBeGreaterThan(
      80,
    );
    const twelve = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.seriesTwelve)) as VodSeries;
    expect(twelve.seasons).toHaveLength(12);
    expect(twelve.seasons[1]?.name).toBe('Season 2');
    expect(twelve.episodeDurationS).toBe(1260);
    const one = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.seriesOneSeason)) as VodSeries;
    expect(one.seasons).toHaveLength(1);
    const parts = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.seriesParts)) as VodSeries;
    expect(parts.seasons[0]?.name).toBe('Parte 1');
    expect(parts.trailer).toMatch(/^[\w-]{11}$/);
    // Lo que el servidor saca de más de Xtream: resumen de temporada, emisión y nota del episodio.
    expect(parts.seasons[0]?.plot).toMatch(/Fábrica Nacional/);
    expect(parts.seasons.map((season) => season.airDate?.slice(0, 4))).toEqual([
      '2017',
      '2018',
      '2019',
      '2020',
      '2021',
    ]);
    expect(parts.seasons[0]?.episodes[1]).toMatchObject({ airDate: '2017-05-09' });
    expect(parts.seasons[0]?.episodes[1]?.rating).toBeGreaterThan(0);
    const office = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.series)) as VodSeries;
    expect(office).toMatchObject({ originalTitle: 'The Office (US)', ageRating: '12' });
    const noStills = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.seriesNoStills)) as VodSeries;
    expect(noStills.seasons.every((s) => s.episodes.every((e) => e.still === null))).toBe(true);
    const barrio = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.seriesPoor)) as VodSeries;
    expect(barrio).toMatchObject({
      poster: null,
      backdrop: null,
      plot: null,
      rating: null,
      ageRating: null,
      releaseDate: null,
    });
    expect(
      barrio.seasons[0]?.episodes.every(
        (e) => e.durationS === null && e.plot === null && e.airDate === null && e.rating === null,
      ),
    ).toBe(true);
  });

  it('búsqueda por niveles: «spiderman» encuentra «Spider-Man» y dice cuántas series hay', () => {
    const found = demoVodBrowse({ kind: 'movie', q: 'spiderman' });
    expect(found.items.map((card) => card.title)).toEqual(['Spider-Man: Cruzando el Multiverso']);
    const dune = demoVodBrowse({ kind: 'movie', q: 'dune' });
    expect(dune.items.map((card) => card.title)).toEqual(['Dune', 'Dune: Parte dos']);
    const casa = demoVodBrowse({ kind: 'movie', q: 'casa de papel' });
    expect(casa.total).toBe(0);
    expect(casa.otherKindTotal).toBe(1);
    expect(demoVodBrowse({ kind: 'movie', q: 'dune 2021' }).items.map((c) => c.title)).toEqual([
      'Dune',
    ]);
  });

  it('distintivos: el filtro y los números de los chips (sin contar el filtro)', () => {
    const vose = demoVodBrowse({ kind: 'movie', tag: 'vose' });
    expect(vose.items.every((card) => card.tags.includes('vose'))).toBe(true);
    const all = demoVodBrowse({ kind: 'movie' });
    expect(vose.tags).toEqual(all.tags);
    expect(vose.total).toBe(all.tags.find((entry) => entry.tag === 'vose')?.count);
  });

  it('fichas: película, HEVC, AVI, una que falla una vez y una serie con temporadas', () => {
    const movie = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.movie));
    expect(movie.kind).toBe('movie');
    expect(VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.hevcMovie))).toMatchObject({
      playable: 'hevc',
    });
    expect(VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.aviMovie))).toMatchObject({
      playable: 'no',
    });
    expect(demoVodTitle(DEMO_VOD_IDS.flakyMovie)?.info).toBe('failed');
    expect(demoVodTitle(DEMO_VOD_IDS.flakyMovie)?.info).toBe('ok');
    const series = VodTitleSchema.parse(demoVodTitle(DEMO_VOD_IDS.series)) as VodSeries;
    expect(series.seasons.at(-1)?.name).toBe('Especiales');
    expect(series.main?.label).toBe('Siguiente: T2:E6');
    expect(demoVodTitle('f'.repeat(40))).toBeNull();
  });

  it('las marcas cambian la ficha y «Seguir viendo»', () => {
    const series = demoVodTitle(DEMO_VOD_IDS.seriesStart) as VodSeries;
    expect(series.main?.label).toBe('Ver T1:E1');
    const third = series.seasons[0]?.episodes[2];
    demoProgress(third?.id ?? '', { posS: 0, durS: 0, event: 'mark-through' });
    const after = demoVodTitle(DEMO_VOD_IDS.seriesStart) as VodSeries;
    expect(after.seasons[0]?.episodes.slice(0, 3).every((e) => e.progress?.watched)).toBe(true);
    expect(after.main?.label).toBe('Siguiente: T1:E4');
    const entry = demoVodHome().continue.find((item) => item.seriesId === DEMO_VOD_IDS.seriesStart);
    expect(entry?.isNext).toBe(true);
    demoProgress(entry?.id ?? '', { posS: 0, durS: 0, event: 'hide' });
    expect(demoVodHome().continue.some((item) => item.seriesId === DEMO_VOD_IDS.seriesStart)).toBe(
      false,
    );
  });

  it('carteles SVG `data:` sin nada ejecutable', () => {
    const svg = demoArtSvg(DEMO_VOD_IDS.movie, 'poster', '3fa9c210', 'Dune <script>');
    expect(svg).toMatch(/^<svg /);
    expect(svg).not.toMatch(/<script|on\w+=/i);
    expect(demoArtSrc(DEMO_VOD_IDS.movie, 'still', '3fa9c210')).toMatch(/^data:image\/svg\+xml/);
  });
});
