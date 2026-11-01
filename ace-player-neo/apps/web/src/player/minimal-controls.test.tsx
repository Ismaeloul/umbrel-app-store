/* Controles mínimos de escritorio, «1B» (rediseño, pantalla 2): una sola
   píldora DIRECTO, sin contador, y el número de la fuente en la píldora. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerState } from './api.ts';
import {
  LiveBar,
  LivePill,
  LIVE_WINDOW_S,
  livePosition,
  sourceNumberOf,
} from './PlayerSurface.tsx';

function stateWith(over: Partial<PlayerState>): PlayerState {
  return {
    channel: { hash: 'a'.repeat(40), title: 'DAZN 1', subtitle: 'Fuente 2, Elcano' },
    phase: 'reproduciendo',
    conn: 'activa',
    demo: false,
    live: { available: true, atLive: true, behindS: 0, delayS: 6 },
    ...over,
  } as PlayerState;
}

describe('reproductor de escritorio (1B)', () => {
  it('el número de la fuente sale de «Fuente 2, Elcano»', () => {
    expect(sourceNumberOf('Fuente 2, Elcano')).toBe(2);
    expect(sourceNumberOf('Atlético – Tottenham')).toBeNull();
    expect(sourceNumberOf(undefined)).toBeNull();
  });

  it('en directo: «Directo» en rojo, sin segundos y sin hacer nada al tocarla', () => {
    const onPress = vi.fn();
    render(<LivePill state={stateWith({})} onPress={onPress} />);
    const pill = screen.getByRole('button', { name: 'En directo' });
    expect(pill).toHaveAttribute('data-mode', 'live');
    expect(pill).toHaveTextContent('Directo');
    expect(pill.textContent).not.toMatch(/\d/);
    fireEvent.click(pill);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('por detrás: gris con la flecha, sin contador, y tocarla vuelve al directo', () => {
    const onPress = vi.fn();
    render(
      <LivePill
        state={stateWith({ live: { available: true, atLive: false, behindS: 42, delayS: 6 } })}
        onPress={onPress}
      />,
    );
    const pill = screen.getByRole('button', { name: /Ir al directo/ });
    expect(pill).toHaveAttribute('data-mode', 'behind');
    expect(pill.textContent).not.toMatch(/\d/);
    fireEvent.click(pill);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('sin imagen no hay píldora', () => {
    render(<LivePill state={stateWith({ conn: 'conectando' })} onPress={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('la barra marca dónde vas: al final en directo; por detrás, tantos segundos antes', () => {
    expect(livePosition(stateWith({}))).toBe(1);
    const behind = (behindS: number) =>
      stateWith({ live: { available: true, atLive: false, behindS, delayS: 6 } });
    expect(livePosition(behind(LIVE_WINDOW_S / 2))).toBeCloseTo(0.5);
    // Nunca pegado a los bordes: ni al final ni al principio.
    expect(livePosition(behind(1))).toBeLessThan(1);
    expect(livePosition(behind(LIVE_WINDOW_S * 10))).toBeGreaterThan(0);

    const { container } = render(<LiveBar state={behind(LIVE_WINDOW_S / 2)} />);
    const bar = container.querySelector<HTMLElement>('.player-1b__bar');
    expect(bar).toHaveAttribute('data-mode', 'behind');
    expect(bar?.style.getPropertyValue('--pos')).toBe('0.5');
    // El punto solo por detrás; en directo, la barra llena sin punto.
    expect(bar?.querySelector('b')).not.toBeNull();
  });

  it('en directo la barra va llena y sin punto', () => {
    const { container } = render(<LiveBar state={stateWith({})} />);
    const bar = container.querySelector<HTMLElement>('.player-1b__bar');
    expect(bar?.style.getPropertyValue('--pos')).toBe('1');
    expect(bar?.querySelector('b')).toBeNull();
  });
});
