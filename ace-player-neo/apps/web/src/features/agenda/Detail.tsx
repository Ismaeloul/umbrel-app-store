/* El detalle del partido elegido en la Agenda de escritorio (desde 768 px),
   al estilo SofaScore pero sin apuestas ni estadísticas (Isma, 1-11-2026):
   lo que importa aquí es dónde se ve.

   - Arriba, las migas «País › Competición» y la X que cierra el detalle
     (vuelve a no haber nada elegido).
   - El versus: los escudos grandes con su nombre debajo y, en el centro, la
     hora en grande y el día; en directo, el minuto en rojo, y debajo el
     resultado A LA VISTA (Isma, 1-11-2026: en la ficha de la Agenda el
     marcador no se tapa). Solo va tapado, en la cápsula «Marcador», el del
     partido que estás viendo (regla 29: tu emisión va por detrás) o uno que
     tapaste a mano.
   - «Ver partido» (el centro de partido con el vídeo, atajo O; doble clic en
     el versus también) y «Ver juntos».
   - «Dónde se ve»: la señal del comprobador (lo que ya se probó cerca de la
     hora: solo cuentan las retransmisiones que funcionan) y los canales de
     la agenda en filas, con si están en tu biblioteca.

   Sin elegir nada (al entrar), `AgendaDetailEmpty`: una invitación a elegir
   un partido y el resumen del día. Nunca el destacado. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useId } from 'react';
import { cx } from '../../lib/cx.ts';
import { Button, Icon, IconButton, LiveDot, Num, TeamMark } from '../../ui/index.ts';
import { LiveJuntosButton } from '../juntos/LiveCreate.tsx';
import { versusSide } from './cards.ts';
import { useMatchSignal } from './data.ts';
import {
  competitionArea,
  dayLabel,
  liveMinute,
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
} from './domain.ts';
import { ScoreToggle, SignalCapsule } from './MatchRow.tsx';
import {
  hideScore,
  revealScore,
  useScoreCovered,
  useScoreHidden,
  useWatchedMatch,
} from './score-reveal.ts';

export interface AgendaDetailProps {
  match: FootballMatch;
  now: number;
  today: string;
  score: LiveScore | null;
  channels: readonly ChannelInfo[];
  mine: boolean;
  /** Este dispositivo ya reproduce el partido. */
  watching: boolean;
  onOpen(match: FootballMatch): void;
  onClose(): void;
}

/** «Hoy», «Mañana» o «Martes, 3 nov» bajo la hora. */
function dayUnder(date: string, today: string): string {
  const label = dayLabel(date, today);
  return label.primary === 'Hoy' || label.primary === 'Mañana' || label.primary === 'Ayer'
    ? label.primary
    : `${label.primary}, ${label.secondary}`;
}

export function AgendaDetail({
  match,
  now,
  today,
  score: rawScore,
  channels,
  mine,
  watching,
  onOpen,
  onClose,
}: AgendaDetailProps) {
  const titleId = useId();
  const whereId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const live = phase === 'live';
  const done = phase === 'done';
  const score = paintableScore(rawScore);
  /* Tapado solo si es el que suena (sin destapar) o si lo tapaste a mano. */
  const hidden = useScoreHidden(match.id, watching);
  const covered = useScoreCovered(match.id);
  const watchedHere = useWatchedMatch() === match.id || watching;
  const signal = useMatchSignal(match, now, { finished: done });
  const minute = liveMinute(rawScore);
  const competition = match.competition?.trim() || 'Fútbol';
  const area = competitionArea(competition);
  const home = versusSide(match, 'home');
  const away = match.away ? versusSide(match, 'away') : null;
  const canOpen = watching || channels.length > 0;
  const time = /^\d{2}:\d{2}$/.test(match.time) ? match.time : null;

  const team = (side: ReturnType<typeof versusSide>) => (
    <div className="agenda-detail__team">
      <TeamMark
        name={side.name}
        short={side.short}
        colors={side.colors}
        crest={side.crest}
        size={56}
        plate
        lit={live}
      />
      <span className="agenda-detail__name">{side.name}</span>
    </div>
  );

  return (
    <article
      className={cx('agenda-detail', phase && `is-${phase}`, mine && 'is-mine')}
      aria-labelledby={titleId}
    >
      <div className="agenda-detail__top">
        <p className="agenda-detail__crumbs">
          {area ? (
            <>
              <span>{area}</span>
              <Icon name="chev-r" size={16} />
            </>
          ) : null}
          <span className="agenda-detail__comp">{competition}</span>
        </p>
        <IconButton
          icon="x"
          label="Cerrar el detalle"
          className="agenda-detail__close"
          onClick={onClose}
        />
      </div>
      <h2 id={titleId} className="sr-only">
        {matchTitle(match)}
      </h2>
      <div
        className="agenda-detail__versus"
        title={canOpen ? 'Doble clic para ver el partido' : undefined}
        onDoubleClick={canOpen ? () => onOpen(match) : undefined}
      >
        {team(home)}
        <div className="agenda-detail__center">
          {live ? (
            <span className="agenda-detail__minute">
              <LiveDot />
              {minute ? (minute.halftime ? 'Descanso' : `${minute.minute}'`) : 'En directo'}
            </span>
          ) : done ? (
            <span className="agenda-detail__final">Final</span>
          ) : (
            <b className="agenda-detail__time">{time ?? 'Por confirmar'}</b>
          )}
          {score && (live || done) ? (
            watchedHere || covered ? (
              /* El que estás viendo (o uno tapado a mano): la cápsula, para
                 destaparlo y volver a taparlo. */
              <ScoreToggle
                match={match}
                score={score}
                revealed={!hidden && !covered}
                glass={false}
                className="agenda-detail__score"
                onReveal={() => revealScore(match.id)}
                onHide={() => hideScore(match.id)}
              />
            ) : (
              <span
                className={cx('agenda-detail__result', live && 'agenda-detail__result--live')}
                aria-label={`${live ? 'Marcador' : 'Resultado'}: ${score.home} a ${score.away}`}
              >
                <Num value={score.home} />
                <span className="agenda-detail__dash" aria-hidden="true">
                  –
                </span>
                <Num value={score.away} />
              </span>
            )
          ) : (
            <span className="agenda-detail__day">{dayUnder(match.date, today)}</span>
          )}
        </div>
        {away ? team(away) : <div className="agenda-detail__team" aria-hidden="true" />}
      </div>
      <div className="agenda-detail__actions">
        <Button
          variant="primary"
          icon="play"
          className="agenda-detail__go"
          disabled={!canOpen}
          onClick={() => onOpen(match)}
          aria-label={
            watching ? undefined : canOpen ? `Ver partido: ${matchTitle(match)}` : undefined
          }
          aria-keyshortcuts="O"
        >
          {watching ? 'Volver al vídeo' : 'Ver partido'}
        </Button>
        {/* Como en la ficha: la sala del partido en directo (docs/ver-juntos.md §14). */}
        <LiveJuntosButton
          match={match}
          look={{ className: 'agenda-detail__together', size: 'md' }}
        />
      </div>
      <section className="agenda-detail__where" aria-labelledby={whereId}>
        <h3 id={whereId} className="agenda-detail__tab">
          <span>Dónde se ve</span>
        </h3>
        <p className="agenda-detail__signal">
          {signal ? (
            <>
              <SignalCapsule signal={signal} size="sm" glass={false} />
              {/* La cápsula ya dice «Comprobando»: la frase, sin repetirlo. */}
              <span>{signal.summary.replace(/^Comprobando:\s*/, '')}</span>
            </>
          ) : (
            <span className="agenda-detail__muted">
              {done
                ? 'El partido ha terminado.'
                : channels.length === 0
                  ? 'Sin canal anunciado todavía.'
                  : 'Las retransmisiones se comprueban cerca de la hora del partido.'}
            </span>
          )}
        </p>
        {channels.length ? (
          <ul className="agenda-detail__rows">
            {channels.map((channel, index) => (
              <li key={channel.name}>
                <button
                  type="button"
                  className="agenda-detail__row"
                  title={
                    channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                  }
                  onClick={() => onOpen(match)}
                >
                  <span className="agenda-detail__num" aria-hidden="true">
                    <Num value={index + 1} />
                  </span>
                  <span className="agenda-detail__rtext">
                    <span className="agenda-detail__rname">{channel.name}</span>
                    <span className="agenda-detail__tag">
                      {channel.inLibrary ? 'En tu biblioteca' : 'Por buscar'}
                    </span>
                  </span>
                  <span className="agenda-detail__rend" aria-hidden="true">
                    <Icon name={channel.inLibrary ? 'play' : 'buscar'} size={16} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </article>
  );
}

/** Sin partido elegido: qué hacer y el resumen del día (nunca el destacado). */
export function AgendaDetailEmpty({
  dayText,
  total,
  live,
}: {
  /** «Hoy», «Mañana», «Martes»… */
  dayText: string | null;
  total: number;
  live: number;
}) {
  return (
    <div className="agenda-detail agenda-detail--empty">
      <span className="agenda-detail__icon" aria-hidden="true">
        <Icon name="tv" size={28} />
      </span>
      <h2 className="agenda-detail__invite">Elige un partido</h2>
      <p className="agenda-detail__muted">
        Aquí verás dónde se emite y en qué canales. Doble clic o Intro en la lista lo abre
        directamente.
      </p>
      {dayText ? (
        <p className="agenda-detail__summary">
          <span>
            {dayText}: <Num value={total} condensed={false} />{' '}
            {total === 1 ? 'partido' : 'partidos'}
          </span>
          {live > 0 ? (
            <span className="agenda-detail__summary-live">
              <LiveDot />
              <Num value={live} condensed={false} /> en directo
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
