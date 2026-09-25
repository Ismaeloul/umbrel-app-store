/* QR «de mentira»: cuadrados pseudoaleatorios deterministas a partir del
   código, con los tres patrones de esquina para que parezca real. */

import type { ReactElement } from 'react';
import { mulberry32 } from '../../../core/data/rng';

export function FakeQr({ seed, size = 160, className, light = false }: { seed: string; size?: number; className?: string; light?: boolean }) {
  const n = 29;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = mulberry32(h || 1);
  const cells: boolean[] = [];
  for (let i = 0; i < n * n; i++) cells.push(rand() < 0.46);
  const isFinder = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  const finder = (ox: number, oy: number) => {
    const out: ReactElement[] = [];
    out.push(<rect key={`f${ox}${oy}a`} x={ox} y={oy} width={7} height={7} fill="currentColor" />);
    out.push(<rect key={`f${ox}${oy}b`} x={ox + 1} y={oy + 1} width={5} height={5} fill={light ? '#fff' : 'var(--co-bg-2)'} />);
    out.push(<rect key={`f${ox}${oy}c`} x={ox + 2} y={oy + 2} width={3} height={3} fill="currentColor" />);
    return out;
  };
  const rects: ReactElement[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (isFinder(x, y)) continue;
      // línea de tiempo
      if ((y === 6 || x === 6) && (x + y) % 2 === 0) {
        rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />);
        continue;
      }
      if (cells[y * n + x]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />);
    }
  }
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR para emparejar" style={{ display: 'block', color: light ? '#111' : 'var(--co-ink)' }}>
      <rect x={0} y={0} width={n} height={n} fill={light ? '#fff' : 'var(--co-bg-2)'} />
      {rects}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
}
