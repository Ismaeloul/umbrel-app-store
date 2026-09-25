/* Hueco del escenario para lo que viene de FUERA del reproductor: la cápsula
   del marcador que el centro de partido pone SOBRE el vídeo, arriba a la
   izquierda (plan Palco fase 2, decisión W5).

   El reproductor es uno y lo monta el armazón; el centro de partido no puede
   pintar dentro de él. Así que la superficie grande publica aquí, mientras
   está en «stage», el nodo de la fila superior de sus controles, y la vista
   proyecta ahí la cápsula con un portal. Fuera del escenario (mini, o sin
   reproductor, como en los tests) vale null y la vista pinta la cápsula en su
   sitio. */

import { createStore, useStore } from '../lib/store.ts';

export const stageSlotStore = createStore<HTMLElement | null>(null);

/** El nodo sobre el vídeo donde proyectar, o null si ahora no hay escenario. */
export function useStageSlot(): HTMLElement | null {
  return useStore(stageSlotStore);
}
