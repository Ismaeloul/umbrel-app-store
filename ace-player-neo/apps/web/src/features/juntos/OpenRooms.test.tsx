/* «Salas abiertas» en la portada de Ver juntos (docs/ver-juntos.md §15): las
   salas del Umbrel con «Volver» (si este navegador tiene su credencial) o
   «Entrar», y «Cerrar» para todos con segundo toque, sin credencial. */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { createQueryClient } from '../../api/query.ts';
import { RouterProvider } from '../../app/router.tsx';
import listFixture from '@fixtures/web/v1/partyList.json';
import { json, mockFetch } from '../../test/fetch.ts';
import { saveCredential, savedCredential } from './client.ts';
import { OpenRooms } from './OpenRooms.tsx';
import { JUNTOS_TEXT } from './texts.ts';

type List = { rooms: { code: string; title: { title: string } }[] };

let net: ReturnType<typeof mockFetch> | undefined;

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

  it('«Volver» con credencial y «Cerrar» con segundo toque cierra la sala y la olvida', async () => {
    const list = structuredClone(listFixture) as List;
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
    expect(await screen.findByText(list.rooms[0]!.title.title)).toBeInTheDocument();
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
    expect(
      await screen.findByRole('button', { name: JUNTOS_TEXT.openRoomEnter }),
    ).toBeInTheDocument();
  });
});
