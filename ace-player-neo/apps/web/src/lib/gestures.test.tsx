import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { classifySwipe, useSwipe, type SwipeDirection } from './gestures.ts';

describe('classifySwipe', () => {
  it('horizontal largo o rápido', () => {
    expect(classifySwipe(-80, 5, 300)).toBe('left');
    expect(classifySwipe(70, -10, 300)).toBe('right');
    // Corto pero rápido.
    expect(classifySwipe(-30, 0, 40)).toBe('left');
  });

  it('ni corto y lento, ni en diagonal, ni vertical si solo interesa x', () => {
    expect(classifySwipe(-20, 0, 400)).toBeNull();
    expect(classifySwipe(-60, -55, 200)).toBeNull();
    expect(classifySwipe(0, 120, 200)).toBeNull();
  });

  it('vertical cuando se pide el eje y', () => {
    expect(classifySwipe(3, 90, 250, { axis: 'y' })).toBe('down');
    expect(classifySwipe(3, -90, 250, { axis: 'both' })).toBe('up');
  });
});

function Zona({
  onSwipe,
  onMove,
}: {
  onSwipe: (d: SwipeDirection) => void;
  onMove: (dx: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipe(ref, { onSwipe, onMove: (dx) => onMove(dx) });
  return <div ref={ref} data-testid="zona" />;
}

describe('useSwipe', () => {
  it('deslizar con el dedo cambia (y deja el scroll vertical al navegador)', () => {
    const onSwipe = vi.fn();
    const onMove = vi.fn();
    const { getByTestId } = render(<Zona onSwipe={onSwipe} onMove={onMove} />);
    const zona = getByTestId('zona');
    expect(zona.style.touchAction).toBe('pan-y');
    fireEvent.pointerDown(zona, { pointerId: 1, clientX: 200, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(zona, { pointerId: 1, clientX: 150, clientY: 102, pointerType: 'touch' });
    fireEvent.pointerUp(zona, { pointerId: 1, clientX: 110, clientY: 104, pointerType: 'touch' });
    expect(onMove).toHaveBeenCalled();
    expect(onSwipe).toHaveBeenCalledWith('left');
  });
});
