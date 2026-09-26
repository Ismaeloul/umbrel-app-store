/* Ids de muestra de la demo, puros (sin la capa de datos): los canales de la
   «IPTV de ejemplo» de demo-5 («Casa») y cómo se calcula su id. Los comparten
   el buscador de la demo (demo.ts), la resolución de la demo
   (sources/demo-data.ts) y la pestaña IPTV de Canales (library/iptv/demo.ts),
   y los puede importar el E2E desde Node. */

import { foldText } from '../library/model.ts';

/** 40 hexadecimales estables a partir de un texto (FNV-1a en vueltas). */
export function fakeHash(seed: string): string {
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
