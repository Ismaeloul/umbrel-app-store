/* Tarjeta de la emisora sintonizada: cabecera LCD, medidor de estática,
   dónde se emite y una sola tecla principal. */

import type { SourceSession } from '../../../core/store';
import type { Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { Chip, Key } from './Key';
import { MatchHeader } from './MatchHeader';
import { SignalMeter } from './SignalMeter';
import { compName, signalOf } from './text';
import { IcPlay, IcChevronRight } from './icons';

export interface MatchCardProps {
  match: Match;
  now: number;
  session: SourceSession | undefined;
  watching: boolean;
  revealed: boolean;
  mine: boolean;
  onOpen: () => void;
  onPlay: () => void;
  goalSide?: 'home' | 'away' | null;
  size?: 'md' | 'lg';
}

export function MatchCard({ match, now, session, watching, revealed, mine, onOpen, onPlay, goalSide, size = 'md' }: MatchCardProps) {
  const s = scoreAt(match, now);
  const signal = signalOf(session, match, now);
  const live = s.state === 'in';
  return (
    <article className={`tr-card${live ? ' is-live' : ''}${goalSide ? ' is-goal' : ''}`} aria-label={`${compName(match.competition)}: ${match.title}`}>
      <div className="tr-card-top">
        <span className="tr-card-comp">
          {compName(match.competition)}
          {match.round ? ` · ${match.round}` : ''}
        </span>
        {mine && <Chip tone="green">Tu equipo</Chip>}
      </div>
      <button type="button" className="tr-card-body" onClick={onOpen} aria-label="Abrir el centro de partido">
        <MatchHeader match={match} now={now} watching={watching} revealed={revealed} size={size} goalSide={goalSide} bare timeline={live || s.state === 'post'} />
      </button>
      <div className="tr-card-foot">
        <div className="tr-card-signal">
          <SignalMeter signal={signal} size="md" />
          {signal.detail && <span className="tr-card-signal-detail">{signal.detail}</span>}
        </div>
        <div className="tr-card-where">
          <span className="tr-card-where-k">Dónde se emite</span>
          <span className="tr-card-where-v">
            {match.channels.map((c) => (
              <Chip key={c.id}>{c.name}</Chip>
            ))}
          </span>
        </div>
        <div className="tr-card-cta">
          {watching ? (
            <Key variant="orange" icon={<IcChevronRight size={16} />} onClick={onOpen}>
              Volver al partido
            </Key>
          ) : live ? (
            <Key variant="orange" icon={<IcPlay size={16} />} onClick={onPlay}>
              Ver ahora
            </Key>
          ) : (
            <Key variant="paper" icon={<IcChevronRight size={16} />} onClick={onOpen}>
              {s.state === 'pre' ? 'Abrir el partido' : 'Ver el resumen'}
            </Key>
          )}
          {match.venue && <span className="tr-card-venue">{match.venue}</span>}
        </div>
      </div>
    </article>
  );
}
