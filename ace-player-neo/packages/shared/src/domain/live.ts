/* Directo: ventana de búsqueda y borde útil, portados FIELMENTE de
   player-controller.js:17-57 (T-131, T-132). Van aquí y no en la web porque
   la app iOS aplica la misma regla sobre `seekableTimeRanges` y comparte la
   tabla de casos. Sin DOM: basta con algo que se parezca a TimeRanges. */

import { PLAYBACK_PROFILES, type PlaybackMode } from '../constants/playback.js';

/** Lo mínimo de `TimeRanges` que hace falta (el de verdad o uno falso en los tests). */
export interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

/** Lo mínimo de `HTMLMediaElement` que lee `readSeekWindow`. */
export interface SeekableMediaLike {
  readonly seekable?: TimeRangesLike | null;
  readonly currentTime: number;
}

export interface SeekWindow {
  start: number;
  end: number;
  duration: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function rangeValue(ranges: TimeRangesLike, method: 'start' | 'end', index: number): number | null {
  try {
    const value = ranges[method](index);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * La ventana de directo es el rango `seekable` que contiene la reproducción
 * (con 0,25 s de margen); si ninguno la contiene, el último.
 */
export function readSeekWindow(media: SeekableMediaLike | null | undefined): SeekWindow | null {
  const ranges = media && media.seekable;
  if (!media || !ranges || !ranges.length) return null;
  const current = Number.isFinite(media.currentTime) ? media.currentTime : 0;
  let selected = ranges.length - 1;
  for (let index = 0; index < ranges.length; index += 1) {
    const start = rangeValue(ranges, 'start', index);
    const end = rangeValue(ranges, 'end', index);
    if (start !== null && end !== null && current >= start - 0.25 && current <= end + 0.25) {
      selected = index;
      break;
    }
  }
  const start = rangeValue(ranges, 'start', selected);
  const end = rangeValue(ranges, 'end', selected);
  if (start === null || end === null || end <= start) return null;
  return { start, end, duration: end - start };
}

/* En una emisión el último timestamp anunciado no siempre es reproducible:
   llegar hasta él vacía el colchón y obliga a parar. El borde LIVE útil es
   el punto más avanzado que todavía conserva el búfer de seguridad elegido. */
export function resolveLiveTarget(
  range: SeekWindow | null | undefined,
  preferredTarget?: number | null,
  safetySeconds = 0,
): number | null {
  if (
    !range ||
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    !Number.isFinite(range.duration) ||
    range.duration <= 0
  )
    return null;
  const requestedSafety = Number.isFinite(safetySeconds) ? Math.max(0, safetySeconds) : 0;
  const availableSafety = Math.min(requestedSafety, Math.max(0, range.duration - 0.5));
  const safeEdge = range.end - availableSafety;
  const preferred =
    typeof preferredTarget === 'number' && Number.isFinite(preferredTarget)
      ? preferredTarget
      : safeEdge;
  return clamp(Math.min(preferred, safeEdge), range.start, range.end);
}

/**
 * Colchón que deja "Ir al directo" (index.html:5030), tal cual:
 * `min(rebuild del modo || 4, max(1,2, duración de la ventana × 0,25))`.
 * Igual que en la 0.6.59, la duración se usa sin sanear: siempre sale de
 * `readSeekWindow`, que solo devuelve ventanas finitas y positivas.
 */
export function liveBufferSafety(mode: PlaybackMode, windowDurationS: number): number {
  const rebuild = PLAYBACK_PROFILES[mode]?.rebuild || 4;
  return Math.min(rebuild, Math.max(1.2, windowDurationS * 0.25));
}
