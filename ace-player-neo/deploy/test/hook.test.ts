// hooks/pre-start de la 0.7.0 ejecutado de verdad con bash sobre un
// APP_DATA_DIR falso (empaquetado §7.4 y §7.10). El curl de la red es uno falso
// que sirve tarballs locales: ningún test sale a internet.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_FILES } from '../../scripts/release.mjs';
import {
  bashPath,
  COMPOSE_TEMPLATE,
  HOOK_TEMPLATE,
  hookRequiredFiles,
  monorepoVersion,
  readText,
  runBash,
  tempDir,
  writeFakeCurl,
  writeFakeRelease,
  writeTarball,
  type RunResult,
} from './helpers.js';

const VERSION = monorepoVersion();
const HOOK_TEXT = readText(HOOK_TEMPLATE);
const REQUIRED = hookRequiredFiles(HOOK_TEXT);
const TAG_ROOT = `umbrel-app-store-ace-player-neo-v${VERSION}`;
const MAIN_ROOT = 'umbrel-app-store-main';

interface Sandbox {
  root: string;
  appData: string;
  target: string;
  store: string;
  storeRelease: string;
  bin: string;
  curlLog: string;
  tarballs: string;
}

let box: Sandbox;

beforeEach(() => {
  const root = tempDir('hook');
  const appData = path.join(root, 'app-data');
  const store = path.join(root, 'tienda', 'ismaeloul-ace-player-neo');
  mkdirSync(appData, { recursive: true });
  mkdirSync(path.join(store, 'releases'), { recursive: true });
  // Lo que umbreld deja en APP_DATA_DIR en una actualización: Compose y manifiesto.
  cpSync(COMPOSE_TEMPLATE, path.join(appData, 'docker-compose.yml'));
  writeManifest(appData, VERSION);
  const bin = path.join(root, 'bin');
  writeFakeCurl(bin);
  const tarballs = path.join(root, 'tarballs');
  mkdirSync(tarballs);
  box = {
    root,
    appData,
    target: path.join(appData, 'releases', VERSION),
    store,
    storeRelease: path.join(store, 'releases', VERSION),
    bin,
    curlLog: path.join(root, 'curl.log'),
    tarballs,
  };
  writeFileSync(box.curlLog, '');
});

afterEach(() => {
  rmSync(box.root, { recursive: true, force: true });
});

function writeManifest(dir: string, version: string) {
  writeFileSync(
    path.join(dir, 'umbrel-app.yml'),
    `manifestVersion: 1\nid: ismaeloul-ace-player-neo\nname: Ace Player Neo\nversion: "${version}"\nport: 7792\n`,
  );
}

interface HookOptions {
  store?: boolean;
  tagTarball?: string;
  mainTarball?: string;
}

function runHook(options: HookOptions = {}): RunResult {
  return runBash(
    bashPath(HOOK_TEMPLATE),
    [],
    {
      APP_DATA_DIR: bashPath(box.appData),
      SCRIPT_APP_REPO_DIR: options.store ? bashPath(box.store) : undefined,
      FAKE_CURL_LOG: bashPath(box.curlLog),
      FAKE_TAG_TARBALL: options.tagTarball ? bashPath(options.tagTarball) : undefined,
      FAKE_MAIN_TARBALL: options.mainTarball ? bashPath(options.mainTarball) : undefined,
    },
    [box.bin],
  );
}

function curlCalls(): string[] {
  return readFileSync(box.curlLog, 'utf8').split('\n').filter(Boolean);
}

/** Restos de restauraciones o descargas: no debe quedar ninguno. */
function leftovers(): string[] {
  const inReleases = existsSync(path.dirname(box.target))
    ? readdirSync(path.dirname(box.target)).filter((name) => name.startsWith('.'))
    : [];
  const inAppData = readdirSync(box.appData).filter((name) => name.startsWith('.ace-player-neo-'));
  return [...inReleases, ...inAppData];
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full).split(path.sep).join('/');
      if (entry.isDirectory()) walk(full);
      else out[relative] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function expectInstalledFrom(sourceDir: string) {
  const installed = snapshot(box.target);
  expect(installed['.complete']).toBe('');
  delete installed['.complete'];
  expect(installed).toEqual(snapshot(sourceDir));
}

function tarball(name: string, archiveRoot: string, releaseDir: string) {
  const file = path.join(box.tarballs, name);
  writeTarball(file, archiveRoot, releaseDir, VERSION);
  return file;
}

describe('hooks/pre-start: el texto', () => {
  it('LF, shebang de bash y sin versión escrita a mano (T-001)', () => {
    expect(HOOK_TEXT.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(HOOK_TEXT).not.toContain('\r');
    expect(HOOK_TEXT).not.toMatch(/readonly VERSION="\d/);
    expect(HOOK_TEXT).toContain('docker-compose.yml');
    expect(HOOK_TEXT).toContain('MANIFEST_VERSION');
    expect(HOOK_TEXT).toContain('set -euo pipefail');
  });

  it('REQUIRED_FILES es la lista nueva y la misma que exige scripts/release.mjs', () => {
    expect(REQUIRED).toEqual(REQUIRED_FILES);
    expect(REQUIRED).toContain('SHA256SUMS');
    expect(REQUIRED).toContain('server.js');
    expect(REQUIRED).not.toContain('index.html');
    expect(REQUIRED.filter((file) => file.startsWith('vendor/'))).toEqual([]);
  });

  it('usa -f y -s, sha256sum --check, restauración aparte y chmod (empaquetado §7.4)', () => {
    expect(HOOK_TEXT).toMatch(
      /\[\[ -f "\$\{root\}\/\$\{relative_path\}" && -s "\$\{root\}\/\$\{relative_path\}" \]\]/,
    );
    expect(HOOK_TEXT).toContain('sha256sum --check --strict --quiet SHA256SUMS');
    expect(HOOK_TEXT).toContain('chmod -R u+rwX,go+rX');
    expect(HOOK_TEXT).toMatch(/mktemp -d "\$\{RELEASES_DIR\}\/\.\$\{VERSION\}\.tmp\.XXXXXX"/);
    // Nunca se copia directamente encima de la release en uso.
    expect(HOOK_TEXT).not.toMatch(/cp -a "[^"]*" "\$\{TARGET\}\//);
  });

  it('descarga con plazos: ni curl ni wget pueden colgar el arranque', () => {
    expect(HOOK_TEXT).toContain('--connect-timeout 15 --max-time 180');
    expect(HOOK_TEXT).toMatch(/wget -q -T \d+/);
  });
});

describe('hooks/pre-start: ejecutado sobre un APP_DATA_DIR falso', () => {
  it('release local completa y marcada: no toca nada ni sale a la red', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    writeFileSync(path.join(box.target, '.complete'), '');

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release local ya verificada');
    expectInstalledFrom(source);
    expect(curlCalls()).toEqual([]);
  });

  it('release local completa sin marcar: la verifica y deja .complete', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });

    const result = runHook();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release local verificada');
    expectInstalledFrom(source);
  });

  it('marcador huérfano (.complete pero falta server.js): restaura desde la tienda local', () => {
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    writeFileSync(path.join(box.target, '.complete'), '');
    rmSync(path.join(box.target, 'server.js'));

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release restaurada desde la tienda local');
    expectInstalledFrom(source);
    expect(curlCalls()).toEqual([]);
    expect(leftovers()).toEqual([]);
    if (process.platform !== 'win32') {
      // nginx corre con otro usuario: carpetas 755 y ficheros 644 como mínimo.
      expect(statSync(box.target).mode & 0o755).toBe(0o755);
      expect(statSync(path.join(box.target, 'web', 'index.html')).mode & 0o644).toBe(0o644);
    }
  });

  it('asset truncado (solo lo cubre SHA256SUMS): no la da por buena y restaura', () => {
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    writeFileSync(path.join(box.target, '.complete'), '');
    writeFileSync(path.join(box.target, 'web', 'assets', 'index-3f2a1b9c.js'), 'console.lo');

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('tienda local');
    expectInstalledFrom(source);
  });

  it('una carpeta en lugar de un fichero (lo que crea Docker con un montaje sin origen) no cuenta', () => {
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    rmSync(path.join(box.target, 'engine-control.js'));
    mkdirSync(path.join(box.target, 'engine-control.js', 'dentro'), { recursive: true });
    writeFileSync(path.join(box.target, 'engine-control.js', 'dentro', 'x'), 'no vacío');

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expectInstalledFrom(source);
  });

  it('SHA256SUMS sin la línea de un obligatorio: incompleta aunque --check pase', () => {
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    const sums = path.join(box.target, 'SHA256SUMS');
    writeFileSync(
      sums,
      readFileSync(sums, 'utf8')
        .split('\n')
        .filter((line) => !line.endsWith('  server.js'))
        .join('\n'),
    );

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expectInstalledFrom(source);
  });

  it('sin tienda local y sin red: falla (umbreld sigue con || true), conserva lo que había y no deja restos', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    rmSync(path.join(box.target, 'nginx.conf'));
    const before = snapshot(box.target);

    const result = runHook();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no se pudo recuperar la release');
    expect(curlCalls()).toEqual([
      expect.stringContaining(`/refs/tags/ace-player-neo-v${VERSION}.tar.gz`),
      expect.stringContaining('/refs/heads/main.tar.gz'),
    ]);
    expect(snapshot(box.target)).toEqual(before);
    expect(existsSync(path.join(box.target, '.complete'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('sin release local: la baja de la etiqueta inmutable y la verifica', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    const tag = tarball('tag.tar.gz', TAG_ROOT, source);

    const result = runHook({ tagTarball: tag });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release lista');
    expectInstalledFrom(source);
    expect(curlCalls()).toHaveLength(1);
    expect(leftovers()).toEqual([]);
  });

  it('etiqueta que no existe: recurre a main', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    const main = tarball('main.tar.gz', MAIN_ROOT, source);

    const result = runHook({ mainTarball: main });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('usando main como recuperacion');
    expectInstalledFrom(source);
    expect(curlCalls()).toHaveLength(2);
  });

  it('tienda local corrupta: no la copia y descarga la etiqueta', () => {
    const good = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    const corrupt = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);
    writeFileSync(path.join(corrupt, 'server.js'), 'cambiado despues de firmar\n');
    const tag = tarball('tag.tar.gz', TAG_ROOT, good);

    const result = runHook({ store: true, tagTarball: tag });

    expect(result.status, result.stderr).toBe(0);
    expectInstalledFrom(good);
  });

  it('descarga que no cuadra con SHA256SUMS: no se instala nada', () => {
    const bad = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    writeFileSync(path.join(bad, 'web', 'sw.js'), 'manipulado\n');
    const tag = tarball('tag.tar.gz', TAG_ROOT, bad);
    const main = tarball('main.tar.gz', MAIN_ROOT, bad);

    const result = runHook({ tagTarball: tag, mainTarball: main });

    expect(result.status).toBe(1);
    expect(existsSync(box.target)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('manifiesto con otra versión: avisa y prepara la de Compose, que es la que arranca', () => {
    writeManifest(box.appData, '0.6.59');
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('aviso');
    expect(result.stderr).toContain(`(0.6.59) no coincide con Compose (${VERSION})`);
    expectInstalledFrom(source);
  });

  it('sin manifiesto: también sigue con la versión de Compose', () => {
    rmSync(path.join(box.appData, 'umbrel-app.yml'));
    const source = writeFakeRelease(path.join(box.store, 'releases'), VERSION, REQUIRED);

    const result = runHook({ store: true });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('(ausente)');
    expectInstalledFrom(source);
  });

  it('Compose que apunta a dos releases: no adivina y falla', () => {
    const compose = path.join(box.appData, 'docker-compose.yml');
    writeFileSync(
      compose,
      readFileSync(compose, 'utf8').replace(
        `node /releases/${VERSION}/engine-control.js`,
        'node /releases/0.6.59/engine-control.js',
      ),
    );

    const result = runHook({ store: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('una unica release');
  });

  it('poda: fuera las releases de más de 30 días; se quedan las recientes y la actual', () => {
    const source = writeFakeRelease(path.join(box.root, 'fuente'), VERSION, REQUIRED);
    cpSync(source, box.target, { recursive: true });
    const releases = path.dirname(box.target);
    const old = writeFakeRelease(releases, '0.6.58', REQUIRED);
    const recent = writeFakeRelease(releases, '0.6.59', REQUIRED);
    const longAgo = new Date(Date.now() - 45 * 24 * 3600 * 1000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(box.target, longAgo, longAgo);

    const result = runHook();

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(box.target)).toBe(true);
  });
});
