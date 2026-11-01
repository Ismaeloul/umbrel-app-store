/* Fila de Canales en el móvil (por debajo de 768 px), dirección B «Lista con
   ahora» de la maqueta (movil-canales.html): una lista limpia que se lee como
   una guía rápida.

   1. La placa del canal (ChannelPlate, la de la tabla de escritorio: el color
      de su marca o el logo de la guía de tu IPTV).
   2. El nombre, con las barritas del reproductor si es el que suena.
   3. Lo que echa AHORA: el partido en juego de la agenda (con su punto rojo)
      o el programa de la guía de tu IPTV; sin nada ahora, lo siguiente
      («21:00 · …»); sin nada, el subtítulo de siempre (categoría, «Tu IPTV»…).
   4. Debajo, de dónde sale (IPTV o AceStream, la etiqueta del escritorio), la
      barra de lo que lleva emitido y cuánto le queda («quedan 25 min»; en un
      partido, el minuto).

   Los datos son los de la tabla de escritorio (`rowCells` de DeskChannels):
   el marcador nunca sale aquí (regla 29 sin tener que taparlo). Mismos
   nombres accesibles que la fila de siempre (ChannelRow): el enlace dice
   «…, en pantalla», la estrella y «Más acciones para …» (en el móvil
   estrecho la estrella va dentro del menú), clic derecho y pulsación larga. */

import { useEffect, useId, useRef, type CSSProperties, type MouseEvent } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { useNameHighlight } from '../../lib/name-highlight.ts';
import { Equalizer } from '../../player/PlayerSurface.tsx';
import {
  Icon,
  IconButton,
  LiveDot,
  Menu,
  MenuButton,
  useContextMenu,
  type MenuItem,
} from '../../ui/index.ts';
import { aceTagText } from '../search/iptv.ts';
import type { ChannelRowData } from './ChannelRow.tsx';
import { ChannelPlate } from './ChannelPlate.tsx';
import { rowCells } from './DeskChannels.tsx';
import type { GuideNow } from './guide-now.ts';
import { subtitleFor } from './model.ts';
import { isHalftime, liveMinute, type ChannelOnAir } from './on-air.ts';
import type { LibraryCollection } from '@ace/shared';
import './mobile.css';

/** «quedan 25 min», «queda 1 min», «quedan 1 h 20 min»; null si ya acabó. */
export function remainingText(end: number, now: number): string | null {
  const minutes = Math.ceil((end - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const amount =
    hours === 0 ? `${minutes} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  return `${minutes === 1 ? 'queda' : 'quedan'} ${amount}`;
}

export interface MobileChannelRowProps {
  item: ChannelRowData;
  kind: LibraryCollection | 'search';
  href: string;
  /** Reloj de la vista (`useNow`), para la barra y lo que queda. */
  now: number;
  /** Lo que dice la guía de tu IPTV de este canal; null sin guía. */
  guide: GuideNow | null;
  /** Lo que da hoy según la agenda; null en un canal IPTV. */
  onAir: ChannelOnAir | null;
  /** Se ve por tu IPTV: etiqueta «IPTV»; si no, «AceStream». */
  iptv: boolean;
  /** Fuentes de AceStream de un canal IPTV («AceStream · 3»); 0, sin esa etiqueta. */
  ace?: number;
  /** Subtítulo propio («Tu IPTV», el proveedor…); si no, el de siempre. */
  subtitle?: string | undefined;
  isFavorite: boolean;
  fallen?: boolean;
  /** Es el canal que suena. */
  onScreen: boolean;
  onPlay(): void;
  onToggleFavorite(): void;
  menuItems: MenuItem[];
  /** Posición para la aparición escalonada (solo al entrar); null, sin animación. */
  enterIndex?: number | null;
  /** Lo escrito en el filtro: lo que casa del nombre se resalta. */
  highlight?: string | undefined;
}

export function MobileChannelRow({
  item,
  kind,
  href,
  now,
  guide,
  onAir,
  iptv,
  ace = 0,
  subtitle: ownSubtitle,
  isFavorite,
  fallen = false,
  onScreen,
  onPlay,
  onToggleFavorite,
  menuItems,
  enterIndex = null,
  highlight,
}: MobileChannelRowProps) {
  const { bind, menu } = useContextMenu();
  const lastMenuAt = useRef(0);
  const id = useId();
  const nameRef = useRef<HTMLSpanElement>(null);
  const title = item.title || 'Canal sin nombre';
  useNameHighlight(nameRef, highlight, title);
  const cells = rowCells(guide, onAir, now);
  const subtitle = ownSubtitle ?? subtitleFor(item, kind);

  useEffect(() => {
    if (!menu.open) return;
    lastMenuAt.current = Date.now();
    // Pulsación larga (o clic derecho): un toque medio al abrirse el menú.
    haptic('medium');
  }, [menu.open]);

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Con modificador o botón central, que el navegador abra otra pestaña.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    // El dedo que se levanta tras la pulsación larga no reproduce.
    if (Date.now() - lastMenuAt.current < 700) return;
    onPlay();
  };

  /* A la derecha de la barra: el minuto del partido o lo que le queda al programa. */
  const live = onAir?.live ?? null;
  const fromMatch = cells.now?.live === true && live !== null;
  const minute = fromMatch ? liveMinute(live.score) : null;
  const left = fromMatch
    ? isHalftime(live.score)
      ? 'Descanso'
      : minute
    : cells.now && guide?.now
      ? remainingText(guide.now.end, now)
      : null;
  /* Con «ahora» o «después» en la segunda línea, el subtítulo propio («Ya no
     está en tu IPTV», el proveedor) baja a la tercera, en vez de perderse. */
  const lineTaken = cells.now !== null || cells.next !== null;
  const extra = lineTaken && ownSubtitle ? ownSubtitle : null;

  return (
    <article
      className={cx('mch', enterIndex !== null && 'mch--enter')}
      style={enterIndex !== null ? ({ '--i': enterIndex } as CSSProperties) : undefined}
      data-playing={onScreen ? 'true' : undefined}
    >
      <a
        className="mch__main"
        href={href}
        aria-label={`${title}${onScreen ? ', en pantalla' : ''}`}
        aria-describedby={`${id}-ahora ${id}-meta`}
        onClick={onClick}
        {...bind}
      >
        <ChannelPlate name={title} logo={guide?.logoSrc ?? null} className="mch__plate" />
        <span className="mch__body">
          <span className="mch__name">
            <span className="mch__title" ref={nameRef}>
              {title}
            </span>
            {onScreen ? (
              <>
                <Equalizer playing />
                <span className="sr-only">En pantalla</span>
              </>
            ) : null}
            {fallen ? (
              <span
                className="mch__fallen"
                role="img"
                aria-label="Este canal ya no aparece en la última sincronización"
                title="Este canal ya no aparece en la última sincronización"
              >
                <Icon name="aviso" size={16} />
              </span>
            ) : null}
          </span>
          <span className={cx('mch__now', cells.now?.live && 'mch__now--live')} id={`${id}-ahora`}>
            {cells.now ? (
              <>
                <span className="sr-only">Ahora: </span>
                {cells.now.live ? <LiveDot /> : null}
                <span className="mch__text">{cells.now.title}</span>
              </>
            ) : cells.next ? (
              <>
                <span className="sr-only">Después, </span>
                <small className="mch__time">{cells.next.time}</small>
                <span className="mch__text">{cells.next.title}</span>
              </>
            ) : (
              <span className="mch__text mch__text--sub">{subtitle}</span>
            )}
          </span>
          <span className="mch__meta" id={`${id}-meta`}>
            <span className={cx('mch__origin', iptv && 'mch__origin--iptv')}>
              {iptv ? 'IPTV' : 'AceStream'}
            </span>
            {iptv && ace > 0 ? (
              <span
                className="mch__origin"
                title={ace === 1 ? 'Está en AceStream' : `${ace} fuentes de AceStream`}
              >
                {aceTagText(ace)}
              </span>
            ) : null}
            {cells.now && cells.now.progress !== null ? (
              <span
                className="mch__bar"
                aria-hidden="true"
                style={{ '--p': Math.round(cells.now.progress * 1000) / 1000 } as CSSProperties}
              >
                <i />
              </span>
            ) : null}
            {left ? <span className="mch__left">{left}</span> : null}
            {extra ? <span className="mch__extra">{extra}</span> : null}
          </span>
        </span>
      </a>
      <div className="mch__acts">
        <IconButton
          className="mch__fav"
          icon="star"
          pressedIcon="star-f"
          label={isFavorite ? `Quitar ${title} de favoritos` : `Añadir ${title} a favoritos`}
          title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          pressed={isFavorite}
          onClick={onToggleFavorite}
        />
        <MenuButton
          className="mch__more"
          label={`Más acciones para ${title}`}
          title="Más acciones"
          items={menuItems}
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
