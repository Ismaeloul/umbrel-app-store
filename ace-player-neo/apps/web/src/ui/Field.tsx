/* Campos de formulario.

   - TextField: etiqueta SIEMPRE (visible o, en un buscador, oculta pero
     leída), pista y error enlazados con aria-describedby, icono delante y la
     tecla de atajo detrás (el «/» del buscador). Alto 48 para el pulgar.
     `focusTarget` marca el campo para que el armazón pueda enfocarlo desde
     un atajo global (src/app/focus.ts).
   - Switch: interruptor con role="switch" (tema, «Reducir transparencia»,
     «Un solo dispositivo a la vez»...).
   - Kbd: una tecla dibujada (panel de atajos, pistas). */

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import './Field.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  ref?: Ref<HTMLInputElement>;
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string | null;
  icon?: IconName;
  /** Tecla que lleva aquí («/»). */
  kbd?: string;
  /** `search`: cápsula (buscadores); `regular`: formularios. */
  variant?: 'regular' | 'search';
  /** Nombre para src/app/focus.ts (requestFocus('buscar-biblioteca')). */
  focusTarget?: string;
  trailing?: ReactNode;
}

export function TextField({
  ref,
  label,
  hideLabel = false,
  hint,
  error,
  icon,
  kbd,
  variant = 'regular',
  focusTarget,
  trailing,
  className,
  id,
  ...input
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-pista`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', `field--${variant}`, error && 'field--error', className)}>
      <label htmlFor={inputId} className={cx('field__label', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="field__box">
        {icon ? <Icon name={icon} size={20} className="field__icon" /> : null}
        <input
          ref={ref}
          id={inputId}
          className="field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          data-focus-target={focusTarget}
          {...input}
        />
        {trailing}
        {kbd ? (
          <kbd className="kbd field__kbd" aria-hidden="true">
            {kbd}
          </kbd>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SwitchProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cx('switch-row', className)}>
      <div className="switch-row__text">
        <span id={`${id}-l`} className="switch-row__label">
          {label}
        </span>
        {description ? (
          <span id={`${id}-d`} className="switch-row__desc">
            {description}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        className="switch press"
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('kbd', className)}>{children}</kbd>;
}
