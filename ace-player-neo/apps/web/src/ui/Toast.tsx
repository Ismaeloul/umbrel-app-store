/* Toast (solo el dibujo). La cola, el máximo de 2, el ×n y los tiempos viven
   en src/notices/toasts.ts; el contenedor con aria-live, en
   src/notices/Toaster.tsx.

   Para qué (inventario §10.1): acciones tuyas (favorito, copiar, guardar...)
   y errores que piden atención. Nunca lo que le pasa a la señal (eso va en la
   línea de estado) y nunca encima del vídeo. */

import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import './Toast.css';

export type NoticeTone = 'ok' | 'info' | 'warn' | 'err';

export const TONE_ICON: Record<NoticeTone, IconName> = {
  ok: 'check',
  info: 'info',
  warn: 'aviso',
  err: 'aviso',
};

export interface ToastViewProps {
  text: string;
  tone: NoticeTone;
  /** Veces que se ha repetido (se enseña «×n» desde 2). */
  count?: number;
  icon?: IconName;
  action?: { label: string; onAction(): void };
  onDismiss?(): void;
  /** `leaving`: fundido de salida. */
  state?: 'in' | 'leaving';
}

export function ToastView({
  text,
  tone,
  count = 1,
  icon,
  action,
  onDismiss,
  state = 'in',
}: ToastViewProps) {
  return (
    <div className={cx('toast', 'glass', 'glass--dense', `toast--${tone}`)} data-state={state}>
      <Icon name={icon ?? TONE_ICON[tone]} size={20} className="toast__icon" />
      <p className="toast__text">
        {text}
        {count > 1 ? <span className="toast__count"> ×{count}</span> : null}
      </p>
      {action ? (
        <button type="button" className="toast__action press" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className="toast__close press"
          aria-label="Cerrar aviso"
          onClick={onDismiss}
        >
          <Icon name="x" size={18} />
        </button>
      ) : null}
    </div>
  );
}
