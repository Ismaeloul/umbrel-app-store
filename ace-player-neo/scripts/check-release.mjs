// Comprueba que la release commiteada en la carpeta de la app
// (ismaeloul-ace-player-neo/releases/<v>/) es exactamente la que sale del
// código (empaquetado §7.10): la vuelve a montar en una carpeta temporal con
// scripts/release.mjs y compara fichero a fichero. También comprueba que su
// SHA256SUMS cuadra con lo commiteado, que es lo que verifica el hook.
//
// Los .gz se comparan descomprimidos. El zlib de Node escribe en la cabecera el
// sistema en el que se comprimió (0x0a en Windows, 0x03 en Linux) y su salida
// puede cambiar entre versiones, así que el .gz de este PC y el de CI pueden
// diferir en bytes con el mismo contenido. Por eso, de SHA256SUMS se comparan
// las líneas que no son .gz; cada .gz se valida contra su propia línea y contra
// el asset al que acompaña.
//
// Hace falta la web compilada (corepack pnpm@10.18.2 --filter @ace/web build).
// En CI, el checkout tiene que traer la historia (fetch-depth: 0): RELEASE.json
// lleva el último commit que tocó las fuentes.
//
// Uso: node scripts/check-release.mjs [--version x.y.z]
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { readMonorepoVersion } from '../apps/server/build.mjs';
import { APP_RELEASES_DIR, REPO_DIR, computeSums, createRelease, listFiles } from './release.mjs';

/** @param {string} sums */
const withoutGz = (sums) =>
  sums
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('.gz'))
    .join('\n');

/**
 * Diferencias entre la release commiteada y una recién montada.
 * @param {string} committed
 * @param {string} fresh
 * @returns {string[]}
 */
function compareReleases(committed, fresh) {
  /** @type {string[]} */
  const problems = [];
  const committedFiles = listFiles(committed);
  const freshFiles = listFiles(fresh);
  for (const file of freshFiles) {
    if (!committedFiles.includes(file)) problems.push(`falta en la commiteada: ${file}`);
  }
  for (const file of committedFiles) {
    if (!freshFiles.includes(file)) problems.push(`sobra en la commiteada: ${file}`);
  }

  const expectedSums = computeSums(committed);
  const committedSums = readFileSync(path.join(committed, 'SHA256SUMS'), 'utf8');
  if (committedSums !== expectedSums) {
    problems.push('SHA256SUMS no cuadra con los ficheros commiteados (el hook la daría por rota)');
  }

  for (const file of committedFiles.filter((name) => freshFiles.includes(name))) {
    const a = readFileSync(path.join(committed, file));
    const b = readFileSync(path.join(fresh, file));
    if (file === 'SHA256SUMS') {
      if (withoutGz(a.toString('utf8')) !== withoutGz(b.toString('utf8'))) {
        problems.push('SHA256SUMS: los hashes (sin contar los .gz) no son los del código');
      }
    } else if (file.endsWith('.gz')) {
      const plain = gunzipSync(a);
      if (!plain.equals(gunzipSync(b))) problems.push(`contenido distinto: ${file}`);
      const sibling = file.slice(0, -'.gz'.length);
      if (committedFiles.includes(sibling)) {
        if (!plain.equals(readFileSync(path.join(committed, sibling)))) {
          problems.push(`${file} no es ${sibling} comprimido`);
        }
      }
    } else if (!a.equals(b)) {
      problems.push(`bytes distintos: ${file}`);
    }
  }
  return problems;
}

async function main() {
  const { values } = parseArgs({ options: { version: { type: 'string' } } });
  const version = values.version ?? readMonorepoVersion();
  const committed = path.join(APP_RELEASES_DIR, version);
  const shown = path.relative(REPO_DIR, committed).split(path.sep).join('/');
  if (!existsSync(committed)) throw new Error(`no existe ${shown}`);

  const work = mkdtempSync(path.join(os.tmpdir(), 'aceneo-check-release-'));
  try {
    const fresh = await createRelease({
      out: work,
      version,
      allowIncomplete: false,
      log: () => {},
    });
    const problems = compareReleases(committed, fresh.dir);
    if (!/^[0-9a-f]{40}$/.test(fresh.commit)) {
      problems.push(
        `commit de las fuentes "${fresh.commit}": hay cambios sin commitear en las fuentes ` +
          'o el checkout no trae la historia (en CI, fetch-depth: 0)',
      );
    }
    if (problems.length > 0) {
      console.error(`La release commiteada en ${shown} no es la que sale del código:`);
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error(
        'Vuelve a montarla (corepack pnpm@10.18.2 --filter @ace/web build && ' +
          'corepack pnpm@10.18.2 release) y commitéala.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `${shown}: ${fresh.files.length} ficheros, idéntica a la que sale del código ` +
        `(commit ${fresh.commit}).`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`check-release.mjs: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
