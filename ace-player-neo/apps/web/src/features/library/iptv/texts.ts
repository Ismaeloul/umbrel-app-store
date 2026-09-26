/* Textos literales de la pestaña IPTV de Canales (docs/iptv.md §16.7). Un
   solo sitio: los usan la pestaña, sus tests y el E2E. Los números van con
   `toLocaleString('es-ES')`, como en el resto de la web. */

/** «27.687»: el número como se escribe en España. */
export function formatCount(value: number): string {
  return value.toLocaleString('es-ES');
}

/** «1 canal» / «27.687 canales». */
export function channelsText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'canal' : 'canales'}`;
}

/** «1 categoría» / «312 categorías». */
export function categoriesText(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'categoría' : 'categorías'}`;
}

export const IPTV_TAB_TEXT = {
  tab: 'IPTV',
  allChannels: 'Todos los canales',
  noCategory: 'Sin categoría',
  back: 'Categorías',
  backLabel: 'Volver a las categorías',
  searchRoot: 'Buscar en tu IPTV',
  filters: 'Filtros',
  clearFilters: 'Quitar filtros',
  more: 'Más…',
  showLess: 'Ver menos',
  searchCountry: 'Buscar país',
  loadMore: 'Cargar más canales',
  loadingMore: 'Cargando más canales…',
  loading: 'Cargando tu IPTV…',
  noChannelsButton: 'Sin canales',
  // Estados (§16.6)
  loadFailed: 'No se pudo cargar tu IPTV.',
  retry: 'Reintentar',
  moreFailed: 'No se pudieron cargar más canales.',
  noneWithFilters: 'Ningún canal con estos filtros.',
  categoryGone: 'Esta categoría ya no está en tu IPTV.',
  seeCategories: 'Ver categorías',
  paused: 'Tu IPTV está en pausa.',
  pausedText: 'Reanúdala en Ajustes → IPTV para ver sus canales.',
  goToSettings: 'Ir a Ajustes',
  searchAllIptv: 'Buscar en toda tu IPTV',
} as const;

/** Cabecera de la raíz: «27.687 canales · 312 categorías»; con filtros o texto, «2.310 de 27.687 canales». */
export function rootHeaderText(input: {
  total: number;
  catalogTotal: number;
  categories: number;
  narrowed: boolean;
}): string {
  if (input.narrowed) return `${formatCount(input.total)} de ${channelsText(input.catalogTotal)}`;
  return `${channelsText(input.catalogTotal)} · ${categoriesText(input.categories)}`;
}

/** Nombre accesible de una categoría: «ES | DAZN, 18 canales». */
export function categoryLabel(name: string, count: number): string {
  return `${name}, ${channelsText(count)}`;
}

export const searchInCategory = (category: string): string => `Buscar en ${category}`;
export const categoriesWithText = (q: string): string => `Categorías con «${q}»`;
export const seeAllCountries = (n: number): string => `Ver todos los países (${formatCount(n)})`;
/** Pie de la hoja: «Ver 2.310 canales», «Ver 1 canal»; con 0, «Sin canales». */
export function seeChannelsText(n: number): string {
  return n === 0 ? IPTV_TAB_TEXT.noChannelsButton : `Ver ${channelsText(n)}`;
}
export const nothingInIptv = (q: string): string => `Nada en tu IPTV con «${q}».`;
export const nothingInCategory = (category: string, q: string): string =>
  `Nada en ${category} con «${q}».`;
/** Con texto y filtros: «Nada en tu IPTV con «dazn» y estos filtros.» */
export const nothingInIptvFiltered = (q: string): string =>
  `Nada en tu IPTV con «${q}» y estos filtros.`;
export const nothingInCategoryFiltered = (category: string, q: string): string =>
  `Nada en ${category} con «${q}» y estos filtros.`;
export const searchBothText = (q: string): string => `Buscar «${q}» en tu IPTV y el motor`;
/** Nombre accesible de un valor de faceta: «Fútbol, 1204 canales». */
export const facetValueLabel = (label: string, count: number): string =>
  `${label}, ${channelsText(count)}`;
/** Quitar un filtro elegido desde la fila de chips del móvil. */
export const removeFilterLabel = (label: string): string => `Quitar el filtro ${label}`;
/** «Filtros» con el número de elegidos. */
export const filtersButtonLabel = (selected: number): string =>
  selected > 0 ? `Filtros, ${selected} ${selected === 1 ? 'elegido' : 'elegidos'}` : 'Filtros';

/** Región viva tras cada cambio de texto o filtro (§16.6). */
export function iptvLiveText(total: number, q: string): string {
  if (total === 0 && !q) return IPTV_TAB_TEXT.noneWithFilters;
  return q ? `${channelsText(total)} con «${q}»` : channelsText(total);
}
