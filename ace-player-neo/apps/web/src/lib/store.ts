/* Almacén mínimo para el estado local de la interfaz (arquitectura §9: «en un
   almacén mínimo con useSyncExternalStore, sin otra librería»).

   Lo que viene del backend va en TanStack Query, no aquí. Esto es para lo que
   solo existe en esta pestaña: avisos, atajos registrados, tema, estado del
   tiempo real, si el reproductor está activo...

   Ojo: una actualización de un almacén externo nunca es una transición de
   React (se pinta de golpe). Por eso el router NO usa esto: navegar tiene que
   ir dentro de startTransition para que haya View Transitions. */

import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      // Copia: un oyente puede darse de baja mientras se avisa.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Lee un trozo del almacén y repinta solo si ese trozo cambia. El selector
 * puede devolver objetos nuevos: se compara con `isEqual` (por defecto,
 * Object.is) para no entrar en un bucle de repintados.
 */
export function useStore<T, S = T>(
  store: Store<T>,
  selector: (state: T) => S = (state) => state as unknown as S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const cache = useRef<{ state: T; selected: S } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.get();
    const previous = cache.current;
    if (previous && previous.state === state) return previous.selected;
    const selected = selector(state);
    if (previous && isEqual(previous.selected, selected)) {
      cache.current = { state, selected: previous.selected };
      return previous.selected;
    }
    cache.current = { state, selected };
    return selected;
    // El selector y la comparación se toman del primer render a propósito:
    // suelen ser funciones nuevas en cada render y meterlos en las
    // dependencias invalidaría la caché y daría repintados sin fin.
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Igualdad superficial de objetos y listas, para selectores que construyen objetos. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      return false;
  }
  return true;
}
