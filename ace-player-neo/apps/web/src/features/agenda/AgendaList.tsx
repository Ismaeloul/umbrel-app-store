/* Lista de partidos por competición, VIRTUALIZADA (@tanstack/react-virtual):
   solo existen en el DOM las franjas que se ven (más unas pocas de margen).
   Un sábado con 60 partidos y la biblioteca llena no cuesta más que uno con 5.

   - En la vista, la que desplaza es la página (window): en el móvil el
     documento entero hace scroll y el armazón guarda su posición por vista.
   - En la columna compacta del centro de partido, la que desplaza es la
     propia columna del armazón (.app-column).

   Aparición escalonada: SOLO al entrar la lista (cambio de día o de filtro)
   y solo las primeras filas. Las que aparecen luego al hacer scroll, o las
   que se repintan con la misma clave, no se animan (regla 2). */

import type { FootballMatch } from '@ace/shared';
import { useVirtualizer, useWindowVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CompetitionGroup } from './domain.ts';
import type { RowPosition } from './MatchRow.tsx';

export type ListItem =
  | { kind: 'head'; key: string; competition: string; count: number; first: boolean }
  | { kind: 'row'; key: string; match: FootballMatch; position: RowPosition };

/** Grupos → una lista plana (cabecera de competición + sus franjas). */
export function flattenGroups(groups: readonly CompetitionGroup[]): ListItem[] {
  const items: ListItem[] = [];
  groups.forEach((group, groupIndex) => {
    items.push({
      kind: 'head',
      key: `h:${group.competition}`,
      competition: group.competition,
      count: group.matches.length,
      first: groupIndex === 0,
    });
    group.matches.forEach((match, index) => {
      const last = index === group.matches.length - 1;
      const position: RowPosition =
        group.matches.length === 1 ? 'only' : index === 0 ? 'first' : last ? 'last' : 'middle';
      items.push({ kind: 'row', key: `m:${match.id}`, match, position });
    });
  });
  return items;
}

const STAGGER_WINDOW_MS = 600;
const STAGGER_ROWS = 12;

/** Decide, una vez por fila, si entra con la aparición escalonada. */
function useStagger(listKey: string) {
  const state = useRef<{ key: string; at: number; decided: Map<string, number | null> }>({
    key: listKey,
    at: typeof performance !== 'undefined' ? performance.now() : 0,
    decided: new Map(),
  });
  if (state.current.key !== listKey) {
    state.current = { key: listKey, at: performance.now(), decided: new Map() };
  }
  let visual = 0;
  return {
    reset() {
      visual = 0;
    },
    indexFor(key: string): number | null {
      const decided = state.current.decided;
      if (decided.has(key)) return decided.get(key) ?? null;
      const fresh = performance.now() - state.current.at < STAGGER_WINDOW_MS;
      const value = fresh && visual < STAGGER_ROWS ? visual : null;
      visual += 1;
      decided.set(key, value);
      return value;
    },
  };
}

export interface AgendaListProps {
  items: readonly ListItem[];
  /** Cambia al cambiar de día o de filtro: la lista entra de nuevo. */
  listKey: string;
  renderRow(item: Extract<ListItem, { kind: 'row' }>, staggerIndex: number | null): ReactNode;
  renderHead(item: Extract<ListItem, { kind: 'head' }>): ReactNode;
  estimateRow?: number;
  estimateHead?: number;
  className?: string;
  label: string;
}

function VirtualBody({
  virtualizer,
  items,
  listKey,
  renderRow,
  renderHead,
  scrollMargin,
}: Pick<AgendaListProps, 'items' | 'listKey' | 'renderRow' | 'renderHead'> & {
  virtualizer: Virtualizer<Window, Element> | Virtualizer<HTMLElement, Element>;
  scrollMargin: number;
}) {
  const stagger = useStagger(listKey);
  stagger.reset();
  return (
    <div className="agenda-list__space" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtual) => {
        const item = items[virtual.index];
        if (!item) return null;
        return (
          <div
            key={item.key}
            data-index={virtual.index}
            ref={virtualizer.measureElement}
            className={item.kind === 'head' ? 'agenda-list__head' : 'agenda-list__row'}
            data-first={item.kind === 'head' && item.first ? 'true' : undefined}
            style={{ transform: `translateY(${virtual.start - scrollMargin}px)` }}
          >
            {item.kind === 'head' ? renderHead(item) : renderRow(item, stagger.indexFor(item.key))}
          </div>
        );
      })}
    </div>
  );
}

/** Lo que hay por encima de la lista dentro de su scroller (para `scrollMargin`). */
function useOffsetWithin(ref: RefObject<HTMLElement | null>, scroller: HTMLElement | null): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      const next = scroller
        ? top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : top + window.scrollY;
      const rounded = Math.round(next);
      setOffset((current) => (Math.abs(current - rounded) > 1 ? rounded : current));
    };
    measure();
    // Lo de arriba cambia de alto (la tarjeta de primer uso, el filtro…):
    // se vuelve a medir cuando cambia el tamaño del contenedor, no en cada
    // repintado (la lista se repinta con cada scroll).
    const observer = new ResizeObserver(measure);
    observer.observe(element.parentElement ?? element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref, scroller]);
  return offset;
}

/** Lista que desplaza la página (la vista de la agenda). */
export function WindowAgendaList({
  items,
  listKey,
  renderRow,
  renderHead,
  estimateRow = 100,
  estimateHead = 52,
  className,
  label,
}: AgendaListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollMargin = useOffsetWithin(ref, null);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (index) => (items[index]?.kind === 'head' ? estimateHead : estimateRow),
    overscan: 6,
    scrollMargin,
    getItemKey: (index) => items[index]?.key ?? index,
  });
  return (
    <div ref={ref} className={className} role="region" aria-label={label}>
      <VirtualBody
        virtualizer={virtualizer}
        items={items}
        listKey={listKey}
        renderRow={renderRow}
        renderHead={renderHead}
        scrollMargin={scrollMargin}
      />
    </div>
  );
}

/** Lista dentro de un contenedor con scroll propio (la columna compacta). */
export function ElementAgendaList({
  items,
  listKey,
  renderRow,
  renderHead,
  estimateRow = 66,
  estimateHead = 40,
  className,
  label,
  findScroller,
}: AgendaListProps & { findScroller(element: HTMLElement): HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current) setScroller(findScroller(ref.current));
  }, [findScroller]);
  const scrollMargin = useOffsetWithin(ref, scroller);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => (items[index]?.kind === 'head' ? estimateHead : estimateRow),
    overscan: 6,
    scrollMargin,
    getItemKey: (index) => items[index]?.key ?? index,
  });
  return (
    <div ref={ref} className={className} role="region" aria-label={label}>
      <VirtualBody
        virtualizer={virtualizer}
        items={items}
        listKey={listKey}
        renderRow={renderRow}
        renderHead={renderHead}
        scrollMargin={scrollMargin}
      />
    </div>
  );
}
