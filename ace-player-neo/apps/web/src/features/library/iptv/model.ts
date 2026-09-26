/* Lógica pura de la pestaña IPTV de Canales (docs/iptv.md §16.6): el estado
   de la URL, la consulta a `iptvBrowse`, las etiquetas de las facetas y los
   subtítulos. Sin React ni red, para poder probarla sola.

   Estado en la URL (volver y recargar lo conservan):
   - `&cat=<id>`: la categoría abierta (12 hex, `none` = «Sin categoría» o
     `todos` = «Todos los canales»). Entrar AÑADE una entrada al historial.
   - `&pais=ES,UK`, `&idioma=es`, `&tipo=deportes`, `&deporte=futbol,f1`,
     `&calidad=fhd`: los filtros. Cambiarlos REEMPLAZA la entrada.
   El texto no va en la URL: vive en la vista, como en el resto de Canales. */

import {
  IPTV_BROWSE,
  IPTV_SPORTS,
  IPTV_TYPES,
  type IptvBrowseChannel,
  type IptvBrowseQuery,
  type IptvFacetName,
  type IptvFacets,
  type IptvFacetValue,
  type IptvQuality,
} from '@ace/shared';
import { foldText } from '../model.ts';
import { IPTV_TAB_TEXT } from './texts.ts';

// ---- Facetas -------------------------------------------------------------------------

export const FACET_NAMES: readonly IptvFacetName[] = [
  'country',
  'language',
  'type',
  'sport',
  'quality',
];

/** Parámetro de la URL de cada faceta. */
export const FACET_PARAM: Record<IptvFacetName, string> = {
  country: 'pais',
  language: 'idioma',
  type: 'tipo',
  sport: 'deporte',
  quality: 'calidad',
};

export const FACET_TITLE: Record<IptvFacetName, string> = {
  country: 'País',
  language: 'Idioma',
  type: 'Tipo',
  sport: 'Deporte',
  quality: 'Calidad',
};

/** Qué valores acepta cada faceta (la misma forma que `IptvBrowseQuery`). */
const FACET_VALUE: Record<IptvFacetName, RegExp> = {
  country: /^(?:[A-Z]{2,4}|none)$/,
  language: /^(?:[a-z]{2}|none)$/,
  type: new RegExp(`^(?:${[...IPTV_TYPES, 'none'].join('|')})$`),
  sport: new RegExp(`^(?:${IPTV_SPORTS.join('|')})$`),
  quality: /^(?:uhd|fhd|hd|sd|none)$/,
};

export type IptvFilters = Record<IptvFacetName, readonly string[]>;

export const NO_FILTERS: IptvFilters = {
  country: [],
  language: [],
  type: [],
  sport: [],
  quality: [],
};

/** Países de §16.4 con su nombre. Un código fuera de la tabla sale tal cual («HU»). */
export const COUNTRY_LABEL: Readonly<Record<string, string>> = {
  ES: 'España',
  UK: 'Reino Unido',
  US: 'Estados Unidos',
  LAT: 'Latinoamérica',
  MX: 'México',
  ARG: 'Argentina',
  CO: 'Colombia',
  CL: 'Chile',
  PE: 'Perú',
  PT: 'Portugal',
  BR: 'Brasil',
  FR: 'Francia',
  IT: 'Italia',
  DE: 'Alemania',
  NL: 'Países Bajos',
  BE: 'Bélgica',
  CH: 'Suiza',
  AT: 'Austria',
  IE: 'Irlanda',
  PL: 'Polonia',
  RO: 'Rumanía',
  TR: 'Turquía',
  GR: 'Grecia',
  AL: 'Albania',
  RU: 'Rusia',
  UA: 'Ucrania',
  SE: 'Suecia',
  NO: 'Noruega',
  DK: 'Dinamarca',
  FI: 'Finlandia',
  CA: 'Canadá',
  IN: 'India',
  PK: 'Pakistán',
  MA: 'Marruecos',
  EXYU: 'Balcanes',
  none: 'Sin país',
};

/** Idiomas de §16.4. Un código fuera de la tabla sale en mayúsculas («HU»). */
export const LANGUAGE_LABEL: Readonly<Record<string, string>> = {
  es: 'Español',
  en: 'Inglés',
  ca: 'Catalán',
  eu: 'Euskera',
  gl: 'Gallego',
  pt: 'Portugués',
  fr: 'Francés',
  it: 'Italiano',
  de: 'Alemán',
  ar: 'Árabe',
  nl: 'Neerlandés',
  pl: 'Polaco',
  ro: 'Rumano',
  tr: 'Turco',
  el: 'Griego',
  sq: 'Albanés',
  ru: 'Ruso',
  none: 'Sin idioma',
};

export const TYPE_LABEL: Readonly<Record<string, string>> = {
  generalistas: 'Generalistas',
  deportes: 'Deportes',
  cine: 'Cine',
  series: 'Series',
  noticias: 'Noticias',
  infantil: 'Infantil',
  documentales: 'Documentales',
  musica: 'Música',
  entretenimiento: 'Entretenimiento',
  religion: 'Religión',
  adultos: 'Adultos',
  none: 'Sin tipo',
};

export const SPORT_LABEL: Readonly<Record<string, string>> = {
  futbol: 'Fútbol',
  baloncesto: 'Baloncesto',
  f1: 'F1',
  motos: 'Motos',
  motor: 'Motor',
  tenis: 'Tenis',
  padel: 'Pádel',
  golf: 'Golf',
  ciclismo: 'Ciclismo',
  balonmano: 'Balonmano',
  rugby: 'Rugby',
  lucha: 'Lucha',
  'futbol-americano': 'Fútbol americano',
  hockey: 'Hockey',
  beisbol: 'Béisbol',
  toros: 'Toros',
};

/** Calidad como en el buscador y en el cartel de una fuente IPTV (§8.1). */
export const QUALITY_LABEL: Readonly<Record<string, string>> = {
  uhd: '4K',
  fhd: '1080p',
  hd: '720p',
  sd: 'SD',
  none: 'Sin marca',
};

/** El orden de las calidades para enseñar: de mejor a peor. */
const QUALITY_ORDER: readonly IptvQuality[] = ['uhd', 'fhd', 'hd', 'sd'];

/** El texto de un valor de faceta; un código que no está en las tablas, tal cual. */
export function facetLabel(facet: IptvFacetName, value: string): string {
  switch (facet) {
    case 'country':
      return COUNTRY_LABEL[value] ?? value;
    case 'language':
      return LANGUAGE_LABEL[value] ?? value.toUpperCase();
    case 'type':
      return TYPE_LABEL[value] ?? value;
    case 'sport':
      return SPORT_LABEL[value] ?? value;
    case 'quality':
      return QUALITY_LABEL[value] ?? value;
  }
}

/** Etiquetas de calidad de una fila, de mejor a peor («1080p», «720p»). */
export function qualityTags(qualities: readonly IptvQuality[]): string[] {
  return QUALITY_ORDER.filter((quality) => qualities.includes(quality)).map(
    (quality) => QUALITY_LABEL[quality] ?? quality,
  );
}

/**
 * Etiquetas de una fila, como en el buscador (§17): el país si no es España ni
 * «sin país» («DE», «UK»; con «DAZN 1» de cinco países, lo único que las
 * distingue cuando el subtítulo enseña lo que se emite) y sus calidades.
 */
export function rowTags(channel: Pick<IptvBrowseChannel, 'country' | 'qualities'>): string[] {
  return [
    ...(channel.country && channel.country !== 'ES' ? [channel.country] : []),
    ...qualityTags(channel.qualities),
  ];
}

// ---- Estado de la URL ------------------------------------------------------------------

/** «Todos los canales»: la lista entera, sin categoría. */
export const ALL_CATEGORY = 'todos';
const CATEGORY_RE = /^(?:[a-f0-9]{12}|none|todos)$/;

export interface IptvUrlState {
  /** La categoría abierta (`todos` = «Todos los canales»), o null en la raíz. */
  category: string | null;
  filters: IptvFilters;
}

function readList(facet: IptvFacetName, raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (FACET_VALUE[facet].test(value) && !out.includes(value)) out.push(value);
    if (out.length >= IPTV_BROWSE.selectedMax) break;
  }
  return out;
}

/** El estado de la pestaña en `location.search`. Lo que no vale se ignora. */
export function readIptvState(search: string): IptvUrlState {
  const params = new URLSearchParams(search);
  const cat = params.get('cat');
  const filters = { ...NO_FILTERS };
  for (const facet of FACET_NAMES) filters[facet] = readList(facet, params.get(FACET_PARAM[facet]));
  return { category: cat && CATEGORY_RE.test(cat) ? cat : null, filters };
}

/** `location.search` con el estado de la pestaña (el resto de parámetros, igual). */
export function writeIptvState(search: string, state: IptvUrlState): string {
  const params = new URLSearchParams(search);
  if (state.category) params.set('cat', state.category);
  else params.delete('cat');
  for (const facet of FACET_NAMES) {
    const values = state.filters[facet];
    if (values.length > 0) params.set(FACET_PARAM[facet], values.join(','));
    else params.delete(FACET_PARAM[facet]);
  }
  const text = params.toString().replace(/%2F/gi, '/').replace(/%2C/gi, ',');
  return text ? `?${text}` : '';
}

/** Quita de la URL todo lo de la pestaña (al salir de ella). */
export function clearIptvState(search: string): string {
  return writeIptvState(search, { category: null, filters: NO_FILTERS });
}

export function selectedCount(filters: IptvFilters): number {
  return FACET_NAMES.reduce((sum, facet) => sum + filters[facet].length, 0);
}

export function hasFilters(filters: IptvFilters): boolean {
  return selectedCount(filters) > 0;
}

/** Elige o quita un valor de una faceta. */
export function toggleFilter(
  filters: IptvFilters,
  facet: IptvFacetName,
  value: string,
): IptvFilters {
  const current = filters[facet];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value].slice(0, IPTV_BROWSE.selectedMax);
  return { ...filters, [facet]: next };
}

export function sameFilters(a: IptvFilters, b: IptvFilters): boolean {
  return FACET_NAMES.every(
    (facet) => a[facet].length === b[facet].length && a[facet].every((v, i) => b[facet][i] === v),
  );
}

// ---- Consulta ----------------------------------------------------------------------------

/** La parte de la consulta que no depende de la página (clave de la caché). */
export type IptvBrowseScope = Omit<IptvBrowseQuery, 'cursor' | 'limit' | 'q'> & { q?: string };

/**
 * La consulta de `iptvBrowse` para un estado y un texto ya limpio (vacío si
 * tiene menos de 2 letras). `todos` es «sin categoría».
 */
export function browseScope(state: IptvUrlState, q: string): IptvBrowseScope {
  const scope: IptvBrowseScope = {};
  if (state.category && state.category !== ALL_CATEGORY) scope.category = state.category;
  if (q) scope.q = q;
  for (const facet of FACET_NAMES) {
    const values = state.filters[facet];
    if (values.length > 0) scope[facet] = values.join(',');
  }
  return scope;
}

// ---- Qué pantalla toca ---------------------------------------------------------------------

/**
 * - `root`: las categorías (sin texto): una petición con `limit=0`.
 * - `search`: texto en la raíz: «Categorías con «q»» y los canales de toda la IPTV.
 * - `all`: «Todos los canales».
 * - `category`: una categoría.
 */
export type IptvScreen = 'root' | 'search' | 'all' | 'category';

export function screenOf(state: IptvUrlState, q: string): IptvScreen {
  if (state.category === ALL_CATEGORY) return 'all';
  if (state.category) return 'category';
  return q ? 'search' : 'root';
}

// ---- Presentación ----------------------------------------------------------------------------

/** El nombre de una categoría para enseñar (`none` o sin nombre: «Sin categoría»). */
export function categoryName(id: string, name: string | undefined): string {
  if (id === ALL_CATEGORY) return IPTV_TAB_TEXT.allChannels;
  if (id === 'none' || !name) return IPTV_TAB_TEXT.noCategory;
  return name;
}

/** Hasta 5 categorías cuyo nombre contiene el texto (sin tildes ni mayúsculas), §16.3. */
export function categoriesMatching<T extends { name: string }>(
  categories: readonly T[],
  q: string,
  max = 5,
): T[] {
  const needle = foldText(q);
  if (!needle) return [];
  return categories.filter((category) => foldText(category.name).includes(needle)).slice(0, max);
}

/**
 * Subtítulo de una fila (§16.6): dentro de una categoría, el país (lo que se
 * sepa; si nada, el nombre del proveedor); fuera, el nombre de su categoría.
 */
export function channelSubtitle(
  channel: Pick<IptvBrowseChannel, 'country' | 'category'>,
  options: { inCategory: boolean; provider: string; categoryNames: ReadonlyMap<string, string> },
): string {
  if (options.inCategory) {
    const country = channel.country ? facetLabel('country', channel.country) : null;
    return country ?? options.provider;
  }
  return categoryName(channel.category, options.categoryNames.get(channel.category));
}

/** Los valores de una faceta que se ven sin abrir «Más…»: los primeros y los elegidos siempre. */
export function visibleFacetValues(
  values: readonly IptvFacetValue[],
  max: number,
): { shown: IptvFacetValue[]; hidden: IptvFacetValue[] } {
  const shown: IptvFacetValue[] = [];
  const hidden: IptvFacetValue[] = [];
  for (const value of values) {
    if (shown.length < max || value.selected) shown.push(value);
    else hidden.push(value);
  }
  return { shown, hidden };
}

/** Los tipos con más canales, para los atajos del móvil sin nada elegido (§16.6). */
export function topTypes(facets: IptvFacets | undefined, max = 4): IptvFacetValue[] {
  return (facets?.type ?? [])
    .filter((value) => value.value !== 'none' && value.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, max);
}

/**
 * Los valores elegidos, para la fila de chips del móvil (cada uno con su ×),
 * con su texto. Salen aunque la respuesta aún no los traiga.
 */
export function selectedValues(
  filters: IptvFilters,
): Array<{ facet: IptvFacetName; value: string; label: string }> {
  return FACET_NAMES.flatMap((facet) =>
    filters[facet].map((value) => ({ facet, value, label: facetLabel(facet, value) })),
  );
}
