/* Carrusel horizontal de carteles (plan fase 2, primitiva nueva C7): filas
   por competición de tarjetas versus, «Emitiendo ahora» de canales, carteles
   de fuente. Reglas:
   - `scroll-snap-type: x mandatory` con `scroll-padding` = gutter, para que
     cada cartel pare alineado con el margen;
   - la rueda vertical del ratón desplaza en horizontal (lib/scroll.ts);
   - flechas solo con puntero fino y cuando hay desbordamiento;
   - no se recoloca solo al repintar (regla 1 del inventario);
   - `list` lo anuncia como lista con un elemento por hijo. */

import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { MEDIA, useMediaQuery } from '../lib/media.ts';
import { wheelToHorizontal } from '../lib/scroll.ts';
import { IconButton } from './Button.tsx';
import './PosterRail.css';

export interface PosterRailProps {
  /** Nombre accesible del carrusel («Partidos de LaLiga»). */
  label: string;
  children: ReactNode;
  /** Anúncialo como lista (role=list) con cada hijo como elemento. */
  list?: boolean;
  /** Ancho de cada cartel (si no, lo pone quien lo usa por CSS). */
  itemWidth?: string;
  /** Sangra hasta los bordes de la página (márgenes negativos = gutter). */
  bleed?: boolean;
  className?: string;
  /** Distancia que mueve cada flecha, en fracción del ancho visible. */
  step?: number;
}

export function PosterRail({
  label,
  children,
  list = false,
  itemWidth,
  bleed = false,
  className,
  step = 0.8,
}: PosterRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fine = useMediaQuery(MEDIA.finePointer);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => wheelToHorizontal(event, track);
    track.addEventListener('wheel', onWheel, { passive: false });
    const measure = () => setOverflow(track.scrollWidth > track.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(track);
    return () => {
      track.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, []);

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * step, behavior: 'smooth' });
  };

  const arrows = fine && overflow;
  const items = list
    ? Children.map(children, (child) =>
        child === null || child === undefined || child === false ? null : (
          <div role="listitem" className="prail__item">
            {child}
          </div>
        ),
      )
    : children;

  return (
    <div
      className={cx('prail', bleed && 'prail--bleed', arrows && 'prail--arrows', className)}
      style={itemWidth ? ({ '--prail-item-w': itemWidth } as CSSProperties) : undefined}
    >
      {arrows ? (
        <IconButton
          icon="chev-l"
          label="Anteriores"
          variant="glass"
          className="prail__arrow prail__arrow--prev"
          onClick={() => move(-1)}
        />
      ) : null}
      <div
        ref={trackRef}
        className="prail__track"
        role={list ? 'list' : 'group'}
        aria-label={label}
      >
        {items}
      </div>
      {arrows ? (
        <IconButton
          icon="chev-r"
          label="Siguientes"
          variant="glass"
          className="prail__arrow prail__arrow--next"
          onClick={() => move(1)}
        />
      ) : null}
    </div>
  );
}
