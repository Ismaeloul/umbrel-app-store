/* Fundido cruzado CSS entre vistas, para donde el cambio de vista no va con
   View Transitions (WebKit: Safari y todo iOS; o sin la API). Por qué, en
   viewTransitionGuard.ts.

   Es el mismo fundido que hace Chrome con las View Transitions (base.css):
   la vista que sale se apaga en su sitio (ace-vt-sale) y la que entra
   aparece con un desplazamiento mínimo según el sentido (ace-vt-entra-dcha /
   ace-vt-entra-izda; con movimiento reducido, solo ace-funde), los dos con
   --dur-rapido y --ease-out. Sin la API no hay instantánea de la vista que
   sale, así que se hace un «fantasma»:

   1. justo ANTES de cambiar de ruta (el router avisa con onBeforeChange, con
      el DOM aún en la vista vieja) se clona la vista que se deja: un clon
      inerte, sin ids ni nombres de formulario ni animaciones propias, fijo
      donde se veía y con la opacidad que tenía (si se cambia a mitad de un
      fundido, sigue desde ahí);
   2. cuando React ya ha confirmado la vista nueva (efecto de layout del
      armazón, antes de pintar) el fantasma se pone encima de ella y se
      apaga, y la vista nueva entra (atributo data-entra, shell.css);
   3. el fantasma SIEMPRE se quita y data-entra siempre se borra: al acabar
      su animación, al cancelarse, por un temporizador de respaldo aunque la
      animación no llegue a correr y al empezar otro cambio de vista.
   La vista vieja de verdad se oculta en el acto (Activity, display:none):
   en reposo nunca hay dos vistas. */

import type { NavDirection } from './router.tsx';

export const GHOST_CLASS = 'view-fantasma';
/** Atributo de la vista que entra; su valor es el sentido (o «fundido»). */
export const ENTER_ATTR = 'data-entra';
/** Margen del temporizador de respaldo sobre la duración del fundido. */
export const CROSSFADE_MARGIN_MS = 250;
const FALLBACK_MS = 340;

export type Direction = NavDirection | null;

/** «340ms», «0.34s» → milisegundos. */
export function parseDuration(value: string, fallback = FALLBACK_MS): number {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (!match) return fallback;
  const n = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Quita todos los fantasmas que haya. */
export function removeGhosts(doc: Document = document): number {
  const ghosts = doc.querySelectorAll(`.${GHOST_CLASS}`);
  ghosts.forEach((ghost) => ghost.remove());
  return ghosts.length;
}

interface PendingCrossfade {
  ghost: HTMLElement;
  host: HTMLElement;
  vista: string;
  direction: Direction;
}

let pending: PendingCrossfade | null = null;

/** El esqueleto de una vista que aún se descarga (Shell.tsx, ViewSkeleton). */
export const SKELETON_CLASS = 'view-skeleton';
/** Atributo del fantasma quieto y de la vista escondida mientras la nueva llega. */
export const WAIT_ATTR = 'data-espera';
/** Lo más que se espera a la vista nueva antes de fundir igualmente. */
export const WAIT_MAX_MS = 1500;
/** Corta la espera en curso (otro cambio de vista). */
let cancelWait: (() => void) | null = null;

const viewSelector = (vista: string) => `.views > .view[data-vista="${CSS.escape(vista)}"]`;

/**
 * Clona la vista que se deja, sin enseñarla todavía. Se llama justo antes de
 * cambiar de ruta (el DOM aún es el de la vista que se deja): React puede
 * tardar en confirmar la vista nueva (trozos que se descargan) y el fundido
 * empieza cuando la nueva aparece (playPendingCrossfade).
 */
export function captureLeavingView(
  vista: string,
  direction: Direction,
  doc: Document = document,
): HTMLElement | null {
  pending = null;
  // Por su nombre, no por data-active: React actualiza las vistas ocultas
  // (Activity) con prioridad baja y una ya oculta sigue marcada como activa
  // un rato.
  const view = doc.querySelector<HTMLElement>(viewSelector(vista));
  const host = view?.parentElement;
  if (!view || !host) return null;
  const style = doc.defaultView?.getComputedStyle(view);
  if (!style || style.display === 'none') return null;
  const rect = view.getBoundingClientRect();
  const ghost = view.cloneNode(true) as HTMLElement;
  // Un clon que no es una vista: ni cuenta como vista, ni repite ids, ni
  // roba el grupo a los botones de radio de verdad, ni se toca, ni lo lee
  // un lector de pantalla.
  ghost.className = GHOST_CLASS;
  for (const attr of ['data-vista', 'data-active', ENTER_ATTR, WAIT_ATTR, 'id'])
    ghost.removeAttribute(attr);
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.querySelectorAll('[name]').forEach((el) => el.removeAttribute('name'));
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    margin: '0',
    // Desde donde estaba: si se cambia a mitad de un fundido, sin saltos.
    opacity: style.opacity,
    transform: style.transform === 'none' ? '' : style.transform,
  });
  pending = { ghost, host, vista, direction };
  return ghost;
}

/** Olvida el fantasma preparado. */
export function discardPendingCrossfade(): void {
  pending = null;
}

export interface CrossfadeOptions {
  /** Duración del fundido; si no, el token --dur-rapido. */
  durationMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Fundir ya, aunque la vista nueva siga con su esqueleto (al acabar la espera). */
  skipWait?: boolean;
}

type AnimationEventType = 'animationend' | 'animationcancel';

/**
 * Ejecuta `fn` una sola vez: cuando acaba (o se cancela, según `types`) una
 * de las animaciones `names` del propio `el`, o pasados `ms` aunque no corra.
 */
function onceAnimationDone(
  el: HTMLElement,
  names: readonly string[],
  types: readonly AnimationEventType[],
  ms: number,
  setTimer: (fn: () => void, ms: number) => unknown,
  fn: () => void,
): void {
  let done = false;
  const finish = (event?: Event) => {
    if (done) return;
    // Las animaciones de dentro también burbujean hasta aquí.
    if (event && (event.target !== el || !names.includes((event as AnimationEvent).animationName)))
      return;
    done = true;
    for (const type of types) el.removeEventListener(type, finish);
    fn();
  };
  for (const type of types) el.addEventListener(type, finish);
  setTimer(() => finish(), ms);
}

const enterTurns = new WeakMap<HTMLElement, number>();
const ENTER_ANIMATIONS = ['ace-vt-entra-dcha', 'ace-vt-entra-izda', 'ace-funde'];
const LEAVE_ANIMATIONS = ['ace-vt-sale'];

/**
 * Pone el fantasma preparado encima de la vista nueva y lanza el fundido
 * cruzado. Se llama cuando React ya ha confirmado la vista `vista` (efecto
 * de layout del armazón). Devuelve el fantasma, o null si no hay fundido.
 */
export function playPendingCrossfade(
  vista: string,
  doc: Document = document,
  options: CrossfadeOptions = {},
): HTMLElement | null {
  const prepared = pending;
  pending = null;
  // El fundido anterior (o la espera de uno), si seguía, se acaba aquí.
  cancelWait?.();
  removeGhosts(doc);
  if (!prepared || !prepared.host.isConnected || prepared.vista === vista) return null;
  const entering = doc.querySelector<HTMLElement>(viewSelector(vista));
  if (!entering) return null;

  // La vista nueva aún no ha llegado (su código se descarga: enseña su
  // esqueleto). Fundir ahora era ver el esqueleto y el fantasma a la vez
  // (auditoría web 0.9.0, WebKit): la vieja se queda quieta encima, la nueva
  // escondida debajo, y el fundido empieza cuando la nueva está lista (o a
  // los WAIT_MAX_MS, pase lo que pase).
  if (!options.skipWait && entering.querySelector(`.${SKELETON_CLASS}`)) {
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const { ghost, host } = prepared;
    ghost.setAttribute(WAIT_ATTR, '');
    entering.setAttribute(WAIT_ATTR, '');
    host.appendChild(ghost);
    let done = false;
    let observer: MutationObserver | null = null;
    const stop = () => {
      done = true;
      observer?.disconnect();
      entering.removeAttribute(WAIT_ATTR);
      if (cancelWait === stop) cancelWait = null;
    };
    const go = () => {
      if (done) return;
      stop();
      ghost.remove();
      if (!host.isConnected) return;
      ghost.removeAttribute(WAIT_ATTR);
      pending = { ...prepared, ghost };
      playPendingCrossfade(vista, doc, { ...options, skipWait: true });
    };
    cancelWait = stop;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        if (!entering.querySelector(`.${SKELETON_CLASS}`)) go();
      });
      observer.observe(entering, { childList: true, subtree: true });
    }
    setTimer(go, WAIT_MAX_MS);
    return ghost;
  }

  const tokens = doc.defaultView?.getComputedStyle(doc.documentElement);
  const duration =
    options.durationMs ?? parseDuration(tokens?.getPropertyValue('--dur-rapido') ?? '');
  if (duration <= 0) return null;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const limit = duration + CROSSFADE_MARGIN_MS;

  // La que entra: el atributo relanza su animación (shell.css). Si ya lo
  // tenía (un fundido anterior sin acabar), se quita y se fuerza un estilo
  // para que la animación empiece otra vez desde el principio.
  if (entering.hasAttribute(ENTER_ATTR)) {
    entering.removeAttribute(ENTER_ATTR);
    void entering.offsetWidth;
  }
  entering.setAttribute(ENTER_ATTR, prepared.direction ?? 'fundido');
  // Solo borra el atributo el fundido que lo puso, y solo al ACABAR su
  // animación (o por tiempo): el aviso de que se canceló la entrada anterior
  // (al quitar el atributo, o al ocultarse la vista) llega tarde y no debe
  // cortar esta.
  const turn = (enterTurns.get(entering) ?? 0) + 1;
  enterTurns.set(entering, turn);
  onceAnimationDone(entering, ENTER_ANIMATIONS, ['animationend'], limit, setTimer, () => {
    if (enterTurns.get(entering) === turn) entering.removeAttribute(ENTER_ATTR);
  });

  // La que sale: el fantasma, encima (después en el DOM), se apaga y se va.
  const { ghost, host } = prepared;
  host.appendChild(ghost);
  onceAnimationDone(
    ghost,
    LEAVE_ANIMATIONS,
    ['animationend', 'animationcancel'],
    limit,
    setTimer,
    () => ghost.remove(),
  );
  return ghost;
}
