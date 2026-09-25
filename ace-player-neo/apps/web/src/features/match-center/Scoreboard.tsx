/* Marcador del teatro (plan Palco fase 2, decisión W5; regla 29 y
   corrección 2): una cápsula compacta SOBRE el vídeo, arriba a la izquierda
   (la proyecta index.tsx en el hueco del escenario, player/stage-slot.ts).

   - Tapado por defecto («Marcador»): AceStream va por detrás de la emisión
     y un marcador al instante te cantaría el gol antes de verlo. Un toque lo
     destapa hasta cambiar de partido o detener; el ojo tachado lo vuelve a
     tapar («tu emisión va por detrás»). El minuto sí se ve tapado (no es
     un spoiler).
   - Destapado: escudos pequeños, cifras de celda fija que giran como una
     paleta al cambiar (B5) y el minuto. Con un gol, la cápsula da un rebote
     (scale 1 → 1,14 → 1, W14) y un toque háptico de éxito.
   - Sin marcador que pintar (antes de empezar; `pre` nunca se pinta: ESPN
     manda 0-0), la cápsula dice la hora o cuánto falta.

   También exporta el marcador grande de la pestaña «Partido» (BigScore). */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { teamCrest, teamPalette, teamShort } from '../../lib/teams.ts';
import { Icon, IconButton, LiveDot, Num, TeamMark } from '../../ui/index.ts';
import { keepUnitsTogether, liveMinute, matchStatus, paintableScore } from '../agenda/domain.ts';
import { resetScoreReveal, revealScore, useScoreHidden } from '../agenda/score-reveal.ts';

/** Duración del «momento de gol» (C3): rebote, escudo y luz. */
export const GOAL_MS = 1200;

/** Cifra que gira al CAMBIAR (un gol) o al destaparse; al pintarse la primera vez, quieta. */
export function FlipDigit({
  value,
  spin,
  label,
}: {
  value: number;
  spin: boolean;
  label?: string;
}) {
  const previous = useRef(value);
  const [turn, setTurn] = useState(spin ? 1 : 0);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setTurn((n) => n + 1);
  }, [value]);
  return (
    <Num
      key={turn}
      value={value}
      label={label}
      className={cx('mc-flip', turn > 0 && 'is-turning')}
    />
  );
}

/** Quién acaba de marcar (compara con el marcador anterior que se VIO destapado). */
export function useGoalMoment(score: LiveScore | null, hidden: boolean): 'home' | 'away' | null {
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

/** El minuto (o «Descanso» / «En directo») con el punto que late. */
function LiveWhen({ score }: { score: LiveScore | null }) {
  const minute = liveMinute(score);
  return (
    <span className="mc-when is-live">
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
  );
}

/** «Atlético de Madrid 2, Tottenham 1[, final]»: lo que se lee del marcador. */
export function scoreLabel(match: FootballMatch, score: LiveScore, done: boolean): string {
  return `${match.home} ${score.home}, ${match.away || 'visitante'} ${score.away}${done ? ', final' : ''}`;
}

/** Escudo pequeño o grande de un lado, con el escudo del backend si lo hay. */
export function SideMark({
  match,
  side,
  size,
  lit = false,
  className,
}: {
  match: FootballMatch;
  side: 'home' | 'away';
  size: number;
  lit?: boolean;
  className?: string;
}) {
  const name = side === 'home' ? match.home : match.away;
  if (!name) return null;
  return (
    <TeamMark
      name={name}
      short={teamShort(match, side)}
      colors={teamPalette(match, side)}
      crest={teamCrest(match, side)}
      size={size}
      lit={lit}
      className={className}
    />
  );
}

export interface ScoreboardProps {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
}

/** La cápsula del marcador sobre el vídeo. */
export function Scoreboard({ match, score: rawScore, now }: ScoreboardProps) {
  const status = matchStatus(match, now, rawScore);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const score = paintableScore(rawScore);
  const hiddenPref = useScoreHidden(match.id, true);
  const hidden = hiddenPref && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
  const scorer = useGoalMoment(score, hidden);
  useEffect(() => {
    if (scorer) haptic('success');
  }, [scorer]);

  let content;
  if (hidden) {
    content = (
      <button
        type="button"
        className="mc-scap__cover press"
        aria-label="Ver marcador"
        title="Tu emisión va por detrás del directo"
        onClick={() => {
          haptic('light');
          setJustRevealed(true);
          revealScore(match.id);
        }}
      >
        <Icon name="eye" size={18} />
        <span className="mc-scap__word">Marcador</span>
        <span className="mc-censor mc-censor--sm" aria-hidden="true">
          <i />
          <i />
        </span>
      </button>
    );
  } else if (score) {
    content = (
      <span className="mc-scap__score">
        <SideMark match={match} side="home" size={24} className="mc-scap__crest" />
        <span className="mc-scap__digits" aria-label={scoreLabel(match, score, done)}>
          <FlipDigit value={score.home} spin={justRevealed} />
          <span className="mc-scap__sep" aria-hidden="true">
            –
          </span>
          <FlipDigit value={score.away} spin={justRevealed} />
        </span>
        <SideMark match={match} side="away" size={24} className="mc-scap__crest" />
      </span>
    );
  } else if (live || done) {
    // En juego (o terminado) sin marcador de ESPN: basta con el minuto o «Final».
    content = null;
  } else if (/^\d{2}:\d{2}$/.test(match.time)) {
    content = (
      <span className="mc-scap__time">
        <Icon name="clock" size={16} />
        <Num value={match.time} label={`A las ${match.time}`} />
      </span>
    );
  } else {
    content = <span className="mc-scap__time">{match.time || 'Programado'}</span>;
  }

  const when = live ? (
    <LiveWhen score={rawScore} />
  ) : done ? (
    <span className="mc-when">Final</span>
  ) : status && !score ? (
    <span className="mc-when">{keepUnitsTogether(status.text)}</span>
  ) : null;

  return (
    <div
      className={cx(
        'mc-scap',
        'glass--video',
        live && 'is-live',
        done && 'is-done',
        hidden && 'is-covered',
        scorer && 'is-goal',
        scorer && `is-goal-${scorer}`,
      )}
    >
      <span className="mc-scap__live" aria-live="polite">
        {content}
        {when}
      </span>
      {score && !hidden ? (
        <IconButton
          icon="eye-off"
          label="Tapar el marcador (tu emisión va por detrás)"
          variant="video"
          className="mc-scap__hide"
          onClick={() => {
            setJustRevealed(false);
            resetScoreReveal();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Marcador grande de la pestaña «Partido»: los dos escudos con su nombre y,
 * en medio, las cifras (destapado), las barras de censura (tapado, con
 * «Destapar») o la hora; debajo, el minuto o cuánto falta.
 */
export function BigScore({ match, score: rawScore, now }: ScoreboardProps) {
  const status = matchStatus(match, now, rawScore);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const score = paintableScore(rawScore);
  const hidden = useScoreHidden(match.id, true) && score !== null;
  const scorer = useGoalMoment(score, hidden);

  let mid;
  if (hidden) {
    mid = (
      <span className="mc-big__covered">
        <span className="mc-censor" aria-hidden="true">
          <i />
          <i />
        </span>
        <button
          type="button"
          className="mc-big__reveal press"
          title="Tu emisión va por detrás del directo"
          onClick={() => {
            haptic('light');
            revealScore(match.id);
          }}
        >
          Destapar el marcador
        </button>
      </span>
    );
  } else if (score) {
    mid = (
      <span className="mc-big__digits" aria-label={scoreLabel(match, score, done)}>
        <FlipDigit value={score.home} spin={false} />
        <span className="mc-big__sep" aria-hidden="true">
          –
        </span>
        <FlipDigit value={score.away} spin={false} />
      </span>
    );
  } else if (/^\d{2}:\d{2}$/.test(match.time)) {
    mid = (
      <Num
        className="mc-big__digits mc-big__digits--time"
        value={match.time}
        label={`A las ${match.time}`}
      />
    );
  } else {
    mid = <span className="mc-big__tbc">{match.time || 'Programado'}</span>;
  }

  return (
    <div
      className={cx('mc-big', live && 'is-live', done && 'is-done', scorer && `is-goal-${scorer}`)}
    >
      <div className={cx('mc-big__side', scorer === 'home' && 'is-scoring')}>
        <SideMark match={match} side="home" size={72} lit={live} className="mc-big__crest" />
        <span className="mc-big__name">{match.home}</span>
      </div>
      <div className="mc-big__mid">
        {mid}
        {live ? (
          <LiveWhen score={rawScore} />
        ) : (
          <span className="mc-when">
            {done ? 'Final' : status ? keepUnitsTogether(status.text) : 'Programado'}
          </span>
        )}
      </div>
      <div className={cx('mc-big__side', scorer === 'away' && 'is-scoring')}>
        <SideMark match={match} side="away" size={72} lit={live} className="mc-big__crest" />
        {match.away ? <span className="mc-big__name">{match.away}</span> : null}
      </div>
    </div>
  );
}
