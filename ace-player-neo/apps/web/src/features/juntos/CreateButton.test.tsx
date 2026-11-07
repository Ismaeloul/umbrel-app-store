/* «Ver juntos» en la ficha (CreateButton.tsx): con una última sala recordada, «Proponer en la
   sala» solo sale cuando la vista previa confirma que es de pelis y series. Mientras no
   responde, tampoco: en una de directo, proponer daría un error (allí no hay lista). */

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { createQueryClient } from '../../api/query.ts';
import { RouterProvider } from '../../app/router.tsx';
import previewFixture from '@fixtures/web/v1/partyPreview.json';
import { json, mockFetch } from '../../test/fetch.ts';
import { rememberRoom, saveCredential } from './client.ts';
import { JuntosButton, type JuntosTarget } from './CreateButton.tsx';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';

const CODE = previewFixture.code;
const TARGET: JuntosTarget = {
  titleId: '0123456789abcdef0123456789abcdef01234567',
  kind: 'movie',
  artId: '0123456789abcdef0123456789abcdef01234567',
  poster: null,
  title: 'Oppenheimer',
  subtitle: null,
};

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  saveCredential(CODE, {
    id: 'm_AnaInvitada01',
    token: 'm_AnaInvitada01.c2VjcmV0b0RlRWplbXBsbzAx',
  });
  rememberRoom(CODE);
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  localStorage.clear();
});

function mountAndOpen() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider initialSearch="?vista=cine">
        <JuntosButton target={TARGET} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: JUNTOS_TEXT.open }));
}

describe('«Proponer en la sala» desde la ficha', () => {
  it('no sale hasta que la vista previa dice de qué es la sala', async () => {
    let answer: (response: Response) => void = () => undefined;
    net = mockFetch({
      [`GET /api/v1/party/${CODE}`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    mountAndOpen();
    await waitFor(() => expect(net?.calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.addToRoom })).toBeNull();
    answer(json(previewFixture));
    expect(await screen.findByRole('button', { name: JUNTOS_TEXT.addToRoom })).toBeInTheDocument();
  });

  it('en una sala de directo no se ofrece: sale el aviso', async () => {
    const preview = structuredClone(previewFixture);
    preview.title = { ...preview.title, kind: 'live', durationS: null as unknown as number };
    net = mockFetch({ [`GET /api/v1/party/${CODE}`]: preview });
    mountAndOpen();
    expect(await screen.findByText(PROPOSE_TEXT.liveRoomNoPropose)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JUNTOS_TEXT.addToRoom })).toBeNull();
  });
});
