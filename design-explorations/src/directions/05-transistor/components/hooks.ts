/* Ganchos compartidos por la web y el iPhone. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNow, useSim } from '../../../core/store';
import type { SourceSession } from '../../../core/store';
import type { Match } from '../../../core/types';

export function useSourceSession(kind: 'match' | 'channel', id: string | null): SourceSession | undefined {
  return useSim((s) => (id ? s.sourceSessions[`${kind}:${id}`] : undefined));
}

/** Pulso de gol: 3 s desde `state.lastGoal.at`. */
export function useGoalPulse(): { on: boolean; matchId: string | null; side: 'home' | 'away' | null } {
  const lastGoal = useSim((s) => s.lastGoal);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!lastGoal) return;
    const remaining = 3000 - (Date.now() - lastGoal.at);
    if (remaining <= 0) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), remaining);
    return () => clearTimeout(t);
  }, [lastGoal]);
  return { on: on && !!lastGoal, matchId: on && lastGoal ? lastGoal.matchId : null, side: on && lastGoal ? lastGoal.side : null };
}

/** Pila de cosas cerrables con Esc (hojas, menús, pantalla completa). */
const closers: { id: number; close: () => void }[] = [];
let closerSeq = 1;

export function useEscapable(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const id = closerSeq++;
    closers.push({ id, close: () => closeRef.current() });
    return () => {
      const i = closers.findIndex((c) => c.id === id);
      if (i >= 0) closers.splice(i, 1);
    };
  }, [open]);
}

/** Cierra lo último abierto. Devuelve true si había algo. */
export function closeTop(): boolean {
  const top = closers[closers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** Segundo toque: la primera pulsación arma, la segunda ejecuta; se desarma sola. */
export function useSecondTap(run: () => void, ms = 5000): { armed: boolean; tap: () => void; disarm: () => void } {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = useCallback(() => {
    setArmed(false);
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const tap = useCallback(() => {
    if (armed) {
      disarm();
      run();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), ms);
  }, [armed, disarm, ms, run]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { armed, tap, disarm };
}

/** Reloj simulado + partidos del día elegido. */
export function useDayMatches(dayIso: string): { matches: Match[]; now: number } {
  const agenda = useSim((s) => s.agenda);
  const now = useNow();
  const matches = useMemo(() => agenda.filter((m) => m.date === dayIso).sort((a, b) => a.start - b.start), [agenda, dayIso]);
  return { matches, now };
}

/** Días de la tira: 7 alrededor de hoy (−1 … +5), como la agenda de muestra. */
export function useWeekDays(nowMs: number): { iso: string; ms: number }[] {
  return useMemo(() => {
    const n = new Date(nowMs);
    const out: { iso: string; ms: number }[] = [];
    for (let d = -1; d <= 5; d++) {
      const dt = new Date(n.getFullYear(), n.getMonth(), n.getDate() + d, 12, 0, 0, 0);
      out.push({ iso: isoOf(dt.getTime()), ms: dt.getTime() });
    }
    return out;
  }, [Math.floor(nowMs / 3_600_000)]);
}

export function isoOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Valor con retardo (para no buscar en cada tecla). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Ancho de la ventana (para adaptar la web a móvil). */
export function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Marca temporal para un contador (caducidad del código, etc.). */
export function useCountdown(until: number): number {
  const [left, setLeft] = useState(() => Math.max(0, until - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, until - Date.now())), 500);
    return () => clearInterval(t);
  }, [until]);
  return left;
}
