import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, Panel } from './Surface.tsx';

describe('Card y Panel', () => {
  it('Card es opaca y publica el radio exterior y el margen (radios concéntricos)', () => {
    render(
      <Card radius="l" padding={3} data-testid="card">
        Hola
      </Card>,
    );
    const card = screen.getByTestId('card');
    expect(card).toHaveClass('card');
    expect(card.style.getPropertyValue('--r-outer')).toBe('var(--r-l)');
    expect(card.style.getPropertyValue('--pad')).toBe('var(--s-3)');
  });

  it('Panel es de cristal con su material', () => {
    const { rerender } = render(<Panel data-testid="p">Sobre listas</Panel>);
    expect(screen.getByTestId('p')).toHaveClass('panel', 'glass');
    rerender(
      <Panel data-testid="p" material="dense">
        Sobre listas
      </Panel>,
    );
    expect(screen.getByTestId('p')).toHaveClass('glass', 'glass--dense');
    rerender(
      <Panel data-testid="p" material="video" as="section">
        Sobre vídeo
      </Panel>,
    );
    const panel = screen.getByTestId('p');
    expect(panel.tagName).toBe('SECTION');
    expect(panel).toHaveClass('glass--video');
    expect(panel).not.toHaveClass('glass');
  });
});
