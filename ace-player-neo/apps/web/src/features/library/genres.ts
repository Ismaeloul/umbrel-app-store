/* Chips por categoría de la tabla de Canales en escritorio (rediseño,
   sección 3): «Todo», «Deportes», «Cine», «Noticias», «Infantil»…

   Son los TIPOS de la IPTV (IPTV_TYPES de @ace/shared, §16.4), que el
   servidor ya deduce de cada canal de tu IPTV (faceta `type` de
   `iptvBrowse`). Los canales de tus listas y de tu biblioteca no pasan por
   el servidor: aquí se les pone tipo con unas pocas palabras sobre su
   categoría y su nombre («Deportes», «DAZN 1», «Clan TVE»…). No hace falta
   que acierte siempre: un canal sin tipo sale en «Todo». */

import { foldText } from './model.ts';

/** Los tipos que salen como chip, en este orden (los de la maqueta primero). */
export const GENRES = [
  'deportes',
  'cine',
  'noticias',
  'infantil',
  'series',
  'documentales',
  'musica',
] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABEL: Record<Genre, string> = {
  deportes: 'Deportes',
  cine: 'Cine',
  series: 'Series',
  noticias: 'Noticias',
  infantil: 'Infantil',
  documentales: 'Documentales',
  musica: 'Música',
};

export function isGenre(value: unknown): value is Genre {
  return typeof value === 'string' && (GENRES as readonly string[]).includes(value);
}

/* Palabras (ya sin tildes ni mayúsculas) que delatan cada tipo. Van como
   palabra ENTERA salvo las que acaban en «*», que valen como principio de
   palabra («deport*» casa «deportes»). Así «gol» no casa «Golden» ni «nick»
   «Nickel». Fuera las que fallan más que aciertan: «radio» (Radio Marca es
   deporte) o «hits». Los tipos se prueban en el orden de GENRES: «TNT Sports»
   o «Fox Sports» son deporte antes que series. */
const TERMS: Record<Genre, readonly string[]> = {
  deportes: [
    'deport*',
    'sport*',
    'futbol*',
    'football',
    'soccer',
    'dazn',
    'laliga',
    'la liga',
    'liga',
    'bein',
    'eurosport*',
    'gol',
    'golazo',
    'f1',
    'formula 1',
    'motogp',
    'nba',
    'tenis',
    'tennis',
    'golf',
    'espn*',
    'champions',
    'premier league',
    'padel',
    'ufc',
    'wwe',
    'boxeo',
    'ciclismo',
    'basket',
    'ppv',
    'setanta',
    'teledeporte',
    'realmadrid',
    'real madrid tv',
    'barca tv',
  ],
  cine: ['cine*', 'movie*', 'film*', 'peli*', 'estrenos', 'tcm', 'paramount', 'hollywood'],
  series: ['series', 'serie', 'axn', 'tnt', 'warner', 'comedy', 'calle 13', 'fox', 'syfy', 'cosmo'],
  noticias: ['noticia*', 'news', '24h', '24 horas', 'cnn', 'euronews', 'informativ*', 'cnbc'],
  infantil: [
    'infantil*',
    'kids',
    'ninos',
    'clan',
    'disney*',
    'cartoon*',
    'nick',
    'nickelodeon',
    'baby',
    'boing',
    'junior',
    'toon*',
  ],
  documentales: [
    'document*',
    'discovery',
    'national geographic',
    'nat geo',
    'natgeo',
    'history',
    'historia',
    'odisea',
    'viajar',
    'animal planet',
  ],
  musica: ['musica', 'music', 'mtv', 'vh1'],
};

const escape = (term: string) => term.replace(/[+.]/g, '\\$&');

const PATTERNS: ReadonlyArray<[Genre, RegExp]> = GENRES.map((genre) => {
  const whole = TERMS[genre].filter((term) => !term.endsWith('*')).map(escape);
  const prefix = TERMS[genre]
    .filter((term) => term.endsWith('*'))
    .map((term) => escape(term.slice(0, -1)));
  const parts = [
    ...(whole.length ? [`(?:${whole.join('|')})(?![a-z0-9])`] : []),
    ...(prefix.length ? [`(?:${prefix.join('|')})`] : []),
  ];
  return [genre, new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})`)];
});

/* La clave de cada canal ya calculada: la tabla se repinta a cada segundo de progreso. */
const CACHE = new Map<string, Genre | null>();
const CACHE_MAX = 20_000;

/**
 * El tipo de un canal por su categoría y su nombre; null si no se sabe. Manda
 * la categoría («Cine» en una lista de deportes es cine): el nombre solo se
 * mira si la categoría no dice nada.
 */
export function genreOf(channel: { title: string; category?: string | undefined }): Genre | null {
  const key = `${channel.category ?? ''}\u0000${channel.title}`;
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;
  const find = (text: string) => PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  const genre = find(foldText(channel.category ?? '')) ?? find(foldText(channel.title));
  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(key, genre);
  return genre;
}

/** Cuántos canales hay de cada tipo (los que no tienen tipo no cuentan). */
export function genreCounts(
  channels: ReadonlyArray<{ title: string; category?: string | undefined }>,
): Map<Genre, number> {
  const counts = new Map<Genre, number>();
  for (const channel of channels) {
    const genre = genreOf(channel);
    if (genre) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return counts;
}

/** Los chips a la vista: los tipos con algún canal, en el orden de GENRES. */
export function genreChips(counts: ReadonlyMap<Genre, number>): Genre[] {
  return GENRES.filter((genre) => (counts.get(genre) ?? 0) > 0);
}
