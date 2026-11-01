/* Pelis y series en escritorio (rediseño, pantalla 5): pestañas «Mi lista ·
   N», «Películas» y «Series» en la barra (sin «Inicio»), la portada = Mi
   lista («Seguir viendo» y la lista partida en Series y Películas, sin
   novedades ni estrenos) y la ficha con «Seguir · T1 E3»,
   Mi lista / Ver juntos / Tráiler / Compartir y el siguiente episodio
   marcado. Desde el rediseño del móvil, lo mismo por debajo de 768 px, con
   el destacado de «Seguir viendo» arriba de Mi lista (al final). */

import type { VodContinue } from '@ace/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { shortcutStore } from '../../app/shortcuts.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import {
  DEMO_VOD_IDS,
  demoListRemove,
  demoVodHome,
  demoVodList,
  resetDemoVod,
} from './demo-data.ts';
import {
  DESTACADO_MAX,
  destacadoFollow,
  halfBadge,
  heroLine,
  listSections,
  splitSubtitle,
} from './Escaparate.tsx';
import { deskColumnsFor } from './model.ts';
import { demoRoutes, queryOf, renderCine } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('vlist__row') ? 300 : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  net?.restore();
  resetToasts();
  resetMode();
  resetDemoVod();
  history.replaceState(null, '', '/');
});

const desk = { layout: { kind: 'desktop' as const } };

function entry(patch: Partial<VodContinue>): VodContinue {
  return {
    id: 'a'.repeat(40),
    kind: 'episode',
    seriesId: 'b'.repeat(40),
    title: 'La casa de papel',
    subtitle: 'T3 · E4 · Dame la mano',
    posS: 900,
    durS: 2760,
    isNext: false,
    art: null,
    updatedAt: '2026-09-23T10:00:00.000Z',
    ...patch,
  };
}

describe('textos de la portada de escritorio', () => {
  it('parte «T3 · E4 · Dame la mano» y escribe la línea y la cápsula', () => {
    expect(splitSubtitle('T3 · E4 · Dame la mano')).toEqual({
      code: 'T3 · E4',
      name: 'Dame la mano',
    });
    expect(splitSubtitle('Especial 2 · Gala')).toEqual({ code: 'Especial 2', name: 'Gala' });
    expect(splitSubtitle(null)).toEqual({ code: null, name: null });
    const episode = entry({});
    expect(heroLine(episode)).toBe('T3 · E4 «Dame la mano» · quedan 31 min');
    expect(halfBadge(episode)).toBe('T3 · E4');
    const next = entry({ isNext: true, posS: 0 });
    expect(heroLine(next)).toBe('Siguiente: T3 · E4 «Dame la mano»');
    const movie = entry({ kind: 'movie', seriesId: null, subtitle: null, posS: 4320, durS: 9960 });
    expect(heroLine(movie)).toBe('1:12 de 2:46 · quedan 1 h 34 min');
    expect(halfBadge(movie)).toBe('1:12 de 2:46');
  });

  it('la rejilla de escritorio pone carteles de unos 150 px', () => {
    expect(deskColumnsFor(999)).toBe(5);
    expect(deskColumnsFor(1000)).toBe(6);
    expect(deskColumnsFor(400)).toBe(4);
  });
});

describe('escritorio: pestañas y portada (Mi lista)', () => {
  it('parte Mi lista en Series y Películas (una vacía no sale)', () => {
    const items = demoVodList().items;
    expect(listSections(items).map((section) => section.kind)).toEqual(['series', 'movie']);
    const movies = items.filter((item) => item.kind === 'movie');
    expect(listSections(movies).map((section) => section.kind)).toEqual(['movie']);
    expect(listSections([])).toEqual([]);
  });

  it('sin «Inicio»: la portada es Mi lista, con Seguir viendo, Series y Películas', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pelis y series' })).toBeVisible();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(within(tabs).queryByRole('button', { name: 'Inicio' })).toBeNull();
    const mine = await within(tabs).findByRole('button', { name: 'Mi lista · 4' });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    const names = within(tabs)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names).toEqual(['Mi lista · 4', 'Películas', 'Series']);
    // De arriba abajo: lo empezado, y la lista partida en dos.
    const headings = (await screen.findAllByRole('heading', { level: 2 })).map(
      (heading) => heading.textContent,
    );
    const halfCount = demoVodHome().continue.length;
    expect(headings).toEqual([`Seguir viendo, ${halfCount}`, 'Series, 2', 'Películas, 2']);
    const series = screen.getByRole('list', { name: 'Series' });
    expect(within(series).getByRole('link', { name: /^The Office/ })).toBeVisible();
    expect(within(series).queryByRole('link', { name: /^Coco/ })).toBeNull();
    const movies = screen.getByRole('list', { name: 'Películas' });
    // En latino y con todo elegido: en Mi lista sale igual.
    expect(within(movies).getByRole('link', { name: /^Coco/ })).toBeVisible();
    const continuing = screen.getByRole('list', { name: 'Seguir viendo' });
    expect(within(continuing).getByRole('button', { name: /^Dune\. / })).toBeVisible();
    // Ni el destacado de antes ni novedades ni estrenos.
    expect(screen.queryByRole('group', { name: 'Cambiar lo destacado' })).toBeNull();
    expect(screen.queryByText('Novedades en películas')).toBeNull();
    expect(screen.queryByText('Series actualizadas')).toBeNull();
    // Sin el buscador de la rejilla: en la portada está el de la barra (Ctrl K).
    expect(screen.queryByRole('searchbox', { name: 'Buscar películas' })).toBeNull();
  });

  it('la URL de la antigua pestaña Mi lista (`cinecat=milista`) cae en la portada', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ ...desk, search: '?vista=cine&cinecat=milista' });
    const tabs = await screen.findByRole('group', { name: 'Secciones de Pelis y series' });
    expect(await within(tabs).findByRole('button', { name: 'Mi lista · 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    expect(screen.getByRole('list', { name: 'Películas' })).toBeVisible();
    // Ni la rejilla del móvil («Mi lista» con su flecha) ni una petición al catálogo.
    expect(screen.queryByRole('button', { name: 'Volver a Películas y series' })).toBeNull();
    expect(net.calls.some((call) => call.url.includes('/vod/browse'))).toBe(false);
  });

  it('`cinecat=milista` con distintivo o texto escrito a mano también cae en la portada', async () => {
    net = mockFetch(demoRoutes());
    renderCine({ ...desk, search: '?vista=cine&cinecat=milista&cinetag=4k&cineq=dune' });
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(within(tabs).getByRole('button', { name: /^Mi lista/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Volver a Películas y series' })).toBeNull();
  });

  it('solo series en la lista: sale «Series» y no «Películas»', async () => {
    for (const item of demoVodList().items) if (item.kind === 'movie') demoListRemove(item.id);
    net = mockFetch(demoRoutes());
    renderCine(desk);
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /^Películas/ })).toBeNull();
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(await within(tabs).findByRole('button', { name: 'Mi lista · 2' })).toBeVisible();
  });

  it('lista vacía y nada a medias: invita a explorar Películas y Series o a buscar', async () => {
    for (const item of demoVodList().items) demoListRemove(item.id);
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod': (call) => json({ ...demoVodHome(queryOf(call)), continue: [] }),
    });
    renderCine(desk);
    expect(await screen.findByText('Tu lista está vacía')).toBeVisible();
    expect(screen.queryByRole('heading', { name: /^Seguir viendo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Buscar Ctrl K' })).toHaveTextContent('Ctrl K');
    const tabs = screen.getByRole('group', { name: 'Secciones de Pelis y series' });
    expect(await within(tabs).findByRole('button', { name: 'Mi lista · 0' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Explorar series' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las series' }),
    ).toBeVisible();
    expect(location.search).toContain('cine=series');
  });

  it('lista vacía con algo a medias: Seguir viendo arriba y la invitación debajo', async () => {
    for (const item of demoVodList().items) demoListRemove(item.id);
    net = mockFetch(demoRoutes());
    renderCine(desk);
    expect(await screen.findByText('Tu lista está vacía')).toBeVisible();
    expect(screen.getByRole('heading', { name: /^Seguir viendo/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Explorar películas' })).toBeVisible();
  });

  it('Películas abre la rejilla con su buscador, filtros y orden; Mi lista vuelve', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const tabs = await screen.findByRole('group', { name: 'Secciones de Pelis y series' });
    fireEvent.click(within(tabs).getByRole('button', { name: 'Películas' }));
    await waitFor(() => expect(location.search).toContain('cinecat=all'));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las películas' }),
    ).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Buscar películas' })).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Orden' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: 'Películas' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(tabs).getByRole('button', { name: 'Series' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Todas las series' }),
    ).toBeVisible();
    expect(location.search).toContain('cine=series');
    fireEvent.click(within(tabs).getByRole('button', { name: /^Mi lista/ }));
    await waitFor(() => expect(location.search).not.toContain('cinecat'));
    // Sin quedarse en «Series»: al estrechar la ventana, el móvil sale en Películas.
    expect(location.search).not.toContain('cine=series');
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: /^Mi lista/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('«Seguir viendo»: cada cartel lleva «Más opciones» con su menú (sin clic derecho)', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const continuing = await screen.findByRole('list', { name: 'Seguir viendo' });
    const more = within(continuing).getByRole('button', { name: 'Más opciones: Dune' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(more);
    const menu = await screen.findByRole('menu', { name: 'Dune' });
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(names).toEqual(
      expect.arrayContaining(['Quitar de Seguir viendo', 'Marcar como visto', 'Ver ficha']),
    );
  });

  it('«/» solo es el del buscador de pelis en la rejilla: en Mi lista, el de la barra', async () => {
    net = mockFetch(demoRoutes());
    renderCine(desk);
    const tabs = await screen.findByRole('group', { name: 'Secciones de Pelis y series' });
    await screen.findByRole('list', { name: 'Seguir viendo' });
    const ids = () => shortcutStore.get().map((entry) => entry.id);
    expect(ids()).not.toContain('cine.buscar');
    fireEvent.click(within(tabs).getByRole('button', { name: 'Películas' }));
    await screen.findByRole('searchbox', { name: 'Buscar películas' });
    await waitFor(() => expect(ids()).toContain('cine.buscar'));
  });
});

describe('escritorio: ficha', () => {
  it('serie: «Seguir · T1 E3», Mi lista / Ver juntos / Tráiler / Compartir y el siguiente marcado', async () => {
    net = mockFetch(demoRoutes([DEMO_VOD_IDS.seriesParts]));
    renderCine({ ...desk, search: `?vista=cine/${DEMO_VOD_IDS.seriesParts}` });
    expect(await screen.findByRole('button', { name: 'Seguir · T1 E3' })).toBeVisible();
    expect(screen.getByText(/5 temporadas/i)).toBeVisible();
    const actions = screen.getByRole('group', { name: 'Más acciones' });
    for (const name of ['Ver juntos', 'Compartir'])
      expect(within(actions).getByRole('button', { name })).toBeVisible();
    expect(await within(actions).findByRole('button', { name: 'En mi lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(actions).getByText('Tráiler')).toBeVisible();
    // Sin «Añadir a mi lista» suelto junto al play: va en la fila de iconos.
    expect(screen.queryByRole('button', { name: 'Añadir a mi lista' })).toBeNull();
    const seasons = screen.getByRole('group', { name: 'Temporadas' });
    expect(within(seasons).getByRole('button', { name: /Parte 1/ })).toHaveTextContent('T1');
    const main = document.querySelector('.cine-episode[data-main]');
    expect(main?.querySelector('.cine-episode__lead')?.textContent).toBe('Continuar');
  });

  it('película a medias: «Seguir · 43:12» y Compartir copia el enlace', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const dune = (await import('./demo-data.ts'))
      .demoVodHome()
      .continue.find((item) => item.title === 'Dune');
    net = mockFetch(demoRoutes([dune!.id]));
    renderCine({ ...desk, search: `?vista=cine/${dune!.id}` });
    expect(await screen.findByRole('button', { name: 'Seguir · 43:12' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(location.href));
    expect(await screen.findByText('Enlace copiado: pégalo donde quieras.')).toBeVisible();
    vi.unstubAllGlobals();
  });
});

describe('móvil: el destacado y Mi lista (maqueta pelis-y-series-escaparate)', () => {
  it('«Seguir · T3 E4» o «Seguir · 43:12»; sin dato, «Seguir»', () => {
    expect(destacadoFollow(entry({}))).toBe('Seguir · T3 E4');
    expect(destacadoFollow(entry({ subtitle: null }))).toBe('Seguir');
    const movie = entry({ kind: 'movie', seriesId: null, subtitle: null, posS: 2592 });
    expect(destacadoFollow(movie)).toBe('Seguir · 43:12');
    expect(destacadoFollow({ ...movie, posS: 0 })).toBe('Seguir');
  });

  it('arriba lo último a medias en grande; debajo «También a medias», Series y Películas', async () => {
    net = mockFetch(demoRoutes());
    renderCine();
    const entries = demoVodHome().continue;
    const destacado = await screen.findByRole('region', { name: 'Seguir viendo' });
    const cards = within(destacado).getAllByRole('article');
    expect(cards).toHaveLength(Math.min(DESTACADO_MAX, entries.length));
    const first = cards[0]!;
    expect(within(first).getByRole('heading', { level: 2, name: 'Dune' })).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Dune' })).toHaveAttribute(
      'href',
      expect.stringContaining(entries[0]!.id),
    );
    expect(within(first).getByText('SEGUIR VIENDO · PELÍCULA', { exact: false })).toBeTruthy();
    expect(within(first).getByRole('button', { name: 'Seguir · 43:12' })).toBeInTheDocument();
    expect(within(first).getByRole('progressbar')).toBeInTheDocument();
    // Mi lista y Ver juntos, redondos (con su nombre para el lector).
    expect(within(first).getByRole('button', { name: 'Mi lista' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(first).getByRole('button', { name: 'Ver juntos' })).toBeInTheDocument();
    // Lo demás a medias, en su fila (sin el primero).
    const rest = screen.getByRole('list', { name: 'También a medias' });
    expect(within(rest).queryByRole('button', { name: /^Dune\. / })).toBeNull();
    expect(within(rest).getAllByRole('button', { name: /^(?!Más opciones)/ })).toHaveLength(
      entries.length - 1,
    );
    expect(screen.queryByRole('list', { name: 'Seguir viendo' })).toBeNull();
    expect(await screen.findByRole('list', { name: 'Series' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Películas' })).toBeInTheDocument();
  });

  it('«Mi lista» del destacado guarda el título (PUT) y se marca', async () => {
    const dune = demoVodHome().continue[0]!;
    net = mockFetch({
      ...demoRoutes(),
      [`PUT /api/v1/vod/list/${dune.id}`]: () => {
        const list = demoVodList();
        const movie = list.items.find((item) => item.kind === 'movie')!;
        return json({ ...list, items: [{ ...movie, id: dune.id, title: 'Dune' }, ...list.items] });
      },
    });
    renderCine();
    const destacado = await screen.findByRole('region', { name: 'Seguir viendo' });
    const first = within(destacado).getAllByRole('article')[0]!;
    await waitFor(() =>
      expect(net.calls.some((call) => call.url === '/api/v1/vod/list')).toBe(true),
    );
    fireEvent.click(within(first).getByRole('button', { name: 'Mi lista' }));
    expect(await within(first).findByRole('button', { name: 'En mi lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(net.calls.some((call) => call.method === 'PUT')).toBe(true);
  });

  it('nada a medias: sin destacado ni «También a medias»', async () => {
    net = mockFetch({
      ...demoRoutes(),
      'GET /api/v1/vod': (call) => json({ ...demoVodHome(queryOf(call)), continue: [] }),
    });
    renderCine();
    expect(await screen.findByRole('list', { name: 'Series' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Seguir viendo' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'También a medias' })).toBeNull();
  });

  it('lista vacía: la invitación sin «Ctrl K» (en el móvil no hay teclado)', async () => {
    for (const item of demoVodList().items) demoListRemove(item.id);
    net = mockFetch(demoRoutes());
    renderCine();
    expect(await screen.findByText('Tu lista está vacía')).toBeVisible();
    const empty = screen.getByText('Tu lista está vacía').closest('.empty') as HTMLElement;
    expect(within(empty).getByRole('button', { name: 'Buscar' })).not.toHaveTextContent('Ctrl K');
  });

  it('ficha: «Seguir · T1 E3», la fila de Mi lista / Ver juntos / Tráiler / Compartir y «Volver»', async () => {
    net = mockFetch(demoRoutes([DEMO_VOD_IDS.seriesParts]));
    renderCine({ search: `?vista=cine/${DEMO_VOD_IDS.seriesParts}` });
    expect(await screen.findByRole('button', { name: 'Seguir · T1 E3' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    const actions = screen.getByRole('group', { name: 'Más acciones' });
    expect(await within(actions).findByRole('button', { name: 'En mi lista' })).toBeVisible();
    for (const name of ['Ver juntos', 'Compartir'])
      expect(within(actions).getByRole('button', { name })).toBeVisible();
    // Sin los botones sueltos de antes (Mi lista junto al play, Ver juntos y Tráiler abajo).
    expect(screen.getAllByRole('button', { name: 'Ver juntos' })).toHaveLength(1);
    expect(document.querySelector('.cine-list')).toBeNull();
    expect(document.querySelector('.cine-hero__kicker')?.textContent).toMatch(/5 temporadas/i);
  });
});
