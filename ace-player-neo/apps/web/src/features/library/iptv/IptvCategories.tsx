/* Categorías del proveedor en la pestaña IPTV (docs/iptv.md §16.6): primero
   «Todos los canales» y luego las del proveedor en su orden, cada una con su
   número de canales. Son botones en una lista (nombre accesible «{Categoría},
   {n} canales»); al volver de una, el foco vuelve a ella (`data-cat`).

   No va virtualizada: una lista de 27 687 canales trae unos pocos cientos de
   categorías, y así el foco siempre encuentra su botón. */

import type { IptvCategory } from '@ace/shared';
import { Num, Skeleton } from '../../../ui/index.ts';
import { ALL_CATEGORY, categoryName } from './model.ts';
import { categoryLabel, channelsText, formatCount, IPTV_TAB_TEXT } from './texts.ts';

export interface IptvCategoryListProps {
  categories: readonly IptvCategory[];
  /** «Todos los canales» con su número, delante (solo en la raíz sin texto). */
  all?: number | null;
  label: string;
  onOpen(id: string): void;
}

function CategoryButton({
  id,
  name,
  count,
  onOpen,
}: {
  id: string;
  name: string;
  count: number;
  onOpen(id: string): void;
}) {
  return (
    <button
      type="button"
      className="iptv-cat press"
      data-cat={id}
      aria-label={categoryLabel(name, count)}
      onClick={() => onOpen(id)}
    >
      <span className="iptv-cat__name">{name}</span>
      <Num className="iptv-cat__count" value={formatCount(count)} label={channelsText(count)} />
      <span className="iptv-cat__chev" aria-hidden="true" />
    </button>
  );
}

export function IptvCategoryList({ categories, all = null, label, onOpen }: IptvCategoryListProps) {
  return (
    <ul className="lib-list iptv-cats" aria-label={label}>
      {all !== null ? (
        <li className="lib-row iptv-cats__row iptv-cats__row--all">
          <CategoryButton
            id={ALL_CATEGORY}
            name={IPTV_TAB_TEXT.allChannels}
            count={all}
            onOpen={onOpen}
          />
        </li>
      ) : null}
      {categories.map((category) => (
        <li key={category.id} className="lib-row iptv-cats__row">
          <CategoryButton
            id={category.id}
            name={categoryName(category.id, category.name)}
            count={category.count}
            onOpen={onOpen}
          />
        </li>
      ))}
    </ul>
  );
}

/** Esqueletos de categoría mientras llega la raíz. */
export function IptvCategorySkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="lib-list iptv-cats" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{IPTV_TAB_TEXT.loading}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="iptv-cat iptv-cat--skeleton" aria-hidden="true">
          <Skeleton width={`${46 + ((index * 17) % 30)}%`} height={15} />
          <Skeleton width={42} height={14} />
        </div>
      ))}
    </div>
  );
}
