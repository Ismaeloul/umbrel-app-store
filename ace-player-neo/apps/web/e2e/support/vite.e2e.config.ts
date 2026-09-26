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
    /* Todas las dependencias de la web, optimizadas al arrancar y sin
       descubrir ninguna después: cuando Vite descubría una a mitad de la
       batería (hls.js al unirse a una sesión compartida o con la IPTV,
       @tanstack/react-virtual al abrir Canales, o lo que tardaba en rastrear
       en la primera carga) recargaba todas las páginas abiertas. Si la web
       gana una dependencia de npm, va aquí. */
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@tanstack/react-query',
        '@tanstack/react-virtual',
        'hls.js',
        'mpegts.js',
        '@ace/shared > zod',
      ],
    },
  }),
);
