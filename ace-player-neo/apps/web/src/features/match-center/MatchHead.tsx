/* Cabecera del teatro, justo debajo del vídeo (plan Palco fase 2, decisión
   W5): el rótulo de la competición con el estado («CHAMPIONS LEAGUE · EN
   DIRECTO · 72'») y los dos equipos con su escudo en la voz expandida de
   Palco. Sin marcador (va tapado en la cápsula del vídeo).

   - El título que se LEE es el h1 oculto (`Local vs Visitante`, tabindex
     -1): el armazón le da el foco al navegar y las e2e lo buscan. Los nombres
     visibles van con aria-hidden para no leerse dos veces.
   - Sin elemento compartido: el partido se abre con el mismo fundido que
     cualquier cambio de vista (src/app/transitions.ts, 0.9.0). */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { cx } from '../../lib/cx.ts';
import { LiveDot } from '../../ui/index.ts';
import { liveMinute, matchStatus, matchTitle } from '../agenda/domain.ts';
import { SideMark } from './Scoreboard.tsx';

/** «En directo · 72'», «Descanso», «Final», «En 48 min» o la hora. */
export function statusLine(match: FootballMatch, score: LiveScore | null, now: number): string {
  const status = matchStatus(match, now, score);
  if (status?.phase === 'live') {
    const minute = liveMinute(score);
    if (!minute) return 'En directo';
    return minute.halftime ? 'Descanso' : `En directo · ${minute.minute}'`;
  }
  if (status?.phase === 'done') return 'Final';
  if (status) return status.text;
  return /^\d{2}:\d{2}$/.test(match.time) ? match.time : 'Hora por confirmar';
}

export function MatchHead({
  match,
  score,
  now,
}: {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
}) {
  const live = matchStatus(match, now, score)?.phase === 'live';
  const kicker = [match.competition, statusLine(match, score, now)].filter(Boolean).join(' · ');
  return (
    <header className={cx('mc-head', live && 'is-live')}>
      <p className="mc-head__kicker">
        {live ? <LiveDot /> : null}
        {kicker}
      </p>
      <div className="mc-head__teams" aria-hidden="true">
        <SideMark match={match} side="home" size={34} lit={live} className="mc-head__crest" />
        <span className="mc-head__names">
          {match.home}
          {match.away ? (
            <>
              {' '}
              <span className="mc-head__vs">–</span> {match.away}
            </>
          ) : null}
        </span>
        {match.away ? (
          <SideMark match={match} side="away" size={34} lit={live} className="mc-head__crest" />
        ) : null}
      </div>
      <h1 id={`mc-title-${match.id}`} className="sr-only" tabIndex={-1}>
        {matchTitle(match)}
      </h1>
    </header>
  );
}
