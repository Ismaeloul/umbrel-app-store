/* Elegir el modo de reproducción: tres opciones en tarjetas (radiogroup), no
   en un segmentado, porque «Baja latencia» no cabía en un tercio de 360 px y
   así cada modo lleva su frase. Teclado del patrón ARIA: flechas, Inicio y Fin
   mueven la selección y el foco; solo la opción elegida entra en el Tab. */

import { PLAYBACK_PROFILES, type PlaybackMode } from '@ace/shared';
import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../../lib/cx.ts';
import { PLAYBACK_MODE_ORDER } from './playback-mode.ts';

export const MODE_BLURB: Record<PlaybackMode, string> = {
  low: 'Más cerca del directo; asume más riesgo de cortes.',
  balanced: 'Colchón moderado. El recomendado.',
  stable: 'Prioriza la continuidad en canales con pocos pares.',
};

export function ModePicker({
  value,
  onChange,
  labelledBy,
}: {
  value: PlaybackMode;
  onChange(mode: PlaybackMode): void;
  labelledBy: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = PLAYBACK_MODE_ORDER.indexOf(value);
    const last = PLAYBACK_MODE_ORDER.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = index >= last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = index <= 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    const mode = PLAYBACK_MODE_ORDER[next];
    if (!mode) return;
    onChange(mode);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="set-modes">
      {PLAYBACK_MODE_ORDER.map((mode, index) => (
        <button
          key={mode}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          className={cx('set-mode', 'press')}
          onClick={() => onChange(mode)}
          onKeyDown={onKeyDown}
        >
          <span className="set-mode__dot" aria-hidden="true" />
          <span className="set-mode__text">
            <span className="set-mode__label">{PLAYBACK_PROFILES[mode].label}</span>
            <span className="set-mode__blurb">{MODE_BLURB[mode]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
