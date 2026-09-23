/* Ayudas de los tests de Salud y Dispositivos: monta una sección con sus
   proveedores (datos, rutas, maquetación y avisos), sin red (el fetch simulado
   de src/test/fetch.ts). Solo lo importan los tests. */

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createQueryClient } from '../../api/query.ts';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { RouterProvider } from '../../app/router.tsx';
import { Toaster } from '../../notices/index.ts';

const LAYOUT: LayoutValue = {
  kind: 'mobile',
  asideVisible: false,
  asideAvailable: false,
  setAsideOpen: () => {},
  columnVisible: false,
};

export function renderSection(ui: ReactNode, search = '?vista=ajustes/salud') {
  history.replaceState(null, '', `/${search}`);
  const client = createQueryClient();
  // En los tests un fallo se enseña ya, sin reintentos con espera.
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider initialSearch={search}>
        <LayoutContext value={LAYOUT}>
          {ui}
          <Toaster />
        </LayoutContext>
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
