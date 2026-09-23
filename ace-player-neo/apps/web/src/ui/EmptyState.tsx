/* Estado vacío: el círculo central del icono como ilustración, una frase que
   dice qué hacer y SIEMPRE una salida (regla 32 del inventario: «cada estado
   vacío lleva un botón que lo resuelve»). Por eso `actions` es obligatorio. */

import type { ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import './EmptyState.css';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  /** Uno o dos botones que resuelven el vacío. */
  actions: ReactNode;
  /** `error`: algo falló (ilustración con aspa en vez del triángulo). */
  tone?: 'empty' | 'error';
  className?: string;
}

export function EmptyState({
  title,
  children,
  actions,
  tone = 'empty',
  className,
}: EmptyStateProps) {
  return (
    <section className={cx('empty', `empty--${tone}`, className)}>
      <svg className="empty__art" viewBox="0 0 120 120" aria-hidden="true">
        <path className="empty__line" d="M60 4v26M60 90v26" />
        <circle className="empty__line" cx="60" cy="60" r="31" />
        <circle className="empty__lens" cx="60" cy="60" r="25" />
        {tone === 'error' ? (
          <path className="empty__mark" d="M51 51l18 18M69 51L51 69" />
        ) : (
          <path
            className="empty__play"
            d="M55 49.5v21a1.6 1.6 0 0 0 2.4 1.4l17-10.5a1.6 1.6 0 0 0 0-2.8l-17-10.5a1.6 1.6 0 0 0-2.4 1.4z"
          />
        )}
      </svg>
      <h2 className="empty__title">{title}</h2>
      {children ? <div className="empty__text">{children}</div> : null}
      <div className="empty__actions">{actions}</div>
    </section>
  );
}
