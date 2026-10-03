/* Raíz de React: proveedores (datos y rutas) y el armazón. El arranque que
   no es de React (tema, SSE, atajos, service worker) está en main.tsx. */

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { queryClient as defaultClient } from '../api/query.ts';
import { RouterProvider, type NavDirection } from './router.tsx';
import type { Route } from './routes.ts';
import { saveScroll } from './scroll-memory.ts';
import { Shell } from './Shell.tsx';
import { captureLeavingView } from './viewCrossfade.ts';
import { viewMotion } from './viewTransitionGuard.ts';

/* Antes de cambiar de ruta (el DOM aún es el de la vista que se deja): se
   guarda su scroll y, donde el cambio de vista no va con View Transitions
   (WebKit), se prepara el fundido de la vista que sale (viewCrossfade.ts). */
function beforeRouteChange(from: Route, to: Route, direction: NavDirection | null): void {
  saveScroll(from);
  if (from.vista !== to.vista && viewMotion() === 'css') captureLeavingView(from.vista, direction);
}

export interface AppProps {
  client?: QueryClient;
  /** Para los tests: la query inicial (`?vista=…`). */
  initialSearch?: string;
}

export function App({ client = defaultClient, initialSearch }: AppProps) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider initialSearch={initialSearch} onBeforeChange={beforeRouteChange}>
          <Shell />
        </RouterProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
