// scripts/release.mjs y apps/server/build.mjs: la release que llega al NAS.
//
// Se compila un servidor mínimo que usa Fastify y pino de verdad (el riesgo
// R10 del plan: que el bundle de esbuild falle al ejecutarse y los tests
// unitarios no lo vean), una web de prueba con la forma de la de Vite y un
// engine-control mínimo. Nada de esto escribe en la carpeta de la app.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, readMonorepoVersion } from '../../apps/server/build.mjs';
import {
  createRelease,
  listFiles,
  NGINX_TEMPLATE,
  precacheList,
  REQUIRED_FILES,
  stampServiceWorker,
} from '../release.mjs';
import {
  bashPath,
  HOOK_TEMPLATE,
  COMPOSE_TEMPLATE,
  monorepoVersion,
  runBash,
  tempDir,
} from '../../deploy/test/helpers.js';

const VERSION = monorepoVersion();
const COMMIT = 'a'.repeat(40);
const quiet = () => {};

let work: string;
let serverEntry: string;
let engineEntry: string;
let webDist: string;

// Servidor mínimo: Fastify con su logger (pino a stdout, sin transports) y la
// versión que inyecta el build. Exporta algo para comprobar que es CommonJS.
const SERVER_SOURCE = `import Fastify from 'fastify';
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
export async function smoke(): Promise<string> {
  const app = Fastify({ logger: { level: 'info' } });
  app.get('/api/v1/health/live', async () => ({ ok: true, version: APP_VERSION }));
  const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
  app.log.info({ status: response.statusCode }, 'prueba de humo');
  await app.close();
  return response.body;
}
if (require.main === module) {
  smoke().then((body) => process.stdout.write('RESULTADO ' + body + '\\n'));
}
`;

const ENGINE_SOURCE = `declare const __APP_VERSION__: string;
export const ENGINE_VERSION = __APP_VERSION__;
`;

function writeWebDist(dir: string) {
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Ace Player Neo</title>\n');
  writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"id":"/","start_url":"/"}\n');
  for (const icon of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    writeFileSync(path.join(dir, icon), Buffer.from([0x89, 0x50, 0x4e, 0x47, icon.length]));
  }
  const js = `console.log(${JSON.stringify('app '.repeat(300))});\n`;
  writeFileSync(path.join(dir, 'assets', 'index-3f2a1b9c.js'), js);
  writeFileSync(path.join(dir, 'assets', 'index-3f2a1b9c.js.gz'), gzipSync(js, { level: 9 }));
  writeFileSync(path.join(dir, 'assets', 'index-3f2a1b9c.js.map'), '{"version":3,"mappings":""}\n');
  writeFileSync(path.join(dir, 'assets', 'index-77aa11bb.css'), 'body{margin:0}\n');
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of listFiles(dir)) {
    out[file] = createHash('sha256')
      .update(readFileSync(path.join(dir, file)))
      .digest('hex');
  }
  return out;
}

type ReleaseOptions = NonNullable<Parameters<typeof createRelease>[0]>;

async function release(out: string, overrides: ReleaseOptions = {}) {
  return createRelease({
    out,
    version: VERSION,
    commit: COMMIT,
    webDist,
    serverEntry,
    engineEntry,
    log: quiet,
    ...overrides,
  });
}

beforeAll(() => {
  work = tempDir('release');
  serverEntry = path.join(work, 'fuente', 'main.ts');
  engineEntry = path.join(work, 'fuente', 'engine-control.ts');
  mkdirSync(path.dirname(serverEntry), { recursive: true });
  writeFileSync(serverEntry, SERVER_SOURCE);
  writeFileSync(engineEntry, ENGINE_SOURCE);
  webDist = path.join(work, 'web-dist');
  writeWebDist(webDist);
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('apps/server/build.mjs', () => {
  it('la versión por defecto es la del package.json de la raíz', () => {
    expect(readMonorepoVersion()).toBe(VERSION);
  });

  it('un solo server.js CommonJS con las dependencias dentro, que arranca sin node_modules', async () => {
    const outdir = path.join(work, 'build');
    const result = await buildServer({
      outdir,
      version: VERSION,
      serverEntry,
      engineEntry,
      log: quiet,
    });
    expect(result.skipped).toEqual([]);
    expect(readdirSync(outdir).sort()).toEqual(['engine-control.js', 'server.js']);

    const source = readFileSync(path.join(outdir, 'server.js'), 'utf8');
    expect(source.startsWith(`// Ace Player Neo ${VERSION} · server.js\n`)).toBe(true);
    expect(source).toContain('"use strict";');
    expect(source).not.toMatch(/^import\s/m);

    // CommonJS de verdad: se puede cargar con require y exporta lo suyo.
    const loaded = createRequire(import.meta.url)(path.join(outdir, 'server.js')) as {
      APP_VERSION: string;
    };
    expect(loaded.APP_VERSION).toBe(VERSION);

    // Y se ejecuta en una carpeta sin node_modules: Fastify y pino van dentro.
    const isolated = path.join(work, 'aislado');
    mkdirSync(isolated, { recursive: true });
    cpSync(path.join(outdir, 'server.js'), path.join(isolated, 'server.js'));
    const run = spawnSync(process.execPath, ['server.js'], {
      cwd: isolated,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`RESULTADO {"ok":true,"version":"${VERSION}"}`);
    const logLine = run.stdout.split('\n').find((line) => line.includes('prueba de humo'));
    expect(JSON.parse(logLine ?? '{}')).toMatchObject({ level: 30, status: 200 });
  });

  it('sin la fuente de engine-control avisa y sigue (la escribe otro módulo)', async () => {
    const outdir = path.join(work, 'build-sin-motor');
    const lines: string[] = [];
    const result = await buildServer({
      outdir,
      version: VERSION,
      serverEntry,
      engineEntry: path.join(work, 'no-existe.ts'),
      log: (line) => lines.push(line),
    });
    expect(result.skipped).toEqual(['engine-control.js']);
    expect(readdirSync(outdir)).toEqual(['server.js']);
    expect(lines.join('\n')).toContain('AVISO');
  });

  it('rechaza una versión que no sea X.Y.Z y un punto de entrada que no existe', async () => {
    const outdir = path.join(work, 'build-mal');
    await expect(buildServer({ outdir, version: '0.7', serverEntry, log: quiet })).rejects.toThrow(
      'Versión no válida',
    );
    await expect(
      buildServer({
        outdir,
        version: VERSION,
        serverEntry: path.join(work, 'nada.ts'),
        log: quiet,
      }),
    ).rejects.toThrow('No existe el punto de entrada');
  });
});

describe('scripts/release.mjs', () => {
  let outA: string;
  let outB: string;
  let dir: string;

  beforeAll(async () => {
    outA = path.join(work, 'releases-a');
    outB = path.join(work, 'releases-b');
    const first = await release(outA);
    await release(outB);
    dir = first.dir;
  });

  it('monta la release completa, con web/ aparte y solo lo que exige el hook y los assets', async () => {
    const result = await release(path.join(work, 'releases-c'));
    expect(result.missing).toEqual([]);
    expect(result.hasWeb).toBe(true);
    const files = listFiles(dir);
    for (const required of REQUIRED_FILES) expect(files).toContain(required);
    expect(files.filter((file) => !file.startsWith('web/')).sort()).toEqual(
      ['RELEASE.json', 'SHA256SUMS', 'engine-control.js', 'nginx.conf', 'server.js'].sort(),
    );
    expect(files).toContain('web/assets/index-3f2a1b9c.js.gz');
    // Los mapas "hidden" de Vite no llegan al NAS.
    expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  });

  it('es reproducible: dos ejecuciones dan exactamente los mismos bytes', async () => {
    expect(snapshot(path.join(outB, VERSION))).toEqual(snapshot(dir));
    // Y repetirla encima de la anterior la sustituye sin dejar restos.
    await release(outA);
    expect(snapshot(dir)).toEqual(snapshot(path.join(outB, VERSION)));
    expect(readdirSync(outA)).toEqual([VERSION]);
  });

  it('RELEASE.json: versión y commit, sin fecha', () => {
    expect(readFileSync(path.join(dir, 'RELEASE.json'), 'utf8')).toBe(
      `${JSON.stringify({ version: VERSION, commit: COMMIT }, null, 2)}\n`,
    );
  });

  it('SHA256SUMS: formato de sha256sum, LF, ordenado y lo aceptan sha256sum --check y el hook', () => {
    const sums = readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
    expect(sums).not.toContain('\r');
    const lines = sums.trimEnd().split('\n');
    const listed = lines.map((line) => {
      const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
      expect(match, line).not.toBeNull();
      const [, hash = '', file = ''] = match ?? [];
      expect(
        createHash('sha256')
          .update(readFileSync(path.join(dir, file)))
          .digest('hex'),
      ).toBe(hash);
      return file;
    });
    expect(listed).toEqual(listFiles(dir).filter((file) => file !== 'SHA256SUMS'));
    const script = path.join(work, 'comprobar.sh');
    writeFileSync(
      script,
      ['cd "$1"', 'sha256sum --check --strict --quiet SHA256SUMS', ''].join('\n'),
    );
    const check = runBash(bashPath(script), [bashPath(dir)], {});
    expect(check.status, check.stdout + check.stderr).toBe(0);
  });

  it('sw.js: VERSION de la release (T-102) y precarga de los assets sin .gz', () => {
    const sw = readFileSync(path.join(dir, 'web', 'sw.js'), 'utf8');
    expect(sw).toContain(`const VERSION = "aceneo-${VERSION}";`);
    expect(sw).not.toContain('__ACE_PRECACHE__');
    expect(sw).toContain('"/assets/index-3f2a1b9c.js"');
    expect(sw).toContain('"/assets/index-77aa11bb.css"');
    expect(sw).not.toContain('.js.gz');
    // Nunca guarda en caché datos ni vídeo.
    expect(sw).toContain('^\\/(api|ace|content|remux|native)(\\/|$)');
  });

  it('nginx.conf es la plantilla de deploy/umbrel con LF', () => {
    expect(readFileSync(path.join(dir, 'nginx.conf'), 'utf8')).toBe(
      readFileSync(NGINX_TEMPLATE, 'utf8').replace(/\r\n?/g, '\n'),
    );
  });

  it('el hook da por buena la release que sale de aquí (tienda local → APP_DATA_DIR)', () => {
    const appData = path.join(work, 'app-data');
    const store = path.join(work, 'tienda', 'ismaeloul-ace-player-neo');
    mkdirSync(appData, { recursive: true });
    mkdirSync(path.join(store, 'releases'), { recursive: true });
    cpSync(dir, path.join(store, 'releases', VERSION), { recursive: true });
    cpSync(COMPOSE_TEMPLATE, path.join(appData, 'docker-compose.yml'));
    writeFileSync(path.join(appData, 'umbrel-app.yml'), `version: "${VERSION}"\n`);

    const result = runBash(bashPath(HOOK_TEMPLATE), [], {
      APP_DATA_DIR: bashPath(appData),
      SCRIPT_APP_REPO_DIR: bashPath(store),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release restaurada desde la tienda local');
    expect(existsSync(path.join(appData, 'releases', VERSION, '.complete'))).toBe(true);
  });

  it('sin web compilada (Fase 2): release de pruebas sin web/, marcada como incompleta', async () => {
    const result = await release(path.join(work, 'releases-sin-web'), {
      webDist: path.join(work, 'no-hay-web'),
    });
    expect(result.hasWeb).toBe(false);
    expect(result.missing).toEqual(REQUIRED_FILES.filter((file) => file.startsWith('web/')));
    expect(listFiles(result.dir).some((file) => file.startsWith('web/'))).toBe(false);
  });

  it('hacia la carpeta de la app solo sale completa: si falta algo, no crea nada', async () => {
    const out = path.join(work, 'releases-estricta');
    await expect(
      release(out, { allowIncomplete: false, webDist: path.join(work, 'no-hay-web') }),
    ).rejects.toThrow('la web compilada');
    expect(existsSync(out)).toBe(false);
  });
});

describe('service worker', () => {
  it('stampServiceWorker exige la línea de VERSION y pone la de la release', () => {
    expect(() => stampServiceWorker('self.x = 1;', VERSION, [])).toThrow('VERSION');
    expect(stampServiceWorker("const VERSION = 'aceneo-0.0.0';\r\n", '1.2.3', [])).toBe(
      'const VERSION = "aceneo-1.2.3";\n',
    );
  });

  it('precacheList: documento, manifiesto, iconos y assets, en orden estable', () => {
    expect(precacheList(webDist)).toEqual([
      '/',
      '/manifest.webmanifest',
      '/icon-192.png',
      '/icon-512.png',
      '/assets/index-3f2a1b9c.js',
      '/assets/index-77aa11bb.css',
    ]);
  });
});
