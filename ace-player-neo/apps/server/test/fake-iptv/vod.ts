/* Películas y series del proveedor IPTV falso (docs/vod.md §15.3).

   Las 6 acciones VOD de `player_api.php`:
   - `get_vod_categories`, `get_vod_streams`, `get_series_categories` y
     `get_series` (también con `&category_id=X`, el modo por categorías);
   - `get_vod_info&vod_id=` y `get_series_info&series_id=`.
   Un catálogo pequeño con los casos de docs/vod.md §15.1 (títulos con
   prefijos y etiquetas, año, distintivos, una categoría de adultos, un AVI,
   una serie con temporadas y «Especiales», títulos no latinos) y, con
   `vod: N`, N películas sintéticas más (catálogos grandes en streaming).

   Carteles en `/arte/<n>.png` (un PNG de verdad), `/arte/falso.svg` (SVG:
   se rechaza por los bytes) y `/arte/no-hay.png` (404).

   Modos (`/__iptv/vod?modo=`):
   - `normal`: lo de arriba;
   - `rarezas`: las mismas cosas como las manda un panel PHP raro (números
     como texto, `info` como `[]`, `episodes` como array de arrays, ids de
     episodio como texto, `release_date` en vez de `releaseDate`…);
   - `sin-vod`: las listas responden `{}` (VOD apagado en el panel);
   - `vacio`: las listas responden `[]`;
   - `user-info`: las listas responden el objeto `user_info` (otros paneles);
   - `lista-500`: las listas COMPLETAS dan 500 y las de una categoría van
     bien (el modo por categorías, §4.7);
   - `categoria-500`: como `lista-500`, pero la categoría 10 («ES |
     PELÍCULAS») también da 500 (una categoría mala: se queda como estaba);
   - `fichas-500`: `get_vod_info` y `get_series_info` dan 500;
   - `lista-texto`: las listas responden un texto (un error de PHP) en vez
     del array: es un fallo, no «sin VOD». */

export const FAKE_VOD_MODES = [
  'normal',
  'rarezas',
  'sin-vod',
  'vacio',
  'user-info',
  'lista-500',
  'categoria-500',
  'fichas-500',
  'lista-texto',
] as const;
export type FakeVodMode = (typeof FAKE_VOD_MODES)[number];

/** PNG de 1×1 (bytes mágicos de verdad). */
export const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface FakeMovie {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly ext: string;
  readonly added: number;
  readonly rating?: number;
  readonly year?: string;
  readonly adult?: boolean;
  readonly icon?: string | null;
  readonly codec?: string;
  /** `o_name` de la ficha (si no, el nombre sin el prefijo). */
  readonly original?: string;
}

interface FakeSeries {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly modified: number;
  readonly rating?: number;
  readonly cover?: string | null;
}

export const FAKE_VOD_MOVIE_CATEGORIES = [
  { category_id: '10', category_name: 'ES | PELÍCULAS', parent_id: 0 },
  { category_id: '11', category_name: 'LATINO | PELIS', parent_id: 0 },
  { category_id: '12', category_name: 'VOD | 4K', parent_id: 0 },
  { category_id: '13', category_name: 'XXX ADULTOS', parent_id: 0 },
];

export const FAKE_VOD_SERIES_CATEGORIES = [
  { category_id: '20', category_name: 'ES | SERIES', parent_id: 0 },
  { category_id: '21', category_name: 'ANIME', parent_id: 0 },
];

export const FAKE_VOD_MOVIES: readonly FakeMovie[] = [
  {
    id: 2001,
    name: 'ES| Oppenheimer (2023) 4K',
    category: '12',
    ext: 'mkv',
    added: 1_700_000_900,
    rating: 8.3,
  },
  {
    id: 2002,
    name: '|LAT| Dune 4K',
    category: '11',
    ext: 'mp4',
    added: 1_700_000_800,
    rating: 7.9,
    year: '2021',
  },
  {
    id: 2003,
    name: 'Amélie (2001) VOSE',
    category: '10',
    ext: 'mkv',
    added: 1_700_000_700,
    rating: 8.0,
    original: 'Le Fabuleux Destin d&#039;Amélie Poulain',
  },
  {
    id: 2004,
    name: 'Spider-Man: No Way Home (2021)',
    category: '10',
    ext: 'mp4',
    added: 1_700_000_600,
  },
  { id: 2005, name: 'Dune (2021)', category: '10', ext: 'mkv', added: 1_700_000_500, year: '2021' },
  {
    id: 2006,
    name: 'Película adulta de prueba',
    category: '13',
    ext: 'mp4',
    added: 1_700_000_100,
    adult: true,
  },
  {
    id: 2007,
    name: 'Mission: Impossible – Dead Reckoning (2023)',
    category: '10',
    ext: 'avi',
    added: 1_700_000_400,
    codec: 'mpeg4',
  },
  {
    id: 2008,
    name: 'Reserva (2018)',
    category: '10',
    ext: 'mp4',
    added: 1_700_000_300,
    icon: null,
  },
  {
    id: 2009,
    name: 'Паразиты (2019)',
    category: '10',
    ext: 'mkv',
    added: 1_700_000_200,
    codec: 'hevc',
  },
];

export const FAKE_VOD_SERIES: readonly FakeSeries[] = [
  { id: 3001, name: 'The Office (US)', category: '20', modified: 1_700_002_000, rating: 8.9 },
  { id: 3002, name: 'ES - Paquita Salas', category: '20', modified: 1_700_001_000 },
  { id: 3003, name: '東京物語', category: '21', modified: 1_700_000_500, cover: null },
];

export interface FakeVod {
  modo(mode: FakeVodMode): void;
  readonly mode: FakeVodMode;
  /**
   * Respuesta de una acción VOD de `player_api.php` (`undefined` si no es
   * VOD): el cuerpo JSON o un estado HTTP de error.
   */
  answer(action: string, url: URL): { status: number; body?: unknown } | undefined;
  /** Un cartel: bytes y tipo, o null (404). */
  art(path: string): { type: string; body: Buffer } | null;
}

/** El catálogo VOD falso (`extra` películas sintéticas más). */
export function createFakeVod(base: () => string, extra = 0): FakeVod {
  let mode: FakeVodMode = 'normal';
  const icon = (id: number, value?: string | null): string =>
    value === null ? '' : (value ?? `${base()}/arte/${id}.png`);
  const raro = (): boolean => mode === 'rarezas';

  const movieItem = (movie: FakeMovie, num: number): Record<string, unknown> => ({
    num,
    name: movie.name,
    stream_type: 'movie',
    stream_id: raro() ? String(movie.id) : movie.id,
    stream_icon: icon(movie.id, movie.icon),
    rating: movie.rating === undefined ? '' : raro() ? String(movie.rating) : movie.rating,
    rating_5based: movie.rating === undefined ? 0 : movie.rating / 2,
    added: raro() ? String(movie.added) : movie.added,
    is_adult: movie.adult ? (raro() ? '1' : 1) : 0,
    ...(raro() && movie.id % 2 === 0
      ? { category_id: null, category_ids: [Number(movie.category)] }
      : { category_id: movie.category }),
    container_extension: raro() ? movie.ext.toUpperCase() : movie.ext,
    custom_sid: '',
    direct_source: `http://no-usar.example/${movie.id}.${movie.ext}`,
    ...(movie.year ? { year: movie.year } : {}),
  });

  const synthetic = (index: number): FakeMovie => ({
    id: 100_000 + index,
    name: `Película de prueba número ${index} (${2000 + (index % 25)})`,
    category: String(10 + (index % 3)),
    ext: index % 2 ? 'mkv' : 'mp4',
    added: 1_600_000_000 + index,
  });

  const allMovies = (): FakeMovie[] => [
    ...FAKE_VOD_MOVIES,
    ...Array.from({ length: extra }, (_, index) => synthetic(index)),
  ];

  const seriesItem = (series: FakeSeries, num: number): Record<string, unknown> => ({
    num,
    name: series.name,
    series_id: raro() ? String(series.id) : series.id,
    cover: icon(series.id, series.cover),
    plot: 'Sinopsis larga de la lista que se tira al sincronizar.',
    cast: 'Reparto',
    rating: series.rating ?? '',
    last_modified: raro() ? String(series.modified) : series.modified,
    category_id: series.category,
    backdrop_path: [`${base()}/arte/fondo-${series.id}.png`],
    ...(raro() ? { release_date: '2005-03-24' } : { releaseDate: '2005-03-24' }),
  });

  const movieInfo = (id: number): unknown => {
    const movie = allMovies().find((item) => item.id === id);
    if (!movie) return { info: [], movie_data: [] };
    if (raro()) {
      return { info: [], movie_data: { stream_id: String(id), container_extension: movie.ext } };
    }
    return {
      info: {
        /* Lo que manda un panel de verdad (get_vod_info), con sus claves
           vacías: `cast` vacío y `actors` lleno, `age` vacío y `mpaa_rating`
           lleno, `kinopoisk_url`… */
        kinopoisk_url: '',
        tmdb_id: String(id + 870_000),
        name: movie.name,
        o_name: movie.original ?? movie.name.replace(/^[^|]*\|\s*/, ''),
        plot: 'Una sinopsis &amp; algo más.\u0007',
        description: '',
        cast: '',
        actors: 'Cillian Murphy, Emily Blunt, Matt Damon',
        director: 'Christopher Nolan',
        genre: 'Drama / Historia',
        country: 'Estados Unidos',
        releasedate: '2023-07-21',
        youtube_trailer: id === 2001 ? 'uYPbbksJxIg' : '',
        episode_run_time: '180',
        duration_secs: 10_800,
        duration: '03:00:00',
        rating: movie.rating ?? '',
        age: '',
        mpaa_rating: '+13',
        backdrop_path: [`${base()}/arte/fondo-${id}.png`],
        cover_big: `${base()}/arte/${id}.png`,
        movie_image: '',
        video: {
          codec_name: movie.codec ?? 'h264',
          width: 1920,
          height: 1080,
          pix_fmt: 'yuv420p',
        },
        audio: { codec_name: 'ac3', channels: 6, tags: { language: 'spa' } },
      },
      movie_data: {
        stream_id: id,
        name: movie.name,
        added: movie.added,
        container_extension: movie.ext,
      },
    };
  };

  const episode = (
    id: number,
    season: number,
    number: number,
    title: string,
  ): Record<string, unknown> => ({
    id: raro() ? String(id) : id,
    episode_num: raro() ? String(number) : number,
    title,
    container_extension: 'mkv',
    season,
    info: raro()
      ? []
      : {
          duration_secs: 1_320,
          plot: `Episodio ${number} de la temporada ${season}.`,
          movie_image: `${base()}/arte/ep-${id}.png`,
          air_date: `2005-0${Math.min(9, season + 3)}-${String(10 + number)}`,
          rating: (7 + number / 10).toFixed(1),
          video: { codec_name: 'h264', width: 1280, height: 720 },
        },
  });

  const seriesInfo = (id: number): unknown => {
    const series = FAKE_VOD_SERIES.find((item) => item.id === id);
    if (!series) return { seasons: [], info: [], episodes: [] };
    const base10 = id * 10;
    const s1 = [
      episode(base10 + 1, 1, 1, `${series.name} - S01E01 - Piloto`),
      episode(base10 + 2, 1, 2, `${series.name} - S01E02 - Día de la diversidad`),
    ];
    const s2 = [
      episode(base10 + 4, 2, 2, `${series.name} - S02E02 - `),
      episode(base10 + 3, 2, 1, `${series.name} - S02E01 - El regreso`),
    ];
    const specials = [episode(base10 + 9, 0, 1, 'Especial de Navidad')];
    return {
      seasons: raro()
        ? []
        : [
            {
              season_number: 1,
              name: 'Season 1',
              episode_count: 2,
              overview: 'Llega el equipo de documentales.',
              air_date: '2005-03-24',
            },
            {
              season_number: 2,
              name: 'Temporada 2',
              episode_count: 2,
              overview: '',
              /* Como la manda algún panel: con barras y día delante. */
              air_date: '20/09/2005',
            },
          ],
      info: raro()
        ? []
        : {
            name: series.name,
            o_name: id === 3001 ? 'The Office' : series.name,
            plot: 'Una oficina de papel en Scranton.',
            cast: 'Steve Carell, Rainn Wilson',
            director: 'Greg Daniels',
            genre: 'Comedia',
            releaseDate: '2005-03-24',
            rating: series.rating ?? '',
            age: '12',
            youtube_trailer: id === 3001 ? 'https://www.youtube.com/watch?v=LHOtME2DL4g' : '',
            episode_run_time: '22',
            backdrop_path: [`${base()}/arte/fondo-${id}.png`],
          },
      episodes: raro() ? [s1, s2, specials] : { '2': s2, '1': s1, '0': specials },
    };
  };

  const byCategory = <T extends { category: string }>(list: T[], url: URL): T[] => {
    const category = url.searchParams.get('category_id');
    return category === null ? list : list.filter((item) => item.category === category);
  };

  const listAnswer = (url: URL, full: () => unknown[]): { status: number; body?: unknown } => {
    const whole = url.searchParams.get('category_id') === null;
    if (mode === 'sin-vod') return { status: 200, body: {} };
    if (mode === 'vacio') return { status: 200, body: [] };
    if (mode === 'user-info') return { status: 200, body: { user_info: { auth: 1 } } };
    if (mode === 'lista-500' && whole) return { status: 500 };
    if (mode === 'categoria-500' && (whole || url.searchParams.get('category_id') === '10')) {
      return { status: 500 };
    }
    if (mode === 'lista-texto') {
      return { status: 200, body: 'Fatal error: Allowed memory size exhausted' };
    }
    return { status: 200, body: full() };
  };

  return {
    get mode() {
      return mode;
    },
    modo(next) {
      mode = next;
    },
    answer(action, url) {
      switch (action) {
        case 'get_vod_categories':
          return { status: 200, body: FAKE_VOD_MOVIE_CATEGORIES };
        case 'get_series_categories':
          return { status: 200, body: FAKE_VOD_SERIES_CATEGORIES };
        case 'get_vod_streams':
          return listAnswer(url, () =>
            byCategory(allMovies(), url).map((movie, index) => movieItem(movie, index + 1)),
          );
        case 'get_series':
          return listAnswer(url, () =>
            byCategory([...FAKE_VOD_SERIES], url).map((series, index) =>
              seriesItem(series, index + 1),
            ),
          );
        case 'get_vod_info':
          if (mode === 'fichas-500') return { status: 500 };
          return { status: 200, body: movieInfo(Number(url.searchParams.get('vod_id'))) };
        case 'get_series_info':
          if (mode === 'fichas-500') return { status: 500 };
          return { status: 200, body: seriesInfo(Number(url.searchParams.get('series_id'))) };
        default:
          return undefined;
      }
    },
    art(path) {
      if (path === '/arte/falso.svg') {
        return {
          type: 'image/svg+xml',
          body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        };
      }
      if (path === '/arte/no-hay.png') return null;
      if (/^\/arte\/[a-z0-9-]{1,40}\.png$/.test(path)) return { type: 'image/png', body: FAKE_PNG };
      return null;
    },
  };
}
