/* Lógica pura de la biblioteca (inventario-front §13): pestañas, filtro,
   agrupados, subtítulos y el pie. Sin React ni red, para poder probarla sola.

   Tres colecciones del backend y tres pestañas:
   - favorites → «Favoritos»
   - history   → «Recientes»
   - web       → «Listas» (los canales de la lista ACTIVA, por categorías)

   En la 0.6.59 la pestaña se llamaba «Directorio»; en la v2 es «Listas»
   (maqueta A), pero la regla es la misma: solo enseña la lista activa. */

import type { Item, LibraryCollection, LibraryView } from '@ace/shared';

export type LibraryTab = 'favoritos' | 'recientes' | 'listas';

export const LIBRARY_TABS: readonly LibraryTab[] = ['favoritos', 'recientes', 'listas'];

export const TAB_COLLECTION: Record<LibraryTab, LibraryCollection> = {
  favoritos: 'favorites',
  recientes: 'history',
  listas: 'web',
};

export const TAB_LABEL: Record<LibraryTab, string> = {
  favoritos: 'Favoritos',
  recientes: 'Recientes',
  listas: 'Listas',
};

/** Espera del filtro local tras cada tecla (0.6.59: 140 ms, index.html:6075). */
export const LOCAL_FILTER_DELAY_MS = 140;
/** Letras para ofrecer «Buscar en el motor» (0.6.59: 2). */
export const ENGINE_SEARCH_MIN = 2;
/** Deshacer al borrar o al quitar un favorito (0.6.59: DESHACER_MS = 6 s). */
export const UNDO_MS = 6000;

export function isLibraryTab(value: unknown): value is LibraryTab {
  return value === 'favoritos' || value === 'recientes' || value === 'listas';
}

/**
 * La pestaña con la que se abre (regla 32): Favoritos si hay favoritos; si
 * no, Recientes si hay historial; si no, Listas (index.html:6131-6132).
 */
export function initialTab(library: Pick<LibraryView, 'favorites' | 'history'>): LibraryTab {
  if (library.favorites.length > 0) return 'favoritos';
  if (library.history.length > 0) return 'recientes';
  return 'listas';
}

export function itemsFor(
  library: Pick<LibraryView, 'favorites' | 'history' | 'web'>,
  tab: LibraryTab,
): Item[] {
  if (tab === 'favoritos') return library.favorites;
  if (tab === 'recientes') return library.history;
  return library.web;
}

/** Minúsculas y sin tildes: «Fútbol» encuentra «futbol» y al revés. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Filtro local por título o categoría (index.html:5549-5550). Se compara sin
 * tildes ni mayúsculas, que es lo que se espera escribiendo en el móvil.
 */
export function filterItems<T extends Pick<Item, 'title' | 'category'>>(
  items: readonly T[],
  query: string,
): T[] {
  const q = foldText(query);
  if (!q) return [...items];
  return items.filter(
    (item) => foldText(item.title).includes(q) || categoryMatches(item.category, q),
  );
}

/** La categoría que llevan los canales de tu IPTV guardados desde el buscador (docs/iptv.md §14.6). */
export const IPTV_CATEGORY = 'IPTV';

/**
 * ¿Casa la categoría con el texto (ya plegado)? «IPTV» es una marca, no una
 * categoría tuya: solo casa si escribes «ipt» o «iptv», no con «tv» (si no,
 * «tv» sacaría todos tus favoritos IPTV aunque su nombre no case).
 */
export function categoryMatches(category: string | undefined, q: string): boolean {
  if (category === IPTV_CATEGORY) return q.length >= 3 && 'iptv'.startsWith(q);
  return foldText(category || '').includes(q);
}

/** Clave estable de una fila: el mismo hash puede estar en dos colecciones. */
export function rowKey(collection: LibraryCollection, id: string): string {
  return `${collection}:${id}`;
}

/** La categoría vacía de una lista se agrupa en «General» (index.html:5565). */
export const DEFAULT_CATEGORY = 'General';

export interface CategoryGroup {
  category: string;
  items: Item[];
}

/** Canales de la lista por categorías, ordenadas alfabéticamente (index.html:5562-5573). */
export function groupByCategory(items: readonly Item[]): CategoryGroup[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const category = item.category?.trim() || DEFAULT_CATEGORY;
    const list = groups.get(category);
    if (list) list.push(item);
    else groups.set(category, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    .map(([category, list]) => ({ category, items: list }));
}

export type RecentBucket = 'Hoy' | 'Ayer' | 'Esta semana' | 'Antes';

export interface RecentGroup {
  label: RecentBucket;
  items: Item[];
}

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Recientes agrupados por cuándo se vieron (maqueta A: «.when-h»). Conserva el
 * orden del backend (el más reciente primero): solo mete cabeceras.
 */
export function recentGroups(items: readonly Item[], now = Date.now()): RecentGroup[] {
  const today = dayStart(now);
  const DAY = 86_400_000;
  const bucket = (item: Item): RecentBucket => {
    const at = Date.parse(item.date);
    if (!Number.isFinite(at) || at >= today) return 'Hoy';
    if (at >= today - DAY) return 'Ayer';
    if (at >= today - 6 * DAY) return 'Esta semana';
    return 'Antes';
  };
  const groups: RecentGroup[] = [];
  for (const item of items) {
    const label = bucket(item);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** Categorías que no dicen nada (las pone la app al guardar o el buscador). */
const PLACEHOLDER_CATEGORIES = new Set(['guardado', 'busqueda', 'búsqueda', 'sin categoría']);

/**
 * Subtítulo de una tarjeta (index.html:5493-5495): `{categoría} · disp. {n}%`
 * en la búsqueda y la categoría en las listas. En favoritos y recientes la
 * 0.6.59 ponía los 14 primeros caracteres del hash; la maqueta A pone la
 * categoría («Deportes»), que se lee mejor: se usa la categoría si dice algo
 * y, si no («Guardado» o vacía), el hash como antes.
 */
export function subtitleFor(
  item: Pick<Item, 'id' | 'category'>,
  kind: LibraryCollection | 'search',
  availability?: number | null,
): string {
  if (kind === 'search') {
    const category = item.category || 'Búsqueda';
    const pct = availabilityPercent(availability);
    return pct === null ? category : `${category} · disp. ${pct}%`;
  }
  const category = item.category?.trim() ?? '';
  if (category && (kind === 'web' || !PLACEHOLDER_CATEGORIES.has(category.toLowerCase())))
    return category;
  return `${item.id.slice(0, 14)}…`;
}

/** Disponibilidad 0..1 del buscador a porcentaje entero (null si no llega). */
export function availabilityPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

/**
 * «Canal caído»: un favorito que vino de la sincronización y ya no está en la
 * lista activa (index.html:5489). Sin lista cargada no se marca nada: no es
 * que el canal haya caído, es que no hay con qué comparar.
 */
export function isFallenFavorite(item: Item, webIds: ReadonlySet<string>): boolean {
  return item.fromWebSync && webIds.size > 0 && !webIds.has(item.id);
}

/** «23 sept.»: fecha corta de la sincronización (index.html:5619). */
export function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Pie de la biblioteca (index.html:5617-5622): `{n} canales en biblioteca ·
 * directorio sincronizado {d mes}`, más `· demo` en la demo.
 */
export function libraryFooter(
  library: Pick<LibraryView, 'favorites' | 'history' | 'web' | 'webSyncedAt'>,
  demo: boolean,
): string {
  const total = library.favorites.length + library.history.length + library.web.length;
  const synced = shortDate(library.webSyncedAt);
  return [
    `${total} ${total === 1 ? 'canal' : 'canales'} en biblioteca`,
    synced ? `lista sincronizada ${synced}` : null,
    demo ? 'demo' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Todos los canales que el usuario tiene (para buscar el título de un hash). */
export function findKnownItem(
  library: Pick<LibraryView, 'favorites' | 'history' | 'web'> | undefined,
  hash: string,
): Item | null {
  if (!library) return null;
  return (
    library.favorites.find((item) => item.id === hash) ??
    library.history.find((item) => item.id === hash) ??
    library.web.find((item) => item.id === hash) ??
    null
  );
}
