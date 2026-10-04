/* Tasa de bits de un título cerca del cabezal (auditoría 0.9.0), para el ritmo
   del relé VOD: la media del fichero entero (tamaño / duración) se queda
   corta en las escenas caras y el ritmo de 3× no daba abasto justo ahí. Con
   la posición en el fichero de cada fotograma clave (los CueClusterPosition
   de un MKV), la tasa es la de una ventana de vídeo desde donde se está. */

import type { VodIndex } from './types.js';

/** Ventana de vídeo con la que se mide la tasa cerca del cabezal (s). */
export const BITRATE_WINDOW_S = 120;

/**
 * La posición en el fichero de cada fotograma clave, alineada con `keyframes`
 * (NaN donde no se sabe), a partir de pares (tiempo, posición). null si no se
 * sabe ni la mitad.
 */
export function keyframeBytesOf(
  keyframes: Float64Array,
  pairs: readonly (readonly [number, number])[],
): Float64Array | null {
  if (!pairs.length || !keyframes.length) return null;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const out = new Float64Array(keyframes.length).fill(Number.NaN);
  let known = 0;
  let j = 0;
  for (let i = 0; i < keyframes.length; i += 1) {
    const time = keyframes[i] as number;
    while (j < sorted.length && (sorted[j] as readonly [number, number])[0] < time - 1e-3) j += 1;
    const pair = sorted[j];
    if (pair && Math.abs(pair[0] - time) <= 1e-3 && Number.isFinite(pair[1])) {
      out[i] = pair[1];
      known += 1;
    }
  }
  return known * 2 >= keyframes.length ? out : null;
}

/**
 * Bytes por segundo del vídeo en `[fromS, fromS + windowS]` según las posiciones
 * del índice (de fotograma clave a fotograma clave); null si el índice no las
 * trae o la ventana no da para medir.
 */
export function bitrateNear(
  index: VodIndex,
  fromS: number,
  windowS = BITRATE_WINDOW_S,
): number | null {
  const bytes = index.keyframeBytes;
  const times = index.keyframes;
  if (!bytes || bytes.length !== times.length) return null;
  let first = -1;
  for (let i = 0; i < times.length; i += 1) {
    if ((times[i] as number) > fromS + 1e-6 && first >= 0) break;
    if (Number.isFinite(bytes[i])) first = i;
  }
  if (first < 0) return null;
  const until = (times[first] as number) + windowS;
  let last = -1;
  for (let i = first + 1; i < times.length; i += 1) {
    if (Number.isFinite(bytes[i])) last = i;
    if ((times[i] as number) >= until) break;
  }
  let endBytes: number;
  let endS: number;
  if (last >= 0) {
    endBytes = bytes[last] as number;
    endS = times[last] as number;
  } else {
    /* Pasado el último fotograma clave conocido: hasta el final del fichero. */
    endBytes = index.sizeBytes;
    endS = index.durationS;
  }
  const spanS = endS - (times[first] as number);
  const spanBytes = endBytes - (bytes[first] as number);
  if (!(spanS >= 1) || !(spanBytes > 0)) return null;
  return spanBytes / spanS;
}
