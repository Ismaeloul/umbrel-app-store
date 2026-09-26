/* Avisos: toasts (acciones tuyas y errores) y línea de estado bajo el vídeo
   (lo que le pasa a la señal). Para avisar desde una vista, notify(). */

export { notify, setImmersive, setWatching, useNoticeFlags, type NotifyOptions } from './notify.ts';
export {
  clearStatus,
  setStatusBase,
  showStatus,
  STATUS_MS,
  type StatusContent,
} from './statusLine.ts';
export { StatusLineHost } from './StatusLineHost.tsx';
export {
  dismissImmersiveAction,
  immersiveActionStore,
  showImmersiveAction,
  type ImmersiveAction,
} from './immersiveAction.ts';
export { Toaster } from './Toaster.tsx';
export {
  dismissToast,
  toast,
  TOAST_MAX,
  TOAST_MS,
  type ToastAction,
  type ToastOptions,
} from './toasts.ts';
