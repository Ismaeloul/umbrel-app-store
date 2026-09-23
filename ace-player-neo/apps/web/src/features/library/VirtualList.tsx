/* Lista virtualizada sobre el scroll de la PÁGINA (@tanstack/react-virtual).

   En el móvil desplaza el documento entero (el armazón guarda y restaura su
   posición por vista), así que se usa el virtualizador de ventana y se le
   dice dónde empieza la lista (`scrollMargin`). Solo se pintan las filas a la
   vista más unas pocas por encima y por debajo: una lista de 500 canales
   pinta unas 20 tarjetas.

   Las filas se colocan con transform (nada de top animado) y se miden solas
   (`measureElement`), porque una tarjeta con partido es más alta que otra sin
   él. Oculta (Activity), la vista no tiene efectos: el virtualizador deja de
   escuchar el scroll y vuelve a medir al enseñarse. */

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';

export interface VirtualListProps<T> {
  rows: readonly T[];
  rowKey(row: T, index: number): string;
  /** Alto estimado en px antes de medir. */
  estimate(row: T): number;
  renderRow(row: T, index: number): ReactNode;
  /** role del contenedor y de cada fila. */
  role?: 'list' | 'none';
  label?: string;
  className?: string;
  rowClassName?(row: T): string | undefined;
  overscan?: number;
}

export function VirtualList<T>({
  rows,
  rowKey,
  estimate,
  renderRow,
  role = 'list',
  label,
  className,
  rowClassName,
  overscan = 8,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  // Dónde empieza la lista en el documento. Cambia si aparece algo encima
  // («Emitiendo ahora», un aviso): se mide tras cada pintado, sin bucles
  // porque solo se guarda si se ha movido de verdad.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = Math.round(el.getBoundingClientRect().top + (globalThis.scrollY ?? 0));
    if (Math.abs(top - margin) > 1) setMargin(top);
  });

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => {
      const row = rows[index];
      return row === undefined ? 80 : estimate(row);
    },
    getItemKey: (index) => {
      const row = rows[index];
      return row === undefined ? index : rowKey(row, index);
    },
    overscan,
    scrollMargin: margin,
  });

  const items = virtualizer.getVirtualItems();
  return (
    <div
      ref={listRef}
      className={cx('vlist', className)}
      role={role === 'list' ? 'list' : undefined}
      aria-label={label}
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {items.map((virtual) => {
        const row = rows[virtual.index];
        if (row === undefined) return null;
        return (
          <div
            key={virtual.key}
            data-index={virtual.index}
            ref={virtualizer.measureElement}
            role={role === 'list' ? 'listitem' : undefined}
            className={cx('vlist__row', rowClassName?.(row))}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {renderRow(row, virtual.index)}
          </div>
        );
      })}
    </div>
  );
}
