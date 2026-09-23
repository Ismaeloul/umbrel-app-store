/* Contratos entre el armazón y las vistas / el reproductor. Es lo que los
   agentes de las vistas implementan (ver apps/web/README.md):

   src/features/<vista>/index.tsx   → export default function Vista(props: ViewProps)
   src/features/<vista>/aside.tsx   → export default (opcional): panel lateral de escritorio
   src/features/agenda/column.tsx   → export default: columna compacta de agenda junto al
                                      reproductor en pantallas anchas
   src/player/index.tsx             → export default: PlayerDock (el reproductor persistente)

   El armazón los encuentra solo (import.meta.glob en views.ts) y los carga
   con React.lazy: si un fichero aún no existe, sale un marcador de «en
   construcción» y nada se rompe. */

import type { ComponentType } from 'react';
import type { Route } from './routes.ts';

export interface ViewProps {
  route: Route;
  /** false mientras la vista está oculta (se conserva montada con su estado y su scroll). */
  active: boolean;
}

export type ViewComponent = ComponentType<ViewProps>;

export interface ViewModule {
  default: ViewComponent;
}

export type PlayerPresentation = 'stage' | 'mini';

export interface PlayerDockProps {
  /**
   * `stage`: en grande, en el centro de partido (arriba en el móvil; en el
   * centro en escritorio). `mini`: el «Sonando» encima de la barra inferior
   * (móvil) o abajo a la izquierda (escritorio).
   * Es SIEMPRE el mismo componente montado en el mismo sitio del árbol: pasar
   * de uno a otro no recrea el <video> (la reproducción no se corta).
   */
  presentation: PlayerPresentation;
  route: Route;
  /** Flecha de minimizar o deslizar hacia abajo: el armazón vuelve a la vista anterior. */
  onMinimize(): void;
  /** Toque en el mini-reproductor: el armazón abre la ruta de lo que suena (playerPresence). */
  onExpand(): void;
}

export interface PlayerModule {
  default: ComponentType<PlayerDockProps>;
}
