/* Hoja modal: en la web, panel centrado con marco de tinta; en el iPhone,
   hoja inferior con asa que se cierra arrastrando (motion drag="y").
   Esc la cierra (pila de `useEscapable`). Sin cristal: papel opaco. */

import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IcClose } from './icons';
import { IconKey, Key } from './Key';
import { useEscapable } from './hooks';
import type { Tone } from './text';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
  mode: 'web' | 'phone';
  wide?: boolean;
  /** Sin cabecera (para contenido que ya trae la suya). */
  bare?: boolean;
}

export function Sheet({ open, onClose, title, subtitle, children, footer, mode, wide, bare }: SheetProps) {
  useEscapable(open, onClose);
  const phone = mode === 'phone';
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  };
  /* La hoja se pinta en la raíz de la propuesta (portal): así no depende del
     desplazamiento de la página que la abre. */
  const host = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.tr-root') : null;
  const node = (
    <AnimatePresence>
      {open && (
        <motion.div className={`tr-sheet-wrap is-${mode}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <button type="button" className="tr-sheet-veil" aria-label="Cerrar" onClick={onClose} />
          <motion.div
            className={`tr-sheet${wide ? ' is-wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={phone ? { y: '100%' } : { y: 18, scale: 0.98, opacity: 0 }}
            animate={phone ? { y: 0 } : { y: 0, scale: 1, opacity: 1 }}
            exit={phone ? { y: '100%' } : { y: 12, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
            drag={phone ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={phone ? onDragEnd : undefined}
          >
            {phone && <div className="tr-sheet-handle" aria-hidden="true" />}
            {!bare && (
              <header className="tr-sheet-head">
                <div>
                  {title && <h2>{title}</h2>}
                  {subtitle && <p>{subtitle}</p>}
                </div>
                <IconKey label="Cerrar" icon={<IcClose />} size={40} variant="ghost" onClick={onClose} />
              </header>
            )}
            <div className="tr-sheet-body">{children}</div>
            {footer && <footer className="tr-sheet-foot">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return host ? createPortal(node, host) : node;
}

export interface SheetAction {
  label: string;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  run: () => void;
  disabled?: boolean;
}

/** Hoja de acciones (menú contextual). */
export function ActionSheet({ open, onClose, title, subtitle, actions, mode }: { open: boolean; onClose: () => void; title?: string; subtitle?: string; actions: SheetAction[]; mode: 'web' | 'phone' }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle} mode={mode}>
      <div className="tr-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`tr-action${a.tone ? ` tr-tone-${a.tone}` : ''}`}
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            {a.icon && <span className="tr-action-ic">{a.icon}</span>}
            <span className="tr-action-tx">
              <span>{a.label}</span>
              {a.hint && <small>{a.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Confirmación con dos teclas. */
export function ConfirmSheet({ open, onClose, title, text, confirm, onConfirm, mode, danger }: { open: boolean; onClose: () => void; title: string; text?: string; confirm: string; onConfirm: () => void; mode: 'web' | 'phone'; danger?: boolean }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      mode={mode}
      footer={
        <>
          <Key variant="ghost" onClick={onClose}>
            Cancelar
          </Key>
          <Key
            variant={danger ? 'danger' : 'orange'}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirm}
          </Key>
        </>
      }
    >
      {text && <p className="tr-sheet-text">{text}</p>}
    </Sheet>
  );
}
