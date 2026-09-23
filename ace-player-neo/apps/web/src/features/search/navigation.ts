/* Saltar al buscador del motor con un texto ya escrito (inventario §13.1:
   «Buscar «{q}» en el motor AceStream» desde cualquier pestaña de la
   biblioteca). El texto viaja en la URL (`?vista=buscar&q=…`), así que también
   sirve de enlace directo; el buscador lo lee con useSearchParam('q') y lanza
   la búsqueda al momento, sin la espera de 450 ms. */

import type { Navigate } from '../../app/router.tsx';

export const SEARCH_PARAM = 'q';

export function goToEngineSearch(navigate: Navigate, query: string): void {
  const q = query.trim();
  try {
    const params = new URLSearchParams(location.search);
    if (q) params.set(SEARCH_PARAM, q);
    else params.delete(SEARCH_PARAM);
    const search = params.toString().replace(/%2F/gi, '/');
    history.replaceState(history.state, '', `${location.pathname}${search ? `?${search}` : ''}`);
  } catch {}
  navigate({ vista: 'buscar' });
}
