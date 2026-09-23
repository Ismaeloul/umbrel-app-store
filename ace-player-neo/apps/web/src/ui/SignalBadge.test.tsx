import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SIGNAL_GLYPH,
  SIGNAL_WORD,
  SignalBadge,
  signalFromCandidate,
  type SignalState,
} from './SignalBadge.tsx';

const STATES: SignalState[] = ['ok', 'weak', 'fail', 'checking', 'pending'];

describe('SignalBadge', () => {
  it('cada estado lleva su palabra (nunca solo color)', () => {
    for (const state of STATES) {
      const { unmount, container } = render(<SignalBadge state={state} />);
      expect(screen.getByText(SIGNAL_WORD[state])).toBeInTheDocument();
      expect(container.querySelector('.sig')).toHaveAttribute('data-state', state);
      // El medidor es decorativo: la palabra ya lo dice.
      expect(container.querySelector('.sig__bars')).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('las palabras son las del inventario', () => {
    expect(SIGNAL_WORD).toEqual({
      ok: 'Verificada',
      weak: 'Floja',
      fail: 'Sin señal',
      checking: 'Comprobando',
      pending: 'Pendiente',
    });
  });

  it('B7: otra palabra («Sin señal · reintento 20:51»)', () => {
    render(<SignalBadge state="fail" label="Sin señal · reintento 20:51" />);
    expect(screen.getByText('Sin señal · reintento 20:51')).toBeInTheDocument();
  });

  it('C4: glifo en vez de medidor', () => {
    const { container } = render(<SignalBadge state="weak" compact />);
    expect(container.querySelector('.sig__glyph')).toHaveTextContent(SIGNAL_GLYPH.weak);
    expect(container.querySelector('.sig__bars')).toBeNull();
  });

  it('sin palabra visible se sigue leyendo', () => {
    render(<SignalBadge state="ok" hideWord />);
    expect(screen.getByText('Verificada')).toHaveClass('sr-only');
  });

  it('traduce los estados del comprobador', () => {
    expect(signalFromCandidate('working')).toBe('ok');
    expect(signalFromCandidate('weak')).toBe('weak');
    expect(signalFromCandidate('failed')).toBe('fail');
    expect(signalFromCandidate('checking')).toBe('checking');
    expect(signalFromCandidate('queued')).toBe('pending');
    expect(signalFromCandidate(null)).toBe('pending');
  });
});
