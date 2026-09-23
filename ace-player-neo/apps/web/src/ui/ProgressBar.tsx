/* Barra de progreso animada solo con transform (scaleX): la del partido en la
   base de la fila en directo y la del comprobador («4 de 6 comprobadas»).
   Con `marks` se pintan muescas (el descanso a 0,5). */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  /** Qué mide, para lectores de pantalla («Minuto 72 de 90»). */
  label: string;
  tone?: 'live' | 'accent' | 'neutral';
  /** Muescas en 0..1 (el descanso). */
  marks?: number[];
  size?: 'thin' | 'regular';
  className?: string;
}

export function ProgressBar({
  value,
  label,
  tone = 'accent',
  marks = [],
  size = 'regular',
  className,
}: ProgressBarProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cx('progress', `progress--${tone}`, `progress--${size}`, className)}
      style={{ '--v': v } as CSSProperties}
    >
      <span className="progress__fill" />
      {marks.map((mark) => (
        <span key={mark} className="progress__mark" style={{ left: `${mark * 100}%` }} />
      ))}
    </div>
  );
}
