/* El reproductor de la sala (docs/ver-juntos.md §12 y §13). Lo que le pasó a un
   invitado: iba sincronizado, pero su contador decía 0:10 con la sala en el
   minuto 10. El tiempo y la barra salen del reloj de la sala, no del vídeo. */

import type { PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { PartyClient, type PartyEnv, type PartyState } from './client.ts';
import type { PlayerQuality, PlayerView, RoomPlayer } from './player.ts';
import { Theater } from './Theater.tsx';
import { resetMemoryStorage, STORAGE_KEYS } from '../../lib/storage.ts';
import { readSavedVolume, saveVolume } from '../../player/volume.ts';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const NOW = 1_000_000;

function setup(
  selfId: string,
  over: Partial<PartyRoom> = {},
  quality: PlayerQuality | null = null,
) {
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
    quality,
    sounded: true,
  };
  const setQuality = vi.fn();
  const player = {
    subscribe: () => () => undefined,
    getView: () => view,
    setQuality,
  } as unknown as RoomPlayer;
  const control = vi.spyOn(client, 'control');
  const room: PartyRoom = {
    ...(joined.room as PartyRoom),
    title: { ...(joined.room as PartyRoom).title, durationS: 6516 },
    playback: { playing: true, positionS: 600, at: NOW, rev: 3, waitingFor: [], lobby: false },
    ...over,
  };
  const state = { ...client.getState(), room } as PartyState;
  /* El de la sala lo crea player.ts: aquí, uno suelto. */
  const video = document.createElement('video');
  render(
    <Theater
      player={player}
      client={client}
      room={room}
      state={state}
      video={video}
      fullscreen={false}
      onFullscreen={() => undefined}
    />,
  );
  return { setQuality, control, video };
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

  it('las flechas de unas pestañas o de un Segmented no mueven a toda la sala', () => {
    const { control } = setup(HOST);
    control.mockResolvedValue(undefined);
    /* Unas pestañas que ya usan la flecha (useRovingKeys llama a preventDefault). */
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tabs.append(tab);
    document.body.append(tabs);
    tab.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(control).not.toHaveBeenCalled();
    /* Aunque nadie la haya usado: dentro de un grupo de opciones, tampoco. */
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    const option = document.createElement('button');
    group.append(option);
    document.body.append(group);
    fireEvent.keyDown(option, { key: 'ArrowLeft' });
    expect(control).not.toHaveBeenCalled();
    /* Fuera de ellos, la flecha sí avanza 10 s. */
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(control).toHaveBeenCalledWith({ action: 'seek', positionS: 610 });
    tabs.remove();
    group.remove();
  });

  it('en el móvil, sin volumen: mandan los botones del teléfono (la M silencia)', () => {
    setup(HOST);
    expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Volumen' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Posición' })).toBeTruthy();
  });

  it('en el ordenador, silencio y volumen de este aparato: no mandan nada a la sala y se recuerda', async () => {
    const realMatchMedia = window.matchMedia;
    // 1280 px con ratón: casan las de ancho y la de puntero fino.
    window.matchMedia = ((query: string) => ({
      matches: /min-width|pointer: fine/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      saveVolume(0.6);
      const { control, video } = setup(ANA);
      /* El nivel que dejó este navegador, puesto al llegar. */
      expect(video.volume).toBeCloseTo(0.6);
      const slider = screen.getByRole('slider', { name: 'Volumen' });
      await waitFor(() => expect(slider).toHaveAttribute('aria-valuetext', '60 %'));
      fireEvent.keyDown(slider, { key: 'ArrowDown' });
      expect(video.volume).toBeCloseTo(0.55);
      expect(readSavedVolume()).toBe(0.55);
      fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
      expect(video.muted).toBe(true);
      expect(control).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = realMatchMedia;
      localStorage.removeItem(STORAGE_KEYS.volume);
      resetMemoryStorage();
    }
  });
});

describe('«Ver juntos»: el volumen según el aparato', () => {
  /** matchMedia de pega: casan las consultas que digan `matches`. */
  function withMedia(matches: RegExp, run: () => void | Promise<void>) {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: matches.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const restore = () => {
      window.matchMedia = realMatchMedia;
      localStorage.removeItem(STORAGE_KEYS.volume);
      resetMemoryStorage();
    };
    return Promise.resolve().then(run).finally(restore);
  }

  it('el iPhone en horizontal (≥ 768 px, sin ratón): tampoco hay volumen con la película', () =>
    withMedia(/min-width: 768px/, () => {
      setup(HOST);
      expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull();
      expect(screen.queryByRole('slider', { name: 'Volumen' })).toBeNull();
    }));

  it('en el ordenador, la M con el volumen a 0 lo devuelve al guardado y suena (como el botón)', () =>
    withMedia(/min-width|pointer: fine/, () => {
      saveVolume(0.6);
      const { video } = setup(ANA);
      const slider = screen.getByRole('slider', { name: 'Volumen' });
      fireEvent.keyDown(slider, { key: 'Home' });
      expect(video.volume).toBe(0);
      expect(video.muted).toBe(true);
      fireEvent.keyDown(document.body, { key: 'm' });
      expect(video.muted).toBe(false);
      expect(video.volume).toBeCloseTo(0.6);
      fireEvent.keyDown(document.body, { key: 'm' });
      expect(video.muted).toBe(true);
    }));
});

describe('«Ver juntos»: el reproductor en el móvil (ver-juntos-pelis.html)', () => {
  it('el mismo que en escritorio: «Sala de Isma · 2» arriba y −10 s, pausa y +10 s en el centro', () => {
    setup(HOST);
    expect(screen.getByText('Sala de Isma · 2')).toBeTruthy();
    expect(document.querySelector('.juntos-center__controls')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Pausar' })).toHaveLength(1);
    expect(screen.queryByText('Controla Isma (líder)')).toBeNull();
  });
});

describe('«Ver juntos»: «Calidad» del invitado (§17)', () => {
  const both: PlayerQuality = { choice: 'auto', current: 'lite' };

  it('sin dos versiones no hay menú (en casa, como siempre)', () => {
    setup(ANA);
    expect(screen.queryByRole('button', { name: 'Calidad' })).toBeNull();
  });

  it('con las dos: Automática (lo que suena), Alta y Ligera; elegir es de este aparato, sin orden a la sala', () => {
    const { setQuality, control } = setup(ANA, {}, both);
    fireEvent.click(screen.getByRole('button', { name: 'Calidad' }));
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Automática (ahora 720p)' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Ligera (720p)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Alta (original)' }));
    expect(setQuality).toHaveBeenCalledWith('hd');
    expect(control).not.toHaveBeenCalled();
  });

  it('también para quien no controla y en el móvil; nunca en directo', () => {
    const { setQuality } = setup(ANA, {}, { choice: 'hd', current: 'hd' });
    fireEvent.click(screen.getByRole('button', { name: 'Calidad' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Alta (original)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ligera (720p)' }));
    expect(setQuality).toHaveBeenCalledWith('lite');
  });

  it('en directo no sale aunque el reproductor dijera que hay dos', () => {
    setup(
      HOST,
      {
        live: {
          hash: 'a'.repeat(40),
          channel: 'DAZN 1',
          source: 'iptv',
          matchId: null,
          match: null,
          auto: false,
        },
      },
      both,
    );
    expect(screen.queryByRole('button', { name: 'Calidad' })).toBeNull();
  });
});
