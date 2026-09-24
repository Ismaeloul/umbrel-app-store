import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Capsule } from './Capsule.tsx';

describe('Capsule', () => {
  it('siempre forma + palabra + color: tono, punto y texto', () => {
    const { container } = render(
      <Capsule tone="live" size="sm" dot glass>
        En directo · 13'
      </Capsule>,
    );
    const capsule = container.querySelector('.capsule') as HTMLElement;
    expect(capsule.tagName).toBe('SPAN');
    expect(capsule).toHaveAttribute('data-tone', 'live');
    expect(capsule).toHaveClass('capsule--live', 'capsule--sm', 'capsule--glass', 'capsule--dot');
    expect(container.querySelector('.capsule__dot')).toHaveAttribute('aria-hidden', 'true');
    expect(capsule).toHaveTextContent("En directo · 13'");
  });

  it('con icono y título', () => {
    const { container } = render(
      <Capsule icon="clock" title="Las fuentes se comprueban 45 minutos antes">
        45 min antes
      </Capsule>,
    );
    expect(container.querySelector('.capsule__icon')).not.toBeNull();
    expect(screen.getByTitle('Las fuentes se comprueban 45 minutos antes')).toHaveTextContent(
      '45 min antes',
    );
  });

  it('como botón es un interruptor accesible', () => {
    const onClick = vi.fn();
    render(
      <Capsule as="button" tone="gold" pressed onClick={onClick}>
        Marcador
      </Capsule>,
    );
    const button = screen.getByRole('button', { name: 'Marcador', pressed: true });
    expect(button).toHaveClass('capsule--button', 'press');
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('todos los tonos son clases distintas', () => {
    for (const tone of ['neutral', 'live', 'ok', 'weak', 'fail', 'gold'] as const) {
      const { container, unmount } = render(<Capsule tone={tone}>{tone}</Capsule>);
      expect(container.querySelector('.capsule')).toHaveClass(`capsule--${tone}`);
      unmount();
    }
  });
});
