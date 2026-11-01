import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VolumeControl } from './VolumeControl.tsx';

function Harness({
  start = 0.4,
  slider = true,
  onActivity,
}: {
  start?: number;
  slider?: boolean;
  onActivity?: () => void;
}) {
  const [volume, setVolume] = useState(start);
  const [muted, setMuted] = useState(false);
  return (
    <VolumeControl
      muted={muted || volume === 0}
      volume={volume}
      slider={slider}
      {...(onActivity ? { onActivity } : {})}
      shortcut="M"
      onToggleMute={() => setMuted((value) => !value)}
      onVolume={(value) => {
        setVolume(value);
        setMuted(value === 0);
      }}
    />
  );
}

describe('VolumeControl', () => {
  it('un deslizador «Volumen» que dice el nivel en tanto por ciento', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    expect(slider).toHaveAttribute('aria-valuetext', '40 %');
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(slider).toHaveAttribute('aria-valuetext', '70 %');
  });

  it('con el foco, ↑ y ↓ suben y bajan un 5 % (y no llegan a los atajos de la página)', () => {
    const onWindowKey = vi.fn();
    globalThis.addEventListener('keydown', onWindowKey);
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(slider).toHaveAttribute('aria-valuetext', '45 %');
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(slider).toHaveAttribute('aria-valuetext', '35 %');
    expect(onWindowKey).not.toHaveBeenCalled();
    globalThis.removeEventListener('keydown', onWindowKey);
  });

  it('bajar del todo silencia; el botón dice entonces «Activar sonido»', () => {
    render(<Harness start={0.05} />);
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(slider).toHaveAttribute('aria-valuetext', '0 %');
    expect(screen.getByRole('button', { name: 'Activar sonido' })).toHaveAttribute(
      'title',
      'Activar sonido (M)',
    );
  });

  it('silenciado, el deslizador marca 0; al quitarlo vuelve al nivel de antes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    expect(slider).toHaveAttribute('aria-valuetext', '0 %');
    fireEvent.click(screen.getByRole('button', { name: 'Activar sonido' }));
    expect(slider).toHaveAttribute('aria-valuetext', '40 %');
  });

  it('la rueda sobre el control sube y baja, sin desplazar la página', () => {
    const { container } = render(<Harness />);
    const root = container.querySelector('.vol-ctl') as HTMLElement;
    const up = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
    fireEvent(root, up);
    expect(up.defaultPrevented).toBe(true);
    expect(screen.getByRole('slider', { name: 'Volumen' })).toHaveAttribute(
      'aria-valuetext',
      '45 %',
    );
  });

  it('un trackpad (eventos de pocos píxeles) no lo lleva al tope de un gesto', () => {
    const { container } = render(<Harness />);
    const root = container.querySelector('.vol-ctl') as HTMLElement;
    for (let i = 0; i < 40; i += 1) {
      fireEvent(root, new WheelEvent('wheel', { deltaY: -2, bubbles: true, cancelable: true }));
    }
    /* 80 px: aún ni un paso (antes, 40 pasos: del 40 % al 100 %). */
    expect(screen.getByRole('slider', { name: 'Volumen' })).toHaveAttribute(
      'aria-valuetext',
      '40 %',
    );
  });

  it('silenciado al 40 %, ↑ y la rueda parten del 40 % (no de 0, que guardaba un 5 %)', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(slider).toHaveAttribute('aria-valuetext', '45 %');
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
    const root = container.querySelector('.vol-ctl') as HTMLElement;
    fireEvent(root, new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(slider).toHaveAttribute('aria-valuetext', '40 %');
  });

  it('la rueda, las teclas y el deslizador avisan de actividad (los controles no se esconden)', () => {
    const onActivity = vi.fn();
    const { container } = render(<Harness onActivity={onActivity} />);
    const root = container.querySelector('.vol-ctl') as HTMLElement;
    const slider = screen.getByRole('slider', { name: 'Volumen' });
    fireEvent(root, new WheelEvent('wheel', { deltaY: -3, bubbles: true, cancelable: true }));
    expect(onActivity).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(onActivity).toHaveBeenCalledTimes(2);
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(onActivity).toHaveBeenCalledTimes(3);
  });

  it('arrastrando se queda abierto aunque el puntero salga, hasta soltar', () => {
    const { container } = render(<Harness />);
    const root = container.querySelector('.vol-ctl') as HTMLElement;
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Volumen' }));
    expect(root).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerUp(window);
    expect(root).not.toHaveAttribute('data-dragging');
  });

  it('sin deslizador (móvil), solo el silencio', () => {
    render(<Harness slider={false} />);
    expect(screen.getByRole('button', { name: 'Silenciar' })).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});
