/* Tira de días (inventario §3.3; piel Palco de la fase 2, decisión W4:
   pastillas con el día en mayúsculas pequeñas, el número grande expandido y
   el recuento debajo; «Hoy» en oro). Reglas que conserva:

   - Un botón por día de la agenda. El recuento es el de partidos VISIBLES con
     el filtro actual.
   - NO se recoloca sola al repintar: conserva su scroll y solo se mueve para
     enseñar el día elegido la primera vez o cuando cambia (useKeepActiveVisible,
     nunca scrollIntoView). Tocarla cancela un centrado en curso.
   - La rueda vertical del ratón la desplaza en horizontal.
   - Flechas ‹ › que desplazan un 80 % del ancho visible (mínimo 120 px), se
     deshabilitan en los extremos y se ocultan si no hay desbordamiento. Van
     solo con ratón (pointer: fine): en táctil se desliza la propia tira y las
     flechas se comerían 88 px del móvil (decisión anotada).
   - Dos formas: `line` (móvil y tableta, a sangre, pastillas justas) y
     `tiles` (escritorio, pastillas anchas con «n partidos»).
   - Pestañas ARIA: flechas, Inicio y Fin cambian de día con el foco. */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../lib/cx.ts';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { useKeepActiveVisible, wheelToHorizontal } from '../../lib/scroll.ts';
import { IconButton, Num } from '../../ui/index.ts';
import { dayLabel } from './domain.ts';

export interface DayEntry {
  date: string;
  count: number;
}

export interface DayStripProps {
  days: readonly DayEntry[];
  selected: string | null;
  today: string;
  onSelect(date: string): void;
  variant?: 'line' | 'tiles';
  /** id del panel que controlan las pestañas (la lista). */
  controls?: string;
}

const partidos = (n: number) => `${n} ${n === 1 ? 'partido' : 'partidos'}`;
const RELATIVE = new Set(['Hoy', 'Mañana', 'Ayer']);

export function DayStrip({
  days,
  selected,
  today,
  onSelect,
  variant = 'line',
  controls,
}: DayStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const fine = useMediaQuery(MEDIA.finePointer);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });

  useKeepActiveVisible(trackRef, selected);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const next = {
      overflow: max > 1,
      start: track.scrollLeft <= 1,
      end: track.scrollLeft >= max - 1,
    };
    setEdges((current) =>
      current.overflow === next.overflow && current.start === next.start && current.end === next.end
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    measure();
    const onWheel = (event: WheelEvent) => wheelToHorizontal(event, track);
    // passive: false para poder quedarse la rueda (si no, movería la página).
    track.addEventListener('wheel', onWheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      track.removeEventListener('wheel', onWheel);
      observer.disconnect();
    };
  }, [measure]);

  useEffect(measure, [measure, days.length]);

  const scrollBy = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const step = Math.max(120, track.clientWidth * 0.8);
    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = Math.min(days.length - 1, index + 1);
    else if (event.key === 'ArrowLeft') target = Math.max(0, index - 1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = days.length - 1;
    if (target === null) return;
    event.preventDefault();
    const day = days[target];
    if (!day) return;
    onSelect(day.date);
    buttons.current.get(day.date)?.focus({ preventScroll: true });
  };

  // Mientras llega la agenda, el hueco de la tira con sus pastillas vacías:
  // sin él, al llegar los días todo lo de debajo bajaba de golpe (CLS 0,47
  // en el móvil; revisión de rendimiento de la Fase 2).
  if (days.length === 0)
    return (
      <div
        className={cx('agenda-days', `agenda-days--${variant}`, 'agenda-days--pending')}
        aria-hidden="true"
      >
        <div className="agenda-days__track">
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index} className="agenda-day agenda-day--pending" />
          ))}
        </div>
      </div>
    );
  const arrows = fine && edges.overflow;

  return (
    <div className={cx('agenda-days', `agenda-days--${variant}`, arrows && 'has-arrows')}>
      {arrows ? (
        <IconButton
          icon="chev-l"
          label="Días anteriores"
          className="agenda-days__arrow"
          disabled={edges.start}
          onClick={() => scrollBy(-1)}
        />
      ) : null}
      <div
        ref={trackRef}
        className="agenda-days__track"
        role="tablist"
        aria-label="Días"
        onScroll={measure}
        onPointerDown={() => {
          // Tocar la tira cancela el centrado suave en curso (index.html:3151).
          const track = trackRef.current;
          if (track) track.scrollTo({ left: track.scrollLeft, behavior: 'instant' });
        }}
      >
        {days.map((day, index) => {
          const label = dayLabel(day.date, today);
          const active = day.date === selected;
          return (
            <button
              key={day.date}
              ref={(node) => {
                if (node) buttons.current.set(day.date, node);
                else buttons.current.delete(day.date);
              }}
              type="button"
              role="tab"
              id={`agenda-dia-${day.date}`}
              aria-selected={active}
              aria-controls={controls}
              aria-label={`${RELATIVE.has(label.primary) ? `${label.primary}, ` : ''}${label.long}: ${partidos(day.count)}`}
              tabIndex={active ? 0 : -1}
              className={cx(
                'agenda-day',
                'press',
                day.date === today && 'is-today',
                day.date < today && 'is-past',
                day.count === 0 && 'is-empty',
              )}
              onClick={() => onSelect(day.date)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className="agenda-day__label">{label.primary}</span>
              {/* Número en texto plano (no en celdas de Num): va expandido y
                  no cambia, así que no hay nada que alinear. */}
              <span className="agenda-day__num" aria-hidden="true">
                {label.number}
              </span>
              <span className="agenda-day__count">
                {variant === 'line' ? (
                  <Num value={day.count} condensed={false} />
                ) : (
                  partidos(day.count)
                )}
              </span>
            </button>
          );
        })}
      </div>
      {arrows ? (
        <IconButton
          icon="chev-r"
          label="Días siguientes"
          className="agenda-days__arrow"
          disabled={edges.end}
          onClick={() => scrollBy(1)}
        />
      ) : null}
    </div>
  );
}
