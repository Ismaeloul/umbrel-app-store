/* Línea de tiempo de los segmentos HLS.

   El motor real numera los segmentos por contenido (`/ace/c/<infohash>/<n>.ts`,
   sin la sesión en la URL) y los hace de 4 a 6 s. Aquí las duraciones siguen
   un patrón cíclico de segundos enteros (por defecto 5, 4, 6, 5), así cada
   segmento empieza en un principio de GOP (el GOP es de 1 s) y se puede saber
   en O(1) qué segmento cubre cada instante sin recorrer los anteriores. */

export interface SegmentPlan {
  durations: readonly number[];
  prefix: readonly number[];
  cycleSec: number;
  targetDuration: number;
}

export function makeSegmentPlan(durations: readonly number[]): SegmentPlan {
  if (durations.length === 0 || durations.length > 64)
    throw new Error('entre 1 y 64 duraciones de segmento');
  for (const d of durations) {
    if (!Number.isInteger(d) || d < 1 || d > 10)
      throw new Error(`duración de segmento no válida: ${d} (enteros de 1 a 10 s)`);
  }
  const prefix: number[] = [];
  let sum = 0;
  for (const d of durations) {
    prefix.push(sum);
    sum += d;
  }
  return {
    durations: [...durations],
    prefix,
    cycleSec: sum,
    targetDuration: Math.max(...durations),
  };
}

export function segmentStartSec(plan: SegmentPlan, n: number): number {
  const length = plan.durations.length;
  return Math.floor(n / length) * plan.cycleSec + (plan.prefix[n % length] ?? 0);
}

export function segmentDurationSec(plan: SegmentPlan, n: number): number {
  return plan.durations[n % plan.durations.length] ?? 0;
}

/* Cuántos segmentos están completos en el instante `tSec` (los que acaban en
   `tSec` o antes). El siguiente número de segmento es este valor. */
export function completedSegments(plan: SegmentPlan, tSec: number): number {
  if (!(tSec > 0)) return 0;
  const length = plan.durations.length;
  const cycles = Math.floor(tSec / plan.cycleSec);
  const rest = tSec - cycles * plan.cycleSec;
  let inCycle = 0;
  for (let i = 0; i < length; i += 1) {
    if ((plan.prefix[i] ?? 0) + (plan.durations[i] ?? 0) <= rest) inCycle = i + 1;
    else break;
  }
  return cycles * length + inCycle;
}

/* Lista HLS viva, versión 3, con URL absolutas como el motor real. */
export function renderPlaylist(
  plan: SegmentPlan,
  from: number,
  toExclusive: number,
  segmentUrl: (n: number) => string,
): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${plan.targetDuration}`,
    `#EXT-X-MEDIA-SEQUENCE:${from}`,
  ];
  for (let n = from; n < toExclusive; n += 1) {
    lines.push(`#EXTINF:${segmentDurationSec(plan, n).toFixed(6)},`, segmentUrl(n));
  }
  return `${lines.join('\n')}\n`;
}
