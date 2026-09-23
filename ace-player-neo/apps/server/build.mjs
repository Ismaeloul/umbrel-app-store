// Empaqueta el backend (y engine-control) en un solo fichero CommonJS cada uno.
//
// Por qué así (arquitectura §11.1, D3): en el NAS el backend se sigue
// ejecutando con la imagen oficial de Node fijada por digest y la release
// montada en solo lectura, sin node_modules. Todo lo que el servidor necesita
// tiene que ir dentro de server.js. CommonJS y no ESM: el comando de Compose de
// siempre ejecuta server.js y en CommonJS los require dinámicos de las
// dependencias funcionan sin el parche de createRequire.
//
// Uso:
//   node build.mjs [--outdir <dir>] [--version <x.y.z>] [--sourcemap]
//                  [--server-entry <fichero>] [--engine-entry <fichero>]
//
// La versión sale por defecto del package.json de la raíz del monorepo y llega
// al código como la constante global __APP_VERSION__ (define de esbuild).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MONOREPO_DIR = path.resolve(SERVER_DIR, '..', '..');
export const DEFAULT_SERVER_ENTRY = path.join(SERVER_DIR, 'src', 'main.ts');
export const DEFAULT_ENGINE_ENTRY = path.join(SERVER_DIR, 'src', 'engine-control', 'main.ts');

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Versión del monorepo (package.json de la raíz): la misma que el manifiesto de Umbrel. */
export function readMonorepoVersion() {
  const pkg = JSON.parse(readFileSync(path.join(MONOREPO_DIR, 'package.json'), 'utf8'));
  return String(pkg.version ?? '');
}

/**
 * Cabecera de cada bundle. "use strict" conserva la semántica de módulo del
 * código TypeScript (en CommonJS no viene de serie). import.meta no existe en
 * CommonJS: si alguna dependencia solo ESM lo usa, recibe el equivalente
 * calculado desde __filename en vez de un objeto vacío.
 * @param {string} name
 * @param {string} version
 */
function banner(name, version) {
  return [
    `// Ace Player Neo ${version} · ${name}`,
    '// Generado por ace-player-neo/apps/server/build.mjs (esbuild). No se edita a mano.',
    '"use strict";',
    'var __ace_import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  ].join('\n');
}

/**
 * @param {{ entry: string, outfile: string, name: string, version: string, sourcemap: boolean }} options
 */
async function bundle({ entry, outfile, name, version, sourcemap }) {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    // Sin minificar: las trazas del log del NAS tienen que poder leerse.
    minify: false,
    charset: 'utf8',
    sourcemap: sourcemap ? 'linked' : false,
    // Rutas de los comentarios del bundle relativas a apps/server: el mismo
    // código da los mismos bytes en este PC, en CI y en cualquier carpeta.
    absWorkingDir: SERVER_DIR,
    // Un punto de entrada fuera de apps/server (los tests usan uno mínimo en
    // una carpeta temporal) resuelve igualmente fastify, pino, zod…
    nodePaths: [path.join(SERVER_DIR, 'node_modules'), path.join(MONOREPO_DIR, 'node_modules')],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      'import.meta.url': '__ace_import_meta_url',
      'import.meta.dirname': '__dirname',
      'import.meta.filename': '__filename',
    },
    banner: { js: banner(name, version) },
    logLevel: 'silent',
  });
  return result.warnings.map((warning) => `${name}: ${warning.text}`);
}

/**
 * Compila server.js y, si ya existe su fuente, engine-control.js.
 * @param {{ outdir: string, version?: string, sourcemap?: boolean, serverEntry?: string, engineEntry?: string, log?: (line: string) => void }} options
 * @returns {Promise<{ version: string, files: string[], skipped: string[], warnings: string[] }>}
 */
export async function buildServer(options) {
  const version = options.version ?? readMonorepoVersion();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Versión no válida: "${version}" (se espera X.Y.Z)`);
  }
  const log = options.log ?? ((line) => console.log(line));
  const outdir = path.resolve(options.outdir);
  const serverEntry = path.resolve(options.serverEntry ?? DEFAULT_SERVER_ENTRY);
  const engineEntry = path.resolve(options.engineEntry ?? DEFAULT_ENGINE_ENTRY);
  const sourcemap = options.sourcemap ?? false;
  mkdirSync(outdir, { recursive: true });

  if (!existsSync(serverEntry)) {
    throw new Error(`No existe el punto de entrada del servidor: ${serverEntry}`);
  }

  const files = [];
  const skipped = [];
  const warnings = [];

  const serverFile = path.join(outdir, 'server.js');
  warnings.push(
    ...(await bundle({
      entry: serverEntry,
      outfile: serverFile,
      name: 'server.js',
      version,
      sourcemap,
    })),
  );
  files.push(serverFile);
  log(`server.js ${version} → ${serverFile}`);

  // engine-control lo escribe otro módulo (E1.8). Mientras no exista, la
  // release sale sin él y el hook la dará por incompleta: se avisa, no se falla.
  if (existsSync(engineEntry)) {
    const engineFile = path.join(outdir, 'engine-control.js');
    warnings.push(
      ...(await bundle({
        entry: engineEntry,
        outfile: engineFile,
        name: 'engine-control.js',
        version,
        sourcemap,
      })),
    );
    files.push(engineFile);
    log(`engine-control.js ${version} → ${engineFile}`);
  } else {
    skipped.push('engine-control.js');
    log(
      `AVISO: no existe ${path.relative(MONOREPO_DIR, engineEntry)}; engine-control.js no se genera ` +
        '(la release quedará incompleta hasta que exista).',
    );
  }

  for (const warning of warnings) log(`AVISO esbuild: ${warning}`);
  return { version, files, skipped, warnings };
}

async function main() {
  const { values } = parseArgs({
    options: {
      outdir: { type: 'string', default: path.join(SERVER_DIR, 'dist') },
      version: { type: 'string' },
      sourcemap: { type: 'boolean', default: false },
      'server-entry': { type: 'string' },
      'engine-entry': { type: 'string' },
    },
  });
  await buildServer({
    outdir: values.outdir,
    version: values.version,
    sourcemap: values.sourcemap,
    serverEntry: values['server-entry'],
    engineEntry: values['engine-entry'],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`build.mjs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
