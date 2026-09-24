/* Primitivas de Palco: botones, cápsulas, segmentado, interruptor, campo,
   chips, vacíos. Un solo acento (oro) para la acción principal. */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import type { Tone } from './text';
import { haptic } from './haptics';

type BtnVariant = 'gold' | 'glass' | 'ghost' | 'quiet' | 'danger' | 'video' | 'outline';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'glass', size = 'md', icon, iconRight, block, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={`pl-btn pl-btn--${variant} pl-btn--${size}${block ? ' pl-btn--block' : ''} ${className ?? ''}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 22 : 18} />}
      {children != null && <span className="pl-btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 18} />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: IconName;
  size?: number;
  iconSize?: number;
  variant?: 'glass' | 'ghost' | 'video' | 'gold' | 'solid';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, size = 44, iconSize, variant = 'ghost', active, className, type = 'button', style, ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} aria-pressed={active} className={`pl-ibtn pl-ibtn--${variant}${active ? ' is-active' : ''} ${className ?? ''}`} style={{ width: size, height: size, ...style }} {...rest}>
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.5)} />
    </button>
  );
});

export function Capsule({ tone = 'neutral', children, dot, icon, className, size = 'md', glass, onClick, title }: { tone?: Tone; children: ReactNode; dot?: boolean; icon?: IconName; className?: string; size?: 'sm' | 'md'; glass?: boolean; onClick?: () => void; title?: string }) {
  const cls = `pl-capsule pl-capsule--${tone} pl-capsule--${size}${glass ? ' pl-capsule--glass' : ''}${onClick ? ' pl-capsule--btn' : ''} ${className ?? ''}`;
  const inner = (
    <>
      {dot && <span className="pl-capsule__dot" aria-hidden="true" />}
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      <span className="pl-capsule__text">{children}</span>
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick} title={title}>
        {inner}
      </button>
    );
  return (
    <span className={cls} title={title}>
      {inner}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className, label, size = 'md' }: { value: T; options: { id: T; label: string; count?: number; disabled?: boolean }[]; onChange: (v: T) => void; className?: string; label: string; size?: 'sm' | 'md' }) {
  return (
    <div className={`pl-seg pl-seg--${size} ${className ?? ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} disabled={o.disabled} className={`pl-seg__opt${o.id === value ? ' is-on' : ''}`} onClick={() => { if (o.id !== value) haptic('selection'); onChange(o.id); }}>
          <span>{o.label}</span>
          {o.count != null && <span className="pl-seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; className?: string }) {
  return (
    <label className={`pl-switch ${className ?? ''}`}>
      <span className="pl-switch__text">
        <span className="pl-switch__label">{label}</span>
        {description && <span className="pl-switch__desc">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`pl-switch__track${checked ? ' is-on' : ''}`} onClick={() => { haptic('selection'); onChange(!checked); }}>
        <span className="pl-switch__knob" />
      </button>
    </label>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  trailing?: ReactNode;
  wrapClassName?: string;
  mono?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ icon, trailing, wrapClassName, className, mono, ...rest }, ref) {
  return (
    <div className={`pl-field${mono ? ' pl-field--mono' : ''} ${wrapClassName ?? ''}`}>
      {icon && <Icon name={icon} size={18} className="pl-field__icon" />}
      <input ref={ref} className={`pl-field__input ${className ?? ''}`} {...rest} />
      {trailing && <span className="pl-field__trailing">{trailing}</span>}
    </div>
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="pl-kbd">{children}</kbd>;
}

export function Chip({ selected, onClick, children, disabled }: { selected: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={selected} disabled={disabled} className={`pl-chip${selected ? ' is-on' : ''}`} onClick={() => { haptic('selection'); onClick(); }}>
      {selected && <Icon name="check" size={14} />}
      <span>{children}</span>
    </button>
  );
}

export function Empty({ icon = 'ball', title, text, action, secondary, className, compact }: { icon?: IconName; title: string; text?: string; action?: { label: string; run: () => void }; secondary?: { label: string; run: () => void }; className?: string; compact?: boolean }) {
  return (
    <div className={`pl-empty${compact ? ' pl-empty--compact' : ''} ${className ?? ''}`}>
      <span className="pl-empty__icon">
        <Icon name={icon} size={compact ? 22 : 28} strokeWidth={1.8} />
      </span>
      <h3 className="pl-empty__title">{title}</h3>
      {text && <p className="pl-empty__text">{text}</p>}
      {(action || secondary) && (
        <div className="pl-empty__actions">
          {action && (
            <Button variant="gold" size="sm" onClick={action.run}>
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button variant="quiet" size="sm" onClick={secondary.run}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function RowHeader({ title, count, sub, action, live, className, as = 'h2' }: { title: string; count?: number; sub?: string; action?: { label: string; run: () => void; icon?: IconName }; live?: boolean; className?: string; as?: 'h2' | 'h3' }) {
  const Tag = as;
  return (
    <div className={`pl-rowhead ${className ?? ''}`}>
      <div className="pl-rowhead__text">
        <Tag className="pl-rowhead__title">
          {live && <span className="pl-livedot" aria-hidden="true" />}
          {title}
          {count != null && <span className="pl-rowhead__count">{count}</span>}
        </Tag>
        {sub && <p className="pl-rowhead__sub">{sub}</p>}
      </div>
      {action && (
        <Button variant="quiet" size="sm" icon={action.icon} onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Puntito rojo de directo con onda (transform + opacity). */
export function LiveDot({ className, size = 8 }: { className?: string; size?: number }) {
  return <span className={`pl-livedot ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Fila de lista (icono · texto · accesorio). */
export function ListRow({ icon, leading, title, sub, trailing, onClick, className, danger, disabled, as = 'div' }: { icon?: IconName; leading?: ReactNode; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; onClick?: () => void; className?: string; danger?: boolean; disabled?: boolean; as?: 'div' | 'li' }) {
  const Tag = onClick ? 'button' : as;
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} disabled={disabled} className={`pl-row${onClick ? ' pl-row--btn' : ''}${danger ? ' pl-row--danger' : ''} ${className ?? ''}`}>
      {(icon || leading) && <span className="pl-row__lead">{leading ?? (icon && <Icon name={icon} size={20} />)}</span>}
      <span className="pl-row__text">
        <span className="pl-row__title">{title}</span>
        {sub && <span className="pl-row__sub">{sub}</span>}
      </span>
      {trailing && <span className="pl-row__trail">{trailing}</span>}
      {onClick && !trailing && <Icon name="chevronRight" size={16} className="pl-row__chev" />}
    </Tag>
  );
}

export function Progress({ value, tone = 'neutral', className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <span className={`pl-progress pl-progress--${tone} ${className ?? ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="pl-progress__bar" style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </span>
  );
}
