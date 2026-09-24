import { fireEvent, render } from '@testing-library/react';
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
  it('monograma con los colores del club cuando no hay escudo', () => {
    const { container } = render(
      <TeamMark name="Atlético de Madrid" colors={{ primary: 'cb3524', secondary: '272e61' }} />,
    );
    const mark = container.querySelector('.team') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('data-crest', 'mono');
    expect(mark.style.getPropertyValue('--team')).toBe('#cb3524');
    expect(mark.style.getPropertyValue('--team-2')).toBe('#272e61');
    expect(mark.style.getPropertyValue('--glow-l')).toMatch(/^oklch\(/);
    expect(container.querySelector('img')).toBeNull();
    // A 28 px no hay placa: solo el círculo.
    expect(container.querySelector('.team__plate')).toBeNull();
  });

  it('imagen cuando el backend da escudo (mismo origen, perezosa), con el monograma debajo', () => {
    const { container } = render(
      <TeamMark
        name="Juventus"
        short="JUV"
        size={64}
        crest="/api/v1/football/teams/133676/crest?v=abc"
      />,
    );
    const mark = container.querySelector('.team') as HTMLElement;
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('src', '/api/v1/football/teams/133676/crest?v=abc');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    // Mientras carga, el monograma sigue ahí.
    expect(mark).toHaveAttribute('data-crest', 'loading');
    expect(container.querySelector('.team__plate')).toHaveTextContent('JUV');
    fireEvent.load(img);
    expect(mark).toHaveAttribute('data-crest', 'image');
  });

  it('si la imagen falla vuelve al monograma', () => {
    const { container } = render(
      <TeamMark name="Juventus" size={64} crest="/api/v1/football/teams/1/crest" />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.team')).toHaveAttribute('data-crest', 'mono');
    expect(container.querySelector('.team__plate')).toHaveTextContent('JUV');
  });

  it('nunca enlaza a terceros: una URL absoluta se ignora', () => {
    const { container } = render(<TeamMark name="X" crest="https://example.com/x.png" />);
    expect(container.querySelector('img')).toBeNull();
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
