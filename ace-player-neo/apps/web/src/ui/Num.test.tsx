import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Num, splitDigits } from './Num.tsx';

describe('splitDigits', () => {
  it('separa cada cifra y agrupa lo demás', () => {
    expect(splitDigits('21:00')).toEqual([
      { digit: true, text: '2' },
      { digit: true, text: '1' },
      { digit: false, text: ':' },
      { digit: true, text: '0' },
      { digit: true, text: '0' },
    ]);
    expect(splitDigits("90+4'")).toEqual([
      { digit: true, text: '9' },
      { digit: true, text: '0' },
      { digit: false, text: '+' },
      { digit: true, text: '4' },
      { digit: false, text: "'" },
    ]);
  });
});

describe('Num', () => {
  it('se lee entero y pinta cada cifra en su celda (cero sin barra: sin tabular-nums)', () => {
    const { container } = render(<Num value="21:00" />);
    expect(screen.getByText('21:00')).toHaveClass('sr-only');
    const glyphs = container.querySelector('[aria-hidden="true"]');
    expect(glyphs).not.toBeNull();
    const cells = container.querySelectorAll('.num-cells__d');
    expect(cells).toHaveLength(4);
    expect([...cells].map((cell) => cell.getAttribute('data-g')).join('')).toBe('2100');
    expect(container.firstElementChild).toHaveClass('num-cells', 'num');
    // El único texto es el valor entero: las cifras visibles son contenido generado.
    expect(container.textContent).toBe('21:00');
  });

  it('acepta números y una etiqueta propia para lectores de pantalla', () => {
    render(<Num value={72} label="Minuto 72" />);
    expect(screen.getByText('Minuto 72')).toBeInTheDocument();
  });

  it('sin condensar no lleva la clase de cifras de marcador', () => {
    const { container } = render(<Num value={8} condensed={false} />);
    expect(container.firstElementChild).not.toHaveClass('num');
  });
});
