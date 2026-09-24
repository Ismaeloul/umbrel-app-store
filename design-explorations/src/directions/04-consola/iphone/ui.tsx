/* Consola · primitivas del iPhone: barra de navegación, listas planas con
   secciones plegables, filas de 44 pt, hoja inferior con detents (arrastrable),
   menú de acciones, segmentado nativo. Todo tiene equivalente directo en SwiftUI. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { back } from '../../../core/router';
import { Icon, type IconName } from '../components/icons';
import { Dot } from '../components/ui';
import { useReducedMotionPref, type DotTone } from '../components/lib';

// ---------------------------------------------------------------- Navegación

export function NavBar({ title, large = false, backLabel, right, left, subtitle }: { title: string; large?: boolean; backLabel?: string; right?: ReactNode; left?: ReactNode; subtitle?: string }) {
  return (
    <header className={`ip-nav ${large ? 'is-large' : ''}`}>
      <div className="ip-nav-row">
        <div className="ip-nav-side is-left">
          {backLabel !== undefined && (
            <button type="button" className="ip-nav-back" onClick={() => back()} aria-label="Atrás">
              <Icon name="chevron-left" size={18} strokeWidth={2} />
              <span className="co-truncate">{backLabel}</span>
            </button>
          )}
          {left}
        </div>
        <div className="ip-nav-title co-truncate">
          {!large && <span className="co-truncate">{title}</span>}
          {!large && subtitle && <span className="ip-nav-sub co-truncate">{subtitle}</span>}
        </div>
        <div className="ip-nav-side is-right">{right}</div>
      </div>
      {large && <h1 className="ip-large-title">{title}</h1>}
    </header>
  );
}

export function NavButton({ icon, label, onClick, on, tint }: { icon: IconName; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; on?: boolean; tint?: boolean }) {
  return (
    <button type="button" className={`ip-navbtn ${on ? 'is-on' : ''} ${tint ? 'is-tint' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={20} strokeWidth={1.7} />
    </button>
  );
}

// ---------------------------------------------------------------- Listas

export function Section({ title, count, collapsible, collapsed, onToggle, children, right, inset = false, footer }: { title?: ReactNode; count?: number | string; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void; children: ReactNode; right?: ReactNode; inset?: boolean; footer?: ReactNode }) {
  return (
    <section className={`ip-section ${inset ? 'is-inset' : ''}`}>
      {title !== undefined && (
        <div className="ip-section-head">
          {collapsible ? (
            <button type="button" className="ip-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
              <span className="ip-section-title">{title}</span>
              {count !== undefined && <span className="ip-section-count">{count}</span>}
              <Icon name="chevron-down" size={14} strokeWidth={2} className={`ip-section-chev ${collapsed ? 'is-collapsed' : ''}`} />
            </button>
          ) : (
            <div className="ip-section-toggle is-static">
              <span className="ip-section-title">{title}</span>
              {count !== undefined && <span className="ip-section-count">{count}</span>}
            </div>
          )}
          {right && <div className="ip-section-right">{right}</div>}
        </div>
      )}
      {!collapsed && <div className="ip-section-body">{children}</div>}
      {footer && !collapsed && <div className="ip-section-foot">{footer}</div>}
    </section>
  );
}

export function Row({ children, onClick, chevron, className, leading, trailing, title, subtitle, mono, active, danger, disabled }: { children?: ReactNode; onClick?: () => void; chevron?: boolean; className?: string; leading?: ReactNode; trailing?: ReactNode; title?: ReactNode; subtitle?: ReactNode; mono?: boolean; active?: boolean; danger?: boolean; disabled?: boolean }) {
  const Tag: 'button' | 'div' = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ip-row ${className ?? ''} ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`} onClick={onClick} disabled={disabled}>
      {leading !== undefined && <span className="ip-row-lead">{leading}</span>}
      <span className="ip-row-body">
        {title !== undefined && <span className={`ip-row-title co-truncate ${mono ? 'ip-mono' : ''}`}>{title}</span>}
        {subtitle !== undefined && <span className="ip-row-sub co-truncate">{subtitle}</span>}
        {children}
      </span>
      {trailing !== undefined && <span className="ip-row-trail">{trailing}</span>}
      {chevron && <Icon name="chevron-right" size={14} strokeWidth={2} className="ip-row-chev" />}
    </Tag>
  );
}

export function Value({ children, tone }: { children: ReactNode; tone?: DotTone }) {
  return (
    <span className="ip-value">
      {tone && <Dot tone={tone} />}
      {children}
    </span>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ip-toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number; disabled?: boolean }[]; ariaLabel?: string }) {
  return (
    <div className="ip-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={o.id === value ? 'is-on' : ''} onClick={() => onChange(o.id)} disabled={o.disabled}>
          {o.label}
          {o.count !== undefined && <span className="ip-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PillButton({ children, onClick, kind = 'default', icon, disabled, className, size }: { children?: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'tint' | 'danger'; icon?: IconName; disabled?: boolean; className?: string; size?: 'lg' }) {
  return (
    <button type="button" className={`ip-pill ip-pill--${kind} ${size ? `ip-pill--${size}` : ''} ${className ?? ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={16} strokeWidth={1.8} />}
      {children}
    </button>
  );
}

export function EmptyView({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="ip-empty">
      <Icon name={icon} size={36} strokeWidth={1.2} className="ip-empty-icon" />
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action && <div className="ip-empty-action">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Hoja inferior (sheet con detents)

export function BottomSheet({ title, onClose, children, footer, detent = 'medium', grabber = true }: { title?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; detent?: 'medium' | 'large' | 'auto'; grabber?: boolean }) {
  const reduced = useReducedMotionPref();
  const sysReduced = useReducedMotion();
  const rm = reduced || !!sysReduced;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <motion.div className="ip-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: rm ? 0.06 : 0.16 }} onClick={onClose} />
      <motion.div
        className={`ip-sheet is-${detent}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={rm ? { opacity: 0 } : { y: '100%' }}
        animate={rm ? { opacity: 1 } : { y: 0 }}
        exit={rm ? { opacity: 0 } : { y: '100%' }}
        transition={rm ? { duration: 0.06 } : { type: 'spring', stiffness: 420, damping: 40 }}
        drag={rm ? false : 'y'}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 100 || info.velocity.y > 600) onClose();
        }}
      >
        {grabber && <span className="ip-grabber" aria-hidden="true" />}
        {title && (
          <header className="ip-sheet-head">
            <span className="ip-sheet-title">{title}</span>
            <button type="button" className="ip-sheet-close" onClick={onClose} aria-label="Cerrar">
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          </header>
        )}
        <div className="ip-sheet-body">{children}</div>
        {footer && <footer className="ip-sheet-foot">{footer}</footer>}
      </motion.div>
    </>
  );
}

/** Menú de acciones (confirmationDialog / Menu): lista de botones en hoja. */
export interface ActionItem {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
}

export function ActionSheet({ title, items, onClose }: { title?: string; items: ActionItem[]; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose} detent="auto" grabber={false}>
      {title && <div className="ip-actions-title">{title}</div>}
      <div className="ip-actions">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`ip-action ${it.danger ? 'is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.run?.();
            }}
          >
            {it.icon && <Icon name={it.icon} size={18} strokeWidth={1.7} />}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="ip-action ip-action--cancel" onClick={onClose}>
        Cancelar
      </button>
    </BottomSheet>
  );
}

export function Sheets({ children }: { children: ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}

// ---------------------------------------------------------------- Deslizar para volver (borde izquierdo)

export function EdgeBack({ enabled }: { enabled: boolean }) {
  const reduced = useReducedMotionPref();
  if (!enabled) return null;
  return (
    <motion.div
      className="ip-edge"
      drag={reduced ? 'x' : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.15 }}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (info.offset.x > 70 || info.velocity.x > 500) back();
      }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------- Segundo toque en fila

export function useArmed(ms = 5000): [boolean, (run: () => void) => void] {
  const [armed, setArmed] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return [
    armed,
    (run) => {
      if (armed) {
        setArmed(false);
        if (t.current) clearTimeout(t.current);
        run();
      } else {
        setArmed(true);
        t.current = setTimeout(() => setArmed(false), ms);
      }
    },
  ];
}
