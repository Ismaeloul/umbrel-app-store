/* El panel lateral de fuentes del reproductor de escritorio (rediseño,
   pantalla 2): la píldora de la fuente que suena lo abre y el centro de
   partido (o de canal) lo pinta, porque es quien conoce las fuentes. */

import { createStore, useStore } from '../lib/store.ts';

const panel = createStore<{ open: boolean }>({ open: false });

export function setSourcePanelOpen(open: boolean): void {
  panel.set((state) => (state.open === open ? state : { open }));
}

export function useSourcePanelOpen(): boolean {
  return useStore(panel, (state) => state.open);
}
