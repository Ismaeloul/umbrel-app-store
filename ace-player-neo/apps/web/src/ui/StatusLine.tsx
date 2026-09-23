/* Línea de estado bajo el vídeo (solo el dibujo; la lógica de una cosa a la
   vez, 4,5 s y fundido vive en src/notices/statusLine.ts).

   Una línea: medidor de señal (o icono), lo que pasa en lenguaje humano
   («Fuente 1 verificada. Vas en directo.») y, a la derecha, un dato corto
   («6 s de retraso»). Lo técnico (pares, bitrate, códec) va en «Datos
   técnicos», nunca aquí. */

import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { SignalBadge, type SignalState } from './SignalBadge.tsx';
import type { NoticeTone } from './Toast.tsx';
import './StatusLine.css';

export interface StatusLineViewProps {
  text: string;
  tone?: NoticeTone;
  /** Medidor de señal a la izquierda (sin palabra: la frase ya lo dice). */
  signal?: SignalState;
  icon?: IconName;
  /** Dato a la derecha: retraso, hora del reintento... */
  meta?: string;
  count?: number;
  /** `leaving`: se está desvaneciendo (320 ms). */
  state?: 'in' | 'leaving';
  className?: string;
}

export function StatusLineView({
  text,
  tone = 'info',
  signal,
  icon,
  meta,
  count = 1,
  state = 'in',
  className,
}: StatusLineViewProps) {
  return (
    <div className={cx('status-line', `status-line--${tone}`, className)} data-state={state}>
      {signal ? (
        <SignalBadge state={signal} size="sm" hideWord />
      ) : (
        <Icon name={icon ?? 'info'} size={18} className="status-line__icon" />
      )}
      <p className="status-line__text">
        {text}
        {count > 1 ? <span className="status-line__count"> ×{count}</span> : null}
      </p>
      {meta ? <span className="status-line__meta">{meta}</span> : null}
    </div>
  );
}
