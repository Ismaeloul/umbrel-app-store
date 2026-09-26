/* Acción sobre el vídeo en inmersivo (móvil en horizontal, pantalla completa o
   modo teatro): ahí no se pinta ningún toast (`data-immersive`), así que lo
   que necesita UN toque («Volver a la IPTV», docs/iptv.md §7.2) va en una
   cápsula tocable encima del vídeo que pinta el reproductor
   (PlayerSurface). Fuera de inmersivo no se ve: para eso está el toast.

   Una sola a la vez; la nueva sustituye a la anterior y caduca sola. */

import { createStore } from '../lib/store.ts';

export interface ImmersiveAction {
  id: number;
  /** Frase corta: «Seguimos por AceStream». */
  text: string;
  /** El botón: «Volver a la IPTV». */
  label: string;
  onAction(): void;
}

export const immersiveActionStore = createStore<ImmersiveAction | null>(null);

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Enseña la cápsula `ms` milisegundos. Pulsarla la quita. Devuelve su id. */
export function showImmersiveAction(action: Omit<ImmersiveAction, 'id'>, ms: number): number {
  const id = nextId++;
  if (timer) clearTimeout(timer);
  immersiveActionStore.set({
    id,
    text: action.text,
    label: action.label,
    onAction: () => {
      dismissImmersiveAction(id);
      action.onAction();
    },
  });
  timer = setTimeout(() => dismissImmersiveAction(id), ms);
  return id;
}

/** Quita la cápsula (solo esa, si se pasa su id). */
export function dismissImmersiveAction(id?: number): void {
  const current = immersiveActionStore.get();
  if (!current || (id !== undefined && current.id !== id)) return;
  if (timer) clearTimeout(timer);
  timer = null;
  immersiveActionStore.set(null);
}
