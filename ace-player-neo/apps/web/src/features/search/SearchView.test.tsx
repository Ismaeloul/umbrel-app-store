import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { getPlayer } from '../../player/api.ts';
import { makeLibrary, renderWithApp, resetPlayback } from '../library/test-utils.tsx';
import { installShortcutListener } from '../../app/shortcuts.ts';
import SearchView from './SearchView.tsx';
import { demoSearch } from './demo.ts';
import { canSearch, cleanQuery, searchPhase } from './model.ts';

let net: ReturnType<typeof mockFetch>;

function result(title: string, availability: number) {
  const r = demoSearch(title).results[0];
  return { ...(r ?? { id: 'b'.repeat(40), title, category: 'Deportes', bitrate: null, ih: true as const }), title, availability };
}

function setup(search = '?vista=buscar', searchHandler?: (call: MockCall) => Response | Promise<Response>) {
  net = mockFetch({
    'GET /api/v1/library': makeLibrary(),
    'GET /api/v1/search':
      searchHandler ??
      ((call) => {
        const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
        return json({ query: q, results: q.startsWith('daz') ? [result('DAZN 1 HD', 0.92), result('DAZN 2', 0.4)] : [] });
      }),
  });
  return renderWithApp(<SearchView route={{ vista: 'buscar' }} active />, { search });
}

const searchCalls = () => net.calls.filter((c) => c.url.startsWith('/api/v1/search'));
const field = () => screen.getByRole('searchbox', { name: 'Buscar en el motor AceStream' });

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetToasts();
  resetMode();
  resetPlayback();
});

describe('reglas del buscador (§15)', () => {
  it('texto limpio, 2 letras como mínimo y fases', () => {
    expect(cleanQuery('  da   zn ')).toBe('da zn');
    expect(canSearch('d')).toBe(false);
    expect(canSearch('dz')).toBe(true);
    expect(searchPhase({ typed: '', committed: '', loading: false, error: false, count: null }).kind).toBe('idle');
    expect(searchPhase({ typed: 'd', committed: '', loading: false, error: false, count: null }).kind).toBe('short');
    expect(searchPhase({ typed: 'dazn', committed: 'dazn', loading: true, error: false, count: null }).kind).toBe('loading');
    expect(searchPhase({ typed: 'dazn', committed: 'dazn', loading: false, error: false, count: 0 }).kind).toBe('empty');
  });

  it('pide 2 letras y espera 450 ms tras la última tecla', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    expect(screen.getByText('Busca canales publicados en el motor AceStream.')).toBeInTheDocument();
    expect(screen.getByText('Escribe al menos 2 letras.')).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'd' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(searchCalls()).toHaveLength(0);
    fireEvent.change(field(), { target: { value: 'da' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.change(field(), { target: { value: 'daz' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(searchCalls()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(200));
    await waitFor(() => expect(searchCalls()).toHaveLength(1));
    expect(searchCalls()[0]?.url).toBe('/api/v1/search?q=daz');
    expect(await screen.findByRole('link', { name: 'DAZN 1 HD' })).toBeInTheDocument();
    expect(screen.getByText('Deportes · disp. 92%')).toBeInTheDocument();
    expect(new URLSearchParams(location.search).get('q')).toBe('daz');
  });

  it('Intro busca al momento; sin resultados lo dice', async () => {
    setup();
    fireEvent.change(field(), { target: { value: 'nada' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Sin resultados para «nada».' })).toBeInTheDocument();
    expect(screen.getByText('Prueba con otro nombre o menos palabras.')).toBeInTheDocument();
  });

  it('una respuesta atrasada no pinta encima de la nueva', async () => {
    const pending: Array<() => void> = [];
    setup('?vista=buscar', (call) => {
      const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
      if (q === 'eu')
        return new Promise<Response>((resolve) =>
          pending.push(() => resolve(json({ query: 'eu', results: [result('Eurosport viejo', 0.5)] }))),
        );
      return json({ query: q, results: [result('DAZN 1 HD', 0.9)] });
    });
    fireEvent.change(field(), { target: { value: 'eu' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(field(), { target: { value: 'dazn' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByRole('link', { name: 'DAZN 1 HD' })).toBeInTheDocument();
    pending[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: 'Eurosport viejo' })).toBeNull();
  });

  it('si el motor falla: aviso de la 0.6.59 y «Reintentar»', async () => {
    setup('?vista=buscar', () =>
      json({ error: { code: 'engine_unavailable', message: 'El motor AceStream no responde.', requestId: 'r' } }, 503),
    );
    fireEvent.change(field(), { target: { value: 'dazn' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'La búsqueda falló' })).toBeInTheDocument();
    expect(toastStore.get().map((t) => t.text)).toContain(
      'La búsqueda falló. ¿Está el motor AceStream en línea?',
    );
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('llega con `&q=` desde la biblioteca y busca sin esperar; lo tuyo sale arriba', async () => {
    setup('?vista=buscar&q=dazn');
    const local = await screen.findByRole('region', { name: 'En tu biblioteca' });
    expect(within(local).getByRole('link', { name: 'DAZN 1' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'DAZN 1 HD' })).toBeInTheDocument();
    expect(searchCalls()[0]?.url).toBe('/api/v1/search?q=dazn');
  });

  it('reproducir un resultado va a su canal; la estrella abre «Guardar favorito» como infohash', async () => {
    setup('?vista=buscar&q=dazn');
    const link = await screen.findByRole('link', { name: 'DAZN 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir DAZN 2 a favoritos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar en favoritos' }));
    await waitFor(() =>
      expect(net.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        action: 'favorite-upsert',
        item: { title: 'DAZN 2', ih: true },
      }),
    );
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('ruta').textContent).toMatch(/^partido\/canal\/[0-9a-f]{40}$/));
    // Los resultados del motor son infohashes: se piden como tales (P6).
    expect(getPlayer().channel).toMatchObject({ title: 'DAZN 2', kind: 'infohash' });
  });
});

describe('atajo «/» en el buscador', () => {
  it('enfoca el campo del motor en vez de saltar a la biblioteca', async () => {
    const uninstall = installShortcutListener();
    try {
      setup();
      // jsdom no maqueta: requestFocus solo enfoca lo que «se ve» (tiene cajas).
      const input = field();
      input.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
      input.blur();
      expect(document.activeElement).not.toBe(field());
      fireEvent.keyDown(window, { key: '/' });
      await waitFor(() => expect(document.activeElement).toBe(field()));
      // Sigue en «Buscar»: no ha navegado a la biblioteca.
      expect(new URLSearchParams(location.search).get('vista')).toBe('buscar');
    } finally {
      uninstall();
    }
  });
});

describe('demo del buscador', () => {
  it('filtra el catálogo de muestra por el texto, de más a menos disponible', () => {
    const { results } = demoSearch('dazn');
    expect(results.length).toBeGreaterThan(2);
    expect(results.every((r) => r.title.toLowerCase().includes('dazn') && r.ih && /^[0-9a-f]{40}$/.test(r.id))).toBe(true);
    expect(results.map((r) => r.availability)).toEqual([...results.map((r) => r.availability)].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(demoSearch('nada de nada').results).toEqual([]);
  });
});
