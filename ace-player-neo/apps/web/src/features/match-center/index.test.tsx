/* La vista del centro de partido entera (teatro Palco, W5): busca el
   partido en la agenda, entra (resuelve y comprueba), pinta la cabecera, la
   cápsula del marcador y las pestañas Fuentes · Partido · Datos técnicos y,
   sin partido, un vacío con salidas. También el canal suelto y el panel
   lateral de escritorio. */

import type { LibraryView } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQueryClient, queryClient, routeKey } from '../../api/query.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { LayoutContext } from '../../app/layout.tsx';
import { RouterProvider } from '../../app/router.tsx';
import { resetToasts } from '../../notices/toasts.ts';
import { getPlayer, resetPlayerApi, setNerdOpen } from '../../player/api.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { resetScoreRevealForTests } from '../agenda/score-reveal.ts';
import { matchAt, renderWithApp, scheduleOf, TODAY } from '../agenda/test-utils.tsx';
import { endSession, getSession } from '../sources/session.ts';
import { hash, JOB, resolution, scanJob } from '../sources/test-utils.ts';
import MatchCenter, { findMatch } from './index.tsx';
import MatchAside from './MatchAside.tsx';
import { resetTheaterTabsForTests } from './TheaterTabs.tsx';

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
  resetTheaterTabsForTests();
  net = mockFetch({
    'GET /api/v1/football': scheduleOf({ [TODAY]: [match] }),
    'GET /api/v1/library': fixture('libraryGet'),
    'GET /api/v1/scores': {
      available: false,
      generatedAt: null,
      source: 'espn',
      attribution: null,
      leagues: 0,
      scores: {},
    },
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

  it('pinta la cabecera, el marcador, las fuentes y dónde se emite, y arranca la primera verificada', async () => {
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: 'mc-1', canal: null }} active />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' }),
    ).toBeInTheDocument();
    // Sin reproductor (test), la cápsula del marcador va arriba de la vista.
    expect(document.querySelector('.mc-scap-inline .mc-scap')).not.toBeNull();
    await waitFor(() => expect(getPlayer().channel?.hash).toBe(hash(1)));
    expect(getSession().key).toBe('m:mc-1');
    // Pestaña «Fuentes» por defecto: los carteles y sus acciones.
    expect(screen.getByRole('tab', { name: /^Fuentes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /Fuentes/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Fuentes del partido' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acciones de la fuente' })).toBeInTheDocument();
    // «Partido»: dónde se emite (y los carteles siguen montados: N y 1-9 funcionan).
    fireEvent.click(screen.getByRole('tab', { name: 'Partido' }));
    expect(screen.getByRole('heading', { name: 'Dónde se emite' })).toBeInTheDocument();
    expect(
      screen.getByText('M+ Liga de Campeones', { selector: '.mc-where .chip__label' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Fuentes del partido' })).toBeNull();
    expect(document.querySelectorAll('.src-poster').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'Datos técnicos' })).toBeInTheDocument();
  });

  it('la tecla S (datos técnicos) abre su pestaña y otra S vuelve a la de antes', async () => {
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: 'mc-1', canal: null }} active />);
    await screen.findByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' });
    act(() => setNerdOpen(true));
    expect(screen.getByRole('tab', { name: 'Datos técnicos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Datos técnicos' })).toBeInTheDocument();
    act(() => setNerdOpen(false));
    expect(screen.getByRole('tab', { name: /^Fuentes/ })).toHaveAttribute('aria-selected', 'true');
    // Elegir la pestaña a mano también lo apunta en el reproductor.
    fireEvent.click(screen.getByRole('tab', { name: 'Datos técnicos' }));
    expect(getPlayer().nerdOpen).toBe(true);
  });

  it('sin el partido en la agenda: vacío con salidas', async () => {
    renderWithApp(
      <MatchCenter route={{ vista: 'partido', id: 'no-existe', canal: null }} active />,
    );
    expect(await screen.findByText('Este partido ya no está en la agenda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a la agenda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pegar hash' })).toBeInTheDocument();
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/football/resolve'))).toBe(false);
  });

  it('oculta no entra al partido (sus efectos no viven)', async () => {
    renderWithApp(
      <MatchCenter route={{ vista: 'partido', id: 'mc-1', canal: null }} active={false} />,
    );
    await screen.findByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' });
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/football/resolve'))).toBe(false);
  });

  it('canal suelto: cabecera con su nombre y lo reproduce si nada suena', async () => {
    const dazn = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: null, canal: dazn }} active />);
    expect(await screen.findByRole('heading', { level: 1, name: 'DAZN 1' })).toBeInTheDocument();
    await waitFor(() => expect(getPlayer().channel?.hash).toBe(dazn));
    expect(
      screen.getByText(/En tus favoritos/, { selector: '.mc-channel__meta' }),
    ).toBeInTheDocument();
    // Un canal sin hermanas no tiene selector (ni pestaña «Fuentes»), pero sí sus acciones.
    expect(screen.queryByRole('list', { name: 'Fuentes del canal' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^Fuentes/ })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Canal' })).toHaveAttribute('aria-selected', 'true');
    const group = screen.getByRole('group', { name: 'Acciones de la fuente' });
    expect(within(group).queryByRole('button', { name: 'Rebuscar' })).toBeNull();
    expect(within(group).getByRole('button', { name: 'Reportar' })).toBeInTheDocument();
  });

  it('un canal de tu IPTV (id sintético) sin fuente: sin Content ID, «Copiar hash» ni «Abrir en…»; nunca al motor', async () => {
    const tele = 'f1'.repeat(20);
    const library = fixture<LibraryView>('libraryGet');
    const favorite = {
      ...library.favorites[0]!,
      id: tele,
      title: 'Mi tele',
      category: 'IPTV',
      ih: false,
    };
    const withTele = { ...library, favorites: [favorite], iptvIds: { [tele]: 'iptv_removed' } };
    /* La sesión lee la biblioteca de la caché de la app (la de siempre). */
    queryClient.setQueryData(routeKey('libraryGet'), withTele);
    net.restore();
    net = mockFetch({
      'GET /api/v1/football': scheduleOf({ [TODAY]: [match] }),
      'GET /api/v1/library': () => json(withTele),
      'GET /api/v1/scores': {
        available: false,
        generatedAt: null,
        source: 'espn',
        attribution: null,
        leagues: 0,
        scores: {},
      },
      'GET /api/v1/football/resolve': () =>
        json({
          ...resolution(0, { scan: null }),
          status: 'not_found',
          candidate: null,
          candidates: [],
        }),
    });
    renderWithApp(<MatchCenter route={{ vista: 'partido', id: null, canal: tele }} active />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi tele' })).toBeInTheDocument();
    const group = await screen.findByRole('group', { name: 'Acciones de la fuente' });
    expect(within(group).getByRole('button', { name: 'En favoritos' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Copiar hash' })).toBeNull();
    expect(within(group).queryByRole('button', { name: 'Abrir en…' })).toBeNull();
    expect(screen.queryByText('Content ID')).toBeNull();
    expect(screen.queryByText(tele)).toBeNull();
    expect(getPlayer().channel).toBeNull();
    queryClient.removeQueries({ queryKey: routeKey('libraryGet') });
  });

  it('con el panel lateral a la vista, las fuentes van en el panel (rack) y no en la vista', async () => {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const layout = {
      kind: 'wide' as const,
      asideVisible: true,
      asideAvailable: true,
      setAsideOpen: () => {},
      columnVisible: true,
    };
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
    // Las pestañas y los carteles (rack) en el panel; en la vista, solo la cabecera.
    expect(within(panel).getByRole('list', { name: 'Fuentes del partido' })).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Plegar el panel lateral' }),
    ).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('tab', { name: 'Datos técnicos' }));
    expect(within(panel).getByRole('heading', { name: 'Datos técnicos' })).toBeInTheDocument();
    expect(within(view).queryByRole('group', { name: 'Acciones de la fuente' })).toBeNull();
    expect(within(view).queryByRole('tablist')).toBeNull();
    expect(
      within(view).getByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' }),
    ).toBeInTheDocument();
  });
});
