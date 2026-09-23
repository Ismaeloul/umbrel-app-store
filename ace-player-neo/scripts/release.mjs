// Monta ismaeloul-ace-player-neo/releases/<versión>/ desde cero (arquitectura
// §11.1, empaquetado §7.2). Es lo único del monorepo que llega al NAS.
//
//   releases/<v>/
//   ├── SHA256SUMS          sha256 de cada fichero (menos él), rutas relativas, LF
//   ├── RELEASE.json        {"version","commit"}; sin fecha, para que sea reproducible
//   ├── server.js           backend de esbuild, CommonJS, dependencias dentro
//   ├── engine-control.js
//   ├── nginx.conf          deploy/umbrel/nginx.conf
//   └── web/                lo único que nginx copia a /www (apps/web/dist + sw.js)
//
// Se construye en una carpeta temporal junto al destino y solo al final se
// cambia por la anterior con dos renombrados: una ejecución cortada nunca deja
// una release a medias. Dos ejecuciones seguidas dan los mismos bytes.
//
// Uso:
//   node scripts/release.mjs [--out <carpeta releases>] [--version x.y.z]
//        [--commit <sha>] [--web-dist <dir>] [--server-entry <f>] [--engine-entry <f>]
//
// Sin --out escribe en la carpeta real de la app y exige una release completa;
// con --out (pruebas, compose local) admite una release incompleta y avisa.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildServer,
  DEFAULT_ENGINE_ENTRY,
  DEFAULT_SERVER_ENTRY,
  readMonorepoVersion,
} from '../apps/server/build.mjs';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MONOREPO_DIR = path.resolve(SCRIPTS_DIR, '..');
export const REPO_DIR = path.resolve(MONOREPO_DIR, '..');
export const APP_RELEASES_DIR = path.join(REPO_DIR, 'ismaeloul-ace-player-neo', 'releases');
export const NGINX_TEMPLATE = path.join(MONOREPO_DIR, 'deploy', 'umbrel', 'nginx.conf');
export const SW_TEMPLATE = path.join(SCRIPTS_DIR, 'templates', 'sw.js');
export const DEFAULT_WEB_DIST = path.join(MONOREPO_DIR, 'apps', 'web', 'dist');

/**
 * Lo que el hook exige para dar una release por completa. Tiene que coincidir
 * con REQUIRED_FILES de deploy/umbrel/hooks/pre-start (lo comprueba un test).
 */
export const REQUIRED_FILES = [
  'SHA256SUMS',
  'RELEASE.json',
  'server.js',
  'engine-control.js',
  'nginx.conf',
  'web/index.html',
  'web/sw.js',
  'web/manifest.webmanifest',
  'web/icon-180.png',
  'web/icon-192.png',
  'web/icon-512.png',
  'web/icon-maskable-512.png',
];

/** Rutas cuyo último commit identifica el código de la release. */
const SOURCE_PATHS = [
  'apps/server',
  'apps/web',
  'packages',
  'deploy/umbrel',
  'scripts',
  'package.json',
  'pnpm-lock.yaml',
];

const VERSION_LINE = /^const VERSION = (["'])[^"'\n]*\1;$/m;
const PRECACHE_TOKEN = '[/* __ACE_PRECACHE__ */]';

/** @param {string} text */
const toLf = (text) => text.replace(/\r\n?/g, '\n');

/** @param {string} relative */
const toPosix = (relative) => relative.split(path.sep).join('/');

/**
 * Todos los ficheros bajo root, con ruta relativa en formato POSIX y en orden
 * estable (por código, no por el locale del sistema).
 * @param {string} root
 * @returns {string[]}
 */
export function listFiles(root) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(toPosix(path.relative(root, full)));
    }
  };
  walk(root);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** @param {string} file */
export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Contenido de SHA256SUMS en el formato de `sha256sum` (dos espacios, LF).
 * @param {string} root
 */
export function computeSums(root) {
  return listFiles(root)
    .filter((relative) => relative !== 'SHA256SUMS')
    .map((relative) => `${sha256File(path.join(root, relative))}  ${relative}\n`)
    .join('');
}

/**
 * Commit del código de la release: el último que tocó las fuentes, no HEAD.
 * Así el commit que añade la release a la carpeta de la app no cambia su propio
 * RELEASE.json. Con cambios sin commitear en las fuentes se marca "-dirty".
 */
export function sourceCommit() {
  try {
    const git = (/** @type {string[]} */ args) =>
      execFileSync('git', ['-C', MONOREPO_DIR, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const sha = git(['log', '-1', '--format=%H', '--', ...SOURCE_PATHS]);
    if (!/^[0-9a-f]{40}$/.test(sha)) return 'desconocido';
    const dirty = git(['status', '--porcelain', '--', ...SOURCE_PATHS]) !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'desconocido';
  }
}

/**
 * Pone la versión (y la lista de precarga, si hay hueco para ella) en el
 * service worker. La línea `const VERSION = "aceneo-<v>";` la exige T-102.
 * @param {string} source
 * @param {string} version
 * @param {string[]} precache
 */
export function stampServiceWorker(source, version, precache) {
  if (!VERSION_LINE.test(source)) {
    throw new Error('El service worker no tiene la línea `const VERSION = "…";`');
  }
  let out = toLf(source).replace(VERSION_LINE, `const VERSION = "aceneo-${version}";`);
  if (out.includes(PRECACHE_TOKEN)) {
    out = out.split(PRECACHE_TOKEN).join(JSON.stringify(precache, null, 2));
  }
  return out;
}

/**
 * Lo que el SW precarga: el documento, el manifiesto, los iconos de la pantalla
 * de inicio y los assets del build (sin .gz ni .map, que el navegador no pide).
 * @param {string} webRoot
 */
export function precacheList(webRoot) {
  const files = listFiles(webRoot);
  const list = ['/'];
  for (const fixed of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
    if (files.includes(fixed)) list.push(`/${fixed}`);
  }
  for (const file of files) {
    if (file.startsWith('assets/') && !/\.(gz|map)$/.test(file)) list.push(`/${file}`);
  }
  return list;
}

/**
 * Permisos que nginx necesita (carpetas 755, ficheros 644), iguales en
 * cualquier máquina. En Windows chmod apenas tiene efecto y da igual.
 * @param {string} root
 */
function normalizeModes(root) {
  chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) normalizeModes(full);
    else chmodSync(full, 0o644);
  }
}

/**
 * Windows a veces tiene la carpeta abierta un instante (antivirus, indexador):
 * se reintenta el renombrado antes de rendirse.
 * @param {string} from
 * @param {string} to
 */
function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (attempt >= 10 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * @typedef {object} ReleaseOptions
 * @property {string} [out]           carpeta releases/ de destino (por defecto, la de la app)
 * @property {string} [version]
 * @property {string} [commit]
 * @property {string} [webDist]
 * @property {string} [serverEntry]
 * @property {string} [engineEntry]
 * @property {boolean} [allowIncomplete]
 * @property {(line: string) => void} [log]
 */

/**
 * @param {ReleaseOptions} [options]
 * @returns {Promise<{ dir: string, version: string, commit: string, files: string[], missing: string[], hasWeb: boolean }>}
 */
export async function createRelease(options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const version = options.version ?? readMonorepoVersion();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versión no válida: "${version}"`);
  const out = path.resolve(options.out ?? APP_RELEASES_DIR);
  const allowIncomplete = options.allowIncomplete ?? options.out !== undefined;
  const webDist = path.resolve(options.webDist ?? DEFAULT_WEB_DIST);
  const commit = options.commit ?? sourceCommit();
  const finalDir = path.join(out, version);

  // Hacia la carpeta real de la app solo sale una release completa. Se mira
  // ANTES de crear nada: sin esto, un intento fallido dejaría allí (aunque sea
  // un momento) una carpeta temporal y compilaría para nada.
  if (!allowIncomplete) {
    const serverEntry = path.resolve(options.serverEntry ?? DEFAULT_SERVER_ENTRY);
    const engineEntry = path.resolve(options.engineEntry ?? DEFAULT_ENGINE_ENTRY);
    const lacking = [
      [serverEntry, 'el punto de entrada del servidor'],
      [engineEntry, 'el punto de entrada de engine-control'],
      [path.join(webDist, 'index.html'), 'la web compilada'],
    ]
      .filter(([file]) => !existsSync(/** @type {string} */ (file)))
      .map(
        ([file, what]) => `${what} (${path.relative(MONOREPO_DIR, /** @type {string} */ (file))})`,
      );
    if (lacking.length > 0) {
      throw new Error(
        `No se monta la release ${version} en ${path.relative(REPO_DIR, finalDir)}: falta ` +
          `${lacking.join(', ')}. Para probar usa --out <carpeta>.`,
      );
    }
  }

  mkdirSync(out, { recursive: true });
  // Junto al destino: el renombrado final es atómico (mismo sistema de ficheros).
  const staging = mkdtempSync(path.join(out, `.${version}.tmp-`));
  try {
    // 1. Backend y engine-control.
    await buildServer({
      outdir: staging,
      version,
      serverEntry: options.serverEntry,
      engineEntry: options.engineEntry,
      log,
    });

    // 2. Web compilada (Fase 2). Sin ella la release sirve para probar el
    //    backend, pero el hook no la daría por completa.
    const hasWeb = existsSync(path.join(webDist, 'index.html'));
    if (hasWeb) {
      const webOut = path.join(staging, 'web');
      cpSync(webDist, webOut, {
        recursive: true,
        filter: (source) => path.resolve(source) !== path.join(webDist, 'sw.js'),
      });
      const ownWorker = path.join(webDist, 'sw.js');
      const workerSource = existsSync(ownWorker)
        ? readFileSync(ownWorker, 'utf8')
        : readFileSync(SW_TEMPLATE, 'utf8');
      writeFileSync(
        path.join(webOut, 'sw.js'),
        stampServiceWorker(workerSource, version, precacheList(webOut)),
      );
      log(`web: ${path.relative(MONOREPO_DIR, webDist)} + sw.js (aceneo-${version})`);
    } else {
      log(
        `AVISO: no hay web compilada en ${path.relative(MONOREPO_DIR, webDist) || webDist}; ` +
          'la release sale sin web/ (llegará en la Fase 2).',
      );
    }

    // 3. nginx.conf, siempre con LF: en Windows el checkout puede traer CRLF y
    //    los hashes no cuadrarían con los de CI.
    writeFileSync(path.join(staging, 'nginx.conf'), toLf(readFileSync(NGINX_TEMPLATE, 'utf8')));

    // 4. RELEASE.json sin fecha: la misma fuente da los mismos bytes.
    writeFileSync(
      path.join(staging, 'RELEASE.json'),
      `${JSON.stringify({ version, commit }, null, 2)}\n`,
    );

    // 5. SHA256SUMS de todo lo anterior.
    writeFileSync(path.join(staging, 'SHA256SUMS'), computeSums(staging));

    const files = listFiles(staging);
    const missing = REQUIRED_FILES.filter((required) => !files.includes(required));
    if (missing.length > 0) {
      const message = `Release ${version} incompleta; falta: ${missing.join(', ')}`;
      if (!allowIncomplete) {
        throw new Error(
          `${message}. No se toca ${path.relative(REPO_DIR, finalDir)}; para probar usa --out <carpeta>.`,
        );
      }
      log(`AVISO: ${message} (el hook no la daría por buena).`);
    }

    normalizeModes(staging);

    // 6. Cambio por la anterior: dos renombrados, sin escribir nunca encima.
    let previous = '';
    if (existsSync(finalDir)) {
      previous = `${staging}.old`;
      renameWithRetry(finalDir, previous);
    }
    try {
      renameWithRetry(staging, finalDir);
    } catch (error) {
      if (previous) renameWithRetry(previous, finalDir);
      throw error;
    }
    if (previous) rmSync(previous, { recursive: true, force: true });

    log(`Release ${version} (${commit}) lista en ${finalDir}: ${files.length} ficheros`);
    return { dir: finalDir, version, commit, files, missing, hasWeb };
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      version: { type: 'string' },
      commit: { type: 'string' },
      'web-dist': { type: 'string' },
      'server-entry': { type: 'string' },
      'engine-entry': { type: 'string' },
    },
  });
  await createRelease({
    out: values.out,
    version: values.version,
    commit: values.commit,
    webDist: values['web-dist'],
    serverEntry: values['server-entry'],
    engineEntry: values['engine-entry'],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`release.mjs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
