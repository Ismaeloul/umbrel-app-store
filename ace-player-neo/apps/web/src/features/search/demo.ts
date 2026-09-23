/* Buscador en el modo demo. El ejemplo de @ace/shared devuelve siempre el
   mismo resultado; aquí se filtra un catálogo pequeño de muestra por el texto
   escrito, para que la demo enseñe también «Sin resultados». Los hashes son
   inventados (40 hexadecimales) y se marcan como infohash, como los de verdad.
   Solo se registra una vez, al cargar el trozo del buscador. */

import type { SearchResponse } from '@ace/shared';
import { registerDemoHandler } from '../../api/index.ts';
import { foldText } from '../library/model.ts';

const CATALOG: ReadonlyArray<[string, string, number]> = [
  ['DAZN 1 HD', 'Deportes', 0.92],
  ['DAZN 2 HD', 'Deportes', 0.81],
  ['DAZN LaLiga', 'Deportes', 0.95],
  ['DAZN LaLiga 2', 'Deportes', 0.58],
  ['M+ LaLiga TV', 'Deportes', 0.9],
  ['M+ Liga de Campeones', 'Deportes', 0.87],
  ['M+ Liga de Campeones 2', 'Deportes', 0.44],
  ['M+ Vamos', 'Deportes', 0.63],
  ['Eurosport 1', 'Deportes', 0.71],
  ['Eurosport 2', 'Deportes', 0.36],
  ['LaLiga TV Hypermotion', 'Deportes', 0.52],
  ['Gol Play', 'Deportes', 0.66],
  ['Teledeporte', 'Generalistas', 0.77],
  ['La 1', 'Generalistas', 0.83],
];

function fakeHash(seed: string): string {
  let h = 2166136261;
  let out = '';
  for (let round = 0; out.length < 40; round += 1) {
    for (const ch of `${seed}#${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

export function demoSearch(query: string): SearchResponse {
  const q = foldText(query).slice(0, 80);
  const results = CATALOG.filter(([title]) => foldText(title).includes(q))
    .sort((a, b) => b[2] - a[2])
    .map(([title, category, availability]) => ({
      id: fakeHash(title),
      title,
      category,
      availability,
      bitrate: null,
      ih: true as const,
    }));
  return { query: q, results };
}

let registered = false;
export function registerSearchDemo(): void {
  if (registered) return;
  registered = true;
  // Un poco de espera, como el motor de verdad: así se ve «Buscando…».
  registerDemoHandler('search', async ({ query }) => {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return demoSearch(String(query?.q ?? ''));
  });
}
