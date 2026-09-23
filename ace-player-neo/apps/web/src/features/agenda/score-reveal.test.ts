import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlayerPresence } from '../../app/player-presence.ts';
import {
  resetScoreReveal,
  resetScoreRevealForTests,
  revealScore,
  useScoreHidden,
  useWatchedMatch,
  watchedMatchOf,
} from './score-reveal.ts';

const partido = (id: string) => ({ vista: 'partido' as const, id, canal: null });

afterEach(() => {
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
