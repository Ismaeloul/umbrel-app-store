/* Carruseles horizontales que NO se recolocan solos (regla 1 del inventario):
   la tira de días y el carril de fuentes conservan su scroll al repintar y
   solo se mueven para enseñar el elemento activo la primera vez o cuando el
   activo cambia. Nunca con scrollIntoView, que movería también la página en
   vertical. */

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from './media.ts';

/** Desplaza SOLO en horizontal el carrusel para centrar (o dejar visible) el hijo. */
export function scrollChildIntoView(
  container: HTMLElement,
  child: HTMLElement,
  mode: 'center' | 'nearest' = 'center',
  smooth = true,
): void {
  const box = container.getBoundingClientRect();
  const item = child.getBoundingClientRect();
  let delta = 0;
  if (mode === 'center') {
    delta = item.left + item.width / 2 - (box.left + box.width / 2);
  } else if (item.left < box.left) {
    delta = item.left - box.left - 12;
  } else if (item.right > box.right) {
    delta = item.right - box.right + 12;
  }
  if (Math.abs(delta) < 1) return;
  container.scrollTo({
    left: container.scrollLeft + delta,
    behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
  });
}

/**
 * Enseña el elemento activo de un carrusel solo cuando `activeKey` cambia (y
 * la primera vez, sin animación). Los repintados con la misma clave no mueven
 * nada aunque cambie el contenido.
 */
export function useKeepActiveVisible(
  containerRef: RefObject<HTMLElement | null>,
  activeKey: string | number | null | undefined,
  findActive: (container: HTMLElement) => HTMLElement | null = (c) =>
    c.querySelector<HTMLElement>(
      '[aria-current="true"], [aria-selected="true"], [aria-pressed="true"]',
    ),
  mode: 'center' | 'nearest' = 'center',
): void {
  const last = useRef<string | number | null | undefined>(undefined);
  const first = useRef(true);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || activeKey === null || activeKey === undefined) return;
    if (!first.current && last.current === activeKey) return;
    const active = findActive(container);
    if (active) scrollChildIntoView(container, active, mode, !first.current);
    first.current = false;
    last.current = activeKey;
  });
}

/** Píxeles de una «línea» de rueda (deltaMode 1, Firefox con ratón). */
const WHEEL_LINE_PX = 40;

/**
 * Mayús + rueda desplaza el carrusel a los lados en el navegador que no lo
 * hace solo. La rueda vertical SIN Mayús no se toca nunca: baja la página
 * aunque el ratón esté encima de un carrusel (lo pidió Isma en la 0.9.0; hasta
 * entonces la rueda movía la fila, como la tira de días de la 0.6.59, y no se
 * podía bajar con el ratón encima de una tarjeta). Lo horizontal de verdad (el
 * touchpad, o Mayús + rueda en Chrome, Edge y Safari, que ya llegan con
 * `deltaX`) lo desplaza el propio navegador: aquí no se toca.
 *
 * Con `scrollBy` y no asignando `scrollLeft`: con `scroll-snap` obligatorio,
 * Chrome devuelve una asignación corta (100 px de una muesca en carteles de
 * 218) al cartel de antes y la fila no se movería; `scrollBy` lleva dirección
 * y pasa al siguiente.
 */
export function shiftWheelToHorizontal(event: WheelEvent, container: HTMLElement): void {
  if (!event.shiftKey || event.ctrlKey || event.deltaX !== 0 || event.deltaY === 0) return;
  const max = container.scrollWidth - container.clientWidth;
  if (max <= 0) return;
  const unit =
    event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? container.clientWidth : 1;
  const delta = event.deltaY * unit;
  // En el extremo hacia el que va, la rueda sigue su camino (no se la queda).
  if ((delta < 0 && container.scrollLeft <= 0) || (delta > 0 && container.scrollLeft >= max - 1))
    return;
  event.preventDefault();
  container.scrollBy({ left: delta, behavior: 'auto' });
}
