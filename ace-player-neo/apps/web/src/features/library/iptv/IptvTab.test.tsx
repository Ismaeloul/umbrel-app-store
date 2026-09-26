/* Pestaña IPTV de Canales (docs/iptv.md §16.6), montada dentro de la vista
   Canales con un `iptvBrowse` simulado que contesta como el servidor (la
   lógica de la demo sobre la «IPTV de ejemplo»). */

import type {
  BootstrapResponse,
  IptvBrowseQuery,
  IptvBrowseResponse,
  LibraryView as LibraryData,
} from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../../api/mode.ts';
import { routeKey } from '../../../api/query.ts';
import { resetToasts } from '../../../notices/toasts.ts';
import { fixture, json, mockFetch, type MockCall } from '../../../test/fetch.ts';
import LibraryView from '../LibraryView.tsx';
import { resetPending } from '../data.ts';
import { takeChannelTap } from '../play.ts';
import { selectionStore } from '../selection.ts';
import { makeItem, makeLibrary, renderWithApp, resetPlayback } from '../test-utils.tsx';
import { demoCategoryId, demoIptvBrowse } from './demo.ts';

let net: ReturnType<typeof mockFetch>;

function queryOf(call: MockCall): Partial<IptvBrowseQuery> {
  const params = new URL(call.url, 'http://x').searchParams;
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) out[key] = key === 'limit' ? Number(value) : value;
  return out as Partial<IptvBrowseQuery>;
}

const browseCalls = () => net.calls.filter((c) => c.url.startsWith('/api/v1/iptv/browse'));

function setup({
  search = '?vista=biblioteca&pestana=iptv',
  iptv = true,
  browse = (call: MockCall) => json(demoIptvBrowse(queryOf(call))),
  layout = {},
  library = makeLibrary(),
}: {
  search?: string;
  iptv?: boolean;
  library?: LibraryData;
  browse?: (call: MockCall) => Response | Promise<Response>;
  layout?: Parameters<typeof renderWithApp>[1] extends infer O
    ? O extends { layout?: infer L }
      ? L
      : never
    : never;
} = {}) {
  net = mockFetch({
    'GET /api/v1/library': library,
    'POST /api/v1/library': library,
    'GET /api/v1/iptv/browse': browse,
  });
  const view = renderWithApp(<LibraryView route={{ vista: 'biblioteca' }} active />, {
    search,
    layout,
  });
  const boot = fixture<BootstrapResponse>('bootstrap');
  act(() => {
    view.client.setQueryData(routeKey('bootstrap'), {
      ...boot,
      features: { ...boot.features, iptv },
    });
  });
  return view;
}

const DESKTOP = {
  kind: 'desktop' as const,
  asideVisible: false,
  asideAvailable: false,
};

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  /* jsdom no maqueta: sin esto cada fila mide 0, la lista virtual las pinta
     todas y pide página tras página hasta el final. Con 76 px por fila, como
     en el navegador, solo se pintan las de la pantalla. */
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('vlist__row') ? 76 : 0;
  });
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetPending();
  resetToasts();
  resetMode();
  resetPlayback();
  selectionStore.set(null);
});

describe('la pestaña', () => {
  it('sin IPTV no hay pestaña «IPTV» y `&pestana=iptv` abre la de siempre', async () => {
    setup({ iptv: false });
    expect(await screen.findByRole('tab', { name: /Favoritos/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'IPTV' })).not.toBeInTheDocument();
    expect(browseCalls()).toHaveLength(0);
  });

  it('con IPTV sale a la derecha de Listas, sin contador, y la raíz pide solo categorías y facetas', async () => {
    setup();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Favoritos2', 'Recientes1', 'Listas3', 'IPTV']);
    expect(screen.getByRole('tab', { name: 'IPTV' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('812 canales · 20 categorías')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Categorías' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Todos los canales, 812 canales');
    expect(buttons[1]).toHaveAccessibleName(/^ES \| DEPORTES, \d+ canales$/);
    expect(
      within(list).getByRole('button', { name: 'Sin categoría, 9 canales' }),
    ).toBeInTheDocument();
    expect(queryOf(browseCalls()[0]!)).toEqual({ limit: 0 });
    // En esta pestaña el campo busca en tu IPTV y no sale «Emitiendo ahora».
    expect(screen.getByRole('searchbox', { name: 'Buscar en tu IPTV' })).toBeInTheDocument();
  });
});

describe('categorías y canales', () => {
  it('entrar en una categoría: URL, título con el foco, filas con «IPTV» y calidades; volver con el foco en ella', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'ES | DAZN, 15 canales' }));
    const title = await screen.findByRole('heading', { name: 'ES | DAZN', level: 2 });
    await waitFor(() => expect(title).toHaveFocus());
    expect(new URLSearchParams(location.search).get('cat')).toBe(demoCategoryId('ES | DAZN'));
    expect(screen.getByRole('searchbox', { name: 'Buscar en ES | DAZN' })).toBeInTheDocument();
    const f1 = await screen.findByRole('link', { name: 'DAZN F1' });
    const row = f1.closest('article')!;
    expect(within(row).getByText('IPTV')).toBeInTheDocument();
    expect(within(row).getByText('1080p')).toBeInTheDocument();
    expect(within(row).getByText('720p')).toBeInTheDocument();
    expect(within(row).getByText('España')).toBeInTheDocument();
    expect(f1.closest('[role="listitem"]')).toHaveAttribute('aria-setsize', '15');
    fireEvent.click(screen.getByRole('button', { name: 'Volver a las categorías' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ES | DAZN, 15 canales' })).toHaveFocus(),
    );
    expect(new URLSearchParams(location.search).get('cat')).toBeNull();
  });

  it('tocar una fila la reproduce como en el buscador: IPTV primero con su id', async () => {
    setup({ search: `?vista=biblioteca&pestana=iptv&cat=${demoCategoryId('ES | DAZN')}` });
    fireEvent.click(await screen.findByRole('link', { name: 'DAZN F1' }));
    const id = demoIptvBrowse({ q: 'dazn f1' }).channels[0]!.id;
    await waitFor(() => expect(screen.getByTestId('ruta').textContent).toBe(`partido/canal/${id}`));
    expect(takeChannelTap(id)).toMatchObject({ hash: id, title: 'DAZN F1', iptv: id, ih: false });
  });

  it('la estrella lo guarda como favorito IPTV (categoría «IPTV» y alias)', async () => {
    setup({ search: `?vista=biblioteca&pestana=iptv&cat=${demoCategoryId('ES | DAZN')}` });
    await screen.findByRole('link', { name: 'DAZN F1' });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir DAZN F1 a favoritos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guardar favorito' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
    await waitFor(() =>
      expect(net.calls.some((c) => c.method === 'POST' && c.url === '/api/v1/library')).toBe(true),
    );
    const post = net.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      action: 'favorite-upsert',
      item: { title: 'DAZN F1', category: 'IPTV', alias: 'DAZN F1', ih: false },
    });
  });

  it('la hoja «Guardar favorito» de un canal IPTV enseña su nombre en la IPTV, no un «Hash»', async () => {
    setup({ search: `?vista=biblioteca&pestana=iptv&cat=${demoCategoryId('ES | DAZN')}` });
    await screen.findByRole('link', { name: 'DAZN F1' });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir DAZN F1 a favoritos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guardar favorito' });
    expect(within(dialog).getByText('En tu IPTV')).toBeInTheDocument();
    expect(within(dialog).queryByText('Hash')).not.toBeInTheDocument();
  });

  it('quitar un favorito vacía la estrella al momento; otro toque durante el «Deshacer» lo recupera', async () => {
    const id = demoIptvBrowse({ q: 'dazn f1' }).channels[0]!.id;
    const favorite = makeItem('DAZN F1', 'fav', { id, category: 'IPTV', ih: false });
    setup({
      search: `?vista=biblioteca&pestana=iptv&cat=${demoCategoryId('ES | DAZN')}`,
      library: makeLibrary({ favorites: [favorite] }),
    });
    await screen.findByRole('link', { name: 'DAZN F1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar DAZN F1 de favoritos' }));
    const add = await screen.findByRole('button', { name: 'Añadir DAZN F1 a favoritos' });
    expect(await screen.findByText('«DAZN F1» quitado de favoritos')).toBeInTheDocument();
    fireEvent.click(add);
    expect(
      await screen.findByRole('button', { name: 'Quitar DAZN F1 de favoritos' }),
    ).toBeInTheDocument();
    // Sin hoja de «Guardar favorito» y sin baja en el servidor.
    expect(screen.queryByRole('dialog', { name: 'Guardar favorito' })).not.toBeInTheDocument();
    expect(net.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('«Cargar más canales» pide la página siguiente con su cursor', async () => {
    setup({ search: '?vista=biblioteca&pestana=iptv&cat=todos' });
    await screen.findByRole('heading', { name: 'Todos los canales', level: 2 });
    const more = await screen.findByRole('button', { name: 'Cargar más canales' });
    const before = browseCalls().length;
    fireEvent.click(more);
    await waitFor(() => expect(browseCalls().length).toBe(before + 1));
    expect(queryOf(browseCalls().at(-1)!)).toMatchObject({ limit: 60, cursor: expect.any(String) });
    // Solo se pintan las filas de la pantalla (lista virtual), no los 812.
    expect(document.querySelectorAll('.vlist__row').length).toBeLessThan(60);
  });

  it('fallo de una página siguiente: «No se pudieron cargar más canales.» con «Reintentar»', async () => {
    let fail = true;
    setup({
      search: '?vista=biblioteca&pestana=iptv&cat=todos',
      browse: (call) =>
        queryOf(call).cursor && fail
          ? json({ error: { code: 'internal_error', message: 'x', requestId: 'r' } }, 500)
          : json(demoIptvBrowse(queryOf(call))),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más canales' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudieron cargar más canales.');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Cargar más canales' })).toBeInTheDocument();
  });

  it('`stale` en una página siguiente: la lista empieza de nuevo', async () => {
    let page = 0;
    setup({
      search: '?vista=biblioteca&pestana=iptv&cat=todos',
      browse: (call) => {
        const query = queryOf(call);
        const response: IptvBrowseResponse = demoIptvBrowse({ ...query, cursor: undefined });
        page += 1;
        return json(query.cursor ? { ...response, stale: true } : response);
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más canales' }));
    // La página 2 dice `stale`: se vuelve a pedir la primera (sin cursor).
    await waitFor(() => expect(page).toBeGreaterThanOrEqual(3));
    expect(queryOf(browseCalls().at(-1)!).cursor).toBeUndefined();
  });
});

describe('buscador dentro de la pestaña', () => {
  it('«acb» en la raíz, tras 450 ms: los 7 «DAZN ACB» y la región viva', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await screen.findByText('812 canales · 20 categorías');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en tu IPTV' }), {
      target: { value: 'acb' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(await screen.findByRole('link', { name: 'DAZN ACB 7' })).toBeInTheDocument();
    expect(queryOf(browseCalls().at(-1)!)).toMatchObject({ q: 'acb', limit: 60 });
    await waitFor(() =>
      expect(screen.getByText('7 canales con «acb»')).toHaveAttribute('role', 'status'),
    );
  });

  it('nada con el texto: «Nada en tu IPTV con «q».» con el botón a Buscar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await screen.findByText('812 canales · 20 categorías');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en tu IPTV' }), {
      target: { value: 'zzzz' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(await screen.findByText('Nada en tu IPTV con «zzzz».')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar «zzzz» en tu IPTV y el motor' }));
    await waitFor(() => expect(screen.getByTestId('ruta').textContent).toBe('buscar'));
  });

  it('nada con el texto y filtros: lo dice y ofrece «Quitar filtros» primero (también en el móvil)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup({ search: '?vista=biblioteca&pestana=iptv&tipo=adultos' });
    await screen.findByRole('button', { name: 'Filtros, 1 elegido' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en tu IPTV' }), {
      target: { value: 'dazn' },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(
      await screen.findByText('Nada en tu IPTV con «dazn» y estos filtros.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buscar «dazn» en tu IPTV y el motor' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(new URLSearchParams(location.search).get('tipo')).toBeNull();
  });
});

describe('filtros', () => {
  it('escritorio: una línea por faceta con aria-pressed y recuento; se combinan y van a la URL', async () => {
    setup({ layout: DESKTOP });
    const pais = await screen.findByRole('group', { name: 'País' });
    const spain = within(pais).getByRole('button', { name: 'España, 420 canales' });
    expect(spain).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(spain);
    expect(new URLSearchParams(location.search).get('pais')).toBe('ES');
    await waitFor(() => expect(queryOf(browseCalls().at(-1)!)).toMatchObject({ country: 'ES' }));
    const deporte = screen.getByRole('group', { name: 'Deporte' });
    fireEvent.click(await within(deporte).findByRole('button', { name: /^Fútbol, \d+ canales$/ }));
    await waitFor(() =>
      expect(queryOf(browseCalls().at(-1)!)).toMatchObject({ country: 'ES', sport: 'futbol' }),
    );
    expect(await screen.findByText(/^\d+ de 812 canales$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(new URLSearchParams(location.search).get('pais')).toBeNull();
  });

  it('móvil: «Filtros» abre la hoja; «Ver {N} canales» y «Quitar filtros»', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Adultos, 5 canales' }));
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: 'Ver 5 canales' })).toBeInTheDocument(),
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 5 canales' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // En la fila de chips, el elegido con su ×.
    expect(screen.getByRole('button', { name: 'Quitar el filtro Adultos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtros, 1 elegido' })).toBeInTheDocument();
  });

  it('móvil: con dos filtros o más, «Quitar filtros» también en la fila de chips', async () => {
    setup({ search: '?vista=biblioteca&pestana=iptv&tipo=deportes&pais=ES' });
    await screen.findByRole('button', { name: 'Filtros, 2 elegidos' });
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(new URLSearchParams(location.search).get('tipo')).toBeNull();
    expect(new URLSearchParams(location.search).get('pais')).toBeNull();
  });

  it('ningún canal con estos filtros: el vacío con «Quitar filtros»', async () => {
    setup({ search: '?vista=biblioteca&pestana=iptv&cat=todos&tipo=adultos&pais=ES' });
    expect(
      await screen.findByRole('heading', { name: 'Ningún canal con estos filtros.' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar filtros' }).at(-1)!);
    expect(new URLSearchParams(location.search).get('tipo')).toBeNull();
  });
});

describe('estados', () => {
  it('error de la primera página: «No se pudo cargar tu IPTV.» con «Reintentar»', async () => {
    let fail = true;
    setup({
      browse: (call) =>
        fail
          ? json({ error: { code: 'internal_error', message: 'x', requestId: 'r' } }, 500)
          : json(demoIptvBrowse(queryOf(call))),
    });
    expect(await screen.findByText('No se pudo cargar tu IPTV.')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('812 canales · 20 categorías')).toBeInTheDocument();
  });

  it('IPTV en pausa (`active: false`): el vacío con «Ir a Ajustes»', async () => {
    setup({ browse: () => json(pausedResponse()) });
    expect(await screen.findByText('Tu IPTV está en pausa.')).toBeInTheDocument();
    expect(
      screen.getByText('Reanúdala en Ajustes → IPTV para ver sus canales.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a Ajustes' }));
    await waitFor(() => expect(screen.getByTestId('ruta').textContent).toBe('ajustes/iptv'));
  });

  it('una categoría que ya no existe: «Esta categoría ya no está en tu IPTV.»', async () => {
    setup({ search: '?vista=biblioteca&pestana=iptv&cat=abcdefabcdef' });
    expect(await screen.findByText('Esta categoría ya no está en tu IPTV.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver categorías' }));
    expect(await screen.findByText('812 canales · 20 categorías')).toBeInTheDocument();
  });
});

function pausedResponse(): IptvBrowseResponse {
  return {
    active: false,
    provider: '',
    catalog: '0',
    query: '',
    category: null,
    total: 0,
    catalogTotal: 0,
    channels: [],
    nextCursor: null,
    stale: false,
  };
}
