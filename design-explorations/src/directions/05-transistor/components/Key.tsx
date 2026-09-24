/* Controles del receptor: teclas físicas (sombra corta y dura), conmutadores,
   selectores segmentados, chips, campos y estados vacíos. */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { Tone } from './text';

type KeyVariant = 'paper' | 'orange' | 'ghost' | 'ink' | 'danger';

export interface KeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: KeyVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  trailing?: ReactNode;
  block?: boolean;
  pressed?: boolean;
}

export function Key({ variant = 'paper', size = 'md', icon, trailing, block, pressed, className, children, type = 'button', ...rest }: KeyProps) {
  return (
    <button type={type} className={`tr-key tr-key--${variant} tr-key--${size}${block ? ' is-block' : ''}${pressed ? ' is-pressed' : ''}${className ? ` ${className}` : ''}`} aria-pressed={pressed} {...rest}>
      {icon && <span className="tr-key-ic">{icon}</span>}
      {children && <span className="tr-key-tx">{children}</span>}
      {trailing && <span className="tr-key-tr">{trailing}</span>}
    </button>
  );
}

export interface IconKeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: number;
  variant?: KeyVariant;
  pressed?: boolean;
}

export function IconKey({ label, icon, size = 44, variant = 'paper', pressed, className, type = 'button', style, ...rest }: IconKeyProps) {
  return (
    <button type={type} className={`tr-ikey tr-key--${variant}${pressed ? ' is-pressed' : ''}${className ? ` ${className}` : ''}`} aria-label={label} title={label} aria-pressed={pressed} style={{ width: size, height: size, ...style }} {...rest}>
      {icon}
    </button>
  );
}

export interface SegOption<T extends string> {
  id: T;
  label: string;
  count?: number;
  disabled?: boolean;
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md', label, className }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string; className?: string }) {
  return (
    <div className={`tr-seg tr-seg--${size}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={o.disabled} className={`tr-seg-opt${value === o.id ? ' is-on' : ''}`} onClick={() => onChange(o.id)}>
          <span>{o.label}</span>
          {o.count !== undefined && <span className="tr-seg-n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; className?: string }) {
  return (
    <label className={`tr-switch${className ? ` ${className}` : ''}`}>
      <span className="tr-switch-tx">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={`tr-switch-k${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </label>
  );
}

export function Chip({ active, onClick, children, className, tone }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; tone?: Tone }) {
  if (!onClick) {
    return <span className={`tr-chip${active ? ' is-on' : ''}${tone ? ` tr-tone-${tone}` : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
  }
  return (
    <button type="button" className={`tr-chip is-button${active ? ' is-on' : ''}${tone ? ` tr-tone-${tone}` : ''}${className ? ` ${className}` : ''}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  big?: boolean;
}

export function Field({ mono, leading, trailing, big, className, ...rest }: FieldProps) {
  return (
    <label className={`tr-field${mono ? ' is-mono' : ''}${big ? ' is-big' : ''}${className ? ` ${className}` : ''}`}>
      {leading && <span className="tr-field-ic">{leading}</span>}
      <input {...rest} />
      {trailing && <span className="tr-field-tr">{trailing}</span>}
    </label>
  );
}

/** Etiqueta monoespaciada en mayúsculas, con color de teletexto. */
export function Tag({ tone = 'muted', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={`tr-tag tr-tone-${tone}${className ? ` ${className}` : ''}`}>
      {dot && <i className="tr-dot" />}
      {children}
    </span>
  );
}

export function Dot({ tone = 'muted', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <i className={`tr-dot tr-tone-${tone}${pulse ? ' is-pulse' : ''}`} aria-hidden="true" />;
}

/** Estado vacío «estática»: una línea punteada y una salida. */
export function Empty({ title, text, actions, compact }: { title: string; text?: string; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={`tr-empty${compact ? ' is-compact' : ''}`}>
      <div className="tr-empty-static" aria-hidden="true">
        <span>— — —</span>
        <span>sin señal</span>
        <span>— — —</span>
      </div>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {actions && <div className="tr-empty-actions">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`tr-sect${className ? ` ${className}` : ''}`}>
      <h2>{children}</h2>
      {aside && <div className="tr-sect-aside">{aside}</div>}
    </div>
  );
}

/** Barra de progreso (solo `transform`). */
export function Progress({ value, tone = 'cyan', className, height = 4 }: { value: number; tone?: Tone; className?: string; height?: number }) {
  return (
    <div className={`tr-progress tr-tone-${tone}${className ? ` ${className}` : ''}`} style={{ height }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}
