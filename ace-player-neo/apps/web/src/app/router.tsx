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
import { parseRoute, parseVista, routeDepth, sameRoute, searchFor, type Route } from './routes.ts';

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
      const search = searchFor(next, globalThis.location?.search ?? '');
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
      const next = parseRoute(location.search);
      targetRef.current = next;
      startTransition(() => commit(next, 'atras'));
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
 * Un parámetro propio de la vista en la URL (`q`, `dia`, `pestana`...). Se
 * escribe con replaceState: no llena el historial ni cambia de vista.
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
      setValue(next === '' ? null : next);
    },
    [name],
  );
  return [value, update];
}
