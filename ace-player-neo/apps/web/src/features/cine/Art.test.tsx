/* Un cartel que falla (por ejemplo, un 503 de la cola de carteles con muchas
   filas en la portada) se reintenta UNA vez a los 2-3 s antes de quedarse en
   el relleno; sin imagen, un cartel se pinta con el título. */

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { Art, ART_RETRY_MS } from './Art.tsx';

const ID = 'a'.repeat(40);

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetMode();
});

describe('Art', () => {
  it('reintenta una vez una imagen que falla y, si vuelve a fallar, se queda el relleno', () => {
    const { container } = render(<Art id={ID} art="poster" v="abcdef01" title="Dune" />);
    const first = container.querySelector('img');
    expect(first).not.toBeNull();
    fireEvent.error(first!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'fill');
    act(() => {
      vi.advanceTimersByTime(ART_RETRY_MS + 1000);
    });
    const second = container.querySelector('img');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.getAttribute('src')).toBe(first?.getAttribute('src'));
    fireEvent.load(second!);
    expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'image');
    fireEvent.error(second!);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cine-art')).toHaveAttribute('data-state', 'fill');
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
});
