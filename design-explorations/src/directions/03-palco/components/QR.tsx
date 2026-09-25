/* QR generado en SVG: cuadrados pseudoaleatorios a partir del código, con
   los tres patrones de posición. No es un QR real: es una imagen del prototipo. */

import { useMemo } from 'react';
import { mulberry32 } from '../../../core/data/rng';

export function QR({ code, size = 200, className }: { code: string; size?: number; className?: string }) {
  const n = 25;
  const cells = useMemo(() => {
    const seed = [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rand = mulberry32(seed);
    const out: boolean[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inFinder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
        out.push(!inFinder && rand() < 0.46);
      }
    }
    return out;
  }, [code]);
  const cell = size / n;
  const finder = (ox: number, oy: number) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox * cell} y={oy * cell} width={7 * cell} height={7 * cell} fill="currentColor" />
      <rect x={(ox + 1) * cell} y={(oy + 1) * cell} width={5 * cell} height={5 * cell} fill="var(--pl-qr-bg, #fff)" />
      <rect x={(ox + 2) * cell} y={(oy + 2) * cell} width={3 * cell} height={3 * cell} fill="currentColor" />
    </g>
  );
  return (
    <svg className={`pl-qr ${className ?? ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Código QR para emparejar (${code})`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="var(--pl-qr-bg, #fff)" rx={size * 0.04} />
      {cells.map((on, i) => (on ? <rect key={i} x={(i % n) * cell} y={Math.floor(i / n) * cell} width={cell} height={cell} fill="currentColor" /> : null))}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
}
