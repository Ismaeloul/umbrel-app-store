/* Vite de las pruebas E2E: la configuración de siempre (vite.config.ts) sin
   HMR ni vigilancia de ficheros. Otros agentes editan apps/web a la vez que
   corre la batería, y cada guardado recargaba las páginas de las pruebas a
   mitad de un recorrido (visto el 23-09-2026: el reproductor desaparecía en
   mitad de una reconexión). Así, lo que se sirve es la foto del código al
   arrancar la pila. */

import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';

export default mergeConfig(
  base,
  defineConfig({
    server: {
      hmr: false,
      watch: null,
    },
  }),
);
