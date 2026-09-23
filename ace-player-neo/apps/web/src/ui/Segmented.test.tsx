import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Segmented, Tabs, tabPanelProps } from './Segmented.tsx';

function Filtro() {
  const [value, setValue] = useState<'para-ti' | 'todos' | 'directo'>('para-ti');
  return (
    <Segmented
      label="Filtro"
      value={value}
      onChange={setValue}
      items={[
        { value: 'para-ti', label: 'Para ti', count: 8 },
        { value: 'todos', label: 'Todos', count: 9 },
        { value: 'directo', label: 'Directo', disabled: true },
      ]}
    />
  );
}

describe('Segmented', () => {
  it('es un grupo de radios con la opción activa marcada', () => {
    render(<Filtro />);
    expect(screen.getByRole('radiogroup', { name: 'Filtro' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Para ti/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Todos/ })).toHaveAttribute('tabindex', '-1');
  });

  it('el clic cambia la opción y mueve la gota (--i)', () => {
    render(<Filtro />);
    fireEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    expect(screen.getByRole('radio', { name: /Todos/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radiogroup').style.getPropertyValue('--i')).toBe('1');
  });

  it('las flechas cambian y enfocan, saltándose las deshabilitadas', () => {
    render(<Filtro />);
    const first = screen.getByRole('radio', { name: /Para ti/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const todos = screen.getByRole('radio', { name: /Todos/ });
    expect(todos).toHaveAttribute('aria-checked', 'true');
    expect(todos).toHaveFocus();
    fireEvent.keyDown(todos, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /Para ti/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Para ti/ }), { key: 'End' });
    expect(screen.getByRole('radio', { name: /Todos/ })).toHaveAttribute('aria-checked', 'true');
  });
});

function Biblioteca() {
  const [value, setValue] = useState<'favoritos' | 'recientes'>('favoritos');
  return (
    <>
      <Tabs
        label="Biblioteca"
        idPrefix="bib"
        value={value}
        onChange={setValue}
        items={[
          { value: 'favoritos', label: 'Favoritos' },
          { value: 'recientes', label: 'Recientes' },
        ]}
      />
      <div {...tabPanelProps('bib', value)}>Panel {value}</div>
    </>
  );
}

describe('Tabs', () => {
  it('enlaza pestaña y panel', () => {
    render(<Biblioteca />);
    const tab = screen.getByRole('tab', { name: 'Favoritos' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'bib-panel-favoritos');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'bib-panel-favoritos');
    expect(panel).toHaveAccessibleName('Favoritos');
  });

  it('Inicio y Fin van a los extremos', () => {
    render(<Biblioteca />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Favoritos' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Recientes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel recientes');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Recientes' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Favoritos' })).toHaveAttribute('aria-selected', 'true');
  });
});
