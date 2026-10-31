/* Panel lateral de la agenda en escritorio (≥ 1024 px; plan Palco fase 2,
   decisión W4): el partido ELEGIDO (`selected` de agendaUi, o el destacado)
   como tarjeta versus grande, debajo «Señal» (cápsula + resumen), «Dónde se
   emite» (chips continuos o discontinuos, injerto B3) y la acción («Ver
   canal» / «Buscar canal», atajo O). El marcador va SIEMPRE tapado en la
   agenda: la cápsula «Marcador» de la esquina lo destapa (y lo vuelve a
   tapar) en esa misma cápsula. En escritorio no hay héroe (0.9.0): el panel
   enseña siempre el elegido. En la Agenda de escritorio del rediseño (`desk`)
   tiene la forma de la ficha: el cartel donde va el vídeo, el titular con
   «Marcador» y «Ver juntos», y los canales como las filas de fuentes.

   Doble clic sobre la tarjeta abre el partido (Intro sobre la tarjeta elegida
   de la lista también, como hoy). Sin goleadores ni estadio: ninguna API que
   usemos los da.

   LiveStrip (solo `wide`, injerto B1): cápsulas «En directo» con los escudos
   pequeños, las siglas, el MARCADOR y el minuto («RSO 1–0 VIL · 33'», pedido
   de Isma en la 0.9.0), dos por línea. El marcador se tapa en el partido que
   estás viendo (regla 29: tu emisión va por detrás) hasta que lo destapas, y
   en los que tapes a mano. Tocar un directo lo lleva al panel de abajo con su
   canal y «Ver canal». Como mucho dos líneas a la vista (con el asomo de la
   tercera): con diez directos un sábado, el panel y «Ver canal» no bajan; el
   resto se ve desplazando la tira, a mano, nunca sola. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import { competitionLogo, teamCrest, teamPalette, teamShort } from '../../lib/teams.ts';
import { Button, Chip, Icon, LiveDot, Num, TeamMark, VersusCard } from '../../ui/index.ts';
import { statusLine } from '../match-center/MatchHead.tsx';
import { matchGlow, versusSide, versusWhen } from './cards.ts';
import { useMatchSignal } from './data.ts';
import { liveMinute, matchStatus, matchTitle, paintableScore, type ChannelInfo } from './domain.ts';
import { ScoreToggle, SignalCapsule } from './MatchRow.tsx';
import {
  hideScore,
  revealScore,
  useScoreCovered,
  useScoreHidden,
  useScoreRevealed,
} from './score-reveal.ts';

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
  /** La Agenda de escritorio (rediseño, pantalla 1): con la forma de la ficha. */
  desk?: boolean;
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
  desk = false,
}: AgendaStageProps) {
  const titleId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const done = phase === 'done';
  const score = paintableScore(rawScore);
  const revealed = useScoreRevealed(match.id);
  const signal = useMatchSignal(match, now, { finished: done });
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  const glow = matchGlow(match);
  const style = {
    '--ta': done ? 'transparent' : glow.home,
    '--tb': done ? 'transparent' : glow.away,
  } as CSSProperties;

  /* Escritorio: la misma forma que la ficha que se abre al tocarlo. El cartel
     ocupa el sitio del vídeo (con «Ver canal» abajo a la derecha); debajo el
     partido en una línea, la competición y el estado, «Marcador» (tapado) y
     «Ver juntos»; y donde la ficha lista las fuentes, los canales que lo
     emiten con la señal de la agenda. */
  if (desk)
    return (
      <article
        className={cx('agenda-stage', 'agenda-stage--desk', phase && `is-${phase}`)}
        aria-labelledby={titleId}
      >
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
          {action || watching ? (
            <div className="agenda-stage__corner">
              <Button
                variant="primary"
                icon={watching || available ? 'play' : 'buscar'}
                className="agenda-stage__go"
                onClick={() => onOpen(match)}
                aria-label={action ? `${action} para ${match.title}` : undefined}
                aria-keyshortcuts="O"
              >
                {watching ? 'Volver al vídeo' : action}
              </Button>
            </div>
          ) : null}
        </div>
        <header className="agenda-stage__dhead">
          <div className="agenda-stage__titles">
            <h2 id={titleId} className="agenda-stage__title">
              <span aria-hidden="true">
                {match.home}
                {match.away ? ` – ${match.away}` : ''}
              </span>
              <span className="sr-only">{matchTitle(match)}</span>
            </h2>
            <p className="agenda-stage__sub">
              {[match.competition, statusLine(match, rawScore, now)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="agenda-stage__dactions">
            {score ? (
              <ScoreToggle
                match={match}
                score={score}
                revealed={revealed}
                glass={false}
                className="agenda-stage__score"
                onReveal={() => revealScore(match.id)}
                onHide={() => hideScore(match.id)}
              />
            ) : null}
            {/* Como en la ficha: la sala del partido en directo llega en otra fase. */}
            <Button
              icon="personas"
              className="agenda-stage__together"
              aria-disabled="true"
              title="Pronto: ver el partido con amigos"
            >
              Ver juntos
            </Button>
          </div>
        </header>
        <section className="agenda-stage__where" aria-label="Dónde se emite">
          <p className="agenda-stage__signal">
            {signal ? (
              <>
                <SignalCapsule signal={signal} size="sm" glass={false} />
                <span>{signal.summary.replace(/^Comprobando:\s*/, '')}</span>
              </>
            ) : (
              <span className="agenda-stage__muted">
                {done
                  ? 'El partido ha terminado.'
                  : channels.length === 0
                    ? 'Sin canal anunciado todavía.'
                    : 'Se comprueba cerca de la hora del partido.'}
              </span>
            )}
          </p>
          {channels.length ? (
            <ul className="agenda-stage__rows">
              {channels.map((channel, index) => (
                <li key={channel.name}>
                  <button
                    type="button"
                    className="agenda-stage__row"
                    title={
                      channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                    }
                    onClick={() => onOpen(match)}
                  >
                    <span className="agenda-stage__num" aria-hidden="true">
                      <Num value={index + 1} />
                    </span>
                    <span className="agenda-stage__rtext">
                      <span className="agenda-stage__rname">{channel.name}</span>
                      <span className="agenda-stage__rmeta">
                        <span className="agenda-stage__tag">
                          {channel.inLibrary ? 'En tu biblioteca' : 'Por buscar'}
                        </span>
                      </span>
                    </span>
                    <span className="agenda-stage__rend" aria-hidden="true">
                      <Icon name={channel.inLibrary ? 'play' : 'buscar'} size={18} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </article>
    );

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
        {score ? (
          <div className="agenda-stage__corner">
            <ScoreToggle
              match={match}
              score={score}
              revealed={revealed}
              onReveal={() => revealScore(match.id)}
              onHide={() => hideScore(match.id)}
            />
          </div>
        ) : null}
      </div>
      <div className="agenda-stage__body">
        <section className="agenda-stage__sec">
          <h3>Señal</h3>
          {signal ? (
            <p className="agenda-stage__signal">
              <SignalCapsule signal={signal} size="md" glass={false} />
              {/* La cápsula ya dice «Comprobando»: la frase, sin repetirlo. */}
              <span>{signal.summary.replace(/^Comprobando:\s*/, '')}</span>
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

/** Cápsulas a la vista en «En directo» (dos líneas de dos); con más, la tira se desplaza. */
const STRIP_VISIBLE = 4;

/** Tira de directos (injerto B1): cápsulas con escudos, marcador y minuto; dos líneas como mucho a la vista. */
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
  const many = live.length > STRIP_VISIBLE;
  const listRef = useRef<HTMLUListElement>(null);
  // ¿Quedan cápsulas por debajo? (la segunda línea se funde abajo).
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = useCallback(() => {
    const el = listRef.current;
    setMoreBelow(el !== null && el.scrollHeight - el.clientHeight - el.scrollTop > 2);
  }, []);
  useLayoutEffect(measure, [measure, many, live.length]);
  if (live.length === 0) return null;
  return (
    <nav className="agenda-strip" aria-label={label}>
      <span className="agenda-strip__title">
        <LiveDot />
        {label}
        <Num className="agenda-strip__count" value={live.length} condensed={false} />
      </span>
      <ul
        ref={listRef}
        className={cx('agenda-strip__list', many && 'agenda-strip__list--more')}
        data-more-below={many && moreBelow ? '' : undefined}
        onScroll={many ? measure : undefined}
      >
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
  /* A la vista salvo en el partido que estás viendo (regla 29), hasta
     destaparlo, y salvo que lo hayas tapado a mano (cápsula «Marcador» del
     panel o menú «Tapar el marcador»). */
  const watchedHidden = useScoreHidden(match.id);
  const covered = useScoreCovered(match.id);
  const shown = watchedHidden || covered ? null : score;
  const minute = liveMinute(rawScore);
  const minuteText = minute ? (minute.halftime ? 'descanso' : `minuto ${minute.minute}`) : null;
  return (
    <button
      type="button"
      className="agenda-strip__chip press"
      aria-current={current ? 'true' : undefined}
      onClick={() => onSelect(match)}
      aria-label={`${matchTitle(match)}${shown ? `, ${shown.home} a ${shown.away}` : ''}${
        minuteText ? `, ${minuteText}` : ''
      }`}
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
      <span className="agenda-strip__line" aria-hidden="true">
        <span className="agenda-strip__team">{teamShort(match, 'home')}</span>
        {shown ? (
          <Num className="agenda-strip__score" value={`${shown.home}–${shown.away}`} />
        ) : (
          <span className="agenda-strip__vs">vs</span>
        )}
        {match.away ? <span className="agenda-strip__team">{teamShort(match, 'away')}</span> : null}
        {minute ? (
          <span className="agenda-strip__minute">
            {minute.halftime ? 'Desc.' : <Num value={`${minute.minute}'`} />}
          </span>
        ) : null}
      </span>
    </button>
  );
}
