/* Congela la matriz 16×16 de T-088 ejecutando el channelMatchScore ORIGINAL
   de la 0.6.59 (tests/server.test.js:1473). El JSON resultante es la tabla de
   referencia: si alguien cambia el emparejador de @ace/shared, el test
   t088-matrix lo detecta aunque la 0.6.59 ya no esté a mano.

   Uso: corepack pnpm@10.18.2 --filter @ace/shared exec tsx scripts/freeze-t088.ts
   Solo hay que volver a ejecutarlo si se decide a propósito cambiar la regla
   (y entonces hay que anotarlo en docs/compat.md). */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { T088_CHANNEL_NAMES, loadLegacyServer } from './lib/legacy-0659.js';

export const T088_MATRIX_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/t088-channel-matrix.json',
);

export function buildT088Matrix(): {
  origen: string;
  names: string[];
  scores: number[][];
} {
  const legacy = loadLegacyServer();
  return {
    origen:
      'channelMatchScore de ismaeloul-ace-player-neo/releases/0.6.59/server.js (T-088); filas = pedido, columnas = candidato',
    names: [...T088_CHANNEL_NAMES],
    scores: T088_CHANNEL_NAMES.map((a) =>
      T088_CHANNEL_NAMES.map((b) => legacy.channelMatchScore(a, b)),
    ),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrix = buildT088Matrix();
  /* Una fila por línea: así el diff de un cambio se lee de un vistazo. */
  const rows = matrix.scores.map((row) => `    [${row.join(', ')}]`).join(',\n');
  const names = matrix.names.map((name) => `    ${JSON.stringify(name)}`).join(',\n');
  const json = `{\n  "origen": ${JSON.stringify(matrix.origen)},\n  "names": [\n${names}\n  ],\n  "scores": [\n${rows}\n  ]\n}\n`;
  writeFileSync(T088_MATRIX_FILE, json);
  console.log(`matriz T-088 escrita en ${T088_MATRIX_FILE}`);
}
