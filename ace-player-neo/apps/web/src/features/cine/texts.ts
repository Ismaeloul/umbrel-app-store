/* Textos literales de Películas y series (docs/vod.md §12 y §13). Un solo
   sitio: los usan la vista, sus tests, la demo y el E2E, y la app nativa los
   generará desde aquí. Se copian tal cual del documento: no se retocan sin
   cambiarlo allí. Los números van con `toLocaleString('es-ES')`. */

import type { VodKind, VodLang, VodTag } from '@ace/shared';

/**
 * «1.234» y «27.687»: el número como se escribe en España. `es-ES` no agrupa
 * las cifras de 4 dígitos por defecto («1234»); `useGrouping: 'always'` sí,
 * como piden §12.4 y §12.10.
 */
export function formatCount(value: number): string {
  return value.toLocaleString('es-ES', { useGrouping: 'always' });
}

export const CINE_TEXT = {
  title: 'Películas y series',
  navLabel: 'Pelis y series',
  kindGroup: 'Películas o series',
  movies: 'Películas',
  series: 'Series',
  searchMovies: 'Buscar películas',
  searchSeries: 'Buscar series',
  clearSearch: 'Borrar búsqueda',
  continueTitle: 'Seguir viendo',
  newMovies: 'Novedades en películas',
  updatedSeries: 'Series actualizadas',
  allCategories: 'Todas las categorías',
  all: 'Todas',
  categories: 'Categorías',
  noCategory: 'Sin categoría',
  tagsGroup: 'Calidad',
  orderGroup: 'Orden',
  orderNew: 'Novedades',
  orderAz: 'A-Z',
  loadMoreMovies: 'Cargar más películas',
  loadMoreSeries: 'Cargar más series',
  loadingMore: 'Cargando más…',
  loading: 'Cargando películas y series…',
  moreFailed: 'No se han podido cargar más',
  retry: 'Reintentar',
  capped: 'Hay más de 2.000 resultados: afina la búsqueda.',
  adult: '+18',
  // Portada en filas y rejilla aparte (0.9.0)
  seeAllRow: 'Ver todo',
  moreCategories: 'Más categorías',
  seeAllMovies: 'Ver todas las películas',
  seeAllSeries: 'Ver todas las series',
  allMovies: 'Todas las películas',
  allSeries: 'Todas las series',
  home: 'Inicio',
  backHome: 'Volver a Películas y series',
  exitSearch: 'Salir de la búsqueda',
  searchAllMovies: 'Buscar en todas las películas',
  searchAllSeries: 'Buscar en todas las series',
  rowFailed: 'No se ha podido cargar esta fila.',
  // Menú de «Seguir viendo» (§12.4)
  hideContinue: 'Quitar de Seguir viendo',
  markWatched: 'Marcar como visto',
  markUnwatched: 'Marcar como no visto',
  markThrough: 'Marcar hasta aquí como visto',
  seeDetails: 'Ver ficha',
  moreOptions: 'Más opciones',
  // Ficha (§12.6)
  movieKicker: 'Película',
  seriesKicker: 'Serie',
  play: 'Reproducir',
  fromStart: 'Empezar desde el principio',
  markMovieWatched: 'Marcar como vista',
  markMovieUnwatched: 'Marcar como no vista',
  trailer: 'Tráiler',
  trailerDemo: 'En el modo demo no se abren los tráileres de YouTube.',
  newTab: 'se abre en YouTube, en otra pestaña',
  synopsis: 'Sinopsis',
  more: 'Más',
  less: 'Menos',
  details: 'Detalles',
  cast: 'Reparto',
  director: 'Dirección',
  country: 'País',
  genres: 'Géneros',
  released: 'Estreno',
  originalTitle: 'Título original',
  category: 'Categoría',
  video: 'Vídeo',
  format: 'Formato',
  rating: 'Nota',
  episodesTitle: 'Episodios',
  noEpisodes: 'Esta temporada todavía no tiene episodios.',
  mainResume: 'Continuar',
  mainNext: 'Siguiente',
  mainStart: 'Empieza aquí',
  seasons: 'Temporadas',
  seasonsMenu: 'Elegir temporada',
  specials: 'Especiales',
  watched: 'Visto',
  byProvider: 'Según el proveedor',
  audio: 'Audio',
  subtitles: 'Subtítulos',
  /* Lo que dice el propio fichero (docs/vod.md §4.11). */
  audioChecking: 'Comprobando el audio…',
  fromFile: 'Lo dice el propio fichero, no el proveedor',
  backToMovies: 'Volver a películas',
  backToSeries: 'Volver a series',
  back: 'Volver',
  noSynopsis: 'No se ha podido cargar la sinopsis.',
  hevcBlocked: 'Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.',
  truncatedSeries: 'Esta serie tiene más episodios de los que se pueden enseñar.',
  // Estados (§13)
  noIptvTitle: 'Conecta tu IPTV',
  noIptvText: 'Las películas y series salen de tu IPTV. Conéctala en Ajustes.',
  pausedTitle: 'Tu IPTV está en pausa.',
  m3uTitle: 'Tu IPTV es una lista M3U',
  m3uText:
    'Las películas y series necesitan una cuenta Xtream Codes (servidor, usuario y contraseña).',
  noneTitle: 'Tu IPTV no tiene películas ni series',
  noneText: 'Tu proveedor no ofrece este servicio o lo tiene desactivado.',
  checkAgain: 'Comprobar de nuevo',
  goToSettings: 'Ir a Ajustes',
  preparing: 'Preparando el catálogo… La primera vez tarda unos segundos.',
  errorTitle: 'No se ha podido cargar el catálogo',
  emptyCategory: 'Esta categoría está vacía',
  seeAll: 'Ver todas',
  noneWithTag: 'Nada con este distintivo',
  noneInMyLangs: 'Nada en tus idiomas',
  removeTag: 'Quitar el filtro',
  notFound: 'Este título ya no está en tu IPTV.',
} as const;

// ---- Idiomas (§4.10) ---------------------------------------------------------------------

/** El nombre de cada idioma en el selector y en el botón de la cabecera. */
export const LANG_LABEL: Record<VodLang, string> = {
  castellano: 'Castellano',
  latino: 'Latino',
  vose: 'VOSE',
  ingles: 'Inglés',
  frances: 'Francés',
  italiano: 'Italiano',
  aleman: 'Alemán',
  portugues: 'Portugués',
  catalan: 'Catalán',
  otros: 'Otros idiomas',
};

/** La cápsula del cartel (§12.12): corta. */
export const LANG_BADGE: Record<VodLang, string> = {
  castellano: 'Castellano',
  latino: 'Latino',
  vose: 'VOSE',
  ingles: 'Inglés',
  frances: 'Francés',
  italiano: 'Italiano',
  aleman: 'Alemán',
  portugues: 'Portugués',
  catalan: 'Catalán',
  otros: 'Otro idioma',
};

/** La marca de la tesela del selector. */
export const LANG_CODE: Record<VodLang, string> = {
  castellano: 'ES',
  latino: 'LAT',
  vose: 'VOSE',
  ingles: 'EN',
  frances: 'FR',
  italiano: 'IT',
  aleman: 'DE',
  portugues: 'PT',
  catalan: 'CA',
  otros: '+',
};

/** Lo que quiere decir cada uno, debajo de su nombre. */
export const LANG_HINT: Record<VodLang, string> = {
  castellano: 'Doblaje de España',
  latino: 'Doblaje latinoamericano',
  vose: 'Versión original con subtítulos en español',
  ingles: 'Versión original en inglés',
  frances: 'En francés',
  italiano: 'En italiano',
  aleman: 'En alemán',
  portugues: 'En portugués (también de Brasil)',
  catalan: 'En catalán',
  otros: 'Árabe, turco, polaco, ruso…',
};

export const LANG_TEXT = {
  group: 'Idiomas',
  button: 'Idiomas',
  all: 'Todos los idiomas',
  welcomeKicker: 'Antes de empezar',
  welcomeTitle: '¿En qué idiomas las quieres ver?',
  welcomeText:
    'Elige uno o varios: solo verás películas y series en esos idiomas. Castellano y latino van por separado.',
  anytime: 'Puedes cambiarlo cuando quieras con el botón del globo, junto al buscador.',
  start: 'Ver películas y series',
  startAll: 'Ver todos los idiomas',
  skip: 'Ahora no, ver todo',
  sheetTitle: 'Idiomas',
  sheetText:
    'Solo verás películas y series en estos idiomas. Castellano y latino van por separado.',
  save: 'Guardar',
  cancel: 'Cancelar',
  unknownLabel: 'Mostrar también los que no indican idioma',
  saved: 'Idiomas guardados',
  saveFailed: 'No se han podido guardar los idiomas.',
  change: 'Cambiar idiomas',
  settingsTitle: 'Idiomas de Pelis y series',
  settingsChange: 'Cambiar',
  loading: 'Cargando los idiomas…',
  onlyMarked: 'solo los que lo indican',
} as const;

/** «Audio: Castellano · Inglés» (lo que dice el fichero, §4.11); null si no dice nada. */
export function detectedAudioText(langs: readonly string[] | undefined): string | null {
  return langs?.length ? `${CINE_TEXT.audio}: ${langs.join(' · ')}` : null;
}

/** «Subtítulos: Español»; null si no hay subtítulos de texto con lengua. */
export function detectedSubtitlesText(langs: readonly string[] | undefined): string | null {
  return langs?.length ? `${CINE_TEXT.subtitles}: ${langs.join(' · ')}` : null;
}

/** «Castellano», «Castellano y Francés», «Castellano, Latino +1»; sin ninguno, «Todos los idiomas». */
export function langSummary(langs: readonly VodLang[]): string {
  const names = langs.map((lang) => LANG_LABEL[lang]);
  if (names.length === 0) return LANG_TEXT.all;
  if (names.length === 1) return names[0] as string;
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** «1.234 películas · 56 series» (lo que haya de cada tipo). */
export function langCountText(movies: number, series: number): string {
  const parts = [
    movies > 0 ? titlesText(movies, 'movie') : null,
    series > 0 ? titlesText(series, 'series') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nada en tu IPTV';
}

/** «12.345 títulos de tu IPTV no dicen en qué idioma están.» */
export function unknownHelp(n: number): string {
  return n === 1
    ? '1 título de tu IPTV no dice en qué idioma está.'
    : `${formatCount(n)} títulos de tu IPTV no dicen en qué idioma están.`;
}

/** «No hay películas en Catalán» / «No hay series en Castellano y Francés». */
export function noneInLangs(kind: VodKind, langs: readonly VodLang[]): string {
  return `No hay ${kind === 'movie' ? 'películas' : 'series'} en ${langSummary(langs)}`;
}

/** «Tu IPTV tiene 1.234 películas en otros idiomas.» */
export function elsewhereText(n: number, kind: VodKind): string {
  return `Tu IPTV tiene ${titlesText(n, kind)} en otros idiomas.`;
}

/** Nombre accesible del botón de la cabecera: «Idiomas: Castellano y Francés. Cambiar». */
export function langButtonLabel(langs: readonly VodLang[]): string {
  return `${LANG_TEXT.button}: ${langSummary(langs)}. Cambiar`;
}

/** Chips y cápsulas de los distintivos (§4.4), en su orden. */
export const TAG_LABEL: Record<VodTag, string> = {
  castellano: 'Castellano',
  latino: 'Latino',
  vose: 'VOSE',
  multi: 'Multi',
  '4k': '4K',
};

/** «1 película» / «1.234 películas»; «1 serie» / «12 series». */
export function titlesText(n: number, kind: VodKind): string {
  const word =
    kind === 'movie' ? (n === 1 ? 'película' : 'películas') : n === 1 ? 'serie' : 'series';
  return `${formatCount(n)} ${word}`;
}

/** «10 episodios». */
export function episodesText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'episodio' : 'episodios'}`;
}

/** «3 temporadas» / «1 temporada». */
export function seasonsText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'temporada' : 'temporadas'}`;
}

/** «Seguir viendo desde 43:12». */
export function resumeFromText(clock: string): string {
  return `Seguir viendo desde ${clock}`;
}

/** «Episodios de unos 45 min». */
export function episodeRunText(duration: string): string {
  return `Episodios de unos ${duration}`;
}

/** «Resultados de «dune»». */
export function resultsTitle(q: string): string {
  return `Resultados de «${q}»`;
}

/** «Ver las 1.234 películas» / «Ver las 12 series». */
export function seeAllTitles(n: number, kind: VodKind): string {
  return `Ver las ${titlesText(n, kind)}`;
}

/** «Ver todo: VOD | 4K, 9 películas» (nombre accesible del enlace de una fila). */
export function seeRowLabel(name: string, n: number, kind: VodKind): string {
  return `Ver todo: ${name}, ${titlesText(n, kind)}`;
}

/** Nada con «{q}» en películas (§12.5). */
export function nothingFound(q: string, kind: VodKind): string {
  return `Nada con «${q}» en ${kind === 'movie' ? 'películas' : 'series'}`;
}

/** Una búsqueda dentro de una categoría (§12.5): «Nada con «wonka» en VOD | 4K». */
export function nothingFoundIn(q: string, category: string): string {
  return `Nada con «${q}» en ${category}`;
}

/** «3 películas en VOD | 4K»: lo encontrado, diciendo dónde se ha buscado. */
export function titlesInText(n: number, kind: VodKind, category: string): string {
  return `${titlesText(n, kind)} en ${category}`;
}

/** «Ver 3 series» / «Ver 1 película»: los aciertos del otro tipo. */
export function seeOtherKind(n: number, other: VodKind): string {
  return `Ver ${titlesText(n, other)}`;
}

/** Ajustes y portada: «Catálogo del 28 sep. No se ha podido actualizar.» */
export function staleText(day: string): string {
  return `Catálogo del ${day}. No se ha podido actualizar.`;
}

/**
 * «Tu IPTV tiene más de 400.000 películas; se ven las primeras 400.000.» Si
 * lo recortado son las series (el tope de películas no se alcanzó), lo mismo
 * con las series. Sin llegar a ningún tope, `truncated` es que el modo por
 * categorías se cortó por tiempo la primera vez (docs/vod.md §4.7): faltan
 * categorías, no títulos de más.
 */
export function truncatedText(
  counts: { movies: number; series: number },
  limits: { maxMovies: number; maxSeries: number },
): string {
  if (counts.movies >= limits.maxMovies)
    return `Tu IPTV tiene más de ${formatCount(limits.maxMovies)} películas; se ven las primeras ${formatCount(limits.maxMovies)}.`;
  if (counts.series >= limits.maxSeries)
    return `Tu IPTV tiene más de ${formatCount(limits.maxSeries)} series; se ven las primeras ${formatCount(limits.maxSeries)}.`;
  return 'Faltan algunas categorías: tu IPTV tardaba demasiado en contestar. Se completarán en las próximas actualizaciones.';
}

/**
 * «Este formato (AVI) no se puede reproducir en Ace Player.» Si el servidor no
 * sabe el formato (sin `container`), un texto genérico según lo que sea, nunca
 * «(DESCONOCIDO)» (vod-estado.md §4.2, arreglo 1).
 */
export function formatBlocked(ext: string | null | undefined, kind: 'movie' | 'episode'): string {
  const name = (ext ?? '').trim();
  if (name) return `Este formato (${name.toUpperCase()}) no se puede reproducir en Ace Player.`;
  return kind === 'episode'
    ? 'Este episodio no se puede reproducir en este navegador.'
    : 'Esta película no se puede reproducir en este navegador.';
}

/** «Continuar · quedan 43 min». */
export function continueLabel(remaining: string): string {
  return `Continuar · ${remaining.charAt(0).toLowerCase()}${remaining.slice(1)}`;
}

/** Nombre accesible de una tarjeta: «Dune, 2021, nota 8,0, Castellano, 4K». */
export function cardLabel(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter(Boolean).join(', ');
}
