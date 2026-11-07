/* El reproductor de la sala (docs/ver-juntos.md §12 y §13). Lo que le pasó a un
   invitado: iba sincronizado, pero su contador decía 0:10 con la sala en el
   minuto 10. El tiempo y la barra salen del reloj de la sala, no del vídeo. */

import type { PartyRoom } from '@ace/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { PartyClient, type PartyEnv, type PartyState } from './client.ts';
import type { PlayerQuality, PlayerView, RoomPlayer } from './player.ts';
import { CLICK_DELAY_MS, pausedBy, resetReadOnlyNotice, Theater } from './Theater.tsx';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { resetMemoryStorage, STORAGE_KEYS } from '../../lib/storage.ts';
import { readSavedVolume, saveVolume } from '../../player/volume.ts';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const NOW = 1_000_000;

function setup(
  selfId: string,
  over: Partial<PartyRoom> = {},
  quality: PlayerQuality | null = null,
  extra: Partial<PlayerView> = {},
  fullscreen = false,
  chat: PartyState['chat'] = [],
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
    soundBlocked: false,
    voted: false,
    localError: false,
    ...extra,
  };
  const setQuality = vi.fn();
  const unmute = vi.fn();
  const vote = vi.fn();
  const player = {
    subscribe: () => () => undefined,
    getView: () => view,
    setQuality,
    unmute,
    vote,
  } as unknown as RoomPlayer;
  const onFullscreen = vi.fn();
  const control = vi.spyOn(client, 'control');
  const room: PartyRoom = {
    ...(joined.room as PartyRoom),
    title: { ...(joined.room as PartyRoom).title, durationS: 6516 },
    playback: { playing: true, positionS: 600, at: NOW, rev: 3, waitingFor: [], lobby: false },
    ...over,
  };
  const state = { ...client.getState(), room, chat } as PartyState;
  /* El de la sala lo crea player.ts: aquí, uno suelto. */
  const video = document.createElement('video');
  render(
    <Theater
      player={player}
      client={client}
      room={room}
      state={state}
      video={video}
      fullscreen={fullscreen}
      onFullscreen={onFullscreen}
    />,
  );
  return { setQuality, control, video, unmute, vote, onFullscreen };
}

describe('«Ver juntos»: el reproductor', () => {
  it('«Esperando a todos» en pantalla completa: el «Estoy listo» va en el centro (la tarjeta no se ve)', () => {
    const lobby = {
      playback: { playing: false, positionS: 0, at: NOW, rev: 3, waitingFor: [], lobby: true },
    };
    const { vote } = setup(ANA, lobby, null, {}, true);
    fireEvent.click(screen.getByRole('button', { name: 'Estoy listo' }));
    expect(vote).toHaveBeenCalledTimes(1);
  });

  it('«Esperando a todos» en pantalla completa, ya votado: «Estás listo», que no vuelve a votar', () => {
    const lobby = {
      playback: { playing: false, positionS: 0, at: NOW, rev: 3, waitingFor: [], lobby: true },
    };
    const { vote } = setup(ANA, lobby, null, { voted: true }, true);
    const done = screen.getByRole('button', { name: 'Estás listo' });
    expect(done.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(done);
    expect(vote).not.toHaveBeenCalled();
  });

  it('«Esperando a todos» fuera de la pantalla completa: el centro lo deja a la tarjeta', () => {
    const lobby = {
      playback: { playing: false, positionS: 0, at: NOW, rev: 3, waitingFor: [], lobby: true },
    };
    setup(ANA, lobby);
    expect(screen.queryByRole('button', { name: 'Estoy listo' })).toBeNull();
  });

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
    expect(screen.getByText('Sala de Isma · 2 de 2')).toBeTruthy();
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
    expect(control).toHaveBeenCalledWith({ action: 'seek', positionS: 610 }, 'key');
    tabs.remove();
    group.remove();
  });

  it('una flecha que se queda pulsada es un salto, no uno por cada repetición', () => {
    const { control } = setup(HOST);
    control.mockResolvedValue(undefined);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    for (let i = 0; i < 10; i += 1) {
      fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
      fireEvent.keyDown(document.body, { key: ' ', repeat: true });
    }
    expect(control).toHaveBeenCalledTimes(1);
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
  it('el mismo que en escritorio: «Sala de Isma · 2 de 2» arriba y −10 s, pausa y +10 s en el centro', () => {
    setup(HOST);
    expect(screen.getByText('Sala de Isma · 2 de 2')).toBeTruthy();
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

/** Con el vídeo reproduciendo, los controles se esconden a los 3 s de la última actividad. */
function hideControls() {
  const chrome = document.querySelector('.juntos-chrome') as HTMLElement;
  fireEvent.pointerMove(chrome, { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(3_500));
}

describe('«Ver juntos»: el navegador lo ha empezado en silencio', () => {
  it('sin silencio forzado no hay botón', () => {
    setup(ANA);
    expect(screen.queryByRole('button', { name: 'Toca para oír' })).toBeNull();
  });

  it('«Toca para oír» sale aunque los controles se escondan y quita el silencio sin orden a la sala', () => {
    vi.useFakeTimers();
    try {
      const { unmute, control } = setup(ANA, {}, null, { soundBlocked: true });
      hideControls();
      expect(document.querySelector('.juntos-chrome')).toHaveAttribute('data-visible', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Toca para oír' }));
      expect(unmute).toHaveBeenCalledTimes(1);
      expect(control).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tapa los controles del centro hasta que se toca: quien controla no pausa sin querer', () => {
    const { unmute, control } = setup(HOST, {}, null, { soundBlocked: true });
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    const hear = screen.getByRole('button', { name: 'Toca para oír' });
    expect(hear.closest('.juntos-center')).toBeTruthy();
    fireEvent.click(hear);
    expect(unmute).toHaveBeenCalledTimes(1);
    expect(control).not.toHaveBeenCalled();
  });

  it('el primer toque sobre el vídeo también lo quita, y no hace nada más (ni con el ratón)', () => {
    vi.useFakeTimers();
    try {
      const { unmute, control } = setup(HOST, {}, null, { soundBlocked: true });
      const surface = document.querySelector('.juntos-chrome__surface') as HTMLElement;
      fireEvent.pointerDown(surface, { pointerType: 'touch' });
      fireEvent.click(surface, { detail: 1 });
      expect(unmute).toHaveBeenCalledTimes(1);
      fireEvent.pointerDown(surface, { pointerType: 'mouse' });
      fireEvent.click(surface, { detail: 1 });
      act(() => vi.advanceTimersByTime(CLICK_DELAY_MS + 50));
      expect(unmute).toHaveBeenCalledTimes(2);
      expect(control).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('«Ver juntos»: en pausa, para quien no controla', () => {
  const paused = (chat: PartyState['chat'] = []) => ({
    room: {
      playback: { playing: false, positionS: 600, at: NOW, rev: 4, waitingFor: [], lobby: false },
    },
    chat,
  });

  afterEach(() => {
    resetReadOnlyNotice();
    resetToasts();
  });

  it('«En pausa · la ha parado Isma» en el centro y «En pausa» arriba (no «Sincronizados»)', () => {
    const { room, chat } = paused([
      { id: 9, at: NOW, kind: 'system', memberId: null, name: 'Sala', text: 'Isma ha pausado.' },
    ]);
    setup(ANA, room, null, {}, false, chat);
    expect(screen.getByText('En pausa · la ha parado Isma')).toBeTruthy();
    expect(screen.queryByText('Sincronizados')).toBeNull();
    expect(document.querySelector('.juntos-chrome__top')?.textContent).toContain('En pausa');
  });

  it('sin el aviso en el chat, quien controla (si es uno); quien controla no ve la tarjeta', () => {
    const { room } = paused();
    setup(ANA, room);
    expect(screen.getByText('En pausa · la ha parado Isma')).toBeTruthy();
    cleanup();
    setup(HOST, room);
    expect(screen.queryByText(/la ha parado/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeTruthy();
  });

  it('quién la ha parado: el último «X ha pausado.» de alguien de la sala; si no, quien controla', () => {
    const room = { ...(joined.room as PartyRoom) };
    const system = (id: number, text: string) => ({
      id,
      at: NOW,
      kind: 'system' as const,
      memberId: null,
      name: 'Sala',
      text,
    });
    expect(pausedBy([system(1, 'Ana ha pausado.'), system(2, 'Isma ha pausado.')], room)).toBe(
      'Isma',
    );
    /* Un nombre que no es de la sala no vale: quien controla. */
    expect(pausedBy([system(1, 'Pepe ha pausado.')], room)).toBe('Isma');
    expect(
      pausedBy([], { ...room, settings: { ...room.settings, control: 'everyone' } }),
    ).toBeNull();
  });

  it('su primer toque en el vídeo dice, una vez por sesión, que solo Isma puede pausar', () => {
    const { control } = setup(ANA);
    const surface = document.querySelector('.juntos-chrome__surface') as HTMLElement;
    fireEvent.pointerDown(surface, { pointerType: 'touch' });
    fireEvent.click(surface, { detail: 1 });
    fireEvent.pointerDown(surface, { pointerType: 'touch' });
    fireEvent.click(surface, { detail: 1 });
    const said = toastStore
      .get()
      .filter(
        (toast) => toast.text === 'Solo Isma puede pausar o mover el vídeo. Tú puedes chatear.',
      );
    expect(said).toHaveLength(1);
    expect(control).not.toHaveBeenCalled();
  });
});

describe('«Ver juntos»: solo manda órdenes quien toca de verdad', () => {
  afterEach(() => vi.useRealTimers());

  it('con el dedo: el toque que enseña los controles no pulsa el botón que acaba de salir; el segundo, sí', () => {
    vi.useFakeTimers();
    const { control } = setup(HOST);
    control.mockResolvedValue(undefined);
    hideControls();
    const chrome = document.querySelector('.juntos-chrome') as HTMLElement;
    expect(chrome).toHaveAttribute('data-visible', 'false');
    const pause = screen.getByRole('button', { name: 'Pausar' });
    fireEvent.pointerDown(pause, { pointerType: 'touch' });
    fireEvent.pointerUp(pause, { pointerType: 'touch' });
    fireEvent.click(pause, { detail: 1 });
    expect(control).not.toHaveBeenCalled();
    expect(chrome).toHaveAttribute('data-visible', 'true');
    /* Pasado el rato de guarda, un toque con ellos a la vista sí es una orden (y su fuente). */
    act(() => vi.advanceTimersByTime(400));
    fireEvent.pointerDown(pause, { pointerType: 'touch' });
    fireEvent.pointerUp(pause, { pointerType: 'touch' });
    fireEvent.click(pause, { detail: 1 });
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledWith({ action: 'pause', positionS: 600 }, 'button');
  });

  it('con el dedo, un toque en el vídeo solo enseña o esconde los controles', () => {
    const { control } = setup(HOST);
    const surface = document.querySelector('.juntos-chrome__surface') as HTMLElement;
    const chrome = document.querySelector('.juntos-chrome') as HTMLElement;
    fireEvent.pointerDown(surface, { pointerType: 'touch' });
    fireEvent.pointerUp(surface, { pointerType: 'touch' });
    /* Con `pointerup` ya no pasa nada: hasta el clic. */
    expect(chrome).toHaveAttribute('data-visible', 'true');
    fireEvent.click(surface, { detail: 1 });
    expect(chrome).toHaveAttribute('data-visible', 'false');
    expect(control).not.toHaveBeenCalled();
  });

  it('con el ratón, un clic suelto reproduce o pausa a los 250 ms', () => {
    vi.useFakeTimers();
    const { control, onFullscreen } = setup(HOST);
    control.mockResolvedValue(undefined);
    const surface = document.querySelector('.juntos-chrome__surface') as HTMLElement;
    fireEvent.pointerDown(surface, { pointerType: 'mouse' });
    fireEvent.click(surface, { detail: 1 });
    act(() => vi.advanceTimersByTime(CLICK_DELAY_MS - 10));
    expect(control).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10));
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledWith({ action: 'pause', positionS: 600 }, 'surface');
    expect(onFullscreen).not.toHaveBeenCalled();
  });

  it('con el ratón, un doble clic pone la pantalla completa y no manda ninguna orden', () => {
    vi.useFakeTimers();
    const { control, onFullscreen } = setup(HOST);
    control.mockResolvedValue(undefined);
    const surface = document.querySelector('.juntos-chrome__surface') as HTMLElement;
    fireEvent.pointerDown(surface, { pointerType: 'mouse' });
    fireEvent.click(surface, { detail: 1 });
    fireEvent.pointerDown(surface, { pointerType: 'mouse' });
    fireEvent.click(surface, { detail: 2 });
    fireEvent.doubleClick(surface, { detail: 2 });
    act(() => vi.advanceTimersByTime(1_000));
    expect(onFullscreen).toHaveBeenCalledTimes(1);
    expect(control).not.toHaveBeenCalled();
  });

  it('los botones del centro mandan su fuente y la posición de la sala al pulsar', () => {
    const { control } = setup(HOST);
    control.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Avanzar 10 segundos' }), { detail: 1 });
    expect(control).toHaveBeenCalledWith({ action: 'seek', positionS: 610 }, 'nudge');
    /* Con el teclado (Intro sobre el botón, sin puntero) también vale. */
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }), { detail: 0 });
    expect(control).toHaveBeenLastCalledWith({ action: 'pause', positionS: 600 }, 'button');
  });
});
