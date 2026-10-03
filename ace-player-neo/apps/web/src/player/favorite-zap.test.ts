/* Cambiar de canal rápido entre favoritos (favorite-zap.ts): orden, vuelta en
   los extremos, arranque desde fuera de la lista, ráfagas (solo se abre el
   último) y cuándo ↑ ↓ son del zapping. Con relojes falsos. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FavoriteZapper,
  favoriteStep,
  favoriteZapList,
  verticalKeysForZap,
  zapBannerStore,
  ZAP_BANNER_MS,
  ZAP_COMMIT_MS,
  type FavoriteChannel,
} from './favorite-zap.ts';

const fav = (id: string, title = id, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  ih: false,
  ...extra,
});

describe('favoriteZapList', () => {
  it('los favoritos en su orden guardado, sin repetidos, y marca los de la IPTV', () => {
    const list = favoriteZapList({
      favorites: [
        fav('c', 'Canal C'),
        fav('a', 'Canal A', { ih: true }),
        fav('c', 'Repetido'),
        fav('iptv1', 'DAZN 1 IPTV', { ih: true, alias: 'ES| DAZN 1', category: 'IPTV' }),
        fav('vacio', ''),
      ],
      iptvIds: { iptv1: 'ok' },
    });
    expect(list.map((item) => item.id)).toEqual(['c', 'a', 'iptv1', 'vacio']);
    expect(list[1]).toMatchObject({ ih: true, iptv: false });
    // Un id IPTV nunca es un infohash (no va al motor) y conserva su alias.
    expect(list[2]).toMatchObject({ ih: false, iptv: true, alias: 'ES| DAZN 1' });
    expect(list[3]?.title).toBe('Canal sin nombre');
  });

  it('sin biblioteca o sin favoritos, vacía', () => {
    expect(favoriteZapList(null)).toEqual([]);
    expect(favoriteZapList({ favorites: [] })).toEqual([]);
  });
});

describe('favoriteStep', () => {
  it('avanza y retrocede dando la vuelta en los extremos', () => {
    expect(favoriteStep(4, 0, 1)).toBe(1);
    expect(favoriteStep(4, 3, 1)).toBe(0);
    expect(favoriteStep(4, 0, -1)).toBe(3);
    expect(favoriteStep(4, 2, -1)).toBe(1);
  });

  it('desde fuera de la lista: ↓ al primero, ↑ al último', () => {
    expect(favoriteStep(4, -1, 1)).toBe(0);
    expect(favoriteStep(4, -1, -1)).toBe(3);
    expect(favoriteStep(0, -1, 1)).toBe(-1);
  });
});

describe('FavoriteZapper (ráfagas con relojes falsos)', () => {
  const LIST: FavoriteChannel[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
    id,
    title: `Canal ${index + 1}`,
    ih: false,
    iptv: id === 'e',
  }));
  let current: string | null;
  let open: ReturnType<typeof vi.fn<(channel: FavoriteChannel, p: number, t: number) => void>>;
  let zapper: FavoriteZapper;

  beforeEach(() => {
    vi.useFakeTimers();
    current = 'a';
    open = vi.fn();
    zapper = new FavoriteZapper({ current: () => current, open });
  });

  afterEach(() => {
    zapper.cancel();
    vi.useRealTimers();
  });

  it('tres ↓ seguidos llegan al tercero y SOLO entonces se abre (no los intermedios)', () => {
    zapper.press(1, LIST);
    vi.advanceTimersByTime(ZAP_COMMIT_MS - 100);
    zapper.press(1, LIST);
    vi.advanceTimersByTime(ZAP_COMMIT_MS - 100);
    zapper.press(1, LIST);
    // El cartel va diciendo adónde se llega, sin abrir nada todavía.
    expect(zapBannerStore.get()).toMatchObject({
      channel: { id: 'd' },
      position: 4,
      total: 5,
      committed: false,
    });
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ZAP_COMMIT_MS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LIST[3], 4, 5);
    expect(zapBannerStore.get()?.committed).toBe(true);
  });

  it('el cartel se queda unos 2 s con el canal ya abierto y se va solo', () => {
    zapper.press(1, LIST);
    vi.advanceTimersByTime(ZAP_COMMIT_MS);
    expect(zapBannerStore.get()?.committed).toBe(true);
    vi.advanceTimersByTime(ZAP_BANNER_MS - 1);
    expect(zapBannerStore.get()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(zapBannerStore.get()).toBeNull();
  });

  it('da la vuelta: ↑ desde el primero va al último', () => {
    zapper.press(-1, LIST);
    vi.runOnlyPendingTimers();
    expect(open).toHaveBeenCalledWith(LIST[4], 5, 5);
  });

  it('si lo que suena no es un favorito, ↓ empieza por el primero y ↑ por el último', () => {
    current = 'partido-x';
    expect(zapper.press(1, LIST)?.id).toBe('a');
    zapper.cancel();
    expect(zapper.press(-1, LIST)?.id).toBe('e');
    vi.runOnlyPendingTimers();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(LIST[4], 5, 5);
  });

  it('dar la vuelta entera y acabar en el que suena no reabre nada', () => {
    for (let i = 0; i < LIST.length; i += 1) zapper.press(1, LIST);
    vi.runOnlyPendingTimers();
    expect(open).not.toHaveBeenCalled();
  });

  it('ida y vuelta (↓ ↓ ↑) se queda en el siguiente', () => {
    zapper.press(1, LIST);
    zapper.press(1, LIST);
    zapper.press(-1, LIST);
    vi.runOnlyPendingTimers();
    expect(open).toHaveBeenCalledWith(LIST[1], 2, 5);
  });

  it('tras abrir, la ráfaga siguiente parte del canal que suena', () => {
    zapper.press(1, LIST);
    vi.advanceTimersByTime(ZAP_COMMIT_MS);
    current = 'b';
    zapper.press(1, LIST);
    vi.advanceTimersByTime(ZAP_COMMIT_MS);
    expect(open).toHaveBeenLastCalledWith(LIST[2], 3, 5);
  });

  it('cancelar (detener, minimizar) olvida la ráfaga y quita el cartel', () => {
    zapper.press(1, LIST);
    expect(zapper.busy).toBe(true);
    zapper.cancel();
    expect(zapper.busy).toBe(false);
    expect(zapBannerStore.get()).toBeNull();
    vi.runAllTimers();
    expect(open).not.toHaveBeenCalled();
  });

  it('sin favoritos no hace nada', () => {
    expect(zapper.press(1, [])).toBeNull();
    expect(zapBannerStore.get()).toBeNull();
  });
});

describe('verticalKeysForZap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('con el foco en ninguna parte o en el reproductor, sí; en la página, no (las flechas desplazan)', () => {
    const player = document.createElement('section');
    const button = document.createElement('button');
    player.append(button);
    const link = document.createElement('a');
    link.href = '#x';
    document.body.append(player, link);
    expect(verticalKeysForZap(player, false, document.body)).toBe(true);
    expect(verticalKeysForZap(player, false, button)).toBe(true);
    expect(verticalKeysForZap(player, false, link)).toBe(false);
    // A pantalla completa (o en modo teatro) no hay página que desplazar.
    expect(verticalKeysForZap(player, true, link)).toBe(true);
  });

  it('nunca donde ↑ ↓ ya hacen algo: campos, deslizadores, listas, menús', () => {
    const player = document.createElement('section');
    const range = document.createElement('input');
    range.type = 'range';
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    listbox.append(option);
    player.append(range, listbox);
    document.body.append(player);
    expect(verticalKeysForZap(player, true, range)).toBe(false);
    expect(verticalKeysForZap(player, true, option)).toBe(false);
  });
});
