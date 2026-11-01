/* «Cerrar sala» (docs/ver-juntos.md §7): lo que le pasó al anfitrión es que
   el botón no hacía nada. Pedía permiso con confirm() nativo, y hay
   navegadores (los incrustados, entre ellos) que no enseñan esa ventana y la
   dan por cancelada: la sala no se cerraba. Ahora es un segundo toque
   (regla 31), y al cerrarla el anfitrión se va de la sala y este navegador
   la olvida (ni «Volver a tu sala» ni «Añadir a la sala»). Los invitados
   reciben `party.closed` y también la olvidan. */

import type { PartyRoom } from '@ace/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import {
  lastRoom,
  PartyClient,
  rememberRoom,
  saveCredential,
  savedCredential,
  type PartyEnv,
} from './client.ts';
import { Room } from './Room.tsx';
import { JUNTOS_TEXT } from './texts.ts';

/* Las opciones con las que se crea cada reproductor (el invitado pide las dos calidades, §17). */
const playerOptions = vi.hoisted(() => [] as unknown[]);
/* Lo que dice el reproductor de pega y lo que se le pide (desbloquear o quitar el silencio). */
const playerState = vi.hoisted(() => ({
  view: {
    phase: 'ready',
    error: null,
    positionS: 0,
    durationS: 0,
    bufferedS: 0,
    buffering: false,
    quality: null,
    sounded: false,
    soundBlocked: false,
    localError: false,
  } as Record<string, unknown>,
  calls: [] as string[],
}));

/* El reproductor de verdad pide el vídeo y monta hls.js: aquí no hace falta. */
vi.mock('./player.ts', () => {
  return {
    RoomPlayer: class {
      constructor(_video: unknown, _client: unknown, options: unknown) {
        playerOptions.push(options);
      }
      start(): void {}
      destroy(): void {}
      unlock(): void {
        playerState.calls.push('unlock');
      }
      unmute(): void {
        playerState.calls.push('unmute');
      }
      subscribe(): () => void {
        return () => undefined;
      }
      getView() {
        return playerState.view;
      }
    },
  };
});

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const ROOM: PartyRoom = {
  ...(joined.room as PartyRoom),
  playback: { ...(joined.room as PartyRoom).playback, lobby: false },
};
const CODE = ROOM.code;
const CLOSE_URL = `POST /api/v1/party/${CODE}/close`;
const credential = (id: string) => ({ id, token: `${id}.secreto0123456789abcdef` });

/** Un EventSource falso al que se le pueden mandar eventos. */
class FakeSource extends EventTarget {
  static last: FakeSource | null = null;
  readyState = 1;
  constructor(readonly url: string) {
    super();
    FakeSource.last = this;
  }
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const realMatchMedia = window.matchMedia;
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  playerState.view = { ...playerState.view, phase: 'ready', soundBlocked: false };
  playerState.calls = [];
  resetMode();
  setMode('live', 'bootstrap');
  FakeSource.last = null;
  vi.stubGlobal('EventSource', FakeSource);
  /* Si alguien vuelve a pedir permiso con la ventana nativa, como esos navegadores: «no». */
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false),
  );
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  window.matchMedia = realMatchMedia;
  vi.unstubAllGlobals();
});

function mountRoom(selfId: string, onLeft = vi.fn(), guest = false, room: PartyRoom = ROOM) {
  saveCredential(CODE, credential(selfId));
  rememberRoom(CODE);
  render(
    <Room
      code={CODE}
      credential={credential(selfId)}
      onForbidden={() => undefined}
      onLeft={onLeft}
      exitAction={null}
      guest={guest}
    />,
  );
  act(() => FakeSource.last?.emit('party.snapshot', { room, chat: [], serverNow: 1 }));
  return onLeft;
}

const closeCalls = () => (net?.calls ?? []).filter((c) => `${c.method} ${c.url}` === CLOSE_URL);

describe('«Cerrar sala»', () => {
  it('en escritorio (Gente): el primer toque arma, el segundo la cierra y saca de la sala', async () => {
    setViewport(1280);
    net = mockFetch({ [CLOSE_URL]: { ok: true } });
    const onLeft = mountRoom(HOST);
    fireEvent.click(screen.getByRole('tab', { name: /Gente/ }));

    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom }));
    expect(closeCalls()).toHaveLength(0);
    const armed = screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed });

    fireEvent.click(armed);
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(closeCalls()).toHaveLength(1);
    expect(closeCalls()[0]?.body).toEqual({ token: credential(HOST).token });
    expect(globalThis.confirm).not.toHaveBeenCalled();
    /* Ni «Volver a tu sala» ni la credencial de una sala que ya no existe. */
    expect(lastRoom()).toBeNull();
    expect(savedCredential(CODE)).toBeNull();
    /* Deja de escuchar la sala. */
    expect(FakeSource.last?.readyState).toBe(2);
  });

  it('en el móvil, también al final de Gente (ver-juntos.html): con el segundo toque', async () => {
    setViewport(390);
    net = mockFetch({ [CLOSE_URL]: { ok: true } });
    const onLeft = mountRoom(HOST);
    /* Arriba, quien la creó solo tiene «Invitar» (como la maqueta). */
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.closeRoom })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Gente/ }));

    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom }));
    expect(closeCalls()).toHaveLength(0);
    const armed = screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed });
    expect(armed).toHaveTextContent(JUNTOS_TEXT.closeArmedShort);
    fireEvent.click(armed);
    await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(closeCalls()).toHaveLength(1);
    expect(lastRoom()).toBeNull();
  });

  it('armado, se desarma solo a los 5 s', () => {
    vi.useFakeTimers();
    try {
      setViewport(390);
      net = mockFetch({ [CLOSE_URL]: { ok: true } });
      mountRoom(HOST);
      fireEvent.click(screen.getByRole('tab', { name: /Gente/ }));
      fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom }));
      expect(screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed })).toBeTruthy();
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom })).toBeTruthy();
      expect(screen.queryByRole('button', { name: JUNTOS_TEXT.closeArmed })).toBeNull();
      expect(closeCalls()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el servidor dice que no, se avisa y se queda en la sala (y recordada)', async () => {
    setViewport(1280);
    net = mockFetch({
      [CLOSE_URL]: () =>
        json(
          { error: { code: 'party_host_only', message: 'Solo quien la creó.', requestId: 'r1' } },
          403,
        ),
    });
    const onLeft = mountRoom(HOST);
    fireEvent.click(screen.getByRole('tab', { name: /Gente/ }));
    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom }));
    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed }));
    await waitFor(() => expect(closeCalls()).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom })).toBeEnabled(),
    );
    expect(onLeft).not.toHaveBeenCalled();
    expect(lastRoom()?.code).toBe(CODE);
  });

  it('el invitado ve que la han cerrado y su navegador la olvida', () => {
    setViewport(1280);
    net = mockFetch();
    mountRoom(ANA);
    act(() => FakeSource.last?.emit('party.closed', { reason: 'host' }));
    expect(screen.getByText(JUNTOS_TEXT.closedByHost)).toBeTruthy();
    expect(lastRoom()).toBeNull();
    expect(savedCredential(CODE)).toBeNull();
  });
});

describe('la sala en el móvil (ver-juntos.html y ver-juntos-pelis.html)', () => {
  /** La sala con algo propuesto (para «Cuando acabe» y «Pasar al siguiente»). */
  const withQueue = (): PartyRoom => ({
    ...ROOM,
    queue: [
      {
        id: 'q_abcdefgh',
        /* La lista no lleva la duración (el esquema es estricto). */
        title: {
          id: ROOM.title.id,
          kind: 'movie',
          artId: ROOM.title.artId,
          poster: null,
          title: 'Otra peli',
          subtitle: null,
        },
        addedBy: ANA,
        addedByName: 'Ana',
        votes: [ANA],
      },
    ],
  });

  it('el mismo marcado que el escritorio: título, caras y Chat, Siguiente y Gente; sin la tarjeta «Cuando acabe»', () => {
    setViewport(390);
    net = mockFetch();
    mountRoom(HOST);
    act(() =>
      FakeSource.last?.emit('party.snapshot', { room: withQueue(), chat: [], serverNow: 1 }),
    );
    expect(screen.getByRole('heading', { level: 1, name: ROOM.title.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: JUNTOS_TEXT.invite })).toBeTruthy();
    expect(document.querySelector('.juntos-faces')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      JUNTOS_TEXT.tabChat,
      expect.stringContaining(JUNTOS_TEXT.tabNext),
      JUNTOS_TEXT.tabPeople,
    ]);
    expect(document.querySelector('.juntos-nextcard')).toBeNull();
    /* Ni la cabecera vieja ni sus pestañas Lista y Ajustes. */
    expect(document.querySelector('.juntos__head')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Lista|Ajustes/ })).toBeNull();
  });

  it('Siguiente: «Pasar al siguiente» para quien controla (lo que tenía la Lista del móvil)', async () => {
    setViewport(390);
    net = mockFetch({ [`POST /api/v1/party/${CODE}/queue`]: () => json({ ok: true }) });
    mountRoom(HOST);
    act(() =>
      FakeSource.last?.emit('party.snapshot', { room: withQueue(), chat: [], serverNow: 1 }),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Siguiente/ }));
    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.skipNext }));
    /* La de la lista (el cliente también manda sus latidos de `status`). */
    await waitFor(() =>
      expect(net?.calls.filter((call) => call.url.endsWith('/queue')).at(-1)?.body).toMatchObject({
        action: 'next',
      }),
    );
  });

  it('el invitado: «Salir» arriba, sin «Invitar» ni «Pasar al siguiente»', () => {
    setViewport(390);
    net = mockFetch();
    mountRoom(ANA);
    act(() =>
      FakeSource.last?.emit('party.snapshot', { room: withQueue(), chat: [], serverNow: 1 }),
    );
    expect(screen.getByRole('button', { name: JUNTOS_TEXT.leave })).toBeTruthy();
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.invite })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Siguiente/ }));
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.skipNext })).toBeNull();
  });

  it('en escritorio no cambia: «Cuando acabe» bajo el vídeo y sin «Pasar al siguiente»', () => {
    setViewport(1280);
    net = mockFetch();
    mountRoom(HOST);
    act(() =>
      FakeSource.last?.emit('party.snapshot', { room: withQueue(), chat: [], serverNow: 1 }),
    );
    expect(document.querySelector('.juntos-nextcard')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Siguiente/ }));
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.skipNext })).toBeNull();
  });
});

describe('PartyClient.close', () => {
  function client() {
    const env: PartyEnv = {
      now: () => 1_000,
      eventSource: (url) => new FakeSource(url) as unknown as EventSource,
      setInterval: () => 0,
      clearInterval: () => undefined,
    };
    return new PartyClient(CODE, credential(HOST), env);
  }

  it('si la sala ya no existía, también cuenta como cerrada (y se olvida)', async () => {
    net = mockFetch({
      [CLOSE_URL]: () =>
        json({ error: { code: 'party_not_found', message: 'No está.', requestId: 'r1' } }, 404),
    });
    saveCredential(CODE, credential(HOST));
    rememberRoom(CODE);
    const party = client();
    party.start();
    await expect(party.close()).resolves.toBeUndefined();
    expect(lastRoom()).toBeNull();
    expect(FakeSource.last?.readyState).toBe(2);
  });

  it('cerrar no olvida otra sala que sea la última', async () => {
    net = mockFetch({ [CLOSE_URL]: { ok: true } });
    saveCredential('OTRA1234', credential(HOST));
    rememberRoom('OTRA1234');
    await client().close();
    expect(lastRoom()?.code).toBe('OTRA1234');
  });
});

describe('el reproductor de la sala y las dos calidades (§17)', () => {
  it('solo la página del invitado lo crea con `guest` (que es lo que manda abr=1)', () => {
    setViewport(1280);
    playerOptions.length = 0;
    mountRoom(ANA);
    expect(playerOptions.at(-1)).toEqual({ guest: false });
    mountRoom(ANA, vi.fn(), true);
    expect(playerOptions.at(-1)).toEqual({ guest: true });
  });
});

describe('el cartel de la sala (docs/ver-juntos.md §9)', () => {
  it('va por la ruta de la sala (`partyArt`), nunca por el catálogo', () => {
    setViewport(1280);
    mountRoom(ANA);
    const sources = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    const art = `/api/v1/party/${CODE}/art/${ROOM.title.artId}?v=${ROOM.title.poster}`;
    expect(sources).toContain(art);
    expect(sources.filter((src) => src?.includes('/vod/'))).toEqual([]);
  });
});

describe('«Esperando a todos»: el toque que deja sonar', () => {
  const LOBBY: PartyRoom = { ...ROOM, playback: { ...ROOM.playback, lobby: true, playing: false } };

  it('si el navegador no ha dejado ni empezar, lo desbloquea', () => {
    setViewport(1280);
    playerState.view = { ...playerState.view, phase: 'blocked' };
    mountRoom(ANA, vi.fn(), false, LOBBY);
    fireEvent.click(document.querySelector('.juntos-lobby') as HTMLElement);
    expect(playerState.calls).toEqual(['unlock']);
  });

  it('si lo ha empezado en silencio, quita el silencio', () => {
    setViewport(1280);
    playerState.view = { ...playerState.view, soundBlocked: true };
    mountRoom(ANA, vi.fn(), false, LOBBY);
    expect(screen.getByText('Toca aquí para que suene al empezar')).toBeTruthy();
    fireEvent.click(document.querySelector('.juntos-lobby') as HTMLElement);
    expect(playerState.calls).toEqual(['unmute']);
    /* Ya tocado: sin el aviso. */
    expect(screen.queryByText('Toca aquí para que suene al empezar')).toBeNull();
  });

  it('al bajar el dedo no hace nada (en el iPhone aún no cuenta como gesto)', () => {
    setViewport(390);
    playerState.view = { ...playerState.view, phase: 'blocked' };
    mountRoom(ANA, vi.fn(), false, LOBBY);
    fireEvent.pointerDown(document.querySelector('.juntos-lobby') as HTMLElement, {
      pointerType: 'touch',
    });
    expect(playerState.calls).toEqual([]);
  });
});

describe('la sala que no contesta', () => {
  it('a los 10 s sin la foto de la sala, «Reintentar» abre otra conexión', () => {
    vi.useFakeTimers();
    try {
      setViewport(1280);
      saveCredential(CODE, credential(ANA));
      render(
        <Room
          code={CODE}
          credential={credential(ANA)}
          onForbidden={() => undefined}
          onLeft={() => undefined}
          exitAction={null}
        />,
      );
      const first = FakeSource.last;
      expect(screen.queryByText(JUNTOS_TEXT.connectSlow)).toBeNull();
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.getByText(JUNTOS_TEXT.connectSlow)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.retry }));
      expect(FakeSource.last).not.toBe(first);
      expect(first?.readyState).toBe(2);
      expect(screen.queryByText(JUNTOS_TEXT.connectSlow)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* directo §14: lo que ve cada uno en una sala en directo. */
describe('sala en directo', () => {
  const LIVE_ROOM: PartyRoom = {
    ...ROOM,
    live: {
      hash: 'a'.repeat(40),
      channel: 'DAZN 1 · 1080p',
      source: 'engine',
      matchId: 'fltv-1',
      match: 'Real Madrid – Barcelona',
      auto: true,
    },
  };
  const withRole = (role: 'coleader' | 'guest'): PartyRoom => ({
    ...LIVE_ROOM,
    members: LIVE_ROOM.members.map((member) => (member.id === ANA ? { ...member, role } : member)),
  });

  function mountLive(selfId: string, room: PartyRoom) {
    saveCredential(CODE, credential(selfId));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Room
          code={CODE}
          credential={credential(selfId)}
          onForbidden={() => undefined}
          onLeft={() => undefined}
          exitAction={null}
        />
      </QueryClientProvider>,
    );
    act(() => FakeSource.last?.emit('party.snapshot', { room, chat: [], serverNow: 1 }));
  }

  it('al co-líder le quitan el co-liderazgo con Fuentes abierta: se ve el Chat y sus mensajes no cuentan como sin leer', () => {
    setViewport(1280);
    net = mockFetch({
      [`GET /api/v1/party/${CODE}/sources`]: () => json({ candidates: [], scan: null }),
    });
    mountLive(ANA, withRole('coleader'));
    fireEvent.click(screen.getByRole('tab', { name: JUNTOS_TEXT.tabSources }));
    act(() =>
      FakeSource.last?.emit('party.snapshot', { room: withRole('guest'), chat: [], serverNow: 2 }),
    );
    expect(screen.queryByRole('tab', { name: JUNTOS_TEXT.tabSources })).toBeNull();
    act(() =>
      FakeSource.last?.emit('party.chat', {
        message: { id: 7, at: 3, kind: 'chat', memberId: HOST, name: 'Isma', text: 'Gol' },
      }),
    );
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe(JUNTOS_TEXT.tabChat);
  });

  it('el anfitrión al que se le ha ido la corona no es «Co-líder»', () => {
    setViewport(1280);
    net = mockFetch({
      [`GET /api/v1/party/${CODE}/sources`]: () => json({ candidates: [], scan: null }),
    });
    mountLive(HOST, { ...LIVE_ROOM, leaderId: ANA });
    expect(screen.getByText('Has creado la sala · ahora manda Ana')).toBeTruthy();
    expect(screen.queryByText(/Co-líder/)).toBeNull();
  });
});
