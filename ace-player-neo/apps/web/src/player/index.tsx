/* El reproductor persistente (PlayerDock): UN componente que el armazón monta
   en UN sitio (src/app/Shell.tsx) y que cambia de presentación sin recrear
   el <video>: «stage» en el centro de partido y «mini» («Sonando») fuera de
   él. Lo carga el armazón con React.lazy, así que nada de esto (ni hls.js ni
   mpegts.js, que además van con import() al reproducir) está en el JS
   inicial.

   Aquí se juntan: el orquestador (runtime.ts) atado al <video>, las acciones
   (con sus avisos y su toque háptico, HAPTIC_MAP), los atajos del registro
   central, la Media Session, la pantalla completa, el modo teatro y el PiP,
   el estado base de la cápsula de estado y la presencia para el armazón. La
   API para las vistas está en api.ts (y se reexporta abajo). Documentación:
   src/player/README.md.

   Palco (plan fase 2, W5, W7 y W14): el mismo <video> se ve en grande o a
   96×54 en el mini (solo cambia el CSS), el modo teatro es el mismo
   `data-immersive` que la pantalla completa y, al cambiar de fuente, un velo
   negro tapa medio segundo la imagen como un cambio de canal de verdad. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { api } from '../api/client.ts';
import { routeKey, queryClient, useApiQuery } from '../api/query.ts';
import type { PlayerDockProps } from '../app/contracts.ts';
import { setPlayerPresence } from '../app/player-presence.ts';
import { useNavigate } from '../app/router.tsx';
import { useShortcut } from '../app/shortcuts.ts';
import { cx } from '../lib/cx.ts';
import { haptic } from '../lib/haptics.ts';
import { MEDIA, useLayoutKind, useMediaQuery } from '../lib/media.ts';
import { notify } from '../notices/notify.ts';
import { setStatusBase } from '../notices/statusLine.ts';
import { toast } from '../notices/toasts.ts';
import type { MenuItem } from '../ui/Menu.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import {
  connectRuntime,
  INITIAL_PLAYER_STATE,
  kindFromIh,
  play,
  playerStore,
  setNerdOpen,
  stop,
  toggleNerd,
  useNerdHosted,
  usePlayer,
  type PlayChannel,
  type PlayerState,
} from './api.ts';
import { acestreamLink, copyText, externalStreamUrl, openExternal } from './clipboard.ts';
import { PlayerContext, type PlayerActions, type PlayerContextValue } from './context.ts';
import { useMediaSession } from './media-session.ts';
import { MiniPlayer } from './MiniPlayer.tsx';
import { PlayerNerdStats } from './NerdPanel.tsx';
import { PlayerSurface } from './PlayerSurface.tsx';
import { PlayerRuntime } from './runtime.ts';
import {
  canFullscreen,
  canPictureInPicture,
  toggleFullscreen,
  togglePictureInPicture,
  useScreenModes,
  type VideoWithExtras,
} from './screen.ts';
import { statusFor } from './status.ts';
import { zappingList, zapTarget, type ZapItem } from './zapping.ts';
import './player.css';

export * from './api.ts';
export { PlayerSurface } from './PlayerSurface.tsx';
export { MiniPlayer } from './MiniPlayer.tsx';
export { NerdPanel, PlayerNerdStats } from './NerdPanel.tsx';

// ---- Un orquestador por <video> ----------------------------------------------------
/* En desarrollo, StrictMode monta, desmonta y vuelve a montar los efectos. Si
   el desmontaje destruyera el orquestador, se perdería la reproducción que
   la vista acaba de pedir. Por eso se destruye en diferido y el re-montaje
   inmediato lo recupera. */

const shared: {
  runtime: PlayerRuntime | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
} = {
  runtime: null,
  destroyTimer: null,
};

function usePlayerRuntime(videoRef: RefObject<HTMLVideoElement | null>): PlayerRuntime | null {
  const [runtime, setRuntime] = useState<PlayerRuntime | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shared.destroyTimer) clearTimeout(shared.destroyTimer);
    shared.destroyTimer = null;
    let current = shared.runtime;
    if (!current || current.video !== video) {
      current?.destroy();
      current = new PlayerRuntime({ video });
      shared.runtime = current;
    }
    const disconnect = connectRuntime(current);
    setRuntime(current);
    const mine = current;
    return () => {
      disconnect();
      shared.destroyTimer = setTimeout(() => {
        shared.destroyTimer = null;
        if (shared.runtime !== mine) return;
        mine.destroy();
        shared.runtime = null;
        playerStore.set((state) => ({
          ...INITIAL_PLAYER_STATE,
          muted: state.muted,
          volume: state.volume,
          waiting: state.waiting,
        }));
      }, 0);
    };
  }, [videoRef]);
  return runtime;
}

/** B-088: un único reproductor visible; si alguien le pone `controls` al vídeo, se quita. */
function useNoNativeControls(videoRef: RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof MutationObserver === 'undefined') return;
    video.controls = false;
    const observer = new MutationObserver(() => {
      if (video.hasAttribute('controls')) video.removeAttribute('controls');
    });
    observer.observe(video, { attributes: true, attributeFilter: ['controls'] });
    return () => observer.disconnect();
  }, [videoRef]);
}

/** ¿El foco está en algo que usa ← → por sí mismo? (regla 9: no se zapea). */
function arrowsBusy(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return Boolean(
    active.closest(
      'input, select, textarea, [contenteditable="true"], [role="slider"], [role="tab"], [role="tablist"], [role="radio"], [role="radiogroup"], [role="option"], [role="listbox"], [role="menu"], [role="menuitem"], [role="spinbutton"], .player-chrome',
    ),
  );
}

// ---- Imagen de la demo ---------------------------------------------------------

/** Un campo de fútbol dibujado: la «señal» de la demo (inventario §22), sin peso. */
function DemoPicture() {
  return (
    <svg
      className="player-demo-picture"
      viewBox="0 0 160 90"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="demo-cesped" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f6b3a" />
          <stop offset="1" stopColor="#0f4424" />
        </linearGradient>
        <pattern id="demo-franjas" width="20" height="90" patternUnits="userSpaceOnUse">
          <rect width="10" height="90" fill="#ffffff" opacity="0.045" />
        </pattern>
      </defs>
      <rect width="160" height="90" fill="url(#demo-cesped)" />
      <rect width="160" height="90" fill="url(#demo-franjas)" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="0.6">
        <rect x="8" y="8" width="144" height="74" />
        <line x1="80" y1="8" x2="80" y2="82" />
        <circle cx="80" cy="45" r="11" />
        <rect x="8" y="25" width="20" height="40" />
        <rect x="132" y="25" width="20" height="40" />
      </g>
      <circle cx="80" cy="45" r="0.9" fill="#ffffff" />
    </svg>
  );
}

// ---- El dock ---------------------------------------------------------------------

export default function PlayerDock({ presentation, route, onMinimize, onExpand }: PlayerDockProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const runtime = usePlayerRuntime(videoRef);
  const state = usePlayer();
  const navigate = useNavigate();
  const layoutKind = useLayoutKind();
  const finePointer = useMediaQuery(MEDIA.finePointer);
  const phoneLandscape = useMediaQuery(MEDIA.phoneLandscape);
  const { fullscreen, pip } = useScreenModes(videoRef);
  const [abilities, setAbilities] = useState({ fullscreen: false, pip: false });
  const lastChannel = useRef<{ channel: PlayChannel; state: PlayerState } | null>(null);
  const nerdHosted = useNerdHosted();
  const stage = presentation === 'stage';
  const compact = layoutKind === 'mobile';
  /* Modo teatro (escritorio sin pantalla completa): solo en grande y con algo
     que ver; al detener o salir del partido se quita solo. */
  const [theaterWanted, setTheaterWanted] = useState(false);
  const theater = theaterWanted && stage && state.channel !== null;
  if (theaterWanted && (!stage || !state.channel)) setTheaterWanted(false);
  const immersive = fullscreen || theater || (stage && phoneLandscape);

  /* Corte a negro (W14): al pasar de una fuente a otra, un velo negro tapa la
     imagen medio segundo, como un cambio de canal de verdad. Se cuenta al
     pintar (no en un efecto) para que el velo salga en el mismo fotograma. */
  const hash = state.channel?.hash ?? null;
  const [cut, setCut] = useState({ hash, n: 0 });
  if (cut.hash !== hash) setCut({ hash, n: cut.hash && hash ? cut.n + 1 : cut.n });

  useNoNativeControls(videoRef);

  // El mini-reproductor vuelve a donde se estaba viendo (también tras zapear).
  const routeKeyText = route.vista === 'partido' ? `${route.id ?? ''}/${route.canal ?? ''}` : '';
  useEffect(() => {
    if (!stage || route.vista !== 'partido' || !playerStore.get().channel) return;
    setPlayerPresence({ route });
    playerStore.set((current) => ({ ...current, route }));
    // Solo cuando cambia la ruta del partido (su identidad cambia en cada render).
  }, [stage, routeKeyText]);

  useEffect(() => {
    const video = videoRef.current as VideoWithExtras | null;
    setAbilities({ fullscreen: canFullscreen(video), pip: canPictureInPicture(video) });
  }, []);

  if (state.channel) lastChannel.current = { channel: state.channel, state };

  // Pantalla completa o modo teatro = inmersivo para el armazón (sin toasts ni navegación encima).
  useEffect(() => {
    setPlayerPresence({ immersive: fullscreen || theater });
  }, [fullscreen, theater]);

  // Salir del centro de partido con la pantalla completa puesta: se quita.
  useEffect(() => {
    if (!stage && fullscreen) void toggleFullscreen(videoRef.current as VideoWithExtras | null);
  }, [stage, fullscreen]);

  // Línea de estado bajo el vídeo: el estado base lo pone el reproductor (solo en grande).
  const status = stage ? statusFor(state) : null;
  const statusKey = status ? JSON.stringify(status) : '';
  useEffect(() => {
    if (!stage) return;
    setStatusBase(status);
    // `status` cambia de identidad en cada render; manda su contenido.
  }, [stage, statusKey]);

  // Biblioteca: favoritos (estrella) y la lista de zapping.
  const library = useApiQuery('libraryGet');
  const zapList = useMemo<ZapItem[]>(() => zappingList(library.data), [library.data]);
  const isFavorite = Boolean(hash && library.data?.favorites.some((item) => item.id === hash));
  const canZap = zapList.length > 1 || (zapList.length === 1 && zapList[0]?.id !== hash);

  const video = () => videoRef.current as VideoWithExtras | null;

  const zap = (direction: 1 | -1) => {
    const target = zapTarget(zapList, hash, direction);
    if (!target) return;
    haptic('rigid');
    notify(`Zapping: ${target.title}`, { kind: 'signal', icon: 'tv' });
    const next = { vista: 'partido' as const, id: null, canal: target.id };
    play(
      // Favoritos y lista declaran su tipo (B-010): sin el doble intento de `auto`.
      { hash: target.id, title: target.title, kind: kindFromIh(target.ih ?? false) },
      { origin: 'zapping', route: next },
    );
    navigate(next);
  };

  const toggleTheater = () => {
    haptic('medium');
    setTheaterWanted((on) => !on);
  };

  const actions: PlayerActions = {
    toggle: () => {
      haptic('light');
      void runtime?.toggle('user');
    },
    tapToPlay: () => void runtime?.tapToPlay(),
    stop: () => {
      haptic('rigid');
      stop();
    },
    retry: () => {
      if (playerStore.get().channel) runtime?.retry();
      else if (lastChannel.current) {
        const { channel, state: previous } = lastChannel.current;
        play(
          channel,
          previous.route ? { origin: 'user', route: previous.route } : { origin: 'user' },
        );
      }
    },
    goLive: () => void runtime?.goLive(),
    back: () => void runtime?.back(),
    toggleMute: () => {
      const el = video();
      if (!el) return;
      haptic('light');
      // Quitar el silencio con el volumen a 0 lo sube a la mitad (si no, no se oiría nada).
      if (el.muted && el.volume === 0) el.volume = 0.5;
      runtime?.setMuted(!el.muted);
    },
    setVolume: (value) => runtime?.setVolume(value),
    toggleFullscreen: () => {
      // Sin pantalla completa en este navegador, en escritorio F es el modo teatro.
      if (!abilities.fullscreen && !compact && !fullscreen && playerStore.get().channel) {
        toggleTheater();
        return;
      }
      if (theater) {
        setTheaterWanted(false);
        return;
      }
      haptic('medium');
      void toggleFullscreen(video()).then((result) => {
        if (result === 'not-ready')
          toast('La pantalla completa estará disponible cuando arranque la imagen', {
            tone: 'info',
          });
        else if (result === 'unavailable')
          toast('Este navegador no permite la pantalla completa aquí', { tone: 'warn' });
      });
    },
    toggleTheater,
    togglePip: () => {
      if (playerStore.get().demo) {
        toast('PiP necesita un vídeo real (en demo no hay señal)', { tone: 'info' });
        return;
      }
      void togglePictureInPicture(video()).then((result) => {
        if (result === 'unavailable')
          toast('PiP no disponible en este navegador', { tone: 'warn' });
        else if (result === 'not-ready' || result === 'failed')
          toast('PiP no disponible', { tone: 'warn' });
      });
    },
    toggleNerd: () => toggleNerd(),
    toggleFavorite: () => {
      const current = playerStore.get().channel;
      if (!current) return;
      const saved = Boolean(library.data?.favorites.some((item) => item.id === current.hash));
      const body = saved
        ? ({ action: 'delete', collection: 'favorites', id: current.hash } as const)
        : ({
            action: 'favorite-upsert',
            item: { id: current.hash, title: current.title, ih: current.kind === 'infohash' },
          } as const);
      void api('libraryMutate', { body })
        .then((view) => {
          queryClient.setQueryData(routeKey('libraryGet'), view);
          if (!saved) haptic('success');
          toast(
            saved
              ? `«${current.title}» quitado de favoritos`
              : `«${current.title}» guardado en favoritos`,
            {
              tone: saved ? 'warn' : 'ok',
              icon: saved ? 'star' : 'star-f',
            },
          );
        })
        .catch(() =>
          toast(saved ? 'No se pudo quitar el favorito' : 'No se pudo guardar el favorito', {
            tone: 'err',
          }),
        );
    },
    zap,
    minimize: () => {
      haptic('light');
      onMinimize();
    },
    expand: onExpand,
  };

  const copy = (text: string, ok: string, fail: string) => {
    void copyText(text).then((done) =>
      toast(done ? ok : fail, { tone: done ? 'ok' : 'err', icon: 'copy' }),
    );
  };

  const channel = state.channel;
  const wantsPlay = state.desiredPlaying || state.phase === 'buffer';
  const allMenuItems: MenuItem[] = channel
    ? [
        {
          id: 'pausa',
          label: wantsPlay ? 'Pausar' : 'Reproducir',
          icon: wantsPlay ? 'pause' : 'play',
          shortcut: 'K',
          onSelect: actions.toggle,
        },
        {
          id: 'atras',
          label: 'Retroceder 30 s',
          icon: 'back',
          shortcut: 'J',
          disabled: !(state.conn === 'activa' && state.started) || state.demo,
          onSelect: actions.back,
        },
        { id: 'directo', label: 'Ir al directo', icon: 'directo', onSelect: actions.goLive },
        { id: 'detener', label: 'Detener', icon: 'stop', danger: true, onSelect: actions.stop },
        ...(canZap
          ? [
              {
                id: 'anterior',
                label: 'Canal anterior',
                icon: 'chev-l' as const,
                shortcut: '←',
                separated: true,
                onSelect: () => zap(-1),
              },
              {
                id: 'siguiente',
                label: 'Canal siguiente',
                icon: 'chev-r' as const,
                shortcut: '→',
                onSelect: () => zap(1),
              },
            ]
          : []),
        {
          id: 'nerd',
          label: 'Datos técnicos',
          icon: 'nerd',
          shortcut: 'S',
          checked: state.nerdOpen,
          separated: !canZap,
          onSelect: actions.toggleNerd,
        },
        {
          id: 'donde',
          label: 'Dónde se está reproduciendo',
          icon: 'tv',
          onSelect: () => navigate({ vista: 'ajustes', seccion: 'donde' }),
        },
        ...(abilities.fullscreen
          ? [
              {
                id: 'completa',
                label: 'Pantalla completa',
                icon: 'full' as const,
                shortcut: 'F',
                onSelect: actions.toggleFullscreen,
              },
            ]
          : []),
        ...(abilities.pip
          ? [
              {
                id: 'pip',
                label: 'Imagen dentro de imagen',
                icon: 'pip' as const,
                shortcut: 'P',
                onSelect: actions.togglePip,
              },
            ]
          : []),
        {
          id: 'abrir',
          label: 'Abrir en la app de AceStream',
          icon: 'externo',
          separated: true,
          onSelect: () => openExternal(acestreamLink(channel.hash)),
        },
        {
          id: 'url',
          label: 'Copiar URL del stream (VLC)',
          icon: 'link',
          onSelect: () =>
            copy(
              externalStreamUrl(channel.hash, channel.kind),
              'URL del stream copiada: pégala en VLC',
              'No se pudo copiar',
            ),
        },
        {
          id: 'enlace',
          label: 'Copiar enlace acestream://',
          icon: 'copy',
          onSelect: () =>
            copy(acestreamLink(channel.hash), 'Enlace acestream:// copiado', 'No se pudo copiar'),
        },
        {
          id: 'hash',
          label: 'Copiar hash',
          icon: 'hash',
          disabled: !/^[a-f0-9]{40}$/.test(channel.hash),
          onSelect: () => copy(channel.hash, 'Hash copiado', 'No se pudo copiar el hash'),
        },
      ]
    : [];
  // Sin teclado físico a la vista (táctil), las teclas del menú solo estorban.
  const menuItems = finePointer
    ? allMenuItems
    : allMenuItems.map(({ shortcut: _shortcut, ...item }) => item);

  useMediaSession(state, {
    play: () => void runtime?.resume('media-session'),
    pause: () => void runtime?.pause('media-session'),
    stop: () => stop(),
    back: () => void runtime?.back(),
    previous: canZap ? () => zap(-1) : null,
    next: canZap ? () => zap(1) : null,
  });

  // ---- Atajos (registro central: salen solos en la ayuda «?») ----
  const has = () => playerStore.get().channel !== null;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const group = 'Reproductor';
  useShortcut({
    id: 'reproductor.pausa',
    keys: [' ', 'k'],
    display: ['Espacio', 'K'],
    label: 'Pausa y reanuda',
    group,
    when: () => stageRef.current && has(),
    handler: actions.toggle,
  });
  useShortcut({
    id: 'reproductor.silencio',
    keys: ['m'],
    label: 'Silencia o devuelve el sonido',
    group,
    when: has,
    handler: actions.toggleMute,
  });
  useShortcut({
    id: 'reproductor.atras',
    keys: ['j'],
    label: 'Retrocede 30 s',
    group,
    when: () => stageRef.current && has(),
    handler: actions.back,
  });
  useShortcut({
    id: 'reproductor.completa',
    keys: ['f'],
    label: 'Pantalla completa',
    group,
    when: () => stageRef.current,
    handler: actions.toggleFullscreen,
  });
  useShortcut(
    {
      id: 'reproductor.teatro',
      keys: ['Escape'],
      display: ['Esc'],
      label: 'Sale del modo teatro',
      group,
      when: () => stageRef.current && theater,
      handler: () => setTheaterWanted(false),
      // Solo donde existe el modo teatro (escritorio sin pantalla completa).
    },
    !compact && !abilities.fullscreen,
  );
  useShortcut({
    id: 'reproductor.pip',
    keys: ['p'],
    label: 'Imagen dentro de imagen',
    group,
    when: has,
    handler: actions.togglePip,
  });
  useShortcut({
    id: 'reproductor.nerd',
    keys: ['s'],
    label: 'Datos técnicos',
    group,
    when: has,
    handler: actions.toggleNerd,
  });
  useShortcut({
    id: 'reproductor.favorito',
    keys: ['g'],
    label: 'Favorito del canal que suena',
    group,
    when: has,
    handler: actions.toggleFavorite,
  });
  useShortcut({
    id: 'reproductor.anterior',
    keys: ['ArrowLeft'],
    label: 'Canal anterior',
    group,
    when: () => stageRef.current && has() && canZap && !arrowsBusy(),
    handler: () => zap(-1),
  });
  useShortcut({
    id: 'reproductor.siguiente',
    keys: ['ArrowRight'],
    label: 'Canal siguiente',
    group,
    when: () => stageRef.current && has() && canZap && !arrowsBusy(),
    handler: () => zap(1),
  });

  // Desarrollo: gancho para las capturas y para probar a mano desde la consola.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const hook = {
      play,
      stop,
      get: () => playerStore.get(),
      // Solo para mirar estados a mano (capturas): pisa el estado público.
      set: (patch: Partial<PlayerState>) =>
        playerStore.set((current) => ({ ...current, ...patch })),
      runtime,
    };
    (globalThis as { __acePlayer?: typeof hook }).__acePlayer = hook;
  }, [runtime]);

  const context: PlayerContextValue = {
    runtime,
    presentation,
    actions,
    menuItems,
    fullscreen,
    theater,
    pip,
    canFullscreen: abilities.fullscreen,
    canPip: abilities.pip,
    canZap,
    isFavorite,
    finePointer,
    compact,
    immersive,
    nerdHosted,
  };

  const colors = channel?.colors;
  const style = colors ? ({ '--ta': colors[0], '--tb': colors[1] } as CSSProperties) : undefined;

  return (
    <PlayerContext value={context}>
      <section
        ref={rootRef}
        className={cx('player', state.demo && 'player--demo', !stage && 'glass glass--dense')}
        data-presentation={presentation}
        data-phase={state.phase}
        data-immersive={immersive ? 'true' : 'false'}
        data-ambient={colors ? 'true' : 'false'}
        aria-label={channel ? `Reproductor: ${channel.title}` : 'Reproductor'}
        style={style}
      >
        <div
          className="player-frame"
          onClick={stage ? undefined : onExpand}
          role={stage ? undefined : 'presentation'}
        >
          <video
            ref={videoRef}
            className="player-video"
            playsInline
            preload="auto"
            controlsList="nodownload noplaybackrate"
            x-webkit-airplay="allow"
            tabIndex={-1}
            aria-label={channel?.title ?? 'Vídeo'}
          />
          {state.engine === 'demo' && state.started ? <DemoPicture /> : null}
          {cut.n > 0 ? <span key={cut.n} className="player-cut" aria-hidden="true" /> : null}
          {stage ? <PlayerSurface /> : null}
        </div>
        {stage ? null : <MiniPlayer rootRef={rootRef} />}
        {/* Móvil en vertical sin vista que enseñe los datos: en una hoja (ver NerdPanel.tsx). */}
        {stage && compact ? (
          <Sheet
            open={state.nerdOpen && channel !== null && !immersive && !nerdHosted}
            onClose={() => setNerdOpen(false)}
            title="Datos técnicos"
            size="sm"
          >
            <PlayerNerdStats />
          </Sheet>
        ) : null}
      </section>
    </PlayerContext>
  );
}

/** Solo para los tests: el orquestador compartido. */
export function sharedRuntimeForTests(): PlayerRuntime | null {
  return shared.runtime;
}
