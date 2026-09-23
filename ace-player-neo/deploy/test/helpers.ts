// Utilidades comunes de los tests de empaquetado (deploy/test y scripts/test).
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { computeSums } from '../../scripts/release.mjs';

export const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_DIR = path.resolve(MONOREPO_DIR, '..');
export const APP_DIR = path.join(REPO_DIR, 'ismaeloul-ace-player-neo');
export const LEGACY_VERSION = '0.6.59';
export const LEGACY_RELEASE_DIR = path.join(APP_DIR, 'releases', LEGACY_VERSION);
/**
 * Compose y hook de la 0.6.59 tal cual. Desde la 0.7.0 la carpeta de la app
 * lleva los nuevos; estos se guardan junto a sus tests para el plan de vuelta
 * atrás (docs/despliegue.md).
 */
export const LEGACY_PACKAGE_DIR = path.join(APP_DIR, 'tests', 'legacy-0.6.59', 'paquete');
export const UMBREL_DIR = path.join(MONOREPO_DIR, 'deploy', 'umbrel');
export const COMPOSE_TEMPLATE = path.join(UMBREL_DIR, 'docker-compose.yml');
export const NGINX_TEMPLATE = path.join(UMBREL_DIR, 'nginx.conf');
export const HOOK_TEMPLATE = path.join(UMBREL_DIR, 'hooks', 'pre-start');

/** Versión del monorepo: la que tiene que llevar todo lo de la 0.7.0. */
export function monorepoVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(MONOREPO_DIR, 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

export interface ComposeService {
  image?: string;
  container_name?: string;
  command?: string;
  environment?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  healthcheck?: Record<string, unknown>;
  depends_on?: Record<string, unknown>;
  networks?: Record<string, { aliases?: string[] }>;
  profiles?: string[];
  build?: unknown;
  [key: string]: unknown;
}

export interface ComposeFile {
  services: Record<string, ComposeService>;
  [key: string]: unknown;
}

export function readCompose(file: string): ComposeFile {
  return parse(readText(file)) as ComposeFile;
}

/** Un fichero temporal propio de cada test; se borra en el afterEach de quien lo pide. */
export function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `aceneo-${prefix}-`));
}

/**
 * Ruta tal como la ve bash. En Windows, "C:\x" pasa a "/c/x": con "C:/x" el
 * tar de GNU tomaría "C:" por un host remoto y el hook no podría descomprimir.
 */
export function bashPath(file: string): string {
  const posix = file.split(path.sep).join('/');
  if (process.platform !== 'win32') return posix;
  return posix.replace(/^([A-Za-z]):\//, (_match, drive: string) => `/${drive.toLowerCase()}/`);
}

/** Carpeta usr/bin de Git para Windows: bash y los coreutils (sed, awk, sha256sum...). */
function gitUsrBin(): string {
  const candidates = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin'),
    'C:\\Program Files\\Git\\usr\\bin',
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'bash.exe')));
  if (!found) throw new Error('No se encuentra Git para Windows (usr/bin/bash.exe)');
  return found;
}

/**
 * bash con el que se ejecuta el hook. En Windows, el de Git, y el de usr/bin:
 * el bash.exe de System32 es el de WSL (otro sistema de ficheros) y el de
 * Git/bin pone su curl DELANTE del PATH, así que el hook saldría a internet en
 * vez de usar el curl falso de los tests.
 */
export function bashExecutable(): string {
  return process.platform === 'win32' ? path.join(gitUsrBin(), 'bash.exe') : 'bash';
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Ejecuta un script de bash. extraPath va delante del PATH (el curl falso); en
 * Windows se añade detrás la carpeta de los coreutils de Git.
 */
export function runBash(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
  extraPath: string[] = [],
): RunResult {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  // En Windows la clave es "Path": se reutiliza para no mandar dos variables.
  const key = Object.keys(merged).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
  const system = process.platform === 'win32' ? [gitUsrBin()] : [];
  merged[key] = [...extraPath, ...system, merged[key] ?? ''].join(path.delimiter);
  const result = spawnSync(bashExecutable(), [script, ...args], {
    encoding: 'utf8',
    env: merged,
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Los ficheros que el hook exige, sacados del propio hook. */
export function hookRequiredFiles(hookText: string): string[] {
  const block = /readonly -a REQUIRED_FILES=\(([\s\S]*?)\n\)/.exec(hookText)?.[1];
  if (!block) throw new Error('El hook no declara REQUIRED_FILES');
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');
}

/**
 * Release de prueba con la forma de la real: los obligatorios del hook, un
 * asset con hash (solo lo cubre SHA256SUMS) y SHA256SUMS válido.
 */
export function writeFakeRelease(root: string, version: string, required: string[]): string {
  const dir = path.join(root, version);
  mkdirSync(path.join(dir, 'web', 'assets'), { recursive: true });
  for (const relative of required) {
    if (relative === 'SHA256SUMS') continue;
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `contenido de ${relative} ${version}\n`);
  }
  writeFileSync(
    path.join(dir, 'web', 'assets', 'index-3f2a1b9c.js'),
    `console.log("${version}");\n`,
  );
  writeFileSync(path.join(dir, 'SHA256SUMS'), computeSums(dir));
  return dir;
}

/**
 * Un curl falso para el hook: sirve tarballs locales según la URL y apunta
 * cada URL pedida en un registro. Sin tarball para esa URL, falla como curl
 * --fail sin red.
 */
export function writeFakeCurl(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = [
    '#!/usr/bin/env bash',
    '# curl falso de los tests del hook: nada sale a la red.',
    'out=""; url=""',
    'while (( $# > 0 )); do',
    '  case "$1" in',
    '    --output) out="$2"; shift 2 ;;',
    '    --*) shift ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'printf "%s\\n" "${url}" >> "${FAKE_CURL_LOG}"',
    'case "${url}" in',
    '  */refs/tags/*) src="${FAKE_TAG_TARBALL:-}" ;;',
    '  */refs/heads/main*) src="${FAKE_MAIN_TARBALL:-}" ;;',
    '  *) src="" ;;',
    'esac',
    'if [[ -z "${src}" || ! -f "${src}" ]]; then',
    '  echo "curl: (6) Could not resolve host (curl falso)" >&2',
    '  exit 6',
    'fi',
    'cp "${src}" "${out}"',
    '',
  ].join('\n');
  const file = path.join(binDir, 'curl');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
}

/**
 * Tarball con la forma del de GitHub:
 * <raíz>/ismaeloul-ace-player-neo/releases/<v>/...
 */
export function writeTarball(
  file: string,
  archiveRoot: string,
  releaseDir: string,
  version: string,
) {
  const work = mkdtempSync(path.join(path.dirname(file), '.tar-'));
  const inside = path.join(work, archiveRoot, 'ismaeloul-ace-player-neo', 'releases');
  mkdirSync(inside, { recursive: true });
  // Script en un fichero y rutas como argumentos: el bash.exe de Git reinterpreta
  // las comillas de "bash -c '...'" al pasar por la línea de órdenes de Windows.
  const script = path.join(work, 'empaquetar.sh');
  writeFileSync(
    script,
    ['set -eu', 'cp -a "$1" "$2"', 'tar -czf "$3" -C "$4" "$5"', ''].join('\n'),
  );
  const result = runBash(
    bashPath(script),
    [
      bashPath(releaseDir),
      bashPath(path.join(inside, version)),
      bashPath(file),
      bashPath(work),
      archiveRoot,
    ],
    {},
  );
  rmSync(work, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`No se pudo crear el tarball: ${result.stderr}`);
}
