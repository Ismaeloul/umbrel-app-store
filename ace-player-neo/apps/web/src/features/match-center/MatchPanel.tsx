/* Pestaña «Partido» del teatro (plan Palco fase 2, decisión W5): el partido
   entero en un vistazo, sin salir del vídeo.

   - Arriba, los dos equipos con su escudo grande y su nombre sobre la luz de
     los dos clubes (la misma pareja de colores que la tarjeta versus) y, en
     medio, el marcador grande solo si está destapado (regla 29), la hora o
     «Destapar el marcador»; con un gol, el escudo del que marca crece y la
     luz sube un momento.
   - La barra del partido con la muesca del descanso (en juego o terminado).
   - La competición con su pastilla (CompetitionBadge) y el día y la hora.
   - «Dónde se emite» con la chuleta de atajos (WhereAired). */

import type { FootballMatch, LiveScore } from '@ace/shared';
import type { CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import { competitionLogo, matchVersusPair } from '../../lib/teams.ts';
import { CompetitionBadge, ProgressBar } from '../../ui/index.ts';
import {
  dayLabel,
  liveMinute,
  matchProgressAt,
  matchStatus,
  type ChannelInfo,
} from '../agenda/domain.ts';
import { BigScore } from './Scoreboard.tsx';
import { WhereAired } from './WhereAired.tsx';

export interface MatchPanelProps {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
  channels: readonly ChannelInfo[];
  today: string;
}

export function MatchPanel({ match, score, now, channels, today }: MatchPanelProps) {
  const status = matchStatus(match, now, score);
  const live = status?.phase === 'live';
  const done = status?.phase === 'done';
  const minute = live ? liveMinute(score) : null;
  const pair = matchVersusPair(match);
  const day = dayLabel(match.date, today);
  const style = {
    '--ta': pair.home,
    '--tb': match.away ? pair.away : pair.home,
  } as CSSProperties;
  return (
    <div className={cx('mc-panel', live && 'is-live', done && 'is-done')}>
      <div className="mc-panel__card" style={style}>
        <div className="mc-panel__light" aria-hidden="true" />
        <BigScore key={match.id} match={match} score={score} now={now} />
        {live || done ? (
          <div className="mc-panel__timeline">
            <ProgressBar
              value={matchProgressAt(match, now, score)}
              label={
                done
                  ? 'Partido terminado'
                  : minute
                    ? `Minuto ${minute.minute} de 90`
                    : 'Partido en juego'
              }
              tone="live"
              marks={[0.5]}
            />
            <div className="mc-panel__marks" aria-hidden="true">
              <span>0'</span>
              <span>Descanso</span>
              <span>90'</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mc-panel__facts">
        {match.competition ? (
          <CompetitionBadge name={match.competition} logo={competitionLogo(match)} size="md" />
        ) : null}
        <div className="mc-panel__fact">
          <span className="mc-panel__competition">{match.competition || 'Partido'}</span>
          <span className="mc-panel__date">{day.long}</span>
        </div>
      </div>
      <WhereAired match={match} channels={channels} today={today} />
    </div>
  );
}
