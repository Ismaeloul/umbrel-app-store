/* Los carteles con la portada en filas (muchas imágenes y una cola de
   carteles en el servidor que contesta 503 si se llena):
   - una imagen perezosa no se pide hasta que su sitio se acerca a la pantalla;
   - si falla, 3 reintentos con esperas crecientes;
   - rendida, un intento más al salir de la pantalla y volver a entrar;
   - sin imagen, un cartel se pinta con el título (o con lo que diga `fallback`). */

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { Art, ART_NEAR_MARGIN, ART_RETRY_DELAYS_MS, ART_RETRY_MS } from './Art.tsx';

const ID = 'a'.repeat(40);

/** Un IntersectionObserver de mentira: la prueba dice qué entra y qué sale. */
let observers: Array<{
  cb: IntersectionObserverCallback;
  nodes: Element[];
  init: IntersectionObserverInit | undefined;
}> = [];
class FakeObserver {
  private entry: (typeof observers)[number];
  constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    this.entry = { cb, nodes: [], init };
    observers.push(this.entry);
  }
  observe(node: Element) {
    this.entry.nodes.push(node);
  }
  disconnect() {
    this.entry.nodes = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

/** Avisa a los observadores que miran `node` de si se ve o no. */
function intersect(node: Element, isIntersecting: boolean) {
  act(() => {
    for (const entry of [...observers])
      if (entry.nodes.includes(node))
        entry.cb(
          [{ isIntersecting, target: node } as unknown as IntersectionObserverEntry],
          entry as unknown as IntersectionObserver,
        );
  });
}

function fail(container: HTMLElement) {
  const img = container.querySelector('img');
  expect(img).not.toBeNull();
  fireEvent.error(img!);
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.useFakeTimers();
  observers = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetMode();
});

describe('Art', () => {
  it('reintenta 3 veces con esperas crecientes y, si sigue fallando, se queda el relleno', () => {
    const { container } = render(<Art id={ID} art="poster" v="abcdef01" title="Dune" />);
    const first = container.querySelector('img');
    const src = first?.getAttribute('src');
    for (const delay of ART_RETRY_DELAYS_MS) {
      fail(container);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'fill');
      // Antes de su espera, nada; pasada la espera (más el azar), otra vez.
      wait(delay - 1);
      expect(container.querySelector('img')).toBeNull();
      wait(1001);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
    }
    expect(ART_RETRY_DELAYS_MS[0]).toBe(ART_RETRY_MS);
    expect([...ART_RETRY_DELAYS_MS]).toEqual([...ART_RETRY_DELAYS_MS].sort((a, b) => a - b));
    // La que llega, se ve.
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'image');
    // El 4.º fallo: rendida.
    fail(container);
    wait(60_000);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'fill');
  });

  it('una imagen perezosa se pide al acercarse a la pantalla; la de la cabecera, ya', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { container } = render(<Art id={ID} art="poster" v="abcdef01" title="Dune" />);
    const art = container.querySelector('.cine-art')!;
    expect(container.querySelector('img')).toBeNull();
    // Mientras tanto, el relleno «cargando» (el mismo aspecto que con la imagen en camino).
    expect(art).toHaveAttribute('data-state', 'loading');
    expect(observers[0]?.init?.rootMargin).toBe(ART_NEAR_MARGIN);
    intersect(art, true);
    expect(container.querySelector('img')).not.toBeNull();
    const eager = render(<Art id={ID} art="backdrop" v="abcdef01" title="Dune" eager />);
    expect(eager.container.querySelector('img')).not.toBeNull();
  });

  it('rendida, prueba otra vez cuando la tarjeta sale de la pantalla y vuelve', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { container } = render(<Art id={ID} art="poster" v="abcdef01" title="Dune" />);
    const art = container.querySelector('.cine-art')!;
    intersect(art, true);
    fail(container);
    for (const delay of ART_RETRY_DELAYS_MS) {
      wait(delay + 1000);
      fail(container);
    }
    wait(60_000);
    expect(container.querySelector('img')).toBeNull();
    // Sigue a la vista: nada. Sale y vuelve: un intento más.
    intersect(art, true);
    expect(container.querySelector('img')).toBeNull();
    intersect(art, false);
    intersect(art, true);
    const again = container.querySelector('img');
    expect(again).not.toBeNull();
    fireEvent.load(again!);
    expect(art).toHaveAttribute('data-state', 'image');
  });

  it('sin imagen, un cartel lleva el título; un fotograma, el monograma', () => {
    const { container, rerender } = render(
      <Art id={ID} art="poster" v={null} title="La sociedad de la nieve" />,
    );
    expect(container.querySelector('.cine-art__name')?.textContent).toBe('La sociedad de la nieve');
    rerender(<Art id={ID} art="still" v={null} title="La sociedad de la nieve" />);
    expect(container.querySelector('.cine-art__mono')?.textContent).toBe('SN');
    rerender(<Art id={ID} art="backdrop" v={null} title="Dune" bare />);
    expect(container.querySelector('.cine-art__mono, .cine-art__name')).toBeNull();
  });

  it('con `fallback` (el número del episodio), eso en vez del monograma mientras carga o si falla', () => {
    const { container } = render(
      <Art
        id={ID}
        art="still"
        v="abcdef01"
        title="El plan"
        fallback={<span className="n">3</span>}
      />,
    );
    // Cargando: el número debajo, nunca «P».
    expect(container.querySelector('.n')?.textContent).toBe('3');
    expect(container.querySelector('.cine-art__mono')).toBeNull();
    fail(container);
    for (const delay of ART_RETRY_DELAYS_MS) {
      wait(delay + 1000);
      fail(container);
    }
    expect(container.querySelector('.n')?.textContent).toBe('3');
    expect(container.querySelector('.cine-art__mono')).toBeNull();
  });
});
