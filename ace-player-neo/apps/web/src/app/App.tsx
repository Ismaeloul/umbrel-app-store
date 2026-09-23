/* Raíz de React: proveedores (datos y rutas) y el armazón. El arranque que
   no es de React (tema, SSE, atajos, service worker) está en main.tsx. */

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { queryClient as defaultClient } from '../api/query.ts';
import { RouterProvider } from './router.tsx';
import { saveScroll } from './scroll-memory.ts';
import { Shell } from './Shell.tsx';

export interface AppProps {
  client?: QueryClient;
  /** Para los tests: la query inicial (`?vista=…`). */
  initialSearch?: string;
}

export function App({ client = defaultClient, initialSearch }: AppProps) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider initialSearch={initialSearch} onBeforeChange={(from) => saveScroll(from)}>
          <Shell />
        </RouterProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
