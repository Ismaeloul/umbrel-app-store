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

/** La rueda vertical del ratón desplaza el carrusel en horizontal (como la tira de días de la 0.6.59). */
export function wheelToHorizontal(event: WheelEvent, container: HTMLElement): void {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const max = container.scrollWidth - container.clientWidth;
  if (max <= 0) return;
  const next = Math.min(max, Math.max(0, container.scrollLeft + event.deltaY));
  if (next === container.scrollLeft) return;
  event.preventDefault();
  container.scrollLeft = next;
}
