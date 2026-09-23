/* Marcador del centro de partido (inventario §6 y diseño A): antetítulo
   («En directo · Centro de partido»), meta (competición · hora · canales),
   escudos que se encienden en directo, marcador grande con cifras de celda
   fija que giran como una paleta al cambiar (B5), el minuto, la barra del
   partido con la muesca del descanso y el «momento de gol» (C3).

   El marcador del partido que ves sale TAPADO (regla 29 y corrección 2):
   «Ver marcador» lo destapa hasta cambiar de partido o detener; el ojo
   tachado lo vuelve a tapar («tu emisión va por detrás»). `pre` nunca se
   pinta: ESPN manda 0-0 antes de empezar. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useEffect, useRef, useState, ViewTransition, type CSSProperties } from 'react';
import { partidoTransitionName } from '../../app/transitions.ts';
import { cx } from '../../lib/cx.ts';
import { IconButton, LiveDot, Num, ProgressBar, TeamMark } from '../../ui/index.ts';
import {
  keepUnitsTogether,
  liveMinute,
  matchProgressAt,
  matchStatus,
  matchTitle,
  paintableScore,
} from '../agenda/domain.ts';
import { teamGlow } from '../agenda/MatchRow.tsx';
import { resetScoreReveal, revealScore, useScoreHidden } from '../agenda/score-reveal.ts';

/** Duración del «momento de gol» (C3). */
export const GOAL_MS = 1200;

/** Cifra que gira al CAMBIAR (un gol) o al destaparse; al pintarse la primera vez, quieta. */
export function FlipDigit({ value, spin, label }: { value: number; spin: boolean; label?: string }) {
  const previous = useRef(value);
  const [turn, setTurn] = useState(spin ? 1 : 0);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setTurn((n) => n + 1);
  }, [value]);
  return <Num key={turn} value={value} label={label} className={cx('mc-flip', turn > 0 && 'is-turning')} />;
}

/** Quién acaba de marcar (compara con el marcador anterior que se VIO destapado). */
function useGoalMoment(score: LiveScore | null, hidden: boolean): 'home' | 'away' | null {
  const last = useRef<{ home: number; away: number } | null>(null);
  const [scorer, setScorer] = useState<'home' | 'away' | null>(null);
  const home = score?.home ?? null;
  const away = score?.away ?? null;
  useEffect(() => {
    if (home === null || away === null || hidden) {
      // Tapado no se celebra nada: al destapar no hay «gol», solo el giro.
      last.current = home !== null && away !== null ? { home, away } : null;
      return;
    }
    const before = last.current;
    last.current = { home, away };
    if (!before) return;
    const who = home > before.home ? 'home' : away > before.away ? 'away' : null;
    if (who) setScorer(who);
  }, [home, away, hidden]);
  useEffect(() => {
    if (!scorer) return;
    const timer = window.setTimeout(() => setScorer(null), GOAL_MS);
    return () => window.clearTimeout(timer);
  }, [scorer]);
  return scorer;
}

export interface ScoreboardProps {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
  /** Canales anunciados (para la meta). */
  channels: readonly string[];
}

export function Scoreboard({ match, score: rawScore, now, channels }: ScoreboardProps) {
  const status = matchStatus(match, now, rawScore);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const score = paintableScore(rawScore);
  const hiddenPref = useScoreHidden(match.id, true);
  const hidden = hiddenPref && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
  const minute = live ? liveMinute(rawScore) : null;
  const scorer = useGoalMoment(score, hidden);
  const meta = [match.competition, match.time, channels.join(' · ')].filter(Boolean).join(' · ');
  const title = matchTitle(match);

  const style = {
    '--ta': done ? 'transparent' : teamGlow(match.home),
    '--tb': done ? 'transparent' : teamGlow(match.away || match.home),
  } as CSSProperties;

  let mid;
  if (hidden) {
    mid = (
      <button
        type="button"
        className="mc-score__cover press"
        title="Tu emisión va por detrás del directo"
        onClick={() => {
          setJustRevealed(true);
          revealScore(match.id);
        }}
      >
        <span className="mc-censor" aria-hidden="true">
          <i />
          <i />
        </span>
        <span className="mc-score__cover-text">Ver marcador</span>
      </button>
    );
  } else if (score) {
    mid = (
      <span
        className="mc-score__big"
        aria-label={`${match.home} ${score.home}, ${match.away || 'visitante'} ${score.away}${done ? ', final' : ''}`}
      >
        <FlipDigit value={score.home} spin={justRevealed} />
        <span className="mc-score__sep" aria-hidden="true">
          –
        </span>
        <FlipDigit value={score.away} spin={justRevealed} />
      </span>
    );
  } else if (/^\d{2}:\d{2}$/.test(match.time)) {
    mid = <Num className="mc-score__big mc-score__big--time" value={match.time} label={`A las ${match.time}`} />;
  } else {
    mid = <span className="mc-score__tbc">{match.time || 'Programado'}</span>;
  }

  const when = live ? (
    <span className="mc-score__when is-live">
      <LiveDot />
      {minute ? (
        minute.halftime ? (
          'Descanso'
        ) : (
          <Num value={`${minute.minute}'`} label={`Minuto ${minute.minute}`} />
        )
      ) : (
        'En directo'
      )}
    </span>
  ) : (
    <span className="mc-score__when">
      {done ? 'Final' : status ? keepUnitsTogether(status.text) : score || hidden ? '' : 'Programado'}
    </span>
  );

  return (
    <section
      className={cx('mc-score', live && 'is-live', done && 'is-done', scorer && `is-goal-${scorer}`)}
      style={style}
      aria-labelledby={`mc-title-${match.id}`}
    >
      <div className="mc-score__light" aria-hidden="true" />
      <div className="mc-score__top">
        <p className="mc-score__kicker">
          {live ? (
            <>
              <LiveDot /> En directo · Centro de partido
            </>
          ) : (
            'Centro de partido'
          )}
        </p>
        {score && !hidden ? (
          <IconButton
            icon="eye-off"
            label="Tapar el marcador (tu emisión va por detrás)"
            size="md"
            className="mc-score__hide"
            onClick={() => {
              setJustRevealed(false);
              resetScoreReveal();
            }}
          />
        ) : null}
      </div>
      {meta ? <p className="mc-score__meta">{meta}</p> : null}
      <h1 id={`mc-title-${match.id}`} className="sr-only" tabIndex={-1}>
        {title}
      </h1>
      <ViewTransition name={partidoTransitionName(match.id)}>
        <div className="mc-score__row">
          <div className={cx('mc-side', scorer === 'home' && 'is-scoring')}>
            <TeamMark name={match.home} size={72} lit={live} className="mc-side__crest" />
            <span className="mc-side__name">{match.home}</span>
          </div>
          <div className="mc-score__mid" aria-live="polite">
            {mid}
            {when}
          </div>
          <div className={cx('mc-side', scorer === 'away' && 'is-scoring')}>
            {match.away ? (
              <>
                <TeamMark name={match.away} size={72} lit={live} className="mc-side__crest" />
                <span className="mc-side__name">{match.away}</span>
              </>
            ) : null}
          </div>
        </div>
      </ViewTransition>
      {live || done ? (
        <div className="mc-score__timeline">
          <ProgressBar
            value={matchProgressAt(match, now, rawScore)}
            label={done ? 'Partido terminado' : minute ? `Minuto ${minute.minute} de 90` : 'Partido en juego'}
            tone="live"
            marks={[0.5]}
          />
          <div className="mc-score__marks" aria-hidden="true">
            <span>0'</span>
            <span>Descanso</span>
            <span>90'</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
