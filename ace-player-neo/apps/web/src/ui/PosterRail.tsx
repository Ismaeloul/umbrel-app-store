/* Carrusel horizontal de carteles (plan fase 2, primitiva nueva C7): filas
   por competición de tarjetas versus, «Emitiendo ahora» de canales, carteles
   de fuente, filas de Pelis y series. Reglas:
   - `scroll-snap-type: x mandatory` con `scroll-padding` = gutter, para que
     cada cartel pare alineado con el margen;
   - la rueda vertical del ratón baja la PÁGINA aunque el ratón esté encima
     (0.9.0, lo pidió Isma); a los lados se va con el touchpad, con Mayús +
     rueda (lib/scroll.ts) o con las flechas;
   - flechas solo con puntero fino y cuando hay desbordamiento; la de un
     extremo se apaga al llegar a él (no hay nada más por ese lado). Al
     pulsarlas, el carrusel se desliza SOLO en horizontal (scrollBy, nunca
     scrollIntoView, que movería también la página) y la flecha se queda en
     su sitio: se centra con `translate` y el «apretón» de `.press` es `scale`,
     dos propiedades que se suman (con las dos en `transform`, la de pulsar
     pisaba el centrado y la flecha bajaba media altura);
   - no se recoloca solo al repintar (regla 1 del inventario);
   - `list` lo anuncia como lista con un elemento por hijo;
   - si desborda y no lleva nada enfocable dentro (carteles de muestra, sin
     enlace ni botón), la propia pista entra en el orden de tabulación con su
     nombre, para desplazarla con las flechas del teclado (WCAG 2.1.1; axe
     «scrollable-region-focusable»). Con carteles enfocables no hace falta:
     el navegador la desplaza al llevar el foco a cada uno. */

import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx.ts';
import { MEDIA, prefersReducedMotion, useMediaQuery } from '../lib/media.ts';
import { shiftWheelToHorizontal } from '../lib/scroll.ts';
import { IconButton } from './Button.tsx';
import { focusableIn } from './overlay.ts';
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

interface Edges {
  /** Hay más contenido del que cabe. */
  overflow: boolean;
  /** Está al principio (nada a la izquierda). */
  start: boolean;
  /** Está al final (nada a la derecha). */
  end: boolean;
}

/** Margen para dar un extremo por alcanzado (el snap y los decimales dejan 1 px). */
const EDGE_PX = 2;

function readEdges(track: HTMLElement): Edges {
  const max = track.scrollWidth - track.clientWidth;
  return {
    overflow: max > 1,
    start: track.scrollLeft <= EDGE_PX,
    end: track.scrollLeft >= max - EDGE_PX,
  };
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
  const [edges, setEdges] = useState<Edges>({ overflow: false, start: true, end: true });
  // ¿Hay algo enfocable dentro? Se mira tras cada pintado (los hijos cambian);
  // solo se guarda si cambia, así que no hay bucle.
  const [hasFocusable, setHasFocusable] = useState(true);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const found = focusableIn(track).length > 0;
    if (found !== hasFocusable) setHasFocusable(found);
  });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const next = readEdges(track);
    setEdges((current) =>
      current.overflow === next.overflow && current.start === next.start && current.end === next.end
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent) => shiftWheelToHorizontal(event, track);
    // passive: false solo para quedarse Mayús + rueda; la rueda sola no se toca.
    track.addEventListener('wheel', onWheel, { passive: false });
    track.addEventListener('scroll', measure, { passive: true });
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(track);
    return () => {
      track.removeEventListener('wheel', onWheel);
      track.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure]);

  // Llegan o se van carteles: puede empezar o dejar de desbordar.
  const count = Children.count(children);
  useEffect(measure, [measure, count]);

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * track.clientWidth * step,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const arrows = fine && edges.overflow;
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
          disabled={edges.start}
          onClick={() => move(-1)}
        />
      ) : null}
      <div
        ref={trackRef}
        className="prail__track"
        role={list ? 'list' : 'group'}
        aria-label={label}
        tabIndex={edges.overflow && !hasFocusable ? 0 : undefined}
      >
        {items}
      </div>
      {arrows ? (
        <IconButton
          icon="chev-r"
          label="Siguientes"
          variant="glass"
          className="prail__arrow prail__arrow--next"
          disabled={edges.end}
          onClick={() => move(1)}
        />
      ) : null}
    </div>
  );
}
