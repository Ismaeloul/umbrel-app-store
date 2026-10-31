/* La vista Guía TV con un servidor simulado que contesta con la guía de
   ejemplo (@ace/shared, la misma de la demo): estados, «Favoritos | Todos»,
   la parrilla, el teclado y la hoja «Más info». jsdom no maqueta: la lista
   virtual pinta con su tamaño inicial y `matchMedia` no casa (móvil), salvo
   en «escritorio», que simula 1280 px (días, chips de tipo, popover y
   «Te aviso»). */

import { demoGuide, demoGuideProgrammes, type IptvGuideResponse } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/query.ts';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { getAvisos, resetAvisos } from '../avisos/store.ts';
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
  resetMemoryStorage();
  // jsdom no maqueta: la parrilla mide 1200 × 640 para la lista virtual.
  for (const [prop, size] of [
    ['offsetHeight', 640],
    ['offsetWidth', 1200],
  ] as const)
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('guia-grid') ? size : 0;
    });
});
const realMatchMedia = window.matchMedia;

/** Simula un ancho de pantalla para `useLayoutKind` (min-width). */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

/** jsdom no desplaza: «ahora» a la vista como en el navegador (scrollTo deja scrollLeft). */
function scrollable() {
  vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === 'object' && options.left !== undefined) this.scrollLeft = options.left;
  });
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
  resetAvisos();
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

describe('Guía de escritorio (desde 768)', () => {
  it('barra «Guía» con días y chips; un tipo filtra en el servidor y va en la URL', async () => {
    setViewport(1280);
    scrollable();
    serve();
    renderGuia();
    expect(screen.getByRole('heading', { level: 1, name: 'Guía' })).toBeInTheDocument();
    await screen.findByRole('grid', { name: 'Guía TV' });
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Favoritos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // En escritorio no hay «Favoritos | Todos» arriba: son chips.
    expect(screen.queryByRole('radio', { name: /Favoritos/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Noticias' }));
    await waitFor(() => expect(location.search).toContain('tipo=noticias'));
    await waitFor(() =>
      expect(screen.getByRole('grid', { name: 'Guía TV' })).toHaveAttribute('aria-rowcount', '4'),
    );
    const asked = net.calls.filter((call) => call.url.startsWith('/api/v1/iptv/guide?'));
    expect(queryOf(asked.at(-1) as MockCall)).toMatchObject({ scope: 'all', type: 'noticias' });
    expect(
      within(screen.getByRole('grid', { name: 'Guía TV' })).getByRole('rowheader', {
        name: /Euronews/,
      }),
    ).toBeInTheDocument();
  });

  it('pulsar un programa que aún no ha empezado abre el popover con «Te aviso»', async () => {
    setViewport(1280);
    scrollable();
    serve();
    renderGuia('?vista=guia&ambito=todos');
    const grid = await screen.findByRole('grid', { name: 'Guía TV' });
    const cell = await waitFor(() => {
      const found = within(grid)
        .getAllByRole('gridcell', { name: /, de \d\d:\d\d a \d\d:\d\d$/ })
        .find((node) => node.classList.contains('guia-block--future'));
      if (!found) throw new Error('sin programas futuros');
      return found;
    });
    fireEvent.click(cell);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^Empieza en|a las \d\d:\d\d$/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Te aviso' }));
    expect(within(dialog).getByRole('button', { name: 'Te avisaré' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(getAvisos()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Avisos: 1 pendiente' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
