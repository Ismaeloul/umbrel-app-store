/* Datos de Películas y series (docs/vod.md §12.3): el estado de la URL, las
   consultas a `vodHome`, `vodBrowse` y `vodTitle`, las marcas de progreso y
   la dirección de los carteles.

   - Claves bajo ['v1', 'vodHome' | 'vodBrowse' | 'vodTitle', …]: el evento
     `iptv.status` las invalida si cambia el catálogo (api/sse.ts).
   - La rejilla va por páginas de 60 (`nextCursor`); un cursor de otro
     catálogo (`stale: true`) vacía la lista y empieza de nuevo.
   - Nada se pide con la vista oculta (`enabled: active`).
   - El estado de la URL (`cine`, `cinecat`, `cinetag`, `cineq`, `cineorden`,
     `cineidioma`) vive en un almacén: la vista y el panel lateral de
     escritorio (aside.tsx) lo comparten sin pasar por el router.
   - Idiomas (§4.10): primero se piden los elegidos (`vodLanguagesGet`) y
     con ellos la portada, las filas y la rejilla (`langs`/`unknown` en la
     consulta, así cada elección tiene su caché). Si el servidor no los sabe
     (uno anterior, un fallo), se ve todo: nunca se bloquea la vista. */

import {
  VOD_CLIENT,
  type VodArtKind,
  type VodBrowseQuery,
  type VodBrowseResponse,
  type VodCard,
  type VodKind,
  type VodLangQuery,
  type VodLanguages,
  type VodLanguagesBody,
  type VodProgressBody,
  type VodTitle,
} from '@ace/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  isDemo,
  routeKey,
  routePrefix,
  routeUrl,
  useApiQuery,
} from '../../api/index.ts';
import { apiFetch } from '../../api/client.ts';
import { errorFromResponse } from '../../api/errors.ts';
import { useRoute } from '../../app/router.tsx';
import { saveScroll } from '../../app/scroll-memory.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { demoArtSrc } from './demo-art.ts';
import type { browseQuery } from './model.ts';
import {
  langQuery,
  PAGE_SIZE,
  readCineState,
  sameCineState,
  writeCineState,
  type CineUrlState,
} from './model.ts';

// ---- Estado de la URL ------------------------------------------------------------------

const urlStore = createStore<CineUrlState>(readCineState(globalThis.location?.search ?? ''));

/**
 * «‹ Volver» desde una rejilla en la que se cambió de tipo: Atrás deshace la
 * entrada de la rejilla, pero la portada de antes era la del otro tipo. Al
 * llegar a ella (popstate), se pone el tipo con el que se estaba (un segundo
 * como mucho: si Atrás no llega a la portada, no se toca nada).
 */
let pendingHomeKind: { kind: CineUrlState['kind']; until: number } | null = null;
const PENDING_KIND_MS = 1000;

function writeUrl(state: CineUrlState): void {
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${writeCineState(location.search, state)}${location.hash}`,
    );
  } catch {}
}

function syncFromLocation(): void {
  let next = readCineState(globalThis.location?.search ?? '');
  const pending = pendingHomeKind;
  if (pending && (Date.now() > pending.until || (next.cat === null && next.tag === null))) {
    pendingHomeKind = null;
    if (Date.now() <= pending.until && next.kind !== pending.kind) {
      next = { ...next, kind: pending.kind };
      writeUrl(next);
    }
  }
  urlStore.set((current) => (sameCineState(current, next) ? current : next));
}

/** Cambia el estado (con replaceState: los filtros no llenan el historial). */
export function setCineState(patch: Partial<CineUrlState>): void {
  const next = { ...readCineState(location.search), ...patch };
  writeUrl(next);
  urlStore.set((current) => (sameCineState(current, next) ? current : next));
}

/** Marca en history.state de la entrada de una rejilla abierta desde la portada. */
interface GridHistoryState {
  aceDepth?: number;
  cineGrid?: boolean;
}

/**
 * Dónde estaba la portada (de qué tipo) la última vez que se vio: Home la
 * apunta al desplazarse y al abrir una rejilla, y vuelve ahí al cerrarla (con
 * la flecha, Atrás, Esc en la búsqueda o desde una ficha).
 */
let homeScroll: { kind: CineUrlState['kind']; y: number } = { kind: 'movie', y: 0 };

export function rememberHomeScroll(kind: CineUrlState['kind'], y: number): void {
  homeScroll = { kind, y: Math.max(0, Math.round(y)) };
}

/** La posición guardada de la portada de ese tipo (la del otro tipo empieza arriba). */
export function savedHomeScroll(kind: CineUrlState['kind']): number {
  return homeScroll.kind === kind ? homeScroll.y : 0;
}

/**
 * Lo que tenía el foco en la portada al abrir la rejilla («Ver todo» de una
 * fila): al volver, el foco vuelve ahí y no se pierde en la página.
 */
let homeFocus: HTMLElement | null = null;

/** Solo para Home: el «Ver todo» del que se vino, si sigue en la página. */
export function savedHomeFocus(): HTMLElement | null {
  return homeFocus?.isConnected ? homeFocus : null;
}

/**
 * Abre la rejilla (una categoría, «Ver todo», un distintivo) desde la portada
 * como una pantalla nueva: con su entrada en el historial, así «Atrás» (o el
 * gesto del iPhone) vuelve a la portada y a su sitio. Desde la propia rejilla
 * (otra categoría, otro distintivo) solo cambia el estado.
 */
export function openCineGrid(patch: Partial<CineUrlState>): void {
  const current = readCineState(location.search);
  if (current.cat !== null || current.tag !== null) {
    setCineState(patch);
    return;
  }
  const next = { ...current, ...patch };
  rememberHomeScroll(current.kind, globalThis.scrollY ?? 0);
  const active = globalThis.document?.activeElement;
  homeFocus = active instanceof HTMLElement && active.closest('.cine-portada') ? active : null;
  const depth = (history.state as GridHistoryState | null)?.aceDepth ?? 0;
  try {
    history.pushState(
      { aceDepth: depth + 1, cineGrid: true } satisfies GridHistoryState,
      '',
      `${location.pathname}${writeCineState(location.search, next)}${location.hash}`,
    );
  } catch {}
  urlStore.set((state) => (sameCineState(state, next) ? state : next));
}

/**
 * Vuelve a la portada: «Atrás» si la rejilla se abrió desde ella (deshace la
 * entrada del historial); si se llegó por un enlace, cambia el estado.
 */
export function closeCineGrid(): void {
  if ((history.state as GridHistoryState | null)?.cineGrid) {
    // Si en la rejilla se cambió de tipo, la portada a la que se vuelve es la de ese tipo.
    pendingHomeKind = {
      kind: readCineState(location.search).kind,
      until: Date.now() + PENDING_KIND_MS,
    };
    history.back();
    return;
  }
  setCineState({ cat: null, tag: null, order: 'novedades', q: '', lang: null });
}

/**
 * Desde una ficha, a la rejilla de una categoría («Categoría» de los detalles
 * o el panel lateral): deja el estado listo para la navegación y la rejilla
 * empieza arriba, no en el sitio que tenía la portada al abrir la ficha (el
 * armazón devuelve a la vista su último scroll). Volver a la portada la deja
 * donde estaba (`savedHomeScroll`).
 */
export function prepareGridFromFicha(patch: Partial<CineUrlState>): void {
  setCineState({ tag: null, q: '', ...patch });
  saveScroll({ vista: 'cine', id: null }, 0);
}

/** El estado de la URL de la vista, al día con Atrás/Adelante y con cada navegación. */
export function useCineState(): CineUrlState {
  const route = useRoute();
  useEffect(() => {
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [route]);
  return useStore(urlStore);
}

/** Solo para los tests. */
export function resetCineState(): void {
  urlStore.set(readCineState(globalThis.location?.search ?? ''));
  pendingHomeKind = null;
  homeScroll = { kind: 'movie', y: 0 };
  homeFocus = null;
}

// ---- Consultas -------------------------------------------------------------------------

/** Tras la última tecla (250 ms, `VOD_CLIENT.searchDebounceMs`). */
export const CINE_TEXT_DELAY_MS = VOD_CLIENT.searchDebounceMs;
/** Lo que dura una respuesta como buena sin SSE. */
const STALE_MS = 60_000;

/** El valor, una vez que lleva `ms` sin cambiar (comparado como JSON). */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  const settledKey = JSON.stringify(settled);
  useEffect(() => {
    if (key === settledKey) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
    // `value` va con `key`: mismo JSON, mismo valor.
  }, [key, settledKey, ms]);
  return settled;
}

// ---- Idiomas (§4.10) --------------------------------------------------------------------

/** Los idiomas elegidos (por casa, en el servidor). */
export function useVodLanguages(enabled: boolean) {
  return useApiQuery('vodLanguagesGet', undefined, {
    enabled,
    staleTime: STALE_MS,
    retry: 1,
  });
}

export interface LangScope {
  /** Ya se sabe qué idiomas pedir (también si el servidor no los sabe: entonces, todos). */
  ready: boolean;
  /** La elección; null si aún no ha llegado o el servidor no la sabe. */
  prefs: VodLanguages | null;
  /** `langs`/`unknown` de la portada, las filas y las categorías. */
  query: VodLangQuery;
}

/** El filtro de idiomas elegido, listo para las consultas. */
export function useLangScope(active: boolean): LangScope {
  const languages = useVodLanguages(active);
  const prefs = languages.data ?? null;
  return {
    ready: languages.isSuccess || languages.isError,
    prefs,
    query: langQuery(prefs),
  };
}

/** Guarda los idiomas y deja la respuesta en la caché: la vista se filtra al momento. */
export function useSaveLanguages() {
  const client = useQueryClient();
  return useCallback(
    async (body: VodLanguagesBody): Promise<VodLanguages> => {
      const saved = await api('vodLanguagesUpdate', { body });
      client.setQueryData(routeKey('vodLanguagesGet'), saved);
      return saved;
    },
    [client],
  );
}

/**
 * La portada: una sola petición (D-VOD28), con los idiomas elegidos. Mientras
 * llega la de otra elección, la de antes a la vista (sin esqueletos).
 */
export function useVodHome(active: boolean) {
  const lang = useLangScope(active);
  return useApiQuery(
    'vodHome',
    { query: lang.query },
    {
      enabled: active && lang.ready,
      staleTime: STALE_MS,
      retry: 1,
      placeholderData: keepPreviousData,
    },
  );
}

type BrowseScope = ReturnType<typeof browseQuery>;

/** Tarjetas de cada fila de la portada (una por categoría). */
export const ROW_SIZE = 20;

/**
 * Una fila de la portada: las 20 últimas de una categoría. Se pide solo
 * cuando la fila se acerca a la pantalla (`enabled`): con muchas filas no se
 * piden decenas de páginas (ni cientos de carteles) de golpe.
 */
export function useCategoryRow(kind: VodKind, cat: string, enabled: boolean) {
  const lang = useLangScope(enabled);
  return useApiQuery(
    'vodBrowse',
    {
      query: {
        kind,
        cat: cat as VodBrowseQuery['cat'],
        sort: 'added',
        limit: ROW_SIZE,
        ...lang.query,
      },
    },
    { enabled: enabled && lang.ready, staleTime: STALE_MS, retry: 1 },
  );
}

/** Clave de la rejilla por páginas (bajo `vodBrowse`, así la invalida `iptv.status`). */
export function pagesKey(scope: BrowseScope): QueryKey {
  return ['v1', 'vodBrowse', null, { ...scope, pages: true }];
}

/** La rejilla o la búsqueda: páginas de 60. */
export function useVodPages(scope: BrowseScope, enabled: boolean) {
  const client = useQueryClient();
  const key = pagesKey(scope);
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }): Promise<VodBrowseResponse> =>
      api('vodBrowse', {
        query: { ...scope, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: STALE_MS,
    retry: 1,
    /* Mientras llega lo nuevo (otro distintivo, otro orden, otra letra), lo de
       antes a la vista; cambiar de tipo o de CATEGORÍA sí empieza de cero: la
       cabecera ya dice «VOD | 4K» y no puede enseñar los carteles de otra
       categoría (se tocaría uno que no es). */
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[3] as BrowseScope | undefined;
      return before?.kind === scope.kind && before.cat === scope.cat ? previous : undefined;
    },
  });
  /* Otra sincronización entre dos páginas: esa página ya es de otro catálogo. */
  const staleHit = query.data?.pages.some((page, index) => index > 0 && page.stale) ?? false;
  const keyText = JSON.stringify(key);
  useEffect(() => {
    if (!staleHit) return;
    void client.resetQueries({ queryKey: JSON.parse(keyText) as QueryKey, exact: true });
  }, [staleHit, keyText, client]);
  return query;
}

/** Cada cuánto se vuelve a pedir una ficha que está «Comprobando el audio…» (el servidor la suelta a los 8 s sin pedirla). */
export const AUDIO_POLL_MS = 2_500;

/** Clave de una ficha (sin `pre`: la precarga y la ficha comparten la entrada). */
export function titleKey(id: string): QueryKey {
  return ['v1', 'vodTitle', { id }];
}

function fetchTitle(id: string, pre: boolean, signal?: AbortSignal): Promise<VodTitle> {
  return api('vodTitle', { params: { id }, query: { pre: pre ? '1' : '0' }, signal });
}

/** Una ficha a medio llegar (`pending`) se vuelve a pedir al abrirla (§12.4). */
function titleStale(data: VodTitle | undefined): number {
  return data && data.info !== 'ok' ? 0 : STALE_MS;
}

/**
 * La ficha. Con `placeholder` (la tarjeta de la que se viene), se abre al
 * momento con lo que ya se sabe y la sinopsis llega detrás.
 */
export function useVodTitle(id: string | null, active: boolean, placeholder?: VodTitle | null) {
  return useQuery<VodTitle, Error, VodTitle, QueryKey>({
    queryKey: titleKey(id ?? ''),
    queryFn: ({ signal }) => fetchTitle(id ?? '', false, signal),
    enabled: active && id !== null,
    staleTime: (query) => titleStale(query.state.data),
    /* «Comprobando el audio…» (§4.11): se vuelve a pedir mientras el servidor lee el fichero; al
       cerrar la ficha deja de pedirse y el servidor lo corta. */
    refetchInterval: (query) => (query.state.data?.audioPending ? AUDIO_POLL_MS : false),
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && error.code === 'vod_not_found'),
    placeholderData: placeholder ?? undefined,
  });
}

/** Precarga al apuntar o enfocar una tarjeta (`pre=1`: solo si la cola del servidor está vacía). */
export function prefetchTitle(client: QueryClient, id: string): void {
  const state = client.getQueryState(titleKey(id));
  if (state && (state.fetchStatus === 'fetching' || state.status === 'success')) return;
  void client.prefetchQuery<VodTitle, Error, VodTitle, QueryKey>({
    queryKey: titleKey(id),
    queryFn: ({ signal }) => fetchTitle(id, true, signal),
    staleTime: STALE_MS,
  });
}

/** Lo que se sabe de un título por su tarjeta, con la forma de una ficha (`info: 'pending'`). */
export function titleFromCard(card: VodCard): VodTitle {
  const common = {
    id: card.id,
    info: 'pending' as const,
    title: card.title,
    year: card.year,
    plot: null,
    genres: [],
    cast: [],
    director: null,
    country: null,
    rating: card.rating,
    poster: card.poster,
    backdrop: null,
    tags: card.tags,
    adult: card.adult,
    category: null,
  };
  if (card.kind === 'series')
    return { ...common, kind: 'series', seasons: [], main: null, truncated: false };
  return {
    ...common,
    kind: 'movie',
    originalTitle: null,
    ageRating: null,
    durationS: null,
    tech: { container: null, video: null, audio: [] },
    playable: 'unknown',
    progress: null,
  };
}

// Tarjetas vistas (portada y rejilla), para abrir la ficha al momento.
const seenCards = new Map<string, VodCard>();
const SEEN_MAX = 600;

export function rememberCards(cards: readonly VodCard[]): void {
  for (const card of cards) {
    seenCards.delete(card.id);
    seenCards.set(card.id, card);
  }
  while (seenCards.size > SEEN_MAX) {
    const oldest = seenCards.keys().next().value;
    if (oldest === undefined) break;
    seenCards.delete(oldest);
  }
}

export function seenCard(id: string): VodCard | null {
  return seenCards.get(id) ?? null;
}

// ---- Marcas de progreso (§10.2) --------------------------------------------------------

/**
 * POST /api/v1/vod/titles/:id/progress: 204 sin cuerpo (por eso no va por
 * `api()`, que es solo de JSON). En la demo lo contesta demo-data.ts.
 */
export async function postVodProgress(
  id: string,
  body: VodProgressBody,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  if (isDemo()) {
    const { demoProgress } = await import('./demo-data.ts');
    demoProgress(id, body);
    return;
  }
  const url = routeUrl('vodProgress', { id });
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOD_CLIENT.progressMs);
  try {
    response = await apiFetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: options.keepalive,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError({
      code: controller.signal.aborted ? 'timeout' : 'network',
      route: 'vodProgress',
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw await errorFromResponse(response, 'vodProgress');
}

/** Tras una marca: la portada («Seguir viendo»), las fichas y la rejilla (la barra de progreso). */
export function invalidateAfterProgress(client: QueryClient): Promise<unknown> {
  return Promise.all(
    (['vodHome', 'vodTitle', 'vodBrowse'] as const).map((id) =>
      client.invalidateQueries({ queryKey: routePrefix(id) }),
    ),
  );
}

/** Marca y refresca lo que se ve; devuelve el error para que la vista lo diga. */
export function useProgressMark() {
  const client = useQueryClient();
  return useCallback(
    async (id: string, event: VodProgressBody['event']): Promise<Error | null> => {
      try {
        await postVodProgress(id, { posS: 0, durS: 0, event });
        await invalidateAfterProgress(client);
        return null;
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    },
    [client],
  );
}

// ---- Carteles (§8) ---------------------------------------------------------------------

/**
 * La dirección de una imagen: `vodArt` por id y sello, nunca la URL del
 * proveedor (la CSP `img-src 'self' data:` solo deja estas dos cosas). En la
 * demo, un cartel SVG `data:` generado.
 */
export function artSrc(id: string, art: VodArtKind, v: string, title = ''): string {
  if (isDemo()) return demoArtSrc(id, art, v, title);
  return routeUrl('vodArt', { id, art }, { v });
}
