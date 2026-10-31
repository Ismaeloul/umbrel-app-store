/* Popover: dónde se coloca, que no es modal y que Escape o un clic fuera lo cierran. */

import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { placePopover, Popover } from './Popover.tsx';

const VIEW = { width: 1280, height: 800 };

describe('placePopover', () => {
  it('debajo de lo pulsado; si no cabe, encima; siempre dentro de la pantalla', () => {
    const anchor = { left: 400, top: 200, right: 700, bottom: 250 };
    expect(placePopover(anchor, { width: 340, height: 260 }, VIEW)).toEqual({
      left: 400,
      top: 258,
      above: false,
    });
    expect(
      placePopover({ ...anchor, top: 600, bottom: 650 }, { width: 340, height: 260 }, VIEW),
    ).toMatchObject({ top: 332, above: true });
    // La campana, en la esquina: alineada por la derecha y sin salirse.
    expect(
      placePopover(
        { left: 1220, top: 12, right: 1260, bottom: 52 },
        { width: 360, height: 200 },
        VIEW,
        'end',
      ),
    ).toEqual({ left: 900, top: 60, above: false });
    expect(
      placePopover({ ...anchor, left: 1200, right: 1250 }, { width: 340, height: 100 }, VIEW),
    ).toMatchObject({ left: 932 });
  });
});

function Harness() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <button type="button">Otro</button>
      <Popover open={open} anchor={button.current} onClose={() => setOpen(false)} label="Detalle">
        <button type="button">Dentro</button>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('se abre enfocado, no bloquea el resto y se cierra con Escape o con un clic fuera', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Detalle' });
    expect(dialog).toHaveFocus();
    expect(document.getElementById('root')?.hasAttribute('inert') ?? false).toBe(false);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dentro' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Otro' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
