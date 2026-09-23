import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusLineView } from './StatusLine.tsx';

describe('StatusLineView', () => {
  it('frase humana, medidor y dato a la derecha', () => {
    render(
      <StatusLineView
        text="Fuente 1 verificada. Vas en directo."
        signal="ok"
        tone="ok"
        meta="6 s de retraso"
      />,
    );
    expect(screen.getByText('Fuente 1 verificada. Vas en directo.')).toBeInTheDocument();
    expect(screen.getByText('6 s de retraso')).toBeInTheDocument();
    // El medidor va sin palabra visible, pero se sigue leyendo.
    expect(screen.getByText('Verificada')).toHaveClass('sr-only');
    expect(document.querySelector('.status-line')).toHaveClass('status-line--ok');
  });

  it('sin medidor lleva icono; repetido enseña ×n', () => {
    render(<StatusLineView text="Reconectando…" tone="warn" icon="refresh" count={2} />);
    expect(document.querySelector('.status-line svg')).not.toBeNull();
    expect(screen.getByText('×2')).toBeInTheDocument();
  });
});
