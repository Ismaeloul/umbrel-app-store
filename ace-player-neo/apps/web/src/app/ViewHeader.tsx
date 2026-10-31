/* Cabecera común de las vistas: titular a anchura 112 y, a la derecha, las
   acciones de la vista y el estado del motor (en el móvil; desde 768 el motor
   va en el menú lateral).

   Desde 768 (rediseño de escritorio) es la barra de la sección: 64 px pegados
   arriba con el título, las acciones y el buscador con Ctrl K; el subtítulo y
   los hijos (chips, pestañas) van debajo.

   El <h1> lleva tabIndex=-1: al navegar, el armazón le pasa el foco para que
   los lectores de pantalla anuncien la vista nueva. */

import type { ReactNode } from 'react';
import { useAppMode } from '../api/index.ts';
import { cx } from '../lib/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import { EngineIndicator } from './EngineIndicator.tsx';
import { useNavigate } from './router.tsx';
import { openSearch } from './search-open.ts';
import './view-header.css';

export interface ViewHeaderProps {
  title: string;
  /** Línea bajo el título («Hoy, miércoles 23 · 8 partidos»). */
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Sin el estado del motor (por ejemplo, dentro de Ajustes → Salud). */
  hideEngine?: boolean;
  /** La barra que el armazón pone sobre la agenda y el partido: la vista ya
      tiene su <h1>, así que el título va en un párrafo. */
  titleAs?: 'h1' | 'p';
  className?: string;
  children?: ReactNode;
}

export function ViewHeader({
  title,
  subtitle,
  actions,
  hideEngine = false,
  titleAs = 'h1',
  className,
  children,
}: ViewHeaderProps) {
  const mode = useAppMode();
  const navigate = useNavigate();
  return (
    <header className={cx('view-head', className)}>
      <div className="view-head__row">
        <div className="view-head__titles">
          {titleAs === 'h1' ? (
            <h1 className="view-head__title" tabIndex={-1}>
              {title}
            </h1>
          ) : (
            <p className="view-head__title">{title}</p>
          )}
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
          <button type="button" className="view-head__search" onClick={() => openSearch(navigate)}>
            <Icon name="buscar" size={18} />
            <span className="view-head__search-text">Buscar partidos, canales, pelis…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
      </div>
      {children}
    </header>
  );
}
