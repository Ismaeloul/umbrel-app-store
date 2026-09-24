/* Biblioteca: agrupaciones (recientes por tramo, por categoría), «Emitiendo
   ahora», búsqueda y la fila de canal compartida. */

import type { MouseEvent } from 'react';
import type { Item, LiveScore, Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { SEARCH_INDEX } from '../../../core/data/library';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { hhmm } from '../../../core/format';
import { Icon } from './icons';
import { Capsule, LiveDot } from './primitives';
import { useLongPress } from './hooks';
import { haptic } from './haptics';

export function uniqueByTitle(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.title) ? false : (seen.add(i.title), true)));
}

export function groupRecents(history: Item[], nowMs: number): { label: string; items: Item[] }[] {
  const d = new Date(nowMs);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const groups: { label: string; items: Item[] }[] = [
    { label: 'Hoy', items: [] },
    { label: 'Ayer', items: [] },
    { label: 'Esta semana', items: [] },
    { label: 'Antes', items: [] },
  ];
  for (const it of history) {
    const t = new Date(it.date).getTime();
    if (t >= today) groups[0].items.push(it);
    else if (t >= today - 86400000) groups[1].items.push(it);
    else if (t >= today - 6 * 86400000) groups[2].items.push(it);
    else groups[3].items.push(it);
  }
  return groups.filter((g) => g.items.length);
}

export function groupByCategory(items: Item[]): { category: string; items: Item[] }[] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.category || 'Otros';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

/** Partido que da un canal ahora (en directo) o el siguiente de hoy. */
export function matchOnChannel(title: string, agenda: Match[], nowMs: number): { match: Match; score: LiveScore } | null {
  const candidates = agenda.filter((m) => m.channels.some((c) => c.name === title));
  let best: { match: Match; score: LiveScore } | null = null;
  for (const m of candidates) {
    const s = scoreAt(m, nowMs);
    if (s.state === 'in') return { match: m, score: s };
    if (s.state === 'pre' && s.untilKickoffMs < 6 * 3600_000 && (!best || m.start < best.match.start)) best = { match: m, score: s };
  }
  return best;
}

export function nowLine(title: string, agenda: Match[], nowMs: number): { title: string; clock: string; live: boolean; match: Match; score: LiveScore } | null {
  const r = matchOnChannel(title, agenda, nowMs);
  if (!r) return null;
  const h = team(r.match.home);
  const a = team(r.match.away);
  if (r.score.state === 'in') return { title: `${h.short} ${r.score.home}–${r.score.away} ${a.short}`, clock: r.score.halftime ? 'Desc.' : r.score.clock, live: true, match: r.match, score: r.score };
  return { title: `${h.name} – ${a.name}`, clock: hhmm(r.match.start), live: false, match: r.match, score: r.score };
}

/** Canales de la biblioteca que dan un partido en directo ahora mismo. */
export function emittingNow(items: Item[], agenda: Match[], nowMs: number): { item: Item; match: Match; score: LiveScore }[] {
  const out: { item: Item; match: Match; score: LiveScore }[] = [];
  for (const it of uniqueByTitle(items)) {
    const r = matchOnChannel(it.title, agenda, nowMs);
    if (r && r.score.state === 'in') out.push({ item: it, ...r });
  }
  return out;
}

export function searchLibrary(q: string, items: Item[]): Item[] {
  const t = q.trim().toLowerCase();
  if (t.length < 1) return [];
  return uniqueByTitle(items.filter((i) => i.title.toLowerCase().includes(t) || (i.alias ?? '').toLowerCase().includes(t) || i.category.toLowerCase().includes(t)));
}

export function searchEngine(q: string): { title: string; category: string; availability: number }[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const words = t.split(/\s+/);
  return SEARCH_INDEX.filter((r) => words.every((w) => r.title.toLowerCase().includes(w) || r.category.toLowerCase().includes(w)));
}

export function availabilityTone(v: number): 'ok' | 'weak' | 'fail' {
  return v >= 0.6 ? 'ok' : v > 0.3 ? 'weak' : 'fail';
}

/** Fila de canal (lista): dorsal, nombre, línea de ahora, estrella y más. */
export function ChannelRow({ item, now, favorite, watching, onPlay, onMore, onStar, dense, showCategory }: { item: Item; now?: ReturnType<typeof nowLine>; favorite?: boolean; watching?: boolean; onPlay: () => void; onMore?: (e: MouseEvent) => void; onStar?: () => void; dense?: boolean; showCategory?: boolean }) {
  const long = useLongPress(
    onMore
      ? () => {
          haptic('medium');
          onMore({} as MouseEvent);
        }
      : undefined,
  );
  return (
    <div className={`pl-chrow${dense ? ' pl-chrow--dense' : ''}${watching ? ' is-watching' : ''}`} {...long}>
      <button type="button" className="pl-chrow__hit" onClick={() => { haptic('light'); onPlay(); }} aria-label={`Ver ${item.title}`}>
        <ChannelMark name={item.title} size={dense ? 40 : 48} radius={dense ? 10 : 13} />
        <span className="pl-chrow__text">
          <span className="pl-chrow__title">
            {item.title}
            {watching && (
              <Capsule tone="live" size="sm" dot>
                En pantalla
              </Capsule>
            )}
          </span>
          <span className="pl-chrow__sub">
            {now ? (
              <>
                {now.live ? <LiveDot size={6} /> : <Icon name="clock" size={12} />}
                <span>{now.live ? `${now.title} · ${now.clock}` : `A las ${now.clock}, ${now.title}`}</span>
              </>
            ) : (
              <span>{showCategory ? item.category || 'Canal' : item.category || 'Canal'}</span>
            )}
          </span>
        </span>
      </button>
      {onStar && (
        <button type="button" className={`pl-chrow__star${favorite ? ' is-on' : ''}`} aria-label={favorite ? `Quitar ${item.title} de favoritos` : `Guardar ${item.title} en favoritos`} aria-pressed={favorite} onClick={() => { haptic(favorite ? 'selection' : 'success'); onStar(); }}>
          <Icon name={favorite ? 'starFill' : 'star'} size={18} />
        </button>
      )}
      {onMore && (
        <button type="button" className="pl-chrow__more" aria-label={`Más opciones de ${item.title}`} onClick={onMore}>
          <Icon name="more" size={18} />
        </button>
      )}
    </div>
  );
}
