// Prepara deploy/local/.work para la pila local (compose.local.yml):
//   .work/releases/<v>/        la release, montada con scripts/release.mjs
//   .work/motor-falso/         el motor falso empaquetado en un solo .cjs
//   .work/data, .work/apk-cache  datos y caché de apk del contenedor storage
//
// Web: si todavía no hay apps/web/dist (Fase 2), se usa el front de la 0.6.59
// (E1.12: una pestaña vieja abierta durante la actualización tiene que seguir
// funcionando contra el backend nuevo). Con --web <dir> se elige otra carpeta.
//
// El motor falso se empaqueta con esbuild (lo mismo que haría tsx al vuelo)
// porque los node_modules de pnpm en Windows son enlaces a rutas del PC que un
// contenedor Linux no puede seguir.
//
// Uso: node deploy/local/prepare.mjs [--web <dir>] [--server-entry <f>] [--engine-entry <f>]
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { createRelease, DEFAULT_WEB_DIST, MONOREPO_DIR, REPO_DIR } from '../../scripts/release.mjs';

const LOCAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR = path.join(LOCAL_DIR, '.work');
const FAKE_ENGINE_ENTRY = path.join(
  MONOREPO_DIR,
  'apps',
  'server',
  'test',
  'fake-engine',
  'cli.ts',
);
const LEGACY_WEB = path.join(REPO_DIR, 'ismaeloul-ace-player-neo', 'releases', '0.6.59');
/** Lo de la 0.6.59 que no es web: nunca se sirve desde /www. */
const LEGACY_NOT_WEB = new Set(['server.js', 'engine-control.js', 'nginx.conf', '.complete']);

const { values } = parseArgs({
  options: {
    web: { type: 'string' },
    'server-entry': { type: 'string' },
    'engine-entry': { type: 'string' },
  },
});

mkdirSync(path.join(WORK_DIR, 'data'), { recursive: true });
mkdirSync(path.join(WORK_DIR, 'apk-cache'), { recursive: true });

let webDist = values.web ? path.resolve(values.web) : DEFAULT_WEB_DIST;
let legacyCopy = '';
if (!values.web && !existsSync(path.join(DEFAULT_WEB_DIST, 'index.html'))) {
  legacyCopy = mkdtempSync(path.join(os.tmpdir(), 'aceneo-web-0.6.59-'));
  cpSync(LEGACY_WEB, legacyCopy, {
    recursive: true,
    filter: (source) => !LEGACY_NOT_WEB.has(path.basename(source)),
  });
  webDist = legacyCopy;
  console.log('Sin apps/web/dist: se usa el front de la 0.6.59 (E1.12).');
}

try {
  await createRelease({
    out: path.join(WORK_DIR, 'releases'),
    webDist,
    serverEntry: values['server-entry'],
    engineEntry: values['engine-entry'],
  });
} catch (error) {
  console.error(
    `prepare.mjs: no se pudo montar la release: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  if (legacyCopy) rmSync(legacyCopy, { recursive: true, force: true });
}

if (existsSync(FAKE_ENGINE_ENTRY)) {
  // ESM (no como el servidor): una CLI suele arrancar con
  // "import.meta.url === argv[1]" o con await en el nivel superior, y en
  // CommonJS ninguna de las dos cosas funciona.
  const outfile = path.join(WORK_DIR, 'motor-falso', 'fake-engine.mjs');
  await build({
    entryPoints: [FAKE_ENGINE_ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: 'import { createRequire as __aceCreateRequire } from "node:module"; const require = __aceCreateRequire(import.meta.url);',
    },
    absWorkingDir: MONOREPO_DIR,
    logLevel: 'warning',
  });
  console.log(`Motor falso → ${path.relative(MONOREPO_DIR, outfile)}`);
} else {
  console.log(
    `AVISO: todavía no existe ${path.relative(MONOREPO_DIR, FAKE_ENGINE_ENTRY)}; ` +
      'el perfil "falso" esperará a que se empaquete (vuelve a ejecutar este script).',
  );
}

console.log(
  '\nListo. Ahora:\n' +
    '  docker compose -f deploy/local/compose.local.yml --profile falso up   (motor falso)\n' +
    '  docker compose -f deploy/local/compose.local.yml --profile real up    (motor real)\n' +
    'Web por la pasarela: http://127.0.0.1:17792/__pasarela/login',
);
