/* Catálogo de muestra de Películas y series (docs/vod.md §12.11): 60
   películas y 12 series con temporadas y episodios, carteles SVG generados
   (algunos títulos sin cartel, para ver el relleno), dos títulos para adultos
   en su categoría, alguno HEVC o en un formato que no se reproduce, y un
   progreso de ejemplo («Seguir viendo»). Contesta `vodHome`, `vodBrowse` y
   `vodTitle` con las mismas reglas que el servidor (búsqueda por niveles,
   adultos fuera de la portada y de «Todas», cursor, `otherKindTotal`…) y
   guarda las marcas de progreso en memoria.

   Solo se descarga en la demo (demo.ts la importa con import()). */

import {
  VOD_PROGRESS,
  VOD_SEARCH,
  VOD_TAGS,
  type VodBrowseQuery,
  type VodBrowseResponse,
  type VodCard,
  type VodCategory,
  type VodContinue,
  type VodEpisode,
  type VodHome,
  type VodKind,
  type VodPlayable,
  type VodProgressBody,
  type VodTag,
  type VodTagCount,
  type VodTitle,
} from '@ace/shared';
import {
  episodeCode,
  episodesThrough,
  isWatched,
  nextEpisode,
  seasonLabel,
  seriesMain,
} from './model.ts';

// ---- Ids deterministas -------------------------------------------------------------------

function fnv(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hex(seed: string, length: number): string {
  let out = '';
  for (let i = 0; out.length < length; i += 1)
    out += fnv(`${seed}#${i}`).toString(16).padStart(8, '0');
  return out.slice(0, length);
}

const stamp = (seed: string) => hex(`v:${seed}`, 8);

// ---- Categorías ----------------------------------------------------------------------------

interface DemoCategory {
  id: string;
  kind: VodKind;
  name: string;
  adult: boolean;
  tags: VodTag[];
}

function category(kind: VodKind, name: string, tags: VodTag[] = [], adult = false): DemoCategory {
  return { id: hex(`cat:${kind}:${name}`, 12), kind, name, adult, tags };
}

const MOVIE_CATS = {
  estrenos: category('movie', 'ESTRENOS 2024', ['castellano']),
  k4: category('movie', 'VOD | 4K', ['castellano', '4k']),
  espanol: category('movie', 'CINE ESPAÑOL', ['castellano']),
  latino: category('movie', 'PELIS LATINO', ['latino']),
  animacion: category('movie', 'ANIMACIÓN', ['castellano']),
  clasicos: category('movie', 'CLÁSICOS', ['castellano']),
  vose: category('movie', 'VOSE', ['vose']),
  adultos: category('movie', 'XXX | ADULTOS', [], true),
} as const;

const SERIES_CATS = {
  espanolas: category('series', 'SERIES ESPAÑOLAS', ['castellano']),
  usa: category('series', 'SERIES USA', ['castellano', 'multi']),
  comedia: category('series', 'COMEDIA', ['castellano']),
  vose: category('series', 'SERIES VOSE', ['vose']),
} as const;

const CATEGORIES: DemoCategory[] = [...Object.values(MOVIE_CATS), ...Object.values(SERIES_CATS)];

// ---- Películas -------------------------------------------------------------------------------

type MovieSeed = [
  title: string,
  year: number,
  rating: number,
  cat: keyof typeof MOVIE_CATS,
  minutes: number,
  genres: string,
  director: string,
  country: string,
];

const MOVIE_SEEDS: MovieSeed[] = [
  ['Oppenheimer', 2023, 8.3, 'k4', 180, 'Drama,Historia', 'Christopher Nolan', 'Estados Unidos'],
  ['Dune', 2021, 8.0, 'k4', 156, 'Ciencia ficción,Aventura', 'Denis Villeneuve', 'Estados Unidos'],
  [
    'Dune: Parte dos',
    2024,
    8.5,
    'k4',
    166,
    'Ciencia ficción,Aventura',
    'Denis Villeneuve',
    'Estados Unidos',
  ],
  [
    'La sociedad de la nieve',
    2023,
    7.8,
    'espanol',
    144,
    'Drama,Aventura',
    'J. A. Bayona',
    'España',
  ],
  ['El 47', 2024, 7.2, 'estrenos', 110, 'Drama', 'Marcel Barrena', 'España'],
  ['Robot Dreams', 2023, 7.6, 'animacion', 102, 'Animación,Drama', 'Pablo Berger', 'España'],
  ['As bestas', 2022, 7.4, 'espanol', 137, 'Thriller,Drama', 'Rodrigo Sorogoyen', 'España'],
  ['Campeones', 2018, 7.2, 'espanol', 124, 'Comedia', 'Javier Fesser', 'España'],
  [
    'El laberinto del fauno',
    2006,
    8.2,
    'clasicos',
    118,
    'Fantasía,Drama',
    'Guillermo del Toro',
    'México',
  ],
  [
    'Mientras dure la guerra',
    2019,
    7.0,
    'espanol',
    107,
    'Drama,Historia',
    'Alejandro Amenábar',
    'España',
  ],
  ['Relatos salvajes', 2014, 8.1, 'latino', 122, 'Comedia,Drama', 'Damián Szifron', 'Argentina'],
  [
    'El secreto de sus ojos',
    2009,
    8.2,
    'latino',
    129,
    'Thriller,Drama',
    'Juan José Campanella',
    'Argentina',
  ],
  ['Roma', 2018, 7.7, 'latino', 135, 'Drama', 'Alfonso Cuarón', 'México'],
  ['Coco', 2017, 8.4, 'animacion', 105, 'Animación,Familia', 'Lee Unkrich', 'Estados Unidos'],
  ['Del revés 2', 2024, 7.6, 'animacion', 96, 'Animación,Familia', 'Kelsey Mann', 'Estados Unidos'],
  ['Wonka', 2023, 7.0, 'estrenos', 116, 'Musical,Fantasía', 'Paul King', 'Reino Unido'],
  [
    'Interstellar',
    2014,
    8.7,
    'k4',
    169,
    'Ciencia ficción,Drama',
    'Christopher Nolan',
    'Estados Unidos',
  ],
  [
    'Origen',
    2010,
    8.8,
    'clasicos',
    148,
    'Ciencia ficción,Acción',
    'Christopher Nolan',
    'Estados Unidos',
  ],
  [
    'Matrix',
    1999,
    8.7,
    'clasicos',
    136,
    'Ciencia ficción,Acción',
    'Lana y Lilly Wachowski',
    'Estados Unidos',
  ],
  ['Gladiator', 2000, 8.5, 'clasicos', 155, 'Acción,Drama', 'Ridley Scott', 'Estados Unidos'],
  ['Amélie', 2001, 8.3, 'vose', 122, 'Comedia,Romance', 'Jean-Pierre Jeunet', 'Francia'],
  ['Anatomía de una caída', 2023, 7.7, 'vose', 151, 'Drama,Thriller', 'Justine Triet', 'Francia'],
  ['Parásitos', 2019, 8.5, 'vose', 132, 'Thriller,Drama', 'Bong Joon-ho', 'Corea del Sur'],
  [
    'El chico y la garza',
    2023,
    7.5,
    'animacion',
    124,
    'Animación,Fantasía',
    'Hayao Miyazaki',
    'Japón',
  ],
  [
    'Pobres criaturas',
    2023,
    7.8,
    'estrenos',
    141,
    'Comedia,Fantasía',
    'Yorgos Lanthimos',
    'Reino Unido',
  ],
  [
    'Los asesinos de la luna',
    2023,
    7.6,
    'estrenos',
    206,
    'Drama,Crimen',
    'Martin Scorsese',
    'Estados Unidos',
  ],
  ['Napoleón', 2023, 6.4, 'estrenos', 158, 'Historia,Drama', 'Ridley Scott', 'Estados Unidos'],
  [
    'La La Land',
    2016,
    8.0,
    'clasicos',
    128,
    'Musical,Romance',
    'Damien Chazelle',
    'Estados Unidos',
  ],
  ['Joker', 2019, 8.4, 'clasicos', 122, 'Drama,Crimen', 'Todd Phillips', 'Estados Unidos'],
  ['Top Gun: Maverick', 2022, 8.2, 'k4', 131, 'Acción', 'Joseph Kosinski', 'Estados Unidos'],
  [
    'Spider-Man: Cruzando el Multiverso',
    2023,
    8.6,
    'animacion',
    140,
    'Animación,Acción',
    'Joaquim Dos Santos',
    'Estados Unidos',
  ],
  [
    'Misión: Imposible – Sentencia mortal',
    2023,
    7.7,
    'estrenos',
    163,
    'Acción',
    'Christopher McQuarrie',
    'Estados Unidos',
  ],
  ['Todo sobre mi madre', 1999, 7.8, 'espanol', 101, 'Drama', 'Pedro Almodóvar', 'España'],
  ['Volver', 2006, 7.5, 'espanol', 121, 'Drama,Comedia', 'Pedro Almodóvar', 'España'],
  ['Los otros', 2001, 7.6, 'espanol', 104, 'Terror,Misterio', 'Alejandro Amenábar', 'España'],
  ['Mar adentro', 2004, 7.7, 'espanol', 125, 'Drama', 'Alejandro Amenábar', 'España'],
  ['El orfanato', 2007, 7.4, 'espanol', 105, 'Terror', 'J. A. Bayona', 'España'],
  ['Celda 211', 2009, 7.6, 'espanol', 113, 'Thriller,Acción', 'Daniel Monzón', 'España'],
  ['Cerrar los ojos', 2023, 7.3, 'espanol', 169, 'Drama', 'Víctor Erice', 'España'],
  ['20.000 especies de abejas', 2023, 7.2, 'espanol', 128, 'Drama', 'Estibaliz Urresola', 'España'],
  ['La infiltrada', 2024, 7.0, 'estrenos', 118, 'Thriller', 'Arantxa Echevarría', 'España'],
  ['Casa en llamas', 2024, 7.1, 'estrenos', 105, 'Comedia,Drama', 'Dani de la Orden', 'España'],
  ['Segundo premio', 2024, 6.8, 'estrenos', 111, 'Drama,Música', 'Isaki Lacuesta', 'España'],
  ['Deadpool y Lobezno', 2024, 7.6, 'k4', 128, 'Acción,Comedia', 'Shawn Levy', 'Estados Unidos'],
  ['Gladiator II', 2024, 6.6, 'k4', 148, 'Acción,Drama', 'Ridley Scott', 'Estados Unidos'],
  ['Wicked', 2024, 7.5, 'estrenos', 160, 'Musical,Fantasía', 'Jon M. Chu', 'Estados Unidos'],
  [
    'Vaiana 2',
    2024,
    6.8,
    'animacion',
    100,
    'Animación,Familia',
    'David Derrick Jr.',
    'Estados Unidos',
  ],
  ['Paddington', 2014, 7.3, 'animacion', 95, 'Familia,Comedia', 'Paul King', 'Reino Unido'],
  [
    'Blade Runner 2049',
    2017,
    8.0,
    'k4',
    164,
    'Ciencia ficción',
    'Denis Villeneuve',
    'Estados Unidos',
  ],
  ['Mad Max: Furia en la carretera', 2015, 8.1, 'k4', 120, 'Acción', 'George Miller', 'Australia'],
  [
    'El Padrino',
    1972,
    9.2,
    'clasicos',
    175,
    'Drama,Crimen',
    'Francis Ford Coppola',
    'Estados Unidos',
  ],
  ['Titanic', 1997, 7.9, 'clasicos', 194, 'Drama,Romance', 'James Cameron', 'Estados Unidos'],
  ['Up', 2009, 8.3, 'animacion', 96, 'Animación,Familia', 'Pete Docter', 'Estados Unidos'],
  [
    'Ocho apellidos vascos',
    2014,
    6.6,
    'espanol',
    98,
    'Comedia',
    'Emilio Martínez-Lázaro',
    'España',
  ],
  [
    'Abre los ojos',
    1997,
    7.7,
    'clasicos',
    117,
    'Ciencia ficción,Thriller',
    'Alejandro Amenábar',
    'España',
  ],
  ['Nueve reinas', 2000, 7.9, 'latino', 114, 'Thriller,Crimen', 'Fabián Bielinsky', 'Argentina'],
  [
    'Amores perros',
    2000,
    8.0,
    'latino',
    154,
    'Drama,Thriller',
    'Alejandro González Iñárritu',
    'México',
  ],
  ['Y tu mamá también', 2001, 7.6, 'latino', 106, 'Drama,Comedia', 'Alfonso Cuarón', 'México'],
  ['Contenido para adultos 1', 2023, 5.0, 'adultos', 80, 'Adultos', 'Sin datos', 'Sin datos'],
  ['Contenido para adultos 2', 2024, 5.0, 'adultos', 75, 'Adultos', 'Sin datos', 'Sin datos'],
];

const CASTS = [
  ['Penélope Cruz', 'Javier Bardem', 'Antonio Banderas', 'Luis Tosar'],
  ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Oscar Isaac'],
  ['Belén Rueda', 'Eduard Fernández', 'Karra Elejalde', 'Carmen Machi'],
  ['Ricardo Darín', 'Cecilia Roth', 'Gael García Bernal', 'Diego Luna'],
];

const PLOTS = [
  'Una historia que empieza con una decisión pequeña y acaba cambiando la vida de todos los que la rodean.',
  'Dos desconocidos se cruzan en el peor momento posible y descubren que se necesitan más de lo que creían.',
  'Un viaje lleno de sorpresas, de esos que se recuerdan durante años.',
  'Nada es lo que parece en esta historia de secretos familiares que salen a la luz poco a poco.',
];

interface DemoMovie {
  card: Omit<VodCard, 'progress'>;
  cat: DemoCategory;
  added: number;
  durationS: number;
  genres: string[];
  director: string;
  country: string;
  cast: string[];
  plot: string;
  ageRating: string;
  playable: VodPlayable;
  container: string;
  video: string;
  audio: string[];
  backdrop: string | null;
}

/** El día de la demo: los «añadidos» se cuentan hacia atrás desde aquí. */
const NOW = Date.UTC(2026, 8, 23, 12);
const DAY = 86_400_000;

const MOVIES: DemoMovie[] = MOVIE_SEEDS.map((seed, index) => {
  const [title, year, rating, catKey, minutes, genres, director, country] = seed;
  const cat = MOVIE_CATS[catKey];
  const id = hex(`movie:${title}`, 40);
  const tags = new Set<VodTag>(cat.tags);
  if (index % 5 === 0 && !cat.adult) tags.add('multi');
  if (index % 7 === 3 && !cat.adult) tags.add('4k');
  // Algunos sin cartel (cada 9.º), para ver el relleno con el monograma.
  const poster = index % 9 === 4 ? null : stamp(id);
  const hevc = catKey === 'k4' && index % 2 === 0;
  const avi = index === 36;
  return {
    card: {
      id,
      kind: 'movie',
      title,
      year,
      rating,
      poster,
      tags: VOD_TAGS.filter((tag) => tags.has(tag)),
      adult: cat.adult,
    },
    cat,
    added: NOW - index * 1.7 * DAY,
    durationS: minutes * 60,
    genres: genres.split(','),
    director,
    country,
    cast: cat.adult ? [] : (CASTS[index % CASTS.length] ?? []),
    plot: PLOTS[index % PLOTS.length] ?? '',
    ageRating: cat.adult ? '18' : (['7', '12', '13', '16'][index % 4] ?? '12'),
    playable: avi ? 'no' : hevc ? 'hevc' : 'yes',
    container: avi ? 'avi' : index % 3 === 0 ? 'mp4' : 'mkv',
    video: `${tags.has('4k') ? '2160p' : '1080p'} · ${hevc ? 'HEVC' : 'H.264'}`,
    audio: tags.has('vose')
      ? ['AAC 2.0 · Inglés']
      : tags.has('latino')
        ? ['AC-3 5.1 · Latino']
        : ['AC-3 5.1 · Castellano', 'E-AC-3 5.1 · Inglés'],
    backdrop: index % 4 === 2 ? null : stamp(`${id}:fondo`),
  };
});

// ---- Series ----------------------------------------------------------------------------------

type SeriesSeed = [
  title: string,
  year: number,
  rating: number,
  cat: keyof typeof SERIES_CATS,
  seasons: number[],
  minutes: number,
  specials: number,
];

const SERIES_SEEDS: SeriesSeed[] = [
  ['La casa de papel', 2017, 8.2, 'espanolas', [9, 6, 8, 8, 10], 50, 0],
  ['The Office', 2005, 8.9, 'comedia', [6, 22, 25, 14], 22, 2],
  ['Élite', 2018, 7.3, 'espanolas', [8, 8, 8], 50, 0],
  ['El Ministerio del Tiempo', 2015, 8.2, 'espanolas', [8, 13, 8, 8], 70, 1],
  ['Aquí no hay quien viva', 2003, 8.0, 'comedia', [13, 13, 12, 12, 16], 75, 0],
  ['Stranger Things', 2016, 8.7, 'usa', [8, 9, 8, 9], 50, 0],
  ['The Crown', 2016, 8.6, 'usa', [10, 10, 10, 10, 10, 10], 55, 0],
  ['Breaking Bad', 2008, 9.5, 'usa', [7, 13, 13, 13, 16], 47, 0],
  ['Cuéntame cómo pasó', 2001, 7.9, 'espanolas', [13, 16, 15], 70, 0],
  ['Merlí', 2015, 8.6, 'vose', [13, 14, 13], 50, 0],
  ['Los Serrano', 2003, 7.0, 'comedia', [12, 12], 70, 0],
  ['Chernobyl', 2019, 9.3, 'vose', [5], 65, 0],
];

const EPISODE_NAMES = [
  'El principio',
  'La llamada',
  'Nada que perder',
  'El plan',
  'La pelea',
  'Cuenta atrás',
  'El regreso',
  'Todo cambia',
  'La verdad',
  'Final',
];

interface DemoEpisode {
  id: string;
  season: number;
  n: number;
  title: string;
  plot: string;
  durationS: number;
  still: string | null;
  playable: VodPlayable;
}

interface DemoSeries {
  card: Omit<VodCard, 'progress'>;
  cat: DemoCategory;
  added: number;
  genres: string[];
  cast: string[];
  plot: string;
  backdrop: string | null;
  episodes: DemoEpisode[];
}

const SERIES: DemoSeries[] = SERIES_SEEDS.map((seed, index) => {
  const [title, year, rating, catKey, seasons, minutes, specials] = seed;
  const cat = SERIES_CATS[catKey];
  const id = hex(`series:${title}`, 40);
  const episodes: DemoEpisode[] = [];
  const add = (season: number, n: number) => {
    const eid = hex(`episode:${title}:${season}:${n}`, 40);
    const name = EPISODE_NAMES[(n - 1 + season) % EPISODE_NAMES.length] ?? `Episodio ${n}`;
    episodes.push({
      id: eid,
      season,
      n,
      title: season === 0 ? `Especial ${n}` : name,
      plot: PLOTS[(n + season) % PLOTS.length] ?? '',
      durationS: (minutes + ((n * 7) % 9) - 4) * 60,
      still: (n + season) % 6 === 5 ? null : stamp(`${eid}:still`),
      playable: index === 5 && season === 4 ? 'hevc' : 'yes',
    });
  };
  seasons.forEach((count, s) => {
    for (let n = 1; n <= count; n += 1) add(s + 1, n);
  });
  for (let n = 1; n <= specials; n += 1) add(0, n);
  return {
    card: {
      id,
      kind: 'series',
      title,
      year,
      rating,
      poster: index === 10 ? null : stamp(id),
      tags: VOD_TAGS.filter((tag) => cat.tags.includes(tag)),
      adult: false,
    },
    cat,
    added: NOW - index * 2.3 * DAY,
    genres: catKey === 'comedia' ? ['Comedia'] : ['Drama', 'Suspense'],
    cast: CASTS[(index + 1) % CASTS.length] ?? [],
    plot: PLOTS[(index + 2) % PLOTS.length] ?? '',
    backdrop: stamp(`${id}:fondo`),
    episodes,
  };
});

const MOVIE_BY_ID = new Map(MOVIES.map((movie) => [movie.card.id, movie]));
const SERIES_BY_ID = new Map(SERIES.map((series) => [series.card.id, series]));
const EPISODE_BY_ID = new Map(
  SERIES.flatMap((series) =>
    series.episodes.map((episode) => [episode.id, { series, episode }] as const),
  ),
);

// ---- Progreso (en memoria, como `v2/vod.json`) ----------------------------------------------

interface DemoProgress {
  posS: number;
  durS: number;
  watched: boolean;
  hidden: boolean;
  updatedAt: number;
}

const progress = new Map<string, DemoProgress>();

function seedProgress(): void {
  progress.clear();
  const at = (hoursAgo: number) => NOW - hoursAgo * 3_600_000;
  const dune = MOVIES[1];
  if (dune)
    progress.set(dune.card.id, {
      posS: 2592,
      durS: dune.durationS,
      watched: false,
      hidden: false,
      updatedAt: at(2),
    });
  const nieve = MOVIES[3];
  if (nieve)
    progress.set(nieve.card.id, {
      posS: 5400,
      durS: nieve.durationS,
      watched: false,
      hidden: false,
      updatedAt: at(30),
    });
  // The Office: hasta T2 · E5 visto → «Siguiente: T2:E6».
  const office = SERIES[1];
  if (office)
    for (const episode of office.episodes)
      if (episode.season === 1 || (episode.season === 2 && episode.n <= 5))
        progress.set(episode.id, {
          posS: episode.durationS,
          durS: episode.durationS,
          watched: true,
          hidden: false,
          updatedAt: at(20 + (episode.season === 2 ? 6 - episode.n : 12)),
        });
  // La casa de papel: T1 · E3 a medias.
  const casa = SERIES[0]?.episodes.find((e) => e.season === 1 && e.n === 3);
  if (casa)
    progress.set(casa.id, {
      posS: 1260,
      durS: casa.durationS,
      watched: false,
      hidden: false,
      updatedAt: at(5),
    });
}
seedProgress();

/** Solo para los tests: vuelve al progreso de ejemplo. */
export function resetDemoVod(): void {
  seedProgress();
  failedOnce.clear();
}

function progressOf(id: string): VodEpisode['progress'] {
  const entry = progress.get(id);
  return entry ? { posS: entry.posS, durS: entry.durS, watched: entry.watched } : null;
}

function movieRatio(id: string): number | null {
  const entry = progress.get(id);
  if (!entry || entry.watched || !(entry.durS > 0) || entry.posS <= 0) return null;
  return Math.min(1, entry.posS / entry.durS);
}

/** El episodio de la serie tocado más recientemente (para el botón principal y «Seguir viendo»). */
function lastEpisodeOf(series: DemoSeries): DemoEpisode | null {
  let best: DemoEpisode | null = null;
  let bestAt = -1;
  for (const episode of series.episodes) {
    const entry = progress.get(episode.id);
    if (entry && entry.updatedAt > bestAt) {
      best = episode;
      bestAt = entry.updatedAt;
    }
  }
  return best;
}

/** POST vodProgress de la demo (§10.2), en memoria. */
export function demoProgress(id: string, body: VodProgressBody): void {
  const now = Date.now();
  const episodeHit = EPISODE_BY_ID.get(id);
  const movie = MOVIE_BY_ID.get(id);
  if (!episodeHit && !movie) return;
  const durS = episodeHit ? episodeHit.episode.durationS : (movie?.durationS ?? 0);
  const set = (key: string, patch: Partial<DemoProgress>, dur = durS, at = now) => {
    const current = progress.get(key) ?? {
      posS: 0,
      durS: dur,
      watched: false,
      hidden: false,
      updatedAt: at,
    };
    progress.set(key, { ...current, ...patch, updatedAt: at });
  };
  switch (body.event) {
    case 'mark':
      set(id, { posS: durS, durS, watched: true, hidden: false });
      break;
    case 'unmark':
      set(id, { posS: 0, watched: false });
      break;
    case 'mark-through':
      if (episodeHit) {
        const through = episodesThrough(episodeHit.series.episodes, episodeHit.episode);
        for (const ref of through) {
          const episode = episodeHit.series.episodes.find((e) => e.id === ref.id);
          if (episode)
            set(
              episode.id,
              { posS: episode.durationS, durS: episode.durationS, watched: true, hidden: false },
              episode.durationS,
            );
        }
        // El marcado es el más reciente: de él sale «Siguiente».
        set(id, {}, durS, now + 1);
      } else set(id, { posS: durS, durS, watched: true });
      break;
    case 'hide':
      if (episodeHit)
        for (const episode of episodeHit.series.episodes) {
          const entry = progress.get(episode.id);
          if (entry) progress.set(episode.id, { ...entry, hidden: true });
        }
      else if (progress.has(id)) set(id, { hidden: true });
      break;
    case 'forget':
      progress.delete(id);
      break;
    default: {
      const posS = Math.min(body.posS, durS);
      const kind = episodeHit ? 'episode' : 'movie';
      set(id, {
        posS,
        durS: body.durS || durS,
        watched: body.event === 'ended' || isWatched(kind, posS, body.durS || durS),
        hidden: false,
      });
    }
  }
}

// ---- Portada ---------------------------------------------------------------------------------

function cardOf(item: DemoMovie | DemoSeries): VodCard {
  return {
    ...item.card,
    progress: item.card.kind === 'movie' ? movieRatio(item.card.id) : null,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function continueEntries(): VodContinue[] {
  const out: VodContinue[] = [];
  for (const movie of MOVIES) {
    const entry = progress.get(movie.card.id);
    if (!entry || entry.watched || entry.hidden || entry.posS <= 0) continue;
    out.push({
      id: movie.card.id,
      kind: 'movie',
      seriesId: null,
      title: movie.card.title,
      subtitle: null,
      posS: entry.posS,
      durS: entry.durS,
      isNext: false,
      art: movie.backdrop
        ? { id: movie.card.id, art: 'backdrop', v: movie.backdrop }
        : movie.card.poster
          ? { id: movie.card.id, art: 'poster', v: movie.card.poster }
          : null,
      updatedAt: iso(entry.updatedAt),
    });
  }
  for (const series of SERIES) {
    const last = lastEpisodeOf(series);
    const entry = last ? progress.get(last.id) : undefined;
    if (!last || !entry || entry.hidden) continue;
    let shown = last;
    let isNext = false;
    if (entry.watched) {
      const next = nextEpisode(series.episodes, last);
      if (!next) continue;
      shown = series.episodes.find((e) => e.id === next.id) ?? last;
      isNext = true;
    }
    const shownProgress = isNext ? null : entry;
    out.push({
      id: shown.id,
      kind: 'episode',
      seriesId: series.card.id,
      title: series.card.title,
      subtitle: `${episodeCode(shown.season, shown.n, ' · ')} · ${shown.title}`.slice(0, 120),
      posS: shownProgress?.posS ?? 0,
      durS: shownProgress?.durS ?? shown.durationS,
      isNext,
      art: shown.still ? { id: shown.id, art: 'still', v: shown.still } : null,
      updatedAt: iso(entry.updatedAt),
    });
  }
  return out
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, VOD_PROGRESS.continueMax);
}

function tagCounts(items: ReadonlyArray<{ card: { tags: VodTag[] } }>): VodTagCount[] {
  return VOD_TAGS.map((tag) => ({
    tag,
    count: items.filter((item) => item.card.tags.includes(tag)).length,
  })).filter((entry) => entry.count > 0);
}

function categoriesOf(kind: VodKind): VodCategory[] {
  const items: Array<DemoMovie | DemoSeries> = kind === 'movie' ? MOVIES : SERIES;
  return CATEGORIES.filter((cat) => cat.kind === kind)
    .map((cat) => ({
      id: cat.id,
      kind,
      name: cat.name,
      count: items.filter((item) => item.cat.id === cat.id).length,
      adult: cat.adult,
    }))
    .sort((a, b) => Number(a.adult) - Number(b.adult));
}

export function demoVodHome(): VodHome {
  return {
    active: true,
    state: 'ready',
    counts: { movies: MOVIES.length, series: SERIES.length },
    builtAt: iso(NOW - 3 * 3_600_000),
    truncated: false,
    stale: false,
    continue: continueEntries(),
    newMovies: [...MOVIES]
      .filter((movie) => !movie.card.adult)
      .sort((a, b) => b.added - a.added)
      .slice(0, 20)
      .map(cardOf),
    updatedSeries: [...SERIES]
      .sort((a, b) => b.added - a.added)
      .slice(0, 20)
      .map(cardOf),
    categories: { movie: categoriesOf('movie'), series: categoriesOf('series') },
    tags: {
      movie: tagCounts(MOVIES.filter((movie) => !movie.card.adult)),
      series: tagCounts(SERIES),
    },
  };
}

// ---- Rejilla y búsqueda (§6) ------------------------------------------------------------------

/** Plegado sin acentos y en minúsculas. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Nivel de relevancia 0-4 (§6.2), o null si no casa. */
function level(title: string, year: number | null, q: string): number | null {
  const folded = fold(title);
  const words = fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];
  const yearWord = words.find((w) => /^\d{4}$/.test(w) && Number(w) === year);
  const rest = words.filter((w) => w !== yearWord);
  if (rest.length === 0) return yearWord ? 4 : null;
  const phrase = rest.join(' ');
  const titleWords = folded.match(/[\p{L}\p{N}]+/gu) ?? [];
  const compact = folded.replace(/[^\p{L}\p{N}]+/gu, '');
  const inside = rest.every((w) => folded.includes(w));
  if (!inside && !compact.includes(rest.join(''))) return null;
  if (titleWords.join(' ') === phrase) return 0;
  if (titleWords.join(' ').startsWith(phrase)) return 1;
  const starts = rest.map((w) => titleWords.findIndex((t) => t.startsWith(w)));
  if (starts.every((i) => i >= 0)) {
    const inOrder = starts.every((value, i) => i === 0 || value > (starts[i - 1] ?? -1));
    return inOrder ? 2 : 3;
  }
  return 4;
}

function encodeCursor(offset: number): string {
  return btoa(`demo.${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const [catalog, offset] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('.');
    const n = Number(offset);
    return catalog === 'demo' && Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

type Query = Partial<Omit<VodBrowseQuery, 'limit'>> & { limit?: unknown };

function matching(
  kind: VodKind,
  query: Query,
): Array<{ item: DemoMovie | DemoSeries; level: number }> {
  const items: Array<DemoMovie | DemoSeries> = kind === 'movie' ? MOVIES : SERIES;
  const q = (query.q ?? '').trim();
  const cat = query.cat ?? 'all';
  const out: Array<{ item: DemoMovie | DemoSeries; level: number }> = [];
  for (const item of items) {
    if (cat !== 'all' && item.cat.id !== cat) continue;
    // Adultos: en su categoría y en la búsqueda, nunca en «Todas» sin texto (D-VOD7).
    if (cat === 'all' && !q && item.card.adult) continue;
    if (q) {
      const found = level(item.card.title, item.card.year, q);
      if (found === null) continue;
      out.push({ item, level: found });
    } else out.push({ item, level: 0 });
  }
  return out;
}

export function demoVodBrowse(query: Query): VodBrowseResponse {
  const kind: VodKind = query.kind === 'series' ? 'series' : 'movie';
  const q = (query.q ?? '').replace(/\s+/g, ' ').trim();
  const limit = Math.min(
    VOD_SEARCH.pageMax,
    Math.max(1, Number(query.limit ?? VOD_SEARCH.pageDefault) || 60),
  );
  const all = matching(kind, { ...query, q });
  const tagsForChips = tagCounts(all.map((entry) => entry.item));
  const filtered = query.tag
    ? all.filter((entry) => entry.item.card.tags.includes(query.tag as VodTag))
    : all;
  const byName = (a: DemoMovie | DemoSeries, b: DemoMovie | DemoSeries) =>
    a.card.title.localeCompare(b.card.title, 'es');
  filtered.sort((a, b) =>
    q
      ? a.level - b.level || b.item.added - a.item.added || byName(a.item, b.item)
      : query.sort === 'name'
        ? byName(a.item, b.item)
        : b.item.added - a.item.added,
  );
  const offset = decodeCursor(query.cursor);
  const page = filtered.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    active: true,
    state: 'ready',
    items: page.map((entry) => cardOf(entry.item)),
    total: filtered.length,
    capped: false,
    otherKindTotal: q
      ? matching(kind === 'movie' ? 'series' : 'movie', { ...query, q }).filter(
          (entry) => !query.tag || entry.item.card.tags.includes(query.tag as VodTag),
        ).length
      : null,
    tags: tagsForChips,
    nextCursor: next < filtered.length ? encodeCursor(next) : null,
    stale: false,
  };
}

// ---- Fichas (§7) -------------------------------------------------------------------------------

/* Una película de la demo falla la primera vez (`info: 'failed'`), para ver
   «No se ha podido cargar la sinopsis.» y «Reintentar». */
const FLAKY = MOVIES[12]?.card.id ?? '';
const failedOnce = new Set<string>();

export function demoVodTitle(id: string): VodTitle | null {
  const movie = MOVIE_BY_ID.get(id);
  if (movie) {
    const failed = id === FLAKY && !failedOnce.has(id);
    if (failed) failedOnce.add(id);
    const known = {
      kind: 'movie' as const,
      id,
      title: movie.card.title,
      year: movie.card.year,
      rating: movie.card.rating,
      poster: movie.card.poster,
      tags: movie.card.tags,
      adult: movie.card.adult,
      category: { id: movie.cat.id, name: movie.cat.name },
      progress: progressOf(id),
    };
    if (failed)
      return {
        ...known,
        info: 'failed',
        originalTitle: null,
        plot: null,
        genres: [],
        cast: [],
        director: null,
        country: null,
        ageRating: null,
        durationS: null,
        backdrop: null,
        tech: { container: null, video: null, audio: [] },
        playable: 'unknown',
      };
    return {
      ...known,
      info: 'ok',
      originalTitle: null,
      plot: movie.plot,
      genres: movie.genres,
      cast: movie.cast,
      director: movie.director,
      country: movie.country,
      ageRating: movie.ageRating,
      durationS: movie.durationS,
      backdrop: movie.backdrop,
      tech: { container: movie.container, video: movie.video, audio: movie.audio },
      playable: movie.playable,
    };
  }
  const series = SERIES_BY_ID.get(id);
  if (!series) return null;
  const numbers = [...new Set(series.episodes.map((e) => e.season))].sort(
    (a, b) => (a === 0 ? 1 : 0) - (b === 0 ? 1 : 0) || a - b,
  );
  const last = lastEpisodeOf(series);
  return {
    kind: 'series',
    id,
    info: 'ok',
    title: series.card.title,
    year: series.card.year,
    plot: series.plot,
    genres: series.genres,
    cast: series.cast,
    director: null,
    country: 'España',
    rating: series.card.rating,
    poster: series.card.poster,
    backdrop: series.backdrop,
    tags: series.card.tags,
    adult: false,
    category: { id: series.cat.id, name: series.cat.name },
    seasons: numbers.map((n) => ({
      n,
      name: seasonLabel(n),
      episodes: series.episodes
        .filter((e) => e.season === n)
        .sort((a, b) => a.n - b.n)
        .map((e) => ({
          id: e.id,
          n: e.n,
          title: e.title,
          plot: e.plot,
          durationS: e.durationS,
          still: e.still,
          playable: e.playable,
          progress: progressOf(e.id),
        })),
    })),
    main: seriesMain(
      series.episodes.map((e) => ({
        id: e.id,
        season: e.season,
        n: e.n,
        progress: progressOf(e.id),
      })),
      last?.id ?? null,
    ),
    truncated: false,
  };
}

/** Los ids de ejemplo que usan los tests y la revisión visual. */
export const DEMO_VOD_IDS = {
  movie: MOVIES[0]?.card.id ?? '',
  hevcMovie: MOVIES.find((movie) => movie.playable === 'hevc')?.card.id ?? '',
  aviMovie: MOVIES.find((movie) => movie.playable === 'no')?.card.id ?? '',
  flakyMovie: FLAKY,
  series: SERIES[1]?.card.id ?? '',
  seriesStart: SERIES[2]?.card.id ?? '',
  movieCategory: MOVIE_CATS.k4.id,
  adultCategory: MOVIE_CATS.adultos.id,
} as const;
