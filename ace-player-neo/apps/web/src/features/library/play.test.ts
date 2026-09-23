import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlayer } from '../../player/api.ts';
import { playChannel } from './play.ts';
import { resetPlayback } from './test-utils.tsx';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

afterEach(() => {
  vi.useRealTimers();
  resetPlayback();
});

describe('reproducir desde la biblioteca', () => {
  it('manda el título y el tipo al reproductor y navega al canal', () => {
    const navigate = vi.fn();
    playChannel(navigate, {
      hash: HASH,
      title: 'DAZN 1',
      ih: true,
      record: true,
      origin: 'buscar',
    });
    expect(getPlayer().channel).toMatchObject({ hash: HASH, title: 'DAZN 1', kind: 'infohash' });
    expect(navigate).toHaveBeenCalledWith({ vista: 'partido', id: null, canal: HASH });
  });

  it('una señal de lista va como Content ID (B-010); solo el hash pegado deja decidir al servidor (B-009)', () => {
    const navigate = vi.fn();
    playChannel(navigate, {
      hash: HASH,
      title: 'DAZN 1',
      ih: false,
      record: true,
      origin: 'biblioteca',
    });
    expect(getPlayer().channel).toMatchObject({ hash: HASH, kind: 'id' });
    playChannel(navigate, {
      hash: OTHER,
      title: 'Stream b1b2c3d4',
      ih: null,
      record: false,
      origin: 'pegado',
    });
    expect(getPlayer().channel).toMatchObject({ hash: OTHER, kind: 'auto' });
  });

  it('un doble clic o doble toque navega UNA vez (si no, «atrás» volvería al mismo canal)', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const request = {
      hash: HASH,
      title: 'DAZN 1',
      ih: false,
      record: true,
      origin: 'biblioteca',
    } as const;
    playChannel(navigate, request);
    playChannel(navigate, request);
    expect(navigate).toHaveBeenCalledTimes(1);
    // Otro canal sí, al momento.
    playChannel(navigate, { ...request, hash: OTHER });
    expect(navigate).toHaveBeenCalledTimes(2);
    // El mismo canal, pasado el margen, también.
    vi.advanceTimersByTime(900);
    playChannel(navigate, request);
    expect(navigate).toHaveBeenCalledTimes(3);
  });
});
