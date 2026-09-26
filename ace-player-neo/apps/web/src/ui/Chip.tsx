/* Chip: etiqueta pequeña, filtro que se activa (aria-pressed) o canal.

   Injerto B3: los chips de canal llevan borde CONTINUO si el canal está en tu
   biblioteca y DISCONTINUO si se buscará al reproducir (`outline`). La forma
   dice lo mismo que el texto, así que no depende del color.

   Si lleva `onClick` o `pressed` es un botón (≥ 44 px de zona táctil aunque
   el dibujo mida 32); si no, un <span> sin foco. */

import type { MouseEventHandler, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Num } from './Num.tsx';
import './Chip.css';

export interface ChipProps {
  children: ReactNode;
  icon?: IconName;
  /** Contador a la derecha («Para ti 8»), con cifras de celda fija. */
  count?: number;
  /** Filtro activable: se anuncia con aria-pressed. */
  pressed?: boolean;
  /** `solid`: en tu biblioteca; `dashed`: se buscará al reproducir (B3). */
  outline?: 'none' | 'solid' | 'dashed';
  /** `mine`: «Tu equipo» y similares, con el cielo; `soft`: neutro. */
  tone?: 'soft' | 'mine' | 'live';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  /** Nombre accesible si el texto a la vista no basta («Fútbol, 1204 canales»). */
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function Chip({
  children,
  icon,
  count,
  pressed,
  outline = 'none',
  tone = 'soft',
  onClick,
  title,
  label,
  className,
  disabled,
}: ChipProps) {
  const classes = cx('chip', `chip--${tone}`, outline !== 'none' && `chip--${outline}`, className);
  const content = (
    <>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span className="chip__label">{children}</span>
      {count !== undefined ? <Num className="chip__count" value={count} /> : null}
    </>
  );
  if (onClick || pressed !== undefined) {
    return (
      <button
        type="button"
        className={cx(classes, 'chip--button', 'press')}
        aria-pressed={pressed}
        aria-label={label}
        onClick={onClick}
        title={title}
        disabled={disabled}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={classes} title={title}>
      {content}
    </span>
  );
}
