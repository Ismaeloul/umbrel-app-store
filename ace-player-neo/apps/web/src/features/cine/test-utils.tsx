/* Ayudas de los tests de Películas y series: monta la vista con sus
   proveedores (datos, rutas, maquetación y avisos) y un servidor simulado
   que contesta con el catálogo de muestra (demo-data.ts), las mismas reglas
   que el servidor de verdad. Solo lo importan los tests. */

import type { VodBrowseQuery } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createQueryClient } from '../../api/query.ts';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { RouterProvider, useRoute } from '../../app/router.tsx';
import { Toaster } from '../../notices/index.ts';
import { json, type MockCall } from '../../test/fetch.ts';
import CineView from './CineView.tsx';
import { resetCineState } from './data.ts';
import { demoVodBrowse, demoVodHome, demoVodTitle } from './demo-data.ts';

const DEFAULT_LAYOUT: LayoutValue = {
  kind: 'mobile',
  asideVisible: false,
  asideAvailable: false,
  setAsideOpen: () => {},
  columnVisible: false,
};

/** La vista con la ruta del router (la ficha se abre navegando, como en la app). */
function RoutedCine({ active = true }: { active?: boolean }) {
  const route = useRoute();
  return <CineView route={route} active={active} />;
}

export function renderCine({
  search = '?vista=cine',
  layout = {},
  ui,
}: { search?: string; layout?: Partial<LayoutValue>; ui?: ReactNode } = {}) {
  history.replaceState(null, '', `/${search}`);
  resetCineState();
  const client = createQueryClient();
  // En los tests un fallo se enseña ya, sin reintentos con espera.
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider initialSearch={search}>
        <LayoutContext value={{ ...DEFAULT_LAYOUT, ...layout }}>
          {ui ?? <RoutedCine />}
          <Toaster />
        </LayoutContext>
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

export function queryOf(call: MockCall): Partial<VodBrowseQuery> & { limit?: number } {
  const params = new URL(call.url, 'http://x').searchParams;
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) out[key] = key === 'limit' ? Number(value) : value;
  return out as Partial<VodBrowseQuery> & { limit?: number };
}

/** Rutas del servidor simulado con el catálogo de muestra; `ids` son las fichas que se pueden pedir. */
export function demoRoutes(ids: readonly string[] = []) {
  const routes: Record<string, (call: MockCall) => Response> = {
    'GET /api/v1/vod': (call) => json(demoVodHome(queryOf(call))),
    'GET /api/v1/vod/browse': (call) => json(demoVodBrowse(queryOf(call))),
    /* Idiomas ya elegidos: todos (los tests de idiomas ponen los suyos). */
    'GET /api/v1/vod/languages': () =>
      json({ chosen: true, langs: [], unknown: true, updatedAt: null }),
  };
  for (const id of ids)
    routes[`GET /api/v1/vod/titles/${id}`] = () => {
      const title = demoVodTitle(id);
      return title
        ? json(title)
        : json(
            {
              error: {
                code: 'vod_not_found',
                message: 'Este título ya no está en tu IPTV.',
                requestId: 't',
              },
            },
            404,
          );
    };
  return routes;
}
