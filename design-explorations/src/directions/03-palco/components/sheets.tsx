/* Hojas y menús de Palco. En web: diálogo centrado. En iPhone: hoja inferior
   con asa y arrastre para cerrar (SwiftUI: sheet con detents). */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import type { Source } from '../../../core/types';
import { SHORTCUT_TABLE } from '../../../core/keys';
import { Button, Kbd, TextField } from './primitives';
import { Icon, type IconName } from './icons';
import { REPORT_REASONS, detectContentId } from './text';
import { useReducedMotion, copyText } from './hooks';
import { simulate } from './player';
import { haptic } from './haptics';

export type SheetMode = 'web' | 'iphone';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  mode: SheetMode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  footer?: ReactNode;
  className?: string;
  /** Sin cabecera propia (para menús). */
  bare?: boolean;
}

export function Sheet({ open, onClose, title, eyebrow, children, mode, size = 'md', footer, className, bare }: SheetProps) {
  const rm = useReducedMotion();
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) {
      haptic('light');
      onClose();
    }
  };

  // En el iPhone la hoja se monta en la raíz de la pantalla: el escenario se escala al
  // arrastrarlo (crea su propio contexto de apilamiento) y la hoja debe quedar por encima
  // de la barra flotante y del mini pase lo que pase.
  const host = mode === 'iphone' && typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.pl-ip') : null;
  const tree = (
    <AnimatePresence>
      {open && (
        <motion.div className={`pl-sheetwrap pl-sheetwrap--${mode}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: rm ? 0.1 : 0.2 }}>
          <button type="button" className="pl-sheetwrap__veil" aria-label="Cerrar" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`pl-sheet pl-sheet--${mode} pl-sheet--${size}${bare ? ' pl-sheet--bare' : ''} ${className ?? ''}`}
            initial={mode === 'iphone' ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 10 }}
            animate={mode === 'iphone' ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={mode === 'iphone' ? { y: '100%' } : { opacity: 0, scale: 0.98, y: 6 }}
            transition={rm ? { duration: 0.12 } : mode === 'iphone' ? { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } : { duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            drag={mode === 'iphone' ? 'y' : false}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            {mode === 'iphone' && <div className="pl-sheet__handle" onPointerDown={(e) => controls.start(e)} />}
            {!bare && (
              <header className="pl-sheet__head" onPointerDown={mode === 'iphone' ? (e) => controls.start(e) : undefined}>
                <div>
                  {eyebrow && <span className="pl-sheet__eyebrow">{eyebrow}</span>}
                  {title && <h2 className="pl-sheet__title">{title}</h2>}
                </div>
                <button type="button" className="pl-sheet__close" aria-label="Cerrar" onClick={onClose}>
                  <Icon name="x" size={18} />
                </button>
              </header>
            )}
            <div className="pl-sheet__body">{children}</div>
            {footer && <footer className="pl-sheet__foot">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return host ? createPortal(tree, host) : tree;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  hint?: string;
  run: () => void;
  disabled?: boolean;
}

/** Menú de acciones (hoja en iPhone, lista en web). */
export function ActionMenu({ open, onClose, mode, title, items, eyebrow }: { open: boolean; onClose: () => void; mode: SheetMode; title?: string; items: MenuItem[]; eyebrow?: string }) {
  return (
    <Sheet open={open} onClose={onClose} mode={mode} size="sm" title={title} eyebrow={eyebrow} bare={!title}>
      <ul className="pl-menu">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              className={`pl-menu__item${it.danger ? ' is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                haptic(it.danger ? 'rigid' : 'selection');
                onClose();
                it.run();
              }}
            >
              {it.icon && <Icon name={it.icon} size={18} />}
              <span className="pl-menu__text">
                <span>{it.label}</span>
                {it.hint && <span className="pl-menu__hint">{it.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {mode === 'iphone' && (
        <Button variant="quiet" block onClick={onClose} className="pl-menu__cancel">
          Cancelar
        </Button>
      )}
    </Sheet>
  );
}

/** Reportar fuente: 5 motivos. */
export function ReportSheet({ open, onClose, mode, source, onReport }: { open: boolean; onClose: () => void; mode: SheetMode; source: Source | null; onReport: (reason: string) => void }) {
  const [reason, setReason] = useState(REPORT_REASONS[0].id);
  useEffect(() => {
    if (open) setReason(REPORT_REASONS[0].id);
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      mode={mode}
      title="Reportar esta fuente"
      eyebrow={source?.title}
      footer={
        <Button
          variant="gold"
          block
          icon="flag"
          onClick={() => {
            haptic('success');
            onReport(reason);
            onClose();
          }}
        >
          Reportar y apartar
        </Button>
      }
    >
      <ul className="pl-radios" role="radiogroup" aria-label="Motivo">
        {REPORT_REASONS.map((r) => (
          <li key={r.id}>
            <button type="button" role="radio" aria-checked={reason === r.id} className={`pl-radio${reason === r.id ? ' is-on' : ''}`} onClick={() => { if (reason !== r.id) haptic('selection'); setReason(r.id); }}>
              <span className="pl-radio__mark" />
              <span className="pl-radio__text">
                <span>{r.label}</span>
                <span className="pl-radio__hint">{r.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="pl-sheet__note">La fuente se aparta un rato y se vuelve a comprobar en segundo plano. Si estaba en pantalla, pasamos a la siguiente.</p>
    </Sheet>
  );
}

/** Pegar Content ID: campo con detección + pegar del portapapeles. */
export function PasteSheet({ open, onClose, mode, onPlay }: { open: boolean; onClose: () => void; mode: SheetMode; onPlay: (hash: string) => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const id = detectContentId(text);
  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => ref.current?.focus(), 80);
    }
  }, [open]);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
    } catch {
      setText('');
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      mode={mode}
      title="Pegar un Content ID"
      eyebrow="Fuente externa · solo para esta sesión"
      footer={
        <Button
          variant="gold"
          block
          icon="play"
          disabled={!id}
          onClick={() => {
            if (id) {
              haptic('success');
              onPlay(id);
              onClose();
            }
          }}
        >
          Reproducir
        </Button>
      }
    >
      <TextField ref={ref} mono icon="link" placeholder="acestream://… o 40 caracteres" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off" trailing={text ? <button type="button" className="pl-field__clear" aria-label="Borrar" onClick={() => setText('')}><Icon name="x" size={14} /></button> : undefined} />
      <div className="pl-paste__row">
        <Button variant="quiet" size="sm" icon="paste" onClick={paste}>
          Pegar del portapapeles
        </Button>
        {text && (
          <span className={`pl-paste__detect${id ? ' is-ok' : ''}`}>
            {id ? (
              <>
                <Icon name="check" size={14} /> Enlace detectado
              </>
            ) : (
              <>
                <Icon name="warning" size={14} /> No parece un enlace de AceStream
              </>
            )}
          </span>
        )}
      </div>
      <p className="pl-sheet__note">Sirve un enlace acestream:// o el identificador de 40 caracteres. No se guarda ni se vincula al canal.</p>
    </Sheet>
  );
}

/** «Abrir en…»: AceStream / VLC / copiar enlace. */
export function openInItems(source: Source | null): MenuItem[] {
  return [
    { id: 'ace', label: 'Abrir en la app de AceStream', icon: 'external', run: () => simulate('acestream') },
    { id: 'vlc', label: 'Abrir en VLC', icon: 'external', hint: 'Solo en la misma red', run: () => simulate('vlc') },
    {
      id: 'copy',
      label: 'Copiar enlace',
      icon: 'copy',
      run: async () => {
        if (source) await copyText(`acestream://${source.id}`);
        simulate('copy');
      },
    },
  ];
}

/** Ayuda de atajos (web). */
export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = Array.from(new Set(SHORTCUT_TABLE.map((s) => s.group)));
  return (
    <Sheet open={open} onClose={onClose} mode="web" title="Atajos de teclado" eyebrow="No actúan mientras escribes" size="md">
      <div className="pl-help">
        {groups.map((g) => (
          <section key={g} className="pl-help__group">
            <h3>{g}</h3>
            <ul>
              {SHORTCUT_TABLE.filter((s) => s.group === g).map((s) => (
                <li key={s.keys}>
                  <span>{s.label}</span>
                  <span className="pl-help__keys">
                    {s.keys.split(' · ').map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="pl-help__group">
          <h3>Ratón</h3>
          <ul>
            <li>
              <span>Pausa</span>
              <span className="pl-help__keys">
                <Kbd>clic en el vídeo</Kbd>
              </span>
            </li>
            <li>
              <span>Pantalla completa</span>
              <span className="pl-help__keys">
                <Kbd>doble clic</Kbd>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </Sheet>
  );
}

/** Renombrar canal. */
export function RenameSheet({ open, onClose, mode, title, onSave }: { open: boolean; onClose: () => void; mode: SheetMode; title: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setV(title);
      setTimeout(() => ref.current?.select(), 80);
    }
  }, [open, title]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      mode={mode}
      title="Renombrar canal"
      size="sm"
      footer={
        <Button
          variant="gold"
          block
          disabled={!v.trim()}
          onClick={() => {
            onSave(v.trim());
            onClose();
          }}
        >
          Guardar
        </Button>
      }
    >
      <TextField ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder="Nombre del canal" />
    </Sheet>
  );
}
