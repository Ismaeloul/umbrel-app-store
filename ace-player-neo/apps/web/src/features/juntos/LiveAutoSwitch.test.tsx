/* «Cambio automático si se cae» (docs/ver-juntos.md §14): el freno de 3 saltos
   seguidos sin que suene ninguna y un salto cada 30 s como mucho.

   Lo que pasaba: el freno se reiniciaba con la fase 'ready', que llega con la
   concesión, antes de que suene nada. Con el motor fallando después de dar la
   concesión (interrupted='failed'), la sala recorría las fuentes en bucle, una
   cada 30 s, para siempre. Y si el fallo llegaba antes de los 30 s desde el
   último salto, no se volvía a intentar nunca. */

import type { PartyLive, PartyRoom } from '@ace/shared';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import type { PartyClient } from './client.ts';
import type * as Live from './live.ts';
import type { LiveSource } from './live.ts';
import type { PlayerView, RoomPlayer } from './player.ts';
import { LiveAutoSwitch } from './Room.tsx';

const sources = vi.hoisted(() => ({ list: [] as LiveSource[] }));

vi.mock('./LivePanels.tsx', () => ({
  useRoomMatch: () => null,
  LiveMatches: () => null,
  LiveSources: () => null,
}));
vi.mock('./live.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Live>()),
  useLiveSources: () => ({ data: sources.list }),
}));

const HOST = 'm_IsmaAnfitrion';
const hash = (n: number) => String(n).repeat(40).slice(0, 40);
const source = (n: number): LiveSource => ({
  choice: {
    hash: hash(n),
    channel: `DAZN ${n}`,
    source: 'engine',
    matchId: 'p1',
    match: 'Real Madrid – Barcelona',
  },
  group: 'DAZN',
  quality: '1080p',
});

const liveOf = (n: number): PartyLive => ({ ...source(n).choice, auto: true });

function roomWith(n: number, interrupted: PartyRoom['interrupted']): PartyRoom {
  return { ...(joined.room as PartyRoom), live: liveOf(n), interrupted };
}

/** Un reproductor falso al que se le cambia la vista desde el test. */
function fakePlayer() {
  let view: PlayerView = {
    phase: 'ready',
    error: null,
    positionS: 0,
    durationS: null,
    bufferedS: 0,
    buffering: false,
    quality: null,
    sounded: false,
  };
  const listeners = new Set<() => void>();
  const player = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getView: () => view,
  } as unknown as RoomPlayer;
  const setView = (patch: Partial<PlayerView>) => {
    view = { ...view, ...patch };
    act(() => {
      for (const listener of [...listeners]) listener();
    });
  };
  return { player, setView };
}

function setup() {
  const control = vi.fn(async () => undefined);
  const client = { credential: { id: HOST }, control } as unknown as PartyClient;
  const { player, setView } = fakePlayer();
  const view = render(
    <LiveAutoSwitch room={roomWith(1, 'failed')} client={client} player={player} />,
  );
  const show = (room: PartyRoom) =>
    view.rerender(<LiveAutoSwitch room={room} client={client} player={player} />);
  const jumpedTo = () =>
    control.mock.calls.map(
      (call) => (call as unknown as [{ live: { hash: string } }])[0].live.hash,
    );
  return { control, show, setView, jumpedTo };
}

/** El servidor pone la fuente nueva (sin interrupción) y, pasado `afterMs`, falla otra vez. */
function failAfter(ctx: ReturnType<typeof setup>, n: number, afterMs: number): void {
  ctx.show(roomWith(n, null));
  /* La concesión llega: 'ready', pero sin sonar. */
  ctx.setView({ phase: 'ready', sounded: false });
  act(() => {
    vi.advanceTimersByTime(afterMs);
  });
  ctx.show(roomWith(n, 'failed'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T20:00:00Z'));
  sources.list = [1, 2, 3, 4, 5, 6].map(source);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('«Cambio automático si se cae» (§14)', () => {
  it('con fallos después de la concesión, para a los 3 saltos y no repite fuentes', () => {
    const ctx = setup();
    expect(ctx.jumpedTo()).toEqual([hash(2)]);
    failAfter(ctx, 2, 31_000);
    expect(ctx.jumpedTo()).toEqual([hash(2), hash(3)]);
    failAfter(ctx, 3, 31_000);
    expect(ctx.jumpedTo()).toEqual([hash(2), hash(3), hash(4)]);
    /* La tercera tampoco suena: ahí se queda, por mucho que pase el tiempo. */
    failAfter(ctx, 4, 31_000);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(ctx.control).toHaveBeenCalledTimes(3);
    expect(new Set(ctx.jumpedTo()).size).toBe(3);
  });

  it('un fallo antes de los 30 s desde el último salto se vuelve a mirar al cumplirse', () => {
    const ctx = setup();
    expect(ctx.control).toHaveBeenCalledTimes(1);
    failAfter(ctx, 2, 10_000);
    expect(ctx.control).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(ctx.control).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(ctx.jumpedTo()).toEqual([hash(2), hash(3)]);
  });

  it('una que suena de verdad vuelve a dar los 3 saltos', () => {
    const ctx = setup();
    failAfter(ctx, 2, 31_000);
    failAfter(ctx, 3, 31_000);
    expect(ctx.control).toHaveBeenCalledTimes(3);
    /* La cuarta suena un buen rato y luego se cae: el freno empieza de cero. */
    ctx.show(roomWith(4, null));
    ctx.setView({ phase: 'ready', sounded: true });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    ctx.setView({ sounded: false });
    ctx.show(roomWith(4, 'failed'));
    expect(ctx.control).toHaveBeenCalledTimes(4);
    expect(ctx.jumpedTo().at(-1)).not.toBe(hash(4));
  });
});
