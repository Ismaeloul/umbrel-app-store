import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { setPlayerPresence } from '../../app/player-presence.ts';
import { installShortcutListener, shortcutStore } from '../../app/shortcuts.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import Agenda from './index.tsx';
import { resetScoreRevealForTests } from './score-reveal.ts';
import { resetAgendaUi } from './state.ts';
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
const TOMORROW = matchAt(24 * 60, { home: 'Betis', away: 'Sevilla', competition: 'LaLiga' });

let net: ReturnType<typeof mockFetch>;
let uninstall: () => void = () => {};

function routes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/v1/football': scheduleOf({
      [TODAY]: [LIVE, SOON, NO_CHANNEL],
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
      scores: { [LIVE.id]: liveScore(2, 1, "54'") },
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

function renderAgenda(kind: 'mobile' | 'desktop' = 'mobile') {
  return renderWithApp(<Agenda route={{ vista: 'agenda' }} active />, { kind });
}

/** Las filas de partidos (sin el héroe, que repite el destacado). */
const rows = () => screen.getByRole('region', { name: 'Partidos' });
const findInRows = async (text: string) => {
  await waitFor(() => expect(within(rows()).getByText(text)).toBeInTheDocument());
  return within(rows()).getByText(text);
};

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

describe('vista Agenda', () => {
  it('cabecera, días, «Para ti» por defecto con gustos, bloques por competición y pie', async () => {
    net = mockFetch(routes());
    renderAgenda();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    // Cargando: esqueleto con su nombre y el pie de la 0.6.59.
    expect(screen.getByLabelText('Cargando partidos')).toBeInTheDocument();
    expect(screen.getByText('Consultando horarios y canales…')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: /Champions League/ })).toBeInTheDocument();
    // «Para ti»: Champions (liga) y LaLiga (liga); la Premier no.
    expect(screen.getByRole('radio', { name: /Para ti/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: /LaLiga/ })).toBeInTheDocument();
    expect(screen.queryByText('Arsenal')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Hoy, .*: 2 partidos$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Directo con su minuto en el chip y la señal del precalentado en la cápsula.
    const live = document.querySelector(`[data-match="${LIVE.id}"]`) as HTMLElement;
    expect(await within(live).findByText("En directo · 54'")).toBeInTheDocument();
    expect(await within(live).findByText('Señal')).toBeInTheDocument();
    expect(document.querySelector('.agenda-live-sum')?.textContent).toBe('1 en directo');
    // Resumen para lectores de pantalla (regla 36): una frase, no la lista entera.
    expect(screen.getByText(/: 2 partidos, 1 en directo, solo los tuyos$/)).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(within(live).getByText('Tu equipo')).toBeInTheDocument();
    expect(screen.getByText('futbolenlatv.com', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/horario peninsular/)).toBeInTheDocument();
  });

  it('portada: héroe con el destacado, sin marcador en la tarjeta; el botón navega y nunca reproduce', async () => {
    net = mockFetch(routes());
    renderAgenda();
    // El destacado es tu equipo en directo (Real Madrid, en tus gustos).
    const hero = await screen.findByRole('region', { name: 'Real Madrid vs Girona' });
    expect(hero).toHaveClass('agenda-hero', 'is-live');
    expect(await within(hero).findByText("En directo · 54'")).toBeInTheDocument();
    expect(within(hero).getByText('Champions League')).toBeInTheDocument();
    expect(await within(hero).findByText('Señal')).toBeInTheDocument();
    // El marcador solo en su cápsula, fuera de la tarjeta versus.
    expect(hero.querySelector('.versus .agenda-score')).toBeNull();
    await waitFor(() => expect(within(hero).getByTitle('Marcador')).toHaveTextContent(/2.*1/));
    // El canal no está en tu biblioteca: «Buscar canal», que abre el partido.
    fireEvent.click(within(hero).getByRole('button', { name: 'Buscar canal' }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${LIVE.id}`));
    expect(document.querySelector('video')).toBeNull();
  });

  it('pie: la frescura de la agenda (última copia, parcial o limitada) y la atribución (B-146)', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ stale: true }, 'Última copia disponible'],
      [{ partial: true }, 'Cobertura parcial'],
      [{ limited: true }, 'Cobertura gratuita limitada'],
    ];
    for (const [extra, text] of cases) {
      net?.restore();
      net = mockFetch(
        routes({
          'GET /api/v1/football': scheduleOf({ [TODAY]: [LIVE, SOON] }, extra),
        }),
      );
      const view = renderAgenda();
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(screen.getByText('Datos: futbolenlatv.com')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('«Todos» enseña todo; «Ver canal» si está en tu biblioteca y «Buscar canal» si no', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    expect(await screen.findByText('Arsenal')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Ver canal para ${SOON.title}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Buscar canal para ${LIVE.title}` }),
    ).toBeInTheDocument();
    expect(screen.getByText('Canal por confirmar')).toBeInTheDocument();
  });

  it('tocar un partido abre el centro de partido; sin canal, avisa y no navega (§5.1)', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(screen.getByRole('button', { name: /^Getafe vs Elche: canal por confirmar/ }));
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
    expect(location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: `Buscar canal para ${LIVE.title}` }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${LIVE.id}`));
  });

  it('cambiar de día con la tira y con las flechas del teclado', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    fireEvent.click(screen.getByRole('tab', { name: /^Mañana/ }));
    expect(await findInRows('Betis')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
    });
    expect(await findInRows('Real Madrid')).toBeInTheDocument();
    expect(screen.queryByText('Betis')).toBeNull();
  });

  it('en el móvil, deslizar la lista a los lados cambia de día (y no abre la franja)', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const panel = screen.getByRole('tabpanel');
    fireEvent.pointerDown(panel, {
      pointerId: 1,
      clientX: 300,
      clientY: 400,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(panel, {
      pointerId: 1,
      clientX: 240,
      clientY: 402,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(panel, { pointerId: 1, clientX: 180, clientY: 404, pointerType: 'touch' });
    expect(await findInRows('Betis')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Mañana/ })).toHaveAttribute('aria-selected', 'true');
    // El clic que sigue al gesto no abre nada.
    fireEvent.click(screen.getByRole('button', { name: /Betis vs Sevilla/ }));
    expect(location.search).toBe('');
    fireEvent.pointerDown(panel, {
      pointerId: 2,
      clientX: 100,
      clientY: 400,
      pointerType: 'touch',
    });
    fireEvent.pointerUp(panel, { pointerId: 2, clientX: 220, clientY: 404, pointerType: 'touch' });
    expect(await findInRows('Real Madrid')).toBeInTheDocument();
  });

  it('el marcador del partido que ves sale tapado hasta que lo pides', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    const { container } = renderAgenda();
    const reveal = await screen.findByRole('button', { name: 'Ver marcador' });
    const row = container.querySelector(`[data-match="${LIVE.id}"]`) as HTMLElement;
    expect(within(row).queryByText('2')).toBeNull();
    // El héroe es el partido que suena: «En pantalla», «Volver al vídeo» y «Marcador».
    const hero = screen.getByRole('region', { name: 'Real Madrid vs Girona' });
    expect(within(hero).getByText('En pantalla')).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: 'Volver al vídeo' })).toBeInTheDocument();
    expect(within(hero).queryByTitle('Marcador')).toBeNull();
    expect(within(hero).getByRole('button', { name: 'Marcador' })).toBeInTheDocument();
    fireEvent.click(reveal);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ver marcador' })).toBeNull());
    expect(row.querySelector('.agenda-score')?.textContent).toContain('2');
    // Destapar en un sitio destapa en todos: el héroe enseña ya las cifras.
    expect(within(hero).queryByRole('button', { name: 'Marcador' })).toBeNull();
    expect(within(hero).getByTitle('Marcador')).toHaveTextContent(/2.*1/);
    // Detener vuelve a tapar para la próxima vez.
    act(() => setPlayerPresence({ active: false }));
    act(() => setPlayerPresence({ active: true }));
    expect(await screen.findByRole('button', { name: 'Ver marcador' })).toBeInTheDocument();
  });

  it('sin partidos tuyos: «Nada de los tuyos este día» con sus dos salidas', async () => {
    net = mockFetch(
      routes({
        'GET /api/v1/preferences': {
          preferences: {
            onboardingComplete: true,
            country: 'Spain',
            leagues: [],
            teams: ['Inter'],
            nationalities: [],
          },
        },
      }),
    );
    renderAgenda();
    const heading = await screen.findByRole('heading', { name: 'Nada de los tuyos este día' });
    const empty = heading.closest('section') as HTMLElement;
    expect(within(empty).getByRole('button', { name: 'Editar mis gustos' })).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole('button', { name: 'Ver todos' }));
    expect(await screen.findByText('Arsenal')).toBeInTheDocument();
  });

  it('día sin partidos: «Sin partidos anunciados» y salida al día siguiente', async () => {
    net = mockFetch(
      routes({
        'GET /api/v1/football': scheduleOf({ [TODAY]: [], '2026-09-24': [TOMORROW] }),
        'GET /api/v1/preferences': {
          preferences: {
            onboardingComplete: true,
            country: 'Spain',
            leagues: [],
            teams: [],
            nationalities: [],
          },
        },
      }),
    );
    renderAgenda();
    expect(
      await screen.findByRole('heading', { name: 'Sin partidos anunciados' }),
    ).toBeInTheDocument();
    // Sin gustos, «Para ti» está deshabilitado y se fuerza «Todos».
    expect(screen.getByRole('radio', { name: /Para ti/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver el día siguiente' }));
    expect(await findInRows('Betis')).toBeInTheDocument();
  });

  it('si la agenda falla: error con «Reintentar» y la biblioteca sigue a mano', async () => {
    let calls = 0;
    net = mockFetch(
      routes({
        'GET /api/v1/football': () => {
          calls += 1;
          return calls === 1
            ? json({ error: { code: 'football_unavailable', message: 'x', requestId: 'r' } }, 503)
            : json(scheduleOf({ [TODAY]: [LIVE] }));
        },
      }),
    );
    renderAgenda();
    expect(
      await screen.findByRole('heading', { name: 'No pudimos cargar la agenda' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Los canales y el reproductor siguen disponibles.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a los canales' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await findInRows('Real Madrid')).toBeInTheDocument();
  });

  it('tarjeta de primer uso: «Ahora no» guarda onboardingComplete sin tocar tus gustos', async () => {
    const saved = {
      onboardingComplete: false,
      country: 'Spain',
      leagues: ['LaLiga'],
      teams: [],
      nationalities: [],
    };
    net = mockFetch(
      routes({
        'GET /api/v1/preferences': { preferences: saved },
        'PUT /api/v1/preferences': (call: { body: unknown }) => json({ preferences: call.body }),
      }),
    );
    renderAgenda();
    expect(
      await screen.findByRole('heading', { name: 'Personaliza tu agenda' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    await waitFor(() => expect(net.calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(net.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      ...saved,
      onboardingComplete: true,
    });
    expect(screen.queryByRole('heading', { name: 'Personaliza tu agenda' })).toBeNull();
    await waitFor(() =>
      expect(toastStore.get().map((t) => t.text)).toContain('Tu agenda ya está personalizada'),
    );
  });

  it('«Personalizar» abre la hoja de gustos', async () => {
    net = mockFetch(
      routes({
        'GET /api/v1/preferences': {
          preferences: {
            onboardingComplete: false,
            country: 'Spain',
            leagues: [],
            teams: [],
            nationalities: [],
          },
        },
      }),
    );
    renderAgenda();
    fireEvent.click(await screen.findByRole('button', { name: 'Personalizar' }));
    expect(
      await screen.findByRole('dialog', { name: '¿Qué fútbol te mueve?' }),
    ).toBeInTheDocument();
  });

  it('marcadores: solo se piden si el día tiene partidos en su ventana', async () => {
    const later = matchAt(5 * 60, { competition: 'LaLiga' });
    net = mockFetch(routes({ 'GET /api/v1/football': scheduleOf({ [TODAY]: [later] }) }));
    renderAgenda();
    await screen.findByRole('heading', { name: /LaLiga/ });
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/scores'))).toBe(false);
  });

  it('escritorio: escenario con el directo destacado, «Luego» y un clic elige', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    const stage = await screen.findByRole('complementary', { name: 'Partido elegido' });
    expect(
      await within(stage).findByRole('heading', { name: LIVE.title.replace(' - ', ' vs ') }),
    ).toBeInTheDocument();
    expect(
      within(stage).getByRole('button', { name: `Buscar canal para ${LIVE.title}` }),
    ).toBeInTheDocument();
    expect(within(stage).getByRole('heading', { name: 'Luego' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    const list = screen.getByRole('region', { name: 'Partidos' });
    fireEvent.click(await within(list).findByRole('button', { name: /^Arsenal vs Chelsea/ }));
    expect(
      await within(stage).findByRole('heading', { name: 'Arsenal vs Chelsea' }),
    ).toBeInTheDocument();
    expect(
      within(stage).getByRole('button', { name: `Ver canal para ${SOON.title}` }),
    ).toBeInTheDocument();
  });
});
