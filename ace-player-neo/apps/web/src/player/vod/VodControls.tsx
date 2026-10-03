/* Los controles de abajo con una película o un episodio (docs/vod.md §12.7):
   sustituyen a «−30» y al botón de directo cuando `kind === 'vod'`.

   - Barra de tiempo: `input type=range` («Posición», «12:34 de 1:45:20»), lo
     cargado sombreado y el tiempo flotante al arrastrar (o al pasar el ratón).
     Solo salta AL SOLTAR: arrastrar no pide nada al servidor. Con el teclado,
     ← → saltan 10 s (las pulsaciones seguidas, un salto).
   - Reproducir y pausa (grande), «Retroceder 10 segundos», «Avanzar 10
     segundos», silencio y volumen.
   - El tiempo «12:34 / 1:45:20»; al tocarlo, lo que queda («−1:32:46»).
   - «Audio» si hay más de una pista (reabre en la posición), «Siguiente
     episodio» si lo hay, y pantalla completa (o el modo teatro). */

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { IconButton } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { MenuButton } from '../../ui/Menu.tsx';
import { Num } from '../../ui/Num.tsx';
import type { PlayerState, VodPlayback } from '../api.ts';
import type { PlayerContextValue } from '../context.ts';
import { clockText, VOD_SEEK_STEP_S } from './timeline.ts';

/**
 * El segundo bajo el puntero, medido sobre la pista pintada: 0 en su borde
 * izquierdo y la duración en el derecho (fuera, se queda en el borde). Lo
 * usan el tiempo flotante y el salto: los dos caen en el mismo sitio.
 */
export function timeAtPointer(
  clientX: number,
  track: { left: number; width: number },
  duration: number,
): number | null {
  if (!(duration > 0) || !(track.width > 0)) return null;
  const x = Math.min(1, Math.max(0, (clientX - track.left) / track.width));
  return x * duration;
}

/** La barra de tiempo: salta al soltar; mientras se arrastra solo se mueve el tiempo flotante. */
export function VodTimeline({
  vod,
  onSeek,
  onNudge,
}: {
  vod: VodPlayback;
  onSeek(seconds: number): void;
  onNudge(delta: number): void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const duration = vod.durationS > 0 ? vod.durationS : 0;
  const value = drag ?? Math.min(vod.positionS, duration);
  const ratio = duration ? value / duration : 0;
  const loaded = duration ? Math.min(1, vod.bufferedEndS / duration) : 0;
  const tip = drag ?? hover;

  const trackRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Lo último que marcó el dedo o el ratón al arrastrar (el estado llega un render tarde). */
  const dragAt = useRef<number | null>(null);

  const commit = () => {
    const target = dragAt.current;
    dragging.current = false;
    dragAt.current = null;
    setDrag(null);
    if (target !== null && Math.abs(target - vod.positionS) >= 0.5) onSeek(target);
  };

  // El punto se mide SIEMPRE sobre la pista pintada (`.vod-bar__track`), con
  // la misma fórmula para el tiempo flotante y para el salto: antes el salto
  // lo calculaba el deslizador nativo (con medio pulgar de margen a cada
  // lado) y no caía donde decía el tiempo flotante (auditoría web 0.9.0).
  const fromPointer = (event: ReactPointerEvent<HTMLElement>): number | null => {
    const track = trackRef.current;
    if (!track || !duration) return null;
    return timeAtPointer(event.clientX, track.getBoundingClientRect(), duration);
  };

  // Al soltar, la captura se suelta sola (y `lostpointercapture` ya no hace nada).
  const endDrag = () => {
    if (dragging.current) commit();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // ← → saltan 10 s (como los botones); Inicio y Fin, al principio y al final.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onNudge(event.key === 'ArrowLeft' ? -VOD_SEEK_STEP_S : VOD_SEEK_STEP_S);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek(Math.max(0, duration - 1));
    }
  };

  return (
    <div
      className="vod-bar"
      data-dragging={drag !== null ? 'true' : 'false'}
      style={{ '--p': ratio, '--b': loaded } as CSSProperties}
      onPointerDown={(event) => {
        if (!duration || (event.pointerType === 'mouse' && event.button !== 0)) return;
        const at = fromPointer(event);
        if (at === null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragging.current = true;
        dragAt.current = at;
        setHover(null);
        setDrag(at);
        inputRef.current?.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        if (dragging.current) {
          const at = fromPointer(event);
          if (at === null) return;
          dragAt.current = at;
          setDrag(at);
          return;
        }
        if (event.pointerType !== 'mouse') return;
        setHover(fromPointer(event));
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        dragging.current = false;
        dragAt.current = null;
        setDrag(null);
      }}
      onLostPointerCapture={() => {
        if (dragging.current) commit();
      }}
      onPointerLeave={() => setHover(null)}
    >
      <span ref={trackRef} className="vod-bar__track" aria-hidden="true">
        <span className="vod-bar__loaded" />
        <span className="vod-bar__played" />
      </span>
      <span className="vod-bar__thumb" aria-hidden="true" />
      {/* El deslizador de verdad (teclado y lector de pantalla); el ratón y el
          dedo los atiende la barra entera, medidos sobre la pista. */}
      <input
        ref={inputRef}
        type="range"
        className="vod-bar__input"
        min={0}
        max={duration || 1}
        step="any"
        value={value}
        disabled={!duration}
        aria-label="Posición"
        aria-valuetext={`${clockText(value)} de ${clockText(duration)}`}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (!Number.isFinite(next) || dragging.current) return;
          onSeek(next);
        }}
        onKeyDown={onKeyDown}
      />
      {tip !== null && duration ? (
        <span
          className="vod-bar__tip glass--video"
          style={{ '--x': tip / duration } as CSSProperties}
          aria-hidden="true"
        >
          <Num value={clockText(tip)} />
        </span>
      ) : null}
    </div>
  );
}

/** «12:34 / 1:45:20»; tocarlo cambia a lo que queda («−1:32:46»). */
function VodClock({ vod }: { vod: VodPlayback }) {
  const [remaining, setRemaining] = useState(false);
  const left = Math.max(0, vod.durationS - vod.positionS);
  return (
    <button
      type="button"
      className="vod-clock press"
      aria-label={
        remaining
          ? `Quedan ${clockText(left)}. Enseñar el tiempo transcurrido`
          : `${clockText(vod.positionS)} de ${clockText(vod.durationS)}. Enseñar lo que queda`
      }
      onClick={() => setRemaining((on) => !on)}
    >
      {remaining ? (
        <Num value={`−${clockText(left)}`} />
      ) : (
        <>
          <Num value={clockText(vod.positionS)} />
          <span className="vod-clock__of" aria-hidden="true">
            {' / '}
          </span>
          <Num value={clockText(vod.durationS)} />
        </>
      )}
    </button>
  );
}

export function VodControls({ state, ctx }: { state: PlayerState; ctx: PlayerContextValue }) {
  const vod = state.vod;
  const { actions } = ctx;
  const wantsPlay = state.desiredPlaying || state.phase === 'buffer';
  const connecting =
    state.conn === 'pidiendo' ||
    state.conn === 'conectando' ||
    state.conn === 'precarga' ||
    state.conn === 'reconectando' ||
    (state.conn === 'arrancando' && state.phase !== 'bloqueado');
  const ready = state.conn === 'activa' && vod !== null && vod.durationS > 0;
  const volume = state.muted ? 0 : state.volume;
  const tracks = vod?.audio ?? [];
  return (
    <div className="player-chrome__bottom vod-bottom">
      {vod ? <VodTimeline vod={vod} onSeek={actions.seekTo} onNudge={actions.seekBy} /> : null}
      <div className="vod-row">
        <div className="player-chrome__group">
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
              aria-label="Retroceder 10 segundos"
              title="Retroceder 10 s (J)"
              disabled={!ready}
              onClick={() => actions.seekBy(-VOD_SEEK_STEP_S)}
            >
              <Icon name="back" size={18} />
              <Num value="10" />
            </button>
            <button
              type="button"
              className="player-back vod-forward press"
              aria-label="Avanzar 10 segundos"
              title="Avanzar 10 s (L)"
              disabled={!ready}
              onClick={() => actions.seekBy(VOD_SEEK_STEP_S)}
            >
              <Num value="10" />
              <Icon name="back" size={18} className="vod-forward__icon" />
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
          {vod && vod.durationS > 0 ? <VodClock vod={vod} /> : null}
        </div>
        <div className="player-cap glass--video">
          {tracks.length > 1 && vod ? (
            <MenuButton
              icon="list"
              label="Audio"
              menuLabel="Pista de audio"
              variant="video"
              items={tracks.map((track) => ({
                id: `audio-${track.index}`,
                label: track.label,
                checked: track.index === vod.audioIndex,
                onSelect: () => actions.setAudio(track.index),
              }))}
            />
          ) : null}
          {vod?.next ? (
            <IconButton
              icon="chev-r"
              label={`Siguiente episodio: ${vod.next.label}`}
              shortcut="N"
              variant="video"
              onClick={actions.nextEpisode}
            />
          ) : null}
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
    </div>
  );
}
