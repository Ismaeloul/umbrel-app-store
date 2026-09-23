/* Emparejar en el modo demo. El ejemplo de @ace/shared trae un SVG vacío como
   QR, así que la demo enseñaría un hueco blanco. Aquí se dibuja un QR DE
   MUESTRA: tiene la forma de uno (los tres cuadros de las esquinas y módulos
   repartidos según el código) pero no codifica nada, y la vista lo rotula
   como «QR de muestra». En la demo no hay backend con el que emparejar.

   El código es aleatorio en cada petición (como el de verdad, uno nuevo anula
   el anterior) y dura lo mismo que el real (el `ttlMs` del ejemplo). */

import type { PairingCreateResponse } from '@ace/shared';
import { registerDemoHandler } from '../../api/index.ts';

const SIZE = 25;
const MARGIN = 2;

/** Módulos de un «QR» de adorno: marcas de esquina + ruido determinista a partir del código. */
export function demoQrSvg(code: string): string {
  let seed = 2166136261;
  for (const ch of code) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const finder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= SIZE - 8 && y < 8) || (x < 8 && y >= SIZE - 8);
  const cells: string[] = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (finder(x, y) || random() < 0.52) continue;
      cells.push(`M${x + MARGIN} ${y + MARGIN}h1v1h-1z`);
    }
  }
  // Las tres marcas de posición (7×7: aro, hueco y centro de 3×3).
  for (const [fx, fy] of [
    [0, 0],
    [SIZE - 7, 0],
    [0, SIZE - 7],
  ] as const) {
    const x = fx + MARGIN;
    const y = fy + MARGIN;
    cells.push(`M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z`, `M${x + 2} ${y + 2}h3v3h-3z`);
  }
  const full = SIZE + MARGIN * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">` +
    `<path fill="#ffffff" d="M0 0h${full}v${full}H0z"/>` +
    `<path fill="#000000" fill-rule="evenodd" d="${cells.join('')}"/></svg>`
  );
}

export function demoPairing(now = Date.now()): PairingCreateResponse {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const ttlMs = 300_000;
  const base = typeof location === 'undefined' ? 'http://umbrel.local:7792' : location.origin;
  return {
    code,
    expiresAt: new Date(now + ttlMs).toISOString(),
    ttlMs,
    pairUri: `aceneo://pair?u=${encodeURIComponent(base)}&c=${code}`,
    qrSvg: demoQrSvg(code),
  };
}

let registered = false;

export function registerDevicesDemo(): void {
  if (registered) return;
  registered = true;
  registerDemoHandler('pairingCreate', () => demoPairing());
}
