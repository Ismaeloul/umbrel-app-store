/* Seguir y unirse (docs/multidispositivo.md §2.4.3 y §3.3): join con éxito,
   la cadena cuando el otro vuelve a cambiar (H2 → H3), el tope de 3 saltos
   en 10 s, «Nada en {el PC}» y el toast de llegar tarde. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch } from '../../test/fetch.ts';
import {
  connectRuntime,
  notifyJoinExpired,
  playerStore,
  resetPlayerApi,
  type PlayCommand,
  type PlayerCommand,
} from '../../player/api.ts';
import { toastStore } from '../../notices/toasts.ts';
import { followHouse, followingStore, joinHouse, listenFollow, resetFollow } from './follow.ts';
import { registerHouseNavigation } from './house.ts';
import { H1, H2, H3, houseSession, iphone, resetHouse, seedHouse } from './test-utils.ts';

let commands: PlayerCommand[] = [];
let off: (() => void) | null = null;
let clock = 1_000_000;

const previous = {
  channel: { hash: H1, title: 'DAZN LaLiga' },
  route: { vista: 'partido' as const, id: null, canal: H1 },
};

const plays = () => commands.filter((c): c is PlayCommand => c.type === 'play');

function statusWith(...sessions: ReturnType<typeof houseSession>[]) {
  return { nowPlaying: null, learningCount: 0, serverTime: 1, sessions };
}

beforeEach(() => {
  commands = [];
  clock = 1_000_000;
  resetPlayerApi();
  resetFollow(() => clock);
  off = listenFollow();
  connectRuntime({ handle: (command) => commands.push(command) });
  seedHouse();
  toastStore.set([]);
});

afterEach(() => {
  off?.();
  resetPlayerApi();
  resetHouse();
});

function follow(hash = H2, title = 'Antena 3') {
  followHouse({
    hash,
    title,
    matchId: null,
    byDeviceId: 'dev_iphone',
    byLabel: 'el iPhone',
    previous,
  });
}

describe('seguir (§2.4.3)', () => {
  it('pide el canal nuevo con house=follow (join=1) y marca que sigue', () => {
    follow();
    expect(plays()[0]).toMatchObject({
      channel: { hash: H2, title: 'Antena 3' },
      options: { house: 'follow' },
    });
    expect(followingStore.get()).toBe(true);
    playerStore.set((state) => ({ ...state, phase: 'reproduciendo' }));
    expect(followingStore.get()).toBe(false);
  });

  it('con partido: el mismo canal con match y la ruta del partido', () => {
    followHouse({
      hash: H2,
      title: 'DAZN LaLiga',
      matchId: 'fltv-9',
      byDeviceId: 'dev_iphone',
      byLabel: 'el iPhone',
      previous,
    });
    expect(plays()[0]?.options).toMatchObject({
      house: 'follow',
      match: 'fltv-9',
      route: { vista: 'partido', id: 'fltv-9', canal: null },
    });
  });

  it('llega tarde (410): relee y sigue al mismo dispositivo donde esté ahora (H2 → H3)', async () => {
    mockFetch({
      'GET /api/v1/playback': () => json(statusWith(houseSession(H3, [iphone()]))),
    });
    follow();
    notifyJoinExpired({ channel: { hash: H2, title: 'Antena 3' }, options: { house: 'follow' } });
    await vi.waitFor(() => expect(plays()).toHaveLength(2));
    expect(plays()[1]).toMatchObject({ channel: { hash: H3 }, options: { house: 'follow' } });
  });

  it('tope de 3 saltos de más en 10 s: después, «Nada en el iPhone»', async () => {
    mockFetch({
      'GET /api/v1/playback': () => json(statusWith(houseSession(H3, [iphone()]))),
    });
    follow();
    for (let hop = 0; hop < 3; hop += 1) {
      notifyJoinExpired({ channel: { hash: H2, title: 'x' }, options: { house: 'follow' } });
      await vi.waitFor(() => expect(plays()).toHaveLength(hop + 2));
    }
    notifyJoinExpired({ channel: { hash: H2, title: 'x' }, options: { house: 'follow' } });
    await vi.waitFor(() => expect(playerStore.get().handoff?.kind).toBe('nothing'));
    expect(plays()).toHaveLength(4);
    expect(playerStore.get()).toMatchObject({
      idleReason: 'traspasado',
      message: 'El iPhone ya no está viendo nada: no hay nada que seguir.',
    });
    expect(followingStore.get()).toBe(false);
  });

  it('fuera de los 10 s tampoco sigue', async () => {
    mockFetch({
      'GET /api/v1/playback': () => json(statusWith(houseSession(H3, [iphone()]))),
    });
    follow();
    clock += 11_000;
    notifyJoinExpired({ channel: { hash: H2, title: 'x' }, options: { house: 'follow' } });
    await vi.waitFor(() => expect(playerStore.get().handoff?.kind).toBe('nothing'));
    expect(plays()).toHaveLength(1);
  });

  it('el otro ya no ve nada: panel «Nada en el iPhone» con «Volver a …»', async () => {
    mockFetch({ 'GET /api/v1/playback': () => json(statusWith()) });
    follow();
    notifyJoinExpired({ channel: { hash: H2, title: 'x' }, options: { house: 'follow' } });
    await vi.waitFor(() => expect(playerStore.get().handoff?.kind).toBe('nothing'));
    expect(playerStore.get().handoff?.previous.channel.hash).toBe(H1);
  });
});

describe('unirse (§3.3)', () => {
  it('pide con house=join y, si llega tarde, el toast', () => {
    joinHouse({ hash: H2, title: 'Antena 3', matchId: null, byLabel: 'el iPhone' });
    expect(plays()[0]?.options).toMatchObject({ house: 'join' });
    notifyJoinExpired({ channel: { hash: H2, title: 'Antena 3' }, options: { house: 'join' } });
    expect(toastStore.get().map((item) => item.text)).toContain(
      'Antena 3 ya no se está viendo en el iPhone.',
    );
  });

  it('desde Inicio abre el canal (o el centro de su partido); seguir desde otra vista no navega', () => {
    const visited: { to: unknown; replace: boolean }[] = [];
    registerHouseNavigation(
      (to, options) => visited.push({ to, replace: options?.replace === true }),
      () => ({ vista: 'agenda' }) as never,
    );
    try {
      joinHouse({ hash: H2, title: 'Antena 3', matchId: null, byLabel: 'el iPhone' });
      joinHouse({ hash: H3, title: 'DAZN', matchId: 'fltv-3', byLabel: 'el iPhone' });
      expect(visited).toEqual([
        { to: { vista: 'partido', id: null, canal: H2 }, replace: false },
        { to: { vista: 'partido', id: 'fltv-3', canal: null }, replace: false },
      ]);
      follow();
      expect(visited).toHaveLength(2);
    } finally {
      registerHouseNavigation(null, () => null);
    }
  });

  it('un seguir que no llega a dar imagen lleva followFrom (lo de antes) para «Volver a …»', () => {
    follow();
    expect(plays()[0]?.options.followFrom).toEqual(previous);
  });

  it('un join de la sesión de fuentes (sin cápsula) no saca el toast', () => {
    notifyJoinExpired({ channel: { hash: H2, title: 'Antena 3' }, options: { house: 'join' } });
    expect(toastStore.get()).toEqual([]);
  });
});
