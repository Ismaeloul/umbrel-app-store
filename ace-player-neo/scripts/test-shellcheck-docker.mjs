// shellcheck del hook de Umbrel (deploy/umbrel/hooks/pre-start) con la imagen
// oficial, fijada por digest: así no hace falta instalarlo en el PC ni en CI.
// Se copia el hook a una carpeta temporal porque Docker Desktop no siempre
// monta bien rutas con tildes (la de este repo lleva "Actualización").
//
// Uso: node scripts/test-shellcheck-docker.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MONOREPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(MONOREPO_DIR, 'deploy', 'umbrel', 'hooks', 'pre-start');
const IMAGE =
  'koalaman/shellcheck:stable@sha256:bb596a0d169b85ddd81d8b6d3a2ff6d5baf5fca10b97f575ebc647c3dff62b3d';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'aceneo-shellcheck-'));
try {
  copyFileSync(HOOK, path.join(tmp, 'pre-start'));
  const result = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${tmp}:/mnt:ro`, IMAGE, '--shell=bash', '/mnt/pre-start'],
    { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  if (result.error) {
    console.error(`test-shellcheck-docker: no se pudo lanzar Docker (${result.error.message})`);
    process.exitCode = 2;
  } else {
    if (result.status === 0) console.log('shellcheck: pre-start sin avisos');
    process.exitCode = result.status ?? 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
