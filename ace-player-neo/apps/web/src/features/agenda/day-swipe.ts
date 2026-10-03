/* Deslizar entre días en la agenda del móvil (0.9.0, punto 3 de Isma: «a
   veces sí y a veces no»).

   Por qué fallaba: la lista del móvil son FILAS HORIZONTALES de tarjetas
   (PosterRail, `overflow-x: auto`). Con Pointer Events, en cuanto el dedo
   tocaba una fila el navegador se quedaba el gesto para desplazarla (y
   mandaba `pointercancel`), aunque la fila no tuviera nada más que enseñar
   o ya estuviera en su final: solo cambiaba de día un deslizamiento sobre el
   título de la competición o el hueco entre filas.

   Ahora se escucha con Touch Events PASIVOS (siguen llegando aunque el
   navegador desplace algo, en Chrome y en Safari de iOS, y nunca frenan el
   desplazamiento) y se decide así:
   - El gesto se fija en los primeros 10 px: si va más en horizontal que en
     vertical puede ser un cambio de día (el mismo criterio con el que Chrome
     decide no desplazar con `pan-y`: así no hay gestos «muertos» que ni
     desplazan ni cambian de día); si no, es scroll vertical y se deja en paz
     hasta soltar. Y si mientras tanto la página se desplaza SIGUIENDO al dedo
     (Safari puede hacerlo en diagonal), el cambio de día se anula: nunca se
     pelea con el scroll. Un salto de scroll que no sigue al dedo (la barra
     de Safari o de Chrome que entra o sale al final de la página, la ventana
     que se reajusta) no cuenta: eso anulaba gestos buenos al fondo de la
     página (revisión de la 0.9.0; agenda.css › «Móvil y tableta» quita
     además lo que ensanchaba la página y hacía reajustarse la ventana).
   - Si empezó dentro de una fila que todavía PUEDE desplazarse hacia ese
     lado, es de la fila. Si la fila no desborda o ya está en su final (o en
     su principio, hacia atrás), el gesto cambia de día: como en las vistas
     paginadas nativas con carruseles dentro.
   - Al soltar: al menos 56 px, o un golpe rápido (28 px a 0,4 px/ms).
   - Dedo a la IZQUIERDA = día siguiente (la lista entra por la derecha,
     como la tira de días); a la DERECHA = día anterior.
   - Dos dedos (pellizcar) anulan el gesto.

   La tira de días queda fuera (va encima de la lista, no dentro): tocarla o
   desplazarla nunca cambia de día por gesto. `touch-action: pan-y` en la
   lista deja al navegador solo el scroll vertical fuera de las filas, y así
   Chrome de Android tampoco lo toma por «atrás» en el historial. */

import { useEffect, useRef, type RefObject } from 'react';

export type DayDirection = 'next' | 'prev';

/** Distancia que fija el eje del gesto (px). */
export const LOCK_PX = 10;
/** Cuánto tiene que dominar lo horizontal para que sea un cambio de día. */
export const DOMINANCE = 1;
/** Si la página se desplaza más que esto SIGUIENDO al dedo, era scroll. */
export const SCROLL_CANCEL_PX = 8;
/** Deslizamiento largo (px). */
export const DAY_SWIPE_MIN = 56;
/** Golpe rápido: distancia mínima (px) y velocidad (px/ms). */
export const FLICK_MIN = 28;
export const FLICK_SPEED = 0.4;
/** Holgura del borde de una fila (scroll-snap y subpíxeles). */
const EDGE_SLACK = 2;

/** Lo que una fila de tarjetas podía desplazarse al empezar el gesto. */
export interface RailRoom {
  /** Hacia el principio (el dedo va a la derecha). */
  back: boolean;
  /** Hacia el final (el dedo va a la izquierda). */
  forward: boolean;
}

/** Hacia qué día apunta un movimiento horizontal del dedo. */
export function directionOf(dx: number): DayDirection {
  return dx < 0 ? 'next' : 'prev';
}

/** ¿Ese lado lo tiene la fila (todavía puede desplazarse hacia allí)? */
export function railTakes(room: RailRoom | null, direction: DayDirection): boolean {
  if (!room) return false;
  return direction === 'next' ? room.forward : room.back;
}

/**
 * Eje del gesto en cuanto se mueve LOCK_PX: 'x' si domina lo horizontal,
 * 'y' si no (a 45° justos gana el scroll), null mientras no se ha movido.
 */
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * DOMINANCE ? 'x' : 'y';
}

/**
 * Al soltar un gesto fijado en horizontal: el día al que va, o null si se
 * queda corto, se ha vuelto vertical, ha dado la vuelta o era de la fila.
 */
export function dayFromGesture({
  dx,
  dy,
  ms,
  locked,
  room = null,
}: {
  dx: number;
  dy: number;
  ms: number;
  /** El sentido con el que se fijó el gesto. */
  locked: DayDirection;
  room?: RailRoom | null;
}): DayDirection | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 || ax <= ay) return null;
  const direction = directionOf(dx);
  if (direction !== locked) return null;
  if (railTakes(room, direction)) return null;
  const fast = ax >= FLICK_MIN && ax / Math.max(ms, 1) >= FLICK_SPEED;
  return ax >= DAY_SWIPE_MIN || fast ? direction : null;
}

/**
 * ¿La página se ha desplazado siguiendo al dedo (scroll de verdad)? `scrolled`
 * es lo que ha cambiado `scrollY` desde que empezó el gesto y `dy`, lo que ha
 * bajado el dedo. El navegador desplaza al revés que el dedo (el dedo sube →
 * la página baja) y nunca más de lo que el dedo se ha movido en vertical;
 * cualquier otro salto es la ventana reajustándose, no el usuario.
 */
export function pageFollowsFinger(scrolled: number, dy: number): boolean {
  if (Math.abs(scrolled) <= SCROLL_CANCEL_PX) return false;
  if (scrolled * dy >= 0) return false;
  return Math.abs(scrolled) <= Math.abs(dy) + SCROLL_CANCEL_PX;
}

/** Alto de la ventana (con la barra del navegador): si cambia, el scroll salta solo. */
function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

function scrollsSideways(el: Element): boolean {
  const overflow = getComputedStyle(el).overflowX;
  return overflow === 'auto' || overflow === 'scroll';
}

/**
 * La fila que se desplaza en horizontal bajo el dedo (la primera desde el
 * elemento tocado hasta `root`, sin contarlo) y cuánto podía moverse. null
 * si el dedo no está sobre ninguna.
 */
export function railRoomAt(target: EventTarget | null, root: Element): RailRoom | null {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (scrollsSideways(el)) {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= EDGE_SLACK) return { back: false, forward: false };
      const left = Math.abs(el.scrollLeft);
      return { back: left > EDGE_SLACK, forward: left < max - EDGE_SLACK };
    }
    el = el.parentElement;
  }
  return null;
}

export interface DaySwipeOptions {
  enabled?: boolean;
  onSwipe(direction: DayDirection): void;
  /** Mientras el dedo arrastra un cambio de día: desplazamiento horizontal. */
  onMove?(dx: number): void;
  /** Soltó sin llegar (o el gesto dejó de ser un cambio de día). */
  onCancel?(): void;
}

type Phase = 'pending' | 'day' | 'ignored';

interface Track {
  id: number;
  x: number;
  y: number;
  t: number;
  /** Desplazamiento de la página al empezar (o tras reajustarse la ventana). */
  scrollY: number;
  /** Alto de la ventana con el que se mide ese desplazamiento. */
  viewport: number;
  room: RailRoom | null;
  phase: Phase;
  locked: DayDirection | null;
}

function touchById(list: TouchList | undefined, id: number): Touch | null {
  if (!list) return null;
  for (let i = 0; i < list.length; i += 1) {
    const touch = list[i];
    if (touch && touch.identifier === id) return touch;
  }
  return null;
}

/** Engancha el gesto a la lista (solo táctil; con ratón no hace nada). */
export function useDaySwipe(ref: RefObject<HTMLElement | null>, options: DaySwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const enabled = options.enabled !== false;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const previousTouchAction = el.style.touchAction;
    el.style.touchAction = 'pan-y';
    let track: Track | null = null;

    const stop = (cancelled: boolean) => {
      if (track?.phase === 'day' && cancelled) latest.current.onCancel?.();
      track = null;
    };

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        // Un segundo dedo (pellizcar): fuera.
        stop(true);
        return;
      }
      const touch = event.changedTouches[0] ?? event.touches[0];
      if (!touch) return;
      track = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        t: event.timeStamp,
        room: railRoomAt(event.target, el),
        scrollY: window.scrollY,
        viewport: viewportHeight(),
        phase: 'pending',
        locked: null,
      };
    };

    const move = (event: TouchEvent) => {
      if (!track || track.phase === 'ignored') return;
      if (event.touches.length !== 1) {
        stop(true);
        return;
      }
      const touch = touchById(event.touches, track.id);
      if (!touch) return;
      const dx = touch.clientX - track.x;
      const dy = touch.clientY - track.y;
      if (track.phase === 'pending') {
        const axis = lockAxis(dx, dy);
        if (axis === null) return;
        const direction = directionOf(dx);
        if (axis === 'y' || railTakes(track.room, direction)) {
          track.phase = 'ignored';
          return;
        }
        track.phase = 'day';
        track.locked = direction;
      }
      const viewport = viewportHeight();
      if (viewport !== track.viewport) {
        // La ventana ha cambiado de alto (la barra del navegador): el salto
        // de scroll que trae no es del dedo; se vuelve a medir desde aquí.
        track.viewport = viewport;
        track.scrollY = window.scrollY;
      }
      if (pageFollowsFinger(window.scrollY - track.scrollY, dy)) {
        // El navegador se lo ha quedado para desplazar la página: era scroll.
        track.phase = 'ignored';
        latest.current.onCancel?.();
        return;
      }
      latest.current.onMove?.(dx);
    };

    const end = (event: TouchEvent) => {
      if (!track) return;
      const touch = touchById(event.changedTouches, track.id);
      if (!touch) return;
      const current = track;
      track = null;
      if (current.phase !== 'day' || !current.locked) return;
      const direction = dayFromGesture({
        dx: touch.clientX - current.x,
        dy: touch.clientY - current.y,
        ms: event.timeStamp - current.t,
        locked: current.locked,
        room: current.room,
      });
      if (direction) latest.current.onSwipe(direction);
      else latest.current.onCancel?.();
    };

    const cancel = () => stop(true);

    const passive = { passive: true } as const;
    el.addEventListener('touchstart', start, passive);
    el.addEventListener('touchmove', move, passive);
    el.addEventListener('touchend', end, passive);
    el.addEventListener('touchcancel', cancel, passive);
    return () => {
      el.style.touchAction = previousTouchAction;
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', cancel);
      if (track?.phase === 'day') latest.current.onCancel?.();
    };
  }, [ref, enabled]);
}
