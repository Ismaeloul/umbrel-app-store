/* La interfaz del reproductor (PlayerDock) con Testing Library: panel del
   vídeo, botón de directo con sus dos estados, capa de toque, menú «Más
   opciones» con «Abrir en…», datos técnicos, atajos del registro central,
   Media Session, línea de estado, mini-reproductor y, de punta a punta, un
   play() de la API pública que acaba en el panel de error de este navegador
   (jsdom no tiene MSE ni HLS). Sin red: fetch simulado. */

import type { PlaybackStatus, SessionSummary } from '@ace/shared';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceId, getViewerId } from '../api/identity.ts';
import { createQueryClient, routeKey } from '../api/query.ts';
import { resetMode, setMode } from '../api/mode.ts';
import { playerPresence } from '../app/player-presence.ts';
import { RouterProvider } from '../app/router.tsx';
import { installShortcutListener, shortcutStore } from '../app/shortcuts.ts';
import { clearStatus, statusStore } from '../notices/statusLine.ts';
import { toastStore } from '../notices/toasts.ts';
import { resetScoreRevealForTests, revealScore } from '../features/agenda/score-reveal.ts';
import { fixture, mockFetch } from '../test/fetch.ts';
import {
  hostNerdPanel,
  INITIAL_PLAYER_STATE,
  play,
  playerStore,
  resetPlayerApi,
  type PlayerState,
} from './api.ts';
import PlayerDock, { sharedRuntimeForTests } from './index.tsx';
import { madridToday } from './PlayerSurface.tsx';
import { stageSlotStore } from './stage-slot.ts';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const ROUTE = { vista: 'partido' as const, id: null, canal: HASH };

let net: ReturnType<typeof mockFetch>;
let uninstall: () => void = () => {};

function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <RouterProvider initialSearch={`?vista=partido/canal/${HASH}`}>{children}</RouterProvider>
    </QueryClientProvider>
  );
}

function renderDock(
  presentation: 'stage' | 'mini' = 'stage',
  handlers = { onMinimize: vi.fn(), onExpand: vi.fn() },
  client: QueryClient = createQueryClient(),
) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  const view = render(
    <Providers client={client}>
      <PlayerDock presentation={presentation} route={ROUTE} {...handlers} />
    </Providers>,
    { container: root },
  );
  return { ...view, handlers };
}

function setPlayer(patch: Partial<PlayerState>) {
  act(() => {
    playerStore.set((state) => ({ ...state, ...patch }));
  });
}

function playing(patch: Partial<PlayerState> = {}): Partial<PlayerState> {
  return {
    phase: 'reproduciendo',
    conn: 'activa',
    channel: {
      hash: HASH,
      title: 'M+ Liga de Campeones',
      subtitle: 'Fuente 1, Elcano',
      lead: 'Fuente 1 verificada.',
    },
    started: true,
    desiredPlaying: true,
    live: { available: true, atLive: true, behindS: 1, delayS: 6 },
    ...patch,
  };
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  resetMode();
  setMode('live', 'bootstrap');
  resetPlayerApi();
  clearStatus();
  playerPresence.set({ active: false, route: null, immersive: false });
  net = mockFetch({
    'GET /api/v1/library': fixture('libraryGet'),
    'GET /api/v1/engine/status': fixture('engineStatus'),
    [`GET /api/v1/channels/${HASH}/stream`]: fixture('channelStream'),
    'POST /api/v1/library': fixture('libraryMutate'),
  });
  uninstall = installShortcutListener(window);
  // jsdom no reproduce vídeo: play/pause/load mínimos.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  uninstall();
  net.restore();
  resetMode();
  shortcutStore.set([]);
  playerStore.set(INITIAL_PLAYER_STATE);
});

describe('reproductor en grande', () => {
  it('en reposo: «Sin señal», sin controles de reproducción y un <video> sin controles del sistema', () => {
    const { container } = renderDock();
    expect(screen.getByText('Sin señal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('playsinline');
    expect(video).not.toHaveAttribute('controls');
  });

  it('en reposo, los tres datos del panel (§8.1): motor, canales y partidos de HOY (en Madrid)', async () => {
    const schedule = fixture<{ days: Array<{ date: string; matches: unknown[] }> }>(
      'footballSchedule',
    );
    const match = schedule.days[0]!.matches[0]!;
    // Hoy con 2 partidos y mañana con 1: cuenta solo los de hoy.
    schedule.days = [
      { date: madridToday(), matches: [match, match] },
      { date: '2099-01-01', matches: [match] },
    ];
    net.restore();
    net = mockFetch({
      'GET /api/v1/library': fixture('libraryGet'),
      'GET /api/v1/engine/status': { ...fixture<object>('engineStatus'), status: 'online' },
    });
    // La agenda ya la trajo (el reproductor no la pide: solo mira la caché).
    const client = createQueryClient();
    client.setQueryData(routeKey('footballSchedule'), schedule);
    renderDock('stage', undefined, client);
    const facts = await screen.findByRole('list', { name: 'Resumen' });
    await waitFor(() => expect(within(facts).getAllByRole('listitem')).toHaveLength(3));
    expect(within(facts).getByText('Motor listo')).toBeInTheDocument();
    expect(within(facts).getByText(/^Hoy/)).toHaveTextContent('Hoy 2 partidos');
    expect(within(facts).getByText(/^Canales/)).toHaveTextContent(/^Canales \d+$/);
    expect(net.calls.some((call) => call.url.includes('/api/v1/football'))).toBe(false);
  });

  it('botón de directo: relleno en el borde, «Ir al directo · −34 s» por detrás y «Reanudar» en pausa', () => {
    renderDock();
    setPlayer(playing());
    expect(screen.getByRole('button', { name: 'Ya en directo' })).toHaveAttribute(
      'data-mode',
      'live',
    );
    setPlayer({ live: { available: true, atLive: false, behindS: 34, delayS: 40 } });
    const behind = screen.getByRole('button', {
      name: 'Ir al directo (vas 34 segundos por detrás)',
    });
    expect(behind).toHaveTextContent('Ir al directo · −34 s');
    expect(behind).toHaveAttribute('data-mode', 'behind');
    setPlayer({
      phase: 'pausado',
      desiredPlaying: false,
      live: { available: true, atLive: true, behindS: 0, delayS: 6 },
    });
    expect(screen.getByRole('button', { name: 'Reanudar en directo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
  });

  it('controles: pausa, −30 s, silencio y minimizar; y la línea de estado bajo el vídeo', () => {
    // Sin matchMedia (jsdom) cuenta como móvil: detener va en «Más opciones», como en la maqueta.
    const { handlers } = renderDock();
    setPlayer(playing());
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Detener' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar el reproductor' }));
    expect(handlers.onMinimize).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retroceder 30 segundos' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Silenciar' })).toBeInTheDocument();
    expect(statusStore.get().base).toEqual({
      text: 'Fuente 1 verificada. Vas en directo.',
      signal: 'ok',
      meta: '6 s de retraso',
    });
  });

  it('ratón: controles que se esconden a los 3,2 s solo si suena, clic que pausa a los 190 ms y doble clic a pantalla completa (B-102, B-088)', async () => {
    const requestFullscreen = vi.fn(async () => {});
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const { container } = renderDock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const chrome = container.querySelector<HTMLElement>('.player-chrome')!;
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      // Pausado (con canal) no se esconden nunca.
      setPlayer(playing({ phase: 'pausado', desiredPlaying: false }));
      act(() => vi.advanceTimersByTime(10_000));
      expect(chrome).toHaveAttribute('data-visible', 'true');
      // Sonando de verdad: a los 3,2 s sin mover el ratón, fuera.
      setPlayer(playing());
      act(() => vi.advanceTimersByTime(3_100));
      expect(chrome).toHaveAttribute('data-visible', 'true');
      act(() => vi.advanceTimersByTime(200));
      expect(chrome).toHaveAttribute('data-visible', 'false');
      // Mover el ratón los despierta.
      fireEvent.pointerMove(hit, { pointerType: 'mouse' });
      expect(chrome).toHaveAttribute('data-visible', 'true');

      const toggle = vi
        .spyOn(sharedRuntimeForTests()!, 'toggle')
        .mockResolvedValue(undefined as never);
      fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0 });
      fireEvent.click(hit);
      act(() => vi.advanceTimersByTime(150));
      expect(toggle).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(60));
      expect(toggle).toHaveBeenCalledTimes(1);
      // Doble clic: no pausa (se cancela el clic pendiente) y pone pantalla completa.
      fireEvent.pointerDown(hit, { pointerType: 'mouse', button: 0 });
      fireEvent.click(hit);
      fireEvent.doubleClick(hit);
      act(() => vi.advanceTimersByTime(400));
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, 'fullscreenEnabled');
      Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    }
    // Un solo reproductor visible: si alguien le pone controles nativos al <video>, se quitan.
    const video = container.querySelector('video')!;
    video.setAttribute('controls', '');
    await waitFor(() => expect(video).not.toHaveAttribute('controls'));
  });

  it('autoplay bloqueado: «Toca para reproducir»', () => {
    renderDock();
    setPlayer(playing({ phase: 'bloqueado', started: false, conn: 'arrancando' }));
    expect(screen.getByRole('button', { name: /Toca para reproducir/ })).toBeInTheDocument();
  });

  it('error: panel en rojo con su frase y «Reintentar»', () => {
    renderDock();
    setPlayer({
      ...playing(),
      phase: 'error',
      conn: 'error',
      idleReason: 'fallo',
      message: 'Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.',
    });
    expect(screen.getByText('No se pudo abrir')).toBeInTheDocument();
    expect(screen.getByText(/no tiene pares ahora mismo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    // Sin nada que reproducir, fuera los controles de abajo (Detener sigue en el menú).
    expect(screen.queryByRole('button', { name: /Directo|Reanudar|directo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retroceder 30 segundos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Más opciones' })).toBeInTheDocument();
  });

  it('«Más opciones»: abrir en AceStream, copiar URL para VLC, enlace y hash; y los datos técnicos', async () => {
    renderDock();
    setPlayer(playing({ engine: 'mpegts', protocol: 'mpegts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    const menu = await screen.findByRole('menu', { name: 'Opciones del reproductor' });
    for (const label of [
      'Abrir en la app de AceStream',
      'Copiar URL del stream (VLC)',
      'Copiar enlace acestream://',
      'Copiar hash',
      'Retroceder 30 s',
      'Detener',
    ])
      expect(
        within(menu).getByRole('menuitem', { name: new RegExp(label.replace(/[()+]/g, '\\$&')) }),
      ).toBeInTheDocument();
    // Táctil (jsdom no tiene puntero fino): sin las teclas, que ahí no sirven.
    expect(within(menu).queryByText('K')).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Datos técnicos/ }));
    // Móvil en vertical sin vista que los enseñe: en una hoja (no empuja la línea de estado).
    const panel = await screen.findByRole('dialog', { name: 'Datos técnicos' });
    expect(within(panel).getByText('mpegts.js')).toBeInTheDocument();
    expect(within(panel).getByText(HASH)).toBeInTheDocument();
  });

  it('si el centro de partido ya enseña los datos técnicos (useHostNerdPanel), el reproductor no saca los suyos', async () => {
    const release = hostNerdPanel();
    try {
      renderDock();
      setPlayer(playing({ engine: 'mpegts', nerdOpen: true }));
      await act(async () => {});
      expect(screen.queryByRole('dialog', { name: 'Datos técnicos' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Datos técnicos' })).toBeNull();
    } finally {
      release();
    }
    // Al irse la vista, vuelven a salir del reproductor.
    expect(await screen.findByRole('dialog', { name: 'Datos técnicos' })).toBeInTheDocument();
  });

  it('la estrella sabe si el canal está en favoritos', async () => {
    renderDock();
    setPlayer(playing());
    expect(await screen.findByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('atajos en el registro central (salen en la ayuda «?»): espacio/K, M, J, F, P, S, G y ← →', () => {
    renderDock();
    const ids = shortcutStore.get().map((entry) => entry.id);
    for (const id of [
      'reproductor.pausa',
      'reproductor.silencio',
      'reproductor.atras',
      'reproductor.completa',
      'reproductor.pip',
      'reproductor.nerd',
      'reproductor.favorito',
      'reproductor.anterior',
      'reproductor.siguiente',
    ])
      expect(ids).toContain(id);
    expect(shortcutStore.get().find((entry) => entry.id === 'reproductor.pausa')?.group).toBe(
      'Reproductor',
    );

    // S abre los datos técnicos solo si hay canal.
    fireEvent.keyDown(window, { key: 's' });
    expect(playerStore.get().nerdOpen).toBe(false);
    setPlayer(playing());
    fireEvent.keyDown(window, { key: 's' });
    expect(playerStore.get().nerdOpen).toBe(true);
  });

  it('Palco: publica el hueco del marcador sobre el vídeo y hace un corte a negro al cambiar de fuente (W5, W14)', () => {
    const { container, unmount } = renderDock();
    // El hueco donde el centro de partido proyecta su cápsula (arriba a la izquierda).
    const slot = stageSlotStore.get();
    expect(slot).not.toBeNull();
    expect(slot).toHaveClass('player-slot');
    expect(container.querySelector('.player-chrome__lead')).toContainElement(slot);
    // Sin cambio de fuente, sin velo.
    setPlayer(playing());
    expect(container.querySelector('.player-cut')).toBeNull();
    setPlayer({
      channel: { hash: 'b'.repeat(40), title: 'M+ Liga de Campeones', subtitle: 'Fuente 2, Faro' },
    });
    expect(container.querySelector('.player-frame .player-cut')).not.toBeNull();
    // Un solo <video> y ninguna miniatura.
    expect(container.querySelectorAll('video')).toHaveLength(1);
    unmount();
    expect(stageSlotStore.get()).toBeNull();
  });

  it('P sin Picture-in-Picture en el navegador: lo dice (B-093)', async () => {
    renderDock();
    setPlayer(playing());
    fireEvent.keyDown(window, { key: 'p' });
    await waitFor(() =>
      expect(toastStore.get().map((item) => item.text)).toContain(
        'PiP no disponible en este navegador',
      ),
    );
  });

  it('Media Session con título, portada y acciones', () => {
    const setActionHandler = vi.fn();
    const mediaSession = { metadata: null as unknown, playbackState: 'none', setActionHandler };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: mediaSession });
    class FakeMetadata {
      constructor(readonly init: { title: string; artist: string; artwork: unknown[] }) {}
    }
    vi.stubGlobal('MediaMetadata', FakeMetadata);
    try {
      renderDock();
      setPlayer(playing());
      const actions = setActionHandler.mock.calls.map(([action]) => action);
      expect(actions).toEqual(expect.arrayContaining(['play', 'pause', 'stop', 'seekbackward']));
      expect((mediaSession.metadata as FakeMetadata).init).toMatchObject({
        title: 'M+ Liga de Campeones',
        artist: 'Fuente 1, Elcano',
      });
      expect(mediaSession.playbackState).toBe('playing');
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, 'mediaSession');
    }
  });
});

describe('mini-reproductor «Sonando»', () => {
  it('canal, segunda línea sin marcador, pausa y detener; tocarlo vuelve al vídeo', () => {
    const { handlers } = renderDock('mini');
    setPlayer(playing());
    expect(screen.getByText('Sonando')).toBeInTheDocument();
    expect(screen.getByText('M+ Liga de Campeones')).toBeInTheDocument();
    expect(screen.getByText('Fuente 1, Elcano')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver al vídeo: M+ Liga de Campeones' }));
    expect(handlers.onExpand).toHaveBeenCalled();
    act(() => playerPresence.set({ active: true, route: ROUTE, immersive: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Detener la reproducción' }));
    expect(playerStore.get().phase).toBe('idle');
    expect(playerPresence.get().active).toBe(false);
  });

  it('con un partido: «Marcador oculto» y, destapado, solo el minuto (nunca las cifras)', () => {
    resetScoreRevealForTests();
    const client = createQueryClient();
    client.setQueryData(routeKey('scores'), {
      available: true,
      generatedAt: null,
      source: 'espn',
      attribution: null,
      leagues: 1,
      scores: {
        'm-1': { home: 2, away: 1, state: 'in', clock: "72'", detail: '2ª parte', confidence: 0.9 },
      },
    });
    renderDock('mini', undefined, client);
    setPlayer(playing({ route: { vista: 'partido', id: 'm-1', canal: null } }));
    expect(screen.getByText('Marcador oculto')).toBeInTheDocument();
    expect(screen.getByText('Fuente 1, Elcano')).toBeInTheDocument();
    act(() => revealScore('m-1'));
    expect(screen.getByText("72'")).toBeInTheDocument();
    expect(screen.queryByText(/2.1/)).toBeNull();
  });

  it('lleva a «Dónde se está reproduciendo» y avisa si otro dispositivo ve lo mismo', async () => {
    const client = createQueryClient();
    renderDock('mini', undefined, client);
    setPlayer(playing());
    const plain = screen.getByRole('button', { name: 'Dónde se está reproduciendo' });
    expect(plain).not.toHaveAttribute('data-shared');
    /* Llega por SSE (playback.sessions): este visor y un iPhone en la misma sesión. */
    const status = fixture<PlaybackStatus>('playbackStatus');
    const session = status.sessions[0] as SessionSummary;
    act(() => {
      client.setQueryData(routeKey('playbackStatus'), {
        ...status,
        sessions: [
          {
            ...session,
            viewers: session.viewers.map((viewer) =>
              viewer.platform === 'web'
                ? { ...viewer, viewerId: getViewerId(), deviceId: getDeviceId() }
                : viewer,
            ),
          },
        ],
      });
    });
    const shared = await screen.findByRole('button', {
      name: 'Dónde se está reproduciendo (también en otro dispositivo)',
    });
    expect(shared).toHaveAttribute('data-shared', 'true');
    fireEvent.click(shared);
    await waitFor(() => expect(decodeURIComponent(location.search)).toContain('ajustes/donde'));
  });

  it('con el dedo se arrastra: hacia arriba vuelve al vídeo; a un lado detiene con «Deshacer»', async () => {
    const { container, handlers } = renderDock('mini');
    act(() => playerPresence.set({ active: true, route: ROUTE, immersive: false }));
    setPlayer(playing());
    const mini = container.querySelector<HTMLElement>('.player[data-presentation="mini"]')!;
    const drag = (dx: number, dy: number) => {
      const finger = { pointerId: 9, pointerType: 'touch' };
      fireEvent.pointerDown(mini, { ...finger, clientX: 200, clientY: 600 });
      fireEvent.pointerMove(mini, { ...finger, clientX: 200 + dx / 2, clientY: 600 + dy / 2 });
      fireEvent.pointerUp(mini, { ...finger, clientX: 200 + dx, clientY: 600 + dy });
    };
    // El dedo manda: la cápsula no deja el scroll al navegador.
    expect(mini.style.touchAction).toBe('none');
    drag(0, -120);
    expect(handlers.onExpand).toHaveBeenCalledTimes(1);
    expect(playerStore.get().phase).toBe('reproduciendo');

    drag(200, 0);
    // Sale por el lado (220 ms) y entonces se detiene.
    await act(() => new Promise((resolve) => setTimeout(resolve, 260)));
    expect(playerStore.get().phase).toBe('idle');
    const aviso = toastStore.get().find((item) => item.text === 'Reproducción detenida');
    expect(aviso?.action?.label).toBe('Deshacer');
    // «Deshacer» vuelve a pedir el mismo canal.
    act(() => aviso!.action!.onAction());
    expect(playerStore.get().channel?.hash).toBe(HASH);
  });
});

describe('de punta a punta', () => {
  it('play() de la API pública: pide la URL, y en un navegador sin MSE ni HLS lo dice en el panel', async () => {
    renderDock();
    await waitFor(() => expect(playerStore.get().conn).toBe('idle'));
    act(() => {
      play({ hash: HASH, title: 'DAZN 1' }, { origin: 'library', route: ROUTE });
    });
    expect(playerPresence.get()).toMatchObject({ active: true, route: ROUTE });
    await waitFor(() =>
      expect(
        screen.getByText('Este navegador no puede reproducir este canal.'),
      ).toBeInTheDocument(),
    );
    const call = net.calls.find((c) => c.url.includes('/stream'))!;
    // jsdom no tiene MSE: se pide el remux, como en un iPhone.
    expect(new URL(call.url, 'http://x').searchParams.get('client')).toBe('ios');
  });
});
