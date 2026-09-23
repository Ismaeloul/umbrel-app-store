/* Vite de la web de Ace Player Neo v2.

   - Desarrollo: proxy de /api, /ace, /content, /remux y /native al backend
     local (VITE_BACKEND, por defecto http://[::1]:3000). Se usa ::1 y no
     127.0.0.1 porque en el PC de Isma el filtro de red corta ~1 de cada 6
     conexiones a 127.0.0.1 (docs/pendiente.md). No se cambia el Host: la regla
     anti-CSRF del backend compara Origin con Host (apps/server/src/core/csrf.ts).
   - Build: dist/ con assets con hash (nginx los cachea para siempre), mapas de
     fuente aparte y sin enlazar (`hidden`: no los descarga el navegador),
     hls.js y mpegts.js en trozos propios que solo se piden al abrir el
     reproductor, y un .gz junto a cada asset para `gzip_static`.
   - El presupuesto de JS inicial (150 KB gzip) lo vigila `pnpm size`
     (scripts/size.mjs), no el aviso de tamaño de Vite, que mira trozos
     sueltos. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { aceRoutes, fontPreload, gzipAssets } from './build/plugins.ts';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.resolve(WEB_DIR, '../../packages/shared');

const env = loadEnv(
  process.env.NODE_ENV === 'production' ? 'production' : 'development',
  WEB_DIR,
  '',
);
const BACKEND = env.VITE_BACKEND || 'http://[::1]:3000';

/** Todo lo que el backend (o nginx en producción) sirve y Vite no debe tocar. */
const PROXIED = ['/api', '/ace', '/content', '/remux', '/native'];

/* Módulos de @ace/shared: esquemas y funciones puras sin efectos al cargarse.
   Declararlo deja al empaquetador quitar lo que la web no usa (por ejemplo,
   el contrato de las rutas antiguas en api/legacy.ts). */
const SHARED_SRC = '/packages/shared/src/';

export default defineConfig({
  root: WEB_DIR,
  base: '/',
  plugins: [react(), aceRoutes({ sharedDir: SHARED_DIR }), fontPreload(), gzipAssets()],
  resolve: {
    alias: {
      // Ejemplos de cada respuesta de la API: los usa el modo demo y los tests.
      '@fixtures': path.join(SHARED_DIR, 'fixtures'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: Object.fromEntries(
      PROXIED.map((prefix) => [
        prefix,
        {
          target: BACKEND,
          changeOrigin: false,
          // El vídeo y el SSE son flujos largos: sin límite de tiempo en el proxy.
          timeout: 0,
          proxyTimeout: 0,
        },
      ]),
    ),
    fs: {
      // Los ejemplos viven en packages/shared/fixtures, fuera de apps/web, y
      // pnpm deja los paquetes (las fuentes) en el node_modules de la raíz.
      allow: [WEB_DIR, SHARED_DIR, path.resolve(WEB_DIR, '../../node_modules')],
    },
  },
  preview: {
    port: 4173,
    proxy: Object.fromEntries(
      PROXIED.map((prefix) => [prefix, { target: BACKEND, changeOrigin: false }]),
    ),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: 'hidden',
    cssCodeSplit: true,
    // Aviso por trozo suelto (en KB sin comprimir): hls.js ronda los 500 KB y
    // es diferido a propósito, así que el umbral solo salta con algo raro.
    chunkSizeWarningLimit: 600,
    // Solo la fuente principal va precargada; los iconos y el resto, por URL.
    assetsInlineLimit: 0,
    rolldownOptions: {
      treeshake: {
        // Los ids pueden venir con \ en Windows: se normalizan antes de comparar.
        moduleSideEffects: (id: string) => !id.replaceAll('\\', '/').includes(SHARED_SRC),
        // Construir un esquema zod (`z.strictObject(...)`, `z.string().regex(...)`)
        // no tiene efectos: si nadie usa el esquema, se puede quitar. Sin esto,
        // importar `errorMessage` de @ace/shared arrastraba zod entero (~40 KB
        // gzip) por los dos esquemas de errors.ts que la web no usa.
        manualPureFunctions: ['z'],
      },
      output: {
        // Nombres con hash del contenido: nginx los sirve con immutable.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        codeSplitting: {
          groups: [
            // React y TanStack Query en un trozo propio («vendor»): van en el
            // JS inicial igualmente, pero casi nunca cambian entre releases, así
            // que su hash se mantiene y el navegador y el service worker no los
            // vuelven a bajar cuando solo cambia una vista. Sin este grupo
            // rolldown los mezclaba con componentes de src/ui en un trozo con
            // nombre de componente («Button-…js»). @tanstack/react-virtual NO
            // entra: solo lo usan las vistas con listas largas (diferidas).
            {
              name: 'vendor',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler|@tanstack[\\/]query-core|@tanstack[\\/]react-query)[\\/]/,
            },
            // Los motores de vídeo, cada uno en su trozo: solo los pide el
            // reproductor con import() al abrirse (arquitectura §9).
            {
              name: 'hls',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?hls\.js[\\/]/,
            },
            {
              name: 'mpegts',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?mpegts\.js[\\/]/,
            },
          ],
        },
      },
    },
  },
});
