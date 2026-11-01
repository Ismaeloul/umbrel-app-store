/* Abrir el buscador desde cualquier sitio (Ctrl K y el campo de la barra de
   cada sección).

   - Desde 768 px (rediseño de escritorio, pantalla 6): la ventana rápida
     encima de todo (features/search/QuickSearch.tsx). Si ya está abierta,
     vuelve a enfocar su campo.
   - En el móvil, como siempre: lleva a la vista Buscar con el campo enfocado.

   El estado (abierta o no) vive aquí, en un almacén mínimo, para que el
   armazón, la barra de cada sección y la propia ventana lo compartan sin
   pasarse props. */

import { createStore, useStore } from '../lib/store.ts';
import { matches, MEDIA } from '../lib/media.ts';
import { requestFocus } from './focus.ts';
import type { Route } from './routes.ts';

const quickSearch = createStore({ open: false, nonce: 0 });

export function openSearch(navigate: (route: Route) => void): void {
  if (matches(MEDIA.tablet)) {
    quickSearch.set((state) => ({ open: true, nonce: state.nonce + 1 }));
    return;
  }
  navigate({ vista: 'buscar' });
  void requestFocus('buscar-motor');
}

export function closeQuickSearch(): void {
  quickSearch.set((state) => (state.open ? { ...state, open: false } : state));
}

/** Abierta y cuántas veces se ha pedido abrir (para volver a enfocar el campo). */
export function useQuickSearch(): { open: boolean; nonce: number } {
  return useStore(quickSearch);
}
