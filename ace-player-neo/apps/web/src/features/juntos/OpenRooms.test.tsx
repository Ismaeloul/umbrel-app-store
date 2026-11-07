/* «Salas abiertas» en la portada de Ver juntos (docs/ver-juntos.md §15): las
   salas del Umbrel en dos grupos (en directo y pelis y series) con «Volver»
   (si este navegador tiene su credencial) o «Entrar», «Cerrar» para todos con
   segundo toque, sin credencial, y «Reintentar» si la lista no carga. */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { createQueryClient } from '../../api/query.ts';
import { RouterProvider } from '../../app/router.tsx';
import listFixture from '@fixtures/web/v1/partyList.json';
import { json, mockFetch } from '../../test/fetch.ts';
import { saveCredential, savedCredential } from './client.ts';
import { OpenRooms } from './OpenRooms.tsx';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';

type List = {
  rooms: { code: string; title: { title: string; kind: string; subtitle: string | null } }[];
};

let net: ReturnType<typeof mockFetch> | undefined;
const TITLE = '.juntos-open__title';

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false),
  );
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider initialSearch="?vista=juntos">
        <OpenRooms />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe('«Salas abiertas»', () => {
  it('sin salas no pinta nada', async () => {
    net = mockFetch({ 'GET /api/v1/party': { rooms: [] } });
    mount();
    await waitFor(() => expect(net?.calls.length).toBeGreaterThan(0));
    expect(screen.queryByText(JUNTOS_TEXT.openRooms)).toBeNull();
  });

  it('dos grupos: «En directo» (DIRECTO, el partido y el canal) y «Pelis y series»', async () => {
    const list = structuredClone(listFixture) as List;
    const live = list.rooms.find((room) => room.title.kind === 'live')!;
    const movie = list.rooms.find((room) => room.title.kind !== 'live')!;
    net = mockFetch({ 'GET /api/v1/party': list });
    mount();
    const liveGroup = await screen.findByRole('group', { name: PROPOSE_TEXT.openLive });
    expect(within(liveGroup).getByText(live.title.title, { selector: TITLE })).toBeInTheDocument();
    expect(within(liveGroup).getByText(live.title.subtitle!)).toBeInTheDocument();
    expect(within(liveGroup).getByText(PROPOSE_TEXT.liveBadge)).toBeInTheDocument();
    const vodGroup = screen.getByRole('group', { name: PROPOSE_TEXT.openVod });
    expect(within(vodGroup).getByText(movie.title.title, { selector: TITLE })).toBeInTheDocument();
    expect(within(vodGroup).queryByText(PROPOSE_TEXT.liveBadge)).toBeNull();
  });

  it('si la lista no carga, lo dice con «Reintentar» (no desaparece sin más)', async () => {
    let fail = true;
    net = mockFetch({
      'GET /api/v1/party': () =>
        fail
          ? json({ error: { code: 'internal', message: 'Fallo', requestId: 't' } }, 500)
          : json(structuredClone(listFixture)),
    });
    mount();
    expect(await screen.findByText(PROPOSE_TEXT.openFailed)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: PROPOSE_TEXT.retry }));
    expect(await screen.findByRole('group', { name: PROPOSE_TEXT.openLive })).toBeInTheDocument();
    expect(screen.queryByText(PROPOSE_TEXT.openFailed)).toBeNull();
  });

  it('«Volver» con credencial y «Cerrar» con segundo toque cierra la sala y la olvida', async () => {
    const list = structuredClone(listFixture) as List;
    list.rooms = list.rooms.filter((room) => room.title.kind !== 'live');
    const code = list.rooms[0]!.code;
    saveCredential(code, {
      id: 'm_IsmaAnfitrion',
      token: 'm_IsmaAnfitrion.c2VjcmV0b0RlRWplbXBsbzAx',
    });
    let open = true;
    net = mockFetch({
      'GET /api/v1/party': () => json(open ? list : { rooms: [] }),
      [`POST /api/v1/party/${code}/end`]: () => {
        open = false;
        return json({ ok: true });
      },
    });
    mount();
    expect(
      await screen.findByText(list.rooms[0]!.title.title, { selector: TITLE }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: JUNTOS_TEXT.openRoomBack })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.openRoomClose }));
    const ends = () => net!.calls.filter((call) => call.url.endsWith('/end'));
    expect(ends()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.closeArmed }));
    await waitFor(() => expect(ends()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(JUNTOS_TEXT.openRooms)).toBeNull());
    expect(savedCredential(code)).toBeNull();
    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  it('sin credencial, «Entrar»', async () => {
    net = mockFetch({ 'GET /api/v1/party': structuredClone(listFixture) });
    mount();
    /* Las dos salas (la de directo y la de pelis), sin credencial: «Entrar» en las dos. */
    expect(await screen.findAllByRole('button', { name: JUNTOS_TEXT.openRoomEnter })).toHaveLength(
      2,
    );
  });
});
