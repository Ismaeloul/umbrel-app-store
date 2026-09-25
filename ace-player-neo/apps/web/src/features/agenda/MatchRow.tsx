/* Tarjeta de partido de la agenda (plan Palco fase 2, decisiones D4 y W4;
   antes, la franja de tres columnas de la opción A). Una tarjeta versus 16:10
   con las dos mitades en los colores de club, los escudos, el logo de la
   competición, el chip «HOY 21:00» / «EN DIRECTO · 13'» / «Final» y los
   nombres; arriba a la derecha, la cápsula de señal (dentro de la fila de
   arriba de la tarjeta, que reparte el sitio con el chip); abajo a la
   derecha, si el partido tiene marcador, la cápsula «Marcador»: en la agenda
   el marcador va SIEMPRE tapado (corrección 1; DESIGN.md: «oculto tras un
   toque en la cápsula "Marcador"») y un toque lo destapa EN esa cápsula; otro
   toque lo vuelve a tapar. Nunca en las mitades. Debajo, en la tarjeta
   normal: la línea fina de progreso en directo y una línea pequeña con el
   estado («En 48 min», «Terminado»), los canales (continuo si está en tu
   biblioteca, discontinuo si se buscará: injerto B3) y la acción.

   Toda la tarjeta es UN botón (una capa por encima que ocupa el artículo):
   así el objetivo táctil es la tarjeta entera y el nombre accesible sigue
   siendo «Ver canal para {title}» / «Buscar canal para {title}» /
   «{title}: canal por confirmar» / «{title}, en directo» (en escritorio, el
   primer toque elige y el segundo, o Intro, abre). El único control dentro es
   la cápsula del marcador («Ver marcador de {Local} vs {Visitante}» /
   «Tapar el marcador de …»), por encima de esa capa.

   MatchRowView es de presentación (se prueba sola); MatchRow la conecta con
   la señal del partido y con el destapado. ScoreToggle, FlipNum y teamGlow
   los usan también el héroe, el panel y el centro de partido. */

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
import { hideScore, revealScore, useScoreRevealed } from './score-reveal.ts';

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

/**
 * Cápsula «Marcador» de la agenda: tapada enseña el ojo y la palabra
 * («Ver marcador de {Local} vs {Visitante}»); un toque destapa ESE partido y
 * las cifras salen en la misma cápsula, girando como una paleta (B5); otro
 * toque («Tapar el marcador de …») la vuelve a tapar. Nunca en las mitades
 * de la tarjeta. Sin marcador (partido por jugar) no se pinta.
 */
export function ScoreToggle({
  match,
  score,
  revealed,
  onReveal,
  onHide,
  size = 'sm',
  glass = true,
  iconOnly = false,
  className,
}: {
  match: Pick<FootballMatch, 'home' | 'away' | 'title'>;
  score: Pick<LiveScore, 'home' | 'away'>;
  revealed: boolean;
  onReveal(): void;
  onHide?(): void;
  size?: 'sm' | 'md';
  glass?: boolean;
  /** Tapada, solo el ojo (tarjetas pequeñas): la palabra queda para el lector. */
  iconOnly?: boolean;
  className?: string;
}) {
  const title = matchTitle(match);
  // Solo giran las cifras que se destapan con este toque, no las que ya se veían.
  const [flip, setFlip] = useState(false);
  if (!revealed)
    return (
      <Capsule
        as="button"
        tone="neutral"
        size={size}
        glass={glass}
        icon="eye"
        className={cx('agenda-score', 'is-hidden', iconOnly && 'agenda-score--icon', className)}
        aria-label={`Ver marcador de ${title}`}
        title="Ver el marcador (tu emisión puede ir por detrás del directo)"
        onClick={() => {
          setFlip(true);
          haptic('light');
          onReveal();
        }}
      >
        <span className="agenda-score__word">Marcador</span>
      </Capsule>
    );
  return (
    <Capsule
      as="button"
      tone="neutral"
      size={size}
      glass={glass}
      className={cx('agenda-score', 'is-shown', className)}
      aria-label={`Tapar el marcador de ${title}: ${score.home} a ${score.away}`}
      title="Tapar el marcador"
      onClick={() => {
        setFlip(false);
        haptic('light');
        onHide?.();
      }}
    >
      <FlipNum value={score.home} animateOnMount={flip} />
      <span className="agenda-score__sep" aria-hidden="true">
        –
      </span>
      <FlipNum value={score.away} animateOnMount={flip} />
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
  /** Marcador tapado (en la agenda, siempre hasta que se pide). */
  scoreHidden: boolean;
  onReveal(): void;
  /** Segundo toque en la cápsula: vuelve a tapar. */
  onHide?(): void;
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
  onHide,
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
  const corner = score !== null;

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
        {/* Abajo a la derecha: la cápsula «Marcador» (tapada por defecto). */}
        {score ? (
          <div className="agenda-row__corner">
            <ScoreToggle
              match={match}
              score={score}
              revealed={!scoreHidden}
              onReveal={onReveal}
              onHide={onHide}
              iconOnly={compact}
            />
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
  'signal' | 'scoreHidden' | 'onReveal' | 'onHide'
> {
  /** false: no pide la señal (tarjetas que no se ven). */
  signalEnabled?: boolean;
}

/** La tarjeta conectada: pide su señal y sabe si su marcador está destapado. */
export function MatchRow({ signalEnabled = true, ...props }: MatchRowProps) {
  const status = matchStatus(props.match, props.now, props.score);
  const signal = useMatchSignal(props.match, props.now, {
    enabled: signalEnabled,
    finished: status?.phase === 'done',
  });
  const revealed = useScoreRevealed(props.match.id);
  return (
    <MatchRowView
      {...props}
      signal={signal}
      scoreHidden={!revealed}
      onReveal={() => revealScore(props.match.id)}
      onHide={() => hideScore(props.match.id)}
    />
  );
}
