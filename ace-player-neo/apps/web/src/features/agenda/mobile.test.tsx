/* La Agenda del móvil en vertical (por debajo de 768 px; maqueta
   movil-agenda-direcciones, dirección B «Por competición»). La portada de
   siempre (héroe y tarjetas) sigue en el móvil en horizontal: index.test.tsx. */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { setPlayerPresence } from '../../app/player-presence.ts';
import { installShortcutListener, shortcutStore } from '../../app/shortcuts.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import Agenda from './index.tsx';
import { resetScoreRevealForTests } from './score-reveal.ts';
import { agendaUi, resetAgendaUi } from './state.ts';
import { liveScore, matchAt, NOW, renderWithApp, scheduleOf, TODAY } from './test-utils.tsx';

const LIVE = matchAt(-60, {
  home: 'Real Madrid',
  away: 'Girona',
  competition: 'Champions League',
  channels: [{ id: 'a', name: 'M+ Liga de Campeones' }],
});
const SOON = matchAt(30, {
  home: 'Arsenal',
  away: 'Chelsea',
  competition: 'Premier League',
  channels: [{ id: 'b', name: 'DAZN 1' }],
});
const NO_CHANNEL = matchAt(90, {
  home: 'Getafe',
  away: 'Elche',
  competition: 'LaLiga',
  channels: [],
});
const DONE = matchAt(-200, { home: 'Sevilla', away: 'Athletic', competition: 'LaLiga' });
const TOMORROW = matchAt(24 * 60, { home: 'Betis', away: 'Sevilla', competition: 'LaLiga' });

let net: ReturnType<typeof mockFetch>;
let uninstall: () => void = () => {};

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/v1/football': scheduleOf({
      [TODAY]: [LIVE, SOON, NO_CHANNEL, DONE],
      '2026-09-24': [TOMORROW],
    }),
    'GET /api/v1/preferences': fixture('preferencesGet'),
    'GET /api/v1/library': fixture('libraryGet'),
    'GET /api/v1/scores': {
      available: true,
      generatedAt: new Date(NOW).toISOString(),
      source: 'espn',
      attribution: 'ESPN',
      leagues: 1,
      scores: {
        [LIVE.id]: liveScore(2, 1, "54'"),
        [DONE.id]: { home: 0, away: 3, state: 'post', clock: '', detail: 'Final', confidence: 0.9 },
      },
    },
    [`GET /api/v1/football/preheat/${LIVE.id}`]: {
      preheat: {
        matchId: LIVE.id,
        stage: 'live',
        status: 'ready',
        updatedAt: new Date(NOW).toISOString(),
        candidateCount: 6,
        checked: 6,
        playable: 3,
        total: 6,
        error: '',
      },
    },
    [`GET /api/v1/football/preheat/${SOON.id}`]: { preheat: null },
    ...overrides,
  } as Parameters<typeof mockFetch>[0];
}

const renderAgenda = () =>
  renderWithApp(<Agenda route={{ vista: 'agenda' }} active />, { kind: 'mobile' });

const rows = () => screen.getByRole('region', { name: 'Partidos' });
const row = (id: string) => document.querySelector(`.agm-row[data-match="${id}"]`) as HTMLElement;
const filters = () => screen.getByRole('group', { name: 'Filtrar partidos' });
const chip = (name: RegExp | string) => within(filters()).getByRole('button', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  history.replaceState(null, '', '/');
  resetMode();
  setMode('live', 'bootstrap');
  resetAgendaUi();
  resetToasts();
  setPlayerPresence({ active: false, route: null, immersive: false });
  resetScoreRevealForTests();
  uninstall = installShortcutListener(window);
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  uninstall();
  shortcutStore.set([]);
  resetMode();
  resetToasts();
  setPlayerPresence({ active: false, route: null, immersive: false });
  history.replaceState(null, '', '/');
});

describe('Agenda del móvil (por competición)', () => {
  it('sin héroe ni «Actualizar»: la semana, las píldoras y una tarjeta por competición con filas', async () => {
    net = mockFetch(routes());
    renderAgenda();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cargando partidos')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Champions League/ })).toBeInTheDocument();
    expect(document.querySelector('.agenda-hero')).toBeNull();
    expect(document.querySelector('.versus')).toBeNull();
    expect(screen.queryByRole('button', { name: /Actualizar agenda/ })).toBeNull();
    // La semana: «Hoy» elegido, con el recuento y lo tuyo en su nombre.
    const today = screen.getByRole('tab', { name: /^Hoy, .*: 4 partidos, 1 tuyo$/ });
    expect(today).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('.agenda-days--week')).not.toBeNull();
    // Píldoras: Todo (puesta), Para ti, Directo, las ligas y «Mis gustos».
    expect(chip(/^Todo/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^Todo/)).toHaveTextContent('Todo4');
    expect(chip(/^Para ti/)).toHaveTextContent('Para ti3');
    expect(chip('En directo: 1')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('LaLiga')).toBeInTheDocument();
    expect(chip('Editar mis gustos')).toBeInTheDocument();
    // Todo el día, por competición (directo primero, como siempre).
    expect(
      within(rows())
        .getAllByRole('heading')
        .map((heading) => heading.querySelector('.agm-comp__name')?.textContent),
    ).toEqual(['Champions League', 'LaLiga', 'Premier League']);
    expect(within(rows()).getByRole('heading', { name: /Champions League/ })).toHaveTextContent(
      '1 en directo',
    );
    expect(within(rows()).getByRole('heading', { name: /LaLiga/ })).toHaveTextContent('2 partidos');
    // Directo: el minuto en rojo con su barra; tu equipo, marcado.
    const live = row(LIVE.id);
    expect(await within(live).findByText("54'")).toBeInTheDocument();
    expect(live).toHaveClass('is-live', 'is-mine');
    expect(live.querySelector('.agm-row__bar')).not.toBeNull();
    // Con señal en directo: el play.
    await waitFor(() => expect(live.querySelector('.agm-row__play')).not.toBeNull());
    // Terminado: «Final»; próximo: la hora; sin canal, «Canal por confirmar».
    expect(within(row(DONE.id)).getByText('Final')).toBeInTheDocument();
    expect(within(row(SOON.id)).getByText(SOON.time)).toBeInTheDocument();
    expect(within(row(SOON.id)).getByText('DAZN 1')).toBeInTheDocument();
    expect(within(row(NO_CHANNEL.id)).getByText('Canal por confirmar')).toBeInTheDocument();
    expect(screen.getByText(/: 4 partidos, 1 en directo$/)).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/horario peninsular/)).toBeInTheDocument();
  });

  it('marcadores TAPADOS en las filas (un punto por equipo); el menú los destapa y los tapa', async () => {
    net = mockFetch(routes());
    const { container } = renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const live = row(LIVE.id);
    await waitFor(() => expect(live.querySelectorAll('.agm-row__score--hidden')).toHaveLength(2));
    expect(row(DONE.id).querySelectorAll('.agm-row__score--hidden')).toHaveLength(2);
    expect(container.querySelectorAll('.agm-row__score:not(.agm-row__score--hidden)')).toHaveLength(
      0,
    );
    const card = () =>
      within(rows()).getByRole('button', { name: `Buscar canal para ${LIVE.title}` });
    fireEvent.contextMenu(card());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ver marcador' }));
    await waitFor(() =>
      expect([...live.querySelectorAll('.agm-row__score')].map((cell) => cell.textContent)).toEqual(
        ['2', '1'],
      ),
    );
    expect(row(DONE.id).querySelectorAll('.agm-row__score--hidden')).toHaveLength(2);
    fireEvent.contextMenu(card());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tapar el marcador' }));
    await waitFor(() => expect(live.querySelectorAll('.agm-row__score--hidden')).toHaveLength(2));
  });

  it('tocar una fila abre la ficha del partido; sin canal, avisa y no navega', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(screen.getByRole('button', { name: /^Getafe vs Elche: canal por confirmar/ }));
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
    expect(location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: `Buscar canal para ${LIVE.title}` }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${LIVE.id}`));
    expect(document.querySelector('video')).toBeNull();
  });

  it('píldoras: «Para ti», una liga y «Directo» filtran el día; otro toque las quita', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(chip(/^Para ti/));
    await waitFor(() => expect(within(rows()).queryByText('Arsenal')).toBeNull());
    expect(within(rows()).getByText('Real Madrid')).toBeInTheDocument();
    expect(chip(/^Todo/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/, solo los tuyos$/)).toBeInTheDocument();
    // Una liga.
    fireEvent.click(chip('LaLiga'));
    await waitFor(() => expect(within(rows()).queryByText('Real Madrid')).toBeNull());
    expect(within(rows()).getByText('Getafe')).toBeInTheDocument();
    expect(agendaUi.get().chip).toBe('LaLiga');
    fireEvent.click(chip('LaLiga'));
    expect(await within(rows()).findByText('Arsenal')).toBeInTheDocument();
    // Directo: solo lo que se juega ahora.
    fireEvent.click(chip('En directo: 1'));
    await waitFor(() => expect(within(rows()).queryByText('Arsenal')).toBeNull());
    expect(within(rows()).getByText('Real Madrid')).toBeInTheDocument();
    expect(chip('En directo: 1')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip('En directo: 1'));
    expect(await within(rows()).findByText('Arsenal')).toBeInTheDocument();
  });

  it('«Terminados» o «Próximos» puestos en escritorio no filtran en el móvil', async () => {
    net = mockFetch(routes());
    act(() => agendaUi.set((state) => ({ ...state, status: 'done' })));
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    expect(within(rows()).getByText('Arsenal')).toBeInTheDocument();
    expect(within(rows()).getByText('Real Madrid')).toBeInTheDocument();
  });

  it('el partido que suena lleva las barras y su marcador tapado (regla 29)', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const live = row(LIVE.id);
    expect(live.querySelector('.player-eq')).not.toBeNull();
    expect(live.querySelector('.agm-row__play')).toBeNull();
    await waitFor(() => expect(live.querySelectorAll('.agm-row__score--hidden')).toHaveLength(2));
  });

  it('cambiar de día con la semana; un día vacío ofrece el siguiente', async () => {
    net = mockFetch(
      routes({
        'GET /api/v1/football': scheduleOf({ [TODAY]: [], '2026-09-24': [TOMORROW] }),
      }),
    );
    renderAgenda();
    expect(
      await screen.findByRole('heading', { name: 'Sin partidos anunciados' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver el día siguiente' }));
    expect(await within(rows()).findByText('Betis')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Mañana/ })).toHaveAttribute('aria-selected', 'true');
    // El rótulo de la semana es el día de la semana, no «Mañana».
    expect(
      screen.getByRole('tab', { name: /^Mañana/ }).querySelector('.agenda-day__label'),
    ).toHaveTextContent('Jue');
  });

  it('«Mis gustos» abre la hoja de gustos', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(chip('Editar mis gustos'));
    expect(
      await screen.findByRole('dialog', { name: '¿Qué fútbol te mueve?' }),
    ).toBeInTheDocument();
  });

  it('con muchas ligas, las que no caben van en «Más ligas» (una hoja)', async () => {
    const leagues = ['Serie A', 'Bundesliga', 'Ligue 1', 'Eredivisie', 'Liga Portugal', 'MLS'];
    const many = leagues.map((competition, index) =>
      matchAt(120 + index, { competition, home: `Casa ${index}`, away: `Fuera ${index}` }),
    );
    net = mockFetch(
      routes({ 'GET /api/v1/football': scheduleOf({ [TODAY]: [LIVE, SOON, ...many] }) }),
    );
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    // Ocho ligas: cinco con píldora y tres en «Más ligas».
    fireEvent.click(chip('Más ligas: 3'));
    const sheet = await screen.findByRole('dialog', { name: 'Más ligas' });
    const items = within(sheet)
      .getAllByRole('button')
      .filter((b) => b.closest('li'));
    expect(items).toHaveLength(3);
    fireEvent.click(items[0] as HTMLElement);
    const picked = agendaUi.get().chip as string;
    expect(leagues).toContain(picked);
    // La elegida pasa a la fila de píldoras, puesta.
    await waitFor(() => expect(chip(picked)).toHaveAttribute('aria-pressed', 'true'));
  });
});
