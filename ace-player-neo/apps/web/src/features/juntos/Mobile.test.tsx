/* La sala en el móvil (ver-juntos.html y ver-juntos-pelis.html): el mismo
   marcado que el escritorio (Gente, Siguiente y el chat en burbujas, que se
   prueban aquí y en Panels.test.tsx) y lo propio del móvil (Mobile.tsx): las
   caras apiladas del directo. Y en escritorio, «Cerrar sala» al final de
   Gente y la línea de quién controla sin dar por hecho el género. */

import type { PartyMember, PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { Chat } from './Chat.tsx';
import { PartyClient, type PartyEnv } from './client.ts';
import { MobileFaces } from './Mobile.tsx';
import { People } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BEA = 'm_BeaCoLider001';
const BASE = joined.room as PartyRoom;
const ana = BASE.members.find((m) => m.id === ANA) as PartyMember;
const bea: PartyMember = { ...ana, id: BEA, name: 'Bea', role: 'coleader' };
const room: PartyRoom = { ...BASE, members: [...BASE.members, bea] };

let net: ReturnType<typeof mockFetch> | undefined;
beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
});

function client(selfId: string) {
  const env: PartyEnv = {
    now: () => 1_000,
    eventSource: () => new EventTarget() as unknown as EventSource,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  return new PartyClient(
    BASE.code,
    { id: selfId, token: `${selfId}.secreto0123456789abcdef` },
    env,
  );
}

describe('«Ver juntos» en el móvil', () => {
  it('en directo, las caras apiladas (con corona y escudo) y los nombres en una línea', () => {
    render(<MobileFaces room={room} selfId={HOST} />);
    const faces = screen.getByRole('list', { name: JUNTOS_TEXT.people });
    expect(within(faces).getAllByRole('listitem')).toHaveLength(3);
    expect(faces.querySelector('.juntos-av__crown')).toBeTruthy();
    expect(faces.querySelector('.juntos-av__shield')).toBeTruthy();
    /* El lector de pantalla oye quién es cada uno; los nombres de al lado son para la vista. */
    expect(within(faces).getByText(/Isma \(tú\) · Líder/)).toBeTruthy();
    expect(document.querySelector('.juntos-stack__names')).toHaveTextContent('Isma, Ana y Bea');
  });

  it('quien está desconectado lo dice también al lector, no solo el gris', () => {
    const away: PartyRoom = {
      ...room,
      members: room.members.map((m) => (m.id === ANA ? { ...m, online: false } : m)),
    };
    render(<MobileFaces room={away} selfId={HOST} />);
    const faces = screen.getByRole('list', { name: JUNTOS_TEXT.people });
    expect(within(faces).getByText(`Ana · ${JUNTOS_TEXT.offline}`)).toBeTruthy();
    expect(within(faces).queryByText(/Isma.*desconectado/)).toBeNull();
  });

  it('con más de cinco, se apilan cinco y los nombres dicen todos', () => {
    const many: PartyRoom = {
      ...room,
      members: [
        ...room.members,
        ...['Carla', 'Dani', 'Eva'].map((name, i) => ({ ...ana, id: `m_Otra0000000${i}`, name })),
      ],
    };
    render(<MobileFaces room={many} selfId={HOST} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(document.querySelector('.juntos-stack__names')).toHaveTextContent(
      'Isma, Ana, Bea, Carla, Dani y Eva',
    );
  });
});

describe('«Ver juntos»: Gente, chat y quién controla', () => {
  it('Gente: «Echar» pide un segundo toque en la fila, sin confirm() nativo', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    try {
      net = mockFetch({ 'POST /api/v1/party/:code/member': () => json({ ok: true }) });
      render(<People room={room} client={client(HOST)} selfId={HOST} />);
      const anaRow = screen.getByText('Ana').closest('li') as HTMLElement;
      fireEvent.click(within(anaRow).getByRole('button', { name: 'Opciones de Ana' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /Echar de la sala/ }));
      expect(net?.calls).toHaveLength(0);
      const armed = within(anaRow).getByRole('button', { name: JUNTOS_TEXT.kickArmed('Ana') });
      expect(armed).toHaveTextContent(JUNTOS_TEXT.kickArmedShort);
      fireEvent.click(armed);
      await waitFor(() =>
        expect(net?.calls.at(-1)?.body).toMatchObject({ memberId: ANA, action: 'kick' }),
      );
      expect(net?.calls).toHaveLength(1);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(
        within(anaRow).queryByRole('button', { name: JUNTOS_TEXT.kickArmed('Ana') }),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('el chat en burbujas con «está escribiendo» (también en el móvil)', () => {
    render(
      <Chat
        messages={[{ id: 1, at: 0, kind: 'chat', memberId: ANA, name: 'Ana', text: 'hola' }]}
        room={room}
        selfId={HOST}
        typing={[{ memberId: BEA, name: 'Bea', until: 9e15 }]}
        onSend={async () => undefined}
      />,
    );
    expect(document.querySelector('.juntos-chat__bubble')).toBeTruthy();
    expect(screen.getByText('Bea está escribiendo…')).toBeTruthy();
  });

  it('«Cerrar sala» va al final de Gente (solo si se la pasan)', () => {
    const close = vi.fn();
    const { unmount } = render(
      <People room={room} client={client(HOST)} selfId={HOST} onCloseRoom={close} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sala' }));
    expect(close).toHaveBeenCalledOnce();
    unmount();
    render(<People room={room} client={client(ANA)} selfId={ANA} />);
    expect(screen.queryByRole('button', { name: 'Cerrar sala' })).toBeNull();
  });

  it('quién controla, sin dar por hecho el género y con los co-líderes', () => {
    expect(JUNTOS_TEXT.guestOf('Ana', 'Ana', false)).toBe('Sala de Ana · controla Ana');
    expect(JUNTOS_TEXT.guestOf('Isma', 'Isma y Bea', true)).toBe(
      'Sala de Isma · controlan Isma y Bea',
    );
    expect(JUNTOS_TEXT.youControl(true)).toBe('Tú controlas · esperando a todos');
    expect(JUNTOS_TEXT.youControl(false)).toBe('Tú controlas · todos van sincronizados');
  });
});
