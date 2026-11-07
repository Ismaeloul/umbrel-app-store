/* Siguiente (Queue.tsx, docs/ver-juntos.md §11): «Proponer» arriba, el vacío
   según la regla, la regla de solo lectura para quien no manda, «Poner ya» en
   la fila para quien controla y lo recién propuesto resaltado un momento. */

import type { PartyMember, PartyRoom } from '@ace/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { PartyClient, type PartyEnv } from './client.ts';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { HIGHLIGHT_MS, NextPanel } from './Queue.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BASE = joined.room as PartyRoom;
const ana = BASE.members.find((m) => m.id === ANA) as PartyMember;

const room = (over: Partial<PartyRoom> = {}): PartyRoom => ({
  ...BASE,
  members: [...BASE.members.filter((m) => m.id !== ANA), ana],
  playback: { ...BASE.playback, lobby: false },
  ...over,
});
const withMode = (queueMode: PartyRoom['settings']['queueMode'], over: Partial<PartyRoom> = {}) =>
  room({ settings: { ...BASE.settings, queueMode }, ...over });

const ITEM = {
  id: 'q_Propuest',
  title: { ...BASE.title, title: 'Oppenheimer' },
  addedBy: ANA,
  addedByName: 'Ana',
  votes: [],
};

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  vi.useRealTimers();
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

describe('Siguiente: vacío y regla', () => {
  it('el vacío dice qué pasará según la regla; al invitado de fuera, que podrá votar', () => {
    const { rerender } = render(
      <NextPanel
        room={withMode('autoplay')}
        client={client(ANA)}
        selfId={ANA}
        onPropose={() => undefined}
      />,
    );
    expect(screen.getByText(PROPOSE_TEXT.emptyHint('autoplay'))).toBeInTheDocument();
    rerender(
      <NextPanel
        room={withMode('leader')}
        client={client(ANA)}
        selfId={ANA}
        onPropose={() => undefined}
      />,
    );
    expect(screen.getByText(PROPOSE_TEXT.emptyHint('leader'))).toBeInTheDocument();
    /* El invitado de fuera no tiene catálogo: ni «Proponer» ni la pista de proponer. */
    rerender(<NextPanel room={withMode('vote')} client={client(ANA)} selfId={ANA} />);
    expect(screen.getByText(PROPOSE_TEXT.emptyGuest)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: PROPOSE_TEXT.proposeSticky })).toBeNull();
  });

  it('quien no manda ve la regla en una línea, sin chips; quien manda, los chips', () => {
    const { rerender } = render(
      <NextPanel room={withMode('vote')} client={client(ANA)} selfId={ANA} />,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(PROPOSE_TEXT.ruleLine('vote', 'Isma'))).toBeInTheDocument();
    rerender(<NextPanel room={withMode('vote')} client={client(HOST)} selfId={HOST} />);
    expect(screen.getByRole('radiogroup', { name: JUNTOS_TEXT.ruleLabel })).toBeInTheDocument();
    expect(screen.queryByText(PROPOSE_TEXT.ruleLine('vote', 'Isma'))).toBeNull();
  });

  it('«Proponer una peli o serie» va arriba, antes que la lista', () => {
    const propose = vi.fn();
    render(
      <NextPanel
        room={withMode('vote', { queue: [ITEM] })}
        client={client(ANA)}
        selfId={ANA}
        onPropose={propose}
      />,
    );
    const button = screen.getByRole('button', { name: PROPOSE_TEXT.proposeSticky });
    const list = screen.getByRole('list');
    expect(button.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(propose).toHaveBeenCalledOnce();
  });
});

describe('Siguiente: filas', () => {
  it('quien controla tiene «Poner ya» en la fila; un invitado, no', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/queue': () => json({ ok: true }) });
    const { rerender } = render(
      <NextPanel room={withMode('vote', { queue: [ITEM] })} client={client(ANA)} selfId={ANA} />,
    );
    expect(screen.queryByRole('button', { name: /Poner ya: Oppenheimer/ })).toBeNull();
    rerender(
      <NextPanel room={withMode('vote', { queue: [ITEM] })} client={client(HOST)} selfId={HOST} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Poner ya: Oppenheimer/ }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'play', itemId: ITEM.id }),
    );
  });

  it('lo recién propuesto (`highlightId`) se resalta y deja de estarlo a los 2 s', () => {
    vi.useFakeTimers();
    render(
      <NextPanel
        room={withMode('vote', { queue: [ITEM] })}
        client={client(ANA)}
        selfId={ANA}
        highlightId={ITEM.id}
      />,
    );
    const row = within(screen.getByRole('list')).getAllByRole('listitem')[0]!;
    expect(row).toHaveAttribute('data-new', 'true');
    expect(row.textContent).toContain(PROPOSE_TEXT.justProposed);
    act(() => {
      vi.advanceTimersByTime(HIGHLIGHT_MS + 10);
    });
    expect(row).not.toHaveAttribute('data-new');
  });
});
