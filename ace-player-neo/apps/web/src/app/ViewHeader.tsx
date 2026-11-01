/* Cabecera común de las vistas: titular a anchura 112 y, a la derecha, las
   acciones de la vista y el estado del motor (en el móvil; desde 768 el motor
   va en el menú lateral).

   Desde 768 (rediseño de escritorio) es la barra de la sección: 64 px pegados
   arriba con el título, las acciones y el buscador con Ctrl K; el subtítulo y
   los hijos (chips, pestañas) van debajo. Al lado del buscador, la campana
   de avisos (features/avisos: «Te aviso» de la Guía).

   En el móvil (por debajo de 768; maqueta buscar-ajustes) la cabecera lleva
   a la derecha la lupa y el engranaje: Buscar y Ajustes se abren encima de
   cualquier pestaña, sin la isla de abajo. Dentro de ellas, en su lugar, la
   flecha para volver a donde se estaba. El estado del motor, como en el menú
   lateral, solo si algo falla (ámbar o rojo): con todo en orden la cabecera
   lleva solo el título y sus botones, como en la maqueta.

   El <h1> lleva tabIndex=-1: al navegar, el armazón le pasa el foco para que
   los lectores de pantalla anuncien la vista nueva. */

import type { ReactNode } from 'react';
import { useAppMode, useEngineSummary } from '../api/index.ts';
import { AvisosBell } from '../features/avisos/Bell.tsx';
import { cx } from '../lib/cx.ts';
import { IconButton } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';
import { EngineIndicator } from './EngineIndicator.tsx';
import { useLayout } from './layout.tsx';
import { useBack, useNavigate, useRoute } from './router.tsx';
import { opensOverTabs } from './routes.ts';
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
  const back = useBack();
  const route = useRoute();
  const mobile = useLayout().kind === 'mobile';
  // Buscar o Ajustes abiertos encima de una pestaña: flecha atrás y sin lupa ni engranaje.
  const overTabs = mobile && titleAs === 'h1' && opensOverTabs(route.vista);
  const engine = useEngineSummary();
  const engineQuiet = mobile && (engine.tone === 'ok' || engine.tone === 'idle');
  return (
    <header className={cx('view-head', className)}>
      <div className="view-head__row">
        {overTabs ? (
          <IconButton
            icon="chev-l"
            label="Volver"
            className="view-head__back"
            onClick={() => back({ vista: 'agenda' })}
          />
        ) : null}
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
            <span className="view-head__demo">
              {/* En el móvil estrecho se queda en «Demo» (el lector sigue oyendo «Modo demo»). */}
              <span className="view-head__demo-pre">
                {/* Espacio duro: en la caja flex el normal se pierde («Mododemo»). */}
                {'Modo\u00a0'}
              </span>
              <span className="view-head__demo-word">demo</span>
            </span>
          ) : hideEngine ? null : (
            // Montado siempre y escondido por CSS: si apareciera y desapareciera,
            // cada montaje volvería a pedir el estado del motor (y, con un error,
            // «comprobando» lo escondería otra vez, en bucle).
            <EngineIndicator
              className={cx('view-head__engine', engineQuiet && 'view-head__engine--quiet')}
            />
          )}
          {actions}
          <button type="button" className="view-head__search" onClick={() => openSearch(navigate)}>
            <Icon name="buscar" size={18} />
            <span className="view-head__search-text">Buscar partidos, canales, pelis…</span>
            <kbd>Ctrl K</kbd>
          </button>
          {mobile && !overTabs ? (
            <>
              <IconButton
                icon="buscar"
                label="Buscar"
                variant="quiet"
                className="view-head__tab"
                onClick={() => openSearch(navigate)}
              />
              <IconButton
                icon="ajustes"
                label="Ajustes"
                variant="quiet"
                className="view-head__tab"
                onClick={() => navigate({ vista: 'ajustes', seccion: null })}
              />
            </>
          ) : null}
          <AvisosBell />
        </div>
      </div>
      {children}
    </header>
  );
}
