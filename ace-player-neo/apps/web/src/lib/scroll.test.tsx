import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { scrollChildIntoView, shiftWheelToHorizontal, useKeepActiveVisible } from './scroll.ts';

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 40,
    height: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('scrollChildIntoView', () => {
  it('centra solo en horizontal (nunca scrollIntoView, que movería la página)', () => {
    const container = document.createElement('div');
    const child = document.createElement('button');
    container.getBoundingClientRect = () => rect(0, 300);
    child.getBoundingClientRect = () => rect(400, 60);
    container.scrollTo = vi.fn();
    scrollChildIntoView(container, child, 'center', false);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 280, behavior: 'auto' });
    expect(child.scrollIntoView).not.toHaveBeenCalled();
  });

  it('en modo «nearest» no se mueve si ya se ve', () => {
    const container = document.createElement('div');
    const child = document.createElement('button');
    container.getBoundingClientRect = () => rect(0, 300);
    child.getBoundingClientRect = () => rect(100, 60);
    container.scrollTo = vi.fn();
    scrollChildIntoView(container, child, 'nearest');
    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});

function Tira({ active, version }: { active: string; version: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepActiveVisible(ref, active);
  return (
    <div ref={ref} data-version={version}>
      {['ayer', 'hoy', 'manana'].map((day) => (
        <button key={day} aria-pressed={day === active}>
          {day}
        </button>
      ))}
    </div>
  );
}

describe('useKeepActiveVisible', () => {
  it('se mueve la primera vez y al cambiar de activo, pero no al repintar (regla 1)', () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'DIV' ? rect(0, 100) : rect(500, 50);
      });
    const scroll = vi.fn();
    HTMLElement.prototype.scrollTo = scroll as unknown as typeof HTMLElement.prototype.scrollTo;
    const { rerender } = render(<Tira active="hoy" version={1} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<Tira active="hoy" version={2} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<Tira active="manana" version={3} />);
    expect(scroll).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('shiftWheelToHorizontal', () => {
  /** Un carrusel de 1000 px de contenido en 300 de ancho, con scrollBy espiado. */
  function rail(scrollLeft = 0) {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollWidth', { value: 1000 });
    Object.defineProperty(container, 'clientWidth', { value: 300 });
    container.scrollLeft = scrollLeft;
    const scrollBy = vi.fn();
    container.scrollBy = scrollBy as unknown as typeof container.scrollBy;
    return { container, scrollBy };
  }
  const wheel = (init: WheelEventInit) => new WheelEvent('wheel', { cancelable: true, ...init });

  it('la rueda vertical sola NO se toca: baja la página aunque el ratón esté encima', () => {
    const { container, scrollBy } = rail(200);
    for (const deltaY of [120, -120, 3]) {
      const event = wheel({ deltaY });
      shiftWheelToHorizontal(event, container);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(scrollBy).not.toHaveBeenCalled();
    expect(container.scrollLeft).toBe(200);
  });

  it('el touchpad (deltaX) lo desplaza el navegador: tampoco se toca', () => {
    const { container, scrollBy } = rail();
    const event = wheel({ deltaX: 80, deltaY: 10 });
    shiftWheelToHorizontal(event, container);
    expect(event.defaultPrevented).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('Mayús + rueda (si el navegador no la pasa a deltaX) la desplaza a los lados con scrollBy', () => {
    const { container, scrollBy } = rail();
    const event = wheel({ deltaY: 120, shiftKey: true });
    shiftWheelToHorizontal(event, container);
    expect(event.defaultPrevented).toBe(true);
    // scrollBy y no scrollLeft: con scroll-snap, un salto corto volvería al cartel de antes.
    expect(scrollBy).toHaveBeenCalledWith({ left: 120, behavior: 'auto' });
  });

  it('Mayús + rueda en líneas (Firefox) cuenta 40 px por línea', () => {
    const { container, scrollBy } = rail(300);
    shiftWheelToHorizontal(wheel({ deltaY: -3, deltaMode: 1, shiftKey: true }), container);
    expect(scrollBy).toHaveBeenCalledWith({ left: -120, behavior: 'auto' });
  });

  it('en el extremo hacia el que va, la suelta (no se queda la rueda)', () => {
    const start = rail(0);
    const back = wheel({ deltaY: -120, shiftKey: true });
    shiftWheelToHorizontal(back, start.container);
    expect(back.defaultPrevented).toBe(false);
    const end = rail(700);
    const forward = wheel({ deltaY: 120, shiftKey: true });
    shiftWheelToHorizontal(forward, end.container);
    expect(forward.defaultPrevented).toBe(false);
    expect(start.scrollBy).not.toHaveBeenCalled();
    expect(end.scrollBy).not.toHaveBeenCalled();
  });

  it('Ctrl + rueda (zoom) no se toca', () => {
    const { container, scrollBy } = rail();
    const event = wheel({ deltaY: 120, shiftKey: true, ctrlKey: true });
    shiftWheelToHorizontal(event, container);
    expect(event.defaultPrevented).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
