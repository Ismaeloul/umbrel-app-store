/* La vista Guía TV con un servidor simulado que contesta con la guía de
   ejemplo (@ace/shared, la misma de la demo): estados, «Favoritos | Todos»,
   la parrilla, el teclado y la hoja «Más info». jsdom no maqueta: la lista
   virtual pinta con su tamaño inicial y `matchMedia` no casa (móvil). */

import { demoGuide, demoGuideProgrammes, type IptvGuideResponse } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/query.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { RouterProvider, useRoute } from '../../app/router.tsx';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import GuiaView from './index.tsx';

const LAYOUT: LayoutValue = {
  kind: 'mobile',
  asideVisible: false,
  asideAvailable: false,
  setAsideOpen: () => {},
  columnVisible: false,
};

function queryOf(call: MockCall): Record<string, string> {
  return Object.fromEntries(new URL(call.url, 'http://x').searchParams);
}

let net: ReturnType<typeof mockFetch>;

function serve(patch: Partial<IptvGuideResponse> = {}) {
  net = mockFetch({
    'GET /api/v1/iptv/guide': (call) => json({ ...demoGuide(queryOf(call), Date.now()), ...patch }),
    'GET /api/v1/iptv/guide/programmes': (call) =>
      json(demoGuideProgrammes(queryOf(call) as never, Date.now())),
  });
}

function Routed() {
  const route = useRoute();
  return <GuiaView route={route} active />;
}

function renderGuia(search = '?vista=guia') {
  history.replaceState(null, '', `/${search}`);
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider initialSearch={search}>
        <LayoutContext value={LAYOUT}>
          <Routed />
        </LayoutContext>
      </RouterProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  try {
    localStorage.clear();
  } catch {}
  // jsdom no maqueta: la parrilla mide 1200 × 640 para la lista virtual.
  for (const [prop, size] of [
    ['offsetHeight', 640],
    ['offsetWidth', 1200],
  ] as const)
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('guia-grid') ? size : 0;
    });
});
afterEach(() => {
  vi.restoreAllMocks();
  net?.restore();
  resetMode();
  history.replaceState(null, '', '/');
});

describe('Guía TV', () => {
  it('abre en Favoritos con sus canales, el favorito sin guía y la parrilla', async () => {
    serve();
    renderGuia();
    expect(screen.getByRole('heading', { level: 1, name: 'Guía TV' })).toBeInTheDocument();
    const grid = await screen.findByRole('grid', { name: 'Guía TV' });
    expect(screen.getByRole('radio', { name: /Favoritos/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(grid).getByRole('rowheader', { name: /La 1/ })).toBeInTheDocument();
    expect(within(grid).getByRole('rowheader', { name: /LaLiga\+ PPV 1/ })).toBeInTheDocument();
    // Llegan los programas por teselas: con el sello y como mucho 60 canales.
    await waitFor(() =>
      expect(
        within(grid).getAllByRole('gridcell', { name: /, de \d\d:\d\d a / }).length,
      ).toBeGreaterThan(3),
    );
    const slice = net.calls.find((call) => call.url.startsWith('/api/v1/iptv/guide/programmes'));
    expect(queryOf(slice as MockCall)).toMatchObject({ v: expect.stringMatching(/^d/) });
    // El favorito sin guía es una fila entera «Sin información».
    expect(
      within(grid).getAllByRole('gridcell', { name: /^Sin información/ }).length,
    ).toBeGreaterThan(0);
  });

  it('«Todos» va en la URL y se recuerda', async () => {
    serve();
    renderGuia();
    fireEvent.click(await screen.findByRole('radio', { name: /Todos/ }));
    await waitFor(() => expect(location.search).toContain('ambito=todos'));
    await waitFor(() =>
      expect(screen.getByRole('grid', { name: 'Guía TV' })).toHaveAttribute('aria-rowcount', '56'),
    );
    expect(localStorage.getItem('aceneo-guia-ambito')).toBe('todos');
  });

  it('el teclado: ↓ baja de canal a la misma hora', async () => {
    serve();
    renderGuia('?vista=guia&ambito=todos');
    const grid = await screen.findByRole('grid', { name: 'Guía TV' });
    await waitFor(() => expect(grid.getAttribute('aria-activedescendant')).toMatch(/^guia-c-0-/));
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await waitFor(() => expect(grid.getAttribute('aria-activedescendant')).toMatch(/^guia-c-1-/));
    const active = document.getElementById(grid.getAttribute('aria-activedescendant') ?? '');
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('tocar un programa en el móvil abre «Más info»', async () => {
    serve();
    renderGuia('?vista=guia&ambito=todos');
    const grid = await screen.findByRole('grid', { name: 'Guía TV' });
    const cell = await waitFor(() => {
      const found = within(grid).getAllByRole('gridcell', { name: /, de \d\d:\d\d a / })[0];
      if (!found) throw new Error('sin programas');
      return found;
    });
    fireEvent.click(cell);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /^Ver/ })).toBeInTheDocument();
  });

  it('sin IPTV, conectarla; sin guía del proveedor, decirlo', async () => {
    serve({ state: 'inactive', version: '', total: 0, channels: [] });
    const { unmount } = renderGuia();
    expect(
      await screen.findByRole('heading', { name: 'Conecta tu IPTV para ver la guía' }),
    ).toBeInTheDocument();
    unmount();
    net.restore();
    serve({ state: 'none', version: '', total: 0, channels: [] });
    renderGuia();
    expect(
      await screen.findByRole('heading', { name: 'Tu proveedor no da guía' }),
    ).toBeInTheDocument();
  });
});
