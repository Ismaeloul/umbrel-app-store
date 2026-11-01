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
  onPlayerGesture,
  play,
  playerStore,
  resetPlayerApi,
  setPlayerMuted,
  setWaitingMessage,
  type PlayerState,
} from './api.ts';
import PlayerDock, { sharedRuntimeForTests } from './index.tsx';
import { madridToday } from './PlayerSurface.tsx';
import { stageSlotStore } from './stage-slot.ts';
import { zapBannerStore, ZAP_COMMIT_MS } from './favorite-zap.ts';
import { setWatching } from '../notices/notify.ts';
import { resetPlayGuard } from '../features/library/play.ts';

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
  vi.useRealTimers();
  zapBannerStore.set(null);
  resetPlayGuard();
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

  it('vista previa del móvil: un botón grande de play con su texto, sin «Buscando señal»', () => {
    const onAction = vi.fn();
    renderDock();
    act(() => {
      setWaitingMessage('Tu IPTV tiene este partido.', {
        action: { label: 'Toca para ver · IPTV', onAction },
      });
    });
    expect(screen.queryByText('Buscando señal')).toBeNull();
    expect(
      screen.getByText('Tu IPTV tiene este partido.', { selector: '.player-msg__text' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toca para ver · IPTV' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    act(() => setWaitingMessage(null));
    expect(screen.queryByRole('button', { name: 'Toca para ver · IPTV' })).toBeNull();
  });

  it('vista previa con otro canal aún en el escenario (el mini): el botón grande va encima solo si lo pide', () => {
    const onAction = vi.fn();
    renderDock();
    setPlayer(playing());
    act(() => {
      setWaitingMessage('Tu IPTV no arranca sola.', {
        action: { label: 'Toca para ver · IPTV', onAction },
      });
    });
    // Sin `cover`, lo que suena manda (el panel de espera no tapa un vídeo propio).
    expect(screen.queryByRole('button', { name: 'Toca para ver · IPTV' })).toBeNull();
    act(() => {
      setWaitingMessage('Tu IPTV no arranca sola.', {
        action: { label: 'Toca para ver · IPTV', onAction, cover: true },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Toca para ver · IPTV' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('el silencio pedido antes de montar llega al <video> antes del runtime: nadie publica «sin silencio»', () => {
    setPlayerMuted(true);
    const seen: boolean[] = [];
    const off = playerStore.subscribe(() => seen.push(playerStore.get().muted));
    try {
      const { container } = renderDock();
      const video = container.querySelector('video') as HTMLVideoElement;
      expect(video.muted).toBe(true);
      expect(playerStore.get().muted).toBe(true);
      expect(seen).not.toContain(false);
    } finally {
      off();
    }
  });

  it('quitar el silencio con los controles avisa del gesto (la vista previa termina ahí); silenciar, no', async () => {
    const gestures: string[] = [];
    const off = onPlayerGesture((gesture) => gestures.push(gesture));
    try {
      const { container } = renderDock();
      setPlayer(playing());
      fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
      expect(gestures).toEqual([]);
      const video = container.querySelector('video') as HTMLVideoElement;
      expect(video.muted).toBe(true);
      fireEvent.click(await screen.findByRole('button', { name: 'Activar sonido' }));
      expect(video.muted).toBe(false);
      expect(gestures).toEqual(['unmute']);
    } finally {
      off();
    }
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

  it('móvil en vertical (ficha B): una sola píldora DIRECTO, gris con la flecha si vas por detrás y «Reanudar» en pausa', () => {
    renderDock();
    setPlayer(playing());
    const live = screen.getByRole('button', { name: 'En directo' });
    expect(live).toHaveAttribute('data-mode', 'live');
    expect(live.textContent).not.toMatch(/\d/);
    setPlayer({ live: { available: true, atLive: false, behindS: 34, delayS: 40 } });
    const behind = screen.getByRole('button', {
      name: 'Ir al directo (vas 34 segundos por detrás)',
    });
    expect(behind).toHaveAttribute('data-mode', 'behind');
    // Sin contador: la píldora solo dice «Directo».
    expect(behind.textContent).not.toMatch(/\d/);
    setPlayer({
      phase: 'pausado',
      desiredPlaying: false,
      live: { available: true, atLive: true, behindS: 0, delayS: 6 },
    });
    expect(screen.getByRole('button', { name: 'Reanudar en directo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproducir' })).toBeInTheDocument();
  });

  it('móvil en horizontal por debajo de 768 (inmersivo): los controles mínimos «1B», como a 844', () => {
    const realMatchMedia = window.matchMedia;
    // 667×375 (iPhone SE girado): sin min-width de 768, pero en horizontal y bajo.
    window.matchMedia = ((query: string) => ({
      matches: /orientation: landscape/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = renderDock();
      setPlayer(playing());
      expect(container.querySelector('.player')).toHaveAttribute('data-immersive', 'true');
      expect(container.querySelector('.player-1b__bottom')).not.toBeNull();
      expect(container.querySelector('.player-b__top')).toBeNull();
      expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ver todas las fuentes/ })).toBeInTheDocument();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('escritorio (1B): silencio y barra de volumen junto a la barra del directo', () => {
    const realMatchMedia = window.matchMedia;
    // 1280 px con ratón: casan las de ancho y la de puntero fino.
    window.matchMedia = ((query: string) => ({
      matches: /min-width|pointer: fine/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = renderDock();
      setPlayer(playing());
      const bottom = container.querySelector('.player-1b__bottom') as HTMLElement;
      expect(bottom).not.toBeNull();
      fireEvent.click(within(bottom).getByRole('button', { name: 'Silenciar' }));
      const video = container.querySelector('video') as HTMLVideoElement;
      expect(video.muted).toBe(true);
      const slider = within(bottom).getByRole('slider', { name: 'Volumen' });
      fireEvent.change(slider, { target: { value: '0.4' } });
      expect(video.volume).toBeCloseTo(0.4);
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('controles del móvil en vertical (ficha B): pausa, silencio, minimizar y la fuente; −30 s en el menú; y la línea de estado', async () => {
    // Sin matchMedia (jsdom) cuenta como móvil: detener va en «Más opciones», como en la maqueta.
    const { handlers, container } = renderDock();
    setPlayer(playing());
    expect(statusStore.get().base).toEqual({
      text: 'Fuente 1 verificada. Vas en directo.',
      signal: 'ok',
    });
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Detener' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar el reproductor' }));
    expect(handlers.onMinimize).toHaveBeenCalled();
    // La píldora de la fuente abre el panel de fuentes.
    expect(screen.getByRole('button', { name: /Ver todas las fuentes/ })).toBeInTheDocument();
    // −30 s ya no va sobre el vídeo: está en «Más opciones».
    expect(screen.queryByRole('button', { name: 'Retroceder 30 segundos' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    const menu = await screen.findByRole('menu', { name: 'Opciones del reproductor' });
    expect(within(menu).getByRole('menuitem', { name: /Retroceder 30 s/ })).toBeEnabled();
    fireEvent.keyDown(menu, { key: 'Escape' });
    // Silencio: solo el altavoz; silenciado, «Silenciado» con su palabra.
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    const muted = await screen.findByRole('button', { name: 'Activar sonido' });
    expect(muted).toHaveTextContent('Silenciado');
  });

  it('ratón: controles que se esconden a los 2,5 s solo si suena, clic que pausa a los 190 ms y doble clic a pantalla completa (B-102, B-088)', async () => {
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
      // Sonando de verdad: a los 2,5 s sin mover el ratón, fuera.
      setPlayer(playing());
      act(() => vi.advanceTimersByTime(2_400));
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

  /** Escritorio con pantalla completa anunciada; `requestFullscreen` hace lo que diga la prueba. */
  async function withDesktopFullscreen(
    requestFullscreen: () => Promise<void>,
    body: () => Promise<void> | void,
  ) {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: /min-width|pointer: fine/.test(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      await body();
    } finally {
      vi.useRealTimers();
      window.matchMedia = realMatchMedia;
      Reflect.deleteProperty(document, 'fullscreenEnabled');
      Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    }
  }

  /** En el modo teatro de reserva, los botones «full» dicen cómo salir y Esc sale. */
  function expectTheaterFallbackThenEscape() {
    expect(playerPresence.get().immersive).toBe(true);
    const exits = screen.getAllByRole('button', { name: 'Salir del modo teatro' });
    expect(exits.length).toBeGreaterThan(0);
    for (const button of exits) expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Pantalla completa' })).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(playerPresence.get().immersive).toBe(false);
    for (const button of screen.getAllByRole('button', { name: 'Pantalla completa' }))
      expect(button).toHaveAttribute('aria-pressed', 'false');
  }

  it('pantalla completa que el navegador no contesta nunca: a los 1,5 s, el modo teatro (y Esc sale)', async () => {
    const requestFullscreen = vi.fn(() => new Promise<void>(() => {}));
    await withDesktopFullscreen(requestFullscreen, () => {
      renderDock();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      setPlayer(playing());
      fireEvent.click(screen.getAllByRole('button', { name: 'Pantalla completa' })[0]!);
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(1_400));
      expect(playerPresence.get().immersive).toBe(false);
      act(() => vi.advanceTimersByTime(200));
      expectTheaterFallbackThenEscape();
    });
  });

  it('pantalla completa que falla (iframe sin allowfullscreen): el modo teatro, que se deja con Esc', async () => {
    const requestFullscreen = vi.fn(() => Promise.reject(new TypeError('no permitido')));
    await withDesktopFullscreen(requestFullscreen, async () => {
      renderDock();
      setPlayer(playing());
      fireEvent.click(screen.getAllByRole('button', { name: 'Pantalla completa' })[0]!);
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(playerPresence.get().immersive).toBe(true));
      expectTheaterFallbackThenEscape();
    });
  });

  it('controles: el foco que deja un clic no los retiene (pantalla completa), el del teclado sí', () => {
    const { container } = renderDock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const chrome = container.querySelector<HTMLElement>('.player-chrome')!;
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      setPlayer(playing());
      // Clic con el ratón en un control: el botón se queda con el foco.
      const mute = screen.getByRole('button', { name: 'Silenciar' });
      fireEvent.pointerDown(mute, { pointerType: 'mouse', button: 0 });
      act(() => mute.focus());
      fireEvent.click(mute);
      expect(mute).toHaveFocus();
      act(() => vi.advanceTimersByTime(2_600));
      expect(chrome).toHaveAttribute('data-visible', 'false');
      // El cursor se va con ellos.
      expect(hit).toHaveAttribute('data-chrome', 'hidden');

      // Con el teclado (Tab) dentro, no se esconden: el foco se vería desaparecer.
      act(() => mute.blur());
      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => mute.focus());
      expect(chrome).toHaveAttribute('data-visible', 'true');
      act(() => vi.advanceTimersByTime(10_000));
      expect(chrome).toHaveAttribute('data-visible', 'true');
      // Sale el foco de los controles: vuelve la cuenta normal.
      act(() => mute.blur());
      act(() => vi.advanceTimersByTime(2_600));
      expect(chrome).toHaveAttribute('data-visible', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('controles: los «mousemove» sin moverse no los retienen y al sacar el ratón se van al momento', () => {
    const { container } = renderDock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const chrome = container.querySelector<HTMLElement>('.player-chrome')!;
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      const frame = container.querySelector<HTMLElement>('.player-frame')!;
      setPlayer(playing());
      fireEvent.pointerMove(hit, { pointerType: 'mouse', screenX: 300, screenY: 200 });
      // Chrome repite el último «mousemove» al repintar lo que hay bajo el
      // cursor (el medidor del directo cada 500 ms): no es actividad.
      for (let i = 0; i < 6; i += 1) {
        act(() => vi.advanceTimersByTime(500));
        setPlayer({ live: { available: true, atLive: true, behindS: 1 + (i % 2), delayS: 7 + i } });
        fireEvent.pointerMove(hit, { pointerType: 'mouse', screenX: 300, screenY: 200 });
      }
      expect(chrome).toHaveAttribute('data-visible', 'false');
      // Un movimiento de verdad, sí.
      fireEvent.pointerMove(hit, { pointerType: 'mouse', screenX: 310, screenY: 205 });
      expect(chrome).toHaveAttribute('data-visible', 'true');
      // Fuera del vídeo: al momento.
      fireEvent.pointerLeave(frame, { pointerType: 'mouse' });
      expect(chrome).toHaveAttribute('data-visible', 'false');

      // En pausa, ni al salir.
      fireEvent.pointerMove(hit, { pointerType: 'mouse', screenX: 320, screenY: 210 });
      setPlayer({ phase: 'pausado', desiredPlaying: false });
      fireEvent.pointerLeave(frame, { pointerType: 'mouse' });
      act(() => vi.advanceTimersByTime(10_000));
      expect(chrome).toHaveAttribute('data-visible', 'true');

      // Un parón corto con imagen (colchón) no los saca ni reinicia la cuenta.
      setPlayer({ phase: 'reproduciendo', desiredPlaying: true });
      act(() => vi.advanceTimersByTime(1_500));
      setPlayer({ phase: 'buffer' });
      act(() => vi.advanceTimersByTime(500));
      setPlayer({ phase: 'reproduciendo' });
      act(() => vi.advanceTimersByTime(600));
      expect(chrome).toHaveAttribute('data-visible', 'false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('controles: con «Más opciones» abierto no se esconden (ni al sacar el ratón)', () => {
    const { container } = renderDock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const chrome = container.querySelector<HTMLElement>('.player-chrome')!;
      const frame = container.querySelector<HTMLElement>('.player-frame')!;
      setPlayer(playing());
      fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
      fireEvent.pointerLeave(frame, { pointerType: 'mouse' });
      act(() => vi.advanceTimersByTime(10_000));
      expect(chrome).toHaveAttribute('data-visible', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('dedo: un toque los enseña o los esconde y se van solos a los 3 s', () => {
    const { container } = renderDock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const chrome = container.querySelector<HTMLElement>('.player-chrome')!;
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      setPlayer(playing());
      const tap = () => {
        fireEvent.pointerDown(hit, { pointerType: 'touch' });
        fireEvent.pointerUp(hit, { pointerType: 'touch' });
        fireEvent.click(hit);
      };
      tap();
      expect(chrome).toHaveAttribute('data-visible', 'false');
      tap();
      expect(chrome).toHaveAttribute('data-visible', 'true');
      act(() => vi.advanceTimersByTime(2_900));
      expect(chrome).toHaveAttribute('data-visible', 'true');
      act(() => vi.advanceTimersByTime(200));
      expect(chrome).toHaveAttribute('data-visible', 'false');
    } finally {
      vi.useRealTimers();
    }
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

  it('la estrella sabe si el canal está en favoritos (en el móvil, en «Más opciones»)', async () => {
    renderDock();
    setPlayer(playing());
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }));
    const menu = await screen.findByRole('menu', { name: 'Opciones del reproductor' });
    // La biblioteca llega por la red: el menú se rehace al tenerla.
    expect(
      await within(menu).findByRole('menuitem', { name: /Quitar de favoritos/ }),
    ).toBeInTheDocument();
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

  describe('cambiar de canal rápido entre favoritos (↑ ↓, Re Pág / Av Pág, deslizar)', () => {
    const FAVS = [
      { id: HASH, title: 'DAZN 1' },
      { id: 'b'.repeat(40), title: 'DAZN 2' },
      { id: 'c'.repeat(40), title: 'M+ LaLiga' },
      { id: 'd'.repeat(40), title: 'Eurosport 1' },
    ];
    function withFavorites() {
      const client = createQueryClient();
      const base = fixture<{ favorites: Array<Record<string, unknown>> }>('libraryGet');
      const model = base.favorites[0]!;
      client.setQueryData(routeKey('libraryGet'), {
        ...base,
        favorites: FAVS.map((item) => ({ ...model, ...item })),
      });
      return client;
    }

    it('se registran en la ayuda sin pisar ← → (que siguen siendo el zapping de siempre)', () => {
      renderDock('stage', undefined, withFavorites());
      const entries = shortcutStore.get();
      const prev = entries.find((entry) => entry.id === 'reproductor.favorito-anterior');
      const next = entries.find((entry) => entry.id === 'reproductor.favorito-siguiente');
      expect(prev?.keys).toEqual(['ArrowUp', 'PageUp']);
      expect(next?.keys).toEqual(['ArrowDown', 'PageDown']);
      expect(entries.find((entry) => entry.id === 'reproductor.siguiente')?.keys).toEqual([
        'ArrowRight',
      ]);
    });

    it('tres ↓ rápidos: el cartel pasa por ellos y solo se abre el tercero', () => {
      renderDock('stage', undefined, withFavorites());
      setPlayer(playing());
      // El armazón marca que se está viendo: los avisos de señal van a la línea de estado.
      setWatching(true);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'PageDown' });
      const banner = document.querySelector('.player-zap');
      expect(banner).toHaveTextContent('Eurosport 1');
      expect(banner).toHaveTextContent('4/4');
      expect(banner).toHaveTextContent('AceStream');
      // Aún no se ha abierto nada: sigue sonando el de antes.
      expect(playerStore.get().channel?.hash).toBe(HASH);
      act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
      expect(playerStore.get().channel?.hash).toBe('d'.repeat(40));
      expect(location.search).toContain(`canal/${'d'.repeat(40)}`);
      // Se anuncia en la región viva de la línea de estado.
      expect(statusStore.get().message?.text).toBe('Favorito 4 de 4: Eurosport 1');
      setWatching(false);
    });

    it('↑ desde el primero da la vuelta al último; con el foco en un campo, no hace nada', () => {
      renderDock('stage', undefined, withFavorites());
      setPlayer(playing());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(document.querySelector('.player-zap')).toBeNull();
      input.blur();
      input.remove();
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
      expect(playerStore.get().channel?.hash).toBe('d'.repeat(40));
    });

    /** Un dedo sobre la capa del vídeo (o sobre `target`) de (200, 300) a (200 + dx, 300 + dy). */
    function swipeOn(target: Element, dx: number, dy: number) {
      const finger = { pointerId: 4, pointerType: 'touch' };
      fireEvent.pointerDown(target, { ...finger, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(target, { ...finger, clientX: 200 + dx / 2, clientY: 300 + dy / 2 });
      fireEvent.pointerUp(target, { ...finger, clientX: 200 + dx, clientY: 300 + dy });
    }

    it('con el dedo (móvil en vertical): a la izquierda el siguiente, a la derecha el anterior; abajo sigue minimizando y arriba no hace nada', () => {
      const { container, handlers } = renderDock('stage', undefined, withFavorites());
      setPlayer(playing());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      swipeOn(hit, -120, 0);
      expect(document.querySelector('.player-zap')).toHaveTextContent('DAZN 2');
      expect(document.querySelector('.player-zap')).toHaveTextContent('2/4');
      expect(handlers.onMinimize).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
      expect(playerStore.get().channel?.hash).toBe('b'.repeat(40));
      // A la derecha, el anterior (vuelve a DAZN 1).
      swipeOn(hit, 120, 10);
      expect(document.querySelector('.player-zap')).toHaveTextContent('DAZN 1');
      expect(document.querySelector('.player-zap')).toHaveTextContent('1/4');
      act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
      expect(playerStore.get().channel?.hash).toBe(HASH);
      act(() => zapBannerStore.set(null));
      // Hacia arriba: nada nuevo.
      swipeOn(hit, 0, -120);
      expect(document.querySelector('.player-zap')).toBeNull();
      expect(handlers.onMinimize).not.toHaveBeenCalled();
      // Hacia abajo: solo minimiza.
      swipeOn(hit, 0, 120);
      expect(handlers.onMinimize).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.player-zap')).toBeNull();
    });

    it('un toque, un arrastre leve, uno en diagonal o uno que empieza en un control no cambian de canal', () => {
      const { container, handlers } = renderDock('stage', undefined, withFavorites());
      setPlayer(playing());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const hit = container.querySelector<HTMLElement>('.player-hit')!;
      swipeOn(hit, 0, 0);
      swipeOn(hit, -20, 0);
      swipeOn(hit, -80, 70);
      // La barra de controles es hermana de la capa del vídeo: un gesto que
      // empieza en el volumen o en un botón nunca llega a ella.
      const control = container.querySelector<HTMLElement>('.player-chrome button')!;
      expect(control).not.toBeNull();
      swipeOn(control, -150, 0);
      act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
      expect(document.querySelector('.player-zap')).toBeNull();
      expect(playerStore.get().channel?.hash).toBe(HASH);
      expect(handlers.onMinimize).not.toHaveBeenCalled();
    });

    it('en la tableta también a los lados; abajo no hace nada y el scroll vertical de la página sigue (pan-y)', () => {
      const realMatchMedia = window.matchMedia;
      window.matchMedia = ((query: string) =>
        ({
          matches: query === '(min-width: 768px)',
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList) as typeof window.matchMedia;
      try {
        const { container, handlers } = renderDock('stage', undefined, withFavorites());
        setPlayer(playing());
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const hit = container.querySelector<HTMLElement>('.player-hit')!;
        expect(hit.style.touchAction).toBe('pan-y');
        swipeOn(hit, 0, 120);
        swipeOn(hit, 0, -120);
        expect(document.querySelector('.player-zap')).toBeNull();
        expect(handlers.onMinimize).not.toHaveBeenCalled();
        swipeOn(hit, 120, 0);
        expect(document.querySelector('.player-zap')).toHaveTextContent('Eurosport 1');
        expect(document.querySelector('.player-zap')).toHaveTextContent('4/4');
        act(() => vi.advanceTimersByTime(ZAP_COMMIT_MS));
        expect(playerStore.get().channel?.hash).toBe('d'.repeat(40));
      } finally {
        window.matchMedia = realMatchMedia;
      }
    });
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
  it('en silencio (la vista previa del partido) dice «En silencio» y no anima el ecualizador', () => {
    renderDock('mini');
    setPlayer(playing({ muted: true }));
    expect(screen.queryByText('Sonando')).toBeNull();
    const kicker = document.querySelector('.player-mini__kicker')!;
    expect(kicker).toHaveTextContent('En silencio');
    expect(kicker.querySelector('.player-eq')).toHaveAttribute('data-playing', 'false');
  });

  it('canal, segunda línea sin marcador, pausa y detener; tocarlo vuelve al vídeo', () => {
    const { handlers } = renderDock('mini');
    setPlayer(playing());
    expect(screen.getByText('Sonando')).toBeInTheDocument();
    // La banda (móvil y tableta) y la tarjeta del menú lateral (desde 1024; el CSS elige).
    expect(document.querySelector('.player-mini__title')).toHaveTextContent('M+ Liga de Campeones');
    expect(document.querySelector('.player-mini__side-title')).toHaveTextContent(
      'M+ Liga de Campeones',
    );
    expect(screen.getByText('Fuente 1, Elcano')).toBeInTheDocument();
    // Un canal en directo: la cápsula «Directo» sobre la imagen y la línea llena.
    expect(document.querySelector('.player-mini__cap')).toHaveTextContent('Directo');
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
    // La tarjeta del menú lateral dice el minuto (no es un spoiler) y su línea va al 80 %.
    expect(document.querySelector('.player-mini__side-sub')).toHaveTextContent("72'");
    expect(
      document.querySelector<HTMLElement>('.player-mini__line')?.style.getPropertyValue('--v'),
    ).toBe(String(72 / 90));
    act(() => revealScore('m-1'));
    expect(document.querySelector('.player-mini__sub')).toHaveTextContent("72'");
    expect(screen.queryByText(/2.1/)).toBeNull();
  });

  it('el nombre del botón sale de lo que se ve: el partido y la segunda línea o el estado (WCAG 2.5.3)', () => {
    renderDock('mini');
    const event = { hash: HASH, title: 'DAZN', event: 'FC Barcelona – Juventus' };
    setPlayer(playing({ channel: event, phase: 'cargando' }));
    expect(
      screen.getByRole('button', { name: 'Volver al vídeo: FC Barcelona – Juventus, Conectando…' }),
    ).toBeInTheDocument();
    setPlayer(playing({ channel: event }));
    expect(
      screen.getByRole('button', { name: 'Volver al vídeo: FC Barcelona – Juventus, DAZN' }),
    ).toBeInTheDocument();
  });

  it('abierto por el hash con el nombre provisional: con la biblioteca, el mini y la píldora dicen «DAZN 1»', () => {
    const client = createQueryClient();
    // La biblioteca (ya en la caché) tiene el hash como «DAZN 1».
    const library = fixture<{ web: Array<{ id: string; title: string }> }>('libraryGet');
    expect(library.web.find((item) => item.id === HASH)?.title).toBe('DAZN 1');
    client.setQueryData(routeKey('libraryGet'), library);
    renderDock('mini', undefined, client);
    // El reproductor arrancó con el nombre provisional (player/api.ts) y no lo cambia.
    setPlayer(playing({ channel: { hash: HASH, title: `Canal ${HASH.slice(0, 8)}` } }));
    expect(playerStore.get().channel?.title).toBe('Canal a1b2c3d4');
    expect(document.querySelector('.player-mini__title')).toHaveTextContent('DAZN 1');
    expect(document.querySelector('.player-mini__side-title')).toHaveTextContent('DAZN 1');
    expect(screen.getByRole('button', { name: /^Volver al vídeo: DAZN 1/ })).toBeInTheDocument();
    expect(screen.queryByText(/Canal a1b2c3d4/)).toBeNull();
  });

  it('en grande, la píldora de la fuente también dice «DAZN 1» y, girado sin partido, no repite el canal', () => {
    const client = createQueryClient();
    client.setQueryData(routeKey('libraryGet'), fixture('libraryGet'));
    const channel = {
      hash: HASH,
      title: `Canal ${HASH.slice(0, 8)}`,
      subtitle: 'Fuente 2, Elcano',
    };
    const first = renderDock('stage', undefined, client);
    setPlayer(playing({ channel }));
    const pill = screen.getByRole('button', { name: /^Suena DAZN 1, fuente 2/ });
    expect(pill).toHaveTextContent('DAZN 1 · F2');
    // En vertical (ficha B) no hay titular al lado: la píldora lo dice todo.
    expect(pill).not.toHaveAttribute('data-dup');
    first.unmount();

    // Girado (inmersivo): al lado va el titular «DAZN 1»; player.css deja «F2».
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: /orientation: landscape/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = renderDock('stage', undefined, client);
      setPlayer(playing({ channel }));
      expect(container.querySelector('.player')).toHaveAttribute('data-immersive', 'true');
      const turned = screen.getByRole('button', { name: /^Suena DAZN 1, fuente 2/ });
      expect(turned).toHaveAttribute('data-dup', 'true');
      expect(container.querySelector('.player-1b__title')).toHaveTextContent('DAZN 1');
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('sin nombre en la biblioteca, se queda el del hash', () => {
    renderDock('mini');
    const other = 'f'.repeat(40);
    setPlayer(playing({ channel: { hash: other, title: `Canal ${other.slice(0, 8)}` } }));
    expect(document.querySelector('.player-mini__title')).toHaveTextContent('Canal ffffffff');
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
