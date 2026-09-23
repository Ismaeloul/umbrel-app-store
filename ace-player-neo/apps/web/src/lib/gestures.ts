/* Gestos táctiles sin librería: deslizar en horizontal (cambiar de día o de
   fuente) y arrastrar (el mini-reproductor). Con Pointer Events, así sirven
   igual para dedo, lápiz y ratón.

   Reglas:
   - Un deslizamiento solo cuenta si es claramente horizontal (el ángulo) y
     largo o rápido; si el dedo va en vertical, se deja al scroll de la página.
   - `touch-action: pan-y` en el elemento (lo pone el hook) deja al navegador
     el scroll vertical y nos da el horizontal.
   - Nada se mueve durante el gesto salvo con transform (lo aplica quien usa
     `onMove`). */

import { useEffect, useRef, type RefObject } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SwipeOptions {
  /** Distancia mínima en px (por defecto 56). */
  threshold?: number;
  /** Velocidad que cuenta como deslizamiento aunque sea corto (px/ms, por defecto 0,45). */
  velocity?: number;
  /** Ejes que interesan (por defecto solo horizontal). */
  axis?: 'x' | 'y' | 'both';
  onSwipe(direction: SwipeDirection): void;
  /** Mientras se arrastra: desplazamiento para dar respuesta con transform. */
  onMove?(dx: number, dy: number): void;
  /** Al soltar sin llegar a deslizar. */
  onCancel?(): void;
  enabled?: boolean;
}

interface Track {
  id: number;
  x: number;
  y: number;
  t: number;
  locked: 'x' | 'y' | null;
}

/** Decide el gesto a partir del recorrido (pura, para poder probarla). */
export function classifySwipe(
  dx: number,
  dy: number,
  ms: number,
  {
    threshold = 56,
    velocity = 0.45,
    axis = 'x',
  }: Pick<SwipeOptions, 'threshold' | 'velocity' | 'axis'> = {},
): SwipeDirection | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const horizontal = ax > ay * 1.4;
  const vertical = ay > ax * 1.4;
  const speed = Math.max(ax, ay) / Math.max(ms, 1);
  const far = Math.max(ax, ay) >= threshold || (speed >= velocity && Math.max(ax, ay) >= 24);
  if (!far) return null;
  if (horizontal && axis !== 'y') return dx < 0 ? 'left' : 'right';
  if (vertical && axis !== 'x') return dy < 0 ? 'up' : 'down';
  return null;
}

export function useSwipe(ref: RefObject<HTMLElement | null>, options: SwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const el = ref.current;
    if (!el || options.enabled === false) return;
    const axis = options.axis ?? 'x';
    const previousTouchAction = el.style.touchAction;
    el.style.touchAction = axis === 'x' ? 'pan-y' : axis === 'y' ? 'pan-x' : 'none';
    let track: Track | null = null;

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      track = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
        locked: null,
      };
    };
    const move = (event: PointerEvent) => {
      if (!track || event.pointerId !== track.id) return;
      const dx = event.clientX - track.x;
      const dy = event.clientY - track.y;
      if (!track.locked && Math.hypot(dx, dy) > 8)
        track.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (track.locked && (axis === 'both' || track.locked === axis))
        latest.current.onMove?.(dx, dy);
    };
    const up = (event: PointerEvent) => {
      if (!track || event.pointerId !== track.id) return;
      const result = classifySwipe(
        event.clientX - track.x,
        event.clientY - track.y,
        event.timeStamp - track.t,
        latest.current,
      );
      track = null;
      if (result) latest.current.onSwipe(result);
      else latest.current.onCancel?.();
    };
    const cancel = () => {
      if (!track) return;
      track = null;
      latest.current.onCancel?.();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.style.touchAction = previousTouchAction;
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [ref, options.enabled, options.axis]);
}
