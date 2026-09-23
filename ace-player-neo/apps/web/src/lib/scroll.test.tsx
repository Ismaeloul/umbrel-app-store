import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { scrollChildIntoView, useKeepActiveVisible, wheelToHorizontal } from './scroll.ts';

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

describe('wheelToHorizontal', () => {
  it('la rueda vertical desplaza el carrusel en horizontal', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollWidth', { value: 1000 });
    Object.defineProperty(container, 'clientWidth', { value: 300 });
    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    wheelToHorizontal(event, container);
    expect(container.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });
});
