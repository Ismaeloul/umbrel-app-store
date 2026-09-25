/* Ganchos compartidos por la web y el iPhone de Palco. */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ensureSources, useNow, useSim, type SourceSession } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import type { LiveScore, Match } from '../../../core/types';

/** Tamaño de un contenedor (ResizeObserver). */
export function useSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize((s) => (Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height }));
      }
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Sesión de fuentes de un partido o canal; lanza el comprobador la primera vez. */
export function useSources(kind: 'match' | 'channel', id: string | null | undefined): SourceSession | undefined {
  const key = id ? `${kind}:${id}` : null;
  const session = useSim((s) => (key ? s.sourceSessions[key] : undefined));
  useEffect(() => {
    if (id) ensureSources(kind, id);
  }, [kind, id]);
  return session;
}

export function useMatch(id: string | null | undefined): Match | undefined {
  return useSim((s) => (id ? s.agenda.find((m) => m.id === id) : undefined));
}

export function useScore(m: Match | undefined | null): LiveScore | null {
  const now = useNow();
  return useMemo(() => (m ? scoreAt(m, now) : null), [m, now]);
}

export function useReducedMotion(): boolean {
  const rm = useSim((s) => s.reducedMotion);
  const [sys, setSys] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return rm || sys;
}

/** «Momento de gol»: lado que ha marcado durante 1,2 s tras `lastGoal`. */
export function useGoalFlash(matchId: string | null | undefined): 'home' | 'away' | null {
  const last = useSim((s) => s.lastGoal);
  const [flash, setFlash] = useState<'home' | 'away' | null>(null);
  useEffect(() => {
    if (!last || !matchId || last.matchId !== matchId) return;
    if (Date.now() - last.at > 2000) return;
    setFlash(last.side);
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [last, matchId]);
  return flash;
}

/** Controles que se esconden solos: `poke()` los enseña otros `ms`; `hold()` los deja
    fijos; `hide()` los esconde ya (toque sobre el vídeo). */
export function useAutoHide(active: boolean, ms = 3000): [boolean, () => void, () => void, () => void] {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, [ms]);
  const poke = useCallback(() => {
    setVisible(true);
    if (active) arm();
  }, [active, arm]);
  const hold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
  }, []);
  const hide = useCallback(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, [active]);
  useEffect(() => {
    if (active) arm();
    else {
      if (timer.current) clearTimeout(timer.current);
      setVisible(true);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, arm]);
  return [visible, poke, hold, hide];
}

/** Acción con segundo toque: la primera pulsación arma, la segunda dispara. */
export function useSecondTap(ms = 5000): [boolean, (fn: () => void) => void, () => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tap = useCallback(
    (fn: () => void) => {
      if (armed) {
        setArmed(false);
        if (timer.current) clearTimeout(timer.current);
        fn();
      } else {
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), ms);
      }
    },
    [armed, ms],
  );
  const reset = useCallback(() => {
    setArmed(false);
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [armed, tap, reset];
}

/** Días de la tira: de ayer a +5 (los 7 que tiene la agenda). */
export function useDays(nowMs: number): number[] {
  return useMemo(() => {
    const d = new Date(nowMs);
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Array.from({ length: 7 }, (_, i) => base + (i - 1) * 86400000);
  }, [Math.floor(nowMs / 3600_000)]);
}

export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Estado local persistido solo en memoria de la sesión (día elegido, filtro). */
const memory = new Map<string, unknown>();
export function useMemoryState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  const set = useCallback(
    (nv: T | ((p: T) => T)) => {
      setV((prev) => {
        const next = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
        memory.set(key, next);
        return next;
      });
    },
    [key],
  );
  return [v, set];
}

/** Pulsación larga (450 ms) sin mover el dedo: abre menús contextuales. Devuelve los
    manejadores para extender un elemento; cancela si el puntero se desplaza > 8 px. */
export function useLongPress(onLong: (() => void) | undefined, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  if (!onLong) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onLong();
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation();
        e.preventDefault();
        fired.current = false;
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onLong();
    },
  };
}

/** Copia al portapapeles sin romper si no hay permiso. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
