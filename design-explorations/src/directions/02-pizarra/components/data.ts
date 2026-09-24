/* Helpers de datos de Pizarra: días, agrupación por competición, resumen
   de señal por partido, precalentado de fuentes y frases humanas. */
import { useEffect, useMemo } from 'react';
import { ensureSources, isForYou, now, useNow, useSim, type SourceSession } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { competition, team, type COMPETITIONS } from '../../../core/data/teams';
import { isoDate } from '../../../core/data/agenda';
import { dayLabel, hhmm, untilText } from '../../../core/format';
import { REASON_TEXT } from '../../../core/data/sources';
import type { Competition, Item, LiveScore, Match, Source } from '../../../core/types';
import { recordSample } from './prefs';

export const PREWARM_BEFORE = 45 * 60_000;
export const PREWARM_AFTER = 120 * 60_000;

/* ---------- días ---------- */
export interface DayOpt {
  iso: string;
  ms: number;
  offset: number;
  short: string;
  num: number;
  rel: 'ayer' | 'hoy' | 'mañana' | null;
  count: number;
  live: number;
  mine: number;
}

export function useDays(): DayOpt[] {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  return useMemo(() => {
    const today = new Date(nowMs);
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const out: DayOpt[] = [];
    for (let offset = -1; offset <= 5; offset++) {
      const ms = base + offset * 86400000;
      const iso = isoDate(ms);
      const items = agenda.filter((m) => m.date === iso);
      const label = dayLabel(ms, nowMs);
      out.push({
        iso,
        ms,
        offset,
        short: label.short,
        num: label.num,
        rel: label.rel,
        count: items.length,
        live: items.filter((m) => scoreAt(m, nowMs).state === 'in').length,
        mine: items.filter((m) => isForYou(m, prefs)).length,
      });
    }
    return out;
  }, [nowMs - (nowMs % 60_000), agenda, prefs]);
}

export function resolveDay(param: string | null, nowMs: number): string {
  if (!param || param === 'hoy' || param === 'dias') return isoDate(nowMs);
  if (/^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
  return isoDate(nowMs);
}

/* ---------- agenda del día ---------- */
export interface DayMatches {
  all: Match[];
  list: Match[];
  live: Match[];
  upcoming: Match[];
  finished: Match[];
  forYouCount: number;
}

export function orderByPhase(list: Match[], nowMs: number): Match[] {
  const rank = (m: Match) => {
    const s = scoreAt(m, nowMs);
    return s.state === 'in' ? 0 : s.state === 'pre' ? 1 : 2;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.start - b.start || competition(a.competition).rank - competition(b.competition).rank);
}

export function useDayMatches(iso: string, filter: 'para-ti' | 'todos'): DayMatches {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  return useMemo(() => {
    const all = agenda.filter((m) => m.date === iso);
    const forYou = all.filter((m) => isForYou(m, prefs));
    const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
    const list = orderByPhase(filter === 'para-ti' && hasPrefs ? forYou : all, nowMs);
    return {
      all,
      list,
      live: list.filter((m) => scoreAt(m, nowMs).state === 'in'),
      upcoming: list.filter((m) => scoreAt(m, nowMs).state === 'pre'),
      finished: list.filter((m) => scoreAt(m, nowMs).state === 'post'),
      forYouCount: forYou.length,
    };
  }, [iso, filter, agenda, prefs, nowMs]);
}

export interface CompGroup {
  comp: Competition;
  matches: Match[];
}

export function groupByCompetition(list: Match[], nowMs: number): CompGroup[] {
  const map = new Map<string, Match[]>();
  for (const m of list) {
    const arr = map.get(m.competition) ?? [];
    arr.push(m);
    map.set(m.competition, arr);
  }
  const groups: CompGroup[] = [...map.entries()].map(([id, matches]) => ({ comp: competition(id), matches: orderByPhase(matches, nowMs) }));
  // grupos con algo en directo primero, luego por rango de competición
  const liveRank = (g: CompGroup) => (g.matches.some((m) => scoreAt(m, nowMs).state === 'in') ? 0 : g.matches.some((m) => scoreAt(m, nowMs).state === 'pre') ? 1 : 2);
  return groups.sort((a, b) => liveRank(a) - liveRank(b) || a.comp.rank - b.comp.rank);
}

export function useLiveMatches(): Match[] {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  return useMemo(() => {
    const live = agenda.filter((m) => scoreAt(m, nowMs).state === 'in');
    return live.sort((a, b) => Number(isForYou(b, prefs)) - Number(isForYou(a, prefs)) || competition(a.competition).rank - competition(b.competition).rank || a.start - b.start);
  }, [agenda, prefs, nowMs]);
}

/* ---------- señal por partido ---------- */
export type SignalKind = 'verified' | 'weak' | 'none' | 'checking' | 'queued' | 'pending';

export interface SignalSummary {
  kind: SignalKind;
  text: string;
  working: number;
  weak: number;
  failed: number;
  probed: number;
  total: number;
}

export function summarize(session: SourceSession | undefined, match: Match | null, nowMs: number): SignalSummary {
  if (!session) {
    // Sin comprobador en marcha: estimación por cercanía del saque (misma regla que el resto de propuestas).
    const none = { working: 0, weak: 0, failed: 0, probed: 0, total: 0 };
    if (!match) return { kind: 'pending', text: '', ...none };
    const s = scoreAt(match, nowMs);
    if (s.state === 'post') return { kind: 'pending', text: '', ...none };
    const until = match.start - nowMs;
    if (s.state === 'in' || until < PREWARM_BEFORE) return { kind: 'verified', text: 'Señal lista', ...none };
    if (until < 6 * 3600_000) return { kind: 'queued', text: 'Se comprueba 45 min antes', ...none };
    return { kind: 'pending', text: '', ...none };
  }
  const src = session.sources;
  const total = src.length;
  const working = src.filter((x) => x.state === 'working').length;
  const weak = src.filter((x) => x.state === 'weak').length;
  const failed = src.filter((x) => x.state === 'failed').length;
  const pending = src.filter((x) => x.state === 'queued' || x.state === 'checking').length;
  const probed = total - pending;
  if (working > 0) return { kind: 'verified', text: `${working} de ${total} verificadas`, working, weak, failed, probed, total };
  if (pending > 0) return { kind: 'checking', text: `Comprobando: ${probed} de ${total} probadas`, working, weak, failed, probed, total };
  if (weak > 0) return { kind: 'weak', text: `Señal floja en ${weak} de ${total}`, working, weak, failed, probed, total };
  const retry = src.find((x) => x.retryAt)?.retryAt;
  return { kind: 'none', text: `Sin señal en ${total} fuentes${retry ? ` · reintento a las ${hhmm(retry)}` : ''}`, working, weak, failed, probed, total };
}

export function useSignal(kind: 'match' | 'channel', id: string): SignalSummary {
  const nowMs = useNow();
  const session = useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  const match = useSim((s) => (kind === 'match' ? s.agenda.find((m) => m.id === id) ?? null : null));
  return useMemo(() => summarize(session, match, nowMs), [session, match, nowMs]);
}

/** Precalienta (lanza el comprobador) de los partidos cercanos al inicio. */
export function usePrewarm(matches: Match[]) {
  const tick = useSim((s) => Math.floor(s.tick / 20));
  const ids = matches.map((m) => m.id).join('|');
  useEffect(() => {
    const t = now();
    for (const m of matches) {
      if (t >= m.start - PREWARM_BEFORE && t <= m.start + PREWARM_AFTER) ensureSources('match', m.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, tick]);
}

/** Muestras del sparkline: cada segundo guarda la bajada de la fuente en pantalla. */
export function usePlayerSampler() {
  const tick = useSim((s) => s.tick);
  const conn = useSim((s) => s.player.conn);
  const sourceId = useSim((s) => s.player.target?.sourceId ?? null);
  const speed = useSim((s) => s.player.stats.speedDown);
  useEffect(() => {
    if (conn === 'activa' && sourceId) recordSample(sourceId, speed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}

/* ---------- fuentes ---------- */
export function sourceKind(s: Source): SignalKind {
  switch (s.state) {
    case 'working':
      return 'verified';
    case 'weak':
      return 'weak';
    case 'failed':
      return 'none';
    case 'checking':
      return 'checking';
    default:
      return 'queued';
  }
}

export function sourceWord(s: Source): string {
  if (s.reason.startsWith('reported:')) return 'Reportada';
  switch (s.state) {
    case 'working':
      return 'Verificada';
    case 'weak':
      return 'Floja';
    case 'failed':
      return 'Sin señal';
    case 'checking':
      return 'Comprobando';
    default:
      return 'En cola';
  }
}

export function sourceDetail(s: Source, isActive: boolean, conn: string): string {
  if (isActive) {
    if (conn === 'activa') return 'en pantalla';
    if (conn === 'reconectando') return 'reconectando';
    if (conn === 'error') return 'no responde';
    return 'conectando';
  }
  if (s.reason.startsWith('reported:')) return 'apartada por tu reporte';
  if (s.state === 'checking') return 'probándose';
  if (s.state === 'queued') return 'en cola';
  const txt = REASON_TEXT[s.reason];
  if (s.state === 'failed' && s.retryAt) return `${txt ?? 'sin señal'} · reintento a las ${hhmm(s.retryAt)}`;
  return txt ?? '';
}

/** Mbit/s legible con coma decimal. */
export function mbit(kbps: number): string {
  return (kbps / 1000).toFixed(1).replace('.', ',');
}

export function mbitOf(s: Source): string {
  if (s.state === 'failed') return '—';
  if (s.state === 'queued' || s.state === 'checking') return '…';
  return mbit(s.streamKbps);
}

export function peersOf(s: Source): string {
  if (s.state === 'failed') return '0';
  if (s.state === 'queued' || s.state === 'checking') return '…';
  return String(s.peers);
}

export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: 'no_start', label: 'No arranca' },
  { id: 'cuts', label: 'Se corta' },
  { id: 'wrong_channel', label: 'Canal incorrecto' },
  { id: 'quality', label: 'Mala calidad' },
  { id: 'audio', label: 'Problema de audio' },
];

/* ---------- marcador ---------- */
export function useScoreHidden(matchId: string | null): boolean {
  const watching = useSim((s) => s.player.target?.kind === 'match' && s.player.target.id === matchId);
  const revealed = useSim((s) => (matchId ? !!s.scoreRevealed[matchId] : false));
  return !!matchId && watching && !revealed;
}

export function useMatch(id: string | null): Match | undefined {
  return useSim((s) => (id ? s.agenda.find((m) => m.id === id) : undefined));
}

export function useScore(m: Match | undefined | null): LiveScore | null {
  const nowMs = useNow();
  return m ? scoreAt(m, nowMs) : null;
}

export function matchTitle(m: Match): string {
  return `${team(m.home).name} – ${team(m.away).name}`;
}

export function matchShort(m: Match): string {
  return `${team(m.home).short} – ${team(m.away).short}`;
}

/** Cuenta atrás corta para columnas estrechas: «18 min», «1 h 18», «Mañana», «Vie». */
export function untilShort(ms: number, nowMs: number): string {
  const diff = ms - nowMs;
  const min = Math.ceil(diff / 60000);
  if (min <= 0) return 'Ahora';
  if (min < 60) return `${min} min`;
  if (min < 6 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  }
  const label = dayLabel(ms, nowMs);
  return label.rel === 'hoy' ? 'Hoy' : label.rel === 'mañana' ? 'Mañana' : label.short;
}

/** «● 54'» / «21:00 · En 48 min» / «Final». */
export function whenText(m: Match, s: LiveScore, nowMs: number): string {
  if (s.state === 'in') return s.halftime ? 'Descanso' : `${s.clock} · ${s.detail}`;
  if (s.state === 'pre') return `${m.time} · ${untilText(m.start, nowMs)}`;
  return 'Final';
}

/* ---------- canales y partidos ---------- */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\[.*?\]|-->.*$/g, '')
    .trim();
}

/** Partido que se emite ahora (o el siguiente) en un canal por nombre. */
export function matchOnChannel(title: string, agenda: Match[], nowMs: number): { match: Match; live: boolean } | null {
  const t = norm(title);
  const candidates = agenda.filter((m) => m.channels.some((c) => norm(c.name) === t));
  const live = candidates.find((m) => scoreAt(m, nowMs).state === 'in');
  if (live) return { match: live, live: true };
  const next = candidates.filter((m) => m.start > nowMs).sort((a, b) => a.start - b.start)[0];
  return next ? { match: next, live: false } : null;
}

export function useMatchOnChannel(title: string | null) {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  return useMemo(() => (title ? matchOnChannel(title, agenda, nowMs) : null), [title, agenda, nowMs]);
}

/** Canales de la biblioteca (favoritos + directorio activo) que dan un partido en directo. */
export function useOnAir(items: Item[]): { item: Item; match: Match }[] {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: { item: Item; match: Match }[] = [];
    for (const it of items) {
      const k = norm(it.title);
      if (seen.has(k)) continue;
      const r = matchOnChannel(it.title, agenda, nowMs);
      if (r?.live) {
        seen.add(k);
        out.push({ item: it, match: r.match });
      }
    }
    return out;
  }, [items, agenda, nowMs]);
}

/* ---------- recientes por tramo ---------- */
export function bucketOf(dateIso: string, nowReal: number): 'Hoy' | 'Ayer' | 'Esta semana' | 'Antes' {
  const d = new Date(dateIso).getTime();
  const day = (ms: number) => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();
  const diff = Math.round((day(nowReal) - day(d)) / 86400000);
  if (diff <= 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return 'Esta semana';
  return 'Antes';
}

export function competitionName(id: string): string {
  return competition(id).name;
}

export type CompetitionsMap = typeof COMPETITIONS;
