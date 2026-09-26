/* Fila de canal (inventario §13.2 con la piel «Palco», plan fase 2 W8):

   1. la tesela 16:9 del canal (ChannelMark en forma `tile`, 64×36) y el nombre
      expandido (con el aviso de «canal caído» si toca);
   2. lo que da hoy según la agenda: en directo, escudos y marcador (TAPADO si
      es el partido que ves: regla 29); si no, «A las 21:30, Local – Visitante»;
   3. la meta: «En pantalla», el minuto, o el subtítulo de siempre (categoría,
      disponibilidad del buscador o los 14 primeros caracteres del hash).

   Es un enlace de verdad (`?vista=partido/canal/<hash>`): se puede abrir en
   otra pestaña; el clic normal reproduce (o elige, con la ficha de escritorio
   a la vista). Acciones: estrella y «Más» (con el ratón aparecen al pasar por
   encima; en táctil siempre), clic derecho y pulsación larga.

   Buscador con IPTV (docs/iptv.md §14.5): un canal de tu IPTV lleva el
   distintivo «IPTV» (el del cartel de la fuente: cápsula neutra con la tele)
   y su subtítulo propio («Casa · 1080p», «Tu IPTV»…). */

import type { LibraryCollection } from '@ace/shared';
import { useEffect, useId, useRef, type CSSProperties, type MouseEvent } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { teamCrest, teamPalette, teamShort } from '../../lib/teams.ts';
import {
  Capsule,
  ChannelMark,
  Icon,
  IconButton,
  LiveDot,
  Menu,
  MenuButton,
  Num,
  TeamMark,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { useScoreHidden } from '../agenda/score-reveal.ts';
import { subtitleFor } from './model.ts';
import { isHalftime, liveMinute, type ChannelOnAir } from './on-air.ts';

export interface ChannelRowData {
  id: string;
  title: string;
  category: string;
  alias?: string | undefined;
  ih: boolean;
}

export interface ChannelRowProps {
  item: ChannelRowData;
  kind: LibraryCollection | 'search';
  href: string;
  availability?: number | null;
  isFavorite: boolean;
  fallen?: boolean;
  onScreen: boolean;
  onAir: ChannelOnAir;
  selected?: boolean;
  /** Con la ficha de escritorio a la vista, el primer clic elige. */
  selectOnClick?: boolean;
  onPlay(): void;
  onSelect?(): void;
  onToggleFavorite(): void;
  menuItems: MenuItem[];
  /** Posición para la aparición escalonada (solo al entrar); null, sin animación. */
  enterIndex?: number | null;
  /** Es (o representa) un canal de tu IPTV: distintivo «IPTV» (§14.5). */
  iptv?: boolean;
  /** Subtítulo propio (el de una fila IPTV); si no, el de siempre. */
  subtitle?: string | undefined;
}

function scoreText(home: number, away: number): string {
  return `${home}–${away}`;
}

function OnAirLine({
  onAir,
  scoreHidden,
  id,
}: {
  onAir: ChannelOnAir;
  scoreHidden: boolean;
  id: string;
}) {
  const live = onAir.live;
  if (live) {
    const { match, score } = live;
    const showScore =
      !scoreHidden && score !== null && (score.state === 'in' || score.state === 'post');
    return (
      <span className="ch__line ch__line--live" id={id}>
        <span className="ch__crests" aria-hidden="true">
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
        <span className="ch__txt">
          {match.away ? (
            <>
              {match.home}{' '}
              {showScore ? (
                <Num
                  className="ch__score"
                  value={scoreText(score.home, score.away)}
                  label={`${score.home} a ${score.away}`}
                />
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
    );
  }
  const next = onAir.next;
  if (next) {
    const { match } = next;
    const teams = match.away ? `${match.home} – ${match.away}` : match.title;
    return (
      <span className="ch__line" id={id}>
        <span className="ch__crests" aria-hidden="true">
          <TeamMark
            name={match.home}
            short={teamShort(match, 'home')}
            colors={teamPalette(match, 'home')}
            crest={teamCrest(match, 'home')}
            size={18}
          />
          {match.away ? (
            <TeamMark
              name={match.away}
              short={teamShort(match, 'away')}
              colors={teamPalette(match, 'away')}
              crest={teamCrest(match, 'away')}
              size={18}
            />
          ) : null}
        </span>
        <span className="ch__txt">
          {/^\d{2}:\d{2}$/.test(match.time) ? (
            <>
              A las <Num value={match.time} condensed={false} />, {teams}
            </>
          ) : (
            <>Hoy, hora por confirmar: {teams}</>
          )}
        </span>
      </span>
    );
  }
  return null;
}

export function ChannelRow({
  item,
  kind,
  href,
  availability,
  isFavorite,
  fallen = false,
  onScreen,
  onAir,
  selected = false,
  selectOnClick = false,
  onPlay,
  onSelect,
  onToggleFavorite,
  menuItems,
  enterIndex = null,
  iptv = false,
  subtitle: ownSubtitle,
}: ChannelRowProps) {
  const { bind, menu } = useContextMenu();
  // El marcador del partido que ves va tapado (regla 29). El «destapado» es
  // el mismo en toda la app: el almacén de la agenda (agenda/score-reveal.ts).
  const scoreHidden = useScoreHidden(onAir.live?.match.id ?? '', onScreen);
  const lastMenuAt = useRef(0);
  const id = useId();
  const lineId = `${id}-ahora`;
  const metaId = `${id}-meta`;

  useEffect(() => {
    if (!menu.open) return;
    lastMenuAt.current = Date.now();
    // Pulsación larga (o clic derecho): un toque medio al abrirse el menú (HAPTIC_MAP).
    haptic('medium');
  }, [menu.open]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Clic con modificador o botón central: que el navegador abra otra pestaña.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    // La pulsación larga abre el menú y el dedo, al levantarse, «hace clic»:
    // ese clic no debe reproducir.
    if (Date.now() - lastMenuAt.current < 700) return;
    if (selectOnClick && !selected) {
      onSelect?.();
      return;
    }
    onPlay();
  };

  const live = onAir.live;
  const minute = live ? liveMinute(live.score) : null;
  // En el descanso el reloj de ESPN se queda en 45': se dice «Descanso», como
  // el anillo de la ficha, para que la tarjeta y la ficha no se contradigan.
  const halftime = live ? isHalftime(live.score) : false;
  const subtitle = ownSubtitle ?? subtitleFor(item, kind, availability);
  const title = item.title || 'Canal sin nombre';

  return (
    <article
      className={cx('ch', enterIndex !== null && 'ch--enter')}
      style={enterIndex !== null ? ({ '--i': enterIndex } as CSSProperties) : undefined}
      aria-current={selected ? 'true' : undefined}
      data-on-screen={onScreen ? 'true' : undefined}
    >
      <a
        className="ch__main"
        href={href}
        aria-label={`${title}${onScreen ? ', en pantalla' : ''}`}
        aria-describedby={`${onAir.live || onAir.next ? `${lineId} ` : ''}${metaId}`}
        onClick={onClick}
        onFocus={selectOnClick ? undefined : onSelect}
        {...bind}
        onContextMenu={(event) => {
          onSelect?.();
          bind.onContextMenu(event);
        }}
      >
        <ChannelMark name={title} shape="tile" size={36} className="ch__dorsal" />
        <span className="ch__body">
          <span className="ch__name">
            <span className="ch__name-text">{title}</span>
            {iptv ? (
              <Capsule tone="neutral" size="sm" icon="tv" className="ch__iptv">
                IPTV
              </Capsule>
            ) : null}
            {fallen ? (
              <span
                className="ch__fallen"
                role="img"
                aria-label="Este canal ya no aparece en la última sincronización"
                title="Este canal ya no aparece en la última sincronización"
              >
                <Icon name="aviso" size={16} />
              </span>
            ) : null}
          </span>
          <OnAirLine onAir={onAir} scoreHidden={scoreHidden} id={lineId} />
          <span className="ch__meta" id={metaId}>
            {onScreen ? (
              <span className="ch__onair">
                <span className="ch__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                En pantalla
              </span>
            ) : null}
            {live ? (
              <>
                <span className="ch__min">
                  <LiveDot />
                  {halftime ? (
                    <span>Descanso</span>
                  ) : minute ? (
                    <Num value={minute} label={`minuto ${minute}`} />
                  ) : null}
                </span>
                <span className={cx('ch__state', scoreHidden && 'ch__state--hidden')}>
                  {scoreHidden ? 'Marcador oculto' : 'En directo'}
                </span>
              </>
            ) : (
              <span className="ch__sub">{subtitle}</span>
            )}
          </span>
        </span>
      </a>
      <div className="ch__acts">
        <IconButton
          className="ch__fav"
          icon="star"
          pressedIcon="star-f"
          label={isFavorite ? `Quitar ${title} de favoritos` : `Añadir ${title} a favoritos`}
          title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          pressed={isFavorite}
          onClick={onToggleFavorite}
        />
        <MenuButton
          className="ch__more"
          label={`Más acciones para ${title}`}
          title="Más acciones"
          items={menuItems}
          onFocus={onSelect}
        />
      </div>
      <Menu
        open={menu.open}
        anchor={menu.anchor}
        onClose={menu.onClose}
        label={`Acciones de ${title}`}
        items={menuItems}
      />
    </article>
  );
}
