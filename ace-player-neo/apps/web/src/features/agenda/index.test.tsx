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

function renderAgenda(kind: 'mobile' | 'desktop' | 'wide' = 'mobile') {
  return renderWithApp(<Agenda route={{ vista: 'agenda' }} active />, { kind });
}

/** Cifras de marcador pintadas en TODA la agenda (ninguna mientras esté tapado). */
const scoreDigits = () => document.querySelectorAll('.agenda-score .num, .agenda-strip__score');

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
    // En el móvil, la tarjeta versus XL de siempre.
    expect(hero).not.toHaveClass('agenda-hero--band');
    expect(hero.querySelector('.versus--xl')).not.toBeNull();
    expect(await within(hero).findByText("En directo · 54'")).toBeInTheDocument();
    expect(within(hero).getByText('Champions League')).toBeInTheDocument();
    expect(await within(hero).findByText('Señal')).toBeInTheDocument();
    // El marcador, tapado en su cápsula, fuera de la tarjeta versus.
    expect(hero.querySelector('.versus .agenda-score')).toBeNull();
    expect(
      await within(hero).findByRole('button', { name: 'Ver marcador de Real Madrid vs Girona' }),
    ).toHaveTextContent('Marcador');
    expect(scoreDigits()).toHaveLength(0);
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

  it('en el móvil, deslizar la lista a los lados cambia de día, también sobre una tarjeta (y no la abre)', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const panel = screen.getByRole('tabpanel');
    expect(panel.style.touchAction).toBe('pan-y');
    /* Sobre la tarjeta (dentro de su fila, que en jsdom no desborda: en el
       navegador, una fila que cabe entera o que ya está en su final tampoco
       se queda el gesto). Dedo a la izquierda = día siguiente. */
    const card = within(rows()).getByRole('button', { name: `Buscar canal para ${LIVE.title}` });
    const swipe = (target: Element, from: number, to: number, id: number) => {
      const start = { identifier: id, target, clientX: from, clientY: 400 };
      fireEvent.touchStart(target, { touches: [start], changedTouches: [start] });
      const mid = { identifier: id, target, clientX: (from + to) / 2, clientY: 403 };
      fireEvent.touchMove(target, { touches: [mid], changedTouches: [mid] });
      const end = { identifier: id, target, clientX: to, clientY: 405 };
      fireEvent.touchMove(target, { touches: [end], changedTouches: [end] });
      fireEvent.touchEnd(target, { touches: [], changedTouches: [end] });
    };
    swipe(card, 300, 180, 1);
    expect(await findInRows('Betis')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Mañana/ })).toHaveAttribute('aria-selected', 'true');
    // El clic que sigue al gesto no abre nada.
    fireEvent.click(screen.getByRole('button', { name: /Betis vs Sevilla/ }));
    expect(location.search).toBe('');
    // Sobre el título de la competición, dedo a la derecha = día anterior.
    swipe(screen.getByRole('heading', { name: /LaLiga/ }), 100, 230, 2);
    expect(await findInRows('Real Madrid')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Hoy/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('en el móvil, el scroll vertical sobre la lista nunca cambia de día', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const card = within(rows()).getByRole('button', { name: `Buscar canal para ${LIVE.title}` });
    const start = { identifier: 1, target: card, clientX: 200, clientY: 600 };
    fireEvent.touchStart(card, { touches: [start], changedTouches: [start] });
    for (const [x, y] of [
      [203, 580],
      [150, 520],
      [90, 470],
    ] as const) {
      const point = { identifier: 1, target: card, clientX: x, clientY: y };
      fireEvent.touchMove(card, { touches: [point], changedTouches: [point] });
    }
    const end = { identifier: 1, target: card, clientX: 90, clientY: 470 };
    fireEvent.touchEnd(card, { touches: [], changedTouches: [end] });
    expect(screen.getByRole('tab', { name: /^Hoy/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel').style.transform).toBe('');
  });

  it('marcadores TAPADOS por defecto en toda la agenda; «Marcador» destapa ese partido y otro toque lo tapa', async () => {
    net = mockFetch(routes());
    const { container } = renderAgenda();
    const hero = await screen.findByRole('region', { name: 'Real Madrid vs Girona' });
    const name = 'Ver marcador de Real Madrid vs Girona';
    // Una cápsula en el héroe y otra en su tarjeta de la fila; ninguna cifra.
    await waitFor(() => expect(screen.getAllByRole('button', { name })).toHaveLength(2));
    expect(scoreDigits()).toHaveLength(0);
    expect(container.textContent).not.toMatch(/2\s*[–-]\s*1/);
    // Ni el resumen para lectores ni el botón de la tarjeta dicen el resultado.
    expect(screen.getByText(/: 2 partidos, 1 en directo, solo los tuyos$/)).toBeInTheDocument();
    expect(
      within(rows()).getByRole('button', { name: `Buscar canal para ${LIVE.title}` }),
    ).toBeInTheDocument();
    fireEvent.click(within(hero).getByRole('button', { name }));
    // Destapado ese partido (en todos sus sitios): las cifras en la misma cápsula.
    const hide = 'Tapar el marcador de Real Madrid vs Girona: 2 a 1';
    await waitFor(() => expect(screen.getAllByRole('button', { name: hide })).toHaveLength(2));
    expect(within(hero).getByRole('button', { name: hide })).toHaveTextContent(/2.*1/);
    const row = container.querySelector(`[data-match="${LIVE.id}"]`) as HTMLElement;
    expect(row.querySelector('.agenda-score')?.textContent).toMatch(/2.*1/);
    // Otro toque lo vuelve a tapar.
    fireEvent.click(within(row).getByRole('button', { name: hide }));
    await waitFor(() => expect(scoreDigits()).toHaveLength(0));
    expect(screen.getAllByRole('button', { name })).toHaveLength(2);
  });

  it('menú contextual: «Ver marcador» destapa y «Tapar el marcador» lo tapa', async () => {
    net = mockFetch(routes());
    const { container } = renderAgenda();
    await screen.findByRole('region', { name: 'Real Madrid vs Girona' });
    const card = () =>
      within(rows()).getByRole('button', { name: `Buscar canal para ${LIVE.title}` });
    fireEvent.contextMenu(card());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ver marcador' }));
    const row = container.querySelector(`[data-match="${LIVE.id}"]`) as HTMLElement;
    await waitFor(() => expect(row.querySelector('.agenda-score')?.textContent).toMatch(/2.*1/));
    fireEvent.contextMenu(card());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tapar el marcador' }));
    await waitFor(() => expect(scoreDigits()).toHaveLength(0));
  });

  it('el partido que ves: «En pantalla» y «Volver al vídeo»; detener vuelve a tapar lo destapado (regla 29)', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    renderAgenda();
    const hero = await screen.findByRole('region', { name: 'Real Madrid vs Girona' });
    expect(within(hero).getByText('En pantalla')).toBeInTheDocument();
    expect(within(hero).getByRole('button', { name: 'Volver al vídeo' })).toBeInTheDocument();
    const name = 'Ver marcador de Real Madrid vs Girona';
    fireEvent.click(await within(hero).findByRole('button', { name }));
    await waitFor(() => expect(scoreDigits().length).toBeGreaterThan(0));
    // Detener vuelve a tapar para la próxima vez.
    act(() => setPlayerPresence({ active: false }));
    act(() => setPlayerPresence({ active: true }));
    expect(await within(hero).findByRole('button', { name })).toBeInTheDocument();
    expect(scoreDigits()).toHaveLength(0);
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

  it('escritorio: sin héroe; el panel enseña el destacado y un clic en otra tarjeta la lleva allí', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    // Toda la página es el calendario: ni héroe ni su esqueleto.
    const side = await screen.findByRole('complementary', { name: 'Partido elegido' });
    expect(document.querySelector('.agenda-hero')).toBeNull();
    expect(document.querySelector('.agenda')).not.toHaveClass('has-hero');
    expect(screen.queryByRole('region', { name: 'Real Madrid vs Girona' })).toBeNull();
    // El elegido de entrada es el destacado (tu equipo en directo), con su canal.
    expect(
      await within(side).findByRole('heading', { name: 'Real Madrid vs Girona' }),
    ).toBeInTheDocument();
    expect(within(side).getByText('M+ Liga de Campeones')).toBeInTheDocument();
    expect(
      within(side).getByRole('button', { name: `Buscar canal para ${LIVE.title}` }),
    ).toBeInTheDocument();
    // Y su tarjeta de la lista va marcada como elegida.
    expect(within(rows()).getByRole('button', { name: /^Real Madrid vs Girona/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: /Todos/ }));
    // Con otro filtro la lista se vuelve a montar: se busca otra vez.
    const list = rows();
    fireEvent.click(await within(list).findByRole('button', { name: /^Arsenal vs Chelsea/ }));
    expect(
      await within(side).findByRole('heading', { name: 'Arsenal vs Chelsea' }),
    ).toBeInTheDocument();
    expect(
      within(side).getByRole('button', { name: `Ver canal para ${SOON.title}` }),
    ).toBeInTheDocument();
    // Volver a elegir el destacado lo vuelve a enseñar (antes el panel desaparecía).
    fireEvent.click(within(list).getByRole('button', { name: /^Real Madrid vs Girona/ }));
    expect(
      await within(side).findByRole('heading', { name: 'Real Madrid vs Girona' }),
    ).toBeInTheDocument();
  });

  it('el partido de TUS EQUIPOS (no el de tus ligas) lleva el aura en la lista y en «Luego»', async () => {
    const mineLater = matchAt(45, {
      home: 'Real Madrid',
      away: 'Valencia',
      competition: 'LaLiga',
      channels: [{ id: 'd', name: 'DAZN LaLiga' }],
    });
    const leagueOnly = matchAt(15, {
      home: 'Betis',
      away: 'Osasuna',
      competition: 'LaLiga',
      channels: [{ id: 'e', name: 'M+ LaLiga' }],
    });
    net = mockFetch(
      routes({
        'GET /api/v1/football': scheduleOf({ [TODAY]: [LIVE, leagueOnly, mineLater, SOON] }),
      }),
    );
    renderAgenda('desktop');
    const list = await screen.findByRole('region', { name: 'Partidos' });
    const row = (id: string) => list.querySelector(`[data-match="${id}"]`);
    await waitFor(() => expect(row(LIVE.id)).toHaveClass('is-mine'));
    expect(row(mineLater.id)).toHaveClass('is-mine');
    // LaLiga es una de tus ligas, pero el aura es solo para tus equipos.
    expect(row(leagueOnly.id)).not.toHaveClass('is-mine');
    // «Luego» se queda, con el de tu equipo resaltado igual.
    const side = screen.getByRole('complementary', { name: 'Partido elegido' });
    const later = side.querySelector('.agenda-later') as HTMLElement;
    expect(within(later).getByRole('heading', { name: 'Luego' })).toBeInTheDocument();
    expect(later.querySelector(`[data-match="${mineLater.id}"]`)).toHaveClass('is-mine');
    expect(later.querySelector(`[data-match="${leagueOnly.id}"]`)).not.toHaveClass('is-mine');
  });

  it('pantalla ancha: «En directo» con el marcador junto al minuto; tocar CUALQUIER directo enseña su canal abajo', async () => {
    const otherLive = matchAt(-30, {
      home: 'Girona',
      away: 'Sevilla',
      competition: 'LaLiga',
      channels: [{ id: 'f', name: 'DAZN 1' }],
    });
    net = mockFetch(
      routes({
        'GET /api/v1/football': scheduleOf({ [TODAY]: [LIVE, otherLive, SOON] }),
        'GET /api/v1/scores': {
          available: true,
          generatedAt: new Date(NOW).toISOString(),
          source: 'espn',
          attribution: 'ESPN',
          leagues: 1,
          scores: {
            [LIVE.id]: liveScore(2, 1, "54'"),
            [otherLive.id]: liveScore(1, 0, "33'"),
          },
        },
        [`GET /api/v1/football/preheat/${otherLive.id}`]: { preheat: null },
      }),
    );
    renderAgenda('wide');
    const strip = await screen.findByRole('navigation', { name: 'En directo' });
    // «RMA 2–1 GIR · 54'»: el marcador a la vista junto al minuto.
    const chip = await within(strip).findByRole('button', {
      name: 'Real Madrid vs Girona, 2 a 1, minuto 54',
    });
    expect(chip.querySelector('.agenda-strip__score')).toHaveTextContent(/2.*1/);
    expect(chip.querySelector('.agenda-strip__minute')).toHaveTextContent("54'");
    const side = screen.getByRole('complementary', { name: 'Partido elegido' });
    // El destacado ya está en el panel; tocarlo lo deja ahí con su canal.
    fireEvent.click(chip);
    expect(
      await within(side).findByRole('heading', { name: 'Real Madrid vs Girona' }),
    ).toBeInTheDocument();
    expect(within(side).getByText('M+ Liga de Campeones')).toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-current', 'true');
    // Otro directo: abajo su canal y su acción (no los de «Luego»).
    const other = within(strip).getByRole('button', {
      name: 'Girona vs Sevilla, 1 a 0, minuto 33',
    });
    fireEvent.click(other);
    expect(
      await within(side).findByRole('heading', { name: 'Girona vs Sevilla' }),
    ).toBeInTheDocument();
    expect(within(side).getByText('DAZN 1')).toBeInTheDocument();
    expect(
      within(side).getByRole('button', { name: /canal para Girona vs Sevilla/ }),
    ).toBeInTheDocument();
    expect(other).toHaveAttribute('aria-current', 'true');
    // Las tarjetas siguen tapadas: solo la tira enseña el resultado.
    expect(document.querySelectorAll('.agenda-score .num')).toHaveLength(0);
  });

  it('pantalla ancha: el partido que estás viendo sale tapado también en «En directo» (regla 29)', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    renderAgenda('wide');
    const strip = await screen.findByRole('navigation', { name: 'En directo' });
    const chip = await within(strip).findByRole('button', {
      name: 'Real Madrid vs Girona, minuto 54',
    });
    expect(chip.querySelector('.agenda-strip__score')).toBeNull();
    const side = screen.getByRole('complementary', { name: 'Partido elegido' });
    fireEvent.click(
      await within(side).findByRole('button', { name: 'Ver marcador de Real Madrid vs Girona' }),
    );
    await waitFor(() =>
      expect(chip).toHaveAccessibleName('Real Madrid vs Girona, 2 a 1, minuto 54'),
    );
    expect(strip.querySelector('.agenda-strip__score')).toHaveTextContent(/2.*1/);
  });
});
