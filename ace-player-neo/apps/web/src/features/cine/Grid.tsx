/* La rejilla de carteles (docs/vod.md §12.4): filas de N tarjetas sobre la
   lista virtual de Canales (VirtualList, con el scroll de la página), así una
   categoría de 20 000 películas pinta unas pocas filas. N sale del ancho de
   la rejilla (3 a 360 px, 4 a 480, 5 a 768, 6 a 1024 y 7 a 1280; model.ts).

   - El lector de pantalla ve UNA lista de tarjetas: cada tarjeta es un
     elemento con `aria-setsize` (el total, aunque no esté cargado) y
     `aria-posinset`; las filas no se anuncian.
   - La página siguiente se pide al pintar las últimas filas y con «Cargar
     más películas» (teclado y lector de pantalla), que pinta quien la usa. */

import type { VodCard } from '@ace/shared';
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { VirtualList } from '../library/VirtualList.tsx';
import { chunk, columnsFor } from './model.ts';
import { PosterCard } from './PosterCard.tsx';

/** Ancho de un elemento, al día con ResizeObserver (sin él, el de la ventana). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(() => globalThis.innerWidth ?? 390);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width) || globalThis.innerWidth || 390;
      setWidth((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface PosterGridProps {
  cards: readonly VodCard[];
  /** Total de la búsqueda o la categoría (aria-setsize). */
  total: number;
  label: string;
  onEndReached?(): void;
}

interface Row {
  key: string;
  start: number;
  cards: VodCard[];
}

export function PosterGrid({ cards, total, label, onEndReached }: PosterGridProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const columns = columnsFor(width);
  const rows: Row[] = chunk(cards, columns).map((row, index) => ({
    key: `${columns}:${index}`,
    start: index * columns,
    cards: row,
  }));
  // Cartel 2:3 + título en 2 líneas + datos + cápsulas.
  const cardWidth = Math.max(80, (width - (columns - 1) * 12) / columns);
  const rowHeight = Math.round(cardWidth * 1.5 + 96);
  return (
    <div
      ref={ref}
      className="cine-grid"
      role="list"
      aria-label={label}
      style={{ '--cols': columns } as CSSProperties}
    >
      <VirtualList
        rows={rows}
        role="none"
        rowKey={(row) => row.key}
        estimate={() => rowHeight}
        className="cine-grid__list"
        rowClassName={() => 'cine-grid__row'}
        overscan={3}
        endThreshold={3}
        onEndReached={onEndReached}
        renderRow={(row) => (
          <div className="cine-grid__cells">
            {row.cards.map((card, index) => (
              <div
                key={card.id}
                role="listitem"
                className="cine-grid__cell"
                aria-setsize={total}
                aria-posinset={row.start + index + 1}
              >
                <PosterCard card={card} />
              </div>
            ))}
          </div>
        )}
      />
    </div>
  );
}
