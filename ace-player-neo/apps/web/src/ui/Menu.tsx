/* Menú contextual y menú de «Más opciones».

   - Se abre anclado a un botón (MenuButton) o en un punto (clic derecho o
     pulsación larga, con useContextMenu).
   - role="menu" con elementos role="menuitem" (o menuitemcheckbox si llevan
     `checked`). Flechas arriba/abajo, Inicio/Fin y la primera letra mueven el
     foco; Intro o Espacio eligen; Escape o un clic fuera cierran y el foco
     vuelve a quien abrió el menú.
   - Se coloca con position: fixed dentro de la pantalla (y de las zonas
     seguras): si no cabe debajo, sale encima.
   - Cristal casi opaco (va sobre listas). */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { IconButton, type IconButtonProps } from './Button.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { overlayRoot, popOverlay, pushOverlay } from './overlay.ts';
import './Menu.css';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onSelect(): void;
  disabled?: boolean;
  /** Acción que borra o corta: en rojo. */
  danger?: boolean;
  /** Tecla que hace lo mismo, para enseñarla a la derecha. */
  shortcut?: string;
  /** Opción marcable (menuitemcheckbox). */
  checked?: boolean;
  /** Línea de separación antes de este elemento. */
  separated?: boolean;
}

export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface MenuProps {
  open: boolean;
  onClose(): void;
  anchor: MenuAnchor | null;
  /** Nombre del menú para lectores de pantalla. */
  label: string;
  items: ReadonlyArray<MenuItem>;
}

const MARGIN = 8;

/** Posición dentro de la pantalla (pura, para poder probarla). */
export function placeMenu(
  anchor: { left: number; top: number; bottom: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  fromPoint: boolean,
): { left: number; top: number } {
  let left = fromPoint ? anchor.left : anchor.right - size.width;
  let top = fromPoint ? anchor.top : anchor.bottom + 6;
  if (top + size.height > viewport.height - MARGIN) {
    top = fromPoint ? anchor.top - size.height : anchor.top - size.height - 6;
  }
  left = Math.min(Math.max(MARGIN, left), viewport.width - size.width - MARGIN);
  top = Math.min(Math.max(MARGIN, top), viewport.height - size.height - MARGIN);
  return { left: Math.round(left), top: Math.round(top) };
}

export function Menu({ open, onClose, anchor, label, items }: MenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  const enabledItems = useCallback(
    () => [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ],
    [],
  );

  // Colocar, apuntar la capa y enfocar el primer elemento al abrir.
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPosition(null);
      return;
    }
    const list = listRef.current;
    if (!list) return;
    const fromPoint = !(anchor instanceof HTMLElement);
    const rect =
      anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    // Tamaño de maquetación (offsetWidth), no getBoundingClientRect: al abrir
    // el menú aún está en scale(0.96) y mediría un 4 % menos, así que en el
    // móvil se salía por el borde derecho al ajustarlo a la pantalla.
    const box = { width: list.offsetWidth, height: list.offsetHeight };
    setPosition(
      placeMenu(
        rect,
        { width: box.width || 220, height: box.height || 44 * items.length },
        { width: window.innerWidth, height: window.innerHeight },
        fromPoint,
      ),
    );
    returnFocus.current =
      anchor instanceof HTMLElement
        ? anchor
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    const id = pushOverlay(false);
    enabledItems()[0]?.focus({ preventScroll: true });
    return () => {
      popOverlay(id);
      const back = returnFocus.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open, anchor, items.length, enabledItems]);

  // Clic o toque fuera: cierra.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (listRef.current && event.target instanceof Node && listRef.current.contains(event.target))
        return;
      latestClose.current();
    };
    const onScrollOrResize = () => latestClose.current();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (!open || !anchor) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = enabledItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = list[(index + 1) % list.length];
    else if (event.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list.at(-1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      latestClose.current();
      return;
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      next =
        list.find(
          (el, i) => i > index && el.textContent?.trim().toLowerCase().startsWith(letter),
        ) ?? list.find((el) => el.textContent?.trim().toLowerCase().startsWith(letter));
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    latestClose.current();
    item.onSelect();
  };

  return createPortal(
    <div
      ref={listRef}
      role="menu"
      aria-label={label}
      className="menu glass glass--dense"
      data-ready={position ? 'true' : 'false'}
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: -9999 }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cx('menu__row', item.separated && 'menu__row--sep')}
          role="none"
        >
          <button
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className={cx('menu__item', item.danger && 'menu__item--danger')}
            onClick={() => select(item)}
          >
            {item.icon ? <Icon name={item.icon} size={20} /> : <span className="menu__icon-gap" />}
            <span className="menu__label">{item.label}</span>
            {item.checked ? <Icon name="check" size={18} className="menu__check" /> : null}
            {item.shortcut ? <kbd className="menu__kbd">{item.shortcut}</kbd> : null}
          </button>
        </div>
      ))}
    </div>,
    overlayRoot(),
  );
}

/** Botón «Más opciones» con su menú. */
export function MenuButton({
  items,
  menuLabel,
  icon = 'more',
  ...buttonProps
}: Omit<IconButtonProps, 'icon' | 'onClick'> & {
  icon?: IconName;
  items: ReadonlyArray<MenuItem>;
  menuLabel?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        {...buttonProps}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor((current) => (current ? null : event.currentTarget))}
      />
      <Menu
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        label={menuLabel ?? buttonProps.label}
        items={items}
      />
    </>
  );
}

/**
 * Menú contextual: clic derecho con ratón y pulsación larga (500 ms) con el
 * dedo. Devuelve los manejadores para el elemento y el estado del menú.
 */
export function useContextMenu(longPressMs = 500) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  const bind = {
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      clear();
      setPoint({ x: event.clientX, y: event.clientY });
    },
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') return;
      start.current = { x: event.clientX, y: event.clientY };
      const at = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setPoint(at);
      }, longPressMs);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const from = start.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };

  return {
    bind,
    menu: { open: point !== null, anchor: point, onClose: () => setPoint(null) },
  };
}
