/* Canal elegido en la biblioteca: lo pinta la ficha del panel lateral de
   escritorio (biblioteca/aside.tsx), que el armazón monta FUERA de la vista.
   Por eso vive en un almacén y no en el estado de la vista.

   Regla de la maqueta A (biblioteca.html): con la ficha a la vista (≥ 1024 px
   y panel abierto), un clic ELIGE el canal y la ficha ofrece «Ver canal»; un
   segundo clic sobre el ya elegido, o el doble clic, lo reproduce. Sin la
   ficha (móvil, tableta o panel plegado), el clic reproduce, como en la
   0.6.59 (inventario §13.2). */

import type { LibraryCollection } from '@ace/shared';
import { createStore, useStore } from '../../lib/store.ts';

export interface SelectedChannel {
  collection: LibraryCollection;
  id: string;
}

export const selectionStore = createStore<SelectedChannel | null>(null);

export function selectChannel(next: SelectedChannel | null): void {
  selectionStore.set((current) =>
    current && next && current.collection === next.collection && current.id === next.id
      ? current
      : next,
  );
}

export function useSelection(): SelectedChannel | null {
  return useStore(selectionStore);
}
