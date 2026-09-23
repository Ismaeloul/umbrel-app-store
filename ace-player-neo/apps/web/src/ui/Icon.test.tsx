import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon.tsx';
import { ICON_NAMES, ICONS } from './icons.ts';

describe('Icon', () => {
  it('es decorativo por defecto', () => {
    const { container } = render(<Icon name="agenda" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg?.innerHTML).toContain('rect');
  });

  it('con label se anuncia como imagen', () => {
    render(<Icon name="motor" label="Motor en línea" size={16} />);
    const img = screen.getByRole('img', { name: 'Motor en línea' });
    expect(img).toHaveAttribute('width', '16');
  });

  it('todos los iconos tienen dibujo y ninguno trae scripts', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(40);
    for (const name of ICON_NAMES) {
      expect(ICONS[name]).toMatch(/<(path|rect|circle)/);
      expect(ICONS[name]).not.toMatch(/script|on\w+=/i);
    }
  });
});
