import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveDot, LiveRing, matchProgress } from './LiveRing.tsx';

describe('matchProgress', () => {
  it('minuto / 90, con el añadido contando como el minuto base', () => {
    expect(matchProgress(45)).toBe(0.5);
    expect(matchProgress('45+2')).toBe(0.5);
    expect(matchProgress('90+4')).toBe(1);
    expect(matchProgress(120)).toBe(1);
    expect(matchProgress('')).toBe(0);
  });
});

describe('LiveRing', () => {
  it('el minuto dentro del anillo, leído como tal, y el progreso en --p', () => {
    const { container } = render(<LiveRing minute={72} />);
    expect(screen.getByText('Minuto 72, en directo')).toBeInTheDocument();
    const box = container.querySelector('.ring-box') as HTMLElement;
    expect(Number(box.style.getPropertyValue('--p'))).toBeCloseTo(0.8, 2);
    expect(box.style.getPropertyValue('--d')).toBe('50px');
    expect(container.querySelector('.ring__wave')).not.toBeNull();
  });

  it('en el descanso no late', () => {
    const { container } = render(<LiveRing minute="45+2" halftime size="compact" />);
    expect(screen.getByText('Desc.')).toBeInTheDocument();
    expect(container.querySelector('.ring__wave')).toBeNull();
    expect(
      (container.querySelector('.ring-box') as HTMLElement).style.getPropertyValue('--d'),
    ).toBe('40px');
  });
});

describe('LiveDot', () => {
  it('decorativo o con nombre', () => {
    const { container, rerender } = render(<LiveDot />);
    expect(container.querySelector('.live-dot')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LiveDot label="En directo" />);
    expect(screen.getByRole('img', { name: 'En directo' })).toBeInTheDocument();
  });
});
