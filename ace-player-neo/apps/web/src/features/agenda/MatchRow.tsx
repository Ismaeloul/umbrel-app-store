/* Franja de partido (inventario §3.4 con la anatomía de la opción A): tres
   columnas, en este orden de lectura (eleccion.md, «qué partidos hay, cuáles
   en directo y si hay señal»):

     tiempo (hora + cuenta atrás, o el anillo del minuto) · equipos (escudo,
     nombre y marcador) · señal (medidor + palabra)
     debajo: «Tu equipo» y los canales (continuo si está en tu biblioteca,
     discontinuo si se buscará, injerto B3) y «Ver canal» / «Buscar canal».

   Toda la franja es UN botón (una capa por encima que ocupa la franja): así
   el objetivo táctil es la franja entera. El único control dentro es
   «Ver marcador» (el marcador tapado del partido que ves), que queda por
   encima de esa capa.

   MatchRowView es de presentación (se prueba sola); MatchRow la conecta con
   la señal del partido y con el tapado. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import {
  useEffect,
  useRef,
  useState,
  ViewTransition,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cx } from '../../lib/cx.ts';
import { hueFromName, oklchCss } from '../../lib/color.ts';
import {
  Chip,
  Icon,
  LiveDot,
  LiveRing,
  Menu,
  Num,
  ProgressBar,
  SignalBadge,
  TeamMark,
  useContextMenu,
} from '../../ui/index.ts';
import type { MenuItem } from '../../ui/index.ts';
import { useMatchSignal } from './data.ts';
import {
  keepUnitsTogether,
  liveMinute,
  matchProgressAt,
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
  type MatchSignal,
  type MatchStatus,
} from './domain.ts';
import { revealScore, useScoreHidden } from './score-reveal.ts';

export type RowPosition = 'first' | 'middle' | 'last' | 'only';

/** Luz del equipo para el velo de la franja en directo (el mismo tono que su escudo). */
export function teamGlow(name: string): string {
  return oklchCss({ l: 0.66, c: 0.13, h: hueFromName(name || '?') });
}

/**
 * Cifra que gira como una paleta cuando CAMBIA (un gol) o cuando se destapa
 * (injerto B5). La primera vez que se pinta no se mueve: una fila que entra
 * al hacer scroll no tiene que «celebrar» nada.
 */
export function FlipNum({
  value,
  animateOnMount = false,
  className,
  label,
}: {
  value: number | string;
  animateOnMount?: boolean;
  className?: string;
  label?: string;
}) {
  const previous = useRef(value);
  const [turn, setTurn] = useState(animateOnMount ? 1 : 0);
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
      className={cx(className, turn > 0 && 'agenda-flip')}
    />
  );
}

/** Barras de censura del marcador tapado (B5). Decorativas. */
export function CensorBars({ className }: { className?: string }) {
  return (
    <span className={cx('agenda-censor', className)} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function TimeCell({
  match,
  status,
  score,
  compact,
}: {
  match: FootballMatch;
  status: MatchStatus | null;
  score: LiveScore | null;
  compact: boolean;
}) {
  const minute = status?.phase === 'live' ? liveMinute(score) : null;
  if (minute) {
    return (
      <div className="agenda-row__time agenda-row__time--ring">
        <LiveRing
          minute={minute.minute}
          halftime={minute.halftime}
          size={compact ? 'compact' : 'row'}
        />
        {compact ? null : <span className="agenda-row__note">En directo</span>}
      </div>
    );
  }
  const tbc = !/^\d{2}:\d{2}$/.test(match.time);
  return (
    <div className="agenda-row__time">
      {tbc ? (
        <span className="agenda-row__tbc">Por confirmar</span>
      ) : (
        <span className="agenda-row__clock">
          <Num value={match.time} label={`A las ${match.time}`} />
        </span>
      )}
      {/* En la franja compacta, «En 2 h 26 min» no cabe y la hora ya lo dice. */}
      {status && !(compact && status.phase === 'next') ? (
        <span className="agenda-row__note">
          {status.phase === 'live' ? <LiveDot /> : null}
          {/* «Terminado» no cabe en los 50 px de la franja compacta. */}
          {compact && status.phase === 'done' ? 'Final' : keepUnitsTogether(status.text)}
        </span>
      ) : null}
    </div>
  );
}

function TeamLine({
  name,
  goals,
  lead,
  trail,
  lit,
  compact,
  reveal,
}: {
  name: string;
  goals: number | null;
  lead: boolean;
  trail: boolean;
  lit: boolean;
  compact: boolean;
  reveal: boolean;
}) {
  return (
    <div className={cx('agenda-team', lead && 'is-lead', trail && 'is-trail')}>
      <TeamMark name={name} size={compact ? 18 : 24} lit={lit} />
      <span className="agenda-team__name">{name}</span>
      <span className="agenda-team__score">
        {goals === null ? null : <FlipNum value={goals} animateOnMount={reveal} />}
      </span>
    </div>
  );
}

export interface MatchRowViewProps {
  match: FootballMatch;
  now: number;
  score: LiveScore | null;
  signal: MatchSignal | null;
  channels: readonly ChannelInfo[];
  mine: boolean;
  /** El marcador existe pero es el partido que ves: sale tapado. */
  scoreHidden: boolean;
  onReveal(): void;
  selected?: boolean;
  compact?: boolean;
  position?: RowPosition;
  /** Solo la franja que viaja al centro de partido lleva nombre (único en la página). */
  transitionName?: string | null;
  /** `open`: el toque abre el partido; `select`: lo lleva al escenario (escritorio). */
  interaction?: 'open' | 'select';
  onOpen(match: FootballMatch): void;
  onSelect?(match: FootballMatch): void;
  menuItems?: readonly MenuItem[];
  /** Posición en la aparición escalonada (solo al entrar la lista). */
  staggerIndex?: number | null;
}

export function MatchRowView({
  match,
  now,
  score: rawScore,
  signal,
  channels,
  mine,
  scoreHidden,
  onReveal,
  selected = false,
  compact = false,
  position = 'only',
  transitionName = null,
  interaction = 'open',
  onOpen,
  onSelect,
  menuItems,
  staggerIndex = null,
}: MatchRowViewProps) {
  const score = paintableScore(rawScore);
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const live = phase === 'live';
  const hidden = scoreHidden && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
  const context = useContextMenu();
  const title = matchTitle(match);
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';

  const shown = score !== null && !hidden ? score : null;
  const homeGoals = shown ? shown.home : null;
  const awayGoals = shown ? shown.away : null;
  const homeLead = shown !== null && shown.home > shown.away;
  const awayLead = shown !== null && shown.away > shown.home;
  // Sin señal ni marcador (partidos de otro día, terminados sin datos) los
  // nombres se quedan también el hueco de la señal: «Atlético de Ma…» con 88 px
  // vacíos al lado no tenía sentido. Con marcador no, para que las cifras
  // sigan en la misma vertical en todas las franjas.
  const roomy = signal === null && score === null;

  const label =
    interaction === 'select'
      ? `${title}${status ? `, ${status.text.toLowerCase()}` : ''}`
      : action
        ? `${action} para ${match.title}`
        : `${title}: canal por confirmar`;

  // En escritorio el primer toque (o Intro) elige y el segundo abre: Intro
  // sobre la franja ya elegida abre el partido.
  const activate = () => {
    if (interaction === 'select' && !selected) onSelect?.(match);
    else onOpen(match);
  };

  const style = {
    '--ta': live ? teamGlow(match.home) : 'transparent',
    '--tb': live ? teamGlow(match.away || match.home) : 'transparent',
    ...(staggerIndex !== null ? { '--i': staggerIndex } : null),
  } as CSSProperties;

  const teams: ReactNode = (
    <div className={cx('agenda-row__teams', hidden && 'has-cover')}>
      {match.away ? (
        <>
          <TeamLine
            name={match.home}
            goals={homeGoals}
            lead={homeLead}
            trail={awayLead}
            lit={live}
            compact={compact}
            reveal={justRevealed}
          />
          <TeamLine
            name={match.away}
            goals={awayGoals}
            lead={awayLead}
            trail={homeLead}
            lit={live}
            compact={compact}
            reveal={justRevealed}
          />
        </>
      ) : (
        <TeamLine
          name={match.title}
          goals={null}
          lead={false}
          trail={false}
          lit={live}
          compact={compact}
          reveal={false}
        />
      )}
      {hidden ? (
        <button
          type="button"
          className="agenda-cover press"
          aria-label="Ver marcador"
          title="Tu emisión va por detrás del directo"
          onClick={() => {
            setJustRevealed(true);
            onReveal();
          }}
        >
          <CensorBars />
          {compact ? null : <span className="agenda-cover__text">Ver marcador</span>}
        </button>
      ) : null}
    </div>
  );

  return (
    <article
      className={cx(
        'agenda-row',
        compact && 'agenda-row--compact',
        `agenda-row--${position}`,
        phase && `is-${phase}`,
        mine && 'is-mine',
        selected && 'is-selected',
        staggerIndex !== null && 'agenda-row--enter',
        roomy && 'agenda-row--roomy',
      )}
      style={style}
      data-match={match.id}
      onContextMenu={menuItems?.length ? context.bind.onContextMenu : undefined}
      onPointerDown={menuItems?.length ? context.bind.onPointerDown : undefined}
      onPointerMove={menuItems?.length ? context.bind.onPointerMove : undefined}
      onPointerUp={menuItems?.length ? context.bind.onPointerUp : undefined}
      onPointerCancel={menuItems?.length ? context.bind.onPointerCancel : undefined}
    >
      <button
        type="button"
        className="agenda-row__hit"
        aria-label={label}
        aria-current={selected ? 'true' : undefined}
        title={interaction === 'select' ? 'Doble clic o Intro para abrir el partido' : undefined}
        onClick={activate}
        onDoubleClick={interaction === 'select' ? () => onOpen(match) : undefined}
      />
      <TimeCell match={match} status={status} score={rawScore} compact={compact} />
      {live && !compact ? (
        <ProgressBar
          className="agenda-row__progress"
          value={matchProgressAt(match, now, rawScore)}
          label="Progreso del partido"
          tone="live"
          size="thin"
          marks={[0.5]}
        />
      ) : null}
      {transitionName ? <ViewTransition name={transitionName}>{teams}</ViewTransition> : teams}
      {signal ? (
        <div className="agenda-row__sig">
          <SignalBadge
            state={signal.state}
            label={compact ? undefined : signal.label}
            layout="stacked"
            size={compact ? 'sm' : 'md'}
          />
        </div>
      ) : null}
      {compact ? null : (
        <div className="agenda-row__meta">
          {mine ? (
            <Chip tone="mine" className="agenda-row__mine">
              Tu equipo
            </Chip>
          ) : null}
          {channels.length === 0 ? (
            <span className="agenda-row__none">Canal por confirmar</span>
          ) : (
            <span className="agenda-row__channels">
              {channels.slice(0, 2).map((channel) => (
                <span
                  key={channel.name}
                  className={cx('agenda-ch', channel.inLibrary ? 'is-lib' : 'is-search')}
                  title={
                    channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                  }
                >
                  <Icon name="tv" size={16} />
                  <span className="agenda-ch__name">{channel.name}</span>
                </span>
              ))}
              {channels.length > 2 ? (
                <span className="agenda-ch agenda-ch--more">+{channels.length - 2}</span>
              ) : null}
            </span>
          )}
          {action ? (
            <span className="agenda-row__cta" aria-hidden="true">
              <Icon name={available ? 'play' : 'buscar'} size={16} />
              <span className="agenda-row__cta-text">{action}</span>
            </span>
          ) : null}
        </div>
      )}
      {menuItems?.length ? (
        <Menu
          open={context.menu.open}
          anchor={context.menu.anchor}
          onClose={context.menu.onClose}
          label={`Opciones de ${title}`}
          items={menuItems}
        />
      ) : null}
    </article>
  );
}

export interface MatchRowProps extends Omit<
  MatchRowViewProps,
  'signal' | 'scoreHidden' | 'onReveal'
> {
  /** Cuenta como el partido que ves aunque el reproductor no haya arrancado (columna del partido). */
  alsoWatched?: boolean;
  /** false: no pide la señal (filas que no se ven). */
  signalEnabled?: boolean;
}

/** La franja conectada: pide su señal y sabe si su marcador va tapado. */
export function MatchRow({ alsoWatched = false, signalEnabled = true, ...props }: MatchRowProps) {
  const status = matchStatus(props.match, props.now, props.score);
  const signal = useMatchSignal(props.match, props.now, {
    enabled: signalEnabled,
    finished: status?.phase === 'done',
  });
  const scoreHidden = useScoreHidden(props.match.id, alsoWatched);
  return (
    <MatchRowView
      {...props}
      signal={signal}
      scoreHidden={scoreHidden}
      onReveal={() => revealScore(props.match.id)}
    />
  );
}
