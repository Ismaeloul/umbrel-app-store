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
import { aceRoutes, fontPreload, gzipAssets, viewPreload } from './build/plugins.ts';

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.resolve(WEB_DIR, '../../packages/shared');

const env = loadEnv(
  process.env.NODE_ENV === 'production' ? 'production' : 'development',
  WEB_DIR,
  '',
);
const BACKEND = env.VITE_BACKEND || 'http://[::1]:3000';
/* En producción nginx manda /ace/ y /content/ directos al motor (deploy/umbrel/
   nginx.conf). Con VITE_ENGINE (p. ej. http://127.0.0.9:6878, el motor falso)
   el proxy hace lo mismo; sin él, todo va al backend como antes. */
const ENGINE = env.VITE_ENGINE || BACKEND;
const ENGINE_PREFIXES = new Set(['/ace', '/content']);

/** Todo lo que el backend (o nginx en producción) sirve y Vite no debe tocar. */
const PROXIED = ['/api', '/ace', '/content', '/remux', '/native'];
const targetFor = (prefix: string): string => (ENGINE_PREFIXES.has(prefix) ? ENGINE : BACKEND);

/* Módulos de @ace/shared: esquemas y funciones puras sin efectos al cargarse.
   Declararlo deja al empaquetador quitar lo que la web no usa (por ejemplo,
   el contrato de las rutas antiguas en api/legacy.ts). */
const SHARED_SRC = '/packages/shared/src/';

export default defineConfig({
  root: WEB_DIR,
  base: '/',
  plugins: [
    react(),
    aceRoutes({ sharedDir: SHARED_DIR }),
    fontPreload(),
    viewPreload(),
    gzipAssets(),
  ],
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
          target: targetFor(prefix),
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
      PROXIED.map((prefix) => [prefix, { target: targetFor(prefix), changeOrigin: false }]),
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
              priority: 30,
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler|@tanstack[\\/]query-core|@tanstack[\\/]react-query)[\\/]/,
            },
            // La base de la web en UN trozo: armazón (src/app, sin la página de
            // sistema), componentes (src/ui), utilidades (src/lib), avisos
            // (src/notices) y el cliente de la API (src/api, sin la demo). Sin
            // este grupo rolldown los partía en ~25 trozos de 0,1-2 KB y cada
            // vista pedía 15-30 ficheros; por HTTP/1.1 (el Umbrel sirve la web
            // sin TLS: sin HTTP/2) son 6 conexiones y cada ronda cuesta un RTT
            // (150 ms en el 4G de Lighthouse). El JS inicial crece unos KB y
            // cada vista baja muchos menos ficheros (revisión de rendimiento de
            // la Fase 2, docs/rendimiento.md). @ace/shared NO entra: algunos de
            // sus módulos arrastran zod.
            {
              name: 'base',
              priority: 20,
              test: /[\\/]apps[\\/]web[\\/]src[\\/](?:ui|lib|notices|app(?![\\/]sistema[\\/])|api(?![\\/]demo[\\/]))[\\/]/,
            },
            // Las vistas, por familias (las que se importan entre sí), en vez de
            // un trozo de 0,3-2 KB por componente compartido:
            // - agenda: la agenda, su columna y las preferencias;
            // - canales: biblioteca, búsqueda y pegar hash;
            // - fuentes: las fuentes y el centro de partido (usan la biblioteca,
            //   pero la biblioteca y la búsqueda no las necesitan: ~18 KB gzip
            //   menos al abrirlas);
            // - ajustes: ajustes, dispositivos y salud (la ayuda «?» no: se abre
            //   desde cualquier vista y bajaría la familia entera).
            // El reproductor (src/player) va aparte: solo al reproducir.
            //
            // Lo que comparten dos familias va en su propio trozo, para que una
            // vista no baje la familia entera de la otra (revisión de
            // rendimiento de la Fase 2: la biblioteca y la búsqueda bajaban la
            // agenda entera por score-reveal y domain, y Ajustes bajaba canales
            // y agenda por las listas y VirtualList: ~70 KB gzip de más antes
            // del LCP en el 4G de Lighthouse):
            // - comun: lo de @ace/shared que no está ya en la base (si no, se lo
            //   quedaba el primer grupo que lo importara y las demás familias
            //   bajaban ese grupo entero);
            // - mando: la API del reproductor (estado, modo de reproducción,
            //   copiar hash, datos técnicos) que usan canales y Ajustes sin
            //   necesitar el reproductor;
            // - virtual: @tanstack/react-virtual y la lista virtual (agenda,
            //   biblioteca, búsqueda y el registro de Salud);
            // - partidos: el dominio de la agenda que usan canales y fuentes (y
            //   el registro de su demo, que importan la biblioteca y el partido);
            // - listas: las listas M3U (Ajustes y la biblioteca) y el «pulsa otra
            //   vez para confirmar» que usan las dos.
            {
              name: 'comun',
              priority: 16,
              test: /[\\/]packages[\\/]shared[\\/]src[\\/]/,
            },
            {
              name: 'mando',
              priority: 15,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]player[\\/](?:api|clipboard|NerdPanel)\.tsx?$/,
            },
            {
              name: 'virtual',
              priority: 15,
              test: /(?:[\\/]apps[\\/]web[\\/]src[\\/]features[\\/]library[\\/]VirtualList\.tsx$)|(?:[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@tanstack[\\/](?:react-virtual|virtual-core)[\\/])/,
            },
            {
              name: 'partidos',
              priority: 14,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/]agenda[\\/](?:domain|data|score-reveal|state|MatchRow|demo)\.tsx?$/,
            },
            {
              name: 'listas',
              priority: 14,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/](?:directories[\\/]|settings[\\/]second-tap\.ts$)/,
            },
            {
              name: 'agenda',
              priority: 12,
              // Sin demo-data.ts: son los datos de la demo, que demo.ts pide con import().
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/](?:agenda[\\/](?!demo-data\.ts$)|preferences[\\/])/,
            },
            {
              name: 'fuentes',
              // Después de canales: si fuera antes, se quedaría con lo de la biblioteca que usa.
              priority: 10,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/](?:sources|match-center|partido)[\\/]/,
            },
            {
              name: 'canales',
              priority: 11,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/](?:library|biblioteca|search|buscar|paste-hash)[\\/]/,
            },
            {
              name: 'ajustes',
              priority: 10,
              test: /[\\/]apps[\\/]web[\\/]src[\\/]features[\\/](?:settings|ajustes|devices|health)[\\/]/,
            },
            // Los motores de vídeo, cada uno en su trozo: solo los pide el
            // reproductor con import() al abrirse (arquitectura §9).
            {
              name: 'hls',
              priority: 30,
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?hls\.js[\\/]/,
            },
            {
              name: 'mpegts',
              priority: 30,
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?mpegts\.js[\\/]/,
            },
          ],
        },
      },
    },
  },
});
