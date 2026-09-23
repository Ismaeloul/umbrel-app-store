import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Chip } from './Chip.tsx';

describe('Chip', () => {
  it('sin acción es una etiqueta, no un botón', () => {
    render(<Chip tone="mine">Tu equipo</Chip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Tu equipo').closest('.chip')).toHaveClass('chip--mine');
  });

  it('como filtro es un botón con aria-pressed y contador', () => {
    const onClick = vi.fn();
    render(
      <Chip pressed={false} count={3} onClick={onClick}>
        En directo
      </Chip>,
    );
    const button = screen.getByRole('button', { name: /En directo/ });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('3')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('B3: borde continuo en tu biblioteca y discontinuo si se buscará', () => {
    const { rerender } = render(<Chip outline="solid">M+ LaLiga</Chip>);
    expect(screen.getByText('M+ LaLiga').closest('.chip')).toHaveClass('chip--solid');
    rerender(<Chip outline="dashed">M+ LaLiga</Chip>);
    expect(screen.getByText('M+ LaLiga').closest('.chip')).toHaveClass('chip--dashed');
  });
});
