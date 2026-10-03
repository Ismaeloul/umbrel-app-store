/* Textos literales de Películas y series (docs/vod.md §12 y §13). Un solo
   sitio: los usan la vista, sus tests, la demo y el E2E, y la app nativa los
   generará desde aquí. Se copian tal cual del documento: no se retocan sin
   cambiarlo allí. Los números van con `toLocaleString('es-ES')`. */

import type { VodKind, VodTag } from '@ace/shared';

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
  tagsGroup: 'Lengua y calidad',
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
  // Menú de «Seguir viendo» (§12.4)
  hideContinue: 'Quitar de Seguir viendo',
  markWatched: 'Marcar como visto',
  markUnwatched: 'Marcar como no visto',
  markThrough: 'Marcar hasta aquí como visto',
  seeDetails: 'Ver ficha',
  moreOptions: 'Más opciones',
  // Ficha (§12.6)
  play: 'Reproducir',
  fromStart: 'Empezar desde el principio',
  markMovieWatched: 'Marcar como vista',
  markMovieUnwatched: 'Marcar como no vista',
  synopsis: 'Sinopsis',
  more: 'Más',
  less: 'Menos',
  cast: 'Reparto',
  director: 'Dirección',
  country: 'País',
  seasons: 'Temporadas',
  seasonsMenu: 'Elegir temporada',
  specials: 'Especiales',
  watched: 'Visto',
  byProvider: 'Según el proveedor',
  audio: 'Audio',
  backToMovies: 'Volver a películas',
  backToSeries: 'Volver a series',
  back: 'Volver',
  noSynopsis: 'No se ha podido cargar la sinopsis.',
  hevcBlocked: 'Este navegador no reproduce vídeo HEVC. Prueba en Safari o en el iPhone.',
  truncatedSeries: 'Esta serie tiene más episodios de los que se pueden enseñar.',
  // Reproducir antes de VOD-6: la ficha y la portada ya llaman aquí.
  comingSoon: 'Próximamente: la reproducción de películas y series llega en la siguiente versión.',
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
  removeTag: 'Quitar el filtro',
  notFound: 'Este título ya no está en tu IPTV.',
} as const;

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

/** Nada con «{q}» en películas (§12.5). */
export function nothingFound(q: string, kind: VodKind): string {
  return `Nada con «${q}» en ${kind === 'movie' ? 'películas' : 'series'}`;
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
 * «Tu IPTV tiene más de 200.000 películas; se ven las primeras 200.000.» Si
 * lo recortado son las series (el tope de películas no se alcanzó), lo mismo
 * con las series.
 */
export function truncatedText(
  counts: { movies: number; series: number },
  limits: { maxMovies: number; maxSeries: number },
): string {
  if (counts.movies < limits.maxMovies && counts.series >= limits.maxSeries)
    return `Tu IPTV tiene más de ${formatCount(limits.maxSeries)} series; se ven las primeras ${formatCount(limits.maxSeries)}.`;
  return `Tu IPTV tiene más de ${formatCount(limits.maxMovies)} películas; se ven las primeras ${formatCount(limits.maxMovies)}.`;
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
