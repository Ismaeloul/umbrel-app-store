import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastView } from './Toast.tsx';

describe('ToastView', () => {
  it('enseña el texto y «×n» cuando se repite', () => {
    render(<ToastView text="Hash copiado" tone="ok" count={3} />);
    expect(screen.getByText('Hash copiado')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(document.querySelector('.toast')).toHaveClass('toast--ok', 'glass', 'glass--dense');
  });

  it('sin repetir no enseña contador', () => {
    render(<ToastView text="Canal renombrado" tone="ok" />);
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it('el botón de acción y el de cerrar', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastView
        text="«DAZN 1» eliminado"
        tone="warn"
        action={{ label: 'Deshacer', onAction }}
        onDismiss={onDismiss}
        state="leaving"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.querySelector('.toast')).toHaveAttribute('data-state', 'leaving');
  });
});
