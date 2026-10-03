/* Las filas de la portada de Películas y series, «como la agenda» (sus filas
   por competición, AgendaList.tsx): una cabecera con el nombre, cuántos
   títulos tiene y «Ver todo ›», y un carrusel (PosterRail) de carteles
   grandes.

   - «Novedades en películas» / «Series actualizadas» llegan con la portada.
   - Una fila por categoría del proveedor, en su orden (los proveedores ya
     ordenan con intención: «ESTRENOS», «4K», «NETFLIX»…). Cada fila pide sus
     20 últimas (`vodBrowse` con `limit: 20`) SOLO cuando se acerca a la
     pantalla (IntersectionObserver): con decenas de categorías no se piden
     decenas de páginas ni cientos de carteles de golpe. */

import type { VodCard, VodCategory, VodKind } from '@ace/shared';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Num, PosterRail, Skeleton } from '../../ui/index.ts';
import { rememberCards, useCategoryRow } from './data.ts';
import { PosterCard } from './PosterCard.tsx';
import { CINE_TEXT, formatCount, seeRowLabel } from './texts.ts';

/** Cuánto antes de llegar a la pantalla se pide una fila (una pantalla de margen). */
export const ROW_PREFETCH_MARGIN = '600px 0px';

/**
 * ¿Ha llegado ya el elemento cerca de la pantalla? Una vez que sí, se queda en
 * sí. Sin IntersectionObserver (navegadores viejos, pruebas), sí desde el
 * principio.
 */
export function useNearScreen<T extends Element>(
  margin = ROW_PREFETCH_MARGIN,
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (near) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near];
}

interface RowHeadProps {
  id: string;
  title: string;
  /** Número de títulos (null = no se sabe). */
  count: number | null;
  kind: VodKind;
  onSeeAll?(): void;
}

/** «VOD | 4K 9 ……… Ver todo ›». */
function RowHead({ id, title, count, kind, onSeeAll }: RowHeadProps) {
  return (
    <div className="cine-row__head">
      <h2 id={id} className="cine-row__title">
        <span className="cine-row__name">{title}</span>
        {count !== null ? (
          <Num
            className="cine-row__count"
            value={formatCount(count)}
            condensed={false}
            label={`${formatCount(count)} ${kind === 'movie' ? 'películas' : 'series'}`}
          />
        ) : null}
      </h2>
      {onSeeAll ? (
        <Button
          variant="ghost"
          size="sm"
          trailingIcon="chev-r"
          className="cine-row__all"
          aria-label={
            count !== null ? seeRowLabel(title, count, kind) : `${CINE_TEXT.seeAllRow}: ${title}`
          }
          onClick={onSeeAll}
        >
          {CINE_TEXT.seeAllRow}
        </Button>
      ) : null}
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="cine-row__skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="cine-row__ghost">
          <Skeleton className="cine-row__ghost-poster" radius="m" />
          <Skeleton height={14} width="80%" />
        </span>
      ))}
    </div>
  );
}

function Rail({ label, cards }: { label: string; cards: readonly VodCard[] }) {
  return (
    <PosterRail label={label} list className="cine-rail">
      {cards.map((card) => (
        <PosterCard key={card.id} card={card} />
      ))}
    </PosterRail>
  );
}

export interface CardRowProps {
  id: string;
  title: string;
  kind: VodKind;
  cards: readonly VodCard[];
  count?: number | null;
  onSeeAll?(): void;
}

/** Una fila con sus tarjetas ya sabidas («Novedades en películas»). */
export function CardRow({ id, title, kind, cards, count = null, onSeeAll }: CardRowProps) {
  if (cards.length === 0) return null;
  return (
    <section className="cine-row" aria-labelledby={id}>
      <RowHead id={id} title={title} count={count} kind={kind} onSeeAll={onSeeAll} />
      <Rail label={title} cards={cards} />
    </section>
  );
}

export interface CategoryRowProps {
  category: VodCategory;
  active: boolean;
  onSeeAll(): void;
}

/** La fila de una categoría: se pide al acercarse a la pantalla. */
export function CategoryRail({ category, active, onSeeAll }: CategoryRowProps) {
  const [ref, near] = useNearScreen<HTMLElement>();
  const row = useCategoryRow(category.kind, category.id, active && near);
  const cards = row.data?.items ?? [];
  useEffect(() => {
    if (row.data) rememberCards(row.data.items);
  }, [row.data]);
  const id = `cine-fila-${category.id}`;
  let body: ReactNode;
  if (row.data) body = cards.length ? <Rail label={category.name} cards={cards} /> : null;
  else if (row.isError)
    body = (
      <div className="cine-row__failed" role="alert">
        <p>{CINE_TEXT.rowFailed}</p>
        <Button variant="quiet" size="sm" icon="refresh" onClick={() => void row.refetch()}>
          {CINE_TEXT.retry}
        </Button>
      </div>
    );
  else body = <RailSkeleton />;
  /* Una categoría que resulta vacía no deja una cabecera huérfana. */
  if (row.data && cards.length === 0) return null;
  return (
    <section ref={ref} className="cine-row" aria-labelledby={id} data-cat={category.id}>
      <RowHead
        id={id}
        title={category.name}
        count={row.data?.total ?? category.count}
        kind={category.kind}
        onSeeAll={onSeeAll}
      />
      {body}
    </section>
  );
}
