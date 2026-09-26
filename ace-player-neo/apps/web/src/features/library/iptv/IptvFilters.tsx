/* Filtros de la pestaña IPTV (docs/iptv.md §16.6): País, Idioma, Tipo,
   Deporte y Calidad, cada valor con cuántos canales tiene con lo demás que
   esté elegido (facetas). Se combinan: dentro de un filtro suman y entre
   filtros restan (lo cuenta el servidor).

   - Escritorio y tableta: a la vista, una línea por faceta con su nombre, los
     primeros valores (los elegidos siempre) y «Más…» con el resto en un menú
     con casillas. Deporte solo si tiene valores. «Quitar filtros» al final.
   - Móvil: una fila de chips con desplazamiento lateral (dentro de la fila,
     nunca de la página): «Filtros» abre la hoja; luego los elegidos con su ×
     y, sin nada elegido, los 4 tipos con más canales como atajo.

   Cada valor es un botón con `aria-pressed` y nombre «{Valor}, {n} canales»;
   cada faceta, un `role="group"` con su nombre. */

import type { IptvFacetName, IptvFacets, IptvFacetValue } from '@ace/shared';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Button, Chip, Menu, type MenuItem } from '../../../ui/index.ts';
import {
  facetLabel,
  FACET_NAMES,
  FACET_TITLE,
  hasFilters,
  NO_FILTERS,
  selectedValues,
  toggleFilter,
  topTypes,
  visibleFacetValues,
  type IptvFilters,
} from './model.ts';
import {
  facetValueLabel,
  filtersButtonLabel,
  formatCount,
  IPTV_TAB_TEXT,
  removeFilterLabel,
  seeAllCountries,
} from './texts.ts';

/** Valores a la vista por faceta en escritorio antes de «Más…». */
const DESKTOP_SHOWN: Record<IptvFacetName, number> = {
  country: 6,
  language: 5,
  type: 7,
  sport: 7,
  quality: 5,
};

export interface IptvFiltersProps {
  facets: IptvFacets | undefined;
  filters: IptvFilters;
  onChange(filters: IptvFilters): void;
}

/** Los valores que se enseñan de una faceta: los de la respuesta y los elegidos que no vinieron. */
export function facetValuesOf(
  facets: IptvFacets | undefined,
  filters: IptvFilters,
  facet: IptvFacetName,
): IptvFacetValue[] {
  const values = facets?.[facet] ?? [];
  const missing = filters[facet]
    .filter((value) => !values.some((v) => v.value === value))
    .map((value) => ({ value, count: 0, selected: true }));
  return [...values.map((v) => ({ ...v, selected: filters[facet].includes(v.value) })), ...missing];
}

function FacetChip({
  facet,
  value,
  onToggle,
}: {
  facet: IptvFacetName;
  value: IptvFacetValue;
  onToggle(): void;
}) {
  const label = facetLabel(facet, value.value);
  return (
    <Chip
      pressed={value.selected}
      count={value.count}
      label={facetValueLabel(label, value.count)}
      onClick={onToggle}
      className="iptv-chip"
    >
      {label}
    </Chip>
  );
}

/** Escritorio y tableta: los filtros a la vista, una línea por faceta. */
export function IptvFilterLines({ facets, filters, onChange }: IptvFiltersProps) {
  const baseId = useId();
  const [menu, setMenu] = useState<{ facet: IptvFacetName; anchor: HTMLElement } | null>(null);
  const lines = FACET_NAMES.map((facet) => ({
    facet,
    values: facetValuesOf(facets, filters, facet),
  })).filter((line) => line.values.length > 0);
  if (lines.length === 0) return null;
  const menuItems: MenuItem[] = menu
    ? facetValuesOf(facets, filters, menu.facet).map((value) => ({
        id: value.value,
        label: `${facetLabel(menu.facet, value.value)} · ${formatCount(value.count)}`,
        checked: value.selected,
        onSelect: () => onChange(toggleFilter(filters, menu.facet, value.value)),
      }))
    : [];
  return (
    <div className="iptv-lines">
      {lines.map(({ facet, values }) => {
        const titleId = `${baseId}-${facet}`;
        const { shown, hidden } = visibleFacetValues(values, DESKTOP_SHOWN[facet]);
        return (
          <div key={facet} className="iptv-line" role="group" aria-labelledby={titleId}>
            <span id={titleId} className="iptv-line__title">
              {FACET_TITLE[facet]}
            </span>
            <div className="iptv-line__values">
              {shown.map((value) => (
                <FacetChip
                  key={value.value}
                  facet={facet}
                  value={value}
                  onToggle={() => onChange(toggleFilter(filters, facet, value.value))}
                />
              ))}
              {hidden.length > 0 ? (
                <button
                  type="button"
                  className="chip chip--soft chip--button press iptv-more"
                  aria-haspopup="menu"
                  aria-expanded={menu?.facet === facet}
                  aria-label={`${IPTV_TAB_TEXT.more} ${FACET_TITLE[facet]}`}
                  onClick={(event) => {
                    const anchor = event.currentTarget;
                    setMenu((current) => (current?.facet === facet ? null : { facet, anchor }));
                  }}
                >
                  <span className="chip__label">{IPTV_TAB_TEXT.more}</span>
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {hasFilters(filters) ? (
        <div className="iptv-lines__foot">
          <Button variant="ghost" size="sm" icon="x" onClick={() => onChange(NO_FILTERS)}>
            {IPTV_TAB_TEXT.clearFilters}
          </Button>
        </div>
      ) : null}
      <Menu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        label={menu ? FACET_TITLE[menu.facet] : IPTV_TAB_TEXT.filters}
        items={menuItems}
      />
    </div>
  );
}

/** Que el deslizamiento lateral de la fila de chips no cambie de pestaña (useSwipe del panel). */
function useStopSwipe(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (event: PointerEvent) => event.stopPropagation();
    el.addEventListener('pointerdown', stop);
    return () => el.removeEventListener('pointerdown', stop);
  }, [ref]);
}

/** Móvil: la fila de chips bajo el campo. */
export function IptvFilterRow({
  facets,
  filters,
  onChange,
  onOpenSheet,
  sheetButtonRef,
}: IptvFiltersProps & {
  onOpenSheet(): void;
  sheetButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useStopSwipe(rowRef);
  const chosen = selectedValues(filters);
  const shortcuts = chosen.length === 0 ? topTypes(facets) : [];
  return (
    <div ref={rowRef} className="iptv-row" role="group" aria-label={IPTV_TAB_TEXT.filters}>
      <button
        ref={sheetButtonRef}
        type="button"
        className="chip chip--solid chip--button press iptv-row__open"
        aria-haspopup="dialog"
        aria-label={filtersButtonLabel(chosen.length)}
        onClick={onOpenSheet}
      >
        <span className="iptv-row__icon" aria-hidden="true" />
        <span className="chip__label">{IPTV_TAB_TEXT.filters}</span>
        {chosen.length > 0 ? (
          <span className="iptv-row__badge" aria-hidden="true">
            {chosen.length}
          </span>
        ) : null}
      </button>
      {chosen.map(({ facet, value, label }) => (
        <Chip
          key={`${facet}:${value}`}
          pressed
          label={removeFilterLabel(label)}
          onClick={() => onChange(toggleFilter(filters, facet, value))}
          className="iptv-chip iptv-chip--chosen"
        >
          {label}
          <span className="iptv-chip__x" aria-hidden="true">
            ×
          </span>
        </Chip>
      ))}
      {shortcuts.map((value) => (
        <FacetChip
          key={value.value}
          facet="type"
          value={value}
          onToggle={() => onChange(toggleFilter(filters, 'type', value.value))}
        />
      ))}
    </div>
  );
}

/** Países a la vista en la hoja antes de «Ver todos los países». */
const SHEET_COUNTRIES = 8;

/** Contenido de la hoja de filtros (móvil): una sección por faceta. */
export function IptvFilterSheetBody({ facets, filters, onChange }: IptvFiltersProps) {
  const baseId = useId();
  const [allCountries, setAllCountries] = useState(false);
  const [countryText, setCountryText] = useState('');
  return (
    <div className="iptv-sheet">
      {FACET_NAMES.map((facet) => {
        const values = facetValuesOf(facets, filters, facet);
        if (values.length === 0) return null;
        const titleId = `${baseId}-${facet}`;
        let list = values;
        let toggle: { label: string; onClick(): void } | null = null;
        if (facet === 'country') {
          if (allCountries) {
            const needle = countryText.trim().toLowerCase();
            list = needle
              ? values.filter(
                  (v) =>
                    v.selected ||
                    facetLabel('country', v.value).toLowerCase().includes(needle) ||
                    v.value.toLowerCase() === needle,
                )
              : values;
            toggle = { label: IPTV_TAB_TEXT.showLess, onClick: () => setAllCountries(false) };
          } else if (values.length > SHEET_COUNTRIES) {
            list = visibleFacetValues(values, SHEET_COUNTRIES).shown;
            toggle = {
              label: seeAllCountries(values.length),
              onClick: () => setAllCountries(true),
            };
          }
        }
        return (
          <section key={facet} className="iptv-sheet__facet">
            <h3 id={titleId} className="iptv-sheet__title">
              {FACET_TITLE[facet]}
            </h3>
            {facet === 'country' && allCountries ? (
              <label className="iptv-sheet__find">
                <span className="sr-only">{IPTV_TAB_TEXT.searchCountry}</span>
                <input
                  type="search"
                  className="iptv-sheet__input"
                  placeholder={IPTV_TAB_TEXT.searchCountry}
                  value={countryText}
                  autoComplete="off"
                  onChange={(event) => setCountryText(event.target.value)}
                />
              </label>
            ) : null}
            <div className="iptv-sheet__values" role="group" aria-labelledby={titleId}>
              {list.map((value) => (
                <FacetChip
                  key={value.value}
                  facet={facet}
                  value={value}
                  onToggle={() => onChange(toggleFilter(filters, facet, value.value))}
                />
              ))}
            </div>
            {toggle ? (
              <Button
                variant="ghost"
                size="sm"
                className="iptv-sheet__all"
                aria-expanded={allCountries}
                onClick={toggle.onClick}
              >
                {toggle.label}
              </Button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
