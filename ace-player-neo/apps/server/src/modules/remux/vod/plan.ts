/* Segmentos de un título VOD sobre sus fotogramas clave (docs/vod.md §9.5).
   Puro.

   - Voraces: cada segmento empieza en un fotograma clave del índice y dura
     al menos `segmentMinS` (6 s); el último resto, si queda corto, se junta
     con el anterior. Los mismos para cualquier punto de reinicio: por eso
     los junta el servidor y no el troceador HLS de ffmpeg (§9.2, hallazgo 6).
   - La lista empieza en 0: el primer segmento cubre [0, segundo fotograma
     clave que abre segmento), aunque el primer fotograma clave esté en
     0,021 s (lista de edición con entrada vacía, P1).
   - `placeFragment` dice a qué segmento va un fragmento fMP4 por su tiempo
     de presentación (`tfdt` + desfase de la primera muestra − `elst`, P4):
     al fotograma clave más cercano del índice con un margen de 0,2 s; si
     ese fotograma clave abre segmento, lo abre; si no (o si no hay ninguno
     cerca: Cues que no apuntan todos los fotogramas clave), va dentro del
     segmento en curso. */

import { VOD_PLAY } from '@ace/shared';

export interface VodSegment {
  readonly index: number;
  /** Inicio en la lista (el primero, 0). */
  readonly startS: number;
  readonly endS: number;
  /** Posición en `keyframes` del fotograma clave que lo abre. */
  readonly keyframe: number;
  /** Su tiempo (el que tiene que dar el primer fragmento del segmento). */
  readonly keyframeS: number;
}

export interface VodPlan {
  readonly segments: readonly VodSegment[];
  readonly durationS: number;
  /** `#EXT-X-TARGETDURATION`: el techo del segmento más largo. */
  readonly targetDurationS: number;
}

/** Margen para casar un fragmento con un fotograma clave del índice (P4). */
export const FRAGMENT_TOLERANCE_S = 0.2;

/** Duración de un segmento tal como sale en la lista (3 decimales). */
export function extinf(segment: VodSegment): number {
  return Math.round((segment.endS - segment.startS) * 1000) / 1000;
}

export function planSegments(
  keyframes: Float64Array,
  durationS: number,
  minS: number = VOD_PLAY.segmentMinS,
): VodPlan {
  const duration = Math.max(0.001, durationS);
  /* Los fotogramas clave del final que no dejan ni un cuadro detrás no abren nada. */
  const usable: number[] = [];
  for (const time of keyframes) if (time < duration - 0.001) usable.push(time);
  if (!usable.length) usable.push(0);
  const starts: number[] = [0];
  let current = 0;
  let segmentStart = 0;
  for (let k = 1; k < usable.length; k += 1) {
    const time = usable[k] as number;
    if (time - segmentStart >= minS) {
      starts.push(k);
      current = k;
      segmentStart = time;
    }
  }
  /* Un último trozo corto va con el anterior. */
  if (starts.length > 1 && duration - (usable[current] as number) < minS) starts.pop();
  const segments: VodSegment[] = starts.map((k, i) => {
    const next = starts[i + 1];
    return {
      index: i,
      startS: i === 0 ? 0 : (usable[k] as number),
      endS: next === undefined ? duration : (usable[next] as number),
      keyframe: k,
      keyframeS: usable[k] as number,
    };
  });
  const longest = Math.max(...segments.map(extinf));
  return { segments, durationS: duration, targetDurationS: Math.max(1, Math.ceil(longest)) };
}

/** Segmento que contiene el tiempo `t` (fuera del rango, el primero o el último). */
export function segmentAt(plan: VodPlan, timeS: number): number {
  const { segments } = plan;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((segments[mid] as VodSegment).startS <= timeS) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Posición del fotograma clave más cercano a `t` (o -1 si no hay). */
export function nearestKeyframe(keyframes: Float64Array, timeS: number): number {
  if (!keyframes.length) return -1;
  let low = 0;
  let high = keyframes.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((keyframes[mid] as number) < timeS) low = mid + 1;
    else high = mid;
  }
  if (low > 0) {
    const before = keyframes[low - 1] as number;
    if (Math.abs(before - timeS) <= Math.abs((keyframes[low] as number) - timeS)) return low - 1;
  }
  return low;
}

export type FragmentPlace =
  /** Empieza en el fotograma clave que abre este segmento. */
  | { readonly kind: 'opens'; readonly segment: number }
  /** Va dentro de este segmento (no abre ninguno). */
  | { readonly kind: 'inside'; readonly segment: number };

/** A qué segmento va un fragmento que empieza en `ptsS` (P4). */
export function placeFragment(
  plan: VodPlan,
  keyframes: Float64Array,
  ptsS: number,
  toleranceS: number = FRAGMENT_TOLERANCE_S,
): FragmentPlace {
  const k = nearestKeyframe(keyframes, ptsS);
  if (k >= 0 && Math.abs((keyframes[k] as number) - ptsS) <= toleranceS) {
    const time = keyframes[k] as number;
    const segment = segmentAt(plan, time);
    const owner = plan.segments[segment] as VodSegment;
    if (Math.abs(owner.keyframeS - time) < 1e-9) return { kind: 'opens', segment };
    return { kind: 'inside', segment };
  }
  return { kind: 'inside', segment: segmentAt(plan, ptsS) };
}
