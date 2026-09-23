import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar.tsx';

describe('ProgressBar', () => {
  it('barra de progreso con nombre, valor y muesca del descanso', () => {
    const { container } = render(
      <ProgressBar value={0.8} label="Minuto 72 de 90" tone="live" marks={[0.5]} />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Minuto 72 de 90' });
    expect(bar).toHaveAttribute('aria-valuenow', '80');
    expect(bar.style.getPropertyValue('--v')).toBe('0.8');
    expect(container.querySelectorAll('.progress__mark')).toHaveLength(1);
  });

  it('recorta valores fuera de 0..1', () => {
    const { rerender } = render(<ProgressBar value={3} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressBar value={Number.NaN} label="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});
