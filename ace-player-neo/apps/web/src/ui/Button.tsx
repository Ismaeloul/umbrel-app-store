/* Botones del sistema.

   - Button: texto (con icono opcional). `primary` es la acción principal de
     la pantalla, relleno de cielo (una por pantalla, como el tinte único de
     Liquid Glass); `quiet` es la secundaria; `ghost`, la terciaria; `glass`,
     sobre contenido; `video`, sobre la imagen; `danger`, acciones que borran.
   - IconButton: solo icono, 44×44 siempre, con `label` obligatorio (se usa
     como aria-label y como tooltip).

   `pressed` lo convierte en interruptor (aria-pressed). `busy` lo deja
   deshabilitado con el aviso para lectores de pantalla. En React 19 la ref
   es una prop más, así que no hace falta forwardRef. */

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import './Button.css';

export type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'glass' | 'video' | 'danger';

interface BaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  /** Interruptor: se pinta como pulsado y lo anuncia con aria-pressed. */
  pressed?: boolean;
  /** Trabajando: deshabilitado y con aria-busy. */
  busy?: boolean;
}

export interface ButtonProps extends BaseProps {
  icon?: IconName;
  /** Icono detrás del texto (por ejemplo, una flecha). */
  trailingIcon?: IconName;
  size?: 'md' | 'sm';
  /** Ocupa todo el ancho de su contenedor. */
  block?: boolean;
  children: ReactNode;
}

export function Button({
  ref,
  variant = 'quiet',
  size = 'md',
  icon,
  trailingIcon,
  pressed,
  busy = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'btn',
        `btn--${variant}`,
        size === 'sm' && 'btn--sm',
        block && 'btn--block',
        'press',
        className,
      )}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 18 : 20} /> : null}
      <span className="btn__label">{children}</span>
      {trailingIcon ? <Icon name={trailingIcon} size={18} /> : null}
    </button>
  );
}

export interface IconButtonProps extends BaseProps {
  icon: IconName;
  /** Qué hace (aria-label y tooltip). Obligatorio: un icono solo no se lee. */
  label: string;
  /** Icono alternativo cuando `pressed` es true (estrella llena, por ejemplo). */
  pressedIcon?: IconName;
  /** Tecla que lo acciona, para el tooltip («Favorito (G)»). */
  shortcut?: string;
  size?: 'md' | 'lg';
}

export function IconButton({
  ref,
  icon,
  pressedIcon,
  label,
  shortcut,
  variant = 'ghost',
  size = 'md',
  pressed,
  busy = false,
  className,
  disabled,
  type = 'button',
  title,
  ...rest
}: IconButtonProps) {
  const shown = pressed && pressedIcon ? pressedIcon : icon;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'icon-btn',
        `icon-btn--${variant}`,
        size === 'lg' && 'icon-btn--lg',
        'press',
        className,
      )}
      aria-label={label}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      <Icon name={shown} size={size === 'lg' ? 28 : 24} />
    </button>
  );
}
