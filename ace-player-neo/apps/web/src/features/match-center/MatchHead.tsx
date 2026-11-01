/* Cabecera del teatro, justo debajo del vídeo (plan Palco fase 2, decisión
   W5): el rótulo de la competición con el estado («CHAMPIONS LEAGUE · EN
   DIRECTO · 72'») y los dos equipos con su escudo en la voz expandida de
   Palco. Sin marcador (va tapado en la cápsula del vídeo).

   - El título que se LEE es el h1 oculto (`Local vs Visitante`, tabindex
     -1): el armazón le da el foco al navegar y las e2e lo buscan. Los nombres
     visibles van con aria-hidden para no leerse dos veces.
   - Sin elemento compartido: el partido se abre con el mismo fundido que
     cualquier cambio de vista (src/app/transitions.ts, 0.9.0).

   En el móvil (maqueta movil-ficha-partido.html, dirección B «Vídeo
   arriba») va MobileMatchHead: los dos equipos en una línea con el minuto y
   «Marcador» (tapado, regla 29) en medio, y la competición debajo.

   Desde 768 (rediseño de escritorio, pantalla 1) va DeskMatchHead: el
   partido en una línea con la competición y el estado debajo y, a la
   derecha, «Marcador» (tapado) y «Ver juntos». */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { cx } from '../../lib/cx.ts';
import { LiveDot } from '../../ui/index.ts';
import { liveMinute, matchStatus, matchTitle } from '../agenda/domain.ts';
import { LiveJuntosButton } from '../juntos/LiveCreate.tsx';
import { ScoreChip, SideMark } from './Scoreboard.tsx';

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

/** Cabecera de la ficha de escritorio: titular, competición y estado, y sus botones. */
export function DeskMatchHead({
  match,
  score,
  now,
  active = true,
}: {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
  /** Con la vista oculta, el marcador no celebra goles (ni vibra). */
  active?: boolean;
}) {
  const live = matchStatus(match, now, score)?.phase === 'live';
  const sub = [match.competition, statusLine(match, score, now)].filter(Boolean).join(' · ');
  return (
    <header className={cx('mc-dhead', live && 'is-live')}>
      <div className="mc-dhead__titles">
        <p className="mc-dhead__title" aria-hidden="true">
          {match.home}
          {match.away ? ` – ${match.away}` : ''}
        </p>
        <h1 id={`mc-title-${match.id}`} className="sr-only" tabIndex={-1}>
          {matchTitle(match)}
        </h1>
        <p className="mc-dhead__sub">{sub}</p>
      </div>
      <div className="mc-dhead__actions">
        <ScoreChip match={match} score={score} now={now} quiet={!active} />
        {/* La sala del partido en directo (docs/ver-juntos.md §14). */}
        <LiveJuntosButton match={match} look={{ className: 'mc-dhead__together', size: 'md' }} />
      </div>
    </header>
  );
}

/** Lo de en medio de la cabecera móvil: «67'», «Descanso», «Final», «En 48 min» o la hora. */
export function mobileWhen(
  match: FootballMatch,
  score: LiveScore | null,
  now: number,
): { text: string; live: boolean } {
  const status = matchStatus(match, now, score);
  if (status?.phase === 'live') {
    const minute = liveMinute(score);
    if (!minute) return { text: 'En directo', live: true };
    return { text: minute.halftime ? 'Descanso' : `${minute.minute}'`, live: true };
  }
  if (status?.phase === 'done') return { text: 'Final', live: false };
  if (status) return { text: status.text, live: false };
  return {
    text: /^\d{2}:\d{2}$/.test(match.time) ? match.time : 'Hora por confirmar',
    live: false,
  };
}

/** Cabecera de la ficha móvil (dirección B): equipos, minuto y «Marcador», y la competición. */
export function MobileMatchHead({
  match,
  score,
  now,
  active = true,
}: {
  match: FootballMatch;
  score: LiveScore | null;
  now: number;
  /** Con la vista oculta, el marcador no celebra goles (ni vibra). */
  active?: boolean;
}) {
  const when = mobileWhen(match, score, now);
  return (
    <header className={cx('mc-bhead', when.live && 'is-live')}>
      <div className="mc-bhead__row">
        <p className="mc-bhead__team" aria-hidden="true">
          <SideMark
            match={match}
            side="home"
            size={20}
            lit={when.live}
            className="mc-bhead__crest"
          />
          <span className="mc-bhead__name">{match.home}</span>
        </p>
        <div className="mc-bhead__mid">
          <span className={cx('mc-bhead__when', when.live && 'is-live')}>
            {when.live ? <LiveDot /> : null}
            {when.text}
          </span>
          <ScoreChip match={match} score={score} now={now} quiet={!active} />
        </div>
        {match.away ? (
          <p className="mc-bhead__team mc-bhead__team--away" aria-hidden="true">
            <span className="mc-bhead__name">{match.away}</span>
            <SideMark
              match={match}
              side="away"
              size={20}
              lit={when.live}
              className="mc-bhead__crest"
            />
          </p>
        ) : (
          <span />
        )}
      </div>
      {match.competition ? <p className="mc-bhead__comp">{match.competition}</p> : null}
      <h1 id={`mc-title-${match.id}`} className="sr-only" tabIndex={-1}>
        {matchTitle(match)}
      </h1>
    </header>
  );
}
