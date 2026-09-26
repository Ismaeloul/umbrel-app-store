import type { BootstrapResponse } from '@ace/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient, routeKey } from '../../api/query.ts';
import { getPlayer } from '../../player/api.ts';
import { fixture } from '../../test/fetch.ts';
import { playChannel, takeChannelTap } from './play.ts';
import { resetPlayback } from './test-utils.tsx';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER = 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

afterEach(() => {
  vi.useRealTimers();
  resetPlayback();
  queryClient.removeQueries({ queryKey: ['v1', 'bootstrap'] });
});

function iptvActive(active: boolean) {
  const boot = fixture<BootstrapResponse>('bootstrap');
  queryClient.setQueryData(routeKey('bootstrap'), {
    ...boot,
    features: { ...boot.features, iptv: active },
  });
}

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

/* docs/iptv.md §8.4: con IPTV activa, tocar un canal no arranca AceStream
   antes de preguntar al servidor si está en la IPTV. */
describe('con IPTV activa', () => {
  const tap = {
    hash: HASH,
    title: 'DAZN 1',
    ih: false,
    record: true,
    origin: 'biblioteca',
  } as const;

  it('no llama a play(): navega y deja el encargo a la sesión del canal', () => {
    iptvActive(true);
    const navigate = vi.fn();
    playChannel(navigate, tap);
    expect(getPlayer().channel).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ vista: 'partido', id: null, canal: HASH });
    expect(takeChannelTap(OTHER)).toBeNull();
    playChannel(navigate, { ...tap, hash: OTHER, title: 'DAZN 2', ih: true, origin: 'buscar' });
    expect(takeChannelTap(OTHER)).toEqual({
      hash: OTHER,
      title: 'DAZN 2',
      kind: 'infohash',
      record: true,
      ih: true,
      iptv: null,
    });
    // Una sola vez.
    expect(takeChannelTap(OTHER)).toBeNull();
  });

  it('un encargo que nadie recoge caduca', () => {
    iptvActive(true);
    playChannel(vi.fn(), tap);
    expect(takeChannelTap(HASH, Date.now() + 11_000)).toBeNull();
  });

  it('«Pegar hash» sigue igual que hoy', () => {
    iptvActive(true);
    playChannel(vi.fn(), {
      ...tap,
      title: 'Stream a1b2c3d4',
      ih: null,
      record: false,
      origin: 'pegado',
    });
    expect(getPlayer().channel).toMatchObject({ hash: HASH, kind: 'auto' });
  });

  it('con la IPTV en pausa (features.iptv falso), lo de siempre', () => {
    iptvActive(false);
    playChannel(vi.fn(), tap);
    expect(getPlayer().channel).toMatchObject({ hash: HASH, kind: 'id' });
  });
});

describe('un canal de tu IPTV (docs/iptv.md §14.4)', () => {
  const IPTV = 'f1'.repeat(20);

  it('un id IPTV nunca llama a play(), ni con la IPTV en pausa; el encargo lleva su id', () => {
    for (const active of [true, false]) {
      resetPlayback();
      iptvActive(active);
      const navigate = vi.fn();
      playChannel(navigate, {
        hash: IPTV,
        title: 'Telecinco',
        ih: false,
        record: true,
        origin: 'buscar',
        iptv: IPTV,
      });
      expect(getPlayer().channel, String(active)).toBeNull();
      expect(navigate).toHaveBeenCalledWith({ vista: 'partido', id: null, canal: IPTV });
      expect(takeChannelTap(IPTV)).toEqual({
        hash: IPTV,
        title: 'Telecinco',
        kind: 'id',
        record: true,
        ih: false,
        iptv: IPTV,
      });
    }
  });

  it('una fila de AceStream que es un canal de tu IPTV lleva su id a la sesión', () => {
    iptvActive(true);
    playChannel(vi.fn(), {
      hash: HASH,
      title: 'Antena 3 HD',
      ih: false,
      record: true,
      origin: 'buscar',
      iptv: IPTV,
    });
    expect(takeChannelTap(HASH)?.iptv).toBe(IPTV);
  });
});
