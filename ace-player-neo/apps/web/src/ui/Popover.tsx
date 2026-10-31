/* Popover: una tarjeta pequeña anclada a lo que se ha pulsado (rediseño de
   escritorio: el programa de la Guía y la campana de avisos).

   - NO es modal: el resto de la app sigue viva (se puede pulsar otro programa
     sin cerrar antes). Escape, un clic fuera o desplazar lo de debajo lo
     cierran, y el foco vuelve a quien lo tenía al abrir.
   - Al abrir se enfoca la propia tarjeta (Tab llega a sus botones).
   - `position: fixed` dentro de la pantalla: debajo de lo pulsado y, si no
     cabe, encima. `align` dice si se alinea por la izquierda (un programa) o
     por la derecha (la campana, en la esquina).
   - Superficie opaca con su filo de 1 px: nada de cristal en la navegación. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { overlayRoot } from './overlay.ts';
import './Popover.css';

export interface PopoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverProps {
  open: boolean;
  /** Lo pulsado (su rectángulo se lee al abrir) o un rectángulo ya medido. */
  anchor: HTMLElement | PopoverRect | null;
  onClose(): void;
  /** Nombre del diálogo para lectores de pantalla. */
  label: string;
  align?: 'start' | 'end';
  /** Separación horizontal desde el borde de lo pulsado (un programa largo: no tapar su título). */
  inset?: number;
  className?: string;
  children: ReactNode;
}

const MARGIN = 8;
const GAP = 8;

/** Dónde va la tarjeta (pura, para poder probarla). */
export function placePopover(
  anchor: PopoverRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'start' | 'end' = 'start',
  inset = 0,
): { left: number; top: number; above: boolean } {
  let left = align === 'end' ? anchor.right - size.width : anchor.left + inset;
  let top = anchor.bottom + GAP;
  let above = false;
  if (top + size.height > viewport.height - MARGIN && anchor.top - GAP - size.height >= MARGIN) {
    top = anchor.top - GAP - size.height;
    above = true;
  }
  left = Math.min(Math.max(MARGIN, left), viewport.width - size.width - MARGIN);
  top = Math.min(Math.max(MARGIN, top), viewport.height - size.height - MARGIN);
  return { left: Math.round(left), top: Math.round(top), above };
}

function rectOf(anchor: HTMLElement | PopoverRect): PopoverRect {
  return anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
}

export function Popover({
  open,
  anchor,
  onClose,
  label,
  align = 'start',
  inset = 0,
  className,
  children,
}: PopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const returnFocus = useRef<HTMLElement | null>(null);
  const anchorNode = anchor instanceof HTMLElement ? anchor : null;

  // Colocar al abrir (y si cambia lo pulsado) y enfocar la tarjeta.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!open || !anchor || !box) {
      setPlace(null);
      return;
    }
    if (!box.contains(document.activeElement))
      returnFocus.current = document.activeElement as HTMLElement | null;
    setPlace(
      placePopover(
        rectOf(anchor),
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
        inset,
      ),
    );
    box.focus({ preventScroll: true });
  }, [open, anchor, align, inset]);

  // Escape, clic fuera y desplazar lo de debajo cierran.
  useEffect(() => {
    if (!open) return;
    const close = () => latestClose.current();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || boxRef.current?.contains(target) || anchorNode?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && boxRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, anchorNode]);

  // Al cerrar, el foco vuelve (si se había quedado dentro o se perdió).
  useEffect(() => {
    if (open) return;
    const back = returnFocus.current;
    returnFocus.current = null;
    const active = document.activeElement;
    if (back?.isConnected && (!active || active === document.body))
      back.focus({ preventScroll: true });
  }, [open]);

  if (!open || !anchor) return null;
  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cx('popover', place?.above && 'popover--above', className)}
      style={
        place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    overlayRoot(),
  );
}
