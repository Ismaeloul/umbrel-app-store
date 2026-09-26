import type { BootstrapResponse, LibraryView as LibraryData } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { play } from '../../player/api.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import LibraryView from './LibraryView.tsx';
import { resetPending } from './data.ts';
import { madridClock } from './on-air.ts';
import { selectionStore } from './selection.ts';
import { makeItem, makeLibrary, renderWithApp, resetPlayback } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

function setup(
  library: LibraryData = makeLibrary(),
  {
    search = '?vista=biblioteca',
    routes = {},
    layout = {},
  }: {
    search?: string;
    routes?: Parameters<typeof mockFetch>[0];
    layout?: Parameters<typeof renderWithApp>[1] extends infer O
      ? O extends { layout?: infer L }
        ? L
        : never
      : never;
  } = {},
) {
  net = mockFetch({ 'GET /api/v1/library': library, 'POST /api/v1/library': library, ...routes });
  return renderWithApp(<LibraryView route={{ vista: 'biblioteca' }} active />, { search, layout });
}

const route = () => screen.getByTestId('ruta').textContent;
const rowNames = () =>
  screen
    .queryAllByRole('link')
    .map((a) => a.getAttribute('aria-label'))
    .filter(Boolean);

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
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

describe('pestañas (§13.1 y regla 32)', () => {
  it('abre en Favoritos si hay favoritos, con los contadores', async () => {
    setup();
    const tab = await screen.findByRole('tab', { name: /Favoritos/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Recientes/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Listas/ })).toHaveTextContent('3');
    expect(rowNames()).toEqual(['DAZN 1', 'Eurosport 1']);
  });

  it('sin favoritos abre en Recientes y la pestaña elegida va a la URL', async () => {
    setup(makeLibrary({ favorites: [] }));
    expect(await screen.findByRole('tab', { name: /Recientes/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: /Listas/ }));
    expect(new URLSearchParams(location.search).get('pestana')).toBe('listas');
    expect(screen.getByRole('tab', { name: /Listas/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('la pestaña de la URL manda', async () => {
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=recientes' });
    expect(await screen.findByRole('tab', { name: /Recientes/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
  });
});

describe('«Pegar hash» siempre a mano (B-064)', () => {
  it('la cabecera de la biblioteca lo abre sin nada sonando ni partido en marcha', async () => {
    setup();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pegar un Content ID o enlace acestream://' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Reproducir otro hash' })).toBeInTheDocument();
  });
});

describe('buscador local (140 ms) y salto al motor', () => {
  it('filtra tras la espera y ofrece buscar en el motor desde cualquier pestaña', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await screen.findByRole('link', { name: 'DAZN 1' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar canal' }), {
      target: { value: 'euro' },
    });
    // Antes de 140 ms no cambia nada.
    expect(rowNames()).toEqual(['DAZN 1', 'Eurosport 1']);
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(rowNames()).toEqual(['Eurosport 1']);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar «euro» en el motor AceStream' }));
    await waitFor(() => expect(route()).toBe('buscar'));
    expect(new URLSearchParams(location.search).get('q')).toBe('euro');
  });

  it('sin resultados, el vacío lleva el botón del motor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    await screen.findByRole('link', { name: 'DAZN 1' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar canal' }), {
      target: { value: 'zzz' },
    });
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(
      screen.getByRole('heading', { name: 'Nada en esta pestaña con «zzz».' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar «zzz» en el motor' }));
    await waitFor(() => expect(route()).toBe('buscar'));
  });
});

describe('estados vacíos con su salida', () => {
  it('sin listas: «Añadir una lista» lleva a Ajustes → Listas', async () => {
    setup(makeLibrary({ web: [], favorites: [], history: [] }));
    expect(
      await screen.findByRole('heading', { name: 'Aún no hay ninguna lista cargada' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir una lista' }));
    await waitFor(() => expect(route()).toBe('ajustes/listas'));
  });

  it('favoritos vacíos con listas: «Ver las listas»; sin listas: buscar en el motor', async () => {
    setup(makeLibrary({ favorites: [], history: [] }), {
      search: '?vista=biblioteca&pestana=favoritos',
    });
    expect(
      await screen.findByText('Guarda un canal con la estrella y aparecerá aquí.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver las listas' }));
    expect(screen.getByRole('tab', { name: /Listas/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('recientes vacíos sin listas: «Ir a la agenda»', async () => {
    setup(makeLibrary({ favorites: [], history: [], web: [] }), {
      search: '?vista=biblioteca&pestana=recientes',
    });
    expect(await screen.findByText('Lo que reproduzcas irá quedando aquí.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a la agenda' }));
    await waitFor(() => expect(route()).toBe('agenda'));
  });

  it('si la biblioteca no carga, error con «Reintentar»', async () => {
    net = mockFetch({});
    renderWithApp(<LibraryView route={{ vista: 'biblioteca' }} active />);
    expect(
      await screen.findByRole('heading', { name: 'No se pudo cargar la biblioteca' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('listas por categorías', () => {
  it('acordeones plegados que se abren con un toque; con texto, todos abiertos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=listas' });
    const deportes = await screen.findByRole('button', { name: /Deportes/ });
    expect(deportes).toHaveAttribute('aria-expanded', 'false');
    // El recuento se lee en singular o plural («1 canal», no «1 canales»).
    expect(deportes).toHaveAccessibleName(/Deportes\s*2 canales/);
    expect(screen.getByRole('button', { name: /Generalistas/ })).toHaveAccessibleName(
      /Generalistas\s*1 canal$/,
    );
    expect(rowNames()).toEqual([]);
    fireEvent.click(deportes);
    expect(deportes).toHaveAttribute('aria-expanded', 'true');
    expect(rowNames()).toEqual(['DAZN 1', 'M+ LaLiga']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar canal' }), {
      target: { value: 'la' },
    });
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(rowNames()).toEqual(['M+ LaLiga', 'La 1']);
  });
});

describe('«En pantalla» sin reconstruir la lista (B-273, regla 3)', () => {
  it('cambiar el canal que suena solo marca la tarjeta: los nodos de la lista son los mismos', async () => {
    const library = makeLibrary();
    setup(library);
    const eurosport = await screen.findByRole('link', { name: 'Eurosport 1' });
    const dazn = screen.getByRole('link', { name: 'DAZN 1' });
    const card = (link: HTMLElement) => link.closest('li') ?? (link.parentElement as HTMLElement);
    expect(within(card(eurosport)).queryByText('En pantalla')).toBeNull();
    act(() => {
      play({ hash: library.favorites[1]!.id, title: 'Eurosport 1' }, { origin: 'library' });
    });
    expect(within(card(eurosport)).getByText('En pantalla')).toBeInTheDocument();
    // Las mismas tarjetas (no se ha vuelto a pintar la lista): ni se relanzan animaciones.
    expect(screen.getByRole('link', { name: 'Eurosport 1, en pantalla' })).toBe(eurosport);
    expect(screen.getByRole('link', { name: 'DAZN 1' })).toBe(dazn);
    expect(within(card(dazn)).queryByText('En pantalla')).toBeNull();
  });
});

describe('tarjetas: reproducir, borrar con deshacer, favorito y renombrar', () => {
  it('un toque reproduce: va a partido/canal/<hash>', async () => {
    const library = makeLibrary();
    setup(library);
    fireEvent.click(await screen.findByRole('link', { name: 'Eurosport 1' }));
    await waitFor(() => expect(route()).toBe(`partido/canal/${library.favorites[1]!.id}`));
  });

  it('eliminar desde «Más» quita la fila con «Deshacer» durante 6 s', async () => {
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=recientes' });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Más acciones para Canal de prueba' }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quitar de recientes' }));
    await waitFor(() => expect(rowNames()).toEqual([]));
    expect(screen.getByRole('tab', { name: /Recientes/ })).toHaveTextContent('0');
    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(rowNames()).toEqual(['Canal de prueba']));
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('quitar un favorito con la estrella también se puede deshacer (§29.25)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar DAZN 1 de favoritos' }));
    await waitFor(() => expect(rowNames()).toEqual(['Eurosport 1']));
    expect(await screen.findByText('«DAZN 1» quitado de favoritos')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6100));
    await waitFor(() => expect(net.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(net.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      action: 'delete',
      collection: 'favorites',
    });
  });

  it('la estrella en un canal que no es favorito abre «Guardar favorito» y pasa a Favoritos', async () => {
    const library = makeLibrary();
    setup(library, { search: '?vista=biblioteca&pestana=recientes' });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Añadir Canal de prueba a favoritos' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Guardar favorito' });
    expect(within(dialog).getByRole('textbox', { name: 'Nombre del canal' })).toHaveValue(
      'Canal de prueba',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en favoritos' }));
    await waitFor(() =>
      expect(net.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        action: 'favorite-upsert',
        item: { id: library.history[0]!.id, title: 'Canal de prueba' },
      }),
    );
    await waitFor(() =>
      expect(new URLSearchParams(location.search).get('pestana')).toBe('favoritos'),
    );
  });

  it('renombrar desde el menú manda la colección y el título', async () => {
    const library = makeLibrary();
    setup(library);
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones para Eurosport 1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Renombrar' }));
    const input = await screen.findByRole('textbox', { name: 'Nuevo nombre' });
    fireEvent.change(input, { target: { value: 'Eurosport' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(net.calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'rename',
        collection: 'favorites',
        id: library.favorites[1]!.id,
        title: 'Eurosport',
      }),
    );
  });

  it('marca el favorito que ya no está en la lista activa', async () => {
    setup(makeLibrary({ favorites: [makeItem('Canal viejo', 'fav', { fromWebSync: true })] }));
    expect(
      await screen.findByRole('img', {
        name: 'Este canal ya no aparece en la última sincronización',
      }),
    ).toBeInTheDocument();
  });

  it('con la ficha a la vista, el primer clic elige y el segundo reproduce', async () => {
    const library = makeLibrary();
    setup(library, { layout: { asideVisible: true, asideAvailable: true, kind: 'desktop' } });
    const link = await screen.findByRole('link', { name: 'Eurosport 1' });
    fireEvent.click(link);
    await waitFor(() =>
      expect(selectionStore.get()).toEqual({
        collection: 'favorites',
        id: library.favorites[1]!.id,
      }),
    );
    expect(route()).toBe('biblioteca');
    fireEvent.click(screen.getByRole('link', { name: 'Eurosport 1' }));
    await waitFor(() => expect(route()).toBe(`partido/canal/${library.favorites[1]!.id}`));
  });
});

describe('«Emitiendo ahora» (C1) y lo que da cada canal', () => {
  it('tus canales con partido en juego, con el minuto; los demás con su hora', async () => {
    // Reloj fijo (21:00 en Madrid) para que el test no dependa de la hora a la que corre.
    vi.useFakeTimers({ now: new Date('2026-09-23T19:00:00Z'), shouldAdvanceTime: true });
    const clock = madridClock(Date.now());
    const hhmm = (minutes: number) => {
      const m = ((minutes % 1440) + 1440) % 1440;
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    // Un partido empezado hace 20 min en DAZN 1 y otro dentro de 2 h en Eurosport 1.
    const schedule = {
      generatedAt: new Date().toISOString(),
      timezone: 'Europe/Madrid',
      country: 'Spain',
      source: 'futbolenlatv',
      attribution: 'futbolenlatv.com',
      demo: false,
      limited: false,
      partial: false,
      days: [
        {
          date: clock.date,
          matches: [
            {
              id: 'm1',
              date: clock.date,
              time: hhmm(clock.minutes - 20),
              title: 'Girona - Real Sociedad',
              home: 'Girona',
              away: 'Real Sociedad',
              competition: 'LaLiga',
              country: 'Spain',
              channels: [{ id: 'c1', name: 'DAZN 1' }],
            },
            {
              id: 'm2',
              date: clock.date,
              time: hhmm(clock.minutes + 120),
              title: 'Betis - Valencia',
              home: 'Betis',
              away: 'Valencia',
              competition: 'LaLiga',
              country: 'Spain',
              channels: [{ id: 'c2', name: 'Eurosport 1' }],
            },
          ],
        },
      ],
    };
    const scores = {
      available: true,
      generatedAt: new Date().toISOString(),
      source: 'espn',
      attribution: 'ESPN',
      leagues: 1,
      scores: {
        m1: { home: 1, away: 1, state: 'in', clock: "58'", detail: '', confidence: 0.9 },
      },
    };
    expect(clock).toEqual({ date: '2026-09-23', minutes: 21 * 60 });
    setup(makeLibrary(), {
      routes: { 'GET /api/v1/football': schedule, 'GET /api/v1/scores': scores },
    });
    const strip = await screen.findByRole('region', { name: /Emitiendo ahora/ });
    expect(within(strip).getByText('DAZN 1')).toBeInTheDocument();
    expect(within(strip).getByText('En directo')).toBeInTheDocument();
    await waitFor(() => expect(within(strip).getByText('1 a 1')).toBeInTheDocument());
    // La tarjeta de Eurosport 1 dice a qué hora da su partido.
    const line = await screen.findByText((_, el) =>
      Boolean(el?.classList.contains('ch__txt') && el.textContent?.includes('Betis')),
    );
    expect(line).toHaveTextContent('A las 23:00, Betis – Valencia');

    // Al ver DAZN 1, su marcador se tapa en todas partes (regla 29) hasta pedirlo.
    const dazn = makeLibrary().favorites[0]!;
    act(() => {
      play({ hash: dazn.id, title: 'DAZN 1' });
    });
    await waitFor(() => expect(within(strip).queryByText('1 a 1')).toBeNull());
    expect(within(strip).getByText('En pantalla')).toBeInTheDocument();
    expect(screen.getByText('Marcador oculto')).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Ver marcador' }));
    await waitFor(() => expect(within(strip).getByText('1 a 1')).toBeInTheDocument());
    expect(screen.queryByText('Marcador oculto')).toBeNull();
  });
});

describe('filtro de Canales con IPTV (docs/iptv.md §14.5)', () => {
  const iptvChannel = (n: number, title: string, library: string[] = []) => ({
    id: `${n}`.padStart(40, 'e'),
    title,
    quality: 'fhd' as const,
    provider: 'Casa',
    library,
  });

  function setupIptv(
    library: LibraryData,
    channels: ReturnType<typeof iptvChannel>[],
    total?: number,
  ) {
    const view = setup(library, {
      routes: {
        'GET /api/v1/iptv/channels': (call) => {
          const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
          return json({ query: q, total: total ?? channels.length, capped: false, channels });
        },
      },
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
  const filter = (value: string) =>
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar canal' }), {
      target: { value },
    });

  it('«tele» en Favoritos vacío: «Nada en esta pestaña…» y debajo «En tu IPTV» con Telecinco', async () => {
    setupIptv(makeLibrary(), [iptvChannel(1, 'Telecinco')]);
    await screen.findByRole('tab', { name: /Favoritos/ });
    filter('tele');
    expect(
      await screen.findByRole('heading', { name: 'Nada en esta pestaña con «tele».' }),
    ).toBeInTheDocument();
    const section = await screen.findByRole('region', { name: 'En tu IPTV' });
    const row = within(section).getByRole('link', { name: 'Telecinco' }).closest('article')!;
    expect(within(row).getByText('IPTV')).toBeInTheDocument();
    expect(within(row).getByText('Casa')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buscar «tele» en tu IPTV y el motor' }),
    ).toBeInTheDocument();
    /* Una sola petición, con el texto estable (450 ms), no una por tecla. */
    expect(net.calls.filter((c) => c.url.startsWith('/api/v1/iptv/channels'))).toHaveLength(1);
  });

  it('3 como mucho, sin los canales que ya son filas de la pestaña, y «Ver todo en Buscar»', async () => {
    const library = makeLibrary();
    const dazn = library.favorites[0]!;
    setupIptv(library, [
      iptvChannel(1, 'DAZN 1', [dazn.id]),
      iptvChannel(2, 'DAZN 2'),
      iptvChannel(3, 'DAZN 3'),
      iptvChannel(4, 'DAZN 4'),
      iptvChannel(5, 'DAZN F1'),
    ]);
    await screen.findByRole('tab', { name: /Favoritos/ });
    filter('dazn');
    const section = await screen.findByRole('region', { name: 'En tu IPTV' });
    expect(
      within(section)
        .getAllByRole('link')
        .map((a) => a.getAttribute('aria-label')),
    ).toEqual(['DAZN 2', 'DAZN 3', 'DAZN 4']);
    fireEvent.click(within(section).getByRole('button', { name: 'Ver todo en Buscar' }));
    expect(route()).toBe('buscar');
    expect(new URLSearchParams(location.search).get('q')).toBe('dazn');
  });

  it('un favorito que es un canal de tu IPTV dice su estado: «Tu IPTV», «Tu IPTV está en pausa»…', async () => {
    const tele = makeItem('Telecinco', 'fav', { category: 'IPTV' });
    const gone = makeItem('Canal que se fue', 'fav', { category: 'IPTV' });
    setup(
      makeLibrary({
        favorites: [tele, gone],
        iptvIds: { [tele.id]: 'ok', [gone.id]: 'iptv_gone' },
      }),
    );
    const teleRow = (await screen.findByRole('link', { name: 'Telecinco' })).closest('article')!;
    expect(within(teleRow).getByText('Tu IPTV')).toBeInTheDocument();
    expect(within(teleRow).getByText('IPTV')).toBeInTheDocument();
    const goneRow = screen.getByRole('link', { name: 'Canal que se fue' }).closest('article')!;
    expect(within(goneRow).getByText('Ya no está en tu IPTV')).toBeInTheDocument();
  });

  it('la estrella en un reciente que es un canal de tu IPTV lo guarda como canal IPTV (categoría «IPTV» y alias)', async () => {
    const tele = makeItem('Mi tele', 'recent', { alias: 'Telecinco' });
    setup(makeLibrary({ favorites: [], history: [tele], iptvIds: { [tele.id]: 'ok' } }), {
      search: '?vista=biblioteca&pestana=recientes',
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir Mi tele a favoritos' }));
    await screen.findByRole('dialog', { name: 'Guardar favorito' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en favoritos' }));
    await waitFor(() =>
      expect(net.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        action: 'favorite-upsert',
        item: { id: tele.id, title: 'Mi tele', category: 'IPTV', alias: 'Telecinco', ih: false },
      }),
    );
  });

  it('sin IPTV activa, ni sección ni petición, y el botón de siempre', async () => {
    setup();
    await screen.findByRole('tab', { name: /Favoritos/ });
    filter('euro');
    await screen.findByRole('button', { name: 'Buscar «euro» en el motor AceStream' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(net.calls.some((c) => c.url.startsWith('/api/v1/iptv/channels'))).toBe(false);
    expect(screen.queryByRole('region', { name: 'En tu IPTV' })).toBeNull();
  });
});
