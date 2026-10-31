/* La ventana rápida de buscar (Ctrl K, escritorio): se abre encima de todo,
   busca en la agenda y en tus canales a la vez, se mueve con las flechas,
   Intro abre y Esc cierra. En el móvil, Ctrl K sigue llevando a la vista. */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapResponse } from '@ace/shared';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { closeQuickSearch, openSearch } from '../../app/search-open.ts';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { madridClock } from '../agenda/domain.ts';
import { matchAt, scheduleOf } from '../agenda/test-utils.tsx';
import { makeLibrary, renderWithApp, resetPlayback } from '../library/test-utils.tsx';
import { readRecents } from './quick-model.ts';
import { QuickSearchHost } from './QuickSearchHost.tsx';

const realMatchMedia = window.matchMedia;
let net: ReturnType<typeof mockFetch>;

function wide(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: on && query === '(min-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  const now = Date.now();
  const live = matchAt(-30, { id: 'clasico', home: 'Real Madrid', away: 'Barcelona' }, now);
  const later = matchAt(
    240,
    { id: 'champions', home: 'Barcelona', away: 'Inter', competition: 'Champions' },
    now,
  );
  const today = madridClock(now).date;
  const days: Record<string, (typeof live)[]> = { [today]: [live] };
  (days[later.date] ??= []).push(later);
  net = mockFetch({
    'GET /api/v1/library': makeLibrary(),
    'GET /api/v1/football': scheduleOf(days),
    'GET /api/v1/scores': () => json({ error: { code: 'x', message: 'x', requestId: 'r' } }, 503),
    ...extra,
  });
  return renderWithApp(<QuickSearchHost />, { search: '?vista=agenda' });
}

/** vodBrowse con las dos pelis del ejemplo, filtradas por el texto (sin series). */
function browse(url: string) {
  const params = new URL(url, 'http://x').searchParams;
  const page = fixture<{ items: Array<{ kind: string; title: string }> }>('vodBrowse');
  const q = (params.get('q') ?? '').toLowerCase();
  const items = params.get('kind') === 'movie' ? page.items : [];
  return json({ ...page, items: items.filter((item) => item.title.toLowerCase().includes(q)) });
}

const dialog = () =>
  screen.getByRole('dialog', { name: 'Buscar partidos, canales, pelis y series' });
const field = () => screen.getByRole('combobox', { name: 'Buscar partidos, canales, pelis…' });

beforeEach(() => {
  localStorage.clear();
  resetMemoryStorage();
  resetMode();
  setMode('live', 'bootstrap');
  wide(true);
});
afterEach(() => {
  act(() => closeQuickSearch());
  window.matchMedia = realMatchMedia;
  net?.restore();
  resetToasts();
  resetMode();
  resetPlayback();
});

describe('Buscar con Ctrl K (escritorio)', () => {
  it('se abre encima de todo con el campo enfocado, atajos y pegar un enlace', async () => {
    setup();
    const navigate = vi.fn();
    act(() => openSearch(navigate));
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(dialog()).toBeInTheDocument());
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(field()).toHaveFocus());
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('group', { name: 'Atajos' })).toBeInTheDocument();
    for (const name of ['En directo ahora', 'Mis equipos', 'Mi lista', 'Mis avisos']) {
      expect(within(list).getByRole('option', { name })).toBeInTheDocument();
    }
    expect(
      within(list).getByRole('option', { name: /acestream:\/\/ o Content ID/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Intro')).toBeInTheDocument();
    // «Ctrl Intro ver juntos» solo con una película activa (en lo demás no hace nada distinto).
    expect(screen.queryByText('Ctrl Intro')).not.toBeInTheDocument();
  });

  it('busca en la agenda y en tus canales, agrupado, con el directo primero', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'barc' } });
    const partidos = await screen.findByRole('group', { name: 'Partidos' });
    const rows = await within(partidos).findAllByRole('option');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Real Madrid – Barcelona');
    expect(rows[0]).toHaveTextContent('Directo');
    expect(rows[1]).toHaveTextContent('Barcelona – Inter');
    expect(screen.getByRole('button', { name: 'Todo · 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Partidos · 2' })).toBeInTheDocument();
    // El primero, activo; la flecha abajo pasa al segundo.
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant', rows[0]!.id);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field()).toHaveAttribute('aria-activedescendant', rows[1]!.id);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field()).toHaveAttribute('aria-activedescendant', rows[0]!.id);

    fireEvent.change(field(), { target: { value: 'dazn' } });
    const canales = await screen.findByRole('group', { name: 'Canales' });
    expect(within(canales).getByRole('option', { name: /DAZN 1/ })).toBeInTheDocument();
  });

  it('Intro abre el partido, cierra la ventana y apunta la búsqueda en Recientes', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'barc' } });
    await screen.findByRole('group', { name: 'Partidos' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('partido/clasico'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(readRecents()).toEqual(['barc']);

    act(() => openSearch(vi.fn()));
    const recientes = await screen.findByRole('group', { name: 'Recientes' });
    expect(within(recientes).getByRole('option', { name: /barc/ })).toBeInTheDocument();
  });

  it('Intro pulsado nada más escribir espera a los resultados de ese texto', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    // La agenda, ya cargada (lo normal al abrir la ventana desde la app).
    fireEvent.change(field(), { target: { value: 'inter' } });
    await screen.findByRole('group', { name: 'Partidos' });
    // Se escribe otra cosa e Intro al momento: no abre el «inter» ni el motor.
    fireEvent.change(field(), { target: { value: 'madrid' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('partido/clasico'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Intro pulsado mientras llega el catálogo no se pierde: abre la peli en cuanto llega', async () => {
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    const view = setup({
      'GET /api/v1/vod/browse': async (call) => {
        await arrived;
        return browse(call.url);
      },
    });
    const boot = fixture<BootstrapResponse>('bootstrap');
    act(() => {
      view.client.setQueryData(routeKey('bootstrap'), {
        ...boot,
        features: { ...boot.features, vod: true },
      });
    });
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'dune' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    // Ya asentado lo escrito, el catálogo aún no ha contestado: la ventana sigue, esperando.
    await waitFor(() =>
      expect(net.calls.some((call) => call.url.startsWith('/api/v1/vod/browse'))).toBe(true),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    release();
    await waitFor(() =>
      expect(screen.getByTestId('ruta')).toHaveTextContent(
        'cine/4b5c6d7e8f9012345678abcdef0123457a8b9c0d',
      ),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con una película activa, el pie enseña «Ctrl Intro ver juntos»', async () => {
    const view = setup({
      'GET /api/v1/vod/browse': (call) => {
        return browse(call.url);
      },
    });
    const boot = fixture<BootstrapResponse>('bootstrap');
    act(() => {
      view.client.setQueryData(routeKey('bootstrap'), {
        ...boot,
        features: { ...boot.features, vod: true },
      });
    });
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'dune' } });
    const pelis = await screen.findByRole('group', { name: 'Pelis y series' });
    expect(within(pelis).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Ctrl Intro')).toBeInTheDocument();
  });

  it('un clic dentro de la ventana deja el foco en el campo y las flechas siguen', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'barc' } });
    const partidos = await screen.findByRole('group', { name: 'Partidos' });
    const rows = await within(partidos).findAllByRole('option');
    // El rótulo del grupo: el mousedown no se lleva el foco.
    const press = fireEvent.mouseDown(within(partidos).getByText('Partidos'));
    expect(press).toBe(false);
    expect(field()).toHaveFocus();
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field()).toHaveAttribute('aria-activedescendant', rows[1]!.id);
  });

  it('sin resultados ofrece el motor; con resultados, ni el motor ni chips a 0', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: 'barc' } });
    await screen.findByRole('group', { name: 'Partidos' });
    expect(screen.queryByRole('option', { name: /en el motor AceStream/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Canales · 0/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.change(field(), { target: { value: 'zzqx' } });
    expect(
      await screen.findByRole('option', { name: /Buscar «zzqx» en el motor AceStream/ }),
    ).toBeInTheDocument();
  });

  it('un Content ID pegado se ofrece para reproducir', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.change(field(), { target: { value: `acestream://${'a'.repeat(40)}` } });
    const group = await screen.findByRole('group', { name: 'Enlace detectado' });
    expect(within(group).getByRole('option')).toHaveTextContent('Content ID de AceStream');
  });

  it('Esc cierra la ventana', async () => {
    setup();
    act(() => openSearch(vi.fn()));
    await waitFor(() => expect(field()).toHaveFocus());
    fireEvent.keyDown(field(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Buscar en el móvil', () => {
  it('Ctrl K lleva a la vista Buscar, sin ventana', () => {
    wide(false);
    setup();
    const navigate = vi.fn();
    act(() => openSearch(navigate));
    expect(navigate).toHaveBeenCalledWith({ vista: 'buscar' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
