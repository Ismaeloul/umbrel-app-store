/* Consultas de medios desde JS. El CSS decide casi todo; esto es para lo que
   el CSS no puede: montar o no una región (columna, panel), silenciar toasts
   con el vídeo a pantalla completa, elegir el tamaño de un gesto... */

import { useSyncExternalStore } from 'react';

export const MEDIA = {
  /** Tableta: carril lateral en vez de barra inferior. */
  tablet: '(min-width: 768px)',
  /** Escritorio: aparece el panel lateral. */
  desktop: '(min-width: 1024px)',
  /** Pantalla ancha: agenda + reproductor + panel a la vez. */
  wide: '(min-width: 1280px)',
  /** Móvil en horizontal: el reproductor ocupa la pantalla. */
  phoneLandscape: '(orientation: landscape) and (max-height: 540px)',
  /** Ratón de verdad: hover y menús contextuales. */
  finePointer: '(hover: hover) and (pointer: fine)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
  dark: '(prefers-color-scheme: dark)',
} as const;

function safeMatch(query: string): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query)
      : null;
  } catch {
    return null;
  }
}

export function matches(query: string): boolean {
  return safeMatch(query)?.matches ?? false;
}

export function subscribeMedia(query: string, listener: () => void): () => void {
  const list = safeMatch(query);
  if (!list) return () => {};
  // Safari < 14 solo tiene addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  }
  list.addListener(listener);
  return () => list.removeListener(listener);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => subscribeMedia(query, listener),
    () => matches(query),
    () => false,
  );
}

export type LayoutKind = 'mobile' | 'tablet' | 'desktop' | 'wide';

/** Tipo de maquetación según el ancho (las mismas fronteras que el CSS del armazón). */
export function useLayoutKind(): LayoutKind {
  const tablet = useMediaQuery(MEDIA.tablet);
  const desktop = useMediaQuery(MEDIA.desktop);
  const wide = useMediaQuery(MEDIA.wide);
  if (wide) return 'wide';
  if (desktop) return 'desktop';
  if (tablet) return 'tablet';
  return 'mobile';
}

export function prefersReducedMotion(): boolean {
  return matches(MEDIA.reducedMotion);
}
