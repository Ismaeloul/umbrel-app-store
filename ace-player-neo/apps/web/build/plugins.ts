/* Plugins de Vite propios de la web. Corren en Node (build, servidor de
   desarrollo y Vitest), nunca en el navegador.

   - aceRoutes: módulo virtual `virtual:ace-routes` con la tabla de rutas v1
     SIN los esquemas zod (solo método, ruta, tipo de contenido y si tiene
     efectos). El cliente de la API la usa en producción; así zod y los ~40
     esquemas no entran en el JS inicial (presupuesto §2.1). En desarrollo y en
     los tests el cliente importa además V1_ROUTES entero para validar las
     respuestas con zod.
     @ace/shared es TypeScript con imports `./x.js`, que Node no resuelve por
     sí solo: se carga con tsImport de tsx (ya está en la raíz del monorepo).
   - fontPreload: mete en index.html la precarga de la fuente principal con el
     nombre con hash que acaba de salir del build (en index.html no se puede
     escribir a mano porque el hash cambia en cada release).
   - gzipAssets: deja un `.gz` junto a cada asset comprimible. nginx los sirve
     con `gzip_static on` (deploy/umbrel/nginx.conf, location /assets/) y el
     N300 no tiene que comprimir en cada petición. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';
import type { Plugin } from 'vite';

const VIRTUAL_ROUTES = 'virtual:ace-routes';
const RESOLVED_ROUTES = `\0${VIRTUAL_ROUTES}`;

interface RouteDefinitionLike {
  method: string;
  path: string;
  content: string;
  sideEffects: boolean;
}

/** Tabla ligera a partir de V1_ROUTES: lo que el cliente necesita para montar la petición. */
export function lightRouteTable(
  routes: Record<string, RouteDefinitionLike>,
): Record<string, RouteDefinitionLike> {
  const table: Record<string, RouteDefinitionLike> = {};
  for (const [id, route] of Object.entries(routes)) {
    table[id] = {
      method: route.method,
      path: route.path,
      content: route.content,
      sideEffects: route.sideEffects,
    };
  }
  return table;
}

/** Lee V1_ROUTES de packages/shared/src/routes.ts (sin caché: cada llamada ve el fichero de ahora). */
export async function loadSharedRoutes(
  sharedDir: string,
): Promise<Record<string, RouteDefinitionLike>> {
  const file = pathToFileURL(path.join(sharedDir, 'src', 'routes.ts'));
  file.searchParams.set('t', String(Date.now()));
  const mod = (await tsImport(file.href, import.meta.url)) as {
    V1_ROUTES?: Record<string, RouteDefinitionLike>;
  };
  if (!mod.V1_ROUTES) throw new Error('packages/shared/src/routes.ts no exporta V1_ROUTES');
  return mod.V1_ROUTES;
}

export function aceRoutes(options: { sharedDir: string }): Plugin {
  const routesFile = path.resolve(options.sharedDir, 'src', 'routes.ts');
  return {
    name: 'ace-routes',
    resolveId(id) {
      return id === VIRTUAL_ROUTES ? RESOLVED_ROUTES : null;
    },
    async load(id) {
      if (id !== RESOLVED_ROUTES) return null;
      // Vite vuelve a pedir el módulo si routes.ts cambia (addWatchFile).
      this.addWatchFile(routesFile);
      const table = lightRouteTable(await loadSharedRoutes(options.sharedDir));
      return `export const ROUTES = Object.freeze(${JSON.stringify(table)});\n`;
    },
    configureServer(server) {
      // Otro agente puede cambiar routes.ts con el servidor abierto: se
      // invalida el módulo virtual para no servir una tabla vieja.
      server.watcher.add(routesFile);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== routesFile) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ROUTES);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

/** Fichero de la fuente principal (Mona Sans, subconjunto latino, ejes wdth + wght). */
export const MAIN_FONT_FILE = 'mona-sans-latin-wdth-normal';

export function fontPreload(): Plugin {
  return {
    name: 'ace-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const font = Object.values(bundle).find(
          (item) =>
            item.type === 'asset' &&
            item.fileName.endsWith('.woff2') &&
            path.basename(item.fileName).startsWith(MAIN_FONT_FILE),
        );
        if (!font) {
          console.warn('[ace-font-preload] No se encontró la fuente principal para precargarla.');
          return [];
        }
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `/${font.fileName}`,
              crossorigin: '',
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/** Lo que necesita de un trozo del build viewPreload (subconjunto de OutputChunk). */
export interface ChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  moduleIds?: readonly string[];
  imports?: readonly string[];
  viteMetadata?: { importedCss?: Set<string> };
}

const VIEW_MODULE = /[\\/]src[\\/](?:features[\\/]([\w-]+)[\\/]index|player[\\/]index)\.tsx$/;

/**
 * Para cada vista (carpeta de src/features con index.tsx), los ficheros que
 * baja al abrirse y que NO están ya en el JS inicial: su trozo, sus imports
 * estáticos y su CSS. «partido» lleva además el reproductor.
 */
export function viewPreloadMap(bundle: Record<string, ChunkLike>): Record<string, string[]> {
  const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const closure = (start: string, into = new Set<string>()) => {
    if (into.has(start)) return into;
    into.add(start);
    for (const next of byFile.get(start)?.imports ?? []) closure(next, into);
    return into;
  };
  const initial = new Set<string>();
  for (const chunk of chunks) if (chunk.isEntry) closure(chunk.fileName, initial);
  const views = new Map<string, string>();
  let player: string | null = null;
  for (const chunk of chunks) {
    for (const id of [chunk.facadeModuleId ?? '', ...(chunk.moduleIds ?? [])]) {
      const match = VIEW_MODULE.exec(id);
      if (!match) continue;
      if (match[1]) views.set(match[1], chunk.fileName);
      else player = chunk.fileName;
    }
  }
  const filesFor = (roots: string[]) => {
    const js = new Set<string>();
    for (const root of roots) closure(root, js);
    const out: string[] = [];
    for (const file of js) {
      if (initial.has(file)) continue;
      out.push(`/${file}`);
      for (const css of byFile.get(file)?.viteMetadata?.importedCss ?? []) out.push(`/${css}`);
    }
    return [...new Set(out)];
  };
  const map: Record<string, string[]> = {};
  for (const [view, file] of views) {
    map[view] = filesFor(view === 'partido' && player ? [file, player] : [file]);
  }
  return map;
}

/**
 * Precarga en index.html lo que va a pedir la vista de la URL (?vista=…; sin
 * ella, la agenda) EN PARALELO con el JS inicial. Sin esto el trozo de la
 * vista se descubría cuando React ya había pintado el armazón: una ida y
 * vuelta más antes del contenido (revisión de rendimiento de la Fase 2). Los
 * nombres llevan hash, así que el mapa se escribe en cada build.
 */
export function viewPreload(): Plugin {
  return {
    name: 'ace-view-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        const map = viewPreloadMap(ctx.bundle as unknown as Record<string, ChunkLike>);
        if (Object.keys(map).length === 0) return [];
        const code = `(function(m){try{var v=(new URLSearchParams(location.search).get('vista')||'agenda').split('/')[0].toLowerCase();var f=m[v];if(!f)return;for(var i=0;i<f.length;i++){var l=document.createElement('link');if(/\\.css$/.test(f[i])){l.rel='preload';l.as='style'}else{l.rel='modulepreload'}l.crossOrigin='';l.href=f[i];document.head.appendChild(l)}}catch(e){}})(${JSON.stringify(map)});`;
        return [{ tag: 'script', children: code, injectTo: 'head' }];
      },
    },
  };
}

const COMPRESSIBLE = /\.(js|mjs|css|svg|json|webmanifest|txt)$/i;

export function gzipAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'ace-gzip-assets',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.startsWith('assets/') || !COMPRESSIBLE.test(fileName)) continue;
        const full = path.join(outDir, fileName);
        const source = readFileSync(full);
        // Nivel máximo: se comprime una vez en el build y se sirve miles de veces.
        const gz = gzipSync(source, { level: zlibConstants.Z_BEST_COMPRESSION });
        writeFileSync(`${full}.gz`, gz);
      }
    },
  };
}
