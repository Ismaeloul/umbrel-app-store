/* Parseo tolerante de Películas y series (docs/vod.md §4.3, §7.2 y §15.1):
   la tabla de rarezas de los paneles PHP. */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VOD_LIMITS } from '@ace/shared';
import { parseJsonArrayStream } from '../json-array.js';
import {
  cleanText,
  dateOf,
  durationOf,
  episodeTitle,
  extName,
  imageUrl,
  parseListItem,
  parseMovieInfo,
  parseSeriesInfo,
  playableHint,
  RATING_NONE,
  ratingOf,
  seasonName,
  trailerOf,
  yearOf,
} from './parse.js';
import { tagsOf } from './titles.js';

const CATS = new Map([
  ['1', 'ES | PELÍCULAS'],
  ['2', 'XXX'],
  ['3', 'Eróticas'],
]);

describe('parseListItem (películas y series de las listas)', () => {
  it('una película normal', () => {
    const row = parseListItem(
      'movie',
      {
        stream_id: 42,
        name: 'ES| Oppenheimer (2023) 4K',
        stream_type: 'movie',
        rating: '8.3',
        added: '1700000000',
        category_id: '1',
        container_extension: 'MKV',
        stream_icon: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg',
        direct_source: 'http://no-usar/1.mkv',
      },
      CATS,
    );
    expect(row).toEqual({
      source: 42,
      title: 'Oppenheimer',
      year: 2023,
      rating: 83,
      added: 1_700_000_000,
      ext: 2,
      adult: false,
      poster: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg',
      tags: expect.any(Number),
      category: 'ES | PELÍCULAS',
    });
    expect(tagsOf(row?.tags ?? 0)).toEqual(['castellano', '4k']);
    expect(extName(row?.ext ?? 0)).toBe('mkv');
  });

  it('números como texto, solo `category_ids`, `rating_5based` y `year` de la lista', () => {
    const row = parseListItem(
      'movie',
      {
        stream_id: '7',
        name: 'Dune',
        rating_5based: '4',
        category_id: null,
        category_ids: [2],
        year: '2021',
      },
      CATS,
    );
    expect(row).toMatchObject({ source: 7, year: 2021, rating: 80, adult: true, category: 'XXX' });
  });

  it('ids no numéricos, sin título o un directo se saltan', () => {
    expect(parseListItem('movie', { stream_id: 'abc', name: 'X' }, CATS)).toBeNull();
    expect(parseListItem('movie', { stream_id: 0, name: 'X' }, CATS)).toBeNull();
    expect(parseListItem('movie', { stream_id: 2 ** 53, name: 'X' }, CATS)).toBeNull();
    expect(parseListItem('movie', { stream_id: 3, name: '' }, CATS)).toBeNull();
    expect(
      parseListItem('movie', { stream_id: 3, name: 'Canal', stream_type: 'live' }, CATS),
    ).toBeNull();
    expect(parseListItem('series', { series_id: 'x1', name: 'Serie' }, CATS)).toBeNull();
    /* Sin `name`, vale `title`. */
    expect(parseListItem('series', { series_id: 9, title: 'Serie' }, CATS)?.title).toBe('Serie');
  });

  it('`is_adult` en sus variantes y categorías de adultos por nombre', () => {
    for (const flag of [1, '1', true]) {
      expect(parseListItem('movie', { stream_id: 1, name: 'A', is_adult: flag }, CATS)?.adult).toBe(
        true,
      );
    }
    expect(parseListItem('movie', { stream_id: 1, name: 'A', is_adult: '0' }, CATS)?.adult).toBe(
      false,
    );
    expect(parseListItem('movie', { stream_id: 1, name: 'A', category_id: '3' }, CATS)?.adult).toBe(
      true,
    );
  });

  it('extensión fuera de la lista, cartel con credenciales o no http, nota rara', () => {
    const row = parseListItem(
      'movie',
      {
        stream_id: 5,
        name: 'X',
        container_extension: 'exe',
        stream_icon: 'http://u:p@x.example/a.jpg',
        rating: '99',
      },
      CATS,
    );
    expect(row).toMatchObject({ ext: 0, poster: null, rating: RATING_NONE });
    expect(imageUrl('javascript:alert(1)')).toBeNull();
    expect(imageUrl(`http://x.example/${'a'.repeat(1100)}`)).toBeNull();
  });

  it('entidades HTML y caracteres de control', () => {
    expect(cleanText('Tom &amp; Jerry\u0000\u0007 &quot;x&quot; &#39;y&#39; &lt;b&gt;', 200)).toBe(
      `Tom & Jerry "x" 'y' <b>`,
    );
    expect(cleanText('<b>Hola</b>\n mundo', 200)).toBe('Hola mundo');
    expect(cleanText('x'.repeat(300), 200)).toHaveLength(200);
  });

  it('series: `last_modified`, `cover`, `release_date`', () => {
    const row = parseListItem(
      'series',
      {
        series_id: 11,
        name: 'The Office (US)',
        cover: 'http://img.example/o.jpg',
        last_modified: '1700000500',
        release_date: '2005-03-24',
      },
      CATS,
    );
    expect(row).toMatchObject({ source: 11, year: 2005, added: 1_700_000_500, ext: 0 });
    expect(row?.title).toBe('The Office (US)');
  });

  it('objetos de 200 KiB en series caben con su tope; los de 300 KiB se saltan', async () => {
    const big = (size: number, id: number) =>
      JSON.stringify({ series_id: id, name: `Serie ${id}`, plot: 'x'.repeat(size) });
    const body = Readable.from([
      Buffer.from(`[${big(200 * 1024, 1)},${big(300 * 1024, 2)},${big(10, 3)}]`),
    ]);
    const seen: number[] = [];
    const result = await parseJsonArrayStream(
      body,
      (item) => {
        const row = parseListItem('series', item, CATS);
        if (row) seen.push(row.source);
      },
      { maxObjectBytes: VOD_LIMITS.series.maxObjectBytes },
    );
    expect(seen).toEqual([1, 3]);
    expect(result.skipped).toBe(1);
  });
});

describe('fichas (§7.2)', () => {
  it('película: textos, pistas técnicas y duración', () => {
    const info = parseMovieInfo({
      info: {
        name: 'Oppenheimer',
        o_name: 'Oppenheimer',
        description: 'Sinopsis &amp; más',
        actors: ['Cillian Murphy', 'Emily Blunt'],
        genre: 'Drama / Historia, Drama',
        releaseDate: '2023-07-21',
        duration: '03:00:00',
        backdrop_path: ['nada', 'http://img.example/f.jpg'],
        video: { codec_name: 'hevc', height: 2160, width: 3840, pix_fmt: 'yuv420p10le' },
        audio: { codec_name: 'eac3', channels: '6', tags: { language: 'SPA' } },
      },
      movie_data: { stream_id: 1, container_extension: 'mkv', added: '1700000000' },
    });
    expect(info).toMatchObject({
      kind: 'movie',
      title: 'Oppenheimer',
      plot: 'Sinopsis & más',
      cast: ['Cillian Murphy', 'Emily Blunt'],
      genres: ['Drama', 'Historia'],
      year: 2023,
      durationS: 10_800,
      backdrop: 'http://img.example/f.jpg',
      video: { codec: 'hevc', width: 3840, height: 2160, bitDepth: 10 },
      audio0: { codec: 'eac3', channels: 6, lang: 'spa' },
      ext: 2,
    });
  });

  it('`info`, `video` y `audio` como `[]` no rompen', () => {
    const info = parseMovieInfo({ info: [], movie_data: [] });
    expect(info).toMatchObject({
      title: null,
      plot: null,
      genres: [],
      audio0: null,
      durationS: null,
    });
    expect(info.video).toEqual({ codec: null, width: null, height: null, bitDepth: null });
    const loose = parseMovieInfo({ info: { video: [], audio: [{ codec_name: 'aac' }] } });
    expect(loose.audio0?.codec).toBe('aac');
  });

  it('serie con `episodes` como objeto: temporadas en orden, «Especiales» al final, prefijo quitado', () => {
    const info = parseSeriesInfo({
      seasons: [{ season_number: 1, name: 'Primera' }],
      info: { name: 'The Office' },
      episodes: {
        '2': [
          { id: '22', episode_num: '2', title: 'The Office - S02E02 - ' },
          { id: '21', episode_num: 1, title: 'The Office - S02E01 - El regreso' },
        ],
        '1': [{ id: 11, episode_num: 1, title: 'The Office - S01E01 - Piloto', info: [] }],
        '0': [{ id: 91, episode_num: 1, title: 'Especial' }],
      },
    });
    expect(info.seasons.map((s) => [s.number, s.name])).toEqual([
      [1, 'Primera'],
      [2, 'Temporada 2'],
      [0, 'Especiales'],
    ]);
    expect(info.seasons[1]?.episodes.map((e) => [e.source, e.number, e.title])).toEqual([
      [21, 1, 'El regreso'],
      [22, 2, 'Episodio 2'],
    ]);
    expect(info.seasons[0]?.episodes[0]?.title).toBe('Piloto');
  });

  it('`episodes` como array de arrays (temporada por `season`) y como `[]`', () => {
    const info = parseSeriesInfo({
      episodes: [
        [{ id: 1, episode_num: 1, season: 1, title: 'A' }],
        [
          { id: 2, episode_num: 1, season: 2, title: 'B' },
          { id: 'no', episode_num: 2, season: 2 },
        ],
      ],
    });
    expect(info.seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(info.skippedEpisodes).toBe(1);
    expect(parseSeriesInfo({ episodes: [], seasons: [], info: [] }).seasons).toEqual([]);
  });

  it('topes de temporadas y episodios con `truncated`', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      id: i + 1,
      episode_num: i + 1,
      season: 1,
    }));
    const info = parseSeriesInfo({ episodes: { '1': many } });
    expect(info.seasons[0]?.episodes).toHaveLength(VOD_LIMITS.episodesPerSeasonMax);
    expect(info.truncated).toBe(true);
    const seasons = Object.fromEntries(
      Array.from({ length: 120 }, (_, s) => [String(s + 1), [{ id: s + 1, episode_num: 1 }]]),
    );
    const wide = parseSeriesInfo({ episodes: seasons });
    expect(wide.seasons).toHaveLength(VOD_LIMITS.seasonsMax);
    expect(wide.truncated).toBe(true);
  });

  it('título de episodio', () => {
    expect(episodeTitle('Serie - S01E03 - Nombre', 3)).toBe('Nombre');
    expect(episodeTitle('S1 E3', 3)).toBe('Episodio 3');
    expect(episodeTitle('', 4)).toBe('Episodio 4');
    expect(episodeTitle('Un título normal', 1)).toBe('Un título normal');
  });

  it('pista de «se puede reproducir»', () => {
    expect(playableHint('h264', 8, 2)).toBe('yes');
    expect(playableHint('h264', 10, 2)).toBe('no');
    expect(playableHint('hevc', 10, 2)).toBe('hevc');
    expect(playableHint('mpeg4', null, 1)).toBe('no');
    expect(playableHint(null, null, 2)).toBe('unknown');
    /* AVI y TS: no en la v1 (§9.11). */
    expect(playableHint('h264', 8, 5)).toBe('no');
    expect(playableHint(null, null, 6)).toBe('no');
  });
});

describe('paneles reales: textos, fechas, notas y duraciones (0.9.0)', () => {
  it('cleanText: entidades de PHP (con nombre, de tilde y numéricas), etiquetas y caracteres de control', () => {
    expect(cleanText('Pel&iacute;culas &amp; Series &#8211; Espa&ntilde;a &#xE9;&#233;', 200)).toBe(
      'Películas & Series – España éé',
    );
    expect(cleanText('PEL<b>Í</b>CULAS<br/>NUEVAS', 200)).toBe('PELÍCULAS NUEVAS');
    expect(cleanText('nota < 5 y > 3', 200)).toBe('nota < 5 y > 3');
    expect(cleanText('a\u0000b\u0007c d', 200)).toBe('a b c d');
    expect(cleanText('&#0;&#x1F;&#55296;x', 200)).toBe('x');
    expect(cleanText('&nada; &amp;amp;', 200)).toBe('&nada; &amp;');
    /* Nunca parte un emoji al recortar. */
    expect(cleanText('ab😀cd', 3)).toBe('ab');
    expect(cleanText(null, 10)).toBe('');
    expect(cleanText(12, 10)).toBe('12');
  });

  it('fechas a AAAA-MM-DD, años sueltos y notas con coma', () => {
    expect(dateOf('2023-07-21')).toBe('2023-07-21');
    expect(dateOf('2023-07-21 12:30:00')).toBe('2023-07-21');
    expect(dateOf('2023/7/1')).toBe('2023-07-01');
    expect(dateOf('21/07/2023')).toBe('2023-07-21');
    expect(dateOf('21.07.2023')).toBe('2023-07-21');
    for (const bad of ['2023-02-31', '2023', '', null, 'mañana', '0000-00-00', '1500-01-01']) {
      expect(dateOf(bad), String(bad)).toBeNull();
    }
    expect(yearOf('21/07/2023')).toBe(2023);
    expect(yearOf('2023-07-21')).toBe(2023);
    expect(yearOf('12345')).toBeNull();
    expect(ratingOf({ rating: '7,8' })).toBe(7.8);
    expect(ratingOf({ rating: '', rating_5based: '3,5' })).toBe(7);
    expect(ratingOf({ rating: 'N/A' })).toBeNull();
  });

  it('tráiler: id de YouTube o URL de YouTube; lo demás, nada', () => {
    expect(trailerOf('uYPbbksJxIg')).toBe('uYPbbksJxIg');
    expect(trailerOf('https://www.youtube.com/watch?v=uYPbbksJxIg&t=3')).toBe('uYPbbksJxIg');
    expect(trailerOf('youtu.be/uYPbbksJxIg')).toBe('uYPbbksJxIg');
    expect(trailerOf('https://www.youtube.com/embed/uYPbbksJxIg')).toBe('uYPbbksJxIg');
    for (const bad of [
      '',
      null,
      'corto',
      'https://vimeo.com/123456789',
      'https://evil.example/watch?v=uYPbbksJxIg',
    ]) {
      expect(trailerOf(bad), String(bad)).toBeNull();
    }
  });

  it('duraciones: segundos, HH:MM:SS, «1h 30m», «95 min» y minutos de `episode_run_time`', () => {
    expect(durationOf({ duration_secs: '5400' })).toBe(5_400);
    expect(durationOf({ duration: '01:30:00' })).toBe(5_400);
    expect(durationOf({ duration: '1h 30m' })).toBe(5_400);
    expect(durationOf({ duration: '95 min' })).toBe(5_700);
    expect(durationOf({ duration: '', episode_run_time: '45' })).toBe(2_700);
    expect(durationOf({ episode_run_time: [42, 45] })).toBe(2_520);
    expect(durationOf({ duration: 'mucho' })).toBeNull();
    expect(seasonName('Season 2', 2)).toBe('Temporada 2');
    expect(seasonName('Saison 02', 2)).toBe('Temporada 2');
    expect(seasonName('Season 0', 0)).toBe('Especiales');
    expect(seasonName('Parte 1', 1)).toBe('Parte 1');
    expect(seasonName('Season 3', 2)).toBe('Season 3');
  });

  it('ficha de película de un panel real: claves vacías, alternativas, nulos y todo lo que da Xtream', () => {
    const movie = parseMovieInfo({
      info: {
        kinopoisk_url: '',
        tmdb_id: '872585',
        name: 'Oppenheimer',
        o_name: 'Oppenheimer',
        cover_big: '',
        movie_image: 'https://image.tmdb.org/t/p/w600/a.jpg',
        releasedate: '21/07/2023',
        youtube_trailer: 'https://www.youtube.com/watch?v=uYPbbksJxIg',
        director: 'Christopher Nolan',
        actors: 'Cillian Murphy, Emily Blunt',
        cast: '',
        description: 'Sinopsis de &quot;la&quot; película.',
        plot: '',
        age: '',
        mpaa_rating: 'R',
        country: 'United States of America',
        genre: null,
        genres: 'Drama, Historia',
        backdrop_path: ['', 'https://image.tmdb.org/t/p/w1280/b.jpg'],
        duration_secs: null,
        duration: '03:00:00',
        video: null,
        audio: [],
        rating: '8,1',
      },
      movie_data: { stream_id: '1', container_extension: '', added: '2023-11-02 10:00:00' },
    });
    expect(movie).toMatchObject({
      title: 'Oppenheimer',
      plot: 'Sinopsis de "la" película.',
      cast: ['Cillian Murphy', 'Emily Blunt'],
      genres: ['Drama', 'Historia'],
      ageRating: 'R',
      rating: 8.1,
      durationS: 10_800,
      releaseDate: '2023-07-21',
      year: 2023,
      trailer: 'uYPbbksJxIg',
      cover: 'https://image.tmdb.org/t/p/w600/a.jpg',
      backdrop: 'https://image.tmdb.org/t/p/w1280/b.jpg',
      ext: 0,
    });
    expect(movie.added).toBeGreaterThan(1_698_000_000);
    expect(parseMovieInfo(null)).toMatchObject({ title: null, releaseDate: null, trailer: null });
  });

  it('ficha de serie de un panel real: `seasons` como objeto, «Season N», sin `episode_num` y fechas', () => {
    const series = parseSeriesInfo({
      seasons: {
        '1': {
          season_number: '1',
          name: 'Season 1',
          overview: 'La primera.',
          air_date: '2005-03-24',
        },
        '2': { season_number: 2, name: 'Temporada 2', overview: '', air_date: '20/09/2005' },
      },
      info: {
        name: 'The Office',
        o_name: 'The Office (US)',
        plot: 'Scranton.',
        cast: 'Steve Carell',
        releaseDate: '2005-03-24',
        youtube_trailer: 'LHOtME2DL4g',
        episode_run_time: '22',
        age: '12+',
        rating_5based: '4,3',
      },
      episodes: {
        '1': [
          {
            id: '11',
            title: 'The Office - S01E01 - Piloto',
            container_extension: 'MP4',
            info: { air_date: '2005-03-24', rating: '7.5' },
          },
          { id: '12', title: '', container_extension: 'mkv', info: null },
        ],
        '2': [{ id: '21', episode_num: '01', title: 'El regreso', info: [] }],
      },
    });
    expect(series).toMatchObject({
      originalTitle: 'The Office (US)',
      releaseDate: '2005-03-24',
      trailer: 'LHOtME2DL4g',
      episodeDurationS: 1_320,
      ageRating: '12+',
      rating: 8.6,
    });
    expect(
      series.seasons.map((season) => [season.number, season.name, season.plot, season.airDate]),
    ).toEqual([
      [1, 'Temporada 1', 'La primera.', '2005-03-24'],
      [2, 'Temporada 2', null, '2005-09-20'],
    ]);
    expect(
      series.seasons[0]?.episodes.map((e) => [
        e.number,
        e.title,
        e.airDate,
        e.rating,
        extName(e.ext),
      ]),
    ).toEqual([
      [1, 'Piloto', '2005-03-24', 7.5, 'mp4'],
      [2, 'Episodio 2', null, null, 'mkv'],
    ]);
  });
});
