/* Router propio mínimo, sin dependencias.

   - La ruta vive en estado de React (no en un almacén externo) y cada cambio
     va dentro de startTransition: así React lanza la View Transition y, si la
     vista nueva aún se está descargando, deja la anterior en pantalla en vez
     de enseñar un parpadeo.
   - history.pushState/replaceState con `?vista=`; el botón atrás del
     navegador (popstate) vuelve con la transición «atrás».
   - El sentido (adelante/atrás) va como tipo de transición para el CSS
     (:active-view-transition-type en base.css).

     const navigate = useNavigate();
     navigate({ vista: 'partido', id: match.id, canal: null });
     navigate('biblioteca');
     const [q, setQ] = useSearchParam('q'); */

import {
  addTransitionType,
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  parseRoute,
  parseVista,
  routeDepth,
  sameRoute,
  searchFor,
  viewParams,
  VISTA_PARAMS,
  type Route,
  type Vista,
} from './routes.ts';

/* ---- Parámetros de cada vista ------------------------------------------------
   Al cambiar de vista, la URL se queda con los globales y los de la vista nueva
   (routes.ts, VISTA_PARAMS). Lo que cada vista tenía al dejarla se recuerda
   aquí y vuelve con ella: Canales reabre en su pestaña, con su categoría de
   IPTV y sus filtros, igual que su scroll (scroll-memory.ts). Atrás y Adelante
   no lo necesitan: cada entrada del historial guarda su propia URL. */
const viewParamsMemory = new Map<Vista, string>();

/** Guarda los parámetros de la vista actual tal y como están en la URL. */
export function noteViewParams(search: string = globalThis.location?.search ?? ''): void {
  const vista = parseRoute(search).vista;
  viewParamsMemory.set(vista, viewParams(vista, search));
}

/** Lo que `vista` tenía en la URL al dejarla ('' si nada). */
export function rememberedViewParams(vista: Vista): string {
  return viewParamsMemory.get(vista) ?? '';
}

/**
 * Deja un parámetro preparado para cuando se abra `vista` (sin tocar la URL de
 * la vista actual): «Buscar en el motor» desde Canales, o la pestaña «Listas»
 * tras guardar una lista en Ajustes.
 */
export function rememberViewParam(vista: Vista, name: string, value: string | null): void {
  if (!VISTA_PARAMS[vista].includes(name)) return;
  const params = new URLSearchParams(viewParamsMemory.get(vista) ?? '');
  if (value === null || value === '') params.delete(name);
  else params.set(name, value);
  viewParamsMemory.set(vista, params.toString());
}

/** Solo para los tests. */
export function resetViewParamsMemory(): void {
  viewParamsMemory.clear();
}

export interface NavigateOptions {
  /** Sustituye la entrada del historial en vez de añadir una. */
  replace?: boolean;
  /** Sin transición de vista (cambios internos). */
  instant?: boolean;
}

export type Navigate = (to: Route | string, options?: NavigateOptions) => void;

interface RouterValue {
  route: Route;
  /** La ruta anterior dentro de la app (para volver al minimizar). */
  previous: Route | null;
  navigate: Navigate;
  /** Atrás en el historial si la entrada anterior es de la app; si no, a `fallback`. */
  back(fallback?: Route): void;
}

const RouterContext = createContext<RouterValue | null>(null);

interface HistoryState {
  /** Profundidad dentro de la app: 0 es la primera página abierta. */
  aceDepth?: number;
}

function readDepth(): number {
  const state = (typeof history !== 'undefined' ? history.state : null) as HistoryState | null;
  return typeof state?.aceDepth === 'number' ? state.aceDepth : 0;
}

export interface RouterProviderProps {
  children: ReactNode;
  /** Se llama antes de cambiar de ruta (el armazón guarda el scroll). */
  onBeforeChange?: (from: Route, to: Route) => void;
  /** Para los tests. */
  initialSearch?: string;
}

export function RouterProvider({ children, onBeforeChange, initialSearch }: RouterProviderProps) {
  const [state, setState] = useState<{ route: Route; previous: Route | null }>(() => ({
    route: parseRoute(initialSearch ?? globalThis.location?.search ?? ''),
    previous: null,
  }));
  // La ruta confirmada más reciente, para avisar a onBeforeChange ANTES de
  // cambiar (el armazón guarda ahí el scroll de la vista que se deja).
  const routeRef = useRef(state.route);
  routeRef.current = state.route;
  // La ruta a la que se va, aunque la transición aún no la haya confirmado:
  // un doble clic llama dos veces a navigate antes del render y, comparando
  // solo con la confirmada, apilaba dos entradas iguales en el historial
  // («atrás» volvía al mismo partido).
  const targetRef = useRef(state.route);
  const beforeChange = useRef(onBeforeChange);
  beforeChange.current = onBeforeChange;

  const commit = useCallback((next: Route, direction: 'adelante' | 'atras' | null) => {
    if (!sameRoute(routeRef.current, next)) beforeChange.current?.(routeRef.current, next);
    setState((current) =>
      sameRoute(current.route, next) ? current : { route: next, previous: current.route },
    );
    if (direction) addTransitionType(direction);
  }, []);

  const navigate = useCallback<Navigate>(
    (to, options = {}) => {
      const next = typeof to === 'string' ? parseVista(to) : to;
      const current = targetRef.current;
      if (sameRoute(current, next) && !options.replace) return;
      targetRef.current = next;
      const currentSearch = globalThis.location?.search ?? '';
      noteViewParams(currentSearch);
      const search = searchFor(next, currentSearch, rememberedViewParams(next.vista));
      const url = `${globalThis.location?.pathname ?? '/'}${search}${globalThis.location?.hash ?? ''}`;
      try {
        if (options.replace)
          history.replaceState({ aceDepth: readDepth() } satisfies HistoryState, '', url);
        else history.pushState({ aceDepth: readDepth() + 1 } satisfies HistoryState, '', url);
      } catch {}
      const direction = routeDepth(next) >= routeDepth(current) ? 'adelante' : 'atras';
      if (options.instant) {
        commit(next, null);
        return;
      }
      startTransition(() => commit(next, direction));
    },
    [commit],
  );

  const back = useCallback(
    (fallback: Route = { vista: 'agenda' }) => {
      if (readDepth() > 0) {
        history.back();
        return;
      }
      navigate(fallback, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    try {
      // La posición de cada vista la restaura el armazón (Shell), no el navegador.
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      if (typeof (history.state as HistoryState | null)?.aceDepth !== 'number') {
        history.replaceState({ ...(history.state as object | null), aceDepth: 0 }, '');
      }
    } catch {}
    const onPop = () => {
      noteViewParams(location.search);
      const next = parseRoute(location.search);
      targetRef.current = next;
      // React pinta en el acto (y SIN View Transition) lo que se lanza dentro
      // de un `popstate`, para que el navegador restaure el scroll. Aquí el
      // scroll lo restaura el armazón, así que la vuelta atrás se lanza justo
      // después del evento: así lleva el mismo fundido que cualquier cambio
      // de pestaña (salir de un partido, Isma, 0.9.0). Sin la API (jsdom,
      // navegadores viejos) no hay fundido que esperar: en el acto. Si en ese
      // instante ya se ha ido a otra parte (otro popstate, un clic), manda eso.
      const go = () => {
        if (targetRef.current === next) startTransition(() => commit(next, 'atras'));
      };
      if (typeof document.startViewTransition === 'function') setTimeout(go, 0);
      else go();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [commit]);

  const value = useMemo<RouterValue>(
    () => ({ route: state.route, previous: state.previous, navigate, back }),
    [state, navigate, back],
  );
  return <RouterContext value={value}>{children}</RouterContext>;
}

function useRouter(): RouterValue {
  const value = use(RouterContext);
  if (!value) throw new Error('Falta <RouterProvider> por encima.');
  return value;
}

export function useRoute(): Route {
  return useRouter().route;
}

export function usePreviousRoute(): Route | null {
  return useRouter().previous;
}

export function useNavigate(): Navigate {
  return useRouter().navigate;
}

export function useBack(): (fallback?: Route) => void {
  return useRouter().back;
}

/**
 * Un parámetro propio de la vista en la URL (`q`, `pestana`...). Se escribe
 * con replaceState: no llena el historial ni cambia de vista. Tiene que estar
 * en VISTA_PARAMS (routes.ts) para que no se cuele en las demás vistas.
 */
export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const route = useRoute();
  const [value, setValue] = useState<string | null>(() =>
    new URLSearchParams(globalThis.location?.search ?? '').get(name),
  );
  useEffect(() => {
    setValue(new URLSearchParams(location.search).get(name));
  }, [name, route]);
  const update = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(location.search);
      if (next === null || next === '') params.delete(name);
      else params.set(name, next);
      const search = params.toString().replace(/%2F/gi, '/');
      try {
        history.replaceState(
          history.state,
          '',
          `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
        );
      } catch {}
      noteViewParams();
      setValue(next === '' ? null : next);
    },
    [name],
  );
  return [value, update];
}
