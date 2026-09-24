import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignalRing, type SignalRingState } from './SignalRing.tsx';

const WORDS: Record<SignalRingState, string> = {
  ok: 'Verificada',
  weak: 'Floja',
  fail: 'Sin señal',
  checking: 'Comprobando',
  pending: 'Pendiente',
  reported: 'Reportada',
};

describe('SignalRing', () => {
  it('cada estado lleva su palabra y su forma (data-state)', () => {
    for (const state of Object.keys(WORDS) as SignalRingState[]) {
      const { container, unmount } = render(<SignalRing state={state} word={WORDS[state]} />);
      const ring = container.querySelector('.sring') as HTMLElement;
      expect(ring).toHaveAttribute('data-state', state);
      expect(ring).toHaveClass(`sring--${state}`);
      expect(ring).toHaveTextContent(WORDS[state]);
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('las formas se distinguen sin color: trazo, aspa o barra', () => {
    const shape = (state: SignalRingState) => {
      const { container, unmount } = render(<SignalRing state={state} word={WORDS[state]} />);
      const ring = container.querySelector('.sring__ring') as SVGElement;
      const out = {
        dash: ring.getAttribute('stroke-dasharray'),
        marks: container.querySelectorAll('.sring__mark').length,
      };
      unmount();
      return out;
    };
    expect(shape('ok')).toEqual({ dash: null, marks: 0 });
    expect(shape('weak')).toEqual({ dash: '66 34', marks: 0 });
    expect(shape('fail')).toEqual({ dash: null, marks: 1 });
    expect(shape('checking').dash).toBe('9 7');
    expect(shape('pending').dash).toBe('2 6');
    expect(shape('reported').marks).toBe(1);
  });

  it('en pantalla: oro (data-active) y tamaño en px', () => {
    const { container } = render(<SignalRing state="ok" word="Verificada" active size={40} />);
    const ring = container.querySelector('.sring') as HTMLElement;
    expect(ring).toHaveAttribute('data-active', 'true');
    expect(ring).toHaveClass('sring--active');
    expect(ring.style.getPropertyValue('--s')).toBe('40px');
  });

  it('hideWord deja la palabra solo para lectores de pantalla', () => {
    const { container } = render(<SignalRing state="weak" word="Floja" hideWord />);
    expect(container.querySelector('.sring__word')).toHaveClass('sr-only');
    expect(container.querySelector('.sring')).toHaveTextContent('Floja');
  });
});
