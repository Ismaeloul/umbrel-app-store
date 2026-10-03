/* Portada en filas y rejilla de Películas y series (docs/vod.md §12.4, §12.5 y
   §13; pendiente.md punto 7: «como los partidos») con un servidor simulado
   que contesta con el catálogo de muestra. */

import type { VodHome } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import homeNone from '@fixtures/variantes/vodHome.none.json';
import homePreparing from '@fixtures/variantes/vodHome.preparing.json';
import homeUnsupported from '@fixtures/variantes/vodHome.unsupported.json';
import CineAside from './aside.tsx';
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

describe('portada en filas, como la agenda', () => {
  it('título, selector, buscador, «Seguir viendo», novedades y una fila por categoría (sin rejilla)', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Películas y series' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Películas' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('searchbox', { name: 'Buscar películas' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Seguir viendo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Novedades en películas' })).toBeInTheDocument();
    // Una fila por categoría, en el orden del proveedor (las de adultos al final, como las demás).
    const rows = (await screen.findAllByRole('heading', { level: 2, name: /películas$/ })).filter(
      (row) => row.closest('[data-cat]'),
    );
    expect(rows.map((row) => row.querySelector('.cine-row__name')?.textContent)).toEqual([
      'ESTRENOS 2024',
      'VOD | 4K',
      'CINE ESPAÑOL',
      'PELIS LATINO',
      'ANIMACIÓN',
      'CLÁSICOS',
      'VOSE',
      'EN | MOVIES',
      'FR | FILMS',
      'XXX | ADULTOS',
    ]);
    await waitFor(() => expect(rowCalls()).toHaveLength(10));
    expect(rowCalls().every((call) => queryOf(call).sort === 'added')).toBe(true);
    const k4 = await screen.findByRole('list', { name: 'VOD | 4K' });
    expect(within(k4).getAllByRole('link').length).toBe(9);
    // La portada no pide la rejilla: esa es otra pantalla.
    expect(gridCalls()).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Todas las películas' })).toBeNull();
    // «Seguir viendo» de Películas: solo películas, con lo que queda (los
    // episodios van en el de Series).
    expect(screen.getByRole('button', { name: /^Dune\. Quedan 1 h 53 min$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^The Office\./ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver las 73 películas' })).toBeInTheDocument();
  });

  it('«Seguir viendo» de Series: los episodios (y ninguna película)', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cine=series' });
    expect(
      await screen.findByRole('button', { name: /^The Office\. Siguiente: T2 · E6/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Dune\./ })).toBeNull();
  });

  it('las filas se piden al acercarse a la pantalla, no todas de golpe', async () => {
    const observers: Array<{ cb: IntersectionObserverCallback; nodes: Element[] }> = [];
    class FakeObserver {
      private entry: { cb: IntersectionObserverCallback; nodes: Element[] };
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb, nodes: [] };
        observers.push(this.entry);
      }
      observe(node: Element) {
        this.entry.nodes.push(node);
      }
      disconnect() {
        this.entry.nodes = [];
      }
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    net = mockFetch(demoRoutes());
    renderCine();
    await screen.findByRole('heading', { name: 'Seguir viendo' });
    await screen.findAllByRole('heading', { level: 2, name: /películas$/ });
    expect(rowCalls()).toHaveLength(0);
    const k4 = observers.find((o) =>
      o.nodes.some((node) => node.getAttribute('data-cat') === DEMO_VOD_IDS.movieCategory),
    )!;
    act(() =>
      k4.cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        k4 as unknown as IntersectionObserver,
      ),
    );
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    expect(queryOf(rowCalls()[0]!).cat).toBe(DEMO_VOD_IDS.movieCategory);
  });

  it('«Ver todo» abre la rejilla de la categoría como otra pantalla; «Volver» regresa a la portada', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver todo: VOD | 4K, 9 películas' }));
    expect(location.search).toContain(`cinecat=${DEMO_VOD_IDS.movieCategory}`);
    // Su propia entrada en el historial: «Atrás» del navegador vuelve a la portada.
    expect(history.state).toMatchObject({ cineGrid: true });
    expect(await screen.findByRole('heading', { level: 2, name: 'VOD | 4K' })).toBeInTheDocument();
    const grid = await screen.findByRole('list', { name: 'VOD | 4K' });
    expect(within(grid).getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize', '9');
    expect(screen.queryByRole('heading', { name: 'Seguir viendo' })).toBeNull();
    await waitFor(() =>
      expect(queryOf(gridCalls().at(-1)!)).toMatchObject({
        cat: DEMO_VOD_IDS.movieCategory,
        limit: 60,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Películas y series' }));
    expect(await screen.findByRole('heading', { name: 'Seguir viendo' })).toBeInTheDocument();
    await waitFor(() => expect(location.search).not.toContain('cinecat'));
  });

  it('con el teclado, el foco va al título de la rejilla y vuelve al «Ver todo» del que se vino', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    const seeAll = await screen.findByRole('button', { name: 'Ver todo: VOD | 4K, 9 películas' });
    seeAll.focus();
    fireEvent.click(seeAll);
    // La portada se oculta con el botón dentro: el foco no se queda en algo invisible.
    const title = await screen.findByRole('heading', { level: 2, name: 'VOD | 4K' });
    await waitFor(() => expect(title).toHaveFocus());
    const back = screen.getByRole('button', { name: 'Volver a Películas y series' });
    back.focus();
    fireEvent.click(back);
    // La flecha desaparece con la rejilla: el foco vuelve a la fila de la que se vino.
    await waitFor(() => expect(seeAll).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('volver a la portada la deja donde estaba; si se cambió a Series en la rejilla, en Series', async () => {
    const scrollTo = vi.mocked(window.scrollTo);
    net = mockFetch(demoRoutes());
    renderCine();
    await screen.findByRole('heading', { name: 'Novedades en películas' });
    // La portada bajada a 1.800 px.
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1800);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todo: VOD | 4K, 9 películas' }));
    await screen.findByRole('heading', { level: 2, name: 'VOD | 4K' });
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Películas y series' }));
    await screen.findByRole('heading', { name: 'Novedades en películas' });
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1800 })),
    );
    // Rejilla de películas → «Series» → «‹»: la portada de SERIES (y arriba: es otra).
    fireEvent.click(screen.getByRole('button', { name: 'Ver todo: VOD | 4K, 9 películas' }));
    await screen.findByRole('heading', { level: 2, name: 'VOD | 4K' });
    fireEvent.click(screen.getByRole('radio', { name: 'Series' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las series' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Películas y series' }));
    expect(await screen.findByRole('heading', { name: 'Series actualizadas' })).toBeInTheDocument();
    await waitFor(() => expect(location.search).toContain('cine=series'));
    expect(location.search).not.toContain('cinecat');
    expect(screen.getByRole('radio', { name: 'Series' })).toHaveAttribute('aria-checked', 'true');
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
  });

  it('«Series» cambia de tipo, de novedades y de filas (sigue en la portada)', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    await screen.findByRole('heading', { name: 'Novedades en películas' });
    fireEvent.click(screen.getByRole('radio', { name: 'Series' }));
    expect(await screen.findByRole('heading', { name: 'Series actualizadas' })).toBeInTheDocument();
    expect(location.search).toContain('cine=series');
    expect(location.search).not.toContain('cinecat');
    expect(screen.getByRole('searchbox', { name: 'Buscar series' })).toBeInTheDocument();
    await waitFor(() => expect(queryOf(rowCalls().at(-1)!).kind).toBe('series'));
  });

  it('en el móvil, «Categorías» abre la hoja y una categoría abre su rejilla', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    fireEvent.click(await screen.findByRole('button', { name: 'Categorías' }));
    const sheet = await screen.findByRole('dialog', { name: 'Todas las categorías' });
    fireEvent.click(within(sheet).getByRole('button', { name: /^PELIS LATINO/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'PELIS LATINO' }),
    ).toBeInTheDocument();
    expect(location.search).toContain('cinecat=');
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
  it('desde 2 letras, tras 250 ms, y buscando no salen «Seguir viendo» ni las filas', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    await screen.findByRole('heading', { name: 'Seguir viendo' });
    const field = screen.getByRole('searchbox', { name: 'Buscar películas' });
    fireEvent.change(field, { target: { value: 'c' } });
    fireEvent.change(field, { target: { value: 'casa de papel' } });
    expect(location.search).toContain('cineq=casa');
    expect(
      await screen.findByRole('heading', { name: 'Nada con «casa de papel» en películas' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seguir viendo' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Resultados de «casa de papel»' }),
    ).toBeInTheDocument();
    const withQ = browseCalls().filter((call) => queryOf(call).q);
    expect(withQ.map((call) => queryOf(call).q)).toEqual(['casa de papel']);
  }, 30_000);

  it('sin nada: «Ver N series» y «Borrar búsqueda»', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: '?vista=cine&cineq=casa%20de%20papel' });
    fireEvent.click(await screen.findByRole('button', { name: 'Ver 1 serie' }));
    expect((await screen.findAllByText('1 serie')).length).toBeGreaterThan(0);
    expect(location.search).toContain('cine=series');
    fireEvent.click(screen.getByRole('radio', { name: 'Películas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar búsqueda' }));
    expect(screen.getByRole('searchbox', { name: 'Buscar películas' })).toHaveValue('');
    expect(await screen.findByRole('heading', { name: 'Seguir viendo' })).toBeInTheDocument();
  }, 30_000);

  it('dentro de una categoría busca ahí y lo dice: «0 películas en VOD | 4K» y «Buscar en todas»', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ search: `?vista=cine&cinecat=${DEMO_VOD_IDS.movieCategory}` });
    await screen.findByRole('heading', { level: 2, name: 'VOD | 4K' });
    const field = screen.getByRole('searchbox', { name: 'Buscar películas' });
    fireEvent.change(field, { target: { value: 'wonka' } });
    // Wonka no está en «VOD | 4K» (sí en el catálogo): no basta con «Nada con «wonka» en películas».
    expect(
      await screen.findByRole('heading', { name: 'Nada con «wonka» en VOD | 4K' }),
    ).toBeInTheDocument();
    // Bajo el título y en la región viva.
    expect(document.querySelector('.cine-browse__count')?.textContent).toBe(
      '0 películas en VOD | 4K',
    );
    expect(
      screen.getAllByRole('status').some((node) => node.textContent === '0 películas en VOD | 4K'),
    ).toBe(true);
    expect(queryOf(gridCalls().at(-1)!)).toMatchObject({ cat: DEMO_VOD_IDS.movieCategory });
    const everywhere = screen.getAllByRole('button', { name: 'Buscar en todas las películas' });
    expect(everywhere).toHaveLength(1);
    fireEvent.click(everywhere[0]!);
    await waitFor(() => expect(location.search).toContain('cinecat=all'));
    expect((await screen.findAllByText('1 película')).length).toBeGreaterThan(0);
    expect(field).toHaveValue('wonka');
  });

  it('el panel lateral marca la categoría en la que se busca (y nada si se busca desde la portada)', async () => {
    net = mockFetch(demoRoutes());
    const aside = <CineAside route={{ vista: 'cine', id: null }} active />;
    const first = renderCine({
      search: `?vista=cine&cinecat=${DEMO_VOD_IDS.movieCategory}&cineq=wonka`,
      layout: { kind: 'desktop', asideVisible: true },
      ui: aside,
    });
    const nav = await screen.findByRole('navigation', { name: 'Categorías' });
    expect(within(nav).getByRole('button', { name: /^VOD \| 4K/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    first.unmount();
    renderCine({
      search: '?vista=cine&cineq=wonka',
      layout: { kind: 'desktop', asideVisible: true },
      ui: aside,
    });
    const again = await screen.findByRole('navigation', { name: 'Categorías' });
    expect(
      within(again)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);
  });

  it('Esc borra el texto y «/» enfoca el buscador', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
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
    expect(await screen.findByRole('heading', { name: 'Seguir viendo' })).toBeInTheDocument();
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
          counts: { movies: 200_000, series: 12 },
        }),
    });
    renderCine();
    expect(
      await screen.findByText(/^Catálogo del 28 sept?\. No se ha podido actualizar\.$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tu IPTV tiene más de 200.000 películas; se ven las primeras 200.000.'),
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
