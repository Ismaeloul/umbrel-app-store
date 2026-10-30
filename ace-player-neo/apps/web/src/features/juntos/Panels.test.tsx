/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11): quién controla,
   las reacciones que llegan por el SSE, la lista con sus votos y el menú del
   líder sobre cada persona. Con la sala de ejemplo de partyJoin. */

import type { PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { canControl, PartyClient, type PartyEnv } from './client.ts';
import { People, Queue } from './Panels.tsx';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BASE = joined.room as PartyRoom;

const room = (over: Partial<PartyRoom> = {}): PartyRoom => ({ ...BASE, ...over });

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

/** Un EventSource falso al que se le pueden mandar eventos. */
class FakeSource extends EventTarget {
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

function client(selfId = ANA) {
  const source = new FakeSource();
  const env: PartyEnv = {
    now: () => 1_000,
    eventSource: () => source as unknown as EventSource,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  const created = new PartyClient(
    BASE.code,
    { id: selfId, token: `${selfId}.secreto0123456789abcdef` },
    env,
  );
  return { client: created, source };
}

describe('«Ver juntos»: líder, lista y reacciones', () => {
  it('controla el líder; con «todos», cualquiera', () => {
    expect(canControl(room(), HOST)).toBe(true);
    expect(canControl(room(), ANA)).toBe(false);
    expect(
      canControl(room({ settings: { control: 'everyone', queueMode: 'autoplay' } }), ANA),
    ).toBe(true);
    expect(canControl(null, HOST)).toBe(false);
  });

  it('las reacciones del SSE se apuntan (las propias, marcadas) y se quitan al acabar de subir', () => {
    const { client: party, source } = client();
    party.start();
    source.emit('party.snapshot', { room: BASE, chat: [], serverNow: 1_000 });
    source.emit('party.reaction', { memberId: HOST, name: 'Isma', emoji: '😂' });
    source.emit('party.reaction', { memberId: ANA, name: 'Ana', emoji: '🔥' });
    const reactions = party.getState().reactions;
    expect(reactions.map((r) => [r.emoji, r.name, r.self])).toEqual([
      ['😂', 'Isma', false],
      ['🔥', 'Ana', true],
    ]);
    party.dropReaction(reactions[0]!.id);
    expect(party.getState().reactions.map((r) => r.emoji)).toEqual(['🔥']);
    party.stop();
  });

  it('la lista: votar manda el voto; «Poner ya» solo si se puede controlar', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/queue': () => json({ ok: true }) });
    const queued = room({
      queue: [
        {
          id: 'q_abcdefgh',
          title: { ...BASE.title, title: 'Otra peli' },
          addedBy: HOST,
          addedByName: 'Isma',
          votes: [HOST],
        },
      ],
    });
    const { client: party } = client();
    const { unmount } = render(<Queue room={queued} client={party} selfId={ANA} />);
    expect(screen.getByText('Otra peli')).toBeTruthy();
    expect(screen.getByText('Lo ha añadido Isma')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Poner ya' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Votar/ }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'vote', itemId: 'q_abcdefgh' }),
    );
    unmount();
    render(<Queue room={queued} client={party} selfId={HOST} />);
    expect(screen.getByRole('button', { name: 'Poner ya' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeTruthy();
  });

  it('personas: corona del líder; el líder tiene «Hacer líder» y «Echar» sobre los demás', async () => {
    const { client: party } = client(HOST);
    render(<People room={room()} client={party} selfId={HOST} />);
    const ana = screen.getByText('Ana').closest('li') as HTMLElement;
    expect(
      within(screen.getByText('Isma').closest('li') as HTMLElement).getByText('líder'),
    ).toBeTruthy();
    fireEvent.click(within(ana).getByRole('button', { name: 'Opciones de Ana' }));
    expect(await screen.findByRole('menuitem', { name: /Hacer líder/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Echar de la sala/ })).toBeTruthy();
  });

  it('personas: quien no es líder no tiene menú sobre nadie', () => {
    const { client: party } = client(ANA);
    render(<People room={room()} client={party} selfId={ANA} />);
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
  });
});
