/* Línea de estado bajo el vídeo (inventario §9):

   - UNA cosa a la vez: un aviso nuevo sustituye al anterior (no hay cola).
   - Un aviso dura 4,5 s y se desvanece en 320 ms.
   - Repetido: «×n» y vuelve a contar.
   - Debajo de los avisos hay un ESTADO BASE que pone el reproductor (la
     maqueta: «Fuente 1 verificada. Vas en directo.» con «6 s de retraso» a
     la derecha). Cuando un aviso se va, vuelve a verse el estado base.
   - Se vacía al salir del centro de partido (lo hace el armazón). */

import type { IconName } from '../ui/icons.ts';
import type { SignalState } from '../ui/SignalBadge.tsx';
import type { NoticeTone } from '../ui/Toast.tsx';
import { createStore } from '../lib/store.ts';
import { FADE_MS } from './toasts.ts';

export const STATUS_MS = 4500;

export interface StatusContent {
  text: string;
  tone?: NoticeTone;
  signal?: SignalState;
  icon?: IconName;
  meta?: string;
}

export interface StatusMessage extends StatusContent {
  id: number;
  count: number;
  leaving: boolean;
}

export interface StatusState {
  /** Aviso pasajero (4,5 s). */
  message: StatusMessage | null;
  /** Estado de fondo del reproductor. */
  base: StatusContent | null;
}

export const statusStore = createStore<StatusState>({ message: null, base: null });

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(ms: number, fn: () => void) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

export function showStatus(content: StatusContent, ms = STATUS_MS): void {
  const current = statusStore.get().message;
  if (
    current &&
    !current.leaving &&
    current.text === content.text &&
    (current.tone ?? 'info') === (content.tone ?? 'info')
  ) {
    statusStore.set((s) => ({
      ...s,
      message: s.message ? { ...s.message, count: s.message.count + 1 } : null,
    }));
  } else {
    statusStore.set((s) => ({
      ...s,
      message: { ...content, id: nextId++, count: 1, leaving: false },
    }));
  }
  schedule(ms, () => {
    const id = statusStore.get().message?.id;
    statusStore.set((s) => ({ ...s, message: s.message ? { ...s.message, leaving: true } : null }));
    schedule(FADE_MS, () => {
      timer = null;
      statusStore.set((s) => (s.message?.id === id ? { ...s, message: null } : s));
    });
  });
}

/** El reproductor fija lo que se ve cuando no hay aviso (o null para nada). */
export function setStatusBase(base: StatusContent | null): void {
  statusStore.set((s) => ({ ...s, base }));
}

export function clearStatus(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  statusStore.set({ message: null, base: null });
}
