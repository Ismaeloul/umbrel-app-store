import { useEffect, useRef, useState } from 'react';
import { revealScore, useSim } from '../../../core/store';
import type { LiveScore } from '../../../core/types';

/* Marcador con cifras que ruedan y estado «tapado» (anti-spoiler) para el
   partido que se está viendo. */

export function RollingNumber({ value, className = '' }: { value: number; className?: string }) {
  const [prev, setPrev] = useState(value);
  const [flip, setFlip] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (value !== prev) {
      setFlip(true);
      const t = setTimeout(() => {
        setPrev(value);
        setFlip(false);
      }, 220);
      return () => clearTimeout(t);
    }
  }, [value, prev]);
  return (
    <span className={`tb-roll ${className}`} aria-live="polite">
      <span className={`tb-roll__in${flip ? ' is-flip' : ''}`}>{flip ? prev : value}</span>
    </span>
  );
}

/** ¿Debe ir tapado? Solo si es el partido que se está viendo y no se ha destapado. */
export function useScoreHidden(matchId: string): boolean {
  const watching = useSim((s) => s.player.target?.kind === 'match' && s.player.target.id === matchId);
  const revealed = useSim((s) => !!s.scoreRevealed[matchId]);
  return watching && !revealed;
}

export function ScoreView({ matchId, score, size = 'row' }: { matchId: string; score: LiveScore; size?: 'row' | 'card' | 'hero' }) {
  const hidden = useScoreHidden(matchId);
  if (score.state === 'pre') return null;
  if (hidden) {
    return (
      <button type="button" className={`tb-score tb-score--${size} is-hidden`} onClick={(e) => { e.stopPropagation(); revealScore(matchId, true); }} title="Tu emisión va por detrás del directo">
        <span className="tb-score__mask" aria-hidden="true">
          <i />
          <i />
        </span>
        <span className="tb-score__reveal">Ver marcador</span>
      </button>
    );
  }
  return (
    <span className={`tb-score tb-score--${size}`} aria-label={`${score.home} a ${score.away}`}>
      <RollingNumber value={score.home} />
      <span className="tb-score__sep">–</span>
      <RollingNumber value={score.away} />
    </span>
  );
}

export function MinuteBadge({ score, size = 'sm' }: { score: LiveScore; size?: 'sm' | 'md' }) {
  if (score.state !== 'in') return null;
  return (
    <span className={`tb-minute tb-minute--${size}`}>
      <i className="tb-minute__dot" aria-hidden="true" />
      {score.halftime ? 'Descanso' : score.clock}
    </span>
  );
}
