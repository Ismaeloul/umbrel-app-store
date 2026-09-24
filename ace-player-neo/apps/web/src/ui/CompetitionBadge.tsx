/* Pastilla oscura de competición: el logo que sirve el backend
   (`/api/v1/football/competitions/<id>/logo?v=…`, mismo origen) o, si no lo
   hay o falla, el nombre corto en texto («UCL», «LaLiga»). Va al centro de la
   tarjeta versus y en las cabeceras del centro de partido (plan fase 2, D4).
   Decorativa por defecto: el nombre de la competición va escrito al lado;
   con `label` se anuncia como imagen. */

import { useState, type CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import { competitionShort } from '../lib/teams.ts';
import './CompetitionBadge.css';

export interface CompetitionBadgeProps {
  name: string;
  /** Ruta relativa del logo o null. */
  logo?: string | null;
  /** Texto de respaldo (si no, `competitionShort(name)`). */
  short?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Se anuncia con este nombre (si no, decorativa). */
  label?: string;
  className?: string;
}

export function CompetitionBadge({
  name,
  logo,
  short,
  size = 'md',
  label,
  className,
}: CompetitionBadgeProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const image =
    logo && logo.startsWith('/') && !logo.startsWith('//') && failed !== logo ? logo : null;
  const text = short ?? competitionShort(name);
  return (
    <span
      className={cx('comp', `comp--${size}`, image && 'comp--image', className)}
      title={name}
      style={{ '--comp-chars': text.length } as CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {image ? (
        <img
          key={image}
          className="comp__logo"
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(image)}
        />
      ) : (
        <span className="comp__text">{text}</span>
      )}
    </span>
  );
}
