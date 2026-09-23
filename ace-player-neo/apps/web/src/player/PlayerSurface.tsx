/* La superficie grande del reproductor (presentación «stage»): los controles
   propios de la opción A sobre el vídeo, el panel de espera o error, la capa
   «Toca para reproducir», el panel técnico y el menú contextual.

   - Controles propios en todas las plataformas (el diseño los pide también
     en el móvil). En iPhone la pantalla completa es la del sistema, con sus
     controles nativos (AirPlay incluido). Un solo reproductor visible: el
     <video> nunca lleva `controls` (B-088, lo vigila index.tsx).
   - Se esconden a los 3,2 s sin mover el ratón SOLO si suena de verdad, y el
     cursor con ellos (B-102); con el dedo, un toque los enseña o los esconde.
   - Ratón: un clic pausa o reanuda (espera 190 ms para distinguirlo del
     doble clic, que pone pantalla completa); clic derecho, el menú propio.
   - Móvil: deslizar hacia abajo sobre el vídeo lo minimiza. */

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
import { Button, IconButton } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import { LiveDot } from '../ui/LiveRing.tsx';
import { Menu, MenuButton, useContextMenu } from '../ui/Menu.tsx';
import { Num } from '../ui/Num.tsx';
import { usePlayer, type PlayerState } from './api.ts';
import { CLICK_DELAY_MS, CONTROLS_HIDE_MS } from './constants.ts';
import { usePlayerContext, type PlayerContextValue } from './context.ts';
import { NerdPanel } from './NerdPanel.tsx';
import { liveButton, stageMessage } from './status.ts';

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

function StageMessage({ state, ctx }: { state: PlayerState; ctx: PlayerContextValue }) {
  const message = stageMessage(state);
  if (!message) return null;
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
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);
  const lastPointer = useRef<string>('mouse');
  const chromeRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const contextMenu = useContextMenu();

  const clearHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const schedule = useCallback(() => {
    clearHide();
    if (!playing) return;
    const arm = () => {
      hideTimer.current = window.setTimeout(() => {
        // Con el foco del teclado dentro no se esconden (el foco se vería desaparecer).
        // Tampoco con el menú «Más opciones» abierto (se quedaría flotando solo).
        if (
          chromeRef.current?.contains(document.activeElement) ||
          chromeRef.current?.querySelector('[aria-expanded="true"]')
        ) {
          arm();
          return;
        }
        setChrome(false);
      }, CONTROLS_HIDE_MS);
    };
    arm();
  }, [playing]);

  const wake = useCallback(() => {
    setChrome(true);
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (!playing) {
      clearHide();
      setChrome(true);
      return;
    }
    schedule();
    return clearHide;
  }, [playing, schedule]);

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    },
    [],
  );

  // Deslizar hacia abajo sobre el vídeo lo minimiza (móvil, no en horizontal).
  useSwipe(hitRef, {
    axis: 'y',
    enabled: ctx.compact && !ctx.immersive,
    onSwipe: (direction) => {
      if (direction === 'down') actions.minimize();
    },
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointer.current = event.pointerType;
    contextMenu.bind.onPointerDown(event);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') wake();
    contextMenu.bind.onPointerMove(event);
  };
  const onClick = () => {
    if (lastPointer.current !== 'mouse') {
      // Con el dedo, un toque enseña o esconde los controles (no pausa).
      if (chrome && playing) {
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
      {state.engine === 'demo' && state.started && state.channel ? (
        <p className="player-demo" aria-hidden="true">
          <strong>{state.channel.title.toUpperCase()}</strong>
          <span>reproducción simulada — en el Umbrel verías el stream real</span>
        </p>
      ) : null}
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
        onFocus={wake}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') wake();
        }}
      >
        <div className="player-chrome__top">
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
          ) : (
            <span />
          )}
          {hasChannel ? (
            <div className="player-cap glass--video">
              <IconButton
                icon="star"
                pressedIcon="star-f"
                pressed={ctx.isFavorite}
                label={ctx.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                shortcut="G"
                variant="video"
                onClick={actions.toggleFavorite}
              />
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
        {hasChannel && state.phase !== 'error' ? (
          <div className="player-chrome__bottom">
            <div className="player-cap glass--video">
              <IconButton
                icon={wantsPlay || connecting ? 'pause' : 'play'}
                label={connecting ? 'Conectando…' : wantsPlay ? 'Pausar' : 'Reproducir'}
                shortcut="Espacio"
                variant="video"
                data-fill="true"
                disabled={connecting}
                onClick={actions.toggle}
              />
              {ctx.compact ? null : (
                <IconButton icon="stop" label="Detener" variant="video" onClick={actions.stop} />
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
              ) : null}
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
