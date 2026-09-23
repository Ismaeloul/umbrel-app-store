/* Cola de toasts (inventario §10.1 y reglas 6-7 de §26):

   - Solo acciones tuyas y errores que piden atención. Lo que le pasa a la
     señal va en la línea de estado (statusLine.ts; notify() decide).
   - Duran 2,8 s (o lo que se pida: el «Deshacer» de borrar dura 6 s).
   - NUNCA más de 2 a la vez: el más viejo cede el sitio.
   - Un mensaje repetido no se apila: renueva su tiempo y enseña «×n».
   - Con acción (Deshacer), pulsarla cierra el toast.
   - Salen con un fundido de 320 ms antes de desaparecer. */

import type { IconName } from '../ui/icons.ts';
import type { NoticeTone } from '../ui/Toast.tsx';
import { createStore } from '../lib/store.ts';

export const TOAST_MS = 2800;
export const TOAST_MAX = 2;
export const FADE_MS = 320;

export interface ToastAction {
  label: string;
  onAction(): void;
}

export interface ToastItem {
  id: number;
  /** Tono + texto: dos avisos iguales se agrupan. */
  key: string;
  text: string;
  tone: NoticeTone;
  icon?: IconName;
  action?: ToastAction;
  count: number;
  leaving: boolean;
}

export interface ToastOptions {
  tone?: NoticeTone;
  icon?: IconName;
  action?: ToastAction;
  /** Duración en ms (por defecto 2,8 s). */
  ms?: number;
}

export const toastStore = createStore<readonly ToastItem[]>([]);

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function schedule(id: number, ms: number, fn: () => void) {
  clearTimer(id);
  timers.set(id, setTimeout(fn, ms));
}

/** Empieza el fundido de salida y lo quita al terminar. */
export function dismissToast(id: number): void {
  const item = toastStore.get().find((t) => t.id === id);
  if (!item || item.leaving) return;
  toastStore.set((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  schedule(id, FADE_MS, () => {
    timers.delete(id);
    toastStore.set((list) => list.filter((t) => t.id !== id));
  });
}

export function toast(
  text: string,
  { tone = 'info', icon, action, ms = TOAST_MS }: ToastOptions = {},
): number {
  const key = `${tone}|${text}`;
  const existing = toastStore.get().find((t) => t.key === key && !t.leaving);
  if (existing) {
    // Repetido: ×n y vuelve a contar el tiempo.
    toastStore.set((list) =>
      list.map((t) =>
        t.id === existing.id ? { ...t, count: t.count + 1, action: action ?? t.action } : t,
      ),
    );
    schedule(existing.id, ms, () => dismissToast(existing.id));
    return existing.id;
  }
  const id = nextId++;
  const visible = toastStore.get().filter((t) => !t.leaving);
  // Máximo 2: el más viejo cede su sitio.
  for (const old of visible.slice(0, Math.max(0, visible.length - (TOAST_MAX - 1))))
    dismissToast(old.id);
  const wrapped = action
    ? {
        label: action.label,
        onAction: () => {
          dismissToast(id);
          action.onAction();
        },
      }
    : undefined;
  toastStore.set((list) => [
    ...list,
    { id, key, text, tone, icon, action: wrapped, count: 1, leaving: false },
  ]);
  schedule(id, ms, () => dismissToast(id));
  return id;
}

/** Solo para los tests. */
export function resetToasts(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  toastStore.set([]);
}
