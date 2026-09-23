/* Lo que el armazón cuenta a las vistas sobre dónde se están pintando.

   - useLayout(): tipo de pantalla y si el panel lateral y la columna de
     agenda se ven. Si una vista tiene aside.tsx pero useLayout().asideVisible
     es false (móvil, tableta o panel plegado), ese contenido lo tiene que
     enseñar la propia vista (debajo, o en una hoja).
   - useViewSignal(): una AbortSignal que se aborta cuando la vista se oculta
     o se desmonta («AbortController al cambiar de vista»). Para peticiones
     imperativas; las de useApiQuery ya se cancelan solas.

       const signal = useViewSignal();
       await api('libraryMutate', { body, signal: signal() }); */

import { createContext, use, useEffect, useRef } from 'react';
import type { LayoutKind } from '../lib/media.ts';

export interface LayoutValue {
  kind: LayoutKind;
  /** El panel lateral de la vista se está enseñando. */
  asideVisible: boolean;
  /** La vista tiene panel lateral y la pantalla da para él (aunque esté plegado). */
  asideAvailable: boolean;
  /** Pliega o despliega el panel lateral (el vídeo gana el ancho). */
  setAsideOpen(open: boolean): void;
  /** La columna compacta de la agenda se ve junto al reproductor. */
  columnVisible: boolean;
}

export const LayoutContext = createContext<LayoutValue>({
  kind: 'mobile',
  asideVisible: false,
  asideAvailable: false,
  setAsideOpen: () => {},
  columnVisible: false,
});

export function useLayout(): LayoutValue {
  return use(LayoutContext);
}

/** Señal que se aborta al ocultarse la vista. Devuelve una función: pídela justo antes de usarla. */
export function useViewSignal(): () => AbortSignal {
  const controller = useRef<AbortController>(new AbortController());
  useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort(new DOMException('La vista se ha ocultado', 'AbortError'));
  }, []);
  return () => controller.current.signal;
}
