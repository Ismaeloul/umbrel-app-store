/* Datos de la pestaña IPTV (docs/iptv.md §16.6): el estado de la URL y las
   consultas a `iptvBrowse`.

   - La raíz sin texto es UNA petición con `limit=0` (categorías y facetas).
   - Lo demás (una categoría, «Todos los canales» o texto en la raíz) va por
     páginas de 60 con `useInfiniteQuery` (`nextCursor`). La primera página
     trae las facetas (y, sin categoría, las categorías).
   - Claves bajo ['v1', 'iptvBrowse'], así el evento `iptv.status` las
     invalida todas (api/sse.ts). `staleTime` de 60 s.
   - Un cambio de filtros o de texto dentro de la misma pantalla deja lo de
     antes a la vista hasta que llega lo nuevo (sin esqueletos a cada toque);
     cambiar de categoría, no.
   - `stale: true` en una página siguiente (hubo otra sincronización): la
     lista se vacía y empieza de nuevo, sin avisar. */

import { IPTV_BROWSE, IPTV_CLIENT, type IptvBrowseResponse } from '@ace/shared';
import { useInfiniteQuery, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/index.ts';
import { useRoute } from '../../../app/router.tsx';
import {
  readIptvState,
  sameFilters,
  writeIptvState,
  type IptvBrowseScope,
  type IptvFilters,
  type IptvUrlState,
} from './model.ts';

// ---- Estado de la URL ------------------------------------------------------------------

interface IptvHistoryState {
  aceDepth?: number;
  /** La entrada la añadió la pestaña IPTV al entrar en esta categoría. */
  aceIptvCat?: string;
}

function historyState(): IptvHistoryState {
  const state = (typeof history !== 'undefined' ? history.state : null) as IptvHistoryState | null;
  return state && typeof state === 'object' ? state : {};
}

function urlWith(search: string): string {
  return `${location.pathname}${search}${location.hash}`;
}

function sameState(a: IptvUrlState, b: IptvUrlState): boolean {
  return a.category === b.category && sameFilters(a.filters, b.filters);
}

export interface IptvUrlControls {
  state: IptvUrlState;
  /** Entra en una categoría (`todos` = «Todos los canales»): añade una entrada al historial. */
  openCategory(id: string): void;
  /** Vuelve a las categorías: Atrás si la entrada la puso la pestaña; si no, la reemplaza. */
  closeCategory(): void;
  /** Cambia los filtros reemplazando la entrada (no llenan el historial). */
  setFilters(filters: IptvFilters): void;
}

export function useIptvUrlState(): IptvUrlControls {
  const route = useRoute();
  const [state, setState] = useState<IptvUrlState>(() =>
    readIptvState(globalThis.location?.search ?? ''),
  );

  useEffect(() => {
    const sync = () =>
      setState((current) => {
        const next = readIptvState(location.search);
        return sameState(current, next) ? current : next;
      });
    sync();
    // Atrás y Adelante del navegador entre categorías (misma vista: el router no repinta).
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [route]);

  const openCategory = useCallback((id: string) => {
    const current = readIptvState(location.search);
    const next = { ...current, category: id };
    const depth = historyState().aceDepth ?? 0;
    try {
      history.pushState(
        { ...historyState(), aceDepth: depth + 1, aceIptvCat: id } satisfies IptvHistoryState,
        '',
        urlWith(writeIptvState(location.search, next)),
      );
    } catch {}
    setState(next);
  }, []);

  const closeCategory = useCallback(() => {
    const current = readIptvState(location.search);
    const own = historyState();
    if (current.category && own.aceIptvCat === current.category && (own.aceDepth ?? 0) > 0) {
      history.back();
      return;
    }
    const next = { ...current, category: null };
    try {
      history.replaceState(history.state, '', urlWith(writeIptvState(location.search, next)));
    } catch {}
    setState(next);
  }, []);

  const setFilters = useCallback((filters: IptvFilters) => {
    const next = { ...readIptvState(location.search), filters };
    try {
      history.replaceState(history.state, '', urlWith(writeIptvState(location.search, next)));
    } catch {}
    setState(next);
  }, []);

  return { state, openCategory, closeCategory, setFilters };
}

// ---- Consultas -------------------------------------------------------------------------

/** Tras la última tecla, como Buscar (una petición por texto, no por tecla). */
export const IPTV_TEXT_DELAY_MS = IPTV_CLIENT.browseDebounceMs;
/** Tras el último toque en un filtro: junta varios toques seguidos en una petición. */
export const IPTV_FILTER_DELAY_MS = IPTV_CLIENT.browseFilterDebounceMs;
/** Lo que dura una respuesta como buena. */
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

/** Clave de la raíz (`limit=0`): la misma forma que `routeKey`, así la invalida `iptv.status`. */
export function rootKey(scope: IptvBrowseScope): QueryKey {
  return ['v1', 'iptvBrowse', null, { ...scope, limit: 0 }];
}

/** Clave de la lista por páginas. */
export function pagesKey(scope: IptvBrowseScope): QueryKey {
  return ['v1', 'iptvBrowse', null, { ...scope, pages: true }];
}

/** La categoría de una clave (para saber si una respuesta anterior sirve de relleno). */
function categoryOfKey(key: QueryKey | undefined): string | null {
  const scope = key?.[3] as { category?: string } | undefined;
  return scope?.category ?? null;
}

/** La raíz sin texto: categorías y facetas en una sola petición. */
export function useIptvRoot(scope: IptvBrowseScope, enabled: boolean) {
  return useQuery({
    queryKey: rootKey(scope),
    queryFn: ({ signal }) => api('iptvBrowse', { query: { ...scope, limit: 0 }, signal }),
    enabled,
    staleTime: STALE_MS,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

/** Una categoría, «Todos los canales» o el texto en la raíz: páginas de 60. */
export function useIptvPages(scope: IptvBrowseScope, enabled: boolean) {
  const client = useQueryClient();
  const key = pagesKey(scope);
  const category = scope.category ?? null;
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }): Promise<IptvBrowseResponse> =>
      api('iptvBrowse', {
        query: { ...scope, limit: IPTV_BROWSE.limit, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: STALE_MS,
    retry: 1,
    placeholderData: (previous, previousQuery) =>
      previousQuery && categoryOfKey(previousQuery.queryKey) === category ? previous : undefined,
  });
  /* Otra sincronización entre dos páginas: esa página ya es la primera de otro catálogo. */
  const staleHit = query.data?.pages.some((page, index) => index > 0 && page.stale) ?? false;
  const keyText = JSON.stringify(key);
  useEffect(() => {
    if (!staleHit) return;
    void client.resetQueries({ queryKey: JSON.parse(keyText) as QueryKey, exact: true });
  }, [staleHit, keyText, client]);
  return query;
}
