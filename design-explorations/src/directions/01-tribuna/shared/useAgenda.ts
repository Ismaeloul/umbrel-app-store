import { useMemo, useState } from 'react';
import { isForYou, isMine, useNow, useSim } from '../../../core/store';
import { scoreAt, type MatchPhase } from '../../../core/score';
import { competition } from '../../../core/data/teams';
import type { Match } from '../../../core/types';
import { dayLabel } from '../../../core/format';

/* Lógica de la agenda compartida por web e iPhone: días, filtro Para ti,
   agrupación por competición y fase (directo → próximos → terminados). */

export interface DayInfo {
  key: string; // YYYY-MM-DD
  ms: number;
  rel: 'ayer' | 'hoy' | 'mañana' | null;
  short: string;
  long: string;
  num: number;
  count: number;
  live: number;
}

export interface MatchVM {
  match: Match;
  score: ReturnType<typeof scoreAt>;
  phase: MatchPhase;
  mine: boolean;
}

export interface CompetitionGroup {
  id: string;
  name: string;
  country: string;
  matches: MatchVM[];
}

const PHASE_ORDER: Record<MatchPhase, number> = { live: 0, upcoming: 1, finished: 2 };

export function useAgenda() {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const now = useNow();
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const [scope, setScope] = useState<'mine' | 'all'>(hasPrefs ? 'mine' : 'all');
  const effectiveScope = hasPrefs ? scope : 'all';

  const days = useMemo<DayInfo[]>(() => {
    const map = new Map<string, DayInfo>();
    const base = new Date(now);
    for (let d = -1; d <= 5; d++) {
      const ms = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, 12).getTime();
      const l = dayLabel(ms, now);
      const key = `${new Date(ms).getFullYear()}-${String(new Date(ms).getMonth() + 1).padStart(2, '0')}-${String(new Date(ms).getDate()).padStart(2, '0')}`;
      map.set(key, { key, ms, rel: l.rel, short: l.short, long: l.long, num: l.num, count: 0, live: 0 });
    }
    for (const m of agenda) {
      const d = map.get(m.date);
      if (!d) continue;
      if (effectiveScope === 'mine' && !isForYou(m, prefs)) continue;
      d.count++;
      if (scoreAt(m, now).state === 'in') d.live++;
    }
    return [...map.values()];
  }, [agenda, now, prefs, effectiveScope]);

  const todayKey = days.find((d) => d.rel === 'hoy')?.key ?? days[0].key;
  const [dayKey, setDayKey] = useState(todayKey);

  const vms = useMemo<MatchVM[]>(() => {
    return agenda
      .filter((m) => m.date === dayKey)
      .filter((m) => effectiveScope === 'all' || isForYou(m, prefs))
      .map((m) => {
        const score = scoreAt(m, now);
        const phase: MatchPhase = score.state === 'in' ? 'live' : score.state === 'pre' ? 'upcoming' : 'finished';
        return { match: m, score, phase, mine: isMine(m, prefs) };
      })
      .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.match.start - b.match.start);
  }, [agenda, dayKey, effectiveScope, prefs, now]);

  const groups = useMemo<CompetitionGroup[]>(() => {
    const map = new Map<string, CompetitionGroup>();
    for (const vm of vms) {
      const c = competition(vm.match.competition);
      let g = map.get(c.id);
      if (!g) {
        g = { id: c.id, name: c.name, country: c.country, matches: [] };
        map.set(c.id, g);
      }
      g.matches.push(vm);
    }
    return [...map.values()].sort((a, b) => {
      // en directo primero, luego por rango de competición
      const la = a.matches.some((m) => m.phase === 'live') ? 0 : 1;
      const lb = b.matches.some((m) => m.phase === 'live') ? 0 : 1;
      return la - lb || competition(a.id).rank - competition(b.id).rank;
    });
  }, [vms]);

  const live = vms.filter((v) => v.phase === 'live');
  const totalAll = agenda.filter((m) => m.date === dayKey).length;
  const totalMine = agenda.filter((m) => m.date === dayKey && isForYou(m, prefs)).length;

  return { days, dayKey, setDayKey, todayKey, scope: effectiveScope, setScope, hasPrefs, vms, groups, live, totalAll, totalMine, now, prefs };
}

export type Agenda = ReturnType<typeof useAgenda>;
