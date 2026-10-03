/* Héroe de la portada (plan Palco fase 2, decisiones D3 y W4; corrección 1 del
   encargo): el partido destacado del día (`featuredMatch`: tu equipo en
   directo → cualquiera en directo → el próximo → el primero) como tarjeta
   versus XL a todo el ancho, con los colores de club, los escudos grandes, el
   logo de la competición, el chip «HOY 21:00» / «EN DIRECTO · 13'» / «Final»
   y la cápsula de señal. SIN marcador en la tarjeta.

   Debajo: el botón primario oro («Ver ahora» en directo, «Ver el partido»,
   «Buscar canal» si el canal no está en tu biblioteca, o «Canal por
   confirmar» deshabilitado), la cápsula «Marcador» (el marcador va SIEMPRE
   tapado en la agenda; al destapar, las cifras salen EN la cápsula y otro
   toque lo vuelve a tapar) y dónde se emite.

   La portada NUNCA arranca la reproducción ni enseña vídeo (regla 6): todo
   navega al centro de partido. Si este dispositivo ya reproduce el partido,
   la tarjeta lleva «En pantalla» y el botón dice «Volver al vídeo».

   Escritorio (≥ 1024 px, `layout="band"`; encargo del 3-10-2026: la valla
   de 550 px empujaba la tira de días y la lista fuera de la pantalla): una
   banda horizontal compacta (~150 px) sobre superficie, sin las dos mitades
   planas. A la izquierda los dos escudos con sus nombres (una fila por
   equipo, cada una con una luz suave de su club y una franja fina partida
   en el borde); en el centro el chip de cuándo, la señal, la competición y
   dónde se emite; a la derecha la acción oro y, debajo, «Marcador». El
   móvil y la tableta siguen con la tarjeta versus XL (`layout="poster"`).

   HeroView es de presentación (se prueba sola); AgendaHero la conecta con la
   señal y el tapado. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useId, ViewTransition, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { competitionLogo } from '../../lib/teams.ts';
import {
  Button,
  Capsule,
  CompetitionBadge,
  Icon,
  TeamMark,
  VersusCard,
  type IconName,
} from '../../ui/index.ts';
import { matchGlow, versusSide, versusWhen } from './cards.ts';
import { useMatchSignal } from './data.ts';
import {
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
  type MatchSignal,
} from './domain.ts';
import { ScoreToggle, SignalCapsule } from './MatchRow.tsx';
import { hideScore, revealScore, useScoreRevealed } from './score-reveal.ts';

export interface HeroViewProps {
  match: FootballMatch;
  now: number;
  today: string;
  score: LiveScore | null;
  signal: MatchSignal | null;
  channels: readonly ChannelInfo[];
  mine: boolean;
  /** Este dispositivo ya reproduce el partido (playerPresence). */
  watching: boolean;
  /** Marcador tapado (en la agenda, siempre hasta que se pide). */
  scoreHidden: boolean;
  onReveal(): void;
  /** Segundo toque en la cápsula: vuelve a tapar. */
  onHide?(): void;
  onOpen(match: FootballMatch): void;
  /** Nombre de la View Transition del bloque de escudos (único en la página). */
  transitionName?: string | null;
  /** «poster»: tarjeta versus XL (móvil y tableta); «band»: banda compacta (escritorio). */
  layout?: 'poster' | 'band';
}

export function HeroView({
  match,
  now,
  today,
  score: rawScore,
  signal,
  channels,
  mine,
  watching,
  scoreHidden,
  onReveal,
  onHide,
  onOpen,
  transitionName = null,
  layout = 'poster',
}: HeroViewProps) {
  const titleId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const live = phase === 'live';
  const score = paintableScore(rawScore);
  const available = channels.some((channel) => channel.inLibrary);
  const action = channels.length === 0 ? null : available ? 'Ver canal' : 'Buscar canal';
  const when = versusWhen(match, now, rawScore, today);
  const glow = matchGlow(match);
  const style = {
    '--ta': phase === 'done' ? 'transparent' : glow.home,
    '--tb': phase === 'done' ? 'transparent' : glow.away,
  } as CSSProperties;

  let cta: { text: string; icon: IconName; disabled: boolean };
  if (watching) cta = { text: 'Volver al vídeo', icon: 'play', disabled: false };
  else if (!action) cta = { text: 'Canal por confirmar', icon: 'tv', disabled: true };
  else if (!available) cta = { text: 'Buscar canal', icon: 'buscar', disabled: false };
  else if (live) cta = { text: 'Ver ahora', icon: 'play', disabled: false };
  else cta = { text: 'Ver el partido', icon: 'play', disabled: false };

  const where = channels.length
    ? channels.map((channel) => channel.name).join(' · ')
    : 'Canal por confirmar';
  const competition = match.competition?.trim() || 'Fútbol';
  const ctaButton = (
    <Button
      variant="primary"
      icon={cta.icon}
      className="agenda-hero__cta"
      disabled={cta.disabled}
      onClick={() => onOpen(match)}
    >
      {cta.text}
    </Button>
  );
  const scoreToggle = score ? (
    <ScoreToggle
      match={match}
      score={score}
      revealed={!scoreHidden}
      onReveal={onReveal}
      onHide={onHide}
      size="md"
      glass={false}
      className="agenda-hero__score"
    />
  ) : null;

  if (layout === 'band') {
    const home = versusSide(match, 'home');
    const away = versusSide(match, 'away');
    // El logo, si lo hay; sin él la pastilla repetiría el nombre de al lado.
    const logo = competitionLogo(match);
    const team = (side: typeof home, key: string): ReactNode => (
      <span className={`agenda-hero__team agenda-hero__team--${key}`}>
        <TeamMark
          name={side.name}
          short={side.short}
          colors={side.colors}
          crest={side.crest}
          size={48}
          lit={live}
          className="agenda-hero__crest"
        />
        <b className="agenda-hero__name">{side.name}</b>
      </span>
    );
    const teams = (
      <div className="agenda-hero__teams">
        {team(home, 'home')}
        {team(away, 'away')}
      </div>
    );
    return (
      <section
        className={cx(
          'agenda-hero',
          'agenda-hero--band',
          phase && `is-${phase}`,
          watching && 'is-watching',
        )}
        aria-labelledby={titleId}
        style={style}
      >
        <h2 id={titleId} className="sr-only">
          {matchTitle(match)}
        </h2>
        <div className="agenda-hero__band">
          {transitionName ? <ViewTransition name={transitionName}>{teams}</ViewTransition> : teams}
          <div className="agenda-hero__meta">
            <div className="agenda-hero__marks">
              <Capsule
                tone={live ? 'live' : 'neutral'}
                size="sm"
                glass={false}
                dot={live}
                className="agenda-hero__when"
              >
                {live && when.minute ? `${when.label} · ${when.minute}'` : when.label}
              </Capsule>
              {mine ? (
                <Capsule tone="gold" size="sm" icon="star-f" className="agenda-hero__mine">
                  Tu equipo
                </Capsule>
              ) : null}
              {watching ? (
                <Capsule tone="gold" size="sm" dot className="agenda-hero__watching">
                  En pantalla
                </Capsule>
              ) : null}
              {signal ? <SignalCapsule signal={signal} size="sm" glass={false} /> : null}
            </div>
            <p className="agenda-hero__comp">
              {logo ? (
                <CompetitionBadge
                  name={competition}
                  logo={logo}
                  size="sm"
                  className="agenda-hero__comp-badge"
                />
              ) : null}
              <span className="agenda-hero__comp-name">{competition}</span>
            </p>
            <p className="agenda-hero__where" title={where}>
              <Icon name="tv" size={16} />
              <span className="agenda-hero__where-text">{where}</span>
            </p>
          </div>
          <div className="agenda-hero__actions">
            {ctaButton}
            {scoreToggle}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cx('agenda-hero', phase && `is-${phase}`, watching && 'is-watching')}
      aria-labelledby={titleId}
      style={style}
    >
      <h2 id={titleId} className="sr-only">
        {matchTitle(match)}
      </h2>
      <div className="agenda-hero__light" aria-hidden="true" />
      <div className="agenda-hero__card">
        <VersusCard
          size="xl"
          home={versusSide(match, 'home')}
          away={versusSide(match, 'away')}
          competition={competition}
          competitionLogo={competitionLogo(match)}
          when={when}
          mine={mine}
          watching={watching}
          transitionName={transitionName ?? undefined}
          className="agenda-hero__versus"
        >
          {signal ? <SignalCapsule signal={signal} size="md" /> : null}
        </VersusCard>
      </div>
      <div className="agenda-hero__bar">
        {ctaButton}
        {scoreToggle}
        <span className="agenda-hero__where">
          <Icon name="tv" size={16} />
          {where}
        </span>
      </div>
    </section>
  );
}

export type AgendaHeroProps = Omit<HeroViewProps, 'signal' | 'scoreHidden' | 'onReveal' | 'onHide'>;

/** El héroe conectado: pide la señal del partido y sabe si su marcador está destapado. */
export function AgendaHero(props: AgendaHeroProps) {
  const status = matchStatus(props.match, props.now, props.score);
  const signal = useMatchSignal(props.match, props.now, { finished: status?.phase === 'done' });
  const revealed = useScoreRevealed(props.match.id);
  return (
    <HeroView
      {...props}
      signal={signal}
      scoreHidden={!revealed}
      onReveal={() => revealScore(props.match.id)}
      onHide={() => hideScore(props.match.id)}
    />
  );
}
