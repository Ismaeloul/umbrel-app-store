import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, MenuButton, placeMenu, useContextMenu, type MenuItem } from './Menu.tsx';

const items = (onFav: () => void = vi.fn(), onCopy: () => void = vi.fn()): MenuItem[] => [
  { id: 'fav', label: 'Favorito', icon: 'star', onSelect: onFav, shortcut: 'G' },
  { id: 'off', label: 'Desactivado', onSelect: vi.fn(), disabled: true },
  { id: 'copy', label: 'Copiar hash', icon: 'copy', onSelect: onCopy },
];

describe('placeMenu', () => {
  const viewport = { width: 390, height: 844 };
  it('debajo del botón y alineado a su derecha', () => {
    expect(
      placeMenu(
        { left: 300, right: 344, top: 100, bottom: 144 },
        { width: 220, height: 150 },
        viewport,
        false,
      ),
    ).toEqual({
      left: 124,
      top: 150,
    });
  });
  it('encima si no cabe debajo, y siempre dentro de la pantalla', () => {
    const pos = placeMenu(
      { left: 10, right: 54, top: 780, bottom: 824 },
      { width: 220, height: 150 },
      viewport,
      false,
    );
    expect(pos.top).toBe(624);
    expect(pos.left).toBe(8);
  });
  it('en un punto (clic derecho)', () => {
    expect(
      placeMenu(
        { left: 380, right: 380, top: 20, bottom: 20 },
        { width: 220, height: 100 },
        viewport,
        true,
      ),
    ).toEqual({
      left: 162,
      top: 20,
    });
  });
});

describe('MenuButton', () => {
  it('abre el menú, enfoca el primero y navega con flechas (saltando los desactivados)', () => {
    const onCopy = vi.fn();
    render(<MenuButton label="Más opciones" items={items(vi.fn(), onCopy)} />);
    const trigger = screen.getByRole('button', { name: 'Más opciones' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Más opciones' });
    expect(screen.getByRole('menuitem', { name: /Favorito/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /Copiar hash/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem', { name: /Copiar hash/ }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Escape cierra y devuelve el foco', () => {
    render(<MenuButton label="Más opciones" items={items()} />);
    const trigger = screen.getByRole('button', { name: 'Más opciones' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('la primera letra salta al elemento', () => {
    render(<MenuButton label="Más opciones" items={items()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'c' });
    expect(screen.getByRole('menuitem', { name: /Copiar hash/ })).toHaveFocus();
  });

  it('un clic fuera cierra', () => {
    render(<MenuButton label="Más opciones" items={items()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

function Contexto({ onFav }: { onFav: () => void }) {
  const context = useContextMenu();
  return (
    <>
      <div data-testid="zona" {...context.bind}>
        Fuente 1
      </div>
      <Menu {...context.menu} label="Acciones" items={items(onFav)} />
    </>
  );
}

describe('useContextMenu', () => {
  it('el clic derecho abre el menú en el punto', () => {
    const onFav = vi.fn();
    render(<Contexto onFav={onFav} />);
    fireEvent.contextMenu(screen.getByTestId('zona'), { clientX: 40, clientY: 60 });
    expect(screen.getByRole('menu', { name: 'Acciones' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: /Favorito/ }));
    expect(onFav).toHaveBeenCalledOnce();
  });

  it('la pulsación larga con el dedo también', () => {
    vi.useFakeTimers();
    try {
      render(<Contexto onFav={vi.fn()} />);
      fireEvent.pointerDown(screen.getByTestId('zona'), {
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      });
      act(() => {
        vi.advanceTimersByTime(520);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
