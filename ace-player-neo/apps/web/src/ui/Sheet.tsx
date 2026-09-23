/* Hoja / modal. Sustituye a los 8 modales de la 0.6.59 (inventario §0).

   - Móvil: hoja que sube desde abajo, con asa para cerrarla deslizando hacia
     abajo y la botonera fija abajo (por encima del teclado: --kb).
   - Desde 768 px: diálogo centrado (`placement="auto"`) o panel a la derecha
     (`placement="side"`).
   - Accesibilidad: role="dialog" + aria-modal, título enlazado, trampa de foco,
     Escape y toque en el velo para cerrar (si `dismissible`), el resto de la
     app `inert` y el foco vuelve a donde estaba al cerrar.
   - Movimiento: entra y sale con transform + opacity (muelle estándar); se
     queda montada durante la salida y luego se desmonta. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { useSwipe } from '../lib/gestures.ts';
import { IconButton } from './Button.tsx';
import {
  focusableIn,
  isTopOverlay,
  overlayRoot,
  popOverlay,
  pushOverlay,
  trapTab,
} from './overlay.ts';
import './Sheet.css';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  /** Título visible (y nombre accesible del diálogo). */
  title: string;
  /** Oculta el título a la vista, pero sigue nombrando el diálogo. */
  hideTitle?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  /** Botonera fija abajo (Guardar, Cancelar...). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  placement?: 'auto' | 'side';
  /** Qué enfocar al abrir; si no, el primer control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** false: ni Escape ni el velo la cierran (hace falta una acción explícita). */
  dismissible?: boolean;
  className?: string;
}

type Phase = 'closed' | 'entering' | 'open' | 'closing';

/** Lo que dura la salida antes de desmontar (el muelle estándar). */
function exitMs(): number {
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--dur-estandar')
      .trim();
    const ms = Number.parseFloat(value);
    return Number.isFinite(ms) ? ms : 520;
  } catch {
    return 520;
  }
}

export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  size = 'md',
  placement = 'auto',
  initialFocus,
  dismissible = true,
  className,
}: SheetProps) {
  const [phase, setPhase] = useState<Phase>(open ? 'entering' : 'closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const grabberRef = useRef<HTMLDivElement>(null);
  const overlayId = useRef<symbol | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  // Abrir y cerrar con su fase de animación.
  useEffect(() => {
    if (open) {
      setPhase((current) => (current === 'open' ? 'open' : 'entering'));
      const frame = requestAnimationFrame(() => setPhase('open'));
      return () => cancelAnimationFrame(frame);
    }
    setPhase((current) => (current === 'closed' ? 'closed' : 'closing'));
    const timer = window.setTimeout(() => setPhase('closed'), exitMs());
    return () => window.clearTimeout(timer);
  }, [open]);

  // Montada desde el mismo render en que se pide abrir (así el foco inicial
  // encuentra el panel) y durante la salida.
  const mounted = open || phase !== 'closed';
  const state: Phase = open
    ? phase === 'open'
      ? 'open'
      : 'entering'
    : phase === 'closed'
      ? 'closed'
      : 'closing';

  // Pila de capas, foco inicial y devolución del foco. Va atado a `open` y no
  // a la fase: al pedir el cierre el foco vuelve AL MOMENTO y la app deja de
  // estar inert, aunque la hoja siga unos milisegundos animando su salida.
  useLayoutEffect(() => {
    if (!open) {
      // El foco vuelve aquí (fase de layout) y no en la limpieza de abajo:
      // React, al terminar las mutaciones del commit, vuelve a enfocar lo que
      // tenía el foco antes (el campo de la hoja, que sigue en el DOM durante
      // la animación de salida) y pisaría un focus() hecho en la limpieza.
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
      return;
    }
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = pushOverlay(true);
    overlayId.current = id;
    const panel = panelRef.current;
    if (panel) {
      const target =
        initialFocus?.current ?? focusableIn(panel).find((el) => !el.dataset.sheetClose) ?? panel;
      target.focus({ preventScroll: true });
    }
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      popOverlay(id);
      overlayId.current = null;
      html.style.overflow = previousOverflow;
      // Si se desmonta abierta no habrá rama «cerrada»: el foco se devuelve en
      // cuanto React termine el commit.
      queueMicrotask(() => {
        const back = returnFocus.current;
        returnFocus.current = null;
        if (back?.isConnected) back.focus({ preventScroll: true });
      });
    };
    // initialFocus se lee una sola vez, al abrir.
  }, [open]);

  useSwipe(grabberRef, {
    axis: 'y',
    enabled: mounted && dismissible,
    threshold: 72,
    onMove: (_dx, dy) => {
      if (panelRef.current) panelRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    },
    onSwipe: (direction) => {
      if (panelRef.current) panelRef.current.style.transform = '';
      if (direction === 'down') latestClose.current();
    },
    onCancel: () => {
      if (panelRef.current) panelRef.current.style.transform = '';
    },
  });

  if (!mounted) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const id = overlayId.current;
    if (!id || !isTopOverlay(id)) return;
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      latestClose.current();
      return;
    }
    if (panelRef.current) trapTab(event, panelRef.current);
  };

  return createPortal(
    <div
      className={cx('sheet-layer', `sheet-layer--${placement}`)}
      data-state={state}
      onKeyDown={onKeyDown}
    >
      <div
        className="sheet-scrim"
        aria-hidden="true"
        onClick={() => {
          if (dismissible) latestClose.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx('sheet', `sheet--${size}`, className)}
      >
        <div ref={grabberRef} className="sheet__grabber" aria-hidden="true">
          <span />
        </div>
        <header className={cx('sheet__head', hideTitle && 'sheet__head--hidden')}>
          <h2 id={titleId} className={cx('sheet__title', hideTitle && 'sr-only')}>
            {title}
          </h2>
          {dismissible ? (
            <IconButton
              icon="x"
              label="Cerrar"
              data-sheet-close="1"
              onClick={() => latestClose.current()}
            />
          ) : null}
        </header>
        {description ? (
          <div id={descriptionId} className="sheet__description">
            {description}
          </div>
        ) : null}
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </div>,
    overlayRoot(),
  );
}
