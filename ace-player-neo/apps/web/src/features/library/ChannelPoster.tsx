/* Cartel de canal (plan Palco fase 2, decisión W8): la tesela 16:9 de
   «Emitiendo ahora». Lleva la marca del canal grande sobre su luz de tono, el
   nombre, la línea del partido con los escudos («Local 2–1 Visitante») y la
   cápsula de estado (minuto · «En directo», o «En pantalla» si es el que
   suena). El marcador del partido que ves sale TAPADO hasta que lo pides
   (regla 29): «Ver marcador» lo destapa con el mismo almacén que la agenda.
   Ese botón va DEBAJO del cartel, no encima: un control sobre el enlace se
   pisaría con él al tocar.

   Un solo <video> en toda la app (corrección 2): aquí no hay miniatura ni
   reproducción; el cartel es un enlace al canal, como la tarjeta de antes, y
   su nombre accesible sale de su contenido (título, partido y estado), igual
   que antes, para no chocar con el `link` de la fila que se llama exactamente
   como el canal (lo usan las e2e). */

import type { Item } from '@ace/shared';
import type { CSSProperties, MouseEvent } from 'react';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { teamCrest, teamPalette, teamShort } from '../../lib/teams.ts';
import { Capsule, ChannelMark, Icon, Num, TeamMark } from '../../ui/index.ts';
import { revealScore, useScoreHidden } from '../agenda/score-reveal.ts';
import { isHalftime, liveMinute, type OnAirMatch } from './on-air.ts';

export interface ChannelPosterProps {
  item: Item;
  live: OnAirMatch;
  /** Es el canal que suena en este dispositivo. */
  watching: boolean;
  isFavorite?: boolean;
  href: string;
  onPlay(item: Item): void;
}

export function ChannelPoster({
  item,
  live,
  watching,
  isFavorite = false,
  href,
  onPlay,
}: ChannelPosterProps) {
  const { match, score } = live;
  const hidden = useScoreHidden(match.id, watching);
  const minute = liveMinute(score);
  const halftime = isHalftime(score);
  const showScore = !hidden && score !== null && (score.state === 'in' || score.state === 'post');
  const title = item.title || 'Canal sin nombre';
  const tone = channelTone(title);
  const style = {
    '--tone': oklchCss(tone),
    '--tone-hi': oklchCss({ ...tone, l: Math.min(0.9, tone.l + 0.16) }),
  } as CSSProperties;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Clic con modificador o botón central: que el navegador abra otra pestaña.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    haptic('light');
    onPlay(item);
  };

  return (
    <article
      className={cx('chp', watching && 'is-watching')}
      style={style}
      data-on-screen={watching || undefined}
    >
      <a className="chp__hit press" href={href} onClick={onClick}>
        <span className="chp__bg" aria-hidden="true" />
        <span className="chp__mark" aria-hidden="true">
          <ChannelMark name={title} shape="tile" size={52} />
        </span>
        <span className="chp__top">
          {isFavorite ? (
            <span className="chp__fav" title="En favoritos" aria-hidden="true">
              <Icon name="star-f" size={16} />
            </span>
          ) : null}
          <Capsule
            tone={watching ? 'gold' : 'live'}
            dot={!watching}
            glass
            size="sm"
            className="chp__capsule"
          >
            {halftime ? (
              <span>Descanso</span>
            ) : minute ? (
              <Num value={minute} label={`minuto ${minute}`} />
            ) : null}
            {halftime || minute ? <span aria-hidden="true"> · </span> : null}
            <span className="chp__state">{watching ? 'En pantalla' : 'En directo'}</span>
          </Capsule>
        </span>
        <span className="chp__bottom">
          <span className="chp__name">{title}</span>
          <span className="chp__match">
            <span className="chp__crests" aria-hidden="true">
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
            <span className="chp__txt">
              {match.away ? (
                <>
                  {match.home}{' '}
                  {showScore ? (
                    <Num
                      className="chp__score"
                      value={`${score.home}–${score.away}`}
                      label={`${score.home} a ${score.away}`}
                    />
                  ) : hidden ? (
                    // Tapado (regla 29): el guion a la vista; al lector, por qué.
                    <>
                      <span aria-hidden="true">–</span>
                      <span className="sr-only"> (marcador oculto) </span>
                    </>
                  ) : (
                    '–'
                  )}{' '}
                  {match.away}
                </>
              ) : (
                match.title
              )}
            </span>
          </span>
        </span>
      </a>
      {hidden ? (
        <Capsule
          as="button"
          size="sm"
          icon="eye"
          className="chp__reveal"
          title="Tu emisión va por detrás del directo"
          onClick={() => {
            haptic('light');
            revealScore(match.id);
          }}
        >
          Ver marcador
        </Capsule>
      ) : null}
    </article>
  );
}
