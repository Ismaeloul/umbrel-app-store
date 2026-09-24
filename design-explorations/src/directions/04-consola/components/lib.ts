/* Consola · lógica de presentación compartida entre la web y el iPhone:
   palabras del producto para cada estado, resúmenes de señal, detección de
   Content ID, agrupaciones y pequeños hooks. Nada de red. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item, Match, PlayerPhase, PlayerState, Source } from '../../../core/types';
import { derivePhase, ensureSources, getState, isEngaged, isFavorite, matchById, useNow, useSim, type SourceSession } from '../../../core/store';
import { scoreAt, phaseOf } from '../../../core/score';
import { competition, team } from '../../../core/data/teams';
import { hhmm, secondsText, shortHash } from '../../../core/format';

/** Convierte un instante del reloj real (Date.now) al reloj simulado para pintarlo. */
export function simTime(realMs: number): number {
  return realMs + getState().clockOffset;
}

// ---------------------------------------------------------------- Palabras del producto

export type DotTone = 'ok' | 'weak' | 'fail' | 'checking' | 'queued' | 'idle' | 'live' | 'accent';

export interface SourceLabel {
  tone: DotTone;
  word: string; // Verificada · Floja · Sin señal · Comprobando · En cola · Reportada
  detail: string; // «1080p», «reintento 21:31»…
}

export function sourceLabel(src: Source, nowMs: number): SourceLabel {
  if (src.quarantined) return { tone: 'fail', word: 'Reportada', detail: src.retryAt ? `se vuelve a probar a las ${hhmm(simTime(src.retryAt))}` : '' };
  switch (src.state) {
    case 'working':
      return { tone: 'ok', word: 'Verificada', detail: src.resolution };
    case 'weak':
      return { tone: 'weak', word: 'Floja', detail: src.resolution };
    case 'failed':
      return { tone: 'fail', word: 'Sin señal', detail: src.retryAt ? `reintento ${hhmm(simTime(src.retryAt))}` : '' };
    case 'checking':
      return { tone: 'checking', word: 'Comprobando', detail: '' };
    default:
      return { tone: 'queued', word: 'En cola', detail: '' };
  }
}

export interface SignalSummary {
  tone: DotTone;
  text: string; // «3 de 6 verificadas»
  short: string; // «3/6»
}

/** Resumen de señal de un partido (regla común a todas las propuestas):
 *  con comprobador → «3 señales» · «Floja» · «Comprobando» (solo si hay fuentes en cola o probándose) · «Sin señal · 21:31»;
 *  sin comprobador → «Señal lista» (en directo o a menos de 45 min), «Se comprueba 45 min antes» (a menos de 6 h) o nada. */
export function signalSummary(session: SourceSession | undefined, match: Match, nowMs: number): SignalSummary {
  const phase = phaseOf(match, nowMs);
  if (phase === 'finished') return { tone: 'idle', text: '', short: '' };
  if (session) {
    const s = session.sources;
    const ok = s.filter((x) => x.state === 'working').length;
    const weak = s.filter((x) => x.state === 'weak').length;
    const checking = s.some((x) => x.state === 'checking');
    const queued = s.some((x) => x.state === 'queued');
    if (ok) return { tone: 'ok', text: ok === 1 ? '1 señal' : `${ok} señales`, short: ok === 1 ? '1 señal' : `${ok} señales` };
    if (weak) return { tone: 'weak', text: 'Floja', short: 'Floja' };
    // El giro solo cuando una fuente se está probando; en cola, punto estático gris.
    if (checking) return { tone: 'checking', text: 'Comprobando', short: 'Comprobando' };
    if (queued) return { tone: 'queued', text: 'Comprobando', short: 'Comprobando' };
    const retry = s.find((x) => x.retryAt)?.retryAt;
    return { tone: 'fail', text: retry ? `Sin señal · ${hhmm(simTime(retry))}` : 'Sin señal', short: 'Sin señal' };
  }
  const until = match.start - nowMs;
  if (phase === 'live' || until < 45 * 60_000) return { tone: 'ok', text: 'Señal lista', short: 'Señal lista' };
  if (until < 6 * 3600_000) return { tone: 'queued', text: 'Se comprueba 45 min antes', short: 'Pendiente' };
  return { tone: 'idle', text: '', short: '' };
}

/** Resumen del comprobador para la cabecera «Fuentes»: palabras, no fracciones. */
export function sessionSummary(session: SourceSession): { tone: DotTone; text: string } {
  const s = session.sources;
  const ok = s.filter((x) => x.state === 'working').length;
  const weak = s.filter((x) => x.state === 'weak').length;
  const checking = s.some((x) => x.state === 'checking');
  const pending = s.filter((x) => x.state === 'checking' || x.state === 'queued').length;
  if (session.research) return { tone: 'checking', text: 'Rebuscando…' };
  if (ok) return { tone: pending ? (checking ? 'checking' : 'queued') : 'ok', text: ok === 1 ? '1 señal' : `${ok} señales` };
  if (pending) return { tone: checking ? 'checking' : 'queued', text: 'Comprobando' };
  if (weak) return { tone: 'weak', text: 'Solo señal floja' };
  return { tone: 'fail', text: 'Sin señal' };
}

export type LiveButton = 'live' | 'behind' | 'resume' | 'off';

export function liveButtonState(p: PlayerState): LiveButton {
  if (p.conn !== 'activa') return 'off';
  if (p.media === 'paused') return 'resume';
  if (p.behindS < 1.25) return 'live';
  return 'behind';
}

export function liveButtonText(p: PlayerState): string {
  switch (liveButtonState(p)) {
    case 'live':
      return 'Directo';
    case 'behind':
      return `Ir al directo · −${Math.round(p.behindS)} s`;
    case 'resume':
      return 'Reanudar';
    default:
      return 'Directo';
  }
}

export function phaseWord(phase: PlayerPhase): string {
  switch (phase) {
    case 'idle':
      return 'En reposo';
    case 'cargando':
      return 'Conectando';
    case 'buffer':
      return 'Cargando';
    case 'reproduciendo':
      return 'En pantalla';
    case 'pausado':
      return 'En pausa';
    case 'bloqueado':
      return 'Toca para reproducir';
    case 'buscando':
      return 'Saltando';
    case 'reconectando':
      return 'Reconectando';
    case 'error':
      return 'Sin señal';
  }
}

/** ¿Hay objetivo pero aún no hay conexión? (el comprobador busca la primera señal) */
export function isSearching(p: PlayerState): boolean {
  return isEngaged(p) && p.conn === 'idle' && !p.handoff;
}

/** Palabra de estado del reproductor completo («Buscando señal» cuando aún no conecta). */
export function playerWord(p: PlayerState): string {
  if (p.handoff && p.conn === 'idle') return 'En otro dispositivo';
  if (isSearching(p)) return 'Buscando señal';
  return phaseWord(derivePhase(p));
}

export function playerTone(p: PlayerState): DotTone {
  if (p.handoff && p.conn === 'idle') return 'accent';
  if (isSearching(p)) return 'checking';
  return phaseTone(derivePhase(p));
}

export function phaseTone(phase: PlayerPhase): DotTone {
  switch (phase) {
    case 'reproduciendo':
      return 'ok';
    case 'cargando':
    case 'buffer':
    case 'buscando':
    case 'reconectando':
      return 'checking';
    case 'pausado':
      return 'weak';
    case 'error':
      return 'fail';
    default:
      return 'idle';
  }
}

export function errorText(code: string | null): string {
  switch (code) {
    case 'engine_unavailable':
      return 'El motor no responde. Se reanudará solo cuando vuelva.';
    case 'source_no_peers':
      return 'Esta fuente no tiene señal ahora mismo.';
    case 'stream_stalled':
      return 'La imagen se quedó parada y no se ha recuperado.';
    default:
      return 'No se pudo abrir el canal.';
  }
}

export function modeWord(mode: 'stable' | 'balanced' | 'low'): string {
  return mode === 'low' ? 'Baja latencia' : mode === 'stable' ? 'Estable' : 'Equilibrado';
}

export function modeHint(mode: 'stable' | 'balanced' | 'low'): string {
  return mode === 'low' ? 'Unos 3 s por detrás del directo; se corta antes si la señal flojea.' : mode === 'stable' ? 'Unos 12 s de colchón; casi nunca se corta.' : 'Unos 6 s de colchón: el punto medio.';
}

export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'no_start', label: 'No arranca' },
  { id: 'cuts', label: 'Se corta' },
  { id: 'wrong_channel', label: 'Canal incorrecto' },
  { id: 'quality', label: 'Mala calidad' },
  { id: 'audio', label: 'Problema de audio' },
];

// ---------------------------------------------------------------- Partidos

export function matchTitle(m: Match): string {
  return `${team(m.home).name} – ${team(m.away).name}`;
}

export function matchShort(m: Match): string {
  return `${team(m.home).short} – ${team(m.away).short}`;
}

export function compLabel(m: Match): string {
  const c = competition(m.competition);
  return m.round ? `${c.name} · ${m.round}` : c.name;
}

/** «LaLiga · J6», «UCL · J2», «PL · 3ª ronda»: para columnas estrechas. */
export function compShort(m: Match): string {
  const c = competition(m.competition);
  if (!m.round) return c.short;
  const last = m.round.split('·').pop()!.trim().replace(/^Jornada\s+/i, 'J');
  return `${c.short} · ${last}`;
}

/** Texto de la columna de tiempo: «21:00», «67'», «Desc.», «Final». */
export function timeCell(m: Match, nowMs: number): { text: string; live: boolean; finished: boolean } {
  const s = scoreAt(m, nowMs);
  if (s.state === 'pre') return { text: m.time, live: false, finished: false };
  if (s.state === 'post') return { text: 'Final', live: false, finished: true };
  return { text: s.clock, live: true, finished: false };
}

export function useScore(m: Match) {
  const nowMs = useNow();
  return scoreAt(m, nowMs);
}

/** true si el partido es el que se está viendo (marcador tapado salvo revelado). */
export function useScoreHidden(matchId: string): boolean {
  const watching = useSim((s) => s.player.target?.kind === 'match' && s.player.target.id === matchId);
  const revealed = useSim((s) => !!s.scoreRevealed[matchId]);
  return watching && !revealed;
}

export function useSourceSession(kind: 'match' | 'channel', id: string): SourceSession | undefined {
  return useSim((s) => s.sourceSessions[`${kind}:${id}`]);
}

/** Precalienta las fuentes de los partidos cercanos (−45 min…+120 min), como hace el servidor. */
export function usePreheat(matches: Match[]) {
  const nowMs = useNow();
  const ids = useMemo(
    () =>
      matches
        .filter((m) => {
          const d = m.start - nowMs;
          return d < 45 * 60000 && d > -125 * 60000;
        })
        .map((m) => m.id)
        .join(','),
    [matches, Math.floor(nowMs / 60000)],
  );
  useEffect(() => {
    if (!ids) return;
    for (const id of ids.split(',')) ensureSources('match', id);
  }, [ids]);
}

/** Días de la tira: 7 alrededor de hoy con recuento de partidos. */
export function useDays(agenda: Match[]) {
  const nowMs = useNow();
  return useMemo(() => {
    const today = new Date(nowMs);
    const out: { key: string; ms: number; count: number; live: number }[] = [];
    for (let i = -2; i <= 4; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = isoDay(d.getTime());
      const list = agenda.filter((m) => m.date === key);
      out.push({ key, ms: d.getTime(), count: list.length, live: list.filter((m) => phaseOf(m, nowMs) === 'live').length });
    }
    return out;
  }, [agenda, Math.floor(nowMs / 60000)]);
}

export function isoDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- Canales

/** Partido que un canal emite ahora (o el próximo de hoy). */
export function channelNow(item: Item, agenda: Match[], nowMs: number): { match: Match; live: boolean } | null {
  const name = item.title.replace(/\s*\[.*\]$/, '').trim();
  const todays = agenda.filter((m) => m.channels.some((c) => c.name === name || `${c.name} 1` === name));
  const live = todays.find((m) => phaseOf(m, nowMs) === 'live');
  if (live) return { match: live, live: true };
  const next = todays.filter((m) => phaseOf(m, nowMs) === 'upcoming' && m.start - nowMs < 6 * 3600_000).sort((a, b) => a.start - b.start)[0];
  return next ? { match: next, live: false } : null;
}

export function groupRecents(items: Item[], nowMs: number): { title: string; items: Item[] }[] {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const todayMs = start.getTime();
  const groups: Record<string, Item[]> = { Hoy: [], Ayer: [], 'Esta semana': [], Antes: [] };
  for (const it of items) {
    const t = new Date(it.date).getTime() + getState().clockOffset;
    if (t >= todayMs) groups.Hoy.push(it);
    else if (t >= todayMs - 86400000) groups.Ayer.push(it);
    else if (t >= todayMs - 6 * 86400000) groups['Esta semana'].push(it);
    else groups.Antes.push(it);
  }
  return Object.entries(groups)
    .filter(([, l]) => l.length)
    .map(([title, list]) => ({ title, items: list }));
}

export function groupByCategory(items: Item[]): { title: string; items: Item[] }[] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.category || 'Otros';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()].map(([title, list]) => ({ title, items: list }));
}

export function useIsFavorite(id: string): boolean {
  return useSim((s) => s.favorites.some((f) => f.id === id)) || isFavorite(id);
}

// ---------------------------------------------------------------- Content ID

const HEX40 = /([a-f0-9]{40})/i;

/** Devuelve el hash si el texto contiene un Content ID o un enlace acestream://. */
export function detectContentId(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^acestream:\/\/([a-f0-9]{40})$/i) ?? t.match(HEX40);
  return m ? m[1].toLowerCase() : null;
}

export function idLabel(hash: string): string {
  return `${shortHash(hash, 8)}…`;
}

// ---------------------------------------------------------------- Hooks

/** Segundo toque: el primer clic «arma» la acción y el segundo la ejecuta. */
export function useSecondTap(ms = 5000): [boolean, (run: () => void) => void, () => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };
  const tap = (run: () => void) => {
    if (armed) {
      disarm();
      run();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), ms);
  };
  useEffect(() => () => disarm(), []);
  return [armed, tap, disarm];
}

export function useReducedMotionPref(): boolean {
  const sim = useSim((s) => s.reducedMotion);
  const [sys, setSys] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return sim || sys;
}

/** Pulso de una vez cuando cambia un valor (gol). */
export function usePulse(key: unknown, ms = 800): boolean {
  const [on, setOn] = useState(false);
  const prev = useRef(key);
  useEffect(() => {
    if (Object.is(prev.current, key)) return;
    prev.current = key;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key]);
  return on;
}

export function useLocalToggle(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === '1';
    } catch {
      return initial;
    }
  });
  const set = (n: boolean) => {
    setV(n);
    try {
      localStorage.setItem(key, n ? '1' : '0');
    } catch {
      /* sin almacenamiento */
    }
  };
  return [v, set];
}

/** Estado de la línea de estado del reproductor con texto por defecto según la fase. */
export function statusText(p: PlayerState, phase: PlayerPhase): { text: string; meta?: string } {
  const st = getState().statusLine;
  if (st) return { text: st.text, meta: st.meta };
  switch (phase) {
    case 'reproduciendo':
      return { text: p.behindS >= 1.25 ? 'Vas por detrás del directo.' : 'Vas en directo.', meta: p.behindS >= 1.25 ? `−${Math.round(p.behindS)} s` : `${p.bufferS} s de colchón` };
    case 'pausado':
      return { text: 'En pausa. Pulsa Directo para volver al directo.', meta: `−${Math.round(p.behindS)} s` };
    case 'reconectando':
      return { text: `La señal no llega con fluidez: reconectando (${p.reconnects}/3)…` };
    case 'error':
      return { text: errorText(p.errorCode) };
    case 'cargando':
    case 'buffer':
      return { text: 'Conectando…' };
    default:
      return { text: isSearching(p) ? 'Buscando señal: arranca la primera fuente que funcione…' : '' };
  }
}

export function techRows(p: PlayerState, src: Source | undefined): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [];
  rows.push({ k: 'Pares', v: String(p.stats.peers) });
  rows.push({ k: 'Bajada', v: `${(p.stats.speedDown / 125).toFixed(1).replace('.', ',')} Mbit/s` });
  rows.push({ k: 'Colchón', v: secondsText(p.bufferS) });
  rows.push({ k: 'Retraso', v: secondsText(p.behindS) });
  if (p.ttffMs !== null) rows.push({ k: 'Primera imagen', v: `${(p.ttffMs / 1000).toFixed(1).replace('.', ',')} s` });
  if (src) {
    rows.push({ k: 'Resolución', v: `${src.resolution} · ${src.videoCodec.toUpperCase()}` });
    rows.push({ k: 'Content ID', v: idLabel(src.id) });
  }
  return rows;
}

export function matchOf(id: string | undefined | null): Match | undefined {
  return id ? matchById(id) : undefined;
}
