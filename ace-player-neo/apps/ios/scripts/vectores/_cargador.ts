/* Cargador común de los generadores de TypeScript de la app (generar-vectores.ts y generar-demo.ts;
   b-arquitectura §1.2 y §3.3.2). No es un área: el corredor se salta los ficheros que empiezan por «_».

   - Carga el código DE VERDAD de la web (apps/web/src) con el ejecutor de módulos de Vite (un solo grafo
     de módulos: el registro de la demo es el mismo para todos), que entiende lo que tsx no:
     `import.meta.glob` (los fixtures de la demo), los alias (`@fixtures`) y los `.css` de los componentes
     (aquí vacíos).
   - Calzos de Node para lo que la web espera del navegador: `localStorage` en memoria.
   - Reloj falso: `Date` sustituido por uno que arranca en la hora que se pida y solo avanza cuando el
     generador lo dice (`fijarReloj`, `avanzarReloj`); `Math.random` sembrado con xorshift32.
   - Husos: `TZ=Europe/Madrid` (la web se probó así y las capturas se hacen así). */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.TZ = 'Europe/Madrid';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const IOS = path.resolve(AQUI, '../..');
export const WEB = path.resolve(IOS, '../web');
export const SHARED = path.resolve(IOS, '../../packages/shared');
export const VECTORES = path.join(IOS, 'Tests/AceNeoTests/Vectores');

// ---- Reloj falso ----------------------------------------------------------------------------------

const DateReal = Date;
let ahoraFalso: number | null = null;

class DateFalso extends DateReal {
  constructor(...args: unknown[]) {
    if (args.length === 0 && ahoraFalso !== null) super(ahoraFalso);
    else super(...(args as ConstructorParameters<typeof DateReal>));
  }

  static override now(): number {
    return ahoraFalso ?? DateReal.now();
  }
}

/** Fija el reloj en ese instante (ms epoch) hasta que se vuelva a fijar o se avance. */
export function fijarReloj(ms: number): void {
  ahoraFalso = ms;
  globalThis.Date = DateFalso as DateConstructor;
}

export function avanzarReloj(ms: number): void {
  if (ahoraFalso === null) throw new Error('El reloj falso no está fijado');
  ahoraFalso += ms;
}

export function ahora(): number {
  return ahoraFalso ?? DateReal.now();
}

// ---- Math.random sembrado (xorshift32) -----------------------------------------------------------

let semilla = 1;

/** El mismo generador que `AleatorioDemo` de la app: xorshift32 → [0, 1). */
export function sembrarAzar(valor = 1): void {
  semilla = valor >>> 0 || 1;
  Math.random = () => {
    semilla ^= semilla << 13;
    semilla >>>= 0;
    semilla ^= semilla >>> 17;
    semilla ^= semilla << 5;
    semilla >>>= 0;
    return semilla / 2 ** 32;
  };
}

// ---- localStorage en memoria ---------------------------------------------------------------------

const almacen = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, String(v)),
  removeItem: (k: string) => void almacen.delete(k),
  clear: () => almacen.clear(),
  key: (i: number) => [...almacen.keys()][i] ?? null,
  get length() {
    return almacen.size;
  },
};

export function vaciarAlmacen(): void {
  almacen.clear();
}

// ---- Módulos de la web con el ejecutor de Vite ---------------------------------------------------

interface Ejecutor {
  import(id: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

let ejecutor: { runner: Ejecutor; server: { close(): Promise<void> } } | null = null;

async function preparar() {
  if (ejecutor) return ejecutor;
  const requerir = createRequire(path.join(WEB, 'package.json'));
  const vite = (await import(pathToFileURL(requerir.resolve('vite')).href)) as {
    createServer(config: object): Promise<{ environments: { ssr: unknown }; close(): Promise<void> }>;
    createServerModuleRunner(env: unknown, options?: object): Ejecutor;
  };
  // El módulo virtual `virtual:ace-routes` (tabla de rutas sin zod) es un plugin de la web.
  const { aceRoutes } = (await import(pathToFileURL(path.join(WEB, 'build/plugins.ts')).href)) as {
    aceRoutes(o: { sharedDir: string }): object;
  };
  const server = await vite.createServer({
    configFile: false,
    root: WEB,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: { '@fixtures': path.join(SHARED, 'fixtures') } },
    plugins: [
      aceRoutes({ sharedDir: SHARED }),
      {
        name: 'css-vacio',
        enforce: 'pre',
        resolveId: (id: string) => (id.endsWith('.css') ? '\0css-vacio' : null),
        load: (id: string) => (id === '\0css-vacio' ? 'export default {}' : null),
      },
    ],
  });
  const runner = vite.createServerModuleRunner(server.environments.ssr, { hmr: false });
  ejecutor = { runner, server };
  return ejecutor;
}

/** Un módulo de apps/web/src (ruta relativa a src, con extensión). */
export async function web<T = Record<string, unknown>>(relativa: string): Promise<T> {
  const { runner } = await preparar();
  return (await runner.import(path.join(WEB, 'src', relativa))) as T;
}

export async function cerrar(): Promise<void> {
  if (!ejecutor) return;
  await ejecutor.runner.close();
  await ejecutor.server.close();
  ejecutor = null;
}

// ---- Escritura y --check -------------------------------------------------------------------------

/** JSON con dos espacios y salto final (como los vectores de siempre). */
export function json(valor: unknown): string {
  return `${JSON.stringify(valor, null, 2)}\n`;
}
