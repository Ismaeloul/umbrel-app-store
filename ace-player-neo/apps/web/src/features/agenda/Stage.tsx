/* Escenario de la agenda en escritorio (≥ 1024 px, opción A): el partido
   elegido en grande, con los focos de sus dos equipos detrás de un panel de
   cristal, el marcador a 96 px (o la hora), la barra del partido, su señal,
   dónde se emite y la acción («Ver canal» / «Buscar canal»).

   - El marcador del partido que ves sale TAPADO con barras de censura y se
     destapa girando como una paleta (corrección 2 e injerto B5).
   - Debajo, «Luego»: los próximos partidos del día (corrección 5: el hueco de
     la columna derecha ya no queda vacío).
   - Sin goleadores ni estadio: ninguna API que usemos los da (ver respuesta
     del agente; el marcador de ESPN solo trae el resultado y el reloj). */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useId, useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import {
  Button,
  Chip,
  LiveDot,
  Num,
  Panel,
  ProgressBar,
  SignalBadge,
  TeamMark,
} from '../../ui/index.ts';
import { useMatchSignal } from './data.ts';
import {
  dayLabel,
  keepUnitsTogether,
  liveMinute,
  matchProgressAt,
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
} from './domain.ts';
import { CensorBars, FlipNum, teamGlow } from './MatchRow.tsx';
import { revealScore, useScoreHidden } from './score-reveal.ts';

export interface AgendaStageProps {
  match: FootballMatch;
  now: number;
  today: string;
  score: LiveScore | null;
  channels: readonly ChannelInfo[];
  onOpen(match: FootballMatch): void;
}

export function AgendaStage({
  match,
  now,
  today,
  score: rawScore,
  channels,
  onOpen,
}: AgendaStageProps) {
  const titleId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const live = phase === 'live';
  const done = phase === 'done';
  const score = paintableScore(rawScore);
  const hidden = useScoreHidden(match.id) && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
  const signal = useMatchSignal(match, now, { finished: done });
  const minute = liveMinute(rawScore);
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  const day = dayLabel(match.date, today);

  const style = {
    '--ta': done ? 'transparent' : teamGlow(match.home),
    '--tb': done ? 'transparent' : teamGlow(match.away || match.home),
  } as CSSProperties;

  const when = live ? (
    <span className="agenda-stage__when is-live">
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
    <span className="agenda-stage__when">
      {done ? 'Final' : status ? keepUnitsTogether(status.text) : day.long}
    </span>
  );

  return (
    <article
      className={cx('agenda-stage', phase && `is-${phase}`)}
      style={style}
      aria-labelledby={titleId}
    >
      <div className="agenda-stage__light" aria-hidden="true" />
      <Panel className="agenda-stage__pane" radius="l" padding={5}>
        <div className="agenda-stage__top">
          {live ? (
            <span className="agenda-stage__tag is-live">
              <LiveDot />
              En directo
            </span>
          ) : (
            <span className="agenda-stage__tag">
              {done ? 'Terminado' : `${day.primary}, ${match.time}`}
            </span>
          )}
          <span className="agenda-stage__comp">{match.competition || 'Fútbol'}</span>
        </div>
        <h2 id={titleId} className="sr-only">
          {matchTitle(match)}
        </h2>
        <div className="agenda-stage__score">
          <div className="agenda-stage__side">
            <TeamMark name={match.home} size={84} lit={live} className="agenda-stage__crest" />
            <span className="agenda-stage__name">{match.home}</span>
          </div>
          <div className="agenda-stage__mid" aria-live="polite">
            {hidden ? (
              <button
                type="button"
                className="agenda-stage__cover press"
                title="Tu emisión va por detrás del directo"
                onClick={() => {
                  setJustRevealed(true);
                  revealScore(match.id);
                }}
              >
                <CensorBars className="agenda-censor--big" />
                <span>Ver marcador</span>
              </button>
            ) : score ? (
              <span
                className="agenda-stage__big"
                aria-label={`${match.home} ${score.home}, ${match.away || ''} ${score.away}`}
              >
                <FlipNum value={score.home} animateOnMount={justRevealed} />
                <span className="agenda-stage__sep" aria-hidden="true">
                  –
                </span>
                <FlipNum value={score.away} animateOnMount={justRevealed} />
              </span>
            ) : (
              <Num className="agenda-stage__big agenda-stage__big--time" value={match.time} />
            )}
            {when}
          </div>
          <div className="agenda-stage__side">
            {match.away ? (
              <>
                <TeamMark name={match.away} size={84} lit={live} className="agenda-stage__crest" />
                <span className="agenda-stage__name">{match.away}</span>
              </>
            ) : null}
          </div>
        </div>
        {live || done ? (
          <div className="agenda-stage__timeline">
            <ProgressBar
              value={matchProgressAt(match, now, rawScore)}
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
            <div className="agenda-stage__marks" aria-hidden="true">
              <span>0'</span>
              <span>Descanso</span>
              <span>90'</span>
            </div>
          </div>
        ) : null}
      </Panel>
      <div className="agenda-stage__body">
        <section className="agenda-stage__sec">
          <h3>Señal</h3>
          {signal ? (
            <p className="agenda-stage__signal">
              {/* La frase de al lado ya dice el estado: la palabra queda para lectores de pantalla. */}
              <SignalBadge state={signal.state} size="lg" label={signal.label} hideWord />
              <span>{signal.summary}</span>
            </p>
          ) : (
            <p className="agenda-stage__muted">
              {done
                ? 'El partido ha terminado.'
                : channels.length === 0
                  ? 'Sin canal anunciado todavía.'
                  : 'Se comprueba cerca de la hora del partido.'}
            </p>
          )}
        </section>
        <section className="agenda-stage__sec">
          <h3>Dónde se emite</h3>
          {channels.length ? (
            <div className="agenda-stage__chips">
              {channels.map((channel) => (
                <Chip
                  key={channel.name}
                  icon="tv"
                  outline={channel.inLibrary ? 'solid' : 'dashed'}
                  title={
                    channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                  }
                >
                  {channel.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="agenda-stage__muted">Canal por confirmar</p>
          )}
        </section>
        <div className="agenda-stage__actions">
          <Button
            variant="primary"
            icon={action ? (available ? 'play' : 'buscar') : undefined}
            disabled={!action}
            onClick={() => onOpen(match)}
            aria-label={action ? `${action} para ${match.title}` : undefined}
            aria-keyshortcuts="O"
          >
            {action ?? 'Canal por confirmar'}
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Tira de directos (injerto B1): marcadores en vivo de un vistazo; se desplaza a mano, nunca sola. */
export function LiveStrip({
  matches,
  now,
  scores,
  currentId,
  onSelect,
  label = 'En directo',
}: {
  matches: readonly FootballMatch[];
  now: number;
  scores: Readonly<Record<string, LiveScore>>;
  currentId: string | null;
  onSelect(match: FootballMatch): void;
  label?: string;
}) {
  const live = matches.filter(
    (match) => matchStatus(match, now, scores[match.id])?.phase === 'live',
  );
  if (live.length === 0) return null;
  return (
    <nav className="agenda-strip" aria-label={label}>
      <span className="agenda-strip__title">
        <LiveDot />
        {label}
      </span>
      <ul className="agenda-strip__list">
        {live.map((match) => (
          <li key={match.id}>
            <LiveChip
              match={match}
              score={scores[match.id] ?? null}
              current={match.id === currentId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function short(name: string): string {
  const clean = name.replace(/^(FC|CF|CD|SD|UD|RC|RCD)\s+/i, '').trim();
  return clean.length > 12 ? `${clean.slice(0, 11)}…` : clean;
}

function LiveChip({
  match,
  score: rawScore,
  current,
  onSelect,
}: {
  match: FootballMatch;
  score: LiveScore | null;
  current: boolean;
  onSelect(match: FootballMatch): void;
}) {
  const score = paintableScore(rawScore);
  const hidden = useScoreHidden(match.id) && score !== null;
  const minute = liveMinute(rawScore);
  return (
    <button
      type="button"
      className="agenda-strip__chip press"
      aria-current={current ? 'true' : undefined}
      onClick={() => onSelect(match)}
      aria-label={`${matchTitle(match)}${hidden ? ', marcador oculto' : score ? `, ${score.home} a ${score.away}` : ''}`}
    >
      <span className="agenda-strip__team">{short(match.home)}</span>
      {hidden ? (
        <CensorBars />
      ) : score ? (
        <Num className="agenda-strip__score" value={`${score.home}–${score.away}`} />
      ) : (
        <span className="agenda-strip__vs">vs</span>
      )}
      <span className="agenda-strip__team">{short(match.away || '')}</span>
      {minute ? (
        <span className="agenda-strip__minute">
          {minute.halftime ? 'Desc.' : <Num value={`${minute.minute}'`} />}
        </span>
      ) : null}
    </button>
  );
}
