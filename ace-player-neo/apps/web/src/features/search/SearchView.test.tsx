import type { BootstrapResponse } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { getPlayer } from '../../player/api.ts';
import { makeLibrary, renderWithApp, resetPlayback } from '../library/test-utils.tsx';
import { installShortcutListener } from '../../app/shortcuts.ts';
import SearchView from './SearchView.tsx';
import { demoIptvChannels, demoSearch } from './demo.ts';
import { canSearch, cleanQuery, isHashOrLink, searchPhase } from './model.ts';

const HASH = 'a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a';

let net: ReturnType<typeof mockFetch>;

function result(title: string, availability: number) {
  const r = demoSearch(title).results[0];
  return {
    ...(r ?? { id: 'b'.repeat(40), title, category: 'Deportes', bitrate: null, ih: true as const }),
    title,
    availability,
  };
}

function setup(
  search = '?vista=buscar',
  searchHandler?: (call: MockCall) => Response | Promise<Response>,
) {
  net = mockFetch({
    'GET /api/v1/library': makeLibrary(),
    'GET /api/v1/search':
      searchHandler ??
      ((call) => {
        const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
        return json({
          query: q,
          results: q.startsWith('daz') ? [result('DAZN 1 HD', 0.92), result('DAZN 2', 0.4)] : [],
        });
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
    expect(
      searchPhase({ typed: '', committed: '', loading: false, error: false, count: null }).kind,
    ).toBe('idle');
    expect(
      searchPhase({ typed: 'd', committed: '', loading: false, error: false, count: null }).kind,
    ).toBe('short');
    expect(
      searchPhase({ typed: 'dazn', committed: 'dazn', loading: true, error: false, count: null })
        .kind,
    ).toBe('loading');
    expect(
      searchPhase({ typed: 'dazn', committed: 'dazn', loading: false, error: false, count: 0 })
        .kind,
    ).toBe('empty');
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

  it('el recuento dice «1 resultado» y «2 resultados»', async () => {
    setup('?vista=buscar', (call) => {
      const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
      return json({
        query: q,
        results:
          q === 'uno'
            ? [result('DAZN 1 HD', 0.92)]
            : [result('DAZN 1 HD', 0.92), result('DAZN 2', 0.4)],
      });
    });
    fireEvent.change(field(), { target: { value: 'uno' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByText('1 resultado para «uno».')).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'dos' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByText('2 resultados para «dos».')).toBeInTheDocument();
  });

  it('Intro busca al momento; sin resultados lo dice', async () => {
    setup();
    fireEvent.change(field(), { target: { value: 'nada' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(
      await screen.findByRole('heading', { name: 'Sin resultados para «nada».' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Prueba con otro nombre o menos palabras.')).toBeInTheDocument();
  });

  it('si tu biblioteca sí tiene el canal, el motor vacío es una línea y no «Sin resultados»', async () => {
    setup();
    fireEvent.change(field(), { target: { value: 'eurosport' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(
      await screen.findByText('El motor AceStream no tiene nada más para «eurosport».'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Eurosport 1' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sin resultados para «eurosport».' })).toBeNull();
  });

  it('una respuesta atrasada no pinta encima de la nueva', async () => {
    const pending: Array<() => void> = [];
    setup('?vista=buscar', (call) => {
      const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
      if (q === 'eu')
        return new Promise<Response>((resolve) =>
          pending.push(() =>
            resolve(json({ query: 'eu', results: [result('Eurosport viejo', 0.5)] })),
          ),
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
      json(
        {
          error: {
            code: 'engine_unavailable',
            message: 'El motor AceStream no responde.',
            requestId: 'r',
          },
        },
        503,
      ),
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
    await waitFor(() =>
      expect(screen.getByTestId('ruta').textContent).toMatch(/^partido\/canal\/[0-9a-f]{40}$/),
    );
    // Los resultados del motor son infohashes: se piden como tales (P6).
    expect(getPlayer().channel).toMatchObject({ title: 'DAZN 2', kind: 'infohash' });
  });
});

describe('«Enlace detectado» (Palco W9)', () => {
  it('detecta un Content ID, un enlace acestream:// o una URL con el id; nada más', () => {
    expect(isHashOrLink(HASH)).toBe(HASH);
    expect(isHashOrLink(`  acestream://${HASH.toUpperCase()} `)).toBe(HASH);
    expect(isHashOrLink(`https://ejemplo.com/ver?content_id=${HASH}`)).toBe(HASH);
    expect(isHashOrLink('dazn')).toBeNull();
    expect(isHashOrLink('acestream://123')).toBeNull();
    expect(isHashOrLink('')).toBeNull();
  });

  it('con un enlace en el campo no se pregunta al motor: sale la tarjeta y «Reproducir» lo abre', async () => {
    setup();
    fireEvent.change(field(), { target: { value: `acestream://${HASH}` } });
    expect(await screen.findByText('Enlace detectado')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Es un Content ID de AceStream' }),
    ).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.queryByText('En el motor AceStream')).toBeNull();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('ruta')).toHaveTextContent(`partido/canal/${HASH}`),
    );
    expect(searchCalls()).toHaveLength(0);
    // El mismo camino que «Pegar hash»: título «Stream …» y el servidor decide id o infohash.
    expect(getPlayer().channel).toMatchObject({
      hash: HASH,
      title: `Stream ${HASH.slice(0, 8)}`,
      kind: 'auto',
    });
    expect(toastStore.get().at(-1)?.text).toBe('Hash externo añadido y reproduciendo');
  });

  it('si el hash ya está en tu biblioteca, la tarjeta lleva su nombre; «Limpiar» vacía el campo', async () => {
    const library = makeLibrary();
    const known = library.favorites[1]!;
    setup();
    await waitFor(() => expect(net.calls.some((c) => c.url === '/api/v1/library')).toBe(true));
    fireEvent.change(field(), { target: { value: known.id } });
    expect(await screen.findByRole('heading', { name: 'Eurosport 1' })).toBeInTheDocument();
    expect(screen.getByText('En tu biblioteca')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(field()).toHaveValue('');
    expect(screen.queryByText('Enlace detectado')).toBeNull();
    fireEvent.change(field(), { target: { value: known.id } });
    fireEvent.click(await screen.findByRole('button', { name: 'Reproducir' }));
    await waitFor(() => expect(getPlayer().channel?.title).toBe('Eurosport 1'));
    expect(toastStore.get().at(-1)?.text).toBe('Reproduciendo el hash seleccionado');
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
    expect(
      results.every(
        (r) => r.title.toLowerCase().includes('dazn') && r.ih && /^[0-9a-f]{40}$/.test(r.id),
      ),
    ).toBe(true);
    expect(results.map((r) => r.availability)).toEqual(
      [...results.map((r) => r.availability)].sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
    expect(demoSearch('nada de nada').results).toEqual([]);
  });
});

describe('buscador con IPTV (docs/iptv.md §14.5)', () => {
  const IPTV_TELE = 'f1'.repeat(20);
  const IPTV_LA1 = 'f2'.repeat(20);
  const IPTV_DAZN = 'f3'.repeat(20);
  const channel = (id: string, title: string, library: string[] = []) => ({
    id,
    title,
    quality: 'hd' as const,
    provider: 'Casa',
    library,
  });

  function setupIptv(options: {
    channels?: (q: string) => ReturnType<typeof channel>[];
    engine?: (q: string) => ReturnType<typeof result>[];
    iptvStatus?: number;
    total?: number;
    capped?: boolean;
  }) {
    net = mockFetch({
      'GET /api/v1/library': makeLibrary(),
      'GET /api/v1/search': (call) => {
        const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
        return json({ query: q, results: options.engine?.(q) ?? [] });
      },
      'GET /api/v1/iptv/channels': (call) => {
        const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
        if (options.iptvStatus)
          return json(
            { error: { code: 'internal_error', message: 'x', requestId: 'r1' } },
            options.iptvStatus,
          );
        const channels = options.channels?.(q) ?? [];
        return json({
          query: q,
          total: options.total ?? channels.length,
          capped: options.capped ?? false,
          channels,
        });
      },
    });
    const view = renderWithApp(<SearchView route={{ vista: 'buscar' }} active />, {
      search: '?vista=buscar',
    });
    const boot = fixture<BootstrapResponse>('bootstrap');
    act(() => {
      view.client.setQueryData(routeKey('bootstrap'), {
        ...boot,
        features: { ...boot.features, iptv: true },
      });
    });
    return view;
  }

  const iptvField = () =>
    screen.getByRole('searchbox', { name: 'Buscar en tu IPTV y en el motor AceStream' });
  const iptvCalls = () => net.calls.filter((c) => c.url.startsWith('/api/v1/iptv/channels'));
  const type = (value: string) => {
    fireEvent.change(iptvField(), { target: { value } });
    fireEvent.keyDown(iptvField(), { key: 'Enter' });
  };

  it('sin features.iptv, ni una llamada a iptvChannels y los textos de hoy', async () => {
    setup();
    fireEvent.change(field(), { target: { value: 'dazn' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(await screen.findByRole('link', { name: 'DAZN 1 HD' })).toBeInTheDocument();
    expect(net.calls.some((c) => c.url.startsWith('/api/v1/iptv/channels'))).toBe(false);
    expect(screen.queryByText('En tu IPTV')).toBeNull();
  });

  it('pregunta a la vez al motor y a tu IPTV; Telecinco (solo en la IPTV) sale en «En tu IPTV» con su distintivo', async () => {
    setupIptv({
      channels: (q) => (q === 'tele' ? [channel(IPTV_TELE, 'Telecinco')] : []),
      engine: () => [result('Teledeporte', 0.5)],
    });
    expect(
      screen.getByText('Busca canales en tu IPTV y en el motor AceStream.'),
    ).toBeInTheDocument();
    type('tele');
    const section = await screen.findByRole('region', { name: /^En tu IPTV/ });
    const row = within(section).getByRole('link', { name: 'Telecinco' }).closest('article')!;
    expect(within(row).getByText('IPTV')).toBeInTheDocument();
    expect(within(row).getByText('Casa · 720p')).toBeInTheDocument();
    expect(iptvCalls()[0]?.url).toBe('/api/v1/iptv/channels?q=tele&limit=50');
    expect(await screen.findByRole('link', { name: 'Teledeporte' })).toBeInTheDocument();
    expect(
      await screen.findByText('1 en tu IPTV y 1 en el motor para «tele».'),
    ).toBeInTheDocument();
  });

  it('«La 1» en los dos sitios sale una vez, con «también en AceStream», y el motor no la repite', async () => {
    setupIptv({
      channels: () => [channel(IPTV_LA1, 'La 1')],
      engine: () => [
        { ...result('La 1 HD --> ELCANO', 0.9), id: 'a1'.repeat(20), iptv: IPTV_LA1 },
        { ...result('La 1 HD --> NEW ERA', 0.8), id: 'a2'.repeat(20), iptv: IPTV_LA1 },
      ],
    });
    type('la 1');
    const section = await screen.findByRole('region', { name: /^En tu IPTV/ });
    expect(within(section).getByText('Casa · 720p · también en AceStream')).toBeInTheDocument();
    await waitFor(() =>
      expect(net.calls.some((c) => c.url.startsWith('/api/v1/search'))).toBe(true),
    );
    expect(screen.queryByRole('link', { name: 'La 1 HD --> ELCANO' })).toBeNull();
    /* La biblioteca de muestra tiene «La 1» en la lista: sale en «En tu biblioteca». */
    expect(screen.getAllByRole('link', { name: 'La 1' }).length).toBeGreaterThan(0);
  });

  it('un canal de tu biblioteca que está en tu IPTV lleva «IPTV» y no sale otra vez en «En tu IPTV»', async () => {
    const dazn = makeLibrary().favorites[0]!;
    setupIptv({ channels: () => [channel(IPTV_DAZN, 'DAZN 1', [dazn.id])] });
    type('dazn');
    const local = await screen.findByRole('region', { name: 'En tu biblioteca' });
    await waitFor(() => expect(within(local).getAllByText('IPTV').length).toBeGreaterThan(0));
    expect(screen.queryByRole('region', { name: /^En tu IPTV/ })).toBeNull();
  });

  it('5 a la vista, «Ver 2 más de tu IPTV» / «Ver menos» y la nota si hay más', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      channel(`${i}`.padStart(40, 'c'), `Canal Tele ${i + 1}`),
    );
    setupIptv({ channels: () => many, total: 200, capped: true });
    type('tele');
    const section = await screen.findByRole('region', { name: /^En tu IPTV/ });
    expect(within(section).getByText('200+')).toBeInTheDocument();
    expect(within(section).getAllByRole('link')).toHaveLength(5);
    fireEvent.click(within(section).getByRole('button', { name: 'Ver 2 más de tu IPTV' }));
    expect(within(section).getAllByRole('link')).toHaveLength(7);
    expect(
      within(section).getByText(
        'Hay más canales con «tele» en tu IPTV: escribe algo más concreto.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Ver menos' }));
    expect(within(section).getAllByRole('link')).toHaveLength(5);
  });

  it('si falla tu IPTV lo dice dentro de su sección, sin toast, con «Reintentar»', async () => {
    setupIptv({ iptvStatus: 500, engine: () => [result('Teledeporte', 0.5)] });
    type('tele');
    expect(await screen.findByText('No se pudo buscar en tu IPTV.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(toastStore.get().map((t) => t.text)).not.toContain('No se pudo buscar en tu IPTV.');
    expect(await screen.findByRole('link', { name: 'Teledeporte' })).toBeInTheDocument();
  });

  it('vacío en los dos: «No está en tu IPTV ni en el motor AceStream…»', async () => {
    setupIptv({});
    type('zzz');
    expect(
      await screen.findByRole('heading', { name: 'Sin resultados para «zzz».' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'No está en tu IPTV ni en el motor AceStream. Prueba con otro nombre o menos palabras.',
      ),
    ).toBeInTheDocument();
  });

  it('tocar un canal de «En tu IPTV» no llama a play(): abre la sesión del canal con su id IPTV', async () => {
    setupIptv({ channels: () => [channel(IPTV_TELE, 'Telecinco')] });
    type('tele');
    const section = await screen.findByRole('region', { name: /^En tu IPTV/ });
    fireEvent.click(within(section).getByRole('link', { name: 'Telecinco' }));
    expect(getPlayer().channel).toBeNull();
    await waitFor(() => expect(screen.getByTestId('ruta').textContent).toContain(IPTV_TELE));
  });

  it('el menú de una fila IPTV no tiene las acciones del hash', async () => {
    setupIptv({ channels: () => [channel(IPTV_TELE, 'Telecinco')] });
    type('tele');
    const section = await screen.findByRole('region', { name: /^En tu IPTV/ });
    fireEvent.click(within(section).getByRole('button', { name: 'Más acciones para Telecinco' }));
    const menu = await screen.findByRole('menu');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(labels).toContain('Copiar nombre');
    for (const hidden of [
      'Copiar hash',
      'Abrir en la app de AceStream',
      'Copiar URL del stream (VLC)',
      'Copiar enlace acestream://',
    ]) {
      expect(labels).not.toContain(hidden);
    }
  });

  it('la demo contesta con la IPTV de ejemplo y anota «DAZN LaLiga» del motor', () => {
    const iptv = demoIptvChannels('liga');
    expect(iptv.channels.map((c) => c.title)).toContain('DAZN LaLiga');
    const dazn = demoSearch('dazn laliga').results.find((r) => r.title === 'DAZN LaLiga');
    expect(dazn?.iptv).toBe(iptv.channels.find((c) => c.title === 'DAZN LaLiga')?.id);
  });
});
