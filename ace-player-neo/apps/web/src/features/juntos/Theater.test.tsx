/* El reproductor de la sala (docs/ver-juntos.md §12). Lo que le pasó a un
   invitado: iba sincronizado, pero su contador decía 0:10 con la sala en el
   minuto 10. El tiempo y la barra salen del reloj de la sala, no del vídeo. */

import type { PartyRoom } from '@ace/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { PartyClient, type PartyEnv, type PartyState } from './client.ts';
import type { PlayerView, RoomPlayer } from './player.ts';
import { Theater } from './Theater.tsx';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const NOW = 1_000_000;

function setup(selfId: string, over: Partial<PartyRoom> = {}) {
  const env: PartyEnv = {
    now: () => NOW,
    eventSource: () => new EventTarget() as unknown as EventSource,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  const client = new PartyClient(
    joined.room.code,
    { id: selfId, token: `${selfId}.secreto0123456789abcdef` },
    env,
  );
  /* El vídeo de este aparato dice 0:10 (como el del invitado). */
  const view: PlayerView = {
    phase: 'ready',
    error: null,
    positionS: 10,
    durationS: 6516,
    bufferedS: 30,
    buffering: false,
  };
  const player = {
    subscribe: () => () => undefined,
    getView: () => view,
  } as unknown as RoomPlayer;
  const room: PartyRoom = {
    ...(joined.room as PartyRoom),
    title: { ...(joined.room as PartyRoom).title, durationS: 6516 },
    playback: { playing: true, positionS: 600, at: NOW, rev: 3, waitingFor: [] },
    ...over,
  };
  const state = { ...client.getState(), room } as PartyState;
  render(
    <Theater
      player={player}
      client={client}
      room={room}
      state={state}
      video={null}
      fullscreen={false}
      onFullscreen={() => undefined}
      chatOpen={false}
      onChat={() => undefined}
      unread={0}
    />,
  );
}

describe('«Ver juntos»: el reproductor', () => {
  it('el tiempo es el de la sala (10:00), no el del vídeo de este aparato (0:10)', () => {
    setup(ANA);
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.queryByText('0:10')).toBeNull();
  });

  it('quien no manda no tiene reproducir ni ±10 s y ve quién controla', () => {
    setup(ANA);
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avanzar 10 segundos' })).toBeNull();
    expect(screen.getByText('Controla Isma (líder)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reaccionar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy();
  });

  it('el líder tiene los controles', () => {
    setup(HOST);
    expect(screen.getAllByRole('button', { name: 'Pausar' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Avanzar 10 segundos' })).toBeTruthy();
    expect(screen.queryByText(/^Controla /)).toBeNull();
  });
});
