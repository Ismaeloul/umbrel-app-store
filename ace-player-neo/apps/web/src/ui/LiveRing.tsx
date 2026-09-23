/* El minuto en el círculo central (la firma de la opción A): un anillo que se
   llena con el partido (0' a 90'), con una muesca abajo en el descanso, y una
   onda que se expande cada 2 s. Es lo único que late en la fila.

   - La onda está contenida en la caja del anillo (corrección 6: nada de halos
     que se salen de su sitio): la caja mide 1,16 veces el anillo y recorta.
   - En el descanso, o con movimiento reducido, no hay onda.
   - Tres tamaños: fila (50), fila compacta (40) y ficha de canal (46).

   LiveDot: el punto de «En directo» con su anillo, para textos y chips. */

import type { CSSProperties } from 'react';
import { cx } from '../lib/cx.ts';
import { Num } from './Num.tsx';
import './LiveRing.css';

export interface LiveRingProps {
  /** Minuto tal cual lo da el marcador: 72, "45+2", "90+4". */
  minute: number | string;
  /** 0..1; si no se da, minuto / 90. */
  progress?: number;
  size?: 'row' | 'compact' | 'card';
  /** Descanso: sin onda y con «Desc.» dentro. */
  halftime?: boolean;
  className?: string;
}

const DIAMETER = { row: 50, compact: 40, card: 46 } as const;

/** Progreso del partido a partir del minuto («45+2» cuenta como 45). */
export function matchProgress(minute: number | string): number {
  const base = typeof minute === 'number' ? minute : Number.parseInt(String(minute), 10);
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.min(1, base / 90);
}

export function LiveRing({
  minute,
  progress,
  size = 'row',
  halftime = false,
  className,
}: LiveRingProps) {
  const p = Math.min(1, Math.max(0, progress ?? matchProgress(minute)));
  const text = halftime ? 'Desc.' : `${minute}'`;
  const style = { '--p': p, '--d': `${DIAMETER[size]}px` } as CSSProperties;
  return (
    <span
      className={cx('ring-box', `ring-box--${size}`, className)}
      style={style}
      data-halftime={halftime ? 'true' : 'false'}
    >
      <span className="ring">
        {halftime ? null : <span className="ring__wave" aria-hidden="true" />}
        {halftime ? (
          <span className="ring__text ring__text--word">Desc.</span>
        ) : (
          <Num className="ring__text" value={text} label={`Minuto ${minute}, en directo`} />
        )}
      </span>
    </span>
  );
}

/** Punto de «En directo» con su anillo, contenido en una caja de 18 px. */
export function LiveDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      className={cx('live-dot', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i />
    </span>
  );
}
