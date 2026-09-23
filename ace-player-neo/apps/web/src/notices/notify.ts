/* Un solo punto para avisar, que decide DÓNDE (regla 7 del inventario):

   - `kind: 'signal'` (lo que le pasa a la señal: reconectando, fuente floja,
     vuelves al directo...) va a la línea de estado bajo el vídeo si se está
     viendo algo; si no, sale como toast normal (igual que la 0.6.59).
   - `kind: 'action'` (por defecto: favorito, copiado, guardado, errores) va
     siempre a toast.

   «Se está viendo algo» lo marca el armazón (setWatching) cuando el
   reproductor está en grande con su línea de estado a la vista. */

import type { IconName } from '../ui/icons.ts';
import type { SignalState } from '../ui/SignalBadge.tsx';
import type { NoticeTone } from '../ui/Toast.tsx';
import { createStore, useStore } from '../lib/store.ts';
import { showStatus } from './statusLine.ts';
import { toast, type ToastAction } from './toasts.ts';

export interface NoticeFlags {
  /** El reproductor está en grande y la línea de estado se ve. */
  watching: boolean;
  /** El vídeo ocupa toda la pantalla (móvil en horizontal o pantalla completa): ningún toast se pinta encima. */
  immersive: boolean;
}

export const noticeFlags = createStore<NoticeFlags>({ watching: false, immersive: false });

export function setWatching(watching: boolean): void {
  noticeFlags.set((f) => (f.watching === watching ? f : { ...f, watching }));
}

export function setImmersive(immersive: boolean): void {
  noticeFlags.set((f) => (f.immersive === immersive ? f : { ...f, immersive }));
}

export function useNoticeFlags(): NoticeFlags {
  return useStore(noticeFlags);
}

export interface NotifyOptions {
  kind?: 'signal' | 'action';
  tone?: NoticeTone;
  icon?: IconName;
  signal?: SignalState;
  /** Dato a la derecha en la línea de estado. */
  meta?: string;
  action?: ToastAction;
  ms?: number;
}

export type NoticeTarget = 'status' | 'toast';

export function notify(text: string, options: NotifyOptions = {}): NoticeTarget {
  const { kind = 'action', tone = 'info', icon, signal, meta, action, ms } = options;
  // Un aviso con botón (Deshacer) necesita el toast: la línea de estado no tiene acciones.
  if (kind === 'signal' && !action && noticeFlags.get().watching) {
    showStatus({ text, tone, icon, signal, meta }, ms);
    return 'status';
  }
  toast(text, { tone, icon, action, ms });
  return 'toast';
}
