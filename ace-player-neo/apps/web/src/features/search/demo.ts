/* Buscador en el modo demo. El ejemplo de @ace/shared devuelve siempre el
   mismo resultado; aquí se filtra un catálogo pequeño de muestra por el texto
   escrito, para que la demo enseñe también «Sin resultados». Los hashes son
   inventados (40 hexadecimales) y se marcan como infohash, como los de verdad.
   Solo se registra una vez, al cargar el trozo del buscador.

   IPTV (docs/iptv.md §14.8): `iptvChannels` contesta con los canales de la
   «IPTV de ejemplo» de demo-5 («Casa») y los resultados del motor que son
   uno de esos canales («DAZN LaLiga», «M+ LaLiga TV»…) llevan su id
   (`iptv`), así se ve cómo un canal sale una sola vez. Los ids son los mismos
   que da la resolución de la demo. */

import type { IptvChannelsResponse, SearchResponse } from '@ace/shared';
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

/** Canales de la IPTV de ejemplo (demo-5, «Casa»): nombre limpio y calidad. */
export const DEMO_IPTV_SEARCH: ReadonlyArray<[string, 'fhd' | 'hd']> = [
  ['DAZN LaLiga', 'fhd'],
  ['DAZN 1', 'fhd'],
  ['M+ LaLiga TV', 'fhd'],
  ['M+ Liga de Campeones', 'fhd'],
  ['M+ Liga de Campeones 2', 'hd'],
  ['Telecinco', 'hd'],
  ['laSexta', 'hd'],
  ['La 1', 'hd'],
];

/** Id de un canal de la IPTV de ejemplo (el mismo en el buscador y en la resolución). */
export function demoIptvId(title: string): string {
  return fakeHash(`iptv|${foldText(title)}`);
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
      ...(DEMO_IPTV_SEARCH.some(([name]) => name === title) ? { iptv: demoIptvId(title) } : {}),
    }));
  return { query: q, results };
}

export function demoIptvChannels(query: string): IptvChannelsResponse {
  const q = foldText(query).slice(0, 80);
  const channels = DEMO_IPTV_SEARCH.filter(([title]) => foldText(title).includes(q)).map(
    ([title, quality]) => ({
      id: demoIptvId(title),
      title,
      quality,
      provider: 'Casa',
      library: [],
    }),
  );
  return { query: q, total: channels.length, capped: false, channels };
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
  registerDemoHandler('iptvChannels', async ({ query }) => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return demoIptvChannels(String(query?.q ?? ''));
  });
}
