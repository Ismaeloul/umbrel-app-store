/* Agenda compartida: tira de días, agrupación por fase, tarjeta de primer uso
   y elección del partido destacado de la portada. */

import { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import type { LiveScore, Match, Preferences } from '../../../core/types';
import { ensureSources, featuredLiveMatch, isForYou, isMine, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { dayLabel } from '../../../core/format';
import { Button } from './primitives';
import { Icon } from './icons';
import { sameDay } from './hooks';
import { haptic } from './haptics';

export interface Scored {
  match: Match;
  score: LiveScore;
}

export function useAgendaDay(dayMs: number, filter: 'foryou' | 'all'): { live: Scored[]; upcoming: Scored[]; finished: Scored[]; total: number; totalAll: number } {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const now = useNow();
  return useMemo(() => {
    const all = agenda.filter((m) => sameDay(m.start, dayMs));
    const mine = filter === 'foryou' ? all.filter((m) => isForYou(m, prefs)) : all;
    const scored = mine.map((m) => ({ match: m, score: scoreAt(m, now) }));
    const live = scored.filter((x) => x.score.state === 'in');
    const upcoming = scored.filter((x) => x.score.state === 'pre').sort((a, b) => a.match.start - b.match.start);
    const finished = scored.filter((x) => x.score.state === 'post').sort((a, b) => b.match.start - a.match.start);
    return { live, upcoming, finished, total: scored.length, totalAll: all.length };
  }, [agenda, prefs, now, dayMs, filter]);
}

export function useDayCounts(days: number[], filter: 'foryou' | 'all'): number[] {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  return useMemo(() => days.map((d) => agenda.filter((m) => sameDay(m.start, d) && (filter === 'all' || isForYou(m, prefs))).length), [agenda, prefs, days, filter]);
}

export function useForYouCount(dayMs: number): { foryou: number; all: number } {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  return useMemo(() => {
    const all = agenda.filter((m) => sameDay(m.start, dayMs));
    return { foryou: all.filter((m) => isForYou(m, prefs)).length, all: all.length };
  }, [agenda, prefs, dayMs]);
}

/** Precalienta el comprobador de los partidos en directo o a menos de 45 min. */
export function useWarmSources(matches: Match[]) {
  const now = useNow();
  const ids = useMemo(
    () =>
      matches
        .filter((m) => {
          const s = scoreAt(m, now);
          return s.state === 'in' || (s.state === 'pre' && s.untilKickoffMs < 45 * 60_000);
        })
        .map((m) => m.id)
        .join('|'),
    [matches, Math.floor(now / 60_000)],
  );
  useEffect(() => {
    if (!ids) return;
    for (const id of ids.split('|')) ensureSources('match', id);
  }, [ids]);
}

/** Partido destacado de la portada: el que ves, o el primero en directo, o el siguiente. */
export function useFeatured(): { match: Match | null; score: LiveScore | null; kind: 'live' | 'next' | 'none' } {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const live = useSim(() => featuredLiveMatch() ?? null);
  const now = useNow();
  return useMemo(() => {
    if (live) {
      // si hay varios en directo y uno es tuyo, ese manda
      const mine = agenda.find((m) => scoreAt(m, now).state === 'in' && isMine(m, prefs));
      const pick = mine ?? live;
      return { match: pick, score: scoreAt(pick, now), kind: 'live' as const };
    }
    const next = agenda.filter((m) => m.start > now).sort((a, b) => a.start - b.start);
    const mineNext = next.find((m) => isMine(m, prefs) && m.start - now < 36 * 3600_000);
    const pick = mineNext ?? next[0];
    if (pick) return { match: pick, score: scoreAt(pick, now), kind: 'next' as const };
    return { match: null, score: null, kind: 'none' as const };
  }, [agenda, prefs, live, now]);
}

export function isMineMatch(m: Match, prefs: Preferences): boolean {
  return isMine(m, prefs);
}

/** Tira de 7 días (ayer … +5). */
export function DayStrip({ days, selected, onSelect, counts, nowMs, className, compact }: { days: number[]; selected: number; onSelect: (d: number) => void; counts: number[]; nowMs: number; className?: string; compact?: boolean }) {
  return (
    <div className={`pl-days${compact ? ' pl-days--compact' : ''} ${className ?? ''}`} role="tablist" aria-label="Día">
      {days.map((d, i) => {
        const l = dayLabel(d, nowMs);
        const on = sameDay(d, selected);
        const label = l.rel ? (compact && l.rel === 'mañana' ? 'Mañ.' : l.rel.charAt(0).toUpperCase() + l.rel.slice(1)) : l.short;
        return (
          <button key={d} type="button" role="tab" aria-selected={on} className={`pl-day${on ? ' is-on' : ''}${counts[i] === 0 ? ' is-empty' : ''}`} onClick={() => { if (!on) haptic('selection'); onSelect(d); }}>
            {on && <motion.span layoutId="pl-day-pill" className="pl-day__pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="pl-day__name">{label}</span>
            <span className="pl-day__num">{l.num}</span>
            {!compact && <span className="pl-day__count">{counts[i] ? counts[i] : '·'}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FirstUseCard({ onPersonalize, onLater, compact }: { onPersonalize: () => void; onLater: () => void; compact?: boolean }) {
  return (
    <div className={`pl-firstuse${compact ? ' pl-firstuse--compact' : ''}`}>
      <span className="pl-firstuse__icon">
        <Icon name="sparkle" size={20} />
      </span>
      <div className="pl-firstuse__text">
        <strong>Personaliza tu agenda</strong>
        <p>Dinos tus ligas y equipos: «Para ti» enseñará solo lo tuyo y la portada abrirá con tu partido.</p>
      </div>
      <div className="pl-firstuse__btns">
        <Button variant="gold" size="sm" onClick={onPersonalize}>
          Personalizar
        </Button>
        <Button variant="quiet" size="sm" onClick={onLater}>
          Ahora no
        </Button>
      </div>
    </div>
  );
}
