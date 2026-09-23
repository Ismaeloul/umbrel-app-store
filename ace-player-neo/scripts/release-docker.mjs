// Monta (o comprueba) la release de referencia en Linux, dentro de Docker, con
// la misma imagen de Node que producción (fijada por digest).
//
// Por qué: lightningcss (el minificador de CSS de Vite) redondea distinto en
// Windows y en Linux los colores que calcula al compilar (lab(… -2.2577 …) en
// un sitio y -2.25773 en el otro), así que el index-*.css y el index-*.js que
// lo enlaza cambian de hash según el sistema. Y zlib escribe el sistema en la
// cabecera de cada .gz. La referencia es Linux, que es donde corre la CI
// (check:release), así que la release que se commitea sale de aquí.
//
// Se monta desde HEAD, nunca desde la carpeta de trabajo: un bundle de git
// (con la historia, que RELEASE.json necesita) se clona dentro del contenedor.
// Los cambios sin commitear de las fuentes no entran. La caché de pnpm vive en
// el volumen aceneo-pnpm-store para que la segunda vez no descargue nada.
//
// Uso (desde ace-player-neo/, con Docker arrancado):
//   node scripts/release-docker.mjs           monta releases/<v> y la copia a la carpeta de la app
//   node scripts/release-docker.mjs --check   comprueba que la commiteada en HEAD es la que sale
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readMonorepoVersion } from '../apps/server/build.mjs';
import { APP_RELEASES_DIR, MONOREPO_DIR, REPO_DIR, SOURCE_PATHS, computeSums } from './release.mjs';

const IMAGE =
  'node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43';
const STORE_VOLUME = 'aceneo-pnpm-store';

/** @param {string[]} args */
const git = (args) =>
  execFileSync('git', ['-C', MONOREPO_DIR, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** Barras normales: así Docker Desktop entiende las rutas de Windows. */
const dockerPath = (/** @type {string} */ p) => p.replace(/\\/g, '/');

function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const version = readMonorepoVersion();
  const head = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain', '--', ...SOURCE_PATHS]) !== '') {
    console.warn(
      'AVISO: hay cambios sin commitear en las fuentes; la release se monta desde HEAD y no los lleva.',
    );
  }

  // Carpeta temporal sin tildes: Docker Desktop no siempre monta bien la del repo.
  const work = mkdtempSync(path.join(os.tmpdir(), 'aceneo-release-docker-'));
  try {
    mkdirSync(path.join(work, 'out'));
    execFileSync(
      'git',
      ['-C', REPO_DIR, 'bundle', 'create', path.join(work, 'repo.bundle'), 'HEAD'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const script = [
      'set -eu',
      'apk add --no-cache git >/dev/null',
      'git init -q /work',
      'git -C /work fetch -q /in/repo.bundle HEAD',
      'git -C /work -c advice.detachedHead=false checkout -q FETCH_HEAD',
      'cd /work/ace-player-neo',
      'corepack pnpm@10.18.2 install --frozen-lockfile --reporter=silent',
      'corepack pnpm@10.18.2 --filter @ace/web build >/dev/null',
      values.check
        ? 'node scripts/check-release.mjs'
        : `node scripts/release.mjs && cp -a /work/ismaeloul-ace-player-neo/releases/${version}/. /in/out/`,
    ].join('\n');
    console.log(
      `${values.check ? 'Comprobando' : 'Montando'} la release ${version} en Linux (HEAD ${head.slice(0, 7)})…`,
    );
    const run = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${dockerPath(work)}:/in`,
        '-v',
        `${STORE_VOLUME}:/pnpm-store`,
        '-e',
        'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
        '-e',
        'npm_config_store_dir=/pnpm-store',
        '-e',
        'AUTO_SYNC=false',
        IMAGE,
        'sh',
        '-c',
        script,
      ],
      { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    if (run.error) throw new Error(`no se pudo lanzar Docker (${run.error.message})`);
    if (run.status !== 0) {
      process.exitCode = run.status ?? 1;
      return;
    }
    if (values.check) return;

    // Cambio por la carpeta de la app: la nueva se prepara al lado y se
    // renombra, como hace release.mjs.
    const out = path.join(work, 'out');
    const sums = readFileSync(path.join(out, 'SHA256SUMS'), 'utf8');
    if (computeSums(out) !== sums)
      throw new Error('la release copiada no cuadra con su SHA256SUMS');
    const target = path.join(APP_RELEASES_DIR, version);
    const staging = path.join(APP_RELEASES_DIR, `.${version}.docker-${process.pid}`);
    cpSync(out, staging, { recursive: true });
    const previous = `${staging}.old`;
    if (existsSync(target)) renameSync(target, previous);
    renameSync(staging, target);
    rmSync(previous, { recursive: true, force: true });
    const release = JSON.parse(readFileSync(path.join(target, 'RELEASE.json'), 'utf8'));
    console.log(
      `Release ${version} (commit ${release.commit}) de Linux en ` +
        `${path.relative(REPO_DIR, target).split(path.sep).join('/')}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`release-docker.mjs: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
