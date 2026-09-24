/* Consola · un solo motor de búsqueda para el panel de comandos (web), la
   pantalla Buscar (web) y la pestaña Buscar (iPhone): partidos, canales de la
   biblioteca, fuentes del partido abierto, acciones y el índice del motor.
   Prefijos: «>» acciones · «#» canales · «@» partidos. Detecta un Content ID. */

import { useEffect, useMemo, useState } from 'react';
import type { Item, Match } from '../../../core/types';
import { SEARCH_INDEX } from '../../../core/data/library';
import { allChannels, useNow, useSim } from '../../../core/store';
import { phaseOf } from '../../../core/score';
import { team, competition } from '../../../core/data/teams';
import type { IconName } from './icons';
import { detectContentId } from './lib';

export interface ActionDef {
  id: string;
  label: string;
  icon: IconName;
  keys?: string;
  hint?: string;
  run: () => void;
  /** Solo aparece si se cumple. */
  when?: boolean;
}

export type Result =
  | { kind: 'match'; id: string; match: Match }
  | { kind: 'channel'; id: string; item: Item; inLibrary: 'fav' | 'recent' | 'list' }
  | { kind: 'engine'; id: string; title: string; category: string; availability: number }
  | { kind: 'action'; id: string; action: ActionDef }
  | { kind: 'contentId'; id: string; hash: string };

export interface ResultGroup {
  id: 'contentId' | 'matches' | 'channels' | 'actions' | 'engine';
  title: string;
  items: Result[];
}

export type Scope = 'all' | 'matches' | 'channels' | 'actions' | 'engine';

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .trim();
}

function hit(hay: string, q: string): boolean {
  if (!q) return true;
  const h = norm(hay);
  return q.split(' ').every((w) => h.includes(w));
}

export function parseQuery(raw: string): { q: string; scope: Scope; hash: string | null } {
  const hash = detectContentId(raw);
  if (hash) return { q: '', scope: 'all', hash };
  const t = raw.trimStart();
  if (t.startsWith('>')) return { q: norm(t.slice(1)), scope: 'actions', hash: null };
  if (t.startsWith('#')) return { q: norm(t.slice(1)), scope: 'channels', hash: null };
  if (t.startsWith('@')) return { q: norm(t.slice(1)), scope: 'matches', hash: null };
  return { q: norm(t), scope: 'all', hash: null };
}

export function useSearch(raw: string, actions: ActionDef[], scopeOverride?: Scope): { groups: ResultGroup[]; flat: Result[]; loadingEngine: boolean; q: string; scope: Scope; hash: string | null } {
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const nowMs = useNow();
  const parsed = parseQuery(raw);
  const scope = scopeOverride && scopeOverride !== 'all' ? scopeOverride : parsed.scope;
  const q = parsed.q;
  const hash = parsed.hash;

  // El motor «tarda» 450 ms en responder.
  const [loadingEngine, setLoading] = useState(false);
  const engineQ = scope === 'all' || scope === 'engine' ? q : '';
  useEffect(() => {
    if (engineQ.length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(id);
  }, [engineQ]);

  const groups = useMemo(() => {
    const out: ResultGroup[] = [];
    if (hash) {
      out.push({ id: 'contentId', title: 'Enlace detectado', items: [{ kind: 'contentId', id: `cid:${hash}`, hash }] });
      return out;
    }
    const empty = q.length === 0;
    if (scope === 'all' || scope === 'matches') {
      const dayNow = Math.floor(nowMs / 86400000);
      const list = agenda
        .filter((m) => {
          const label = `${team(m.home).name} ${team(m.away).name} ${team(m.home).short} ${team(m.away).short} ${competition(m.competition).name} ${m.round ?? ''}`;
          return hit(label, q);
        })
        .sort((a, b) => {
          const pa = phaseOf(a, nowMs);
          const pb = phaseOf(b, nowMs);
          const rank = (p: string) => (p === 'live' ? 0 : p === 'upcoming' ? 1 : 2);
          return rank(pa) - rank(pb) || Math.abs(a.start - nowMs) - Math.abs(b.start - nowMs);
        })
        .filter((m) => (empty ? Math.abs(Math.floor(m.start / 86400000) - dayNow) <= 1 : true))
        .slice(0, empty ? 4 : 8);
      if (list.length) out.push({ id: 'matches', title: 'Partidos', items: list.map((m) => ({ kind: 'match', id: m.id, match: m })) });
    }
    if (scope === 'all' || scope === 'channels') {
      const seen = new Set<string>();
      const items: Result[] = [];
      const push = (it: Item, where: 'fav' | 'recent' | 'list') => {
        if (seen.has(it.title)) return;
        if (!hit(`${it.title} ${it.category}`, q)) return;
        seen.add(it.title);
        items.push({ kind: 'channel', id: it.id, item: it, inLibrary: where });
      };
      favorites.forEach((it) => push(it, 'fav'));
      history.forEach((it) => push(it, 'recent'));
      if (!empty) allChannels().forEach((it) => push(it, 'list'));
      const list = items.slice(0, empty ? 4 : 8);
      if (list.length) out.push({ id: 'channels', title: 'Canales', items: list });
    }
    if (scope === 'all' || scope === 'actions') {
      const list = actions.filter((a) => a.when !== false && hit(`${a.label} ${a.hint ?? ''}`, q)).slice(0, empty ? 6 : 10);
      if (list.length) out.push({ id: 'actions', title: 'Acciones', items: list.map((a) => ({ kind: 'action', id: `act:${a.id}`, action: a })) });
    }
    if ((scope === 'all' || scope === 'engine') && q.length >= 2) {
      const list = SEARCH_INDEX.filter((r) => hit(`${r.title} ${r.category}`, q)).slice(0, 8);
      out.push({ id: 'engine', title: 'En el motor', items: list.map((r) => ({ kind: 'engine', id: `eng:${r.title}`, title: r.title, category: r.category, availability: r.availability })) });
    }
    return out;
  }, [q, scope, hash, agenda, favorites, history, actions, Math.floor(nowMs / 60000)]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  return { groups, flat, loadingEngine, q, scope, hash };
}

export const SCOPES: { id: Scope; label: string; prefix?: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'matches', label: 'Partidos', prefix: '@' },
  { id: 'channels', label: 'Canales', prefix: '#' },
  { id: 'actions', label: 'Acciones', prefix: '>' },
  { id: 'engine', label: 'Motor' },
];
