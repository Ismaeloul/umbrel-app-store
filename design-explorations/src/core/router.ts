/* Router por hash: `#/<dir>/<mode>/<screen>[/<param>[/<sub>]]`.
   dir: 1..5 · mode: web | iphone · screen: agenda | partido | canal | biblioteca |
   buscar | ajustes | gustos | emparejar. Sin dir → galería. */

import { useSyncExternalStore } from 'react';

export type Mode = 'web' | 'iphone';
export type Screen = 'agenda' | 'partido' | 'canal' | 'biblioteca' | 'buscar' | 'ajustes' | 'gustos' | 'emparejar';

export interface Route {
  dir: number | null;
  mode: Mode;
  screen: Screen;
  param: string | null;
  sub: string | null;
  /** Dirección del último cambio, para animar. */
  direction: 'forward' | 'back' | 'none';
  /** Cuántas veces cambió (para keys). */
  seq: number;
}

const DEPTH: Record<Screen, number> = { agenda: 0, biblioteca: 0, buscar: 0, ajustes: 0, gustos: 1, emparejar: -1, partido: 2, canal: 2 };

function parse(hash: string): Omit<Route, 'direction' | 'seq'> {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const dir = parts[0] && /^[1-5]$/.test(parts[0]) ? Number(parts[0]) : null;
  const mode: Mode = parts[1] === 'iphone' ? 'iphone' : 'web';
  const screen = (parts[2] as Screen) || 'agenda';
  const valid: Screen[] = ['agenda', 'partido', 'canal', 'biblioteca', 'buscar', 'ajustes', 'gustos', 'emparejar'];
  return { dir, mode, screen: valid.includes(screen) ? screen : 'agenda', param: parts[3] ? decodeURIComponent(parts[3]) : null, sub: parts[4] ? decodeURIComponent(parts[4]) : null };
}

let current: Route = { ...parse(location.hash), direction: 'none', seq: 0 };
const listeners = new Set<() => void>();
const stack: string[] = [location.hash];

function update(direction: Route['direction']) {
  const next = parse(location.hash);
  current = { ...next, direction, seq: current.seq + 1 };
  for (const l of listeners) l();
}

window.addEventListener('hashchange', () => {
  // Determina si venimos de atrás: si el hash nuevo es el penúltimo del stack.
  const h = location.hash;
  const idx = stack.lastIndexOf(h);
  if (idx >= 0 && idx === stack.length - 2) {
    stack.pop();
    update('back');
  } else {
    const prev = parse(stack[stack.length - 1] ?? '');
    const nxt = parse(h);
    stack.push(h);
    update(DEPTH[nxt.screen] >= DEPTH[prev.screen] ? 'forward' : 'back');
  }
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

export function buildHash(dir: number | null, mode: Mode, screen: Screen = 'agenda', param?: string | null, sub?: string | null): string {
  if (dir === null) return '#/';
  let h = `#/${dir}/${mode}/${screen}`;
  if (param) h += `/${encodeURIComponent(param)}`;
  if (sub) h += `/${encodeURIComponent(sub)}`;
  return h;
}

export function navigate(screen: Screen, param?: string | null, sub?: string | null, opts: { replace?: boolean } = {}) {
  const h = buildHash(current.dir, current.mode, screen, param, sub);
  if (h === location.hash) return;
  if (opts.replace) {
    stack[stack.length - 1] = h;
    history.replaceState(null, '', h);
    update('none');
  } else {
    location.hash = h;
  }
}

export function back(fallback: Screen = 'agenda') {
  if (stack.length > 1) history.back();
  else navigate(fallback, null, null, { replace: true });
}

export function go(dir: number | null, mode: Mode = 'web', screen: Screen = 'agenda') {
  location.hash = buildHash(dir, mode, screen);
}

/** Pantalla «raíz» de la pestaña (para la tab bar). */
export function tabOf(screen: Screen): 'agenda' | 'biblioteca' | 'buscar' | 'ajustes' {
  switch (screen) {
    case 'biblioteca':
    case 'canal':
      return 'biblioteca';
    case 'buscar':
      return 'buscar';
    case 'ajustes':
    case 'gustos':
      return 'ajustes';
    default:
      return 'agenda';
  }
}
