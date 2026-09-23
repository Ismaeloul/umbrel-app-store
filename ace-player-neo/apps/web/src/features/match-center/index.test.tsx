/* La vista del centro de partido entera: busca el partido en la agenda,
   entra (resuelve y comprueba), pinta el bento y, sin partido, un vacío con
   salidas. También el canal suelto y el panel lateral de escritorio. */

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient } from '../../api/query.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { LayoutContext } from '../../app/layout.tsx';
import { RouterProvider } from '../../app/router.tsx';
import { resetToasts } from '../../notices/toasts.ts';
import { getPlayer, resetPlayerApi } from '../../player/api.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { resetScoreRevealForTests } from '../agenda/score-reveal.ts';
import { matchAt, renderWithApp, scheduleOf, TODAY } from '../agenda/test-utils.tsx';
import { endSession, getSession } from '../sources/session.ts';
import { hash, JOB, resolution, scanJob } from '../sources/test-utils.ts';
import MatchCenter, { findMatch } from './index.tsx';
import MatchAside from './MatchAside.tsx';

const match = matchAt(-30, {
  id: 'mc-1',
  home: 'Atlético de Madrid',
  away: 'Tottenham',
  competition: 'Champions League',
  channels: [{ id: 'c1', name: 'M+ Liga de Campeones' }],
});

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  setMode('live', 'bootstrap');
  realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
  resetPlayerApi();
  endSession();
  resetToasts();
  resetScoreRevealForTests();
  net = mockFetch({
    'GET /api/v1/football': scheduleOf({ [TODAY]: [match] }),
    'GET /api/v1/library': fixture('libraryGet'),
    'GET /api/v1/scores': { available: false, generatedAt: null, source: 'espn', attribution: null, leagues: 0, scores: {} },
    'GET /api/v1/football/resolve': () => json(resolution(3)),
    [`GET /api/v1/football/scans/${JOB}`]: () => json(scanJob(['working', 'checking', 'queued'])),
  });
});

afterEach(() => {
  endSession();
  net.restore();
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

describe('centro de partido', () => {
  it('encuentra el partido en la agenda', () => {
    expect(findMatch(scheduleOf({ [TODAY]: [match] }), 'mc-1')?.home).toBe('Atlético de Madrid');
    expect(findMatch(scheduleOf({ [TODAY]: [match] }), 'otro')).toBeNull();
    expect(findMatch(undefined, 'mc-1')).toBeNull();
  });

  it('pinta el marcador, dónde se emite y las fuentes, y arranca la primera verificada', async () => {
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: 'mc-1', canal: null }} active />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dónde se emite' })).toBeInTheDocument();
    expect(screen.getByText('M+ Liga de Campeones', { selector: '.mc-where .chip__label' })).toBeInTheDocument();
    await waitFor(() => expect(getPlayer().channel?.hash).toBe(hash(1)));
    expect(getSession().key).toBe('m:mc-1');
    expect(screen.getByRole('heading', { name: /Fuentes/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acciones de la fuente' })).toBeInTheDocument();
    expect(screen.getByText('Datos técnicos', { selector: '.mc-nerd__label' })).toBeInTheDocument();
  });

  it('sin el partido en la agenda: vacío con salidas', async () => {
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: 'no-existe', canal: null }} active />);
    expect(await screen.findByText('Este partido ya no está en la agenda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a la agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pegar hash' })).toBeInTheDocument();
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/football/resolve'))).toBe(false);
  });

  it('oculta no entra al partido (sus efectos no viven)', async () => {
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: 'mc-1', canal: null }} active={false} />);
    await screen.findByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' });
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/football/resolve'))).toBe(false);
  });

  it('canal suelto: cabecera con su nombre y lo reproduce si nada suena', async () => {
    const dazn = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: null, canal: dazn }} active />);
    expect(await screen.findByRole('heading', { level: 1, name: 'DAZN 1' })).toBeInTheDocument();
    await waitFor(() => expect(getPlayer().channel?.hash).toBe(dazn));
    expect(screen.getByText(/En tus favoritos/)).toBeInTheDocument();
    // Un canal sin hermanas no tiene selector, pero sí sus acciones.
    expect(screen.queryByRole('list', { name: 'Fuentes del canal' })).toBeNull();
    const group = screen.getByRole('group', { name: 'Acciones de la fuente' });
    expect(within(group).queryByRole('button', { name: 'Rebuscar' })).toBeNull();
    expect(within(group).getByRole('button', { name: 'Reportar' })).toBeInTheDocument();
  });

  it('con el panel lateral a la vista, las fuentes van en el panel (rack) y no en la vista', async () => {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const layout = { kind: 'wide' as const, asideVisible: true, asideAvailable: true, setAsideOpen: () => {}, columnVisible: true };
    const route = { vista: 'partido' as const, id: 'mc-1', canal: null };
    render(
      <QueryClientProvider client={client}>
        <RouterProvider initialSearch="?vista=partido/mc-1">
          <LayoutContext value={layout}>
            <div data-testid="vista">
              <MatchCenter route={route} active />
            </div>
            <aside data-testid="panel">
              <MatchAside route={route} active />
            </aside>
          </LayoutContext>
        </RouterProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(getPlayer().channel?.hash).toBe(hash(1)));
    const panel = screen.getByTestId('panel');
    const view = screen.getByTestId('vista');
    expect(within(panel).getByText('Mbit/s')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Plegar el panel lateral' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Datos técnicos' })).toBeInTheDocument();
    expect(within(view).queryByRole('group', { name: 'Acciones de la fuente' })).toBeNull();
  });
});
