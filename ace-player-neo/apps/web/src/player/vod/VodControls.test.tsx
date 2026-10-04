/* Los controles de una película (docs/vod.md §12.7): la barra salta al
   soltar, ±10 s, el tiempo, «Siguiente episodio» y las tarjetas del final. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INITIAL_PLAYER_STATE, type PlayerState, type VodPlayback } from '../api.ts';
import type { PlayerActions, PlayerContextValue } from '../context.ts';
import { VodEndCards } from './NextUp.tsx';
import { timeAtPointer, VodControls } from './VodControls.tsx';

const VOD: VodPlayback = {
  id: 'c1d2e3f4a5b60718293a4b5c6d7e8f9012345678',
  kind: 'episode',
  seriesId: 'd1d2e3f4a5b60718293a4b5c6d7e8f9012345678',
  title: 'The Office',
  subtitle: 'T2 · E6 · Todo cambia',
  positionS: 754,
  durationS: 6320,
  bufferedEndS: 800,
  audio: [],
  audioIndex: 0,
  next: { id: 'e1d2e3f4a5b60718293a4b5c6d7e8f9012345678', title: 'La verdad', label: 'T2 · E7' },
  poster: null,
  format: 'H.264 · AAC',
  restarts: 0,
  ended: false,
  nextUp: null,
  resumedAtS: null,
  seekingTo: null,
  failure: null,
};

function actions(): PlayerActions {
  const fn = () => vi.fn();
  return {
    toggle: fn(),
    tapToPlay: fn(),
    stop: fn(),
    retry: fn(),
    goLive: fn(),
    back: fn(),
    toggleMute: fn(),
    setVolume: fn(),
    toggleFullscreen: fn(),
    toggleTheater: fn(),
    togglePip: fn(),
    toggleNerd: fn(),
    toggleFavorite: fn(),
    zap: fn(),
    zapFavorite: fn(),
    minimize: fn(),
    expand: fn(),
    seekBy: fn(),
    seekTo: fn(),
    nextEpisode: fn(),
    watchCredits: fn(),
    keepWatching: fn(),
    leaveVod: fn(),
    replay: fn(),
    setAudio: fn(),
    openTitle: fn(),
  };
}

function ctxWith(a: PlayerActions): PlayerContextValue {
  return {
    runtime: null,
    presentation: 'stage',
    actions: a,
    menuItems: [],
    fullscreen: false,
    theater: false,
    pip: false,
    canFullscreen: true,
    canPip: false,
    canZap: false,
    canZapFavorites: false,
    isFavorite: false,
    finePointer: true,
    compact: false,
    immersive: false,
    nerdHosted: false,
  };
}

const playing: PlayerState = {
  ...INITIAL_PLAYER_STATE,
  kind: 'vod',
  vod: VOD,
  phase: 'reproduciendo',
  conn: 'activa',
  desiredPlaying: true,
  started: true,
};

describe('VodControls', () => {
  /** La pista pintada mide 400 px desde x = 100 (jsdom no maqueta). */
  function placeTrack(container: HTMLElement) {
    const track = container.querySelector<HTMLElement>('.vod-bar__track');
    if (!track) throw new Error('sin pista');
    track.getBoundingClientRect = () =>
      ({
        left: 100,
        width: 400,
        top: 0,
        height: 4,
        right: 500,
        bottom: 4,
        x: 100,
        y: 0,
      }) as DOMRect;
    return container.querySelector<HTMLElement>('.vod-bar') as HTMLElement;
  }

  it('barra «Posición» con «12:34 de 1:45:20»; arrastrar no salta, soltar sí', () => {
    const a = actions();
    const { container } = render(<VodControls state={playing} ctx={ctxWith(a)} />);
    const slider = screen.getByRole('slider', { name: 'Posición' });
    expect(slider).toHaveAttribute('aria-valuetext', '12:34 de 1:45:20');
    const bar = placeTrack(container);
    fireEvent.pointerDown(bar, { clientX: 200, pointerType: 'mouse', button: 0, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 300, pointerType: 'mouse', pointerId: 1 });
    expect(a.seekTo).not.toHaveBeenCalled();
    fireEvent.pointerUp(bar, { clientX: 300, pointerType: 'mouse', pointerId: 1 });
    // La mitad de la pista: la mitad de 6320 s.
    expect(a.seekTo).toHaveBeenCalledTimes(1);
    expect(a.seekTo).toHaveBeenCalledWith(3160);
  });

  it('el tiempo flotante y el salto caen en el mismo punto de la pista (y en los bordes)', () => {
    const a = actions();
    const { container } = render(<VodControls state={playing} ctx={ctxWith(a)} />);
    const bar = placeTrack(container);
    // Pasar el ratón: el tiempo flotante dice 26:20 (un cuarto de 1:45:20).
    fireEvent.pointerMove(bar, { clientX: 200, pointerType: 'mouse' });
    expect(container.querySelector('.vod-bar__tip')).toHaveTextContent('26:20');
    expect(
      (container.querySelector('.vod-bar__tip') as HTMLElement).style.getPropertyValue('--x'),
    ).toBe('0.25');
    // Clic ahí mismo: salta a 26:20, ni medio pulgar más ni menos.
    fireEvent.pointerDown(bar, { clientX: 200, pointerType: 'mouse', button: 0, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 200, pointerType: 'mouse', pointerId: 1 });
    expect(a.seekTo).toHaveBeenLastCalledWith(1580);
    // Con el dedo más allá del borde, el final (y no más).
    fireEvent.pointerDown(bar, { clientX: 640, pointerType: 'touch', pointerId: 2 });
    fireEvent.pointerUp(bar, { clientX: 640, pointerType: 'touch', pointerId: 2 });
    expect(a.seekTo).toHaveBeenLastCalledWith(6320);
  });

  it('timeAtPointer: misma fórmula para todo, sin márgenes', () => {
    const track = { left: 10, width: 200 };
    expect(timeAtPointer(10, track, 100)).toBe(0);
    expect(timeAtPointer(110, track, 100)).toBe(50);
    expect(timeAtPointer(210, track, 100)).toBe(100);
    expect(timeAtPointer(-50, track, 100)).toBe(0);
    expect(timeAtPointer(110, { left: 0, width: 0 }, 100)).toBeNull();
    expect(timeAtPointer(110, track, 0)).toBeNull();
  });

  it('← → en la barra saltan 10 s; los botones ±10 y «Siguiente episodio»', () => {
    const a = actions();
    render(<VodControls state={playing} ctx={ctxWith(a)} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Posición' }), { key: 'ArrowLeft' });
    expect(a.seekBy).toHaveBeenLastCalledWith(-10);
    fireEvent.click(screen.getByRole('button', { name: 'Avanzar 10 segundos' }));
    expect(a.seekBy).toHaveBeenLastCalledWith(10);
    fireEvent.click(screen.getByRole('button', { name: 'Retroceder 10 segundos' }));
    expect(a.seekBy).toHaveBeenLastCalledWith(-10);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente episodio: T2 · E7' }));
    expect(a.nextEpisode).toHaveBeenCalled();
  });

  it('el tiempo «12:34 / 1:45:20»; al tocarlo, lo que queda', () => {
    render(<VodControls state={playing} ctx={ctxWith(actions())} />);
    const clock = screen.getByRole('button', { name: /12:34 de 1:45:20/ });
    fireEvent.click(clock);
    expect(screen.getByRole('button', { name: /Quedan 1:32:46/ })).toBeInTheDocument();
  });

  it('tarjeta del siguiente con «Ver ahora» y «Ver créditos»; «¿Sigues viendo?»; «Terminada»', () => {
    const a = actions();
    const { rerender } = render(
      <VodEndCards
        state={{
          ...playing,
          vod: { ...VOD, nextUp: { mode: 'countdown', endsAt: Date.now() + 9000 } },
        }}
        actions={a}
      />,
    );
    expect(screen.getByText('Siguiente episodio · T2 · E7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver créditos' }));
    expect(a.watchCredits).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver ahora' }));
    expect(a.nextEpisode).toHaveBeenCalled();
    rerender(
      <VodEndCards
        state={{
          ...playing,
          vod: { ...VOD, nextUp: { mode: 'still', endsAt: Date.now() + 60_000 } },
        }}
        actions={a}
      />,
    );
    expect(screen.getByText('¿Sigues viendo «The Office»?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(a.leaveVod).toHaveBeenCalled();
    rerender(
      <VodEndCards
        state={{ ...playing, vod: { ...VOD, kind: 'movie', next: null, ended: true } }}
        actions={a}
      />,
    );
    expect(screen.getByText('Terminada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver de nuevo' }));
    expect(a.replay).toHaveBeenCalled();
  });
});
