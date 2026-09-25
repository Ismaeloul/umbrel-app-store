import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompetitionBadge } from './CompetitionBadge.tsx';

describe('CompetitionBadge', () => {
  it('sin logo: el nombre corto en texto, decorativa', () => {
    const { container } = render(<CompetitionBadge name="Champions League" />);
    const badge = container.querySelector('.comp') as HTMLElement;
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveAttribute('title', 'Champions League');
    expect(badge).toHaveTextContent('UCL');
    expect(container.querySelector('img')).toBeNull();
  });

  it('con logo del backend: imagen perezosa de mismo origen; si falla, el texto', () => {
    const { container } = render(
      <CompetitionBadge
        name="LaLiga"
        logo="/api/v1/football/competitions/4335/logo?v=1"
        label="LaLiga"
        size="lg"
      />,
    );
    const img = screen
      .getByRole('img', { name: 'LaLiga' })
      .querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('src', '/api/v1/football/competitions/4335/logo?v=1');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(container.querySelector('.comp')).toHaveClass('comp--image', 'comp--lg');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.comp')).toHaveTextContent('LaLiga');
  });

  it('nunca enlaza a terceros', () => {
    const { container } = render(
      <CompetitionBadge name="Serie A" logo="https://cdn.example.com/logo.png" short="SA" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.comp')).toHaveTextContent('SA');
  });
});
