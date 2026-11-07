/* Partidos de la sala en directo (directo §14): la lista de la Agenda con su
   barra de abajo («Poner en la sala»), el doble clic que pone el partido sin
   pasar por la barra y el que suena, «En la sala» y deshabilitado. Mirar
   partidos en la sala no mueve la Agenda (`uiScope="sala"`). */

import type { PartyRoom } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { resetAgendaUi, useAgendaUi } from '../agenda/state.ts';
import { matchAt, NOW, renderWithApp, scheduleOf, TODAY } from '../agenda/test-utils.tsx';
import { PartyClient, type PartyEnv } from './client.ts';
import { LiveMatches, putbarState } from './LiveMatches.tsx';
import { LIVE_TEXT } from './liveTexts.ts';

const HOST = 'm_IsmaAnfitrion';
const BASE = joined.room as PartyRoom;
const PLAYING = matchAt(-40, { home: 'Real Madrid', away: 'Girona', competition: 'LaLiga' });
/* Los dos en directo: la lista de la sala empieza en «En directo» si hay alguno. */
const OTHER = matchAt(-10, { home: 'Betis', away: 'Cádiz', competition: 'LaLiga' });
const LIVE = {
  hash: 'f'.repeat(40),
  channel: 'DAZN 1 · 1080p',
  source: 'engine' as const,
  matchId: PLAYING.id,
  match: 'Real Madrid – Girona',
  auto: true,
};
const ROOM: PartyRoom = { ...BASE, live: LIVE };

describe('putbarState', () => {
  it('lo elegido manda; si no, el que suena; con un canal suelto, nada', () => {
    expect(putbarState(OTHER, LIVE, [PLAYING, OTHER])).toMatchObject({
      match: OTHER,
      here: false,
    });
    expect(putbarState(PLAYING, LIVE, [PLAYING])).toMatchObject({ here: true });
    expect(putbarState(null, LIVE, [PLAYING])).toMatchObject({ match: PLAYING, here: true });
    /* La agenda no lo trae (otro día): el título de la sala. */
    expect(putbarState(null, LIVE, [])).toEqual({
      match: null,
      title: 'Real Madrid – Girona',
      here: true,
    });
    expect(putbarState(null, { matchId: null, match: null }, [PLAYING])).toEqual({
      match: null,
      title: null,
      here: false,
    });
  });
});

describe('LiveMatches', () => {
  let net: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    resetMode();
    setMode('live', 'bootstrap');
    resetAgendaUi();
    resetToasts();
    net = mockFetch({
      'GET /api/v1/football': scheduleOf({ [TODAY]: [PLAYING, OTHER] }),
      'GET /api/v1/preferences': fixture('preferencesGet'),
      'GET /api/v1/library': fixture('libraryGet'),
      'GET /api/v1/scores': {
        available: false,
        generatedAt: new Date(NOW).toISOString(),
        source: 'espn',
        attribution: 'ESPN',
        leagues: 0,
        scores: {},
      },
      'GET /api/v1/football/resolve': fixture('footballResolve'),
      [`POST /api/v1/party/${BASE.code}/control`]: () => json({ serverNow: 1, rev: 2 }),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    net.restore();
    resetMode();
    resetToasts();
  });

  function mount() {
    const env: PartyEnv = {
      now: () => 1_000,
      eventSource: () => new EventTarget() as unknown as EventSource,
      setInterval: () => 0,
      clearInterval: () => undefined,
    };
    const client = new PartyClient(BASE.code, { id: HOST, token: `${HOST}.secreto` }, env);
    let agendaUi: ReturnType<typeof useAgendaUi> | null = null;
    function Spy() {
      agendaUi = useAgendaUi();
      return null;
    }
    const view = renderWithApp(
      <>
        <Spy />
        <LiveMatches room={ROOM} client={client} />
      </>,
      { kind: 'wide' },
    );
    return { ...view, ui: () => agendaUi };
  }

  const putbar = () => screen.getByRole('group', { name: LIVE_TEXT.putbarLabel });
  const posts = () => net.calls.filter((call) => call.method === 'POST');

  it('sin elegir, la barra dice el que suena: «En la sala», deshabilitado', async () => {
    mount();
    const playing = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    expect(playing).toHaveAttribute('aria-current', 'true');
    const bar = putbar();
    expect(within(bar).getByText(LIVE_TEXT.putbarHere)).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: LIVE_TEXT.putbarHereButton })).toBeDisabled();
  });

  it('un toque elige el partido y «Poner en la sala» lo pone con su mejor fuente y `from`', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Betis contra Cádiz/ }));
    const bar = putbar();
    expect(within(bar).getByText('Betis vs Cádiz')).toBeInTheDocument();
    /* Elegir no pone nada. */
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(bar).getByRole('button', { name: /^Poner en la sala: Betis/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({
      action: 'live',
      from: LIVE.hash,
      live: { hash: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', matchId: OTHER.id },
    });
  });

  it('doble clic pone el partido directamente; en el que suena, nada', async () => {
    mount();
    fireEvent.doubleClick(
      await screen.findByRole('button', { name: /^Real Madrid contra Girona/ }),
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: /^Betis contra Cádiz/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.body).toMatchObject({ live: { matchId: OTHER.id } });
  });

  it('elegir en la sala no mueve la Agenda (`uiScope="sala"`)', async () => {
    const view = mount();
    const before = view.ui();
    fireEvent.click(await screen.findByRole('button', { name: /^Betis contra Cádiz/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Próximos/ }));
    expect(view.ui()).toEqual(before);
  });
});
