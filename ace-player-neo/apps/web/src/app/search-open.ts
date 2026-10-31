/* Abrir el buscador desde cualquier sitio (Ctrl K y el campo de la barra de
   cada sección). De momento lleva a la vista Buscar con el campo enfocado;
   la ventana rápida encima de todo llega con la pantalla 6 del rediseño. */

import { requestFocus } from './focus.ts';
import type { Route } from './routes.ts';

export function openSearch(navigate: (route: Route) => void): void {
  navigate({ vista: 'buscar' });
  void requestFocus('buscar-motor');
}
