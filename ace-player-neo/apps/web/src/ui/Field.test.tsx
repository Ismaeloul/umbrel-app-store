import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Kbd, Switch, TextField } from './Field.tsx';

describe('TextField', () => {
  it('etiqueta, pista y error enlazados', () => {
    render(
      <TextField label="URL de la lista" hint="M3U o HTML" error="Esa dirección no es válida." />,
    );
    const input = screen.getByLabelText('URL de la lista');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('M3U o HTML Esa dirección no es válida.');
    expect(screen.getByRole('alert')).toHaveTextContent('Esa dirección no es válida.');
  });

  it('buscador con etiqueta oculta, tecla y marca para requestFocus', () => {
    render(
      <TextField
        label="Buscar canal"
        hideLabel
        variant="search"
        icon="buscar"
        kbd="/"
        focusTarget="buscar-biblioteca"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Buscar canal' });
    expect(input).toHaveAttribute('data-focus-target', 'buscar-biblioteca');
    expect(screen.getByText('Buscar canal')).toHaveClass('sr-only');
    expect(document.querySelector('.field__kbd')).toHaveTextContent('/');
  });
});

function Transparencia() {
  const [on, setOn] = useState(false);
  return (
    <Switch
      label="Reducir transparencia"
      description="El cristal pasa a opaco."
      checked={on}
      onChange={setOn}
    />
  );
}

describe('Switch', () => {
  it('interruptor con role="switch" que cambia al pulsarlo', () => {
    render(<Transparencia />);
    const toggle = screen.getByRole('switch', { name: 'Reducir transparencia' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('El cristal pasa a opaco.');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Kbd', () => {
  it('una tecla', () => {
    render(<Kbd>Espacio</Kbd>);
    expect(screen.getByText('Espacio').tagName).toBe('KBD');
  });
});
