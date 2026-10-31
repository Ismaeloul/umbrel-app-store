import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { setPlayerPresence } from '../../app/player-presence.ts';
import {
  hideScore,
  isScoreRevealed,
  resetScoreReveal,
  resetScoreRevealForTests,
  revealScore,
  setScoreHiding,
  useRevealedScores,
  useScoreCovered,
  useScoreHidden,
  useScoreHiding,
  useScoreRevealed,
  useWatchedMatch,
  watchedMatchOf,
} from './score-reveal.ts';

const partido = (id: string) => ({ vista: 'partido' as const, id, canal: null });

afterEach(() => {
  setScoreHiding(true);
  setPlayerPresence({ active: false, route: null, immersive: false });
  resetScoreRevealForTests();
});

describe('marcador tapado del partido que ves (regla 29, corrección 2)', () => {
  it('solo cuenta un partido que suena (no un canal suelto ni lo parado)', () => {
    expect(watchedMatchOf({ active: true, route: partido('a'), immersive: false })).toBe('a');
    expect(watchedMatchOf({ active: false, route: partido('a'), immersive: false })).toBeNull();
    expect(
      watchedMatchOf({
        active: true,
        route: { vista: 'partido', id: null, canal: 'f'.repeat(40) },
        immersive: false,
      }),
    ).toBeNull();
  });

  it('tapado hasta que se pide; sigue destapado hasta cambiar de partido o detener', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    const { result } = renderHook(() => ({
      a: useScoreHidden('a'),
      b: useScoreHidden('b'),
      watched: useWatchedMatch(),
    }));
    expect(result.current).toEqual({ a: true, b: false, watched: 'a' });
    act(() => revealScore('a'));
    expect(result.current.a).toBe(false);
    act(() => setPlayerPresence({ route: partido('b') }));
    expect(result.current).toEqual({ a: false, b: true, watched: 'b' });
    act(() => revealScore('b'));
    act(() => setPlayerPresence({ active: false }));
    act(() => setPlayerPresence({ active: true }));
    expect(result.current.b).toBe(true);
  });

  it('el reproductor puede volver a taparlo al cambiar de fuente', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    const { result } = renderHook(() => useScoreHidden('a'));
    act(() => revealScore('a'));
    expect(result.current).toBe(false);
    act(() => resetScoreReveal());
    expect(result.current).toBe(true);
  });

  it('«alsoWatched»: la columna tapa el partido abierto aunque aún no suene', () => {
    const { result } = renderHook(() => useScoreHidden('x', true));
    expect(result.current).toBe(true);
  });
});

describe('agenda: todo tapado hasta que se pide (corrección 1)', () => {
  it('destapar y tapar un partido; detener lo olvida (regla 29)', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    const { result } = renderHook(() => ({
      x: useScoreRevealed('x'),
      all: useRevealedScores(),
    }));
    expect(result.current.x).toBe(false);
    act(() => revealScore('x'));
    expect(result.current.x).toBe(true);
    expect(isScoreRevealed(result.current.all, 'x')).toBe(true);
    act(() => hideScore('x'));
    expect(result.current.x).toBe(false);
    act(() => revealScore('x'));
    act(() => setPlayerPresence({ active: false }));
    expect(result.current.x).toBe(false);
  });

  it('lo tapado A MANO se recuerda (la tira «En directo» no lo enseña) hasta destaparlo', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    const { result } = renderHook(() => ({
      x: useScoreCovered('x'),
      y: useScoreCovered('y'),
    }));
    // Por defecto nada está tapado a mano (la tira enseña los resultados).
    expect(result.current).toEqual({ x: false, y: false });
    act(() => hideScore('x'));
    expect(result.current).toEqual({ x: true, y: false });
    // Cambiar de partido o detener olvida lo destapado, no lo que tapaste tú.
    act(() => setPlayerPresence({ route: partido('b') }));
    act(() => resetScoreReveal());
    expect(result.current.x).toBe(true);
    act(() => revealScore('x'));
    expect(result.current.x).toBe(false);
  });

  /* El interruptor solo está en el escritorio: las pruebas de «apagado» se
     pintan dentro del armazón de escritorio. */
  const layout = (kind: LayoutValue['kind']) => {
    const value: LayoutValue = {
      kind,
      asideVisible: false,
      asideAvailable: false,
      setAsideOpen: () => {},
      columnVisible: false,
    };
    return ({ children }: { children: ReactNode }) =>
      createElement(LayoutContext.Provider, { value }, children);
  };
  const hooks = () => ({
    hiding: useScoreHiding(),
    revealed: useScoreRevealed('a'),
    hidden: useScoreHidden('a'),
    covered: useScoreCovered('a'),
    set: useRevealedScores(),
  });

  it('«Marcador oculto» apagado (Ajustes): todo se ve y se guarda en el navegador', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    const { result } = renderHook(hooks, { wrapper: layout('desktop') });
    act(() => hideScore('a'));
    expect(result.current).toMatchObject({
      hiding: true,
      revealed: false,
      hidden: true,
      covered: true,
    });
    expect(isScoreRevealed(result.current.set, 'a')).toBe(false);
    // Apagarlo olvida lo tapado a mano: el interruptor manda sobre todos.
    act(() => setScoreHiding(false));
    expect(localStorage.getItem('aceneo-marcador')).toBe('visible');
    expect(result.current).toMatchObject({
      hiding: false,
      revealed: true,
      hidden: false,
      covered: false,
    });
    // La agenda lo comprueba con el conjunto que le da useRevealedScores.
    expect(isScoreRevealed(result.current.set, 'a')).toBe(true);
    expect(isScoreRevealed(result.current.set, 'cualquiera')).toBe(true);
    act(() => setScoreHiding(true));
    expect(localStorage.getItem('aceneo-marcador')).toBe('oculto');
    expect(result.current.hidden).toBe(true);
  });

  it('apagado, «Tapar el marcador» sigue tapando ese partido (y destaparlo lo vuelve a enseñar)', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    act(() => setScoreHiding(false));
    const { result } = renderHook(hooks, { wrapper: layout('desktop') });
    const before = result.current.set;
    act(() => hideScore('a'));
    expect(result.current).toMatchObject({ revealed: false, hidden: true, covered: true });
    expect(isScoreRevealed(result.current.set, 'a')).toBe(false);
    expect(isScoreRevealed(result.current.set, 'b')).toBe(true);
    expect(result.current.set).not.toBe(before);
    act(() => revealScore('a'));
    expect(result.current).toMatchObject({ revealed: true, hidden: false, covered: false });
    expect(isScoreRevealed(result.current.set, 'a')).toBe(true);
  });

  it('en el móvil se tapa siempre, aunque se apagara con la ventana ancha', () => {
    setPlayerPresence({ active: true, route: partido('a') });
    act(() => setScoreHiding(false));
    const { result } = renderHook(hooks, { wrapper: layout('mobile') });
    expect(result.current).toMatchObject({ hiding: false, revealed: false, hidden: true });
    expect(isScoreRevealed(result.current.set, 'a')).toBe(false);
    act(() => revealScore('a'));
    expect(result.current).toMatchObject({ revealed: true, hidden: false });
  });
});
