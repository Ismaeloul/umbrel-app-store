/* Panel lateral de la agenda en escritorio (≥ 1024 px; plan Palco fase 2,
   decisión W4): el partido ELEGIDO (`selected` de agendaUi, o el destacado)
   como tarjeta versus grande, debajo «Señal» (cápsula + resumen), «Dónde se
   emite» (chips continuos o discontinuos, injerto B3) y la acción («Ver
   canal» / «Buscar canal», atajo O). El marcador del partido que ves sale
   TAPADO y se destapa en una cápsula sobre la tarjeta (regla 29).

   Doble clic sobre la tarjeta abre el partido (Intro sobre la tarjeta elegida
   de la lista también, como hoy). Sin goleadores ni estadio: ninguna API que
   usemos los da.

   LiveStrip (solo `wide`, injerto B1): fila de cápsulas «En directo» con los
   escudos pequeños, las siglas y el minuto; el marcador solo si está
   destapado. Se desplaza a mano, nunca sola. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useId, useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { competitionLogo, teamCrest, teamPalette, teamShort } from '../../lib/teams.ts';
import { Button, Chip, LiveDot, Num, TeamMark, VersusCard } from '../../ui/index.ts';
import { matchGlow, versusSide, versusWhen } from './cards.ts';
import { useMatchSignal } from './data.ts';
import { liveMinute, matchStatus, matchTitle, paintableScore, type ChannelInfo } from './domain.ts';
import { CensorBars, ScoreCapsule, SignalCapsule } from './MatchRow.tsx';
import { revealScore, useScoreHidden } from './score-reveal.ts';

export interface AgendaStageProps {
  match: FootballMatch;
  now: number;
  today: string;
  score: LiveScore | null;
  channels: readonly ChannelInfo[];
  mine: boolean;
  /** Este dispositivo ya reproduce el partido. */
  watching: boolean;
  onOpen(match: FootballMatch): void;
}

export function AgendaStage({
  match,
  now,
  today,
  score: rawScore,
  channels,
  mine,
  watching,
  onOpen,
}: AgendaStageProps) {
  const titleId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const done = phase === 'done';
  const score = paintableScore(rawScore);
  const hidden = useScoreHidden(match.id) && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
  const signal = useMatchSignal(match, now, { finished: done });
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  const glow = matchGlow(match);
  const style = {
    '--ta': done ? 'transparent' : glow.home,
    '--tb': done ? 'transparent' : glow.away,
  } as CSSProperties;

  return (
    <article
      className={cx('agenda-stage', phase && `is-${phase}`)}
      style={style}
      aria-labelledby={titleId}
    >
      <div className="agenda-stage__light" aria-hidden="true" />
      <h2 id={titleId} className="sr-only">
        {matchTitle(match)}
      </h2>
      <div
        className="agenda-stage__card"
        title="Doble clic para abrir el partido"
        onDoubleClick={() => onOpen(match)}
      >
        <VersusCard
          size="lg"
          home={versusSide(match, 'home')}
          away={versusSide(match, 'away')}
          competition={match.competition?.trim() || 'Fútbol'}
          competitionLogo={competitionLogo(match)}
          when={versusWhen(match, now, rawScore, today)}
          mine={mine}
          watching={watching}
          className="agenda-stage__versus"
        />
        <div className="agenda-stage__corner">
          {hidden ? (
            <button
              type="button"
              className="agenda-cover press"
              aria-label="Ver marcador"
              title="Tu emisión va por detrás del directo"
              onClick={() => {
                setJustRevealed(true);
                haptic('light');
                revealScore(match.id);
              }}
            >
              <CensorBars />
              <span className="agenda-cover__text">Ver marcador</span>
            </button>
          ) : score ? (
            <ScoreCapsule score={score} reveal={justRevealed} size="md" />
          ) : null}
        </div>
      </div>
      <div className="agenda-stage__body">
        <section className="agenda-stage__sec">
          <h3>Señal</h3>
          {signal ? (
            <p className="agenda-stage__signal">
              <SignalCapsule signal={signal} size="md" glass={false} />
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
            icon={watching ? 'play' : action ? (available ? 'play' : 'buscar') : undefined}
            disabled={!action && !watching}
            onClick={() => onOpen(match)}
            aria-label={action ? `${action} para ${match.title}` : undefined}
            aria-keyshortcuts="O"
          >
            {watching ? 'Volver al vídeo' : (action ?? 'Canal por confirmar')}
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Tira de directos (injerto B1): cápsulas con escudos y minuto; se desplaza a mano, nunca sola. */
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
      <span className="agenda-strip__crests" aria-hidden="true">
        <TeamMark
          name={match.home}
          short={teamShort(match, 'home')}
          colors={teamPalette(match, 'home')}
          crest={teamCrest(match, 'home')}
          size={18}
          lit
        />
        {match.away ? (
          <TeamMark
            name={match.away}
            short={teamShort(match, 'away')}
            colors={teamPalette(match, 'away')}
            crest={teamCrest(match, 'away')}
            size={18}
            lit
          />
        ) : null}
      </span>
      <span className="agenda-strip__team">{teamShort(match, 'home')}</span>
      {hidden ? (
        <CensorBars />
      ) : score ? (
        <Num className="agenda-strip__score" value={`${score.home}–${score.away}`} />
      ) : (
        <span className="agenda-strip__vs">vs</span>
      )}
      <span className="agenda-strip__team">{match.away ? teamShort(match, 'away') : ''}</span>
      {minute ? (
        <span className="agenda-strip__minute">
          {minute.halftime ? 'Desc.' : <Num value={`${minute.minute}'`} />}
        </span>
      ) : null}
    </button>
  );
}
