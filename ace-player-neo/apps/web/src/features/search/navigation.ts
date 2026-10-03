/* Saltar al buscador del motor con un texto ya escrito (inventario §13.1:
   «Buscar «{q}» en el motor AceStream» desde cualquier pestaña de la
   biblioteca). El texto viaja en la URL (`?vista=buscar&q=…`), así que también
   sirve de enlace directo; el buscador lo lee con useSearchParam('q') y lanza
   la búsqueda al momento, sin la espera de 450 ms.

   `q` es de Buscar (VISTA_PARAMS en app/routes.ts): se deja preparado para
   Buscar y el router lo pone en la URL al llegar, sin pasar por la de Canales. */

import { rememberViewParam, type Navigate } from '../../app/router.tsx';

export const SEARCH_PARAM = 'q';

export function goToEngineSearch(navigate: Navigate, query: string): void {
  rememberViewParam('buscar', SEARCH_PARAM, query.trim() || null);
  navigate({ vista: 'buscar' });
}
