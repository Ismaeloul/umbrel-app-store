/* «Cerrar sala» (docs/ver-juntos.md §7): lo que le pasó al anfitrión es que
   el botón no hacía nada. Pedía permiso con confirm() nativo, y hay
   navegadores (los incrustados, entre ellos) que no enseñan esa ventana y la
   dan por cancelada: la sala no se cerraba. Ahora es un segundo toque
   (regla 31), y al cerrarla el anfitrión se va de la sala y este navegador
   la olvida (ni «Volver a tu sala» ni «Añadir a la sala»). Los invitados
   reciben `party.closed` y también la olvidan. */

import type { PartyRoom } from '@ace/shared';
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

/* El reproductor de verdad pide el vídeo y monta hls.js: aquí no hace falta. */
vi.mock('./player.ts', () => {
  const view = {
    phase: 'ready',
    error: null,
    positionS: 0,
    durationS: 0,
    bufferedS: 0,
    buffering: false,
  };
  return {
    RoomPlayer: class {
      start(): void {}
      destroy(): void {}
      unlock(): void {}
      subscribe(): () => void {
        return () => undefined;
      }
      getView() {
        return view;
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

function mountRoom(selfId: string, onLeft = vi.fn()) {
  saveCredential(CODE, credential(selfId));
  rememberRoom(CODE);
  render(
    <Room
      code={CODE}
      credential={credential(selfId)}
      onForbidden={() => undefined}
      onLeft={onLeft}
      exitAction={null}
    />,
  );
  act(() => FakeSource.last?.emit('party.snapshot', { room: ROOM, chat: [], serverNow: 1 }));
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

  it('en el móvil (la cabecera): igual, con el segundo toque', async () => {
    setViewport(390);
    net = mockFetch({ [CLOSE_URL]: { ok: true } });
    const onLeft = mountRoom(HOST);

    const idle = screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom });
    expect(idle).not.toHaveClass('juntos__close--armed');
    fireEvent.click(idle);
    expect(closeCalls()).toHaveLength(0);
    /* El primer toque se nota: otra clase (que enseña el texto aunque por
       debajo de 480 la cabecera vaya solo con iconos), otro icono y otro texto. */
    const armed = screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed });
    expect(armed).toHaveClass('juntos__close--armed');
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
      fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom }));
      expect(screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed })).toBeTruthy();
      act(() => vi.advanceTimersByTime(5_000));
      expect(screen.getByRole('button', { name: JUNTOS_TEXT.closeRoom })).not.toHaveClass(
        'juntos__close--armed',
      );
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
