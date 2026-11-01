/* Silencio y volumen en el ordenador, como en los reproductores de siempre: el
   botón de silencio y, al pasar el ratón o con el foco del teclado, el
   deslizador a su lado. Lo usan el reproductor de casa (directo y películas)
   y la sala de «Ver juntos».

   - El deslizador es un `input type=range` («Volumen», «40 %»): ↑ → suben un
     5 %, ↓ ← bajan, Re Pág / Av Pág un 10 %, Inicio lo silencia y Fin lo
     pone al máximo. Esas teclas son suyas: no cambian de canal ni saltan la
     película mientras tiene el foco.
   - La rueda del ratón sobre el control sube y baja (sin mover la página), por
     lo desplazado (`wheelStep`): un trackpad no lo lleva al tope de un gesto.
   - Silenciado, la primera tecla o el primer paso de la rueda parten del nivel
     de antes (no de 0): ↑ con el 60 % silenciado suena al 65 %, no al 5 %.
   - Cada ajuste (rueda, tecla, arrastre) avisa con `onActivity`: los controles
     no se esconden a mitad.
   - Se queda abierto mientras se arrastra, aunque el puntero salga.
   - Con una pantalla táctil (portátil con pantalla de dedo) está siempre a la
     vista y mide 44 px de alto: no hay «pasar por encima» con el dedo.
   - Sin `slider` (móvil, tableta táctil) queda solo el botón de silencio. */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconButton } from '../ui/Button.tsx';
import { cx } from '../lib/cx.ts';
import {
  clampVolume,
  VOLUME_STEP,
  volumeForKey,
  volumeText,
  WHEEL_IDLE,
  wheelStep,
} from './volume.ts';
import './volume.css';

export interface VolumeControlProps {
  /** Silenciado (o a 0): el icono tachado y el deslizador a 0. */
  muted: boolean;
  /** El volumen del <video>, de 0 a 1. */
  volume: number;
  onToggleMute(): void;
  onVolume(value: number): void;
  /** El deslizador (solo con ratón y en pantallas anchas). */
  slider: boolean;
  muteLabel?: string;
  unmuteLabel?: string;
  sliderLabel?: string;
  shortcut?: string;
  className?: string;
  /** Se está ajustando (rueda, tecla, arrastre): que los controles sigan a la vista. */
  onActivity?(): void;
}

export function VolumeControl({
  muted,
  volume,
  onToggleMute,
  onVolume,
  slider,
  muteLabel = 'Silenciar',
  unmuteLabel = 'Activar sonido',
  sliderLabel = 'Volumen',
  shortcut,
  className,
  onActivity,
}: VolumeControlProps) {
  const shown = muted ? 0 : clampVolume(volume);
  /* De dónde parte un ajuste: silenciado, del nivel de antes (si no, ↑ daba un 5 % y lo guardaba). */
  const from = muted && volume > 0 ? clampVolume(volume) : shown;
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [dragging, setDragging] = useState(false);

  /* La rueda: con un oyente propio, porque el de React es pasivo y no puede
     impedir que la página se desplace. */
  const latest = useRef({ from, onVolume, onActivity });
  latest.current = { from, onVolume, onActivity };
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !slider) return;
    let wheel = WHEEL_IDLE;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      latest.current.onActivity?.();
      const { step, state } = wheelStep(wheel, event.deltaY, event.deltaMode, performance.now());
      wheel = state;
      if (step === 0) return;
      const next = clampVolume(latest.current.from + step * VOLUME_STEP);
      latest.current.onVolume(next);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [slider]);

  /* Arrastrando, abierto aunque el puntero se salga del control. */
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    globalThis.addEventListener('pointerup', stop);
    globalThis.addEventListener('pointercancel', stop);
    return () => {
      globalThis.removeEventListener('pointerup', stop);
      globalThis.removeEventListener('pointercancel', stop);
    };
  }, [dragging]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const next = volumeForKey(event.key, from);
    if (next === null) return;
    // Nuestras: ni el navegador mueve el deslizador por su cuenta ni salta ningún atajo.
    event.preventDefault();
    event.stopPropagation();
    onActivity?.();
    onVolume(next);
  };

  return (
    <span
      ref={rootRef}
      className={cx('vol-ctl', className)}
      data-muted={muted ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : undefined}
    >
      <IconButton
        icon={muted ? 'mute' : 'vol'}
        label={muted ? unmuteLabel : muteLabel}
        shortcut={shortcut}
        variant="video"
        onClick={onToggleMute}
      />
      {slider ? (
        <span className="player-vol">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={shown}
            aria-label={sliderLabel}
            aria-valuetext={volumeText(shown)}
            style={{ '--v': shown } as CSSProperties}
            onPointerDown={() => {
              setDragging(true);
              onActivity?.();
            }}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              onActivity?.();
              onVolume(clampVolume(Number(event.currentTarget.value)));
            }}
          />
        </span>
      ) : null}
    </span>
  );
}
