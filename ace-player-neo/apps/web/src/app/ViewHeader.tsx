/* Cabecera común de las vistas: titular a anchura 112 y, a la derecha, las
   acciones de la vista y el estado del motor (en el móvil y la tableta; en
   escritorio el motor ya está abajo en el carril).

   El <h1> lleva tabIndex=-1: al navegar, el armazón le pasa el foco para que
   los lectores de pantalla anuncien la vista nueva. */

import type { ReactNode } from 'react';
import { useAppMode } from '../api/index.ts';
import { cx } from '../lib/cx.ts';
import { EngineIndicator } from './EngineIndicator.tsx';
import './view-header.css';

export interface ViewHeaderProps {
  title: string;
  /** Línea bajo el título («Hoy, miércoles 23 · 8 partidos»). */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Sin el estado del motor (por ejemplo, dentro de Ajustes → Salud). */
  hideEngine?: boolean;
  className?: string;
  children?: ReactNode;
}

export function ViewHeader({
  title,
  subtitle,
  actions,
  hideEngine = false,
  className,
  children,
}: ViewHeaderProps) {
  const mode = useAppMode();
  return (
    <header className={cx('view-head', className)}>
      <div className="view-head__row">
        <div className="view-head__titles">
          <h1 className="view-head__title" tabIndex={-1}>
            {title}
          </h1>
          {subtitle ? <div className="view-head__subtitle">{subtitle}</div> : null}
        </div>
        <div className="view-head__actions">
          {/* En demo no hay motor que vigilar: la etiqueta ocupa su sitio (así
              la cabecera del móvil cabe en una línea, como en la maqueta). */}
          {mode === 'demo' ? (
            <span className="view-head__demo">Modo demo</span>
          ) : hideEngine ? null : (
            <EngineIndicator className="view-head__engine" />
          )}
          {actions}
        </div>
      </div>
      {children}
    </header>
  );
}
