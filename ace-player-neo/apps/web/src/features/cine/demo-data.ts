/* Catálogo de muestra de Películas y series (docs/vod.md §12.11): 63
   películas y 14 series con temporadas y episodios, carteles SVG generados,
   alguno HEVC o en un formato que no se reproduce, y un progreso de ejemplo
   («Seguir viendo»). Contesta `vodHome`, `vodBrowse` y `vodTitle` con las
   mismas reglas que el servidor (búsqueda por niveles, cursor,
   `otherKindTotal`…) y guarda las marcas de progreso en memoria.

   Para que Isma lo revise con datos de verdad (0.9.0):
   - fichas COMPLETAS (sinopsis, reparto, dirección, título original, fecha de
     estreno, tráiler, técnica) en los títulos conocidos;
   - y casos POBRES, como en las listas reales: títulos sin cartel ni fondo,
     sin sinopsis ni nota, un título larguísimo, géneros en inglés y el país
     como código («US»), temporadas que el proveedor llama «Season N», una
     serie de 1 temporada y otra de 12, una temporada sin fotogramas (lista
     compacta) y una serie sin ningún dato.
   - Los títulos para adultos salen en la portada y en «Todas» como los demás
     (decisión de Isma para la 0.9.0, cambia D-VOD7), con su «+18».

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

/** Lo que un título tiene de más (o de menos) sobre su semilla. */
interface MovieExtra {
  original?: string;
  /** null = el proveedor no da sinopsis. */
  plot?: string | null;
  cast?: string[];
  released?: string;
  trailer?: boolean;
  /** false = sin cartel / sin fondo. */
  poster?: boolean;
  backdrop?: boolean;
  year?: null;
  rating?: null;
  director?: null;
  country?: string | null;
  age?: string;
}

/* Sinopsis escritas para la demo (no copiadas de ningún sitio) y repartos de
   las películas conocidas, para ver una ficha completa. */
const MOVIE_EXTRA: Record<string, MovieExtra> = {
  Oppenheimer: {
    plot: 'Durante la Segunda Guerra Mundial, el físico J. Robert Oppenheimer dirige en Los Álamos el proyecto que fabricará la primera bomba atómica, y años después tiene que responder por ello ante quienes ya no se fían de él.',
    cast: [
      'Cillian Murphy',
      'Emily Blunt',
      'Matt Damon',
      'Robert Downey Jr.',
      'Florence Pugh',
      'Josh Hartnett',
      'Kenneth Branagh',
      'Rami Malek',
    ],
    released: '2023-07-21',
    trailer: true,
  },
  Dune: {
    original: 'Dune: Part One',
    plot: 'Paul Atreides, heredero de una gran casa noble, llega con su familia a Arrakis, un planeta desértico del que sale la sustancia más valiosa del universo. Allí una traición lo obliga a huir al desierto y a buscar a su pueblo.',
    cast: [
      'Timothée Chalamet',
      'Rebecca Ferguson',
      'Oscar Isaac',
      'Josh Brolin',
      'Stellan Skarsgård',
      'Zendaya',
      'Jason Momoa',
      'Javier Bardem',
    ],
    released: '2021-09-16',
    trailer: true,
  },
  'Dune: Parte dos': {
    original: 'Dune: Part Two',
    plot: 'Paul se une a Chani y a los Fremen para vengarse de quienes destruyeron a su familia, mientras intenta evitar un futuro terrible que solo él es capaz de ver.',
    cast: [
      'Timothée Chalamet',
      'Zendaya',
      'Rebecca Ferguson',
      'Javier Bardem',
      'Josh Brolin',
      'Austin Butler',
      'Florence Pugh',
    ],
    released: '2024-03-01',
    trailer: true,
  },
  'La sociedad de la nieve': {
    plot: 'En 1972, un avión con un equipo de rugby uruguayo se estrella en el corazón de los Andes. Los supervivientes tienen que aguantar más de dos meses en uno de los lugares más hostiles del planeta.',
    cast: ['Enzo Vogrincic', 'Agustín Pardella', 'Matías Recalt', 'Esteban Bigliardi'],
    released: '2023-12-15',
    trailer: true,
  },
  'El 47': {
    plot: 'Barcelona, 1978. Un conductor de autobús decide desviarse de su ruta y subir con el 47 hasta un barrio olvidado de la ciudad para demostrar que allí también puede llegar el transporte público.',
    cast: ['Eduard Fernández', 'Clara Segura', 'Zoe Bonafonte', 'Salva Reina'],
    released: '2024-09-06',
  },
  'Robot Dreams': {
    plot: 'En el Nueva York de los ochenta, un perro solitario se construye un robot para tener compañía. Tras un verano inolvidable, un descuido en la playa los separa.',
    cast: [],
    released: '2023-12-06',
    age: '0',
  },
  Interstellar: {
    plot: 'Con la Tierra al borde del colapso, un antiguo piloto deja a sus hijos para cruzar un agujero de gusano con un pequeño equipo en busca de un nuevo hogar para la humanidad.',
    cast: [
      'Matthew McConaughey',
      'Anne Hathaway',
      'Jessica Chastain',
      'Michael Caine',
      'Matt Damon',
    ],
    released: '2014-11-07',
    trailer: true,
  },
  Origen: {
    original: 'Inception',
    plot: 'Un ladrón que roba secretos entrando en los sueños de la gente recibe un encargo imposible: en vez de robar una idea, tiene que plantarla.',
    cast: [
      'Leonardo DiCaprio',
      'Joseph Gordon-Levitt',
      'Elliot Page',
      'Tom Hardy',
      'Marion Cotillard',
      'Ken Watanabe',
    ],
    released: '2010-08-06',
    trailer: true,
  },
  Matrix: {
    original: 'The Matrix',
    plot: 'Un programador que de noche es pirata informático descubre que el mundo en el que vive es una simulación y que él podría ser la pieza que falta para acabar con ella.',
    cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss', 'Hugo Weaving'],
    released: '1999-06-23',
    country: 'US',
  },
  Parásitos: {
    original: 'Gisaengchung',
    plot: 'Una familia sin trabajo se las ingenia para colarse, uno a uno, como empleados en la casa de una familia rica. Todo va bien hasta que descubren que no son los únicos con un secreto.',
    cast: ['Song Kang-ho', 'Lee Sun-kyun', 'Cho Yeo-jeong', 'Choi Woo-shik', 'Park So-dam'],
    released: '2019-10-25',
    country: 'KR',
    trailer: true,
  },
  Coco: {
    plot: 'Miguel sueña con ser músico aunque en su familia la música está prohibida. El Día de Muertos acaba sin querer en la Tierra de los Muertos y tiene que volver antes del amanecer.',
    cast: ['Anthony Gonzalez', 'Gael García Bernal', 'Benjamin Bratt', 'Alanna Ubach'],
    released: '2017-12-01',
    age: '0',
  },
  'El laberinto del fauno': {
    plot: 'En la España de 1944, una niña se muda con su madre a la casa de su nuevo padrastro, un capitán cruel. En el bosque cercano encuentra un laberinto y a un fauno que le encarga tres pruebas.',
    cast: ['Ivana Baquero', 'Sergi López', 'Maribel Verdú', 'Doug Jones', 'Ariadna Gil'],
    released: '2006-10-11',
    trailer: true,
  },
  'Del revés 2': { original: 'Inside Out 2', released: '2024-06-19' },
  'Los asesinos de la luna': { original: 'Killers of the Flower Moon', released: '2023-10-20' },
  'Pobres criaturas': { original: 'Poor Things', released: '2024-01-26' },
  'Misión: Imposible – Sentencia mortal': {
    original: 'Mission: Impossible – Dead Reckoning Part One',
  },
  'Anatomía de una caída': { original: "Anatomie d'une chute" },
  'El chico y la garza': { original: 'Kimitachi wa dō ikiru ka', country: 'JP' },
  Amélie: { original: "Le Fabuleux Destin d'Amélie Poulain", country: 'FR' },
  'Spider-Man: Cruzando el Multiverso': { original: 'Spider-Man: Across the Spider-Verse' },
  'Deadpool y Lobezno': { original: 'Deadpool & Wolverine' },
  'Vaiana 2': { original: 'Moana 2' },
  'Mad Max: Furia en la carretera': { original: 'Mad Max: Fury Road' },
  'El Padrino': { original: 'The Godfather', trailer: true },
  // Casos pobres, como en las listas reales.
  'El último verano': {
    poster: false,
    backdrop: false,
    plot: null,
    cast: [],
    year: null,
    rating: null,
    director: null,
    country: null,
    age: '0',
  },
  'Las increíbles y verdaderas aventuras del caballero sin nombre y de su fiel escudero por las tierras del norte':
    {
      backdrop: false,
      plot: 'Un caballero que ha olvidado su nombre recorre el norte con su escudero buscando a alguien que lo recuerde.',
    },
  'La ruta del agua': {
    poster: false,
    plot: 'Un documental que sigue el viaje de un río desde el deshielo en la montaña hasta el mar.',
    cast: [],
  },
};

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
    'Science Fiction,Action',
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
  // Casos pobres (MOVIE_EXTRA les quita lo que falta en las listas reales).
  ['El último verano', 2020, 0, 'estrenos', 0, '', '', ''],
  [
    'Las increíbles y verdaderas aventuras del caballero sin nombre y de su fiel escudero por las tierras del norte',
    2022,
    6.1,
    'clasicos',
    131,
    'Aventura,Fantasía',
    'Marta Ibarra',
    'España',
  ],
  ['La ruta del agua', 2021, 7.0, 'espanol', 88, 'Documental', 'Iñaki Salvatierra', 'España'],
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
  durationS: number | null;
  genres: string[];
  director: string | null;
  country: string | null;
  cast: string[];
  plot: string | null;
  originalTitle: string | null;
  released: string | null;
  trailer: string | null;
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

/** Un id de YouTube de mentira (11 caracteres): en la demo el botón «Tráiler» avisa y no abre nada. */
const fakeTrailer = (seed: string) => hex(`trailer:${seed}`, 11);

const MOVIES: DemoMovie[] = MOVIE_SEEDS.map((seed, index) => {
  const [title, year, rating, catKey, minutes, genres, director, country] = seed;
  const extra = MOVIE_EXTRA[title] ?? {};
  const cat = MOVIE_CATS[catKey];
  const id = hex(`movie:${title}`, 40);
  const tags = new Set<VodTag>(cat.tags);
  if (index % 5 === 0 && !cat.adult) tags.add('multi');
  if (index % 7 === 3 && !cat.adult) tags.add('4k');
  // Algunos sin cartel (cada 9.º), para ver el relleno con el monograma.
  const poster = extra.poster === false || index % 9 === 4 ? null : stamp(id);
  const hevc = catKey === 'k4' && index % 2 === 0;
  const avi = index === 36;
  const poor = extra.plot === null;
  return {
    card: {
      id,
      kind: 'movie',
      title,
      year: extra.year === null ? null : year,
      rating: extra.rating === null || rating <= 0 ? null : rating,
      poster,
      tags: poor ? [] : VOD_TAGS.filter((tag) => tags.has(tag)),
      adult: cat.adult,
    },
    cat,
    added: NOW - index * 1.7 * DAY,
    durationS: minutes > 0 ? minutes * 60 : null,
    genres: genres ? genres.split(',') : [],
    director: extra.director === null || !director ? null : director,
    country: extra.country === undefined ? country || null : extra.country,
    cast: extra.cast ?? (cat.adult ? [] : (CASTS[index % CASTS.length] ?? [])),
    plot: extra.plot === undefined ? (PLOTS[index % PLOTS.length] ?? null) : extra.plot,
    originalTitle: extra.original ?? null,
    released: extra.released ?? null,
    trailer: extra.trailer ? fakeTrailer(title) : null,
    ageRating: extra.age ?? (cat.adult ? '18' : (['7', '12', '13', '16'][index % 4] ?? '12')),
    playable: avi ? 'no' : hevc ? 'hevc' : 'yes',
    container: avi ? 'avi' : index % 3 === 0 ? 'mp4' : 'mkv',
    video: poor ? '' : `${tags.has('4k') ? '2160p' : '1080p'} · ${hevc ? 'HEVC' : 'H.264'}`,
    audio: poor
      ? []
      : tags.has('vose')
        ? ['AAC 2.0 · Inglés']
        : tags.has('latino')
          ? ['AC-3 5.1 · Latino']
          : ['AC-3 5.1 · Castellano', 'E-AC-3 5.1 · Inglés'],
    backdrop: extra.backdrop === false || index % 4 === 2 ? null : stamp(`${id}:fondo`),
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
  [
    'The Big Bang Theory',
    2007,
    8.2,
    'comedia',
    [17, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24],
    21,
    0,
  ],
  ['Barrio', 2021, 0, 'espanolas', [6], 0, 0],
];

/** Lo que una serie tiene de más (o de menos) sobre su semilla. */
interface SeriesExtra {
  plot?: string | null;
  cast?: string[];
  director?: string | null;
  released?: string;
  trailer?: boolean;
  poster?: boolean;
  backdrop?: boolean;
  /** Cómo llama el proveedor a las temporadas: «Season N» o «Parte N». */
  seasonNames?: 'season' | 'parte';
  /** Fotogramas: todos menos alguno (por defecto), ninguno (lista compacta) o solo en la 1.ª temporada. */
  stills?: 'none' | 'first';
  genres?: string[];
  country?: string | null;
  year?: null;
  episodePlots?: false;
}

const SERIES_EXTRA: Record<string, SeriesExtra> = {
  'La casa de papel': {
    plot: 'Un misterioso Profesor reúne a ocho atracadores con nombres de ciudades para el golpe perfecto: encerrarse en la Fábrica Nacional de Moneda y Timbre e imprimir su propio dinero.',
    cast: [
      'Úrsula Corberó',
      'Álvaro Morte',
      'Itziar Ituño',
      'Pedro Alonso',
      'Miguel Herrán',
      'Jaime Lorente',
    ],
    director: 'Álex Pina',
    released: '2017-05-02',
    trailer: true,
    seasonNames: 'parte',
  },
  'The Office': {
    plot: 'El día a día de los empleados de una sucursal de una empresa de papel en Scranton, contado como un documental, con un jefe que quiere ser el más gracioso de la oficina.',
    cast: ['Steve Carell', 'Rainn Wilson', 'John Krasinski', 'Jenna Fischer'],
    director: 'Greg Daniels',
    released: '2005-03-24',
    seasonNames: 'season',
    country: 'US',
  },
  'Stranger Things': {
    plot: 'En un pueblo de Indiana, la desaparición de un niño destapa experimentos secretos, fuerzas sobrenaturales y a una niña muy extraña.',
    cast: ['Winona Ryder', 'David Harbour', 'Millie Bobby Brown', 'Finn Wolfhard'],
    director: 'Matt Duffer, Ross Duffer',
    released: '2016-07-15',
    trailer: true,
    genres: ['Drama', 'Sci-Fi & Fantasy', 'Mystery'],
  },
  'Breaking Bad': {
    plot: 'Un profesor de química con un diagnóstico terrible decide fabricar metanfetamina con un antiguo alumno para asegurar el futuro de su familia.',
    cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'Dean Norris'],
    director: 'Vince Gilligan',
    released: '2008-01-20',
    trailer: true,
  },
  'Cuéntame cómo pasó': {
    plot: 'La familia Alcántara vive en un barrio de Madrid los cambios de España desde finales de los sesenta.',
    cast: ['Imanol Arias', 'Ana Duato', 'Ricardo Gómez', 'Pablo Rivero'],
    stills: 'none',
  },
  'Aquí no hay quien viva': { stills: 'first' },
  Chernobyl: {
    plot: 'Abril de 1986: estalla un reactor de la central nuclear de Chernóbil. La historia de quienes intentaron contener el desastre y de quienes lo ocultaron.',
    cast: ['Jared Harris', 'Stellan Skarsgård', 'Emily Watson', 'Paul Ritter'],
    director: 'Johan Renck',
    released: '2019-05-06',
    trailer: true,
  },
  'The Big Bang Theory': {
    plot: 'Dos físicos brillantes pero torpes en todo lo demás ven cómo cambia su vida cuando una vecina se muda al piso de enfrente.',
    cast: ['Johnny Galecki', 'Jim Parsons', 'Kaley Cuoco', 'Simon Helberg', 'Kunal Nayyar'],
    director: 'Chuck Lorre',
    released: '2007-09-24',
    seasonNames: 'season',
  },
  Barrio: {
    plot: null,
    cast: [],
    director: null,
    poster: false,
    backdrop: false,
    stills: 'none',
    genres: [],
    country: null,
    year: null,
    episodePlots: false,
  },
};

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
  plot: string | null;
  durationS: number | null;
  still: string | null;
  playable: VodPlayable;
}

interface DemoSeries {
  card: Omit<VodCard, 'progress'>;
  cat: DemoCategory;
  added: number;
  genres: string[];
  cast: string[];
  director: string | null;
  country: string | null;
  plot: string | null;
  released: string | null;
  trailer: string | null;
  runTimeS: number | null;
  seasonNames: SeriesExtra['seasonNames'];
  backdrop: string | null;
  episodes: DemoEpisode[];
}

/** El nombre que da el proveedor a una temporada (la web enseña «Temporada N» si es genérico). */
function providerSeasonName(n: number, style: SeriesExtra['seasonNames']): string {
  if (n === 0) return seasonLabel(0);
  if (style === 'season') return `Season ${n}`;
  if (style === 'parte') return `Parte ${n}`;
  return seasonLabel(n);
}

const SERIES: DemoSeries[] = SERIES_SEEDS.map((seed, index) => {
  const [title, year, rating, catKey, seasons, minutes, specials] = seed;
  const extra = SERIES_EXTRA[title] ?? {};
  const cat = SERIES_CATS[catKey];
  const id = hex(`series:${title}`, 40);
  const episodes: DemoEpisode[] = [];
  const add = (season: number, n: number) => {
    const eid = hex(`episode:${title}:${season}:${n}`, 40);
    const name = EPISODE_NAMES[(n - 1 + season) % EPISODE_NAMES.length] ?? `Episodio ${n}`;
    const still =
      extra.stills === 'none' || (extra.stills === 'first' && season !== 1)
        ? null
        : (n + season) % 6 === 5
          ? null
          : stamp(`${eid}:still`);
    episodes.push({
      id: eid,
      season,
      n,
      title: season === 0 ? `Especial ${n}` : extra.episodePlots === false ? `Episodio ${n}` : name,
      plot: extra.episodePlots === false ? null : (PLOTS[(n + season) % PLOTS.length] ?? null),
      durationS: minutes > 0 ? (minutes + ((n * 7) % 9) - 4) * 60 : null,
      still,
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
      year: extra.year === null ? null : year,
      rating: rating > 0 ? rating : null,
      poster: extra.poster === false || index === 10 ? null : stamp(id),
      tags: VOD_TAGS.filter((tag) => cat.tags.includes(tag)),
      adult: false,
    },
    cat,
    added: NOW - index * 2.3 * DAY,
    genres: extra.genres ?? (catKey === 'comedia' ? ['Comedia'] : ['Drama', 'Suspense']),
    cast: extra.cast ?? CASTS[(index + 1) % CASTS.length] ?? [],
    director: extra.director === undefined ? null : extra.director,
    country: extra.country === undefined ? 'España' : extra.country,
    plot: extra.plot === undefined ? (PLOTS[(index + 2) % PLOTS.length] ?? null) : extra.plot,
    released: extra.released ?? null,
    trailer: extra.trailer ? fakeTrailer(title) : null,
    runTimeS: minutes > 0 ? minutes * 60 : null,
    seasonNames: extra.seasonNames,
    backdrop: extra.backdrop === false ? null : stamp(`${id}:fondo`),
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
      durS: dune.durationS ?? 0,
      watched: false,
      hidden: false,
      updatedAt: at(2),
    });
  const nieve = MOVIES[3];
  if (nieve)
    progress.set(nieve.card.id, {
      posS: 5400,
      durS: nieve.durationS ?? 0,
      watched: false,
      hidden: false,
      updatedAt: at(30),
    });
  // Dune: Parte dos no tiene fondo: «Seguir viendo» enseña su cartel entero.
  const dune2 = MOVIES[2];
  if (dune2)
    progress.set(dune2.card.id, {
      posS: 3900,
      durS: dune2.durationS ?? 0,
      watched: false,
      hidden: false,
      updatedAt: at(40),
    });
  // The Office: hasta T2 · E5 visto → «Siguiente: T2:E6».
  const office = SERIES[1];
  if (office)
    for (const episode of office.episodes)
      if (episode.season === 1 || (episode.season === 2 && episode.n <= 5))
        progress.set(episode.id, {
          posS: episode.durationS ?? 0,
          durS: episode.durationS ?? 0,
          watched: true,
          hidden: false,
          updatedAt: at(20 + (episode.season === 2 ? 6 - episode.n : 12)),
        });
  // La casa de papel: T1 · E3 a medias.
  const casa = SERIES[0]?.episodes.find((e) => e.season === 1 && e.n === 3);
  if (casa)
    progress.set(casa.id, {
      posS: 1260,
      durS: casa.durationS ?? 0,
      watched: false,
      hidden: false,
      updatedAt: at(5),
    });
  // Cuéntame (sin fotogramas): T2 · E4 a medias, para ver la lista compacta con progreso.
  const cuentame = SERIES[8]?.episodes.find((e) => e.season === 2 && e.n === 4);
  if (cuentame)
    progress.set(cuentame.id, {
      posS: 2400,
      durS: cuentame.durationS ?? 0,
      watched: false,
      hidden: false,
      updatedAt: at(60),
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
  const durS = (episodeHit ? episodeHit.episode.durationS : movie?.durationS) ?? 0;
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
              {
                posS: episode.durationS ?? 0,
                durS: episode.durationS ?? 0,
                watched: true,
                hidden: false,
              },
              episode.durationS ?? 0,
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
      durS: shownProgress?.durS ?? shown.durationS ?? 0,
      isNext,
      art: shown.still
        ? { id: shown.id, art: 'still', v: shown.still }
        : series.backdrop
          ? { id: series.card.id, art: 'backdrop', v: series.backdrop }
          : series.card.poster
            ? { id: series.card.id, art: 'poster', v: series.card.poster }
            : null,
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
    // Los de adultos, como los demás (decisión de Isma para la 0.9.0, cambia D-VOD7).
    newMovies: [...MOVIES]
      .sort((a, b) => b.added - a.added)
      .slice(0, 20)
      .map(cardOf),
    updatedSeries: [...SERIES]
      .sort((a, b) => b.added - a.added)
      .slice(0, 20)
      .map(cardOf),
    categories: { movie: categoriesOf('movie'), series: categoriesOf('series') },
    tags: {
      movie: tagCounts(MOVIES),
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
    // Adultos: en «Todas» como los demás (decisión de Isma para la 0.9.0, cambia D-VOD7).
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
        trailer: null,
        released: null,
      };
    return {
      ...known,
      info: 'ok',
      originalTitle: movie.originalTitle,
      plot: movie.plot,
      genres: movie.genres,
      cast: movie.cast,
      director: movie.director,
      country: movie.country,
      ageRating: movie.ageRating,
      durationS: movie.durationS,
      backdrop: movie.backdrop,
      tech: {
        container: movie.container,
        video: movie.video || null,
        audio: movie.audio,
      },
      playable: movie.playable,
      trailer: movie.trailer,
      released: movie.released,
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
    director: series.director,
    country: series.country,
    rating: series.card.rating,
    poster: series.card.poster,
    backdrop: series.backdrop,
    tags: series.card.tags,
    adult: false,
    category: { id: series.cat.id, name: series.cat.name },
    trailer: series.trailer,
    released: series.released,
    episodeRunTimeS: series.runTimeS,
    seasons: numbers.map((n) => ({
      n,
      name: providerSeasonName(n, series.seasonNames),
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
  /** «Parte 1…5» del proveedor (se respeta) y T1 · E3 a medias. */
  seriesParts: SERIES[0]?.card.id ?? '',
  /** Ningún fotograma: la lista compacta. */
  seriesNoStills: SERIES[8]?.card.id ?? '',
  /** Una sola temporada. */
  seriesOneSeason: SERIES[11]?.card.id ?? '',
  /** 12 temporadas («Season N» del proveedor): el desplegable. */
  seriesTwelve: SERIES[12]?.card.id ?? '',
  /** Sin cartel, ni fondo, ni sinopsis, ni duraciones. */
  seriesPoor: SERIES[13]?.card.id ?? '',
  /** Película sin cartel, ni fondo, ni sinopsis, ni nota. */
  moviePoor: MOVIES.find((movie) => movie.card.title === 'El último verano')?.card.id ?? '',
  /** El título larguísimo. */
  movieLong: MOVIES.find((movie) => movie.card.title.length > 80)?.card.id ?? '',
  movieCategory: MOVIE_CATS.k4.id,
  adultCategory: MOVIE_CATS.adultos.id,
} as const;
