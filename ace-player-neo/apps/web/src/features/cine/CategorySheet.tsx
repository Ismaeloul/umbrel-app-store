/* Categorías del proveedor (docs/vod.md §12.4): en el móvil y la tableta,
   una fila de chips con desplazamiento («Todas» y las categorías) y «Todas
   las categorías», que abre una hoja con la lista entera; en escritorio
   (≥ 1024), la misma lista en el panel lateral (aside.tsx). Las de adultos
   van al final (el servidor ya las ordena) con «+18». */

import type { VodCategory } from '@ace/shared';
import { useRef, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { Button, Chip, Num, Sheet } from '../../ui/index.ts';
import { CINE_TEXT, formatCount } from './texts.ts';

/** Chips a la vista en la fila antes de «Todas las categorías». */
export const ROW_CATEGORIES_MAX = 12;

function categoryLabel(category: VodCategory): string {
  return `${category.name}${category.adult ? ` (${CINE_TEXT.adult})` : ''}, ${formatCount(category.count)}`;
}

export interface CategoryListProps {
  categories: readonly VodCategory[];
  value: string;
  onChange(id: string): void;
  /** Total de «Todas» (sin adultos). */
  total?: number | null;
  className?: string;
}

/** La lista entera, con «Todas» delante (hoja y panel lateral). */
export function CategoryList({ categories, value, onChange, total, className }: CategoryListProps) {
  return (
    <ul className={cx('cine-cats', className)} aria-label={CINE_TEXT.categories}>
      <li>
        <button
          type="button"
          className="cine-cat press"
          aria-pressed={value === 'all'}
          onClick={() => onChange('all')}
        >
          <span className="cine-cat__name">{CINE_TEXT.all}</span>
          {total !== null && total !== undefined ? (
            <Num className="cine-cat__count" value={formatCount(total)} condensed={false} />
          ) : null}
        </button>
      </li>
      {categories.map((category) => (
        <li key={category.id}>
          <button
            type="button"
            className="cine-cat press"
            aria-pressed={value === category.id}
            aria-label={categoryLabel(category)}
            data-cat={category.id}
            onClick={() => onChange(category.id)}
          >
            <span className="cine-cat__name">{category.name}</span>
            {category.adult ? <span className="cine-cat__adult">{CINE_TEXT.adult}</span> : null}
            <Num
              className="cine-cat__count"
              value={formatCount(category.count)}
              condensed={false}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface CategoryRowProps {
  categories: readonly VodCategory[];
  value: string;
  onChange(id: string): void;
  total?: number | null;
}

/** Móvil y tableta: fila de chips y la hoja con todas. */
export function CategoryRow({ categories, value, onChange, total }: CategoryRowProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (categories.length === 0) return null;
  /* La elegida siempre a la vista, aunque esté más allá de las 12 primeras. */
  const first = categories.slice(0, ROW_CATEGORIES_MAX);
  const chosen = categories.find((category) => category.id === value);
  const row = chosen && !first.includes(chosen) ? [chosen, ...first] : first;
  return (
    <>
      <div className="cine-chips cine-chips--scroll" role="group" aria-label={CINE_TEXT.categories}>
        <Chip pressed={value === 'all'} onClick={() => onChange('all')}>
          {CINE_TEXT.all}
        </Chip>
        {row.map((category) => (
          <Chip
            key={category.id}
            pressed={value === category.id}
            label={categoryLabel(category)}
            onClick={() => onChange(category.id)}
          >
            {category.name}
          </Chip>
        ))}
      </div>
      <Button
        ref={button}
        variant="quiet"
        size="sm"
        icon="list"
        className="cine-allcats"
        onClick={() => setOpen(true)}
      >
        {CINE_TEXT.allCategories}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={CINE_TEXT.allCategories} size="md">
        <CategoryList
          categories={categories}
          value={value}
          total={total}
          onChange={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
