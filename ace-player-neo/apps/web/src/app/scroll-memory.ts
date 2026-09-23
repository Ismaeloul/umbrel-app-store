/* Cada vista conserva su scroll al ir y volver (regla 4 del inventario: «se
   conservan el scroll, los acordeones y el día elegido»). Las vistas siguen
   montadas (Activity) con su estado; aquí solo se guarda la posición de la
   página, porque en el móvil desplaza el documento entero. */

import { formatVista, type Route } from './routes.ts';

const positions = new Map<string, number>();

/** La agenda es la misma vista aunque cambie el día; un partido distinto empieza arriba. */
export function scrollKey(route: Route): string {
  return route.vista === 'partido' ? formatVista(route) : route.vista;
}

export function saveScroll(route: Route, y = globalThis.scrollY ?? 0): void {
  positions.set(scrollKey(route), Math.max(0, Math.round(y)));
}

export function savedScroll(route: Route): number {
  return positions.get(scrollKey(route)) ?? 0;
}

export function restoreScroll(route: Route): void {
  const y = savedScroll(route);
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  } catch {
    window.scrollTo(0, y);
  }
}

/** Solo para los tests. */
export function resetScrollMemory(): void {
  positions.clear();
}
