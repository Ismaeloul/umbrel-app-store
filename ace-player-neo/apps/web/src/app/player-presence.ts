/* Lo que el armazón necesita saber del reproductor (y nada más):

   - `active`: hay algo sonando o conectando. Con esto el armazón mantiene el
     reproductor montado al salir del centro de partido (pasa a «mini») y lo
     desmonta al detener.
   - `route`: a dónde vuelve el mini-reproductor al tocarlo.
   - `immersive`: el vídeo ocupa toda la pantalla (pantalla completa o móvil
     en horizontal): se ocultan los toasts y la navegación.

   Lo escribe el reproductor (src/player/) con setPlayerPresence. */

import { createStore, shallowEqual, useStore } from '../lib/store.ts';
import type { Route } from './routes.ts';

export interface PlayerPresence {
  active: boolean;
  route: Route | null;
  immersive: boolean;
}

export const playerPresence = createStore<PlayerPresence>({
  active: false,
  route: null,
  immersive: false,
});

export function setPlayerPresence(patch: Partial<PlayerPresence>): void {
  playerPresence.set((current) => {
    const next = { ...current, ...patch };
    return shallowEqual(current, next) ? current : next;
  });
}

export function usePlayerPresence(): PlayerPresence {
  return useStore(playerPresence);
}
