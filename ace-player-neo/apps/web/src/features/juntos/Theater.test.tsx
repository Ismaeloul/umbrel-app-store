/* El reproductor de la sala (docs/ver-juntos.md §12 y §13). Lo que le pasó a un
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

function setup(selfId: string, over: Partial<PartyRoom> = {}, desk = true) {
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
    playback: { playing: true, positionS: 600, at: NOW, rev: 3, waitingFor: [], lobby: false },
    ...over,
  };
  const state = { ...client.getState(), room } as PartyState;
  render(
    <Theater
      player={player}
      client={client}
      room={room}
      state={state}
      video={document.createElement('video')}
      fullscreen={false}
      onFullscreen={() => undefined}
      desk={desk}
    />,
  );
}

describe('«Ver juntos»: el reproductor', () => {
  it('el tiempo es el de la sala (10:00), no el del vídeo de este aparato (0:10)', () => {
    setup(ANA);
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.queryByText('0:10')).toBeNull();
  });

  it('el invitado no tiene pausa ni ±10 s, y su barra va sin tirador', () => {
    setup(ANA);
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avanzar 10 segundos' })).toBeNull();
    expect(document.querySelector('.juntos-chrome__bar--locked')).toBeTruthy();
    /* La barra no es un deslizador que no hace nada: es de solo lectura (sin foco). */
    expect(screen.queryByRole('slider', { name: 'Posición' })).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Posición' })).toHaveAttribute(
      'aria-valuetext',
      '10:00 / 1:48:36',
    );
    expect(screen.getByText('Sala de Isma · 2')).toBeTruthy();
    expect(screen.getByText('Sincronizados')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeTruthy();
    /* Sin reacciones ni chat encima del vídeo. */
    expect(screen.queryByRole('button', { name: 'Reaccionar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  });

  it('un co-líder controla como el líder', () => {
    setup(ANA, {
      members: (joined.room as PartyRoom).members.map((m) =>
        m.id === ANA ? { ...m, role: 'coleader' as const } : m,
      ),
    });
    expect(screen.getByRole('button', { name: 'Avanzar 10 segundos' })).toBeTruthy();
    expect(document.querySelector('.juntos-chrome__bar--locked')).toBeNull();
  });

  it('el líder tiene los controles', () => {
    setup(HOST);
    expect(screen.getAllByRole('button', { name: 'Pausar' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Avanzar 10 segundos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retroceder 10 segundos' })).toBeTruthy();
  });

  it('en escritorio, como la maqueta: sin volumen (la M silencia)', () => {
    setup(HOST);
    expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Posición' })).toBeTruthy();
  });
});

describe('«Ver juntos»: el reproductor en el móvil (como siempre)', () => {
  it('arriba el título y quién manda; abajo, el volumen; sin reacciones ni chat', () => {
    setup(ANA, {}, false);
    expect(screen.getByText((joined.room as PartyRoom).title.title)).toBeTruthy();
    expect(screen.getByText('Controla Isma (líder)')).toBeTruthy();
    expect(screen.queryByText('Sala de Isma · 2')).toBeNull();
    expect(screen.getByRole('button', { name: 'Silenciar' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Posición' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reaccionar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  });

  it('el líder: el botón grande y, abajo, reproducir y ±10 s', () => {
    setup(HOST, {}, false);
    expect(screen.getAllByRole('button', { name: 'Pausar' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Avanzar 10 segundos' })).toBeTruthy();
    expect(document.querySelector('.juntos-center__controls')).toBeNull();
  });
});
