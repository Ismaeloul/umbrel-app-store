/* Cómo se anima el cambio de vista y guardia de las View Transitions.

   En el iPhone (Safari, vista previa de la 0.8.4) cambiar entre pestañas
   (Buscar ↔ Canales) dejaba las dos vistas pintadas a la vez, enteras, una
   encima de otra, y sin fundido. La causa es un fallo de WebKit con las
   transiciones por vista (transitions.ts, `<ViewTransition>` de React dentro
   de cada `<Activity>` en Shell.tsx):

   - WebKit crea un ::view-transition-old(nombre) también para el elemento
     que solo ENTRA (no tenía instantánea vieja). Como la vista que entra
     lleva la clase .ace-vista-entra, base.css le da la animación de salida
     (`::view-transition-old(.ace-vista-entra)` → ace-vt-sale).
   - React da a cada <ViewTransition> un nombre fijo (_t_1_, _t_2_…) y, al
     acabar cada transición, cancela sus animaciones (react-dom:
     `transition.finished.finally(() => animation.cancel())`).
   - WebKit guarda el estado de las animaciones CSS de esos pseudoelementos
     de una transición a la siguiente: cuando esa misma vista SALE en la
     transición siguiente, su ::view-transition-old(_t_N_) tiene la misma
     animación (ace-vt-sale) que la que se canceló y WebKit no la vuelve a
     lanzar. La instantánea de la vista que sale se queda a opacidad 1
     durante toda la transición, encima de la nueva: las dos vistas
     superpuestas. Si la transición se alarga (iframe de la vista previa,
     página ocupada), se ve el tiempo que dure.
   Reproducido con WebKit de Playwright (iPhone 15 Pro) y con una página
   mínima de dos elementos (scratchpad 084/safari, vt-repetida-entra.cjs);
   Chromium no lo hace.

   Por eso:
   - `pickViewMotion`: en WebKit (Safari y cualquier navegador de iOS) y donde
     no hay View Transitions, el cambio de vista NO va con View Transitions
     sino con un fundido cruzado CSS con los mismos fotogramas, duración y
     curva (viewCrossfade.ts). Chrome, Edge… siguen con View Transitions.
   - `installViewTransitionGuard`: ninguna View Transition (las que quedan:
     partido, canal, reproductor, barras) se queda viva más de lo que duran
     sus animaciones: si sigue a ese tiempo más un margen, o la página vuelve
     a primer plano con una a medias, se salta (skipTransition). El navegador
     quita entonces las instantáneas y se ve el DOM real, donde solo la vista
     activa se pinta (Activity la oculta con display:none). */

/** 'vt': View Transitions por vista; 'css': fundido cruzado CSS (viewCrossfade.ts). */
export type ViewMotion = 'vt' | 'css';

export interface MotionEnv {
  /** El navegador tiene document.startViewTransition. */
  viewTransitions: boolean;
  /** navigator.vendor («Apple Computer, Inc.» en Safari y en todo iOS). */
  vendor: string;
}

export function pickViewMotion(env: MotionEnv): ViewMotion {
  if (!env.viewTransitions) return 'css';
  if (/apple/i.test(env.vendor)) return 'css';
  return 'vt';
}

let cachedMotion: ViewMotion | null = null;

/** El modo de esta página (no cambia mientras vive). */
export function viewMotion(): ViewMotion {
  if (cachedMotion) return cachedMotion;
  if (typeof document === 'undefined') return 'css';
  cachedMotion = pickViewMotion({
    viewTransitions: typeof document.startViewTransition === 'function',
    vendor: typeof navigator === 'undefined' ? '' : navigator.vendor || '',
  });
  return cachedMotion;
}

/** Solo para pruebas. */
export function resetViewMotion(): void {
  cachedMotion = null;
}

/* ---- Guardia --------------------------------------------------------------- */

type ViewTransitionLike = Pick<ViewTransition, 'ready' | 'finished' | 'skipTransition'>;

type StartViewTransition = (
  arg?: ViewTransitionUpdateCallback | StartViewTransitionOptions,
) => ViewTransitionLike;

/** Lo que la guardia usa del documento (el real o uno falso en las pruebas). */
export interface GuardDocument {
  startViewTransition?: StartViewTransition;
  readonly documentElement: Pick<Element, 'getAnimations'>;
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface GuardOptions {
  /** Margen sobre el final previsto de la animación más larga. */
  marginMs?: number;
  /** Se llama cada vez que la guardia salta una transición. */
  onSkip?: (reason: SkipReason) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export type SkipReason = 'animacion' | 'visibilidad';

export const GUARD_MARGIN_MS = 1000;

const isViewTransitionAnimation = (animation: Animation): boolean => {
  const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '';
  return typeof pseudo === 'string' && pseudo.startsWith('::view-transition');
};

/** Animaciones sobre los pseudoelementos ::view-transition del documento. */
export function viewTransitionAnimations(doc: Pick<GuardDocument, 'documentElement'>): Animation[] {
  const root = doc.documentElement;
  if (typeof root.getAnimations !== 'function') return [];
  try {
    return root.getAnimations({ subtree: true }).filter(isViewTransitionAnimation);
  } catch {
    return [];
  }
}

/** Cuánto falta (ms) para que acabe la animación finita más larga. */
export function remainingTransitionMs(animations: readonly Animation[]): number {
  let longest = 0;
  for (const animation of animations) {
    try {
      const end = Number(animation.effect?.getComputedTiming().endTime ?? 0);
      if (!Number.isFinite(end)) continue;
      const current = Number(animation.currentTime ?? 0) || 0;
      longest = Math.max(longest, end - current);
    } catch {
      // Sin tiempos calculables: no cuenta.
    }
  }
  return longest;
}

/**
 * Envuelve `doc.startViewTransition` (la llama React) para que ninguna
 * transición siga viva pasado el final de sus animaciones más un margen, ni
 * al volver la página a primer plano. Solo salta transiciones que ya
 * arrancaron (`ready`): saltar antes la haría fallar y React lo apuntaría
 * como error. Devuelve cómo quitarla; sin la API no hace nada.
 */
export function installViewTransitionGuard(
  doc: GuardDocument,
  options: GuardOptions = {},
): () => void {
  const original = doc.startViewTransition;
  if (typeof original !== 'function') return () => {};
  const margin = options.marginMs ?? GUARD_MARGIN_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as number));

  // Transiciones ya arrancadas y aún vivas (React solo lleva una a la vez).
  const running = new Set<ViewTransitionLike>();
  let installed = true;

  const skip = (transition: ViewTransitionLike, reason: SkipReason) => {
    if (!running.delete(transition)) return;
    try {
      transition.skipTransition();
    } catch {
      // Ya había acabado.
    }
    options.onSkip?.(reason);
  };

  const track = (transition: ViewTransitionLike) => {
    let done = false;
    let timer: unknown = null;
    transition.ready.then(
      () => {
        if (done) return;
        running.add(transition);
        const remaining = remainingTransitionMs(viewTransitionAnimations(doc));
        timer = setTimer(() => skip(transition, 'animacion'), remaining + margin);
      },
      () => {},
    );
    const settle = () => {
      done = true;
      running.delete(transition);
      if (timer !== null) clearTimer(timer);
    };
    transition.finished.then(settle, settle);
  };

  const guarded: StartViewTransition = function (arg) {
    const transition = original.call(doc, arg);
    if (installed && transition) track(transition);
    return transition;
  };
  doc.startViewTransition = guarded;

  const onVisibility = () => {
    if (doc.visibilityState !== 'visible') return;
    for (const transition of [...running]) skip(transition, 'visibilidad');
  };
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    installed = false;
    doc.removeEventListener('visibilitychange', onVisibility);
    if (doc.startViewTransition === guarded) doc.startViewTransition = original;
  };
}
