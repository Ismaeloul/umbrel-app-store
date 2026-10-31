/* La sala en el móvil (docs/ver-juntos.md §13): se ve como siempre (Lista,
   Ajustes, el chat en lista), pero con lo que cambia el funcionamiento: los
   co-líderes y «Quién controla» con tres opciones. Y en escritorio, «Cerrar
   sala» al final de Gente y la línea de quién controla sin dar por hecho el
   género. */

import type { PartyChatMessage, PartyMember, PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { Chat } from './Chat.tsx';
import { PartyClient, type PartyEnv } from './client.ts';
import { MobilePeople, MobileSettings } from './Mobile.tsx';
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
  it('Gente (móvil): «Echar» pide un segundo toque en la fila, sin confirm() nativo', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    try {
      net = mockFetch({ 'POST /api/v1/party/:code/member': () => json({ ok: true }) });
      render(<MobilePeople room={room} client={client(HOST)} selfId={HOST} />);
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

  it('Ajustes: «Quién controla» con las tres opciones manda los dos campos compatibles', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/settings': () => json({ ok: true }) });
    render(<MobileSettings room={room} client={client(HOST)} />);
    expect(screen.getByRole('radio', { name: 'Yo y co-líderes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Solo yo' }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ control: 'leader', coleaders: false }),
    );
    expect(screen.getByRole('radio', { name: 'Votar lo siguiente' })).toBeTruthy();
  });

  it('Gente: el líder hace co-líder; el co-líder lleva su escudo y no tiene menú', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/member': () => json({ ok: true }) });
    const { unmount } = render(<MobilePeople room={room} client={client(HOST)} selfId={HOST} />);
    const anaRow = screen.getByText('Ana').closest('li') as HTMLElement;
    fireEvent.click(within(anaRow).getByRole('button', { name: 'Opciones de Ana' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Hacer co-líder/ }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ memberId: ANA, action: 'coleader' }),
    );
    expect(
      within(screen.getByText('Bea').closest('li') as HTMLElement).getByText('Co-líder'),
    ).toBeTruthy();
    unmount();
    render(<MobilePeople room={room} client={client(BEA)} selfId={BEA} />);
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
  });

  it('el chat de siempre: nombre y hora, sin burbujas ni «está escribiendo»', () => {
    const messages: PartyChatMessage[] = [
      { id: 1, at: 0, kind: 'chat', memberId: ANA, name: 'Ana', text: 'hola' },
    ];
    render(
      <Chat
        messages={messages}
        room={room}
        selfId={HOST}
        typing={[{ memberId: BEA, name: 'Bea', until: 9e15 }]}
        onSend={async () => undefined}
      />,
    );
    expect(document.querySelector('.juntos-chat__time')).toBeTruthy();
    expect(document.querySelector('.juntos-chat__bubble')).toBeNull();
    expect(screen.queryByText(/está escribiendo/)).toBeNull();
    expect(screen.getByPlaceholderText(JUNTOS_TEXT.chatPlaceholderMobile)).toBeTruthy();
  });
});

describe('«Ver juntos» en escritorio', () => {
  it('Gente (escritorio): «Echar» pide un segundo toque en la fila, sin confirm() nativo', async () => {
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

  it('el chat en burbujas con «está escribiendo»', () => {
    render(
      <Chat
        messages={[{ id: 1, at: 0, kind: 'chat', memberId: ANA, name: 'Ana', text: 'hola' }]}
        room={room}
        selfId={HOST}
        desk
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
