/* Esqueletos de carga: la forma de lo que va a llegar, con un brillo que
   pasa (translateX sobre una capa: solo transform). Con movimiento reducido,
   quietos. Se anuncian una sola vez con aria-busy en el contenedor (lo hace
   quien los usa); cada bloque es decorativo. */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import './Skeleton.css';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: 'pill' | 's' | 'm' | 'l' | 'xl' | 'circle';
  className?: string;
  style?: CSSProperties;
}

const RADIUS = {
  pill: 'var(--r-pill)',
  s: 'var(--r-s)',
  m: 'var(--r-m)',
  l: 'var(--r-l)',
  xl: 'var(--r-xl)',
  circle: '50%',
};

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 's',
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      className={cx('skeleton', className)}
      aria-hidden="true"
      style={{ width, height, borderRadius: RADIUS[radius], ...style }}
    />
  );
}

/** Filas de una lista mientras carga (la agenda, la biblioteca...). */
export function SkeletonRows({ rows = 5, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <Skeleton width={46} height={46} radius="circle" />
          <div className="skeleton-row__lines">
            <Skeleton width="62%" height={15} />
            <Skeleton width="44%" height={15} />
            <Skeleton width="30%" height={11} />
          </div>
          <Skeleton width={42} height={18} radius="s" />
        </div>
      ))}
    </div>
  );
}
