/* «Motor» de la demo (inventario §22): no hay vídeo; a los 1,8 s aparece la
   capa «señal demo» y el controlador reproduce de mentira (isDemo). El canal
   de muestra que «no responde» falla a los 1,8 s para que se vean las
   reconexiones y el paso a otra fuente sin backend. */

import { DEMO_SIGNAL_MS } from '../constants.ts';
import type { Engine, EngineArgs } from './types.ts';

export function createDemoEngine(args: EngineArgs): Engine {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  return {
    kind: 'demo',
    preloads: false,
    start() {
      if (destroyed || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (destroyed) return;
        if (args.demoFails)
          args.callbacks.onFatal('La señal de muestra no responde; buscando una alternativa');
        else args.callbacks.onReady();
      }, DEMO_SIGNAL_MS);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    liveSyncPosition: () => null,
    info: () => ({}),
  };
}
