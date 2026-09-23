import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { hasOverlay } from './overlay.ts';
import { Sheet } from './Sheet.tsx';

function Demo({ dismissible = true, onClose }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="root">
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Sheet
        open={open}
        dismissible={dismissible}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Reproducir otro hash"
        footer={<Button onClick={() => setOpen(false)}>Hecho</Button>}
      >
        <input aria-label="Hash" />
      </Sheet>
    </div>
  );
}

describe('Sheet', () => {
  it('abre un diálogo modal con nombre y enfoca el primer campo', async () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Reproducir otro hash' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Hash')).toHaveFocus();
    expect(hasOverlay()).toBe(true);
    // El resto de la app queda inerte mientras la hoja está abierta.
    expect(document.getElementById('root')).toHaveAttribute('inert');
  });

  it('Escape cierra y el foco vuelve al botón que la abrió', async () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByLabelText('Hash'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    expect(document.getElementById('root')).not.toHaveAttribute('inert');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(hasOverlay()).toBe(false);
  });

  it('Tab da la vuelta dentro de la hoja (trampa de foco)', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const last = screen.getByRole('button', { name: 'Hecho' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cerrar' }), {
      key: 'Tab',
      shiftKey: true,
    });
    expect(last).toHaveFocus();
  });

  it('el velo cierra; sin `dismissible` ni el velo ni Escape', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Demo onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.click(document.querySelector('.sheet-scrim') as Element);
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    const onClose2 = vi.fn();
    render(<Demo dismissible={false} onClose={onClose2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.keyDown(screen.getByLabelText('Hash'), { key: 'Escape' });
    fireEvent.click(document.querySelector('.sheet-scrim') as Element);
    expect(onClose2).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
  });
});
