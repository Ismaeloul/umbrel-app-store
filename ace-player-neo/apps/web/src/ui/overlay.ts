/* Pila de capas modales (hojas y menús) compartida por Sheet y Menu.

   - Solo la capa de arriba atiende Escape y la trampa de foco.
   - Mientras haya alguna abierta, el resto de la app (#root) queda `inert`:
     ni el foco ni los lectores de pantalla pueden salir de la capa.
   - Al cerrarse la última, se devuelve el foco a quien lo tenía antes de
     abrir la primera (inventario §26.36: trampa de foco y devolución). */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const stack: symbol[] = [];

export function overlayRoot(): HTMLElement {
  let root = document.getElementById('capas');
  if (!root) {
    root = document.createElement('div');
    root.id = 'capas';
    document.body.appendChild(root);
  }
  return root;
}

function appRoot(): HTMLElement | null {
  return document.getElementById('root');
}

export function pushOverlay(modal: boolean): symbol {
  const id = Symbol('capa');
  stack.push(id);
  if (modal) appRoot()?.setAttribute('inert', '');
  return id;
}

export function popOverlay(id: symbol): void {
  const index = stack.indexOf(id);
  if (index >= 0) stack.splice(index, 1);
  if (stack.length === 0) appRoot()?.removeAttribute('inert');
}

export function isTopOverlay(id: symbol): boolean {
  return stack.at(-1) === id;
}

export function hasOverlay(): boolean {
  return stack.length > 0;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      !el.hasAttribute('inert') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      !el.closest('[hidden]'),
  );
}

/** Tab y Mayús+Tab dan la vuelta dentro del contenedor. */
export function trapTab(event: KeyboardEvent | ReactKeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const items = focusableIn(container);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
