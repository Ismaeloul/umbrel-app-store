import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, isChunkLoadError } from './ErrorBoundary.tsx';
import { requestFocus } from './focus.ts';
import { playerPresence, setPlayerPresence } from './player-presence.ts';
import { resetScrollMemory, saveScroll, savedScroll, scrollKey } from './scroll-memory.ts';

describe('focus.requestFocus', () => {
  it('enfoca el campo marcado en cuanto aparece', async () => {
    const promise = requestFocus('buscar-biblioteca', { timeoutMs: 500 });
    const input = document.createElement('input');
    input.dataset.focusTarget = 'buscar-biblioteca';
    input.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.appendChild(input);
    await expect(promise).resolves.toBe(true);
    expect(input).toHaveFocus();
    input.remove();
  });

  it('se rinde si no llega', async () => {
    await expect(requestFocus('no-existe', { timeoutMs: 30 })).resolves.toBe(false);
  });
});

describe('scroll-memory', () => {
  it('cada vista guarda su posición; cada partido la suya', () => {
    resetScrollMemory();
    saveScroll({ vista: 'agenda' }, 640);
    saveScroll({ vista: 'partido', id: 'a', canal: null }, 300);
    expect(savedScroll({ vista: 'agenda' })).toBe(640);
    expect(savedScroll({ vista: 'partido', id: 'b', canal: null })).toBe(0);
    expect(scrollKey({ vista: 'ajustes', seccion: 'salud' })).toBe('ajustes');
  });
});

describe('player-presence', () => {
  it('solo avisa si cambia algo', () => {
    const listener = vi.fn();
    const off = playerPresence.subscribe(listener);
    setPlayerPresence({ active: true });
    setPlayerPresence({ active: true });
    expect(listener).toHaveBeenCalledOnce();
    setPlayerPresence({ active: false });
    off();
  });
});

function Rompe(): never {
  throw new Error('fallo');
}

describe('ErrorBoundary', () => {
  it('solo cae la vista, con dos salidas', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const home = vi.fn();
    render(
      <ErrorBoundary what="la agenda" onHome={home}>
        <Rompe />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole('heading', { name: 'No se pudo enseñar la agenda' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Ir a la agenda' }).click();
    expect(home).toHaveBeenCalledOnce();
  });

  it('reconoce un trozo de JS que ya no existe (release nueva)', () => {
    expect(
      isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')),
    ).toBe(true);
    expect(isChunkLoadError(new Error('otro'))).toBe(false);
  });
});
