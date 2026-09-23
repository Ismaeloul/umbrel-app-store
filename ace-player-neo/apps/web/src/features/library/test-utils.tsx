/* Ayudas de los tests de biblioteca, buscador, listas y ajustes: monta una
   vista con sus proveedores (datos, rutas y maquetación), el contenedor de
   avisos y una biblioteca de muestra. Sin red: el fetch simulado de
   src/test/fetch.ts. Solo lo importan los tests. */

import type { Item, LibraryView } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createQueryClient } from '../../api/query.ts';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { RouterProvider, useRoute } from '../../app/router.tsx';
import { formatVista } from '../../app/routes.ts';
import { setPlayerPresence } from '../../app/player-presence.ts';
import { Toaster } from '../../notices/index.ts';
import { resetPlayerApi } from '../../player/api.ts';
import { resetScoreRevealForTests } from '../agenda/score-reveal.ts';
import { resetPlayGuard } from './play.ts';

export function makeItem(title: string, type: Item['type'], extra: Partial<Item> = {}): Item {
  const id = Array.from(title)
    .reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0) || 1, 2166136261)
    .toString(16)
    .padStart(8, '0')
    .repeat(5)
    .slice(0, 40);
  return {
    id,
    title,
    type,
    category: type === 'web' ? 'Deportes' : '',
    date: new Date().toISOString(),
    fromWebSync: type === 'web',
    ih: false,
    ...extra,
  };
}

export function makeLibrary(overrides: Partial<LibraryView> = {}): LibraryView {
  const web = [
    makeItem('DAZN 1', 'web'),
    makeItem('M+ LaLiga', 'web'),
    makeItem('La 1', 'web', { category: 'Generalistas' }),
  ];
  return {
    web,
    webSyncedAt: '2026-09-23T18:30:00.000Z',
    webSources: [
      {
        id: 'principal',
        name: 'Principal',
        url: 'https://example.com/lista.m3u',
        type: 'm3u',
        count: web.length,
        syncedAt: '2026-09-23T18:30:00.000Z',
        lastErrorAt: null,
        lastError: null,
      },
    ],
    activeWebSourceId: 'principal',
    favorites: [makeItem('DAZN 1', 'fav', { category: 'Deportes' }), makeItem('Eurosport 1', 'fav')],
    history: [makeItem('Canal de prueba', 'recent')],
    ...overrides,
  };
}

/**
 * Deja el reproductor como al arrancar: los tests que reproducen llaman a la
 * API real del reproductor (sin motor montado, solo guarda la orden).
 */
export function resetPlayback(): void {
  resetPlayerApi();
  setPlayerPresence({ active: false, route: null, immersive: false });
  resetScoreRevealForTests();
  resetPlayGuard();
}

/** Enseña la ruta actual (para comprobar navegaciones). */
function RouteProbe() {
  const route = useRoute();
  return <output data-testid="ruta">{formatVista(route)}</output>;
}

const DEFAULT_LAYOUT: LayoutValue = {
  kind: 'mobile',
  asideVisible: false,
  asideAvailable: false,
  setAsideOpen: () => {},
  columnVisible: false,
};

export function renderWithApp(
  ui: ReactNode,
  { search = '?vista=biblioteca', layout = {} }: { search?: string; layout?: Partial<LayoutValue> } = {},
) {
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
        <LayoutContext value={{ ...DEFAULT_LAYOUT, ...layout }}>
          {ui}
          <RouteProbe />
          <Toaster />
        </LayoutContext>
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
