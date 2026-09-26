/* Preparación común de los tests (Vitest + jsdom + Testing Library).

   jsdom no trae matchMedia, EventSource, ResizeObserver ni scrollTo de
   verdad: aquí van versiones mínimas para que los componentes monten. Nada
   sale a la red: el cliente de la API se prueba con src/test/fetch.ts. */

import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/* Las vistas y secciones perezosas (Ajustes, IPTV, Sistema) se transforman la
   primera vez que se piden; con `pnpm -r test` el servidor corre sus pruebas a
   la vez y ese primer import puede pasar del segundo que dan por defecto
   findBy y waitFor. Cinco segundos quitan el falso rojo sin tapar fallos reales
   (una espera que falla de verdad sigue fallando, solo tarda más). */
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  document.getElementById('capas')?.remove();
  document.getElementById('root')?.removeAttribute('inert');
  document.documentElement.removeAttribute('style');
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
Element.prototype.scrollIntoView = vi.fn();

if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
}

if (!('CSS' in window) || typeof CSS.escape !== 'function') {
  Object.defineProperty(window, 'CSS', {
    configurable: true,
    writable: true,
    value: { escape: (value: string) => value.replace(/["\\]/g, '\\$&'), supports: () => false },
  });
}
