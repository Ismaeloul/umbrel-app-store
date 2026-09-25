/* Código QR «de atrezo»: tres patrones de posición reales y el resto de
   módulos pseudoaleatorios sembrados con el código. Nada descargado. */

import { mulberry32 } from '../../../core/data/rng';

const N = 25;

function finder(x: number, y: number, cx: number, cy: number): boolean | null {
  const dx = x - cx;
  const dy = y - cy;
  if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
  const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
  return ring === 3 || ring <= 1;
}

export function QR({ code, size = 180, className }: { code: string; size?: number; className?: string }) {
  const seed = [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rand = mulberry32(seed);
  const cells: string[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const f = finder(x, y, 0, 0) ?? finder(x, y, N - 7, 0) ?? finder(x, y, 0, N - 7);
      let on: boolean;
      if (f !== null) on = f;
      else if ((x === 7 && y < 8) || (y === 7 && x < 8) || (x === N - 8 && y < 8) || (y === 7 && x > N - 9) || (y === N - 8 && x < 8) || (x === 7 && y > N - 9)) on = false;
      else if (y === 6 || x === 6) on = (x + y) % 2 === 0;
      else on = rand() < 0.46;
      if (on) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return (
    <svg className={`tr-qr${className ? ` ${className}` : ''}`} width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} role="img" aria-label={`Código QR para emparejar con el código ${code}`} shapeRendering="crispEdges">
      <rect x="-1" y="-1" width={N + 2} height={N + 2} fill="var(--tr-paper-2)" />
      <path d={cells.join('')} fill="var(--tr-ink)" />
    </svg>
  );
}
