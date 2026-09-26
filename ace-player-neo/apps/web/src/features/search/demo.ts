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
import { DEMO_IPTV_SEARCH, demoIptvId, fakeHash } from './demo-ids.ts';

export { DEMO_IPTV_SEARCH, demoIptvId };

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

/* Calidades de los canales de la IPTV de ejemplo (una fila por canal, §16): «DAZN 1» y «DAZN LaLiga» tienen varias. */
const DEMO_QUALITIES: Readonly<Record<string, ('uhd' | 'fhd' | 'hd' | 'sd')[]>> = {
  'DAZN 1': ['uhd', 'fhd', 'hd', 'sd'],
  'DAZN LaLiga': ['fhd', 'hd'],
};

export function demoIptvChannels(query: string): IptvChannelsResponse {
  const q = foldText(query).slice(0, 80);
  const channels = DEMO_IPTV_SEARCH.filter(([title]) => foldText(title).includes(q)).map(
    ([title, quality]) => ({
      id: demoIptvId(title),
      title,
      quality,
      qualities: DEMO_QUALITIES[title] ?? [quality],
      country: null,
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
