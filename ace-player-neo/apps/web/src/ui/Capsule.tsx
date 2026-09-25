/* Cápsula: la píldora de Palco para ir sobre una imagen (cristal oscuro) o
   sobre el fondo (velo del tono). Es lo que dice «● EN DIRECTO · 13'»,
   «VIE 21:00», «Final», «Señal lista» o «Tu equipo» en la esquina de un
   cartel, en el héroe y en las hojas (plan fase 2, primitiva nueva C3).

   Regla del sistema: SIEMPRE forma + palabra + color. El tono solo tiñe; la
   forma la ponen el punto (`dot`, que late en `live` y `ok`) o el icono, y la
   palabra son los `children` (obligatorios). Como botón (`as="button"`) es
   un interruptor con `pressed`. */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import './Capsule.css';

export type CapsuleTone = 'neutral' | 'live' | 'ok' | 'weak' | 'fail' | 'gold';

export interface CapsuleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'title'
> {
  tone?: CapsuleTone;
  size?: 'sm' | 'md';
  /** Punto delante (late en `live` y `ok`). */
  dot?: boolean;
  icon?: IconName;
  /** Cristal oscuro: para ir sobre una imagen o un vídeo. */
  glass?: boolean;
  as?: 'span' | 'button';
  /** Solo como botón: interruptor (aria-pressed). */
  pressed?: boolean;
  title?: string;
  className?: string;
  /** La palabra: obligatoria (nunca solo color). */
  children: ReactNode;
}

export function Capsule({
  tone = 'neutral',
  size = 'md',
  dot = false,
  icon,
  glass = false,
  as = 'span',
  pressed,
  title,
  className,
  children,
  type = 'button',
  ...rest
}: CapsuleProps) {
  const classes = cx(
    'capsule',
    `capsule--${tone}`,
    `capsule--${size}`,
    glass && 'capsule--glass',
    dot && 'capsule--dot',
    as === 'button' && 'capsule--button press',
    className,
  );
  const inner = (
    <>
      {dot ? <i className="capsule__dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} className="capsule__icon" /> : null}
      <span className="capsule__text">{children}</span>
    </>
  );
  if (as === 'button') {
    return (
      <button
        type={type}
        className={classes}
        data-tone={tone}
        title={title}
        aria-pressed={pressed === undefined ? undefined : pressed}
        {...rest}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className={classes} data-tone={tone} title={title}>
      {inner}
    </span>
  );
}
