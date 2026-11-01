import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { setPlayerPresence } from '../../app/player-presence.ts';
import { installShortcutListener, shortcutStore } from '../../app/shortcuts.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { MEDIA } from '../../lib/media.ts';
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

/* `landscape`: el móvil en horizontal (844 × 390), «tableta» por ancho pero
   con la portada de siempre (héroe y filas de tarjetas); `mobile` es el
   móvil en vertical, con la Agenda «Por competición». */
function renderAgenda(kind: 'mobile' | 'landscape' | 'desktop' | 'wide' = 'mobile') {
  if (kind === 'landscape') {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === MEDIA.phoneLandscape || query === MEDIA.tablet,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  }
  return renderWithApp(<Agenda route={{ vista: 'agenda' }} active />, {
    kind: kind === 'landscape' ? 'tablet' : kind,
  });
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
  vi.restoreAllMocks();
  net?.restore();
  uninstall();
  shortcutStore.set([]);
  resetMode();
  resetToasts();
  setPlayerPresence({ active: false, route: null, immersive: false });
  history.replaceState(null, '', '/');
});

describe('vista Agenda', () => {
  it('móvil en horizontal: cabecera, días, «Para ti» por defecto con gustos, bloques por competición y pie', async () => {
    net = mockFetch(routes());
    renderAgenda('landscape');
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
    expect(screen.getByText('futbolenlatv.es', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/horario peninsular/)).toBeInTheDocument();
  });

  it('móvil en horizontal: portada: héroe con el destacado, sin marcador en la tarjeta; el botón navega y nunca reproduce', async () => {
    net = mockFetch(routes());
    renderAgenda('landscape');
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
      expect(screen.getByText('Datos: futbolenlatv.es')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('móvil en horizontal: «Todos» enseña todo; «Ver canal» si está en tu biblioteca y «Buscar canal» si no', async () => {
    net = mockFetch(routes());
    renderAgenda('landscape');
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

  it('en el móvil, hacia un lado sin día (Hoy, dedo a la derecha) la lista apenas se mueve y no cambia nada', async () => {
    net = mockFetch(routes());
    renderAgenda();
    await screen.findByRole('heading', { name: /Champions League/ });
    const panel = screen.getByRole('tabpanel');
    const title = screen.getByRole('heading', { name: /LaLiga/ });
    const pull = (to: number) => {
      const start = { identifier: 1, target: title, clientX: 100, clientY: 400 };
      fireEvent.touchStart(title, { touches: [start], changedTouches: [start] });
      const point = { identifier: 1, target: title, clientX: to, clientY: 400 };
      fireEvent.touchMove(title, { touches: [point], changedTouches: [point] });
      return Math.abs(Number(/translateX\((-?[\d.]+)px\)/.exec(panel.style.transform)?.[1]));
    };
    const release = (at: number) => {
      const end = { identifier: 1, target: title, clientX: at, clientY: 400 };
      fireEvent.touchEnd(title, { touches: [], changedTouches: [end] });
    };
    // Hoy es el primer día: a la derecha, resistencia fuerte (y al soltar, a su sitio).
    expect(pull(330)).toBeLessThanOrEqual(16);
    release(330);
    expect(panel.style.transform).toBe('');
    expect(screen.getByRole('tab', { name: /^Hoy/ })).toHaveAttribute('aria-selected', 'true');
    // Hacia Mañana, el arrastre normal (más largo).
    expect(pull(-60)).toBeGreaterThan(40);
    release(-60);
    expect(await findInRows('Betis')).toBeInTheDocument();
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

  it('móvil en horizontal: marcadores TAPADOS por defecto en toda la agenda; «Marcador» destapa ese partido y otro toque lo tapa', async () => {
    net = mockFetch(routes());
    const { container } = renderAgenda('landscape');
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

  it('móvil en horizontal: menú contextual: «Ver marcador» destapa y «Tapar el marcador» lo tapa', async () => {
    net = mockFetch(routes());
    const { container } = renderAgenda('landscape');
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

  it('móvil en horizontal: el partido que ves: «En pantalla» y «Volver al vídeo»; detener vuelve a tapar lo destapado (regla 29)', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    renderAgenda('landscape');
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

  it('móvil en horizontal: sin partidos tuyos: «Nada de los tuyos este día» con sus dos salidas', async () => {
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
    renderAgenda('landscape');
    const heading = await screen.findByRole('heading', { name: 'Nada de los tuyos este día' });
    const empty = heading.closest('section') as HTMLElement;
    expect(within(empty).getByRole('button', { name: 'Editar mis gustos' })).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole('button', { name: 'Ver todos' }));
    expect(await screen.findByText('Arsenal')).toBeInTheDocument();
  });

  it('móvil en horizontal: día sin partidos: «Sin partidos anunciados» y salida al día siguiente', async () => {
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
    renderAgenda('landscape');
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

  it('escritorio: al entrar NADA abierto (sin destacado); lista con pestañas, día y píldoras', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    const side = await screen.findByRole('complementary', { name: 'Detalle del partido' });
    expect(document.querySelector('.agenda-hero')).toBeNull();
    // Ningún partido elegido: la invitación y el resumen del día, nunca el destacado.
    expect(within(side).getByRole('heading', { name: 'Elige un partido' })).toBeInTheDocument();
    expect(within(side).queryByRole('heading', { name: 'Real Madrid vs Girona' })).toBeNull();
    expect(within(side).queryByRole('button', { name: /^Ver partido/ })).toBeNull();
    await waitFor(() =>
      expect(side.querySelector('.agenda-detail__summary')).toHaveTextContent(
        /^Hoy: 3 partidos1 en directo$/,
      ),
    );
    expect(document.querySelector('.desk-row[aria-current="true"]')).toBeNull();
    // La barra, la misma que con un partido abierto (título y buscador):
    // «Editar mis gustos» y «Actualizar» van al pie del detalle.
    const bar = document.querySelector('.agenda-head') as HTMLElement;
    expect(within(bar).queryByRole('button', { name: 'Editar mis gustos' })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /^Actualizar agenda/ })).toBeNull();
    expect(within(side).getByRole('button', { name: 'Editar mis gustos' })).toBeInTheDocument();
    expect(within(side).getByRole('button', { name: /^Actualizar agenda/ })).toBeInTheDocument();
    // Pestañas «Todo» / «Para ti», el día en su píldora y las píldoras de estado.
    const tabs = screen.getByRole('group', { name: 'Qué partidos ver' });
    expect(within(tabs).getByRole('button', { name: /^Todo/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(screen.getByRole('group', { name: 'Día' })).getByText('Hoy')).toBeInTheDocument();
    const pills = screen.getByRole('group', { name: 'Filtrar partidos' });
    expect(within(pills).getByRole('button', { name: 'En directo: 1' })).toBeInTheDocument();
    expect(within(pills).getByRole('button', { name: 'Terminados' })).toBeInTheDocument();
    expect(within(pills).getByRole('button', { name: 'Próximos' })).toBeInTheDocument();
    // Filas compactas agrupadas por competición (con su país); el directo
    // enseña su marcador (no es el que estás viendo: Isma, 1-11-2026).
    const liveRow = await screen.findByRole('button', {
      name: /^Real Madrid contra Girona, en directo/,
    });
    const premier = screen.getByRole('region', { name: 'Premier League' });
    expect(within(premier).getByText('Inglaterra')).toBeInTheDocument();
    await waitFor(() => expect(liveRow.querySelector('.desk-row__score--live')).not.toBeNull());
    // El lector de pantalla oye el minuto, el marcador, el canal y la señal
    // (el nombre del botón son solo los equipos y el estado).
    await waitFor(() =>
      expect(liveRow).toHaveAccessibleDescription(
        /^Minuto 54\. Marcador: 2 a 1\. En M\+ Liga de Campeones\. .+/,
      ),
    );
  });

  it('escritorio: un clic ELIGE (detalle a la derecha, sin navegar); «Ver partido» lo abre y la X lo cierra', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    const row = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    fireEvent.click(row);
    expect(location.search).not.toContain('vista=partido');
    expect(row).toHaveAttribute('aria-current', 'true');
    const side = screen.getByRole('complementary', { name: 'Detalle del partido' });
    const detail = within(side).getByRole('article', { name: 'Real Madrid vs Girona' });
    // Migas «País › Competición», los dos equipos y, en directo, el minuto.
    expect(detail.querySelector('.agenda-detail__crumbs')).toHaveTextContent(
      'EuropaChampions League',
    );
    expect(within(detail).getByText('Real Madrid')).toBeInTheDocument();
    expect(within(detail).getByText('Girona')).toBeInTheDocument();
    expect(await within(detail).findByText("54'")).toBeInTheDocument();
    // El marcador, A LA VISTA sin tocar nada: no es el partido que estás viendo.
    expect(within(detail).getByLabelText('Marcador: 2 a 1')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /^Ver marcador/ })).toBeNull();
    // «Dónde se ve»: los canales en filas y «Ver juntos».
    expect(within(detail).getByRole('heading', { name: 'Dónde se ve' })).toBeInTheDocument();
    expect(
      within(detail).getByRole('button', { name: /M\+ Liga de Campeones/ }),
    ).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Ver juntos' })).toBeEnabled();
    // La X cierra el detalle: vuelve la invitación y el foco, a la fila.
    fireEvent.click(within(detail).getByRole('button', { name: 'Cerrar el detalle' }));
    expect(within(side).getByRole('heading', { name: 'Elige un partido' })).toBeInTheDocument();
    expect(row).not.toHaveAttribute('aria-current');
    await waitFor(() => expect(row).toHaveFocus());
    // Escape también lo cierra (y devuelve el foco a la fila).
    fireEvent.click(row);
    expect(
      within(side).getByRole('article', { name: 'Real Madrid vs Girona' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(side).getByRole('heading', { name: 'Elige un partido' })).toBeInTheDocument();
    await waitFor(() => expect(row).toHaveFocus());
    // Otro partido y «Ver partido»: el centro de partido con el vídeo.
    fireEvent.click(screen.getByRole('button', { name: /^Arsenal contra Chelsea/ }));
    fireEvent.click(within(side).getByRole('button', { name: 'Ver partido: Arsenal vs Chelsea' }));
    await waitFor(() => expect(location.search).toContain(`vista=partido/${SOON.id}`));
  });

  it('escritorio: doble clic, Intro o la O abren el partido; sin canal, «Ver partido» no se puede y avisa', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    const soon = await screen.findByRole('button', { name: /^Arsenal contra Chelsea/ });
    fireEvent.doubleClick(soon);
    await waitFor(() => expect(location.search).toContain(`vista=partido/${SOON.id}`));
    history.replaceState(null, '', '/?vista=agenda');
    const live = screen.getByRole('button', { name: /^Real Madrid contra Girona/ });
    fireEvent.keyDown(live, { key: 'Enter' });
    await waitFor(() => expect(location.search).toContain(`vista=partido/${LIVE.id}`));
    history.replaceState(null, '', '/?vista=agenda');
    // O: abre el elegido.
    fireEvent.click(soon);
    fireEvent.keyDown(window, { key: 'o' });
    await waitFor(() => expect(location.search).toContain(`vista=partido/${SOON.id}`));
    history.replaceState(null, '', '/?vista=agenda');
    // Sin canal: el detalle lo dice y «Ver partido» no se puede; Intro avisa.
    const none = screen.getByRole('button', { name: /^Getafe contra Elche/ });
    fireEvent.click(none);
    const side = screen.getByRole('complementary', { name: 'Detalle del partido' });
    expect(within(side).getByText('Sin canal anunciado todavía.')).toBeInTheDocument();
    expect(within(side).getByRole('button', { name: 'Ver partido' })).toBeDisabled();
    fireEvent.keyDown(none, { key: 'Enter' });
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
    expect(location.search).not.toContain('vista=partido');
  });

  it('escritorio: píldoras «En directo», «Terminados» y «Próximos» y plegar un grupo', async () => {
    const DONE = matchAt(-240, {
      home: 'Osasuna',
      away: 'Alavés',
      competition: 'LaLiga',
      channels: [{ id: 'c', name: 'DAZN LaLiga' }],
    });
    net = mockFetch(
      routes({
        'GET /api/v1/football': scheduleOf({ [TODAY]: [LIVE, SOON, NO_CHANNEL, DONE] }),
      }),
    );
    renderAgenda('desktop');
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const pills = screen.getByRole('group', { name: 'Filtrar partidos' });
    const shownRows = () =>
      [...document.querySelectorAll('.desk-row')].map((row) =>
        row.getAttribute('aria-label')?.replace(/ contra .*/, ''),
      );
    fireEvent.click(within(pills).getByRole('button', { name: 'En directo: 1' }));
    await waitFor(() => expect(shownRows()).toEqual(['Real Madrid']));
    fireEvent.click(within(pills).getByRole('button', { name: 'Terminados' }));
    await waitFor(() => expect(shownRows()).toEqual(['Osasuna']));
    // El terminado dice «Final» bajo la hora.
    expect(document.querySelector('.desk-row__state')).toHaveTextContent('Final');
    fireEvent.click(within(pills).getByRole('button', { name: 'Próximos' }));
    await waitFor(() => expect(shownRows().sort()).toEqual(['Arsenal', 'Getafe']));
    // Otro toque en la misma píldora la quita: todos otra vez.
    fireEvent.click(within(pills).getByRole('button', { name: 'Próximos' }));
    await waitFor(() => expect(shownRows()).toHaveLength(4));
    // Plegar un grupo esconde sus filas; desplegarlo las devuelve.
    const laliga = screen.getByRole('region', { name: 'LaLiga' });
    const fold = within(laliga).getByRole('button', { name: 'Plegar LaLiga' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(fold);
    expect(within(laliga).queryByRole('button', { name: /^Getafe contra Elche/ })).toBeNull();
    fireEvent.click(within(laliga).getByRole('button', { name: 'Desplegar LaLiga' }));
    expect(
      within(laliga).getByRole('button', { name: /^Getafe contra Elche/ }),
    ).toBeInTheDocument();
  });

  it('escritorio: el partido que estás VIENDO sale tapado en la fila y en el detalle (regla 29)', async () => {
    net = mockFetch(routes());
    setPlayerPresence({ active: true, route: { vista: 'partido', id: LIVE.id, canal: null } });
    renderAgenda('desktop');
    const row = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    await waitFor(() => expect(row.querySelector('.player-eq')).not.toBeNull());
    expect(row.querySelector('.desk-row__score')).toBeNull();
    fireEvent.click(row);
    const side = screen.getByRole('complementary', { name: 'Detalle del partido' });
    const name = 'Ver marcador de Real Madrid vs Girona';
    const capsule = await within(side).findByRole('button', { name });
    expect(within(side).queryByLabelText('Marcador: 2 a 1')).toBeNull();
    // Destaparlo lo enseña también en la fila; otro toque lo vuelve a tapar.
    fireEvent.click(capsule);
    await waitFor(() => expect(row.querySelector('.desk-row__score')).not.toBeNull());
    expect(row).toHaveAccessibleDescription(/Marcador: 2 a 1\. .*Lo estás viendo$/);
    fireEvent.click(within(side).getByRole('button', { name: /^Tapar el marcador/ }));
    expect(await within(side).findByRole('button', { name })).toBeInTheDocument();
    expect(row.querySelector('.desk-row__score')).toBeNull();
  });

  it('escritorio: el partido de TUS EQUIPOS va resaltado en la lista', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    const live = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    expect(live).toHaveClass('desk-row--mine');
    expect(screen.getByRole('button', { name: /^Arsenal contra Chelsea/ })).not.toHaveClass(
      'desk-row--mine',
    );
  });
  it('escritorio: el resumen para lectores de pantalla cuenta lo que enseña la lista (pestaña y píldora)', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const status = () =>
      [...document.querySelectorAll('.agenda--desk [role="status"]')].pop()?.textContent ?? '';
    // Abre en «Todo» (aunque en el móvil sería «Para ti»): 3 partidos, 1 en directo.
    await waitFor(() => expect(status()).toMatch(/: 3 partidos, 1 en directo$/));
    const tabs = screen.getByRole('group', { name: 'Qué partidos ver' });
    fireEvent.click(within(tabs).getByRole('button', { name: /^Para ti/ }));
    await waitFor(() => expect(status()).toMatch(/: 2 partidos, 1 en directo, solo los tuyos$/));
    const pills = screen.getByRole('group', { name: 'Filtrar partidos' });
    fireEvent.click(within(pills).getByRole('button', { name: 'Próximos' }));
    await waitFor(() => expect(status()).toMatch(/: 1 partido, solo los tuyos$/));
  });

  it('escritorio: T cambia entre las pestañas «Todo» y «Para ti»', async () => {
    net = mockFetch(routes());
    renderAgenda('desktop');
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const tabs = screen.getByRole('group', { name: 'Qué partidos ver' });
    const forYou = await within(tabs).findByRole('button', { name: /^Para ti/ });
    const all = within(tabs).getByRole('button', { name: /^Todo/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 't' });
    await waitFor(() => expect(forYou).toHaveAttribute('aria-pressed', 'true'));
    expect(document.querySelectorAll('.desk-row')).toHaveLength(2);
    fireEvent.keyDown(window, { key: 't' });
    await waitFor(() => expect(all).toHaveAttribute('aria-pressed', 'true'));
    expect(document.querySelectorAll('.desk-row')).toHaveLength(3);
    expect(shortcutStore.get().find((item) => item.id === 'agenda.filtro')?.label).toBe(
      'Cambia entre «Para ti» y «Todo»',
    );
  });
});
