/* Categorías del proveedor (docs/vod.md §12.4):
   - en el móvil y la tableta, una hoja con la lista entera («Todas las
     categorías», desde la cabecera de la portada o desde la rejilla) y, en la
     rejilla, una fila de chips con desplazamiento para saltar de una a otra;
   - en escritorio (≥ 1024), la misma lista en el panel lateral (aside.tsx),
     con «Inicio» (la portada) delante.
   Las de adultos van al final (el servidor ya las ordena) con «+18». */

import type { VodCategory } from '@ace/shared';
import { cx } from '../../lib/cx.ts';
import { Chip, Icon, Num, Sheet } from '../../ui/index.ts';
import { CINE_TEXT, formatCount } from './texts.ts';

/** Chips a la vista en la fila de la rejilla (las demás, en la hoja). */
export const ROW_CATEGORIES_MAX = 12;

function categoryLabel(category: VodCategory): string {
  return `${category.name}${category.adult ? ` (${CINE_TEXT.adult})` : ''}, ${formatCount(category.count)}`;
}

export interface CategoryListProps {
  categories: readonly VodCategory[];
  /** La abierta: id, `all` (todas) o null (la portada). */
  value: string | null;
  onChange(id: string | null): void;
  /** Total de «Todas». */
  total?: number | null;
  /** «Inicio» delante (el panel lateral: vuelve a la portada). */
  withHome?: boolean;
  className?: string;
}

/** La lista entera, con «Todas» (y, en el panel, «Inicio») delante. */
export function CategoryList({
  categories,
  value,
  onChange,
  total,
  withHome = false,
  className,
}: CategoryListProps) {
  return (
    <ul className={cx('cine-cats', className)} aria-label={CINE_TEXT.categories}>
      {withHome ? (
        <li>
          <button
            type="button"
            className="cine-cat cine-cat--home press"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
          >
            <Icon name="cine" size={20} />
            <span className="cine-cat__name">{CINE_TEXT.home}</span>
          </button>
        </li>
      ) : null}
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

export interface CategorySheetProps {
  open: boolean;
  onClose(): void;
  categories: readonly VodCategory[];
  value: string | null;
  onChange(id: string): void;
  total?: number | null;
}

/** «Todas las categorías» en una hoja (móvil y tableta). */
export function CategorySheet({
  open,
  onClose,
  categories,
  value,
  onChange,
  total,
}: CategorySheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={CINE_TEXT.allCategories} size="md">
      <CategoryList
        categories={categories}
        value={value}
        total={total}
        onChange={(id) => {
          onChange(id ?? 'all');
          onClose();
        }}
      />
    </Sheet>
  );
}

export interface CategoryChipsProps {
  categories: readonly VodCategory[];
  value: string | null;
  onChange(id: string): void;
}

/** La fila de chips de la rejilla: «Todas» y las primeras categorías (la elegida siempre a la vista). */
export function CategoryChips({ categories, value, onChange }: CategoryChipsProps) {
  if (categories.length === 0) return null;
  const first = categories.slice(0, ROW_CATEGORIES_MAX);
  const chosen = categories.find((category) => category.id === value);
  const row = chosen && !first.includes(chosen) ? [chosen, ...first] : first;
  return (
    <div className="cine-chips cine-chips--scroll" role="group" aria-label={CINE_TEXT.categories}>
      <Chip pressed={value === 'all' || value === null} onClick={() => onChange('all')}>
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
  );
}
