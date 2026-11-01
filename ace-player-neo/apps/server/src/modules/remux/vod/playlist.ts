/* La lista HLS de un título VOD (docs/vod.md §9.5). Puro.

   Completa desde el primer momento (sale del índice, con `ENDLIST`): hls.js
   y AVPlayer ven la duración real, la barra entera, y pueden saltar a
   cualquier sitio. `EXT-X-START` solo si se reanuda (`startS > 0`): Safari y
   AVPlayer reanudan sin que el cliente tenga que saltar (hls.js usa su
   `startPosition`, que manda más). Los nombres son los de la ruta de vídeo
   de siempre (`index.m3u8`, `init.mp4`, `index<N>.m4s`), así que nginx, la
   ruta y el `?t=` del iPhone (`rewritePlaylist`) no cambian.

   «Calidad ligera para invitados» (docs/ver-juntos.md §17), solo por la ruta
   de la sala:
   - `lo.m3u8`: la MISMA lista con `lo_init.mp4` y `lo_index<N>.m4s` (el
     mismo plan, los mismos `EXTINF`, el mismo `EXT-X-START`): cada segmento
     ligero sale de su segmento original, con sus límites y sus tiempos.
   - `master.m3u8`: la ligera PRIMERO (AVPlayer empieza por la primera) y
     luego la original (`index.m3u8`), con `CODECS`, `BANDWIDTH` y
     `RESOLUTION`. El `BANDWIDTH` de la original es el pico por segmento
     según las posiciones del índice (o la media del fichero × 1,5): con la
     media, hls.js subía a la original justo antes de una escena cara. */

import { LITE_VOD } from '@ace/shared';
import { LITE_HEIGHT } from '../args.js';
import { LITE_AUDIO_CODECS, LITE_VIDEO_CODECS } from './lite-args.js';
import { extinf, type VodPlan } from './plan.js';
import type { VodIndex } from './types.js';

export const VOD_PLAYLIST_FILE = 'index.m3u8';
export const VOD_INIT_FILE = 'init.mp4';
/** Lo de la versión ligera (docs/ver-juntos.md §17): nombres planos, que caben en el proxy de la sala. */
export const LITE_PREFIX = 'lo_';
export const VOD_MASTER_FILE = 'master.m3u8';
export const LITE_PLAYLIST_FILE = 'lo.m3u8';
export const LITE_INIT_FILE = `${LITE_PREFIX}${VOD_INIT_FILE}`;

export function segmentFileName(index: number): string {
  return `index${index}.m4s`;
}

/** Número de segmento de `index<N>.m4s` (o null si no es un segmento). */
export function segmentIndexOf(file: string): number | null {
  const match = /^index(\d{1,6})\.m4s$/.exec(file);
  return match ? Number(match[1]) : null;
}

/** Número de segmento de `lo_index<N>.m4s` (o null si no es un segmento ligero). */
export function liteSegmentIndexOf(file: string): number | null {
  return file.startsWith(LITE_PREFIX) ? segmentIndexOf(file.slice(LITE_PREFIX.length)) : null;
}

export function buildVodPlaylist(
  plan: VodPlan,
  options: {
    readonly startS?: number;
    /** `lo_`: la lista de la versión ligera (mismos segmentos, otros nombres). */
    readonly prefix?: '' | typeof LITE_PREFIX;
  } = {},
): string {
  const prefix = options.prefix ?? '';
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
  lines.push(`#EXT-X-MAP:URI="${prefix}${VOD_INIT_FILE}"`);
  for (const segment of plan.segments) {
    lines.push(
      `#EXTINF:${extinf(segment).toFixed(3)},`,
      `${prefix}${segmentFileName(segment.index)}`,
    );
  }
  lines.push('#EXT-X-ENDLIST', '');
  return lines.join('\n');
}

/** Ancho y alto de la versión ligera: 720 de alto (sin agrandar) y el ancho par de `scale=-2`. */
export function liteResolution(
  width: number | null,
  height: number | null,
): { readonly width: number; readonly height: number } {
  const sourceH = height && height > 0 ? height : LITE_HEIGHT;
  const sourceW = width && width > 0 ? width : Math.round((sourceH * 16) / 9);
  const h = Math.min(LITE_HEIGHT, sourceH);
  /* Lo que hace `scale=-2:h`: el ancho proporcional, redondeado al par más cercano. */
  const w = Math.max(2, Math.round((sourceW * h) / sourceH / 2) * 2);
  return { width: w, height: h };
}

/** Bits por segundo de media del fichero entero (vídeo y audio). */
export function averageBitrate(index: VodIndex): number {
  return index.durationS > 0 ? (index.sizeBytes * 8) / index.durationS : 0;
}

/**
 * El pico de bits por segundo de un segmento de la original, con las posiciones de los fotogramas
 * clave del índice (`keyframeBytes`, las de un MKV); sin ellas, la media del fichero × 1,5.
 */
export function peakSegmentBitrate(index: VodIndex, plan: VodPlan): number {
  const bytes = index.keyframeBytes;
  let peak = 0;
  if (bytes && bytes.length === index.keyframes.length) {
    plan.segments.forEach((segment, i) => {
      const from = bytes[segment.keyframe];
      const next = plan.segments[i + 1];
      const to = next ? bytes[next.keyframe] : index.sizeBytes;
      const spanS = segment.endS - segment.startS;
      if (from === undefined || to === undefined) return;
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      if (to > from && spanS > 0.5) peak = Math.max(peak, ((to - from) * 8) / spanS);
    });
  }
  const average = averageBitrate(index);
  return Math.round(peak > 0 ? Math.max(peak, average) : average * 1.5);
}

export interface VodMasterInput {
  readonly index: VodIndex;
  readonly plan: VodPlan;
  /** Hay audio (siempre AAC-LC: copiado o convertido por el productor). */
  readonly audio: boolean;
}

/** `master.m3u8` de la sala (docs/ver-juntos.md §17): la ligera primero, luego la original. */
export function buildVodMaster(input: VodMasterInput): string {
  const { index, plan } = input;
  const withAudio = (video: string): string =>
    input.audio ? `${video},${LITE_AUDIO_CODECS}` : video;
  const lite = liteResolution(index.video.width, index.video.height);
  const hdResolution =
    index.video.width && index.video.height
      ? `,RESOLUTION=${index.video.width}x${index.video.height}`
      : '';
  const average = Math.round(averageBitrate(index));
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    `#EXT-X-STREAM-INF:BANDWIDTH=${LITE_VOD.bandwidth},AVERAGE-BANDWIDTH=${LITE_VOD.average},` +
      `CODECS="${withAudio(LITE_VIDEO_CODECS)}",RESOLUTION=${lite.width}x${lite.height}`,
    LITE_PLAYLIST_FILE,
    `#EXT-X-STREAM-INF:BANDWIDTH=${peakSegmentBitrate(index, plan)},` +
      `${average > 0 ? `AVERAGE-BANDWIDTH=${average},` : ''}` +
      `CODECS="${withAudio(index.video.codecs)}"${hdResolution}`,
    VOD_PLAYLIST_FILE,
    '',
  ].join('\n');
}
