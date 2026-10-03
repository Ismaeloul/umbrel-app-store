/* Datos de la Guía TV (docs/iptv.md §20.6): nunca se baja la guía entera.

   - Canales por páginas de 200 (`iptvGuide`): la primera da el estado, el
     sello (`version`), hasta dónde llega la guía y los recuentos; las demás
     se piden cuando sus filas asoman al desplazarse.
   - Programas por teselas de 6 h alineadas en UTC × bloques de 30 filas
     (`iptvGuideProgrammes`). La clave lleva el sello y los canales, así que
     una tesela ya vista no se vuelve a pedir (`staleTime: Infinity`; la guía
     de un sello no cambia nunca). Las que salen de la vista se cancelan solas
     (TanStack Query aborta la petición si nadie la mira).
   - Un 409 `guide_stale` (hay guía nueva) vuelve a pedir `iptvGuide`, y con
     ella todo lo demás con el sello nuevo. El evento `iptv.status` también
     (api/sse.ts). */

import type {
  IptvGuideChannel,
  IptvGuideProgrammesResponse,
  IptvGuideResponse,
  IptvGuideScope,
} from '@ace/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  apiQuery,
  isApiError,
  isDemo,
  routePrefix,
  routeUrl,
  useApiQuery,
} from '../../api/index.ts';
import { PAGE_ROWS, TILE_MS, type TileState } from './model.ts';

const pageQuery = (scope: IptvGuideScope, page: number) => ({
  query: { scope, offset: page * PAGE_ROWS, limit: PAGE_ROWS },
});

export interface GuidePages {
  /** La primera página: estado, sello, recuentos y las primeras filas. */
  head: IptvGuideResponse | undefined;
  loading: boolean;
  error: unknown;
  refetch(): void;
  /** La fila `index`, si su página ya llegó (con el mismo sello que la primera). */
  row(index: number): IptvGuideChannel | undefined;
}

/** Las páginas de canales que hacen falta (`pages`), con la primera siempre. */
export function useGuidePages(
  scope: IptvGuideScope,
  pages: readonly number[],
  enabled: boolean,
): GuidePages {
  const first = useApiQuery('iptvGuide', pageQuery(scope, 0), { enabled });
  const head = first.data;
  const ready = enabled && head?.state === 'ready' && head.total > PAGE_ROWS;
  const rest = useQueries({
    queries: pages
      .filter((page) => page > 0)
      .map((page) => ({ ...apiQuery('iptvGuide', pageQuery(scope, page)), enabled: ready })),
  });
  // Pocas páginas a la vez: se monta en cada render (no merece un useMemo).
  const byPage = new Map<number, readonly IptvGuideChannel[]>();
  if (head) byPage.set(0, head.channels);
  for (const { data } of rest)
    if (data && head && data.version === head.version && data.scope === head.scope)
      byPage.set(Math.floor(data.offset / PAGE_ROWS), data.channels);
  return {
    head,
    loading: first.isPending && enabled,
    error: first.error,
    refetch: () => void first.refetch(),
    row: (index) => byPage.get(Math.floor(index / PAGE_ROWS))?.[index % PAGE_ROWS],
  };
}

export interface TileRequest {
  /** Inicio de la tesela (UTC). */
  tile: number;
  /** Canales de la guía del bloque (sin los que no tienen guía). */
  refs: readonly number[];
}

/** Estado de cada tesela por canal de la guía: `tiles.get(ref)?.get(tile)`. */
export type TilesByRef = ReadonlyMap<number, ReadonlyMap<number, TileState>>;

/**
 * Los programas de las teselas pedidas. Devuelve, por canal de la guía, el
 * estado de cada tesela (las que no se han pedido no están: «cargando»).
 */
export function useGuideTiles(version: string, requests: readonly TileRequest[]): TilesByRef {
  const client = useQueryClient();
  const results = useQueries({
    queries: requests.map((request) => ({
      ...apiQuery('iptvGuideProgrammes', {
        query: {
          v: version,
          ch: request.refs.join(','),
          from: request.tile,
          to: request.tile + TILE_MS,
        },
      }),
      enabled: version !== '' && request.refs.length > 0,
      staleTime: Number.POSITIVE_INFINITY,
      retry: (count: number, error: Error) => count < 2 && (!isApiError(error) || error.retryable),
    })),
  });

  const stale = results.some(
    (result) => isApiError(result.error) && result.error.code === 'guide_stale',
  );
  useEffect(() => {
    if (stale) void client.invalidateQueries({ queryKey: routePrefix('iptvGuide') });
  }, [stale, client]);

  const signature = results.map((result) => `${result.status}:${result.dataUpdatedAt}`).join('|');
  return useMemo(() => {
    const map = new Map<number, Map<number, TileState>>();
    const put = (ref: number, tile: number, state: TileState) => {
      let row = map.get(ref);
      if (!row) map.set(ref, (row = new Map()));
      row.set(tile, state);
    };
    requests.forEach((request, index) => {
      const result = results[index];
      if (!result) return;
      if (result.data) {
        const data: IptvGuideProgrammesResponse = result.data;
        const got = new Set<number>();
        for (const channel of data.channels) {
          got.add(channel.guide);
          put(channel.guide, request.tile, { status: 'ok', programmes: channel.programmes });
        }
        for (const ref of request.refs)
          if (!got.has(ref)) put(ref, request.tile, { status: 'ok', programmes: [] });
        return;
      }
      const state: TileState = result.isError ? { status: 'error' } : { status: 'loading' };
      for (const ref of request.refs) put(ref, request.tile, state);
    });
    return map;
    // `signature` resume el estado de `results` (cambian de identidad en cada render).
  }, [signature, requests]);
}

/** Vuelve a pedir las teselas que fallaron. */
export function retryFailedTiles(client: ReturnType<typeof useQueryClient>): void {
  void client.refetchQueries({
    queryKey: routePrefix('iptvGuideProgrammes'),
    predicate: (query) => query.state.status === 'error',
  });
}

/** La ficha de un programa para «Más info». */
export function useGuideProgramme(id: string | null, version: string, enabled: boolean) {
  return useApiQuery(
    'iptvGuideProgramme',
    { params: { id: id ?? '0.0' }, query: { v: version } },
    { enabled: enabled && id !== null && version !== '', staleTime: Number.POSITIVE_INFINITY },
  );
}

/** El logo de un canal por el proxy propio (`iptvGuideArt`); en la demo no hay. */
export function logoSrc(channel: IptvGuideChannel, version: string): string | null {
  if (!channel.logo || channel.guide === null || !version || isDemo()) return null;
  return routeUrl('iptvGuideArt', { ref: `c${channel.guide}` }, { v: version });
}
