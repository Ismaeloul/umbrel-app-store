/* Carteles 16:9 de Palco: partido (agenda y filas), canal (biblioteca) y
   fuente (con miniatura viva y anillo de calidad). */

import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { Item, LiveScore, Match, Source } from '../../../core/types';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { ChannelMark, hueFromName } from '../../../core/ui/ChannelMark';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { hhmm } from '../../../core/format';
import type { SourceSession } from '../../../core/store';
import { Capsule, LiveDot } from './primitives';
import { Icon } from './icons';
import { compShort, scoreText, sessionSummary, sourceDetail, sourceTone, sourceWord, whenText, type Tone } from './text';
import { CoverVideo, QualityRing } from './video';
import { useLongPress } from './hooks';
import { haptic } from './haptics';

export type PosterSize = 'sm' | 'md' | 'lg' | 'xl';

const CREST: Record<PosterSize, number> = { sm: 40, md: 56, lg: 64, xl: 84 };

/** Cápsula de estado de la esquina: «● Señal», «Floja», «Sin señal», «Comprobando», o la hora.
    «Comprobando» solo con una sesión que de verdad está probando fuentes; sin sesión:
    en directo o a menos de 45 min → «Señal lista»; a menos de 6 h → «Se comprueba 45 min antes». */
export function SignalCapsule({ match, score, session, nowMs, size = 'md', glass = true }: { match: Match; score: LiveScore; session?: SourceSession; nowMs: number; size?: 'sm' | 'md'; glass?: boolean }) {
  if (score.state === 'post') {
    return (
      <Capsule tone="neutral" size={size} glass={glass}>
        Final
      </Capsule>
    );
  }
  const s = sessionSummary(session);
  if (s.tone === 'neutral') {
    const until = score.untilKickoffMs;
    if (score.state === 'in' || until < 45 * 60_000) {
      return (
        <Capsule tone="ok" size={size} glass={glass} dot>
          Señal lista
        </Capsule>
      );
    }
    if (until < 6 * 3600_000) {
      return (
        <Capsule tone="neutral" size={size} glass={glass} icon="clock" title="Las fuentes se comprueban 45 minutos antes del partido">
          {size === 'sm' ? '45 min antes' : 'Se comprueba 45 min antes'}
        </Capsule>
      );
    }
    return (
      <Capsule tone="neutral" size={size} glass={glass} icon="clock">
        {whenText(match, score, nowMs)}
      </Capsule>
    );
  }
  return (
    <Capsule tone={s.tone} size={size} glass={glass} dot={s.tone === 'ok'} icon={s.tone === 'fail' ? 'warning' : undefined} title={s.detail}>
      {s.label}
    </Capsule>
  );
}

export interface MatchPosterProps {
  match: Match;
  score: LiveScore;
  nowMs: number;
  session?: SourceSession;
  size?: PosterSize;
  /** Marcador tapado (lo estás viendo). */
  covered?: boolean;
  onReveal?: () => void;
  /** Tu equipo. */
  mine?: boolean;
  /** En pantalla ahora. */
  watching?: boolean;
  /** Es el partido de la portada. */
  featured?: boolean;
  /** Imagen viva de fondo (solo para la destacada). */
  live?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
  layoutId?: string;
  fixedWidth?: number;
  children?: ReactNode;
}

export const MatchPoster = memo(function MatchPoster({ match, score, nowMs, session, size = 'md', covered, onReveal, mine, watching, featured, live, onClick, onContextMenu, className, style, layoutId, fixedWidth, children }: MatchPosterProps) {
  const home = team(match.home);
  const away = team(match.away);
  const isLive = score.state === 'in';
  const showScore = isLive || score.state === 'post';
  const vars = { ['--h' as string]: home.primary, ['--a' as string]: away.primary, ...(fixedWidth ? { width: fixedWidth } : {}), ...style } as CSSProperties;
  const Tag = onClick ? motion.button : motion.div;
  const press = onClick
    ? () => {
        haptic('light');
        onClick();
      }
    : undefined;
  return (
    <Tag type={onClick ? 'button' : undefined} layoutId={layoutId} className={`pl-mp pl-mp--${size}${watching ? ' is-watching' : ''}${mine ? ' is-mine' : ''} ${className ?? ''}`} style={vars} onClick={press} onContextMenu={onContextMenu} whileTap={onClick ? { scale: 0.975 } : undefined} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
      <span className="pl-mp__bg" aria-hidden="true" />
      {live && (
        <span className="pl-mp__video" aria-hidden="true">
          <CoverVideo playing home={home.primary} away={away.primary} kind={isLive ? 'broadcast' : 'studio'} zoom={1.15} />
        </span>
      )}
      <span className="pl-mp__veil" aria-hidden="true" />
      <span className="pl-mp__top">
        <span className="pl-mp__comp">
          {compShort(match.competition)}
          {match.round && size !== 'sm' && <span className="pl-mp__round"> · {match.round}</span>}
        </span>
        <span className="pl-mp__state">
          {mine && (
            <span className="pl-mp__mine" title="Tu equipo">
              <Icon name="starFill" size={12} />
            </span>
          )}
          {featured && (
            <Capsule tone="neutral" size="sm" glass icon="tv" title="Es el partido de la portada">
              En portada
            </Capsule>
          )}
          <SignalCapsule match={match} score={score} session={session} nowMs={nowMs} size="sm" />
        </span>
      </span>
      <span className="pl-mp__crests" aria-hidden="true">
        <Crest team={home} size={CREST[size]} />
        <Crest team={away} size={CREST[size]} />
      </span>
      <span className="pl-mp__bottom">
        <span className="pl-mp__names">
          <span className="pl-mp__name">{home.name}</span>
          <span className="pl-mp__name">{away.name}</span>
        </span>
        <span className="pl-mp__when">
          {showScore ? (
            covered ? (
              <span
                role="button"
                tabIndex={0}
                className="pl-mp__reveal"
                onClick={(e) => {
                  e.stopPropagation();
                  onReveal?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onReveal?.();
                  }
                }}
              >
                <Icon name="eye" size={14} /> Ver marcador
              </span>
            ) : (
              <span className="pl-mp__score">{scoreText(score)}</span>
            )
          ) : (
            <span className="pl-mp__hour">{hhmm(match.start)}</span>
          )}
          <span className={`pl-mp__clock${isLive ? ' is-live' : ''}`}>
            {isLive && <LiveDot size={6} />}
            {whenText(match, score, nowMs)}
          </span>
        </span>
      </span>
      {watching && (
        <span className="pl-mp__watching">
          <Icon name="wave" size={12} /> En pantalla
        </span>
      )}
      {children}
    </Tag>
  );
});

/** Cartel de canal: dorsal grande sobre un tono derivado del nombre + «ahora». */
export const ChannelPoster = memo(function ChannelPoster({ item, now, size = 'md', onClick, onMore, favorite, watching, className, fixedWidth }: { item: Item; now?: { title: string; clock: string; live: boolean } | null; size?: PosterSize; onClick?: () => void; onMore?: (e: MouseEvent) => void; favorite?: boolean; watching?: boolean; className?: string; fixedWidth?: number }) {
  const hue = hueFromName(item.title);
  const long = useLongPress(
    onMore
      ? () => {
          haptic('medium');
          onMore({} as MouseEvent);
        }
      : undefined,
  );
  return (
    <motion.div className={`pl-cp pl-cp--${size}${watching ? ' is-watching' : ''} ${className ?? ''}`} style={{ ['--hue' as string]: hue, width: fixedWidth }} whileTap={onClick ? { scale: 0.975 } : undefined} transition={{ type: 'spring', stiffness: 500, damping: 30 }} {...long}>
      <button type="button" className="pl-cp__hit" onClick={onClick ? () => { haptic('light'); onClick(); } : undefined} aria-label={`Ver ${item.title}`}>
        <span className="pl-cp__bg" aria-hidden="true" />
        <span className="pl-cp__mark">
          <ChannelMark name={item.title} size={size === 'sm' ? 40 : size === 'lg' ? 64 : 52} radius={size === 'sm' ? 10 : 14} />
        </span>
        <span className="pl-cp__top">
          {favorite && (
            <span className="pl-cp__fav" title="En favoritos">
              <Icon name="starFill" size={12} />
            </span>
          )}
          {now && (
            <Capsule tone={now.live ? 'live' : 'neutral'} size="sm" glass dot={now.live}>
              {now.live ? now.clock : now.clock}
            </Capsule>
          )}
        </span>
        <span className="pl-cp__bottom">
          <span className="pl-cp__name">{item.title}</span>
          <span className="pl-cp__sub">{now ? now.title : item.category}</span>
        </span>
        {watching && (
          <span className="pl-mp__watching">
            <Icon name="wave" size={12} /> En pantalla
          </span>
        )}
      </button>
      {onMore && (
        <button type="button" className="pl-cp__more" aria-label={`Más opciones de ${item.title}`} onClick={onMore}>
          <Icon name="more" size={16} />
        </button>
      )}
    </motion.div>
  );
});

/** Cartel de fuente: miniatura viva o gris, anillo de calidad, nombre y chips. */
export const SourcePoster = memo(function SourcePoster({ source, index, active, home, away, channel, onSelect, onMore, size = 'md', className, disabled }: { source: Source; index: number; active: boolean; home: string; away: string; channel: string; onSelect: () => void; onMore?: (e: MouseEvent) => void; size?: 'sm' | 'md' | 'lg'; className?: string; disabled?: boolean }) {
  const tone: Tone = sourceTone(source);
  const hasImage = source.state === 'working' || source.state === 'weak';
  const long = useLongPress(
    onMore
      ? () => {
          haptic('medium');
          onMore({} as MouseEvent);
        }
      : undefined,
  );
  return (
    <motion.div className={`pl-sp pl-sp--${size} pl-sp--${tone}${active ? ' is-active' : ''} ${className ?? ''}`} whileTap={!disabled ? { scale: 0.97 } : undefined} transition={{ type: 'spring', stiffness: 500, damping: 30 }} {...long}>
      <button type="button" className="pl-sp__hit" onClick={onSelect} disabled={disabled} aria-label={`Fuente ${index}: ${source.title}, ${sourceWord(source)}${active ? ', en pantalla' : ''}`} aria-pressed={active}>
        <span className="pl-sp__thumb">
          {hasImage ? (
            <FakeVideo playing quality={source.state === 'weak' ? 'weak' : 'ok'} home={home} away={away} radius={0} />
          ) : (
            <span className={`pl-sp__blank pl-sp__blank--${tone}`}>
              {tone === 'fail' && <Icon name="warning" size={18} />}
              {tone === 'checking' && <span className="pl-sp__pulse" />}
              {tone === 'queued' && <Icon name="clock" size={18} />}
            </span>
          )}
          <QualityRing tone={tone} active={active} radius={size === 'sm' ? 10 : 12} />
          <span className="pl-sp__num">{index}</span>
          {active && (
            <motion.span className="pl-sp__onair" layoutId="pl-sp-onair" transition={{ type: 'spring', stiffness: 480, damping: 40 }}>
              <Icon name="wave" size={11} /> En pantalla
            </motion.span>
          )}
        </span>
        <span className="pl-sp__name">{source.title}</span>
        <span className="pl-sp__meta">
          <span className={`pl-sp__word pl-tone--${tone}`}>
            <span className="pl-sp__dot" aria-hidden="true" />
            {sourceWord(source)}
          </span>
          <span className="pl-sp__chips">
            {source.resolution} · {source.listaName}
          </span>
        </span>
        {size !== 'sm' && <span className="pl-sp__detail">{sourceDetail(source, active)}</span>}
      </button>
      {onMore && (
        <button type="button" className="pl-sp__more" aria-label={`Más opciones de la fuente ${index}`} onClick={onMore}>
          <Icon name="more" size={16} />
        </button>
      )}
    </motion.div>
  );
});
