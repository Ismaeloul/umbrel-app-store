/* Tarjeta de partido de la agenda (plan Palco fase 2, decisiones D4 y W4;
   antes, la franja de tres columnas de la opción A). Una tarjeta versus 16:10
   con las dos mitades en los colores de club, los escudos, el logo de la
   competición, el chip «HOY 21:00» / «EN DIRECTO · 13'» / «Final» y los
   nombres; arriba a la derecha, la cápsula de señal (dentro de la fila de
   arriba de la tarjeta, que reparte el sitio con el chip); abajo a la
   derecha, el marcador en una cápsula o, si el partido es el que ves, TAPADO
   («Ver marcador», regla 29): nunca en las mitades. Debajo, en la tarjeta
   normal: la línea fina de progreso en directo y una línea pequeña con el
   estado («En 48 min», «Terminado»), los canales (continuo si está en tu
   biblioteca, discontinuo si se buscará: injerto B3) y la acción.

   Toda la tarjeta es UN botón (una capa por encima que ocupa el artículo):
   así el objetivo táctil es la tarjeta entera y el nombre accesible sigue
   siendo «Ver canal para {title}» / «Buscar canal para {title}» /
   «{title}: canal por confirmar» / «{title}, en directo» (en escritorio, el
   primer toque elige y el segundo, o Intro, abre). El único control dentro es
   «Ver marcador», por encima de esa capa.

   MatchRowView es de presentación (se prueba sola); MatchRow la conecta con
   la señal del partido y con el tapado. FlipNum, CensorBars y teamGlow los
   usan también el escenario y el centro de partido. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { hueFromName, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { competitionLogo } from '../../lib/teams.ts';
import {
  Capsule,
  Icon,
  LiveDot,
  Menu,
  Num,
  ProgressBar,
  SignalBadge,
  useContextMenu,
  VersusCard,
} from '../../ui/index.ts';
import type { MenuItem } from '../../ui/index.ts';
import { matchGlow, signalTone, signalWord, versusSide, versusWhen } from './cards.ts';
import { useMatchSignal } from './data.ts';
import {
  keepUnitsTogether,
  madridClock,
  matchProgressAt,
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
  type MatchSignal,
} from './domain.ts';
import { revealScore, useScoreHidden } from './score-reveal.ts';

export type RowPosition = 'first' | 'middle' | 'last' | 'only';

/**
 * Luz de un equipo a partir solo de su nombre (el mismo tono que su monograma
 * cuando el backend no da colores). Lo usa el centro de partido; la agenda
 * usa `matchGlow(match)` (cards.ts), que prefiere la paleta de la API.
 */
export function teamGlow(name: string): string {
  return oklchCss({ l: 0.66, c: 0.13, h: hueFromName(name || '?') });
}

/**
 * Cifra que gira como una paleta cuando CAMBIA (un gol) o cuando se destapa
 * (injerto B5). La primera vez que se pinta no se mueve: una tarjeta que entra
 * al cambiar de día no tiene que «celebrar» nada.
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

/** Cápsula de señal de un partido: forma (glifo del medidor) + palabra + color. */
export function SignalCapsule({
  signal,
  size = 'sm',
  glass = true,
  className,
}: {
  signal: MatchSignal;
  size?: 'sm' | 'md';
  glass?: boolean;
  className?: string;
}) {
  return (
    <Capsule
      tone={signalTone(signal.state)}
      size={size}
      glass={glass}
      className={cx('agenda-sig', className)}
      title={signal.summary}
    >
      <SignalBadge state={signal.state} compact size="sm" label={signalWord(signal)} />
    </Capsule>
  );
}

/** Marcador destapado en una cápsula (nunca en las mitades de la tarjeta). */
export function ScoreCapsule({
  score,
  reveal = false,
  size = 'sm',
  glass = true,
  className,
}: {
  score: Pick<LiveScore, 'home' | 'away'>;
  /** Acaba de destaparse: las cifras giran (B5). */
  reveal?: boolean;
  size?: 'sm' | 'md';
  glass?: boolean;
  className?: string;
}) {
  return (
    <Capsule
      tone="neutral"
      size={size}
      glass={glass}
      className={cx('agenda-score', className)}
      title="Marcador"
    >
      <FlipNum value={score.home} animateOnMount={reveal} />
      <span className="agenda-score__sep" aria-hidden="true">
        –
      </span>
      <FlipNum value={score.away} animateOnMount={reveal} />
    </Capsule>
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
  /** Tarjeta pequeña con siglas (columna del partido y «Luego»). */
  compact?: boolean;
  position?: RowPosition;
  /** Solo la tarjeta que viaja al centro de partido lleva nombre (único en la página). */
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
  const menuOpen = context.menu.open;
  // Pulsación larga (o clic derecho) que abre el menú: háptica media (HAPTIC_MAP).
  useEffect(() => {
    if (menuOpen) haptic('medium');
  }, [menuOpen]);
  const title = matchTitle(match);
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  const today = madridClock(now).date;
  const when = versusWhen(match, now, rawScore, today);
  const shown = score !== null && !hidden ? score : null;

  const label =
    interaction === 'select'
      ? `${title}${status ? `, ${status.text.toLowerCase()}` : ''}`
      : action
        ? `${action} para ${match.title}`
        : `${title}: canal por confirmar`;

  // En escritorio el primer toque (o Intro) elige y el segundo abre: Intro
  // sobre la tarjeta ya elegida abre el partido.
  const activate = () => {
    if (interaction === 'select' && !selected) onSelect?.(match);
    else onOpen(match);
  };

  const glow = matchGlow(match);
  const style = {
    '--ta': live ? glow.home : 'transparent',
    '--tb': live ? glow.away : 'transparent',
    ...(staggerIndex !== null ? { '--i': staggerIndex } : null),
  } as CSSProperties;
  const corner = hidden || shown !== null;

  return (
    <article
      className={cx(
        'agenda-row',
        compact && 'agenda-row--compact',
        `agenda-row--${position}`,
        phase && `is-${phase}`,
        mine && 'is-mine',
        selected && 'is-selected',
        corner && 'has-corner',
        staggerIndex !== null && 'agenda-row--enter',
      )}
      style={style}
      data-match={match.id}
      onDoubleClick={interaction === 'select' ? () => onOpen(match) : undefined}
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
      />
      <div className="agenda-row__card">
        <VersusCard
          size={compact ? 'sm' : 'md'}
          home={versusSide(match, 'home', { short: compact })}
          away={versusSide(match, 'away', { short: compact })}
          competition={match.competition?.trim() || 'Fútbol'}
          competitionLogo={competitionLogo(match)}
          when={when}
          mine={mine}
          selected={selected}
          transitionName={transitionName ?? undefined}
          className="agenda-row__versus"
        >
          {signal ? <SignalCapsule signal={signal} /> : null}
        </VersusCard>
        {/* Abajo a la derecha: el marcador en su cápsula o tapado. */}
        {corner ? (
          <div className="agenda-row__corner">
            {hidden ? (
              <button
                type="button"
                className="agenda-cover press"
                aria-label="Ver marcador"
                title="Tu emisión va por detrás del directo"
                onClick={() => {
                  setJustRevealed(true);
                  haptic('light');
                  onReveal();
                }}
              >
                <CensorBars />
                {compact ? null : <span className="agenda-cover__text">Ver marcador</span>}
              </button>
            ) : shown ? (
              <ScoreCapsule score={shown} reveal={justRevealed} />
            ) : null}
          </div>
        ) : null}
      </div>
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
      {compact ? null : (
        <div className="agenda-row__meta">
          {status ? (
            <span className={cx('agenda-row__note', `is-${status.phase}`)}>
              {live ? <LiveDot /> : null}
              {keepUnitsTogether(status.text)}
            </span>
          ) : null}
          {channels.length === 0 ? (
            <span className="agenda-row__none">Canal por confirmar</span>
          ) : (
            <span className="agenda-row__channels">
              <Icon name="tv" size={16} className="agenda-row__tv" />
              {channels.slice(0, 2).map((channel) => (
                <span
                  key={channel.name}
                  className={cx('agenda-ch', channel.inLibrary ? 'is-lib' : 'is-search')}
                  title={
                    channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                  }
                >
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
  /** false: no pide la señal (tarjetas que no se ven). */
  signalEnabled?: boolean;
}

/** La tarjeta conectada: pide su señal y sabe si su marcador va tapado. */
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
