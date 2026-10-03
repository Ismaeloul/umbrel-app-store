import { describe, expect, it } from 'vitest';
import {
  browseQuery,
  canSearchCine,
  chunk,
  columnsFor,
  durationText,
  episodesThrough,
  isWatched,
  metaLine,
  nextEpisode,
  orderedTags,
  playBlock,
  readCineState,
  remainingText,
  resumeAt,
  seriesMain,
  writeCineState,
  ageText,
  clockText,
  endsAtText,
  ratingText,
  releasedText,
  seasonName,
  seriesPlayLabel,
  shortDateText,
  showsGrid,
  spanishCountry,
  spanishGenres,
  type EpisodeProgressRef,
} from './model.ts';
import { formatBlocked, formatCount, titlesText } from './texts.ts';

describe('estado de la URL (docs/vod.md §12.2)', () => {
  it('lee y escribe cine, cinecat, cinetag, cineq y cineorden sin tocar lo demás', () => {
    const state = readCineState(
      '?vista=cine&cine=series&cinecat=a1b2c3d4e5f6&cinetag=vose&cineq=dune&cineorden=az',
    );
    expect(state).toEqual({
      kind: 'series',
      cat: 'a1b2c3d4e5f6',
      tag: 'vose',
      q: 'dune',
      order: 'az',
    });
    expect(writeCineState('?vista=cine&demo=1&flag=cine', state)).toBe(
      '?vista=cine&demo=1&flag=cine&cine=series&cinecat=a1b2c3d4e5f6&cinetag=vose&cineq=dune&cineorden=az',
    );
    // Lo que vale por defecto no se escribe (URLs cortas); sin categoría, la portada.
    expect(
      writeCineState('?vista=cine&cine=series&cineq=x&cinecat=all', {
        kind: 'movie',
        cat: null,
        tag: null,
        q: '',
        order: 'novedades',
      }),
    ).toBe('?vista=cine');
    // «Todas» SÍ se escribe: es la rejilla de todo, otra pantalla que la portada.
    expect(
      writeCineState('?vista=cine', { kind: 'movie', cat: 'all', tag: null, q: '', order: 'az' }),
    ).toBe('?vista=cine&cinecat=all&cineorden=az');
  });

  it('lo que no se entiende vale por defecto (sin categoría: la portada)', () => {
    expect(readCineState('?cine=cosas&cinecat=<script>&cinetag=8k&cineorden=zz')).toEqual({
      kind: 'movie',
      cat: null,
      tag: null,
      q: '',
      order: 'novedades',
    });
    expect(readCineState('?cinecat=all').cat).toBe('all');
  });

  it('portada o rejilla: una categoría, un distintivo o una búsqueda abren la rejilla', () => {
    expect(showsGrid({ cat: null, tag: null }, '')).toBe(false);
    expect(showsGrid({ cat: 'all', tag: null }, '')).toBe(true);
    expect(showsGrid({ cat: 'a1b2c3d4e5f6', tag: null }, '')).toBe(true);
    expect(showsGrid({ cat: null, tag: '4k' }, '')).toBe(true);
    expect(showsGrid({ cat: null, tag: null }, 'dune')).toBe(true);
    // La portada pide «todas» si alguien pide la rejilla sin categoría (un distintivo).
    expect(browseQuery({ kind: 'movie', cat: null, tag: '4k', order: 'novedades' }, '')).toEqual({
      kind: 'movie',
      cat: 'all',
      tag: '4k',
      sort: 'added',
    });
  });

  it('la consulta a vodBrowse: el texto desde 2 letras y el orden a su nombre del contrato', () => {
    const state = {
      kind: 'movie' as const,
      cat: 'all',
      tag: 'castellano' as const,
      order: 'az' as const,
    };
    expect(browseQuery(state, '  la   casa ')).toEqual({
      kind: 'movie',
      cat: 'all',
      tag: 'castellano',
      q: 'la casa',
      sort: 'name',
    });
    expect(browseQuery({ ...state, tag: null, order: 'novedades' }, 'd')).toEqual({
      kind: 'movie',
      cat: 'all',
      sort: 'added',
    });
    expect(canSearchCine(' a ')).toBe(false);
    expect(canSearchCine('ab')).toBe(true);
  });
});

describe('rejilla (§12.4)', () => {
  it('carteles grandes: 2 columnas en el móvil, 3 desde 480, 4 desde 768, 5 desde 1024 y 6 desde 1280', () => {
    expect([320, 360, 479, 480, 767, 768, 1023, 1024, 1279, 1280, 2560].map(columnsFor)).toEqual([
      2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    ]);
  });

  it('filas de N (la última, corta)', () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('etiquetas de tiempo y datos', () => {
  it('duraciones y lo que queda', () => {
    expect(durationText(8100)).toBe('2 h 15 min');
    expect(durationText(2700)).toBe('45 min');
    expect(durationText(3600)).toBe('1 h');
    expect(durationText(20)).toBe('1 min');
    expect(durationText(null)).toBeNull();
    expect(remainingText(2592, 9360)).toBe('Quedan 1 h 53 min');
    expect(remainingText(1300, 1320)).toBe('Quedan 1 min');
  });

  it('la línea de datos de la ficha: «2023 · 2 h 15 min · 7,3 · +13»', () => {
    expect(metaLine({ year: 2023, durationS: 8100, rating: 7.3, ageRating: '13' })).toBe(
      '2023 · 2 h 15 min · 7,3 · +13',
    );
    expect(metaLine({ year: null, rating: 8, ageRating: 'TP' })).toBe('8,0 · TP');
    // Un 0 de nota o de edad es «sin dato» en los paneles Xtream: no se enseña.
    expect(metaLine({ year: 2020, rating: 0, ageRating: '0' })).toBe('2020');
    expect(ratingText(0)).toBeNull();
    expect(ageText('00')).toBeNull();
  });

  it('«43:12» y «1:05:09»: dónde se sigue viendo', () => {
    expect(clockText(2592)).toBe('43:12');
    expect(clockText(3909)).toBe('1:05:09');
    expect(clockText(5)).toBe('0:05');
    expect(clockText(Number.NaN)).toBe('0:00');
  });

  it('«Termina a las 23:47»: ahora más lo que queda', () => {
    const now = new Date(2026, 9, 3, 21, 55).getTime();
    expect(endsAtText(6720, now)).toBe('Termina a las 23:47');
    expect(endsAtText(0, now)).toBeNull();
    expect(endsAtText(null, now)).toBeNull();
  });

  it('fecha de estreno en castellano, sin líos de zona horaria', () => {
    expect(releasedText('2023-05-12')).toBe('12 de mayo de 2023');
    expect(releasedText('2021-09-01')).toBe('1 de septiembre de 2021');
    expect(releasedText('2021-13-01')).toBeNull();
    expect(releasedText(null)).toBeNull();
    expect(releasedText('12/05/2023')).toBeNull();
    // La emisión de un episodio, corta: «24 mar 2005».
    expect(shortDateText('2005-03-24')).toBe('24 mar 2005');
    expect(shortDateText('2016-09-01')).toBe('1 sept 2016');
    expect(shortDateText('2016-9-1')).toBeNull();
    expect(shortDateText(undefined)).toBeNull();
  });

  it('géneros de TMDB en inglés y países como código, en castellano', () => {
    expect(spanishGenres(['Action', 'Science Fiction', 'Thriller', 'War', 'Drama'])).toEqual([
      'Acción',
      'Ciencia ficción',
      'Suspense',
      'Bélica',
      'Drama',
    ]);
    // Ya en castellano, o sin traducción: tal cual; sin repetir.
    expect(spanishGenres(['Comedia', 'Comedy', 'Kaiju'])).toEqual(['Comedia', 'Kaiju']);
    expect(spanishCountry('US')).toBe('Estados Unidos');
    expect(spanishCountry('es')).toBe('España');
    expect(spanishCountry('Argentina')).toBe('Argentina');
    expect(spanishCountry('  ')).toBeNull();
  });

  it('temporadas: «Season 2» o «s02» se ven como «Temporada 2»; un nombre de verdad se respeta', () => {
    expect(seasonName(2, 'Season 2')).toBe('Temporada 2');
    expect(seasonName(2, 's02')).toBe('Temporada 2');
    expect(seasonName(2, 'S 2')).toBe('Temporada 2');
    expect(seasonName(2, 'Temporada 02')).toBe('Temporada 2');
    expect(seasonName(2, '2 сезон')).toBe('Temporada 2');
    expect(seasonName(3, '')).toBe('Temporada 3');
    expect(seasonName(0, 'Specials')).toBe('Especiales');
    expect(seasonName(1, 'Parte 1')).toBe('Parte 1');
    expect(seasonName(1, 'Libro uno: Agua')).toBe('Libro uno: Agua');
  });

  it('el botón principal de una serie, por su acción', () => {
    expect(seriesPlayLabel('start', 1, 1)).toBe('Ver T1 · E1');
    expect(seriesPlayLabel('resume', 2, 3)).toBe('Continuar T2 · E3');
    expect(seriesPlayLabel('next', 2, 4)).toBe('Siguiente capítulo: T2 · E4');
    expect(seriesPlayLabel('rewatch', 1, 1)).toBe('Volver a ver T1 · E1');
    expect(seriesPlayLabel('next', 0, 2)).toBe('Siguiente capítulo: Especial 2');
  });

  it('los distintivos siempre en su orden', () => {
    expect(orderedTags(['4k', 'vose', 'castellano'])).toEqual(['castellano', 'vose', '4k']);
  });
});

describe('reglas de progreso (§10.3, D-VOD18): vectores', () => {
  const WATCHED: Array<[kind: 'movie' | 'episode', posS: number, durS: number, watched: boolean]> =
    [
      // Película: quedan ≤ max(180 s, 5 %).
      ['movie', 6000, 6200, true], // quedan 200 s < 310 s (5 %)
      ['movie', 5800, 6200, false], // quedan 400 s
      ['movie', 1320, 1500, true], // quedan 180 s justos (película corta)
      ['movie', 1300, 1500, false],
      // Episodio: quedan ≤ max(60 s, 4 %).
      ['episode', 1260, 1320, true], // quedan 60 s
      ['episode', 1250, 1320, false],
      ['episode', 3370, 3500, true], // quedan 130 s ≤ 140 s (4 %)
      ['episode', 3350, 3500, false], // quedan 150 s
      ['episode', 0, 0, false],
    ];
  it.each(WATCHED)('%s en %d de %d → visto %s', (kind, posS, durS, watched) => {
    expect(isWatched(kind, posS, durS)).toBe(watched);
  });

  it('reanudar desde 30 s y sin ver, 5 s antes; si no, desde el principio', () => {
    expect(resumeAt(29, false)).toBe(0);
    expect(resumeAt(30, false)).toBe(25);
    expect(resumeAt(2592, false)).toBe(2587);
    expect(resumeAt(2592, true)).toBe(0);
  });

  const EPISODES = [
    { id: 's1e1', season: 1, n: 1 },
    { id: 's1e2', season: 1, n: 2 },
    { id: 's2e1', season: 2, n: 1 },
    { id: 's2e2', season: 2, n: 2 },
    { id: 'esp1', season: 0, n: 1 },
    { id: 'esp2', season: 0, n: 2 },
  ];

  it('siguiente episodio: en la temporada, luego la siguiente; «Especiales» solo si ya se está en ella', () => {
    expect(nextEpisode(EPISODES, { season: 1, n: 1 })?.id).toBe('s1e2');
    expect(nextEpisode(EPISODES, { season: 1, n: 2 })?.id).toBe('s2e1');
    expect(nextEpisode(EPISODES, { season: 2, n: 2 })).toBeNull();
    expect(nextEpisode(EPISODES, { season: 0, n: 1 })?.id).toBe('esp2');
    expect(nextEpisode(EPISODES, { season: 0, n: 2 })).toBeNull();
  });

  it('los 4 casos del botón principal de una serie', () => {
    const with_ = (
      progress: Record<string, EpisodeProgressRef['progress']>,
    ): EpisodeProgressRef[] =>
      EPISODES.map((episode) => ({ ...episode, progress: progress[episode.id] ?? null }));
    expect(seriesMain(with_({}), null)).toEqual({
      episodeId: 's1e1',
      action: 'start',
      label: 'Ver T1:E1',
      posS: 0,
    });
    expect(seriesMain(with_({ s2e1: { posS: 600, durS: 1300, watched: false } }), 's2e1')).toEqual({
      episodeId: 's2e1',
      action: 'resume',
      label: 'Reanudar T2:E1',
      posS: 595,
    });
    expect(seriesMain(with_({ s1e2: { posS: 1300, durS: 1300, watched: true } }), 's1e2')).toEqual({
      episodeId: 's2e1',
      action: 'next',
      label: 'Siguiente: T2:E1',
      posS: 0,
    });
    expect(seriesMain(with_({ s2e2: { posS: 1300, durS: 1300, watched: true } }), 's2e2')).toEqual({
      episodeId: 's1e1',
      action: 'rewatch',
      label: 'Volver a ver T1:E1',
      posS: 0,
    });
    expect(seriesMain([], null)).toBeNull();
  });

  it('«Marcar hasta aquí como visto»: ese y los anteriores, sin «Especiales»', () => {
    expect(episodesThrough(EPISODES, { season: 2, n: 1 }).map((e) => e.id)).toEqual([
      's1e1',
      's1e2',
      's2e1',
    ]);
    expect(episodesThrough(EPISODES, { season: 0, n: 2 }).map((e) => e.id)).toEqual([
      'esp1',
      'esp2',
    ]);
  });
});

describe('¿se puede reproducir aquí? (§12.6)', () => {
  it('HEVC solo si el navegador lo decodifica; `no` nunca', () => {
    expect(playBlock('hevc', false)).toEqual({ reason: 'hevc' });
    expect(playBlock('hevc', true)).toBeNull();
    expect(playBlock('no', true, 'avi')).toEqual({ reason: 'formato', ext: 'avi' });
    expect(playBlock('yes', false)).toBeNull();
    expect(playBlock('unknown', false)).toBeNull();
  });

  it('sin `container` (o vacío), el formato queda sin nombre: nunca «desconocido»', () => {
    expect(playBlock('no', true)).toEqual({ reason: 'formato', ext: null });
    expect(playBlock('no', true, undefined)).toEqual({ reason: 'formato', ext: null });
    expect(playBlock('no', true, '  ')).toEqual({ reason: 'formato', ext: null });
    expect(formatBlocked('avi', 'episode')).toBe(
      'Este formato (AVI) no se puede reproducir en Ace Player.',
    );
    expect(formatBlocked(null, 'episode')).toBe(
      'Este episodio no se puede reproducir en este navegador.',
    );
    expect(formatBlocked(undefined, 'movie')).toBe(
      'Esta película no se puede reproducir en este navegador.',
    );
  });
});

describe('números (§12.4 y §12.10)', () => {
  it('«1.234»: es-ES agrupa también las cifras de 4 dígitos', () => {
    expect(formatCount(1234)).toBe('1.234');
    expect(formatCount(12_345)).toBe('12.345');
    expect(formatCount(999)).toBe('999');
    expect(titlesText(1234, 'movie')).toBe('1.234 películas');
  });
});
