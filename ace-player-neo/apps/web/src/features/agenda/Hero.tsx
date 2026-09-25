/* Héroe de la portada (plan Palco fase 2, decisiones D3 y W4; corrección 1 del
   encargo): el partido destacado del día (`featuredMatch`: tu equipo en
   directo → cualquiera en directo → el próximo → el primero) como tarjeta
   versus XL a todo el ancho, con los colores de club, los escudos grandes, el
   logo de la competición, el chip «HOY 21:00» / «EN DIRECTO · 13'» / «Final»
   y la cápsula de señal. SIN marcador en la tarjeta.

   Debajo: el botón primario oro («Ver ahora» en directo, «Ver el partido»,
   «Buscar canal» si el canal no está en tu biblioteca, o «Canal por
   confirmar» deshabilitado), la cápsula «Marcador» que destapa el marcador
   del partido que ves (regla 29; al destapar, las cifras salen EN la cápsula)
   y dónde se emite.

   La portada NUNCA arranca la reproducción ni enseña vídeo (regla 6): todo
   navega al centro de partido. Si este dispositivo ya reproduce el partido,
   la tarjeta lleva «En pantalla» y el botón dice «Volver al vídeo».

   HeroView es de presentación (se prueba sola); AgendaHero la conecta con la
   señal y el tapado. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useId, useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { competitionLogo } from '../../lib/teams.ts';
import { Button, Capsule, Icon, VersusCard, type IconName } from '../../ui/index.ts';
import { matchGlow, versusSide, versusWhen } from './cards.ts';
import { useMatchSignal } from './data.ts';
import {
  matchStatus,
  matchTitle,
  paintableScore,
  type ChannelInfo,
  type MatchSignal,
} from './domain.ts';
import { ScoreCapsule, SignalCapsule } from './MatchRow.tsx';
import { revealScore, useScoreHidden } from './score-reveal.ts';

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
  /** El marcador existe pero es el partido que ves: sale tapado. */
  scoreHidden: boolean;
  onReveal(): void;
  onOpen(match: FootballMatch): void;
  /** Nombre de la View Transition del bloque de escudos (único en la página). */
  transitionName?: string | null;
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
  onOpen,
  transitionName = null,
}: HeroViewProps) {
  const titleId = useId();
  const status = matchStatus(match, now, rawScore);
  const phase = status?.phase ?? null;
  const live = phase === 'live';
  const score = paintableScore(rawScore);
  const hidden = scoreHidden && score !== null;
  const [justRevealed, setJustRevealed] = useState(false);
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
          competition={match.competition?.trim() || 'Fútbol'}
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
        <Button
          variant="primary"
          icon={cta.icon}
          className="agenda-hero__cta"
          disabled={cta.disabled}
          onClick={() => onOpen(match)}
        >
          {cta.text}
        </Button>
        {hidden ? (
          <Capsule
            as="button"
            tone="neutral"
            icon="eye"
            className="agenda-hero__reveal"
            title="Tu emisión va por detrás del directo"
            onClick={() => {
              setJustRevealed(true);
              haptic('light');
              onReveal();
            }}
          >
            Marcador
          </Capsule>
        ) : score ? (
          <ScoreCapsule
            score={score}
            reveal={justRevealed}
            size="md"
            glass={false}
            className="agenda-hero__score"
          />
        ) : null}
        <span className="agenda-hero__where">
          <Icon name="tv" size={16} />
          {channels.length
            ? channels.map((channel) => channel.name).join(' · ')
            : 'Canal por confirmar'}
        </span>
      </div>
    </section>
  );
}

export type AgendaHeroProps = Omit<HeroViewProps, 'signal' | 'scoreHidden' | 'onReveal'>;

/** El héroe conectado: pide la señal del partido y sabe si su marcador va tapado. */
export function AgendaHero(props: AgendaHeroProps) {
  const status = matchStatus(props.match, props.now, props.score);
  const signal = useMatchSignal(props.match, props.now, { finished: status?.phase === 'done' });
  const scoreHidden = useScoreHidden(props.match.id);
  return (
    <HeroView
      {...props}
      signal={signal}
      scoreHidden={scoreHidden}
      onReveal={() => revealScore(props.match.id)}
    />
  );
}
