import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { EmptyState } from './EmptyState.tsx';

describe('EmptyState', () => {
  it('dice qué pasa y ofrece la salida (regla 32)', () => {
    const onAdd = vi.fn();
    render(
      <EmptyState
        title="Aún no hay listas"
        actions={<Button onClick={onAdd}>Añadir una lista</Button>}
      >
        Añade una lista M3U para empezar.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'Aún no hay listas' })).toBeInTheDocument();
    expect(screen.getByText('Añade una lista M3U para empezar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir una lista' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('el tono de error cambia la ilustración', () => {
    const { container } = render(
      <EmptyState tone="error" title="No se pudo cargar" actions={<Button>Reintentar</Button>} />,
    );
    expect(container.querySelector('.empty')).toHaveClass('empty--error');
    expect(container.querySelector('.empty__mark')).not.toBeNull();
    expect(container.querySelector('.empty__art')).toHaveAttribute('aria-hidden', 'true');
  });
});
