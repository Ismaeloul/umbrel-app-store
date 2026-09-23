import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from './Button.tsx';

describe('Button', () => {
  it('pinta el texto con su variante y responde al clic', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" icon="play" onClick={onClick}>
        Ver partido
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Ver partido' });
    expect(button).toHaveClass('btn', 'btn--primary');
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('como interruptor anuncia aria-pressed', () => {
    render(<Button pressed>Favorito</Button>);
    expect(screen.getByRole('button', { name: 'Favorito' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sin `pressed` no lleva aria-pressed (no es un interruptor)', () => {
    render(<Button>Elegir fuente</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
  });

  it('trabajando queda deshabilitado y con aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Guardando…
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('el pequeño lleva su clase (zona táctil de 44 por CSS)', () => {
    render(
      <Button size="sm" block>
        Pegar hash
      </Button>,
    );
    expect(screen.getByRole('button')).toHaveClass('btn--sm', 'btn--block');
  });
});

describe('IconButton', () => {
  it('usa la etiqueta como nombre y tooltip con el atajo', () => {
    render(<IconButton icon="star" label="Favorito" shortcut="G" />);
    const button = screen.getByRole('button', { name: 'Favorito' });
    expect(button).toHaveAttribute('title', 'Favorito (G)');
    expect(button).toHaveClass('icon-btn', 'icon-btn--ghost');
  });

  it('cambia de icono al pulsarse', () => {
    const { container, rerender } = render(
      <IconButton icon="star" pressedIcon="star-f" label="Favorito" pressed={false} />,
    );
    const before = container.querySelector('svg')?.innerHTML;
    rerender(<IconButton icon="star" pressedIcon="star-f" label="Favorito" pressed />);
    expect(container.querySelector('svg')?.innerHTML).not.toBe(before);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
