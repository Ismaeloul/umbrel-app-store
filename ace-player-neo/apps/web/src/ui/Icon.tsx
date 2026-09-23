/* Icono del set propio, en línea. Decorativo por defecto (aria-hidden): el
   texto del botón o su aria-label ya dicen lo que hace. Con `label`, se
   anuncia como imagen. */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import { ICONS, type IconName } from './icons.ts';
import './Icon.css';

export interface IconProps {
  name: IconName;
  /** Lado en px (el dibujo es de 24 y escala). */
  size?: 16 | 18 | 20 | 24 | 28 | 32;
  /** Texto para lectores de pantalla cuando el icono va solo y significa algo. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 24, label, className, style }: IconProps) {
  return (
    <svg
      className={cx('icon', className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={style}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      // Contenido estático del propio código (icons.ts): nunca datos de fuera.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
