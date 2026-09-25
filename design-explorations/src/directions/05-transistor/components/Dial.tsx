/* El dial: una banda horizontal con scroll-snap donde cada partido del día es
   una emisora con su «frecuencia» (la hora). La aguja central sintoniza la
   emisora más cercana al centro; los partidos en juego llevan onda.
   En SwiftUI: ScrollView(.horizontal) + scrollTargetBehavior(.viewAligned) +
   scrollPosition(id:). */

import { useEffect, useRef } from 'react';
import type { Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { untilText } from '../../../core/format';
import { Wave } from './Wave';

export interface DialProps {
  matches: Match[];
  tunedId: string | null;
  onTune: (id: string) => void;
  now: number;
  isMine: (m: Match) => boolean;
  watchingId: string | null;
  compact?: boolean;
  label?: string;
}

export function Dial({ matches, tunedId, onTune, now, isMine, watchingId, compact, label = 'Dial de partidos' }: DialProps) {
  const track = useRef<HTMLDivElement>(null);
  const detected = useRef<string | null>(null);
  const raf = useRef(0);
  const onTuneRef = useRef(onTune);
  onTuneRef.current = onTune;

  // Detecta la emisora bajo la aguja al hacer scroll.
  const detect = () => {
    const el = track.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best: string | null = null;
    let bestD = Infinity;
    for (const st of Array.from(el.querySelectorAll<HTMLElement>('[data-station]'))) {
      const c = st.offsetLeft + st.offsetWidth / 2;
      const d = Math.abs(c - center);
      if (d < bestD) {
        bestD = d;
        best = st.dataset.station ?? null;
      }
    }
    if (best && best !== detected.current) {
      detected.current = best;
      onTuneRef.current(best);
    }
  };

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(detect);
  };

  // Sintonía programática (teclado, arranque, cambio de día).
  const first = useRef(true);
  useEffect(() => {
    const el = track.current;
    if (!el || !tunedId) return;
    if (detected.current === tunedId) return;
    const st = el.querySelector<HTMLElement>(`[data-station="${tunedId}"]`);
    if (!st) return;
    const left = st.offsetLeft + st.offsetWidth / 2 - el.clientWidth / 2;
    detected.current = tunedId;
    el.scrollTo({ left, behavior: first.current ? 'instant' : 'smooth' });
    first.current = false;
  }, [tunedId, matches]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className={`tr-dial${compact ? ' is-compact' : ''}`}>
      <div className="tr-dial-scale" aria-hidden="true" />
      <div className="tr-dial-needle" aria-hidden="true">
        <i />
      </div>
      {matches.length === 0 ? (
        <div className="tr-dial-empty" role="status">
          <span>— — —</span>
          <span>sin emisoras este día</span>
          <span>— — —</span>
        </div>
      ) : (
        <div className="tr-dial-track" ref={track} onScroll={onScroll} role="listbox" aria-label={label} aria-activedescendant={tunedId ? `tr-st-${tunedId}` : undefined}>
          {matches.map((m) => {
            const s = scoreAt(m, now);
            const tuned = m.id === tunedId;
            const mine = isMine(m);
            const watching = m.id === watchingId;
            return (
              <button
                key={m.id}
                id={`tr-st-${m.id}`}
                type="button"
                role="option"
                aria-selected={tuned}
                data-station={m.id}
                className={`tr-station${tuned ? ' is-tuned' : ''}${s.state === 'in' ? ' is-live' : s.state === 'post' ? ' is-post' : ' is-pre'}${mine ? ' is-mine' : ''}`}
                onClick={() => {
                  const el = track.current;
                  const st = el?.querySelector<HTMLElement>(`[data-station="${m.id}"]`);
                  if (el && st) el.scrollTo({ left: st.offsetLeft + st.offsetWidth / 2 - el.clientWidth / 2, behavior: 'smooth' });
                }}
              >
                <span className="tr-station-freq">
                  {m.time}
                  {mine && <i className="tr-station-mine" aria-label="Tu equipo" />}
                </span>
                <span className="tr-station-teams">
                  <b>{team(m.home).short}</b>
                  <span className="tr-station-sep">–</span>
                  <b>{team(m.away).short}</b>
                </span>
                <span className="tr-station-state">
                  {s.state === 'in' ? (
                    <>
                      <Wave size={12} />
                      <span>{s.halftime ? 'Desc.' : s.clock}</span>
                    </>
                  ) : s.state === 'pre' ? (
                    <span>{untilText(m.start, now)}</span>
                  ) : (
                    <span>{watching ? 'Final' : `${s.home}–${s.away} · Final`}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
