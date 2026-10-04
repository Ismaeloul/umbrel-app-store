/* La superficie grande del reproductor (presentación «stage»): los controles
   sobre el vídeo, el panel de espera o error, la capa «Toca para
   reproducir», el panel técnico y el menú contextual.

   Piel Palco (plan fase 2, decisiones W5 y W14): UN solo overlay
   (`player-chrome`) con cápsulas de cristal sobre un velo negro que va del
   30 al 55 %: arriba a la izquierda «Minimizar» (móvil) o el canal que suena,
   y el hueco del escenario donde el centro de partido pone la cápsula del
   marcador (stage-slot.ts); arriba a la derecha favorito · PiP · «Más
   opciones»; abajo, pausa grande, −30 s, silencio y volumen, y el directo
   con la pantalla completa (o «Modo teatro» en un escritorio sin pantalla
   completa).

   - Controles propios en todas las plataformas (el diseño los pide también
     en el móvil). En iPhone la pantalla completa es la del sistema, con sus
     controles nativos (AirPlay incluido). Un solo reproductor visible: el
     <video> nunca lleva `controls` (B-088, lo vigila index.tsx).
   - Se esconden a los 2,5 s sin mover el ratón SOLO si suena de verdad, y el
     cursor con ellos (B-102); al sacar el ratón del vídeo, al momento. Nunca
     en pausa, con un menú u hoja abiertos ni con el foco del teclado dentro.
     Con el dedo, un toque los enseña o los esconde (y se van a los 3 s).
   - Ratón: un clic pausa o reanuda (espera 190 ms para distinguirlo del
     doble clic, que pone pantalla completa); clic derecho, el menú propio.
   - Móvil: deslizar hacia abajo sobre el vídeo lo minimiza.
   - Táctil: deslizar a los lados sobre el vídeo cambia de canal rápido entre
     favoritos (favorite-zap.ts), como pasar páginas: a la izquierda el
     siguiente, a la derecha el anterior. En todos los modos (vertical,
     horizontal, pantalla completa, tableta). Solo cuenta sobre la capa del
     vídeo: lo que empieza en un control (barra, volumen, botones) no. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useEngineSummary } from '../api/hooks.ts';
import { useApiQuery } from '../api/query.ts';
import { useSwipe } from '../lib/gestures.ts';
import { useStore } from '../lib/store.ts';
import { immersiveActionStore } from '../notices/immersiveAction.ts';
import { Button, IconButton } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import { LiveDot } from '../ui/LiveRing.tsx';
import { Menu, MenuButton, useContextMenu } from '../ui/Menu.tsx';
import { Num } from '../ui/Num.tsx';
import { usePlayer, type PlayerState } from './api.ts';
import { ChannelMark } from '../ui/ChannelMark.tsx';
import {
  CLICK_DELAY_MS,
  CONTROLS_HIDE_MS,
  CONTROLS_HIDE_TOUCH_MS,
  ZAP_SWIPE_MIN_PX,
} from './constants.ts';
import { usePlayerContext, type PlayerContextValue } from './context.ts';
import { useZapBanner } from './favorite-zap.ts';
import { NerdPanel } from './NerdPanel.tsx';
import { stageSlotStore } from './stage-slot.ts';
import { liveButton, stageMessage } from './status.ts';
import { VodEndCards } from './vod/NextUp.tsx';
import { VOD_TEXT } from './vod/texts.ts';
import { VodControls } from './vod/VodControls.tsx';
import { useNavigate } from '../app/router.tsx';

/** Publica el hueco sobre el vídeo mientras existe (y lo retira al irse). */
function publishStageSlot(node: HTMLDivElement | null) {
  if (!node) return;
  stageSlotStore.set(node);
  return () => stageSlotStore.set((current) => (current === node ? null : current));
}

/**
 * En inmersivo no hay toasts: lo que pide un toque («Volver a la IPTV») va en
 * una cápsula sobre el vídeo, arriba y al centro, siempre visible aunque los
 * controles se escondan (notices/immersiveAction.ts).
 */
function ImmersivePill() {
  const action = useStore(immersiveActionStore);
  if (!action) return null;
  return (
    <div className="player-pill glass--video" key={action.id}>
      <Icon name="tv" size={18} className="player-pill__icon" />
      <span className="player-pill__text">{action.text}</span>
      <button type="button" className="player-pill__action press" onClick={action.onAction}>
        {action.label}
      </button>
    </div>
  );
}

/**
 * El cartel del cambio de canal rápido: dorsal, nombre, «3/12» y de dónde
 * sale (IPTV o AceStream). Arriba y al centro, sobre el vídeo, unos 2 s.
 * Es decorativo para los lectores de pantalla: el cambio se anuncia en la
 * línea de estado (index.tsx).
 */
export function ZapBannerView() {
  const banner = useZapBanner();
  if (!banner) return null;
  const { channel, position, total, committed } = banner;
  return (
    <div
      className="player-zap glass--video"
      data-committed={committed ? 'true' : 'false'}
      aria-hidden="true"
    >
      <ChannelMark name={channel.title} size={40} />
      <span className="player-zap__body">
        <span className="player-zap__title">{channel.title}</span>
        <span className="player-zap__meta">
          <Icon name="star-f" size={16} className="player-zap__star" />
          <span>Favorito</span>
          <Num value={`${position}/${total}`} />
          <span aria-hidden="true">·</span>
          <span>{channel.iptv ? 'IPTV' : 'AceStream'}</span>
        </span>
      </span>
    </div>
  );
}

/** Barras de «sonando» (ecualizador). Quietas con movimiento reducido. */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className="player-eq" data-playing={playing ? 'true' : 'false'} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function LiveButton({ state, onPress }: { state: PlayerState; onPress(): void }) {
  const live = liveButton(state);
  return (
    <button
      type="button"
      className="player-live press"
      data-mode={live.mode}
      aria-label={live.label}
      title={live.label}
      disabled={live.mode === 'off'}
      onClick={onPress}
    >
      {live.mode === 'behind' ? <Icon name="directo" size={18} /> : <LiveDot />}
      <span className="player-live__text">
        {live.prefix ? <span className="player-live__prefix">{live.prefix}</span> : null}
        {live.text}
      </span>
    </button>
  );
}

/** «YYYY-MM-DD» de hoy en Madrid: la agenda fecha los días con la hora de Madrid (regla 28). */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Los tres datos del panel de reposo (inventario §8.1): el motor, los canales
 * que tienes (directorio y favoritos, sin repetir) y los partidos de HOY (la
 * 0.6.59 contaba los del día elegido aunque dijera «Hoy», §29.14). Lo que aún
 * no ha llegado no se pinta (la agenda no se pide desde aquí).
 */
function IdleFacts() {
  const engine = useEngineSummary();
  const library = useApiQuery('libraryGet');
  // Solo lo que ya tenga la caché (la agenda o el centro de partido la piden):
  // pedirla desde aquí no aporta y en la demo se adelantaba a los datos de
  // muestra de la agenda, que se quedaba con la agenda corta del ejemplo.
  const schedule = useApiQuery('footballSchedule', undefined, { enabled: false });
  const facts: Array<{ key: string; label: string; value?: number; tone?: string }> = [];
  if (engine.state === 'online') facts.push({ key: 'motor', label: 'Motor listo', tone: 'ok' });
  else if (engine.state === 'offline' || engine.state === 'error')
    facts.push({ key: 'motor', label: 'Motor apagado', tone: 'fail' });
  if (library.data) {
    const ids = new Set([
      ...(library.data.web ?? []).map((item) => item.id),
      ...(library.data.favorites ?? []).map((item) => item.id),
    ]);
    facts.push({ key: 'canales', label: 'Canales', value: ids.size });
  }
  if (schedule.data) {
    const today = madridToday();
    const day = schedule.data.days.find((entry) => entry.date === today);
    facts.push({ key: 'hoy', label: 'Hoy', value: day?.matches.length ?? 0 });
  }
  if (!facts.length) return null;
  return (
    <ul className="player-facts" aria-label="Resumen">
      {facts.map((fact) => (
        <li key={fact.key} data-tone={fact.tone}>
          {fact.label}
          {fact.value !== undefined ? (
            <>
              {' '}
              <Num value={String(fact.value)} />
              {fact.key === 'hoy' ? (fact.value === 1 ? ' partido' : ' partidos') : null}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** La salida de un error con una película (§13): «Reintentar», «Volver a la ficha» (o las dos) o «Ir a Ajustes». */
function VodFailureAction({ state, ctx }: { state: PlayerState; ctx: PlayerContextValue }) {
  const navigate = useNavigate();
  const action = state.vod?.failure?.action ?? 'retry';
  if (action === 'title')
    return (
      <Button variant="video" size="sm" icon="chev-l" onClick={ctx.actions.openTitle}>
        Volver a la ficha
      </Button>
    );
  if (action === 'settings')
    return (
      <Button
        variant="video"
        size="sm"
        icon="ajustes"
        onClick={() => navigate({ vista: 'ajustes', seccion: 'iptv' })}
      >
        Ir a Ajustes
      </Button>
    );
  const retry = (
    <Button variant="video" size="sm" icon="refresh" onClick={ctx.actions.retry}>
      Reintentar
    </Button>
  );
  if (action === 'retry-title')
    return (
      <div className="player-msg__actions">
        {retry}
        <Button variant="video" size="sm" icon="chev-l" onClick={ctx.actions.openTitle}>
          Volver a la ficha
        </Button>
      </div>
    );
  return retry;
}

function StageMessage({ state, ctx }: { state: PlayerState; ctx: PlayerContextValue }) {
  const message = stageMessage(state);
  if (!message) return null;
  if (state.kind === 'vod')
    return (
      <div className="player-msg" data-tone={message.tone} role="status">
        <span className="player-msg__mark" aria-hidden="true">
          {message.tone === 'busy' ? (
            <span className="player-msg__pulse" />
          ) : (
            <Icon name={message.tone === 'error' ? 'aviso' : 'cine'} size={28} />
          )}
        </span>
        <p className="player-msg__title">{message.title}</p>
        {message.text ? <p className="player-msg__text">{message.text}</p> : null}
        {state.phase === 'error' ? <VodFailureAction state={state} ctx={ctx} /> : null}
      </div>
    );
  const showRetry = state.phase === 'error' && state.idleReason !== 'sin-motor';
  const showHere = state.phase === 'idle' && state.idleReason === 'traspasado';
  const showFacts = state.phase === 'idle' && !state.waiting && !showHere;
  return (
    <div className="player-msg" data-tone={message.tone} role="status">
      <span className="player-msg__mark" aria-hidden="true">
        {message.tone === 'busy' ? (
          <span className="player-msg__pulse" />
        ) : (
          <Icon name={message.tone === 'error' ? 'aviso' : 'tv'} size={28} />
        )}
      </span>
      <p className="player-msg__title">{message.title}</p>
      {message.text ? <p className="player-msg__text">{message.text}</p> : null}
      {showFacts ? <IdleFacts /> : null}
      {showRetry || showHere ? (
        <Button
          variant="video"
          size="sm"
          icon={showHere ? 'play' : 'refresh'}
          onClick={ctx.actions.retry}
        >
          {showHere ? 'Reproducir aquí' : 'Reintentar'}
        </Button>
      ) : null}
    </div>
  );
}

function Surface({ ctx }: { ctx: PlayerContextValue }) {
  const state = usePlayer();
  const { actions } = ctx;
  const playing = state.phase === 'reproduciendo';
  const hasChannel = state.channel !== null;
  /** Una película o un episodio (docs/vod.md §12.7): su barra de tiempo en vez del directo. */
  const vod = state.kind === 'vod';
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const lastPointer = useRef<string>('mouse');
  /** Última posición del ratón en pantalla: para no tomar por movimiento los «mousemove» fantasma. */
  const lastMove = useRef<{ x: number; y: number } | null>(null);
  /** Lo último que se usó: el teclado o un puntero (para saber cómo llegó el foco). */
  const lastInput = useRef<'keyboard' | 'pointer'>('pointer');
  /** El foco está en los controles porque se llegó con el teclado (Tab), no con un clic. */
  const keyboardFocus = useRef(false);
  const chromeRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const contextMenu = useContextMenu();

  // Se esconden mientras suena y también si, con imagen, rellena el colchón o
  // salta: un parón corto de la red no debe sacarlos (ni reiniciar la cuenta).
  const autoHide =
    playing ||
    (state.started &&
      state.conn === 'activa' &&
      (state.phase === 'buffer' || state.phase === 'buscando'));

  const clearHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  /**
   * Algo que obliga a dejarlos a la vista: un menú («Más opciones» o el
   * contextual) o una hoja abiertos, o el foco del TECLADO dentro (se vería
   * desaparecer). El foco que deja un clic no cuenta: tras pulsar «Pantalla
   * completa» el botón se queda con el foco y, con la regla de antes
   * (cualquier foco dentro), los controles no se iban nunca.
   */
  const held = useCallback((): boolean => {
    const node = chromeRef.current;
    if (!node) return false;
    if (node.querySelector('[aria-expanded="true"]')) return true;
    if (document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')) return true;
    return keyboardFocus.current && node.contains(document.activeElement);
  }, []);

  const schedule = useCallback(() => {
    clearHide();
    if (!autoHide) return;
    const delay = lastPointer.current === 'mouse' ? CONTROLS_HIDE_MS : CONTROLS_HIDE_TOUCH_MS;
    const arm = () => {
      hideTimer.current = window.setTimeout(() => {
        if (held()) {
          arm();
          return;
        }
        hideTimer.current = null;
        setChrome(false);
      }, delay);
    };
    arm();
  }, [autoHide, held]);

  const wake = useCallback(() => {
    setChrome(true);
    schedule();
  }, [schedule]);

  /** El ratón sale del vídeo: fuera al momento (si nada los retiene; si no, sigue la cuenta). */
  const hideNow = useCallback(() => {
    if (!autoHide || held()) return;
    clearHide();
    setChrome(false);
  }, [autoHide, held]);
  const hideNowRef = useRef(hideNow);
  hideNowRef.current = hideNow;

  useEffect(() => {
    if (!autoHide) {
      clearHide();
      setChrome(true);
      return;
    }
    schedule();
    return clearHide;
  }, [autoHide, schedule]);

  useEffect(() => {
    const onKey = () => {
      lastInput.current = 'keyboard';
    };
    const onPointer = () => {
      lastInput.current = 'pointer';
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  // La salida se mira en el marco del vídeo (padre de la capa de toques y de
  // los controles): pasar de la capa a una cápsula no es salir.
  useEffect(() => {
    const frame = hitRef.current?.parentElement;
    if (!frame) return;
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      lastMove.current = null;
      hideNowRef.current();
    };
    frame.addEventListener('pointerleave', onLeave);
    return () => frame.removeEventListener('pointerleave', onLeave);
  }, []);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  /**
   * Solo cuenta si el ratón se ha movido de verdad. Chrome manda «mousemove»
   * sin moverse cuando cambia lo que hay bajo el cursor (el contador del
   * directo se repinta cada 500 ms, la pantalla completa recoloca todo…) y
   * cada uno reiniciaba la cuenta: con el ratón quieto encima, no se iban.
   */
  const onMouseMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return;
    const last = lastMove.current;
    if (last && last.x === event.screenX && last.y === event.screenY) return;
    lastMove.current = { x: event.screenX, y: event.screenY };
    lastPointer.current = 'mouse';
    wake();
  };

  /* Sobre el vídeo: hacia abajo lo minimiza (móvil en vertical, no a
     pantalla completa); con el dedo, a los lados cambia de canal rápido
     entre favoritos: a la izquierda el siguiente, a la derecha el anterior
     (como pasar páginas), en todos los modos. Hacia arriba, nada. Con ratón
     no hay deslizamientos (el clic pausa).
     El eje decide `touch-action`: donde no se minimiza (tableta, horizontal,
     pantalla completa) solo se escucha el horizontal y el scroll vertical de
     la página sigue siendo del navegador (pan-y). La capa `player-hit` no
     tiene hijos: los controles son hermanos, así que un gesto que empieza en
     la barra de tiempo, el volumen o un botón nunca llega aquí. */
  const minimizes = ctx.compact && !ctx.immersive;
  // Con una película no hay favoritos entre los que cambiar.
  const zapSwipes = !ctx.finePointer && hasChannel && !vod;
  useSwipe(hitRef, {
    axis: minimizes && zapSwipes ? 'both' : minimizes ? 'y' : 'x',
    threshold: ZAP_SWIPE_MIN_PX,
    enabled: minimizes || zapSwipes,
    onSwipe: (direction) => {
      if (direction === 'down' && minimizes) actions.minimize();
      else if (direction === 'left' && zapSwipes) actions.zapFavorite(1);
      else if (direction === 'right' && zapSwipes) actions.zapFavorite(-1);
    },
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointer.current = event.pointerType;
    contextMenu.bind.onPointerDown(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    onMouseMove(event);
    contextMenu.bind.onPointerMove(event);
  };
  const onClick = () => {
    if (lastPointer.current !== 'mouse') {
      // Con el dedo, un toque enseña o esconde los controles (no pausa).
      if (chrome && autoHide) {
        clearHide();
        setChrome(false);
      } else wake();
      return;
    }
    wake();
    if (!hasChannel) return;
    if (clickTimer.current !== null) return;
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      actions.toggle();
    }, CLICK_DELAY_MS);
  };
  const onDoubleClick = () => {
    if (lastPointer.current !== 'mouse') return;
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
    actions.toggleFullscreen();
  };
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!hasChannel) return;
    contextMenu.bind.onContextMenu(event);
  };

  const wantsPlay = state.desiredPlaying || state.phase === 'buffer';
  // Conectando no hay nada que pausar: el botón espera (pulsarlo saltaría la precarga).
  const connecting =
    state.conn === 'pidiendo' ||
    state.conn === 'conectando' ||
    state.conn === 'precarga' ||
    state.conn === 'reconectando' ||
    (state.conn === 'arrancando' && state.phase !== 'bloqueado');
  const canBack = state.conn === 'activa' && state.started && !state.demo;
  const volume = state.muted ? 0 : state.volume;

  return (
    <>
      <div
        ref={hitRef}
        className="player-hit"
        data-chrome={chrome ? 'shown' : 'hidden'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={contextMenu.bind.onPointerUp}
        onPointerCancel={contextMenu.bind.onPointerCancel}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        aria-hidden="true"
      />
      <StageMessage state={state} ctx={ctx} />
      {ctx.immersive ? <ImmersivePill /> : null}
      <ZapBannerView />
      {state.phase === 'bloqueado' ? (
        <button type="button" className="player-tap press" onClick={actions.tapToPlay}>
          <span className="player-tap__icon" aria-hidden="true">
            <Icon name="play" size={32} />
          </span>
          Toca para reproducir
        </button>
      ) : null}
      {state.phase === 'buffer' || state.phase === 'buscando' ? (
        <span className="player-spinner" aria-hidden="true" />
      ) : null}
      {/* El rótulo de la demo, nunca encima del panel («Reconectando»…). */}
      {/* Ni detrás de la tarjeta «Terminada» (asomaban letras por los lados). */}
      {state.engine === 'demo' &&
      state.started &&
      state.channel &&
      !stageMessage(state) &&
      !state.vod?.ended ? (
        <p className="player-demo" aria-hidden="true">
          <strong>{state.channel.title.toUpperCase()}</strong>
          <span>
            {vod
              ? VOD_TEXT.demo(state.vod?.kind ?? 'movie')
              : 'reproducción simulada — en el Umbrel verías el stream real'}
          </span>
        </p>
      ) : null}
      {vod ? <VodEndCards state={state} actions={actions} /> : null}
      {/* Sobre el vídeo: a pantalla completa (no se ve nada más) o en
          escritorio si ninguna vista los enseña; en el móvil en vertical
          van en una hoja (index.tsx). */}
      {state.nerdOpen && hasChannel && (ctx.immersive || (!ctx.compact && !ctx.nerdHosted)) ? (
        <NerdPanel />
      ) : null}
      <div
        ref={chromeRef}
        className="player-chrome"
        data-visible={chrome ? 'true' : 'false'}
        onFocus={() => {
          keyboardFocus.current = lastInput.current === 'keyboard';
          wake();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            keyboardFocus.current = false;
        }}
        onPointerMove={onMouseMove}
        onPointerDown={(event) => {
          // Tocar un control cuenta como actividad (con el dedo no hay «mover»).
          lastPointer.current = event.pointerType;
          wake();
        }}
      >
        <div className="player-chrome__top">
          <div className="player-chrome__lead">
            {ctx.compact ? (
              <IconButton
                icon="chev-d"
                label="Minimizar el reproductor"
                variant="video"
                className="player-round glass--video"
                onClick={actions.minimize}
              />
            ) : hasChannel ? (
              <p className="player-now glass--video">
                <Equalizer playing={playing} />
                <span className="player-now__title">{state.channel?.title}</span>
                {state.channel?.subtitle ? (
                  <small className="player-now__sub">{state.channel.subtitle}</small>
                ) : null}
              </p>
            ) : null}
            {/* Aquí proyecta el centro de partido la cápsula del marcador. */}
            <div className="player-slot" ref={publishStageSlot} />
          </div>
          {hasChannel ? (
            <div className="player-cap glass--video">
              {vod ? null : (
                <IconButton
                  icon="star"
                  pressedIcon="star-f"
                  pressed={ctx.isFavorite}
                  label={ctx.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                  shortcut="G"
                  variant="video"
                  onClick={actions.toggleFavorite}
                />
              )}
              {ctx.canPip ? (
                <IconButton
                  icon="pip"
                  pressed={ctx.pip}
                  label="Imagen dentro de imagen"
                  shortcut="P"
                  variant="video"
                  onClick={actions.togglePip}
                />
              ) : null}
              <MenuButton
                icon="more"
                label="Más opciones"
                menuLabel="Opciones del reproductor"
                variant="video"
                items={ctx.menuItems}
              />
            </div>
          ) : null}
        </div>
        {/* En error no hay nada que reproducir, pausar ni adelantar: fuera los
            controles de abajo, que en el móvil apretaban el panel con
            «Reintentar» (Detener sigue en «Más opciones»). */}
        {hasChannel && state.phase !== 'error' && vod ? (
          <VodControls state={state} ctx={ctx} />
        ) : hasChannel && state.phase !== 'error' ? (
          <div className="player-chrome__bottom">
            <div className="player-chrome__group">
              {/* Pausa grande: el botón que más se usa, relleno y aparte. */}
              <IconButton
                icon={wantsPlay || connecting ? 'pause' : 'play'}
                label={connecting ? 'Conectando…' : wantsPlay ? 'Pausar' : 'Reproducir'}
                shortcut="Espacio"
                variant="video"
                className="player-play"
                data-fill="true"
                disabled={connecting}
                onClick={actions.toggle}
              />
              <div className="player-cap glass--video">
                {ctx.compact ? null : (
                  <IconButton
                    icon="stop"
                    label="Detener"
                    variant="video"
                    className="player-stop"
                    onClick={actions.stop}
                  />
                )}
                <button
                  type="button"
                  className="player-back press"
                  aria-label="Retroceder 30 segundos"
                  title="Retroceder 30 s (J)"
                  disabled={!canBack}
                  onClick={actions.back}
                >
                  <Icon name="back" size={18} />
                  <Num value="30" />
                </button>
                <IconButton
                  icon={state.muted || state.volume === 0 ? 'mute' : 'vol'}
                  label={state.muted ? 'Activar sonido' : 'Silenciar'}
                  shortcut="M"
                  variant="video"
                  onClick={actions.toggleMute}
                />
                {ctx.finePointer && !ctx.compact ? (
                  <label className="player-vol">
                    <span className="sr-only">Volumen</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volume}
                      style={{ '--v': volume } as CSSProperties}
                      onChange={(event) => actions.setVolume(Number(event.currentTarget.value))}
                    />
                  </label>
                ) : null}
              </div>
            </div>
            <div className="player-cap glass--video">
              <LiveButton state={state} onPress={actions.goLive} />
              {ctx.canFullscreen ? (
                <IconButton
                  icon="full"
                  label={ctx.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                  shortcut="F"
                  pressed={ctx.fullscreen}
                  variant="video"
                  onClick={actions.toggleFullscreen}
                />
              ) : ctx.compact ? null : (
                // Sin pantalla completa en este navegador (escritorio): el modo
                // teatro llena la ventana con el vídeo (lo mismo que F).
                <IconButton
                  icon="pantalla"
                  label={ctx.theater ? 'Salir del modo teatro' : 'Modo teatro'}
                  shortcut="F"
                  pressed={ctx.theater}
                  variant="video"
                  onClick={actions.toggleTheater}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
      <Menu {...contextMenu.menu} label="Opciones del reproductor" items={ctx.menuItems} />
    </>
  );
}

/**
 * La presentación grande. La monta el PlayerDock (no la montes tú: el
 * reproductor es uno y lo pone el armazón); fuera de él no pinta nada.
 */
export function PlayerSurface() {
  const ctx = usePlayerContext();
  if (!ctx) {
    if (import.meta.env.DEV)
      console.warn('[reproductor] <PlayerSurface/> fuera del PlayerDock: el armazón ya lo monta.');
    return null;
  }
  return <Surface ctx={ctx} />;
}
