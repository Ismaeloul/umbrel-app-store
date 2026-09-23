/* T-088 · "el emparejador del cliente y el del servidor dicen lo mismo"
   (B-173). En la 0.6.59 había dos copias (server.js e index.html) y el test
   las comparaba; ya divergieron una vez. En la v2 hay una sola
   implementación en @ace/shared, así que la paridad es estructural. Lo que
   queda es la tabla de referencia: la matriz 16×16 de nombres reales con los
   valores de la 0.6.59, congelada en JSON por scripts/freeze-t088.ts. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { channelMatchScore } from '../src/index.js';
import { T088_CHANNEL_NAMES } from '../scripts/lib/legacy-0659.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const matrix = JSON.parse(
  readFileSync(path.join(here, 'fixtures/t088-channel-matrix.json'), 'utf8'),
) as { names: string[]; scores: number[][] };

describe('T-088 · matriz 16×16 congelada de la 0.6.59', () => {
  it('la tabla tiene los 16 nombres del test original, en su orden', () => {
    expect(matrix.names).toEqual([...T088_CHANNEL_NAMES]);
    expect(matrix.scores).toHaveLength(16);
    for (const row of matrix.scores) expect(row).toHaveLength(16);
  });

  it('channelMatchScore de @ace/shared da exactamente los valores congelados', () => {
    const discrepancias: string[] = [];
    matrix.names.forEach((a, i) => {
      matrix.names.forEach((b, j) => {
        const esperado = matrix.scores[i]?.[j];
        const actual = channelMatchScore(a, b);
        if (actual !== esperado)
          discrepancias.push(`"${a}" / "${b}": ${actual} (0.6.59: ${esperado})`);
      });
    });
    expect(discrepancias).toEqual([]);
  });

  it('apps/web no redefine channelMatchScore (una sola implementación)', () => {
    const webSrc = path.resolve(here, '../../../apps/web/src');
    const ficheros: string[] = [];
    const recorrer = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) recorrer(full);
        else if (/\.(tsx?|jsx?)$/.test(name)) ficheros.push(full);
      }
    };
    if (existsSync(webSrc)) recorrer(webSrc);
    const redefinen = ficheros.filter((file) =>
      /function\s+channelMatchScore\s*\(|channelMatchScore\s*=\s*(?:\(|function)/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(redefinen).toEqual([]);
  });
});
