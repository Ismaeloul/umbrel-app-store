/* Pelis y series en el móvil (la maquetación por defecto de estos tests):
   pestañas, Mi lista como portada y la rejilla (docs/vod.md §12.4, §12.5 y
   §13), con un servidor simulado que contesta con el catálogo de muestra. La
   portada en filas de antes se fue con el rediseño del móvil. */

import type { VodHome } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import homeNone from '@fixtures/variantes/vodHome.none.json';
import homePreparing from '@fixtures/variantes/vodHome.preparing.json';
import homeUnsupported from '@fixtures/variantes/vodHome.unsupported.json';
import { DEMO_VOD_IDS, demoVodBrowse, demoVodHome, resetDemoVod } from './demo-data.ts';
import { demoRoutes, queryOf, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

const browseCalls = () => net.calls.filter((call) => call.url.startsWith('/api/v1/vod/browse'));
/** Las peticiones de las filas de la portada (20 por categoría). */
const rowCalls = () => browseCalls().filter((call) => queryOf(call).limit === 20);
/** Las de la rejilla (páginas de 60). */
const gridCalls = () => browseCalls().filter((call) => queryOf(call).limit !== 20);

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  /* jsdom no maqueta: con un alto por fila, la lista virtual solo pinta las de la pantalla. */
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('vlist__row') ? 300 : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  net?.restore();
  resetToasts();
  resetMode();
  resetDemoVod();
  history.replaceState(null, '', '/');
});

function emptyHome(patch: Partial<VodHome>): VodHome {
  return { ...(homeNone as VodHome), ...patch };
}

describe('móvil: pestañas y Mi lista como portada (rediseño del móvil)', () => {
  it('«Pelis y series», Mi lista · N / Películas / Series y la portada sin pedir el catálogo', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    expect(screen.getByRole('heading', { level: 1, name: 'Pelis y series' })).toBeInTheDocument();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(await within(tabs).findByRole('button', { name: 'Mi lista · 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Ni el selector «Películas | Series» ni «Categorías» ni el buscador de antes.
    expect(screen.queryByRole('radio', { name: 'Películas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Categorías' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(await screen.findByRole('list', { name: 'Series' })).toBeInTheDocument();
    // Ni filas de categorías ni novedades: la portada no pide `vodBrowse`.
    expect(screen.queryByText('Novedades en películas')).toBeNull();
    expect(browseCalls()).toHaveLength(0);
  });

  it('Películas abre la rejilla (con su entrada en el historial) y Mi lista vuelve a su sitio', async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    net = mockFetch(demoRoutes());
    renderCine();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    await screen.findByRole('list', { name: 'Series' });
    // Mi lista bajada a 1.800 px.
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1800);
    fireEvent.scroll(window);
    fireEvent.click(within(tabs).getByRole('button', { name: 'Películas' }));
    expect(history.state).toMatchObject({ cineGrid: true });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las películas' }),
    ).toBeInTheDocument();
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    // La rejilla trae el buscador, las categorías en chips y el orden.
    expect(screen.getByRole('searchbox', { name: 'Buscar películas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Categorías' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Orden' })).toBeInTheDocument();
    // «Todas» es la pestaña: sin flecha.
    expect(screen.queryByRole('button', { name: 'Todas las películas' })).toBeNull();
    await waitFor(() => expect(queryOf(gridCalls().at(-1)!)).toMatchObject({ limit: 60 }));
    fireEvent.click(within(tabs).getByRole('button', { name: /^Mi lista/ }));
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1800 })),
    );
    expect(location.search).not.toContain('cinecat');
  });

  it('una categoría desde los chips: su flecha vuelve a «Todas las películas»', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    const cats = await screen.findByRole('group', { name: 'Categorías' });
    fireEvent.click(within(cats).getByRole('button', { name: /^Pelis latino/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Pelis latino' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Todas las películas' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las películas' }),
    ).toBeInTheDocument();
    expect(location.search).toContain('cinecat=all');
  });
});

describe('la rejilla (otra pantalla)', () => {
  it('cabecera, chips de categorías, distintivos, orden y carteles', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las películas' }),
    ).toBeInTheDocument();
    const cats = screen.getByRole('group', { name: 'Categorías' });
    expect(within(cats).getByRole('button', { name: 'Todas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    /* Solo la calidad: el idioma se elige con su botón de la cabecera (§4.10). */
    const tags = screen.getByRole('group', { name: 'Calidad' });
    expect(
      within(tags)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringMatching(/^Multi/), expect.stringMatching(/^4K/)]);
    const grid = await screen.findByRole('list', { name: 'Todas las películas' });
    const cells = within(grid).getAllByRole('listitem');
    expect(cells[0]).toHaveAttribute('aria-setsize', '73');
    expect(cells[0]).toHaveAttribute('aria-posinset', '1');
    expect((await screen.findAllByText('73 películas')).length).toBeGreaterThan(0);
    // La rejilla no pide las filas de la portada.
    expect(rowCalls()).toHaveLength(0);
    // Otra categoría desde los chips: misma pantalla.
    fireEvent.click(within(cats).getByRole('button', { name: /^VOSE/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'VOSE' })).toBeInTheDocument();
  });

  it('un distintivo filtra la rejilla y viaja en la URL; tocarlo otra vez lo quita', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    const tags = await screen.findByRole('group', { name: 'Calidad' });
    fireEvent.click(within(tags).getByRole('button', { name: /^4K/ }));
    await waitFor(() => expect(queryOf(gridCalls().at(-1)!).tag).toBe('4k'));
    expect(location.search).toContain('cinetag=4k');
    fireEvent.click(within(tags).getByRole('button', { name: /^4K/ }));
    await waitFor(() => expect(location.search).not.toContain('cinetag'));
    expect(within(tags).getByRole('button', { name: /^4K/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('el orden A-Z pide `sort=name`', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    fireEvent.click(await screen.findByRole('radio', { name: 'A-Z' }));
    await waitFor(() => expect(queryOf(gridCalls().at(-1)!).sort).toBe('name'));
    expect(location.search).toContain('cineorden=az');
  });

  it('categoría vacía: «Esta categoría está vacía» y «Ver todas»', async () => {
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod/browse': () =>
        json({
          active: true,
          state: 'ready',
          items: [],
          total: 0,
          capped: false,
          otherKindTotal: null,
          tags: [],
          nextCursor: null,
          stale: false,
        }),
    });
    renderCine({ search: '?vista=cine&cinecat=0123456789ab' });
    expect(
      await screen.findByRole('heading', { name: 'Esta categoría está vacía' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
    await waitFor(() => expect(location.search).toContain('cinecat=all'));
  });

  it('una página siguiente que falla: «No se han podido cargar más» y «Reintentar»', async () => {
    let calls = 0;
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod/browse': (call) => {
        calls += 1;
        if (calls > 1)
          return json(
            { error: { code: 'internal_error', message: 'Algo ha fallado.', requestId: 't' } },
            500,
          );
        // Páginas de 20 para que haya siguiente.
        return json(demoVodBrowse({ ...queryOf(call), limit: 20 }));
      },
    });
    renderCine({ search: '?vista=cine&cinecat=all' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más películas' }));
    expect(await screen.findByText('No se han podido cargar más')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('búsqueda (§12.5)', () => {
  /* Partida en dos (antes era una sola que pasaba de 15 s con la máquina
     cargada): escribir y buscar, y lo que se ofrece cuando no hay nada. */
  it('desde 2 letras, tras 250 ms, en la rejilla', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    await screen.findByRole('heading', { level: 2, name: 'Todas las películas' });
    const field = screen.getByRole('searchbox', { name: 'Buscar películas' });
    fireEvent.change(field, { target: { value: 'c' } });
    fireEvent.change(field, { target: { value: 'casa de papel' } });
    expect(location.search).toContain('cineq=casa');
    expect(
      await screen.findByRole('heading', { name: 'Nada con «casa de papel» en películas' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Resultados de «casa de papel»' }),
    ).toBeInTheDocument();
    const withQ = browseCalls().filter((call) => queryOf(call).q);
    expect(withQ.map((call) => queryOf(call).q)).toEqual(['casa de papel']);
  }, 30_000);

  it('sin nada: «Ver N series»', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cineq=casa%20de%20papel' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ver 1 serie' }));
    expect((await screen.findAllByText('1 serie')).length).toBeGreaterThan(0);
    expect(location.search).toContain('cine=series');
  }, 30_000);

  it('sin nada: «Borrar búsqueda» vuelve a la portada (Mi lista)', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cineq=casa%20de%20papel' });
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar búsqueda' }));
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    expect(location.search).not.toContain('cineq');
  }, 30_000);

  it('dentro de una categoría busca ahí y lo dice: «0 películas en 4K» y «Buscar en todas»', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: `?vista=cine&cinecat=${DEMO_VOD_IDS.movieCategory}` });
    await screen.findByRole('heading', { level: 2, name: '4K' });
    const field = screen.getByRole('searchbox', { name: 'Buscar películas' });
    fireEvent.change(field, { target: { value: 'wonka' } });
    // Wonka no está en «4K» (sí en el catálogo): no basta con «Nada con «wonka» en películas».
    expect(
      await screen.findByRole('heading', { name: 'Nada con «wonka» en 4K' }),
    ).toBeInTheDocument();
    // Bajo el título y en la región viva.
    expect(document.querySelector('.cine-browse__count')?.textContent).toBe('0 películas en 4K');
    expect(
      screen.getAllByRole('status').some((node) => node.textContent === '0 películas en 4K'),
    ).toBe(true);
    expect(queryOf(gridCalls().at(-1)!)).toMatchObject({ cat: DEMO_VOD_IDS.movieCategory });
    const everywhere = screen.getAllByRole('button', { name: 'Buscar en todas las películas' });
    expect(everywhere).toHaveLength(1);
    fireEvent.click(everywhere[0]!);
    await waitFor(() => expect(location.search).toContain('cinecat=all'));
    expect((await screen.findAllByText('1 película')).length).toBeGreaterThan(0);
    expect(field).toHaveValue('wonka');
  });

  it('en escritorio no hay panel lateral: las categorías van en la rejilla y marcan dónde se busca', async () => {
    net = mockFetch(demoRoutes());
    renderCine({
      search: `?vista=cine&cinecat=${DEMO_VOD_IDS.movieCategory}&cineq=wonka`,
      layout: { kind: 'desktop' },
    });
    expect(screen.queryByRole('navigation', { name: 'Categorías' })).toBeNull();
    await screen.findByRole('heading', { level: 2, name: 'Resultados de «wonka»' });
    const chips = screen.queryByRole('group', { name: 'Categorías' });
    // Buscando no salen los chips (como en la tableta): se dice dónde se busca.
    expect(chips).toBeNull();
    expect(
      await screen.findByRole('heading', { name: 'Nada con «wonka» en 4K' }),
    ).toBeInTheDocument();
  });

  it('en escritorio, la rejilla de una categoría lleva sus chips con la categoría marcada', async () => {
    net = mockFetch(demoRoutes());
    renderCine({
      search: `?vista=cine&cinecat=${DEMO_VOD_IDS.movieCategory}`,
      layout: { kind: 'desktop' },
    });
    const chips = await screen.findByRole('group', { name: 'Categorías' });
    expect(within(chips).getByRole('button', { name: /^4K/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Esc borra el texto y «/» enfoca el buscador', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cinecat=all' });
    const field = await screen.findByRole('searchbox', { name: 'Buscar películas' });
    expect(field).toHaveAttribute('data-focus-target', 'buscar-cine');
    fireEvent.change(field, { target: { value: 'dune' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveValue('');
  });

  it('más de 2.000 aciertos: el aviso para afinar', async () => {
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod/browse': (call) => {
        const response = demoRoutes()['GET /api/v1/vod/browse']!(call);
        return response
          .json()
          .then((body: Record<string, unknown>) => json({ ...body, capped: true }));
      },
    });
    renderCine({ search: '?vista=cine&cineq=la' });
    expect(
      await screen.findByText('Hay más de 2.000 resultados: afina la búsqueda.'),
    ).toBeInTheDocument();
  });
});

describe('estados sin catálogo (§13): siempre con salida', () => {
  it('sin IPTV: «Conecta tu IPTV» con «Ir a Ajustes»', async () => {
    net = mockFetch({
      'GET /api/v1/vod': emptyHome({ active: false, state: 'off' }),
      'GET /api/v1/iptv': { provider: null, refreshHours: 6 },
    });
    renderCine();
    expect(await screen.findByRole('heading', { name: 'Conecta tu IPTV' })).toBeInTheDocument();
    expect(
      screen.getByText('Las películas y series salen de tu IPTV. Conéctala en Ajustes.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a Ajustes' }));
    await waitFor(() => expect(location.search).toContain('vista=ajustes/iptv'));
    expect(browseCalls()).toHaveLength(0);
  });

  it('IPTV en pausa', async () => {
    const { demoIptvView } = await import('../../api/demo/index.ts');
    const view = demoIptvView();
    net = mockFetch({
      'GET /api/v1/vod': emptyHome({ active: false, state: 'off' }),
      'GET /api/v1/iptv': { ...view, provider: { ...view.provider!, enabled: false } },
    });
    renderCine();
    expect(
      await screen.findByRole('heading', { name: 'Tu IPTV está en pausa.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Ajustes' })).toBeInTheDocument();
  });

  it('M3U: «Tu IPTV es una lista M3U»', async () => {
    net = mockFetch({ 'GET /api/v1/vod': homeUnsupported });
    renderCine();
    expect(
      await screen.findByRole('heading', { name: 'Tu IPTV es una lista M3U' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Ajustes' })).toBeInTheDocument();
  });

  it('sin películas ni series: «Comprobar de nuevo» actualiza la IPTV', async () => {
    const { demoIptvView } = await import('../../api/demo/index.ts');
    net = mockFetch({ 'GET /api/v1/vod': homeNone, 'POST /api/v1/iptv/sync': demoIptvView() });
    renderCine();
    expect(
      await screen.findByRole('heading', { name: 'Tu IPTV no tiene películas ni series' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }));
    await waitFor(() =>
      expect(net.calls.some((call) => call.url === '/api/v1/iptv/sync')).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Ir a Ajustes' })).toBeInTheDocument();
  });

  it('preparando: esqueletos y el aviso de la primera vez', async () => {
    net = mockFetch({ 'GET /api/v1/vod': homePreparing });
    renderCine();
    expect(
      await screen.findByText('Preparando el catálogo… La primera vez tarda unos segundos.'),
    ).toBeInTheDocument();
  });

  it('error sin catálogo, o la portada que no llega: «Reintentar»', async () => {
    net = mockFetch({ 'GET /api/v1/vod': emptyHome({ state: 'error' }) });
    renderCine();
    expect(
      await screen.findByRole('heading', { name: 'No se ha podido cargar el catálogo' }),
    ).toBeInTheDocument();
    net.restore();
    net = mockFetch(demoRoutes());
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('list', { name: 'Series' })).toBeInTheDocument();
  });

  it('catálogo viejo y recortado: las dos notas', async () => {
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod': () =>
        json({
          ...demoVodHome(),
          stale: true,
          truncated: true,
          builtAt: '2026-09-28T04:00:00.000Z',
          counts: { movies: 400_000, series: 12 },
        }),
    });
    renderCine();
    expect(
      await screen.findByText(/^Catálogo del 28 sept?\. No se ha podido actualizar\.$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tu IPTV tiene más de 400.000 películas; se ven las primeras 400.000.'),
    ).toBeInTheDocument();
  });

  it('oculta, no pide nada', async () => {
    net = mockFetch(demoRoutes());
    const { default: CineView } = await import('./CineView.tsx');
    renderCine({ ui: <CineView route={{ vista: 'cine', id: null }} active={false} /> });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(net.calls.filter((call) => call.url.startsWith('/api/v1/vod'))).toHaveLength(0);
  });
});
