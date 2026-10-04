/* La sinopsis recortada vuelve a medirse al cambiar de tamaño: al girar el
   iPhone (844 → 390 px) un texto que cabía en 3 líneas deja de caber y tiene
   que salir «Más» (antes se quedaba cortado con «…» y sin forma de leerlo). */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Synopsis } from './Synopsis.tsx';

/** Un ResizeObserver de mentira: la prueba decide cuándo «cambia el tamaño». */
let observers: Array<{ callback: () => void; targets: Element[] }> = [];
const original = window.ResizeObserver;

class FakeResizeObserver {
  private entry: { callback: () => void; targets: Element[] };
  constructor(callback: () => void) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    observers = observers.filter((entry) => entry !== this.entry);
  }
}

/** El alto entero del texto y el del recorte (jsdom no maqueta: se fijan a mano). */
function setHeights(node: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scroll });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: client });
}

function resize() {
  act(() => {
    for (const entry of observers) entry.callback();
  });
}

beforeEach(() => {
  observers = [];
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });
});
afterEach(() => {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: original,
  });
});

describe('Synopsis', () => {
  it('«Más» aparece si el texto deja de caber al cambiar de ancho, y se va si vuelve a caber', () => {
    render(<Synopsis plot="Una sinopsis larga." title="Sinopsis" titleId="s" />);
    const text = screen.getByText('Una sinopsis larga.');
    // Ancho (horizontal): cabe en 3 líneas.
    expect(screen.queryByRole('button', { name: 'Más' })).toBeNull();
    expect(observers[0]?.targets).toContain(text);
    // Se gira a vertical: el texto pide 5 líneas y el recorte deja 3.
    setHeights(text, 110, 66);
    resize();
    const more = screen.getByRole('button', { name: 'Más' });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Menos' })).toHaveAttribute('aria-expanded', 'true');
    expect(text).not.toHaveClass('cine-synopsis__text--clamp');
    fireEvent.click(screen.getByRole('button', { name: 'Menos' }));
    // Otra vez en horizontal: cabe y «Más» se va.
    setHeights(text, 66, 66);
    resize();
    expect(screen.queryByRole('button', { name: 'Más' })).toBeNull();
  });

  it('con título va en su sección (para el lector de pantalla); sin él, solo el texto', () => {
    const { container, rerender } = render(
      <Synopsis plot="Texto." title="Sinopsis" titleId="cine-synopsis-title" />,
    );
    expect(screen.getByRole('region', { name: 'Sinopsis' })).toBeInTheDocument();
    rerender(<Synopsis plot="Texto." />);
    expect(container.querySelector('section')).toBeNull();
    expect(screen.getByText('Texto.')).toBeInTheDocument();
  });
});
