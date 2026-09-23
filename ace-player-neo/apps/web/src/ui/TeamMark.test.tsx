import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamMark, teamInitials } from './TeamMark.tsx';

describe('teamInitials', () => {
  it('siglas dadas o sacadas del nombre', () => {
    expect(teamInitials('Atlético de Madrid', 'atm')).toBe('ATM');
    expect(teamInitials('Tottenham')).toBe('TOT');
    expect(teamInitials('Real Madrid')).toBe('RM');
    expect(teamInitials('Atlético de Madrid')).toBe('AM');
    expect(teamInitials('FC Barcelona')).toBe('BAR');
    expect(teamInitials('')).toBe('?');
  });
});

describe('TeamMark', () => {
  it('monograma con los colores del club, sin imágenes de escudos', () => {
    const { container } = render(
      <TeamMark name="Atlético de Madrid" colors={{ primary: 'cb3524', secondary: '272e61' }} />,
    );
    const mark = container.querySelector('.team') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.style.getPropertyValue('--team')).toBe('#cb3524');
    expect(mark.style.getPropertyValue('--team-2')).toBe('#272e61');
    expect(mark.style.getPropertyValue('--glow-l')).toMatch(/^oklch\(/);
    expect(container.querySelector('img')).toBeNull();
    // A 28 px no hay placa: solo el círculo.
    expect(container.querySelector('.team__plate')).toBeNull();
  });

  it('a partir de 40 px lleva la placa con las siglas; en directo se enciende', () => {
    const { container } = render(<TeamMark name="Tottenham" short="TOT" size={64} lit />);
    expect(container.querySelector('.team__plate')).toHaveTextContent('TOT');
    expect(container.querySelector('.team')).toHaveAttribute('data-lit', 'true');
  });

  it('sin datos: un tono sacado del nombre', () => {
    const { container } = render(<TeamMark name="Equipo sin datos" />);
    const mark = container.querySelector('.team') as HTMLElement;
    expect(mark.style.getPropertyValue('--team')).toMatch(/^oklch\(/);
  });
});
