/* La lista HLS de un título VOD (docs/vod.md §9.5). Puro.

   Completa desde el primer momento (sale del índice, con `ENDLIST`): hls.js
   y AVPlayer ven la duración real, la barra entera, y pueden saltar a
   cualquier sitio. `EXT-X-START` solo si se reanuda (`startS > 0`): Safari y
   AVPlayer reanudan sin que el cliente tenga que saltar (hls.js usa su
   `startPosition`, que manda más). Los nombres son los de la ruta de vídeo
   de siempre (`index.m3u8`, `init.mp4`, `index<N>.m4s`), así que nginx, la
   ruta y el `?t=` del iPhone (`rewritePlaylist`) no cambian. */

import { extinf, type VodPlan } from './plan.js';

export const VOD_PLAYLIST_FILE = 'index.m3u8';
export const VOD_INIT_FILE = 'init.mp4';

export function segmentFileName(index: number): string {
  return `index${index}.m4s`;
}

/** Número de segmento de `index<N>.m4s` (o null si no es un segmento). */
export function segmentIndexOf(file: string): number | null {
  const match = /^index(\d{1,6})\.m4s$/.exec(file);
  return match ? Number(match[1]) : null;
}

export function buildVodPlaylist(
  plan: VodPlan,
  options: { readonly startS?: number } = {},
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${plan.targetDurationS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  const startS = options.startS ?? 0;
  if (startS > 0 && Number.isFinite(startS)) {
    const clamped = Math.min(startS, Math.max(0, plan.durationS - 1));
    lines.push(`#EXT-X-START:TIME-OFFSET=${clamped.toFixed(3)},PRECISE=YES`);
  }
  lines.push(`#EXT-X-MAP:URI="${VOD_INIT_FILE}"`);
  for (const segment of plan.segments) {
    lines.push(`#EXTINF:${extinf(segment).toFixed(3)},`, segmentFileName(segment.index));
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}
