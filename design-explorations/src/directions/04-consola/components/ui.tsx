/* Consola · primitivas compartidas: punto de estado, keycaps, botones,
   segmentado, interruptor, menú contextual, hoja modal, vacíos, avisos. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dismissToast, useSim } from '../../../core/store';
import { Icon, type IconName } from './icons';
import type { DotTone } from './lib';

// ---------------------------------------------------------------- Punto

export function Dot({ tone = 'idle', pulse = false, size, className, title }: { tone?: DotTone; pulse?: boolean; size?: 'sm'; className?: string; title?: string }) {
  const cls = ['co-dot', `co-dot--${tone}`, pulse ? 'co-dot--pulse' : '', size === 'sm' ? 'co-dot--sm' : '', className ?? ''].filter(Boolean).join(' ');
  const color = tone === 'ok' ? 'var(--co-ok)' : tone === 'weak' ? 'var(--co-weak)' : tone === 'fail' || tone === 'live' ? 'var(--co-fail)' : tone === 'accent' ? 'var(--co-accent)' : 'var(--co-ink-3)';
  return <span className={cls} style={{ color }} title={title} aria-hidden={title ? undefined : 'true'} />;
}

// ---------------------------------------------------------------- Keycaps

/** «⌘ K» → dos keycaps; «← →» → dos; «1 – 9» → uno. */
export function Keys({ keys, className }: { keys: string; className?: string }) {
  const parts = keys.includes(' – ') || keys.includes(' · ') ? [keys] : keys.split(' ').filter(Boolean);
  return (
    <span className={`co-kbd-group ${className ?? ''}`} aria-label={`Tecla ${keys}`}>
      {parts.map((k, i) => (
        <kbd className="co-kbd" key={i}>
          {k}
        </kbd>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- Botones

export function Button({
  children,
  icon,
  kind = 'default',
  size,
  keys,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; kind?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg'; keys?: string }) {
  const cls = ['co-btn', kind !== 'default' ? `co-btn--${kind}` : '', size ? `co-btn--${size}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
      {keys && <Keys keys={keys} />}
    </button>
  );
}

export function IconButton({ icon, label, on, size, className, iconSize, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; on?: boolean; size?: 'lg'; iconSize?: number }) {
  return (
    <button type="button" className={`co-iconbtn ${size ? `co-iconbtn--${size}` : ''} ${on ? 'is-on' : ''} ${className ?? ''}`} aria-label={label} title={label} aria-pressed={on} {...rest}>
      <Icon name={icon} size={iconSize ?? (size === 'lg' ? 18 : 16)} />
    </button>
  );
}

// ---------------------------------------------------------------- Segmentado

export function Segmented<T extends string>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number; disabled?: boolean }[]; className?: string; ariaLabel?: string }) {
  return (
    <div className={`co-seg ${className ?? ''}`} role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={o.id === value ? 'is-on' : ''} onClick={() => onChange(o.id)} disabled={o.disabled}>
          {o.label}
          {o.count !== undefined && <span className="co-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Interruptor

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`co-switch ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)} />;
}

// ---------------------------------------------------------------- Chip

export function Chip({ children, tone, mono, className, onClick, on, title }: { children: ReactNode; tone?: 'accent' | 'live' | 'ok' | 'weak'; mono?: boolean; className?: string; onClick?: () => void; on?: boolean; title?: string }) {
  const cls = ['co-chip', tone ? `co-chip--${tone}` : '', mono ? 'co-chip--mono' : '', onClick ? 'is-toggle' : '', on ? 'is-on' : '', className ?? ''].filter(Boolean).join(' ');
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={on} title={title}>
        {children}
      </button>
    );
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Propiedades

export function Props({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <dl className={`co-props ${className ?? ''}`} style={{ margin: 0, ...style }}>
      {children}
    </dl>
  );
}

export function Prop({ k, children, title }: { k: string; children: ReactNode; title?: string }) {
  return (
    <div className="co-prop">
      <dt className="co-prop-k" title={title}>
        {k}
      </dt>
      <dd className="co-prop-v" style={{ margin: 0 }}>
        {children}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------- Barra

export function Bar({ value, live, className }: { value: number; live?: boolean; className?: string }) {
  return (
    <div className={`co-bar ${live ? 'co-bar--live' : ''} ${className ?? ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Menú contextual

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
  sep?: boolean;
  head?: string;
}

export function Menu({ at, items, onClose, align = 'left' }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [hot, setHot] = useState(0);
  const actionable = items.filter((i) => !i.sep && !i.head && !i.disabled);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = align === 'right' ? at.x - r.width : at.x;
    let y = at.y;
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, at.y - r.height);
    if (x < 8) x = 8;
    setPos({ x, y });
  }, [at.x, at.y, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHot((h) => Math.min(actionable.length - 1, h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHot((h) => Math.max(0, h - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = actionable[hot];
        if (it) {
          onClose();
          it.run?.();
        }
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, hot, actionable]);

  let idx = -1;
  return (
    <div ref={ref} className="co-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => {
        if (it.sep) return <div key={`sep-${i}`} className="co-menu-sep" role="separator" />;
        if (it.head) return <div key={`head-${i}`} className="co-menu-head">{it.head}</div>;
        if (!it.disabled) idx++;
        const me = idx;
        return (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            className={`co-menu-item ${it.danger ? 'is-danger' : ''} ${!it.disabled && me === hot ? 'is-hot' : ''}`}
            disabled={it.disabled}
            style={it.disabled ? { opacity: 0.5 } : undefined}
            onMouseEnter={() => !it.disabled && setHot(me)}
            onClick={() => {
              onClose();
              it.run?.();
            }}
          >
            {it.icon && <Icon name={it.icon} size={15} />}
            <span className="co-truncate">{it.label}</span>
            {it.keys && <Keys keys={it.keys} />}
          </button>
        );
      })}
    </div>
  );
}

/** Estado de un menú anclado a un botón o al puntero. */
export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number; align: 'left' | 'right' } | null>(null);
  const openAt = (e: React.MouseEvent, align: 'left' | 'right' = 'left') => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    setState({ x: align === 'right' ? r.right : r.left, y: r.bottom + 4, align });
  };
  const openPointer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, align: 'left' });
  };
  const close = () => setState(null);
  return { state, openAt, openPointer, close };
}

// ---------------------------------------------------------------- Hoja

export function Sheet({ title, subtitle, onClose, children, footer, width, icon }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; icon?: IconName }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <>
      <div className="co-scrim" onClick={onClose} />
      <div className="co-sheet" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}>
        <header className="co-sheet-head">
          {icon && (
            <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 6, background: 'var(--co-bg-3)', color: 'var(--co-ink-2)' }}>
              <Icon name={icon} />
            </span>
          )}
          <div className="co-grow">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="x" label="Cerrar" onClick={onClose} />
        </header>
        <div className="co-sheet-body">{children}</div>
        {footer && <footer className="co-sheet-foot">{footer}</footer>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Vacío

export function Empty({ title, text, actions, icon }: { title: string; text?: string; actions?: ReactNode; icon?: IconName }) {
  return (
    <div className="co-empty">
      {icon && (
        <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 8, background: 'var(--co-bg-3)', color: 'var(--co-ink-3)', marginBottom: 6 }}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {actions && <div className="co-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Avisos

export function Toasts({ style, className }: { style?: React.CSSProperties; className?: string }) {
  const toasts = useSim((s) => s.toasts);
  return (
    <div className={`co-toasts ${className ?? ''}`} style={style} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="co-toast" role="status">
          <Dot tone={t.tone === 'ok' ? 'ok' : t.tone === 'warn' ? 'weak' : t.tone === 'err' ? 'fail' : 'accent'} />
          <span className="co-grow" style={{ lineHeight: 1.35 }}>
            {t.text}
            {t.count > 1 && <span className="co-count"> ×{t.count}</span>}
          </span>
          {t.action && (
            <Button
              size="sm"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </Button>
          )}
          <IconButton icon="x" label="Cerrar aviso" onClick={() => dismissToast(t.id)} style={{ width: 24, height: 24 }} iconSize={13} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Título de sección de lista

export function GroupHead({ title, count, right, collapsed, onToggle, className }: { title: ReactNode; count?: number | string; right?: ReactNode; collapsed?: boolean; onToggle?: () => void; className?: string }) {
  const inner = (
    <>
      {onToggle && <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="co-group-chev" />}
      <span className="co-group-title">{title}</span>
      {count !== undefined && <span className="co-group-count">{count}</span>}
    </>
  );
  return (
    <div className={`co-group ${className ?? ''}`}>
      {onToggle ? (
        <button type="button" className="co-group-btn" onClick={onToggle} aria-expanded={!collapsed}>
          {inner}
        </button>
      ) : (
        <div className="co-group-btn">{inner}</div>
      )}
      {right && <div className="co-group-right">{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Club dot

export function ClubDot({ color, size = 6 }: { color: string; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: color, flex: 'none', display: 'inline-block', boxShadow: '0 0 0 1px rgba(127,127,127,.25)' }} />;
}
