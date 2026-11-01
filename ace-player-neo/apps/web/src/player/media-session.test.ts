/* Media Session del reproductor de casa: al desmontarse quita la barra de la pantalla de bloqueo.
   Si no, «Ver juntos» abierta desde una película heredaba esa línea de tiempo y su `seekto`
   llevaba la sala a otro sitio. */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState } from './api.ts';
import { useMediaSession, type MediaSessionActions } from './media-session.ts';

const actions: MediaSessionActions = {
  play: () => undefined,
  pause: () => undefined,
  stop: () => undefined,
  back: () => undefined,
  previous: null,
  next: null,
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaSession');
});

describe('useMediaSession', () => {
  it('al desmontarse quita la posición (setPositionState sin nada)', () => {
    const setPositionState = vi.fn();
    const mediaSession = {
      metadata: null as unknown,
      playbackState: 'none',
      setActionHandler: () => undefined,
      setPositionState,
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession });
    const state = {
      channel: null,
      phase: 'idle',
      kind: 'live',
      vod: null,
    } as unknown as PlayerState;
    const { unmount } = renderHook(() => useMediaSession(state, actions));
    setPositionState.mockClear();
    unmount();
    expect(setPositionState).toHaveBeenCalledTimes(1);
    expect(setPositionState).toHaveBeenCalledWith();
  });
});
