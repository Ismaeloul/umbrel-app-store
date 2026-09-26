/* La cápsula de «qué se ve en el otro dispositivo» (docs/multidispositivo.md
   §3): sale a los 1,5 s y no antes, no con un solo dispositivo ni si este ya
   está en la sesión, ni con el otro `away`, en inmersivo, en la demo o
   mientras el reproductor conecta o enseña el aviso de traspaso; se va a los
   1,5 s; «×» la oculta para esa sesión; tocarla se une con `join`. */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTI_TIMINGS } from '@ace/shared';
import { queryClient } from '../../api/query.ts';
import { removeItem, STORAGE_KEYS } from '../../lib/storage.ts';
import { setImmersive } from '../../notices/notify.ts';
import {
  connectRuntime,
  INITIAL_PLAYER_STATE,
  playerStore,
  resetPlayerApi,
  type PlayerCommand,
} from '../../player/api.ts';
import { HouseCapsule } from './HouseCapsule.tsx';
import { resetFollow } from './follow.ts';
import {
  H1,
  H2,
  houseSession,
  iphone,
  me,
  resetHouse,
  seedHouse,
  setSessions,
} from './test-utils.ts';

let commands: PlayerCommand[] = [];

function show() {
  return render(
    <QueryClientProvider client={queryClient}>
      <HouseCapsule placement="header" />
    </QueryClientProvider>,
  );
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  commands = [];
  resetPlayerApi();
  resetFollow();
  connectRuntime({ handle: (command) => commands.push(command) });
  setImmersive(false);
  removeItem(STORAGE_KEYS.houseHidden, 'session');
});

afterEach(() => {
  vi.useRealTimers();
  resetPlayerApi();
  resetHouse();
});

describe('HouseCapsule (§3.1)', () => {
  it('sale a los 1,5 s con «En el iPhone · DAZN LaLiga · Ver aquí» y su nombre accesible', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs - 100);
    expect(screen.queryByTestId('casa')).toBeNull();
    await wait(200);
    const button = screen.getByRole('button', {
      name: 'Ver aquí DAZN LaLiga, que se está viendo en el iPhone',
    });
    expect(button).toHaveTextContent('En el iPhone · DAZN LaLiga');
    expect(button).toHaveTextContent('Ver aquí');
    expect(screen.getByRole('button', { name: 'Ocultar este aviso' })).toBeInTheDocument();
  });

  it('con el interruptor encendido dice «Pasar aquí»; en pausa, «En pausa en…»', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone({ playing: false })])], policy: 'handoff' });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs + 50);
    expect(screen.getByTestId('casa')).toHaveTextContent('En pausa en el iPhone · DAZN LaLiga');
    expect(screen.getByTestId('casa')).toHaveTextContent('Pasar aquí');
  });

  it.each([
    ['un solo dispositivo', () => seedHouse({ sessions: [houseSession(H1, [me()])] })],
    [
      'este ya está en la sesión',
      () => seedHouse({ sessions: [houseSession(H1, [me(), iphone()])] }),
    ],
    [
      'el otro está away',
      () => seedHouse({ sessions: [houseSession(H1, [iphone({ away: true })])] }),
    ],
    [
      'sin features.multi',
      () => seedHouse({ sessions: [houseSession(H1, [iphone()])], multi: false }),
    ],
  ])('no sale: %s', async (_name, arrange) => {
    arrange();
    show();
    await wait(5_000);
    expect(screen.queryByTestId('casa')).toBeNull();
  });

  it('no sale en inmersivo, en la demo, conectando ni con el aviso de traspaso', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs + 50);
    expect(screen.getByTestId('casa')).toBeInTheDocument();
    act(() => setImmersive(true));
    expect(screen.queryByTestId('casa')).toBeNull();
    act(() => setImmersive(false));
    act(() => playerStore.set({ ...INITIAL_PLAYER_STATE, phase: 'cargando' }));
    expect(screen.queryByTestId('casa')).toBeNull();
    act(() =>
      playerStore.set({
        ...INITIAL_PLAYER_STATE,
        idleReason: 'traspasado',
        handoff: {
          kind: 'stopped',
          reason: 'other_channel',
          byLabel: 'el iPhone',
          by: { client: 'ios', deviceId: 'dev_iphone', deviceName: 'iPhone de Isma' },
          hash: H1,
          title: 'DAZN LaLiga',
          matchId: null,
          policy: 'share',
          previous: { channel: { hash: H2, title: 'Antena 3' }, route: null },
        },
      }),
    );
    expect(screen.queryByTestId('casa')).toBeNull();
    act(() => playerStore.set({ ...INITIAL_PLAYER_STATE, demo: true }));
    expect(screen.queryByTestId('casa')).toBeNull();
  });

  it('se va 1,5 s después de dejar de verse', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs + 50);
    act(() => setSessions([]));
    await wait(MULTI_TIMINGS.capsuleHideMs - 200);
    expect(screen.getByTestId('casa')).toBeInTheDocument();
    await wait(400);
    expect(screen.queryByTestId('casa')).toBeNull();
  });

  it('«×» la oculta para esa sesión y no para la siguiente', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs + 50);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar este aviso' }));
    expect(screen.queryByTestId('casa')).toBeNull();
    act(() => setSessions([houseSession(H2, [iphone()])]));
    await wait(MULTI_TIMINGS.capsuleShowMs * 2 + 100);
    expect(screen.getByTestId('casa')).toHaveTextContent('Antena 3');
  });

  it('tocarla se une con house=join', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    show();
    await wait(MULTI_TIMINGS.capsuleShowMs + 50);
    fireEvent.click(screen.getByRole('button', { name: /^Ver aquí DAZN LaLiga/ }));
    const play = commands.find((command) => command.type === 'play');
    expect(play).toMatchObject({ channel: { hash: H1 }, options: { house: 'join' } });
  });
});
