/* Control segmentado y pestañas: la misma pista con una «gota» que se desliza
   hasta la opción activa (solo transform). Columnas iguales, así la gota no
   necesita medir nada.

   - Segmented: elegir UNA opción que filtra o cambia un modo («Para ti» /
     «Todos», tema). role="radiogroup" + role="radio".
   - Tabs: cambiar el contenido de un panel («Favoritos» / «Recientes» /
     «Listas»). role="tablist" + role="tab" con aria-controls; el panel se
     marca con tabPanelProps().

   Teclado (patrón ARIA): flechas izquierda/derecha, Inicio y Fin mueven la
   selección y el foco; solo la opción activa entra en el orden de tabulación. */

import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Num } from './Num.tsx';
import './Segmented.css';

export interface SegmentItem<V extends string> {
  value: V;
  label: string;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
}

function nextIndex(
  current: number,
  key: string,
  items: ReadonlyArray<{ disabled?: boolean }>,
): number | null {
  const enabled = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);
  if (enabled.length === 0) return null;
  const position = enabled.indexOf(current);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return enabled[(position + 1) % enabled.length] ?? null;
    case 'ArrowLeft':
    case 'ArrowUp':
      return enabled[(position - 1 + enabled.length) % enabled.length] ?? null;
    case 'Home':
      return enabled[0] ?? null;
    case 'End':
      return enabled.at(-1) ?? null;
    default:
      return null;
  }
}

function useRovingKeys<V extends string>(
  items: ReadonlyArray<SegmentItem<V>>,
  value: V,
  onChange: (value: V) => void,
) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = items.findIndex((item) => item.value === value);
    const target = nextIndex(current, event.key, items);
    if (target === null) return;
    event.preventDefault();
    const item = items[target];
    if (!item) return;
    onChange(item.value);
    refs.current[target]?.focus();
  };
  return { refs, onKeyDown };
}

function trackStyle(count: number, index: number): CSSProperties {
  return { '--n': count, '--i': Math.max(0, index) } as CSSProperties;
}

function ItemContent({ item }: { item: SegmentItem<string> }) {
  return (
    <>
      {item.icon ? <Icon name={item.icon} size={18} /> : null}
      <span>{item.label}</span>
      {item.count !== undefined ? <Num className="seg__count" value={item.count} /> : null}
    </>
  );
}

export interface SegmentedProps<V extends string> {
  /** Nombre del grupo para lectores de pantalla. */
  label: string;
  /* NoInfer: el tipo de las opciones sale de `value` (el estado), no de los
     literales de `items`, que TypeScript ensancharía a string. */
  items: ReadonlyArray<SegmentItem<NoInfer<V>>>;
  value: V;
  onChange(value: NoInfer<V>): void;
  className?: string;
  /** `block`: ocupa todo el ancho. */
  block?: boolean;
}

export function Segmented<V extends string>({
  label,
  items,
  value,
  onChange,
  className,
  block,
}: SegmentedProps<V>) {
  const { refs, onKeyDown } = useRovingKeys(items, value, onChange);
  const active = items.findIndex((item) => item.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('seg', block && 'seg--block', className)}
      style={trackStyle(items.length, active)}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          tabIndex={item.value === value || (active < 0 && index === 0) ? 0 : -1}
          disabled={item.disabled}
          className="seg__item"
          onClick={() => onChange(item.value)}
          onKeyDown={onKeyDown}
        >
          <ItemContent item={item} />
        </button>
      ))}
    </div>
  );
}

export interface TabsProps<V extends string> extends SegmentedProps<V> {
  /** Prefijo de los ids: pestaña `${idPrefix}-tab-${value}` y panel `${idPrefix}-panel-${value}`. */
  idPrefix: string;
}

export function tabPanelProps(idPrefix: string, value: string) {
  return {
    role: 'tabpanel' as const,
    id: `${idPrefix}-panel-${value}`,
    'aria-labelledby': `${idPrefix}-tab-${value}`,
    tabIndex: 0,
  };
}

export function Tabs<V extends string>({
  label,
  items,
  value,
  onChange,
  idPrefix,
  className,
  block,
}: TabsProps<V>) {
  const { refs, onKeyDown } = useRovingKeys(items, value, onChange);
  const active = items.findIndex((item) => item.value === value);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx('seg', 'seg--tabs', block && 'seg--block', className)}
      style={trackStyle(items.length, active)}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.value}`}
          aria-selected={item.value === value}
          aria-controls={`${idPrefix}-panel-${item.value}`}
          tabIndex={item.value === value ? 0 : -1}
          disabled={item.disabled}
          className="seg__item"
          onClick={() => onChange(item.value)}
          onKeyDown={onKeyDown}
        >
          <ItemContent item={item} />
        </button>
      ))}
    </div>
  );
}
