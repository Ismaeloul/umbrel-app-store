import type { BootstrapResponse, LibraryView as LibraryData } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { play } from '../../player/api.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { resetPending } from './data.ts';
import { genreOf } from './genres.ts';
import { brandOf, plateLabel } from './ChannelPlate.tsx';
import { chunkIds, demoFill } from './guide-now.ts';
import LibraryView from './LibraryView.tsx';
import { madridClock } from './on-air.ts';
import { makeItem, makeLibrary, renderWithApp, resetPlayback } from './test-utils.tsx';

/* La tabla de Canales en escritorio (rediseño, sección 3): pestañas
   Favoritos / Recientes / Todos, chips por tipo y CANAL · AHORA · DESPUÉS. */

let net: ReturnType<typeof mockFetch>;

function setup(
  library: LibraryData = makeLibrary(),
  { search = '?vista=biblioteca', routes = {} as Parameters<typeof mockFetch>[0] } = {},
) {
  net = mockFetch({ 'GET /api/v1/library': library, 'POST /api/v1/library': library, ...routes });
  return renderWithApp(<LibraryView route={{ vista: 'biblioteca' }} active />, {
    search,
    layout: { kind: 'desktop' },
  });
}

/** Activa la IPTV como lo hace el arranque (`bootstrap.features.iptv`). */
function withIptv(view: ReturnType<typeof setup>) {
  const boot = fixture<BootstrapResponse>('bootstrap');
  act(() => {
    view.client.setQueryData(routeKey('bootstrap'), {
      ...boot,
      features: { ...boot.features, iptv: true },
    });
  });
}

const route = () => screen.getByTestId('ruta').textContent;
const rowOf = (name: string) =>
  screen.getByRole('link', { name }).closest('.ctab-row') as HTMLElement;

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
});

describe('pestañas y chips', () => {
  it('Favoritos · N / Recientes / Todos · N; «Todos» va a la URL y enseña los canales de las listas', async () => {
    setup();
    const favorites = await screen.findByRole('tab', { name: 'Favoritos · 2' });
    expect(favorites).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Recientes' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Listas/ })).toBeNull();
    // Sin IPTV, «Todos» son los canales de la lista activa.
    fireEvent.click(screen.getByRole('tab', { name: 'Todos · 3' }));
    expect(new URLSearchParams(location.search).get('pestana')).toBe('todos');
    expect(await screen.findByRole('link', { name: 'M+ LaLiga' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'La 1' })).toBeInTheDocument();
    // La lista activa y «Gestionar listas» (antes al pie de Listas), en «Más opciones».
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones de Canales' }));
    const menu = await screen.findByRole('menu', { name: 'Más opciones de Canales' });
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: /^Lista: Principal/ }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitem', { name: 'Gestionar listas' })).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: 'Pegar un hash o enlace' }),
    ).toBeInTheDocument();
    // Sin rótulos ni pie: una tabla seguida, como la maqueta.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('la barra de la sección solo lleva el título y el buscador; «Pegar hash» va en «Más opciones»', async () => {
    setup();
    await screen.findByRole('tab', { name: 'Favoritos · 2' });
    const header = document.querySelector('.view-head') as HTMLElement;
    expect(within(header).queryByRole('button', { name: /Pegar/ })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Categorías IPTV' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones de Canales' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pegar un hash o enlace' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('el filtro va plegado en una lupa y «/» lo abre', async () => {
    setup();
    const field = await screen.findByRole('searchbox', { name: 'Filtrar canales' });
    const box = field.closest('.ctab-filter') as HTMLElement;
    expect(box).not.toHaveClass('ctab-filter--open');
    expect(field).toHaveAttribute('data-focus-target', 'buscar-biblioteca');
    fireEvent.change(field, { target: { value: 'dazn' } });
    expect(box).toHaveClass('ctab-filter--open');
  });

  it('un enlace viejo con «Listas» abre «Todos»; sin ficha lateral ni pestaña IPTV', async () => {
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=listas' });
    expect(await screen.findByRole('tab', { name: 'Todos · 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('button', { name: /ficha del canal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Categorías IPTV' })).toBeNull();
  });

  it('el chip elegido vuelve a «Todo» al cambiar de pestaña', async () => {
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=todos' });
    const group = await screen.findByRole('group', { name: 'Filtrar por tipo de canal' });
    fireEvent.click(within(group).getByRole('button', { name: 'Deportes' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'La 1' })).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: 'Favoritos · 2' }));
    const chips = await screen.findByRole('group', { name: 'Filtrar por tipo de canal' });
    expect(within(chips).getByRole('button', { name: 'Todo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('los chips salen de los tipos de la pestaña y filtran', async () => {
    setup(makeLibrary(), { search: '?vista=biblioteca&pestana=todos' });
    const group = await screen.findByRole('group', { name: 'Filtrar por tipo de canal' });
    // DAZN 1 y M+ LaLiga son «Deportes»; La 1 («Generalistas») no tiene chip propio.
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Todo', 'Deportes']);
    fireEvent.click(within(group).getByRole('button', { name: 'Deportes' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'La 1' })).toBeNull());
    expect(screen.getByRole('link', { name: 'DAZN 1' })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Todo' }));
    expect(await screen.findByRole('link', { name: 'La 1' })).toBeInTheDocument();
  });
});

describe('filas', () => {
  it('toda la fila reproduce el canal; la estrella y «Más» siguen ahí', async () => {
    const library = makeLibrary();
    setup(library);
    const row = (await screen.findByRole('link', { name: 'DAZN 1' })).closest('.ctab-row')!;
    expect(
      within(row as HTMLElement).getByRole('button', { name: 'Quitar DAZN 1 de favoritos' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(row as HTMLElement).getByRole('button', { name: 'Más acciones para DAZN 1' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'DAZN 1' }));
    await waitFor(() => expect(route()).toBe(`partido/canal/${library.favorites[0]!.id}`));
  });

  it('el canal que suena va resaltado con las barritas', async () => {
    const library = makeLibrary();
    setup(library);
    await screen.findByRole('link', { name: 'DAZN 1' });
    expect(rowOf('DAZN 1')).not.toHaveAttribute('data-playing');
    act(() => {
      play({ hash: library.favorites[0]!.id, title: 'DAZN 1' });
    });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'DAZN 1, suena ahora' })).toBeInTheDocument(),
    );
    const row = rowOf('DAZN 1, suena ahora');
    expect(row).toHaveAttribute('data-playing', 'true');
    expect(row.querySelector('.player-eq')).not.toBeNull();
    expect(rowOf('Eurosport 1')).not.toHaveAttribute('data-playing');
  });

  it('«Ahora» y «Después» de la agenda: el partido en juego con su barra, el siguiente con su hora y nunca el marcador', async () => {
    // Reloj fijo (21:00 en Madrid).
    vi.useFakeTimers({ now: new Date('2026-09-23T19:00:00Z'), shouldAdvanceTime: true });
    const clock = madridClock(Date.now());
    const match = (id: string, time: string, home: string, away: string, channel: string) => ({
      id,
      date: clock.date,
      time,
      title: `${home} - ${away}`,
      home,
      away,
      competition: 'LaLiga',
      country: 'Spain',
      channels: [{ id: `c-${id}`, name: channel }],
    });
    const schedule = {
      generatedAt: new Date().toISOString(),
      timezone: 'Europe/Madrid',
      country: 'Spain',
      source: 'futbolenlatv',
      attribution: 'futbolenlatv.es',
      demo: false,
      limited: false,
      partial: false,
      days: [
        {
          date: clock.date,
          matches: [
            match('m1', '20:30', 'Girona', 'Real Sociedad', 'DAZN 1'),
            match('m2', '23:00', 'Betis', 'Valencia', 'Eurosport 1'),
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
      scores: { m1: { home: 2, away: 1, state: 'in', clock: "30'", detail: '', confidence: 0.9 } },
    };
    setup(makeLibrary(), {
      routes: { 'GET /api/v1/football': schedule, 'GET /api/v1/scores': scores },
    });
    await screen.findByRole('link', { name: 'DAZN 1' });
    const dazn = rowOf('DAZN 1');
    await waitFor(() => expect(dazn).toHaveTextContent('Girona – Real Sociedad'));
    expect(dazn.querySelector('.ctab-row__now--live')).not.toBeNull();
    // 30 min de las 2 h que se le dan al partido.
    expect(dazn.querySelector<HTMLElement>('.ctab-row__bar')?.style.getPropertyValue('--p')).toBe(
      '0.25',
    );
    expect(dazn).not.toHaveTextContent('2');
    const eurosport = rowOf('Eurosport 1');
    expect(eurosport).toHaveTextContent('Sin programa ahora');
    expect(eurosport.querySelector('.ctab-row__time')).toHaveTextContent('23:00');
    expect(eurosport).toHaveTextContent('Betis – Valencia');
  });
});

describe('«Todos» con IPTV', () => {
  const NOW = new Date('2026-09-23T19:00:00Z').getTime();
  const iptvId = (n: number) => `${n}`.padStart(40, 'e');
  const category = 'abcdefabcdef';

  function browse(q: string, channels: Array<{ n: number; title: string }>) {
    return {
      active: true,
      provider: 'Casa',
      catalog: 'c1',
      query: q,
      category: null,
      total: 1200,
      catalogTotal: 1200,
      facets: {
        country: [],
        language: [],
        type: [
          { value: 'deportes', count: 400, selected: false },
          { value: 'cine', count: 50, selected: false },
          { value: 'religion', count: 3, selected: false },
        ],
        sport: [],
        quality: [],
      },
      channels: channels.map(({ n, title }) => ({
        id: iptvId(n),
        title,
        qualities: ['fhd'],
        country: 'ES',
        category,
      })),
      nextCursor: null,
      stale: false,
    };
  }

  const library = makeLibrary();
  const LIST_ACE = library.web.find((item) => item.title === 'M+ LaLiga')!.id;

  function setupIptv() {
    const view = setup(library, {
      search: '?vista=biblioteca&pestana=todos',
      routes: {
        'GET /api/v1/iptv/browse': (call) => {
          const params = new URL(call.url, 'http://x').searchParams;
          if (params.get('limit') === '0') return json(browse('', []));
          return json(
            browse(params.get('q') ?? '', [
              { n: 1, title: 'Telecinco' },
              { n: 2, title: 'Cine Clásico' },
            ]),
          );
        },
        'GET /api/v1/iptv/guide/now': () =>
          json({
            available: true,
            version: 'v1',
            items: [
              {
                id: iptvId(1),
                guide: 5,
                now: {
                  id: '5.1',
                  start: NOW - 30 * 60_000,
                  end: NOW + 30 * 60_000,
                  title: 'Informativos Telecinco',
                  flags: 0,
                },
                next: {
                  id: '5.2',
                  start: NOW + 30 * 60_000,
                  end: NOW + 90 * 60_000,
                  title: 'Gran Hermano',
                  flags: 0,
                },
              },
              { id: iptvId(2), guide: null, now: null, next: null },
              // Un canal AceStream de tu lista que el servidor casa por nombre con tu IPTV.
              {
                id: LIST_ACE,
                guide: 9,
                now: {
                  id: '9.1',
                  start: NOW - 15 * 60_000,
                  end: NOW + 45 * 60_000,
                  title: 'El partido de las 21',
                  flags: 1,
                },
                next: null,
                logo: true,
              },
            ],
          }),
      },
    });
    withIptv(view);
    return view;
  }

  it('junta las listas y la IPTV en una tabla seguida; el «ahora» sale de la guía', async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    setupIptv();
    expect(await screen.findByRole('tab', { name: 'Todos · 1203' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screen.findByRole('link', { name: 'Telecinco' });
    // Sin rótulos de grupo: primero tus listas y después tu IPTV.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const names = [...document.querySelectorAll('.ctab-row__title')].map((el) => el.textContent);
    expect(names.indexOf('M+ LaLiga')).toBeLessThan(names.indexOf('Telecinco'));
    // Cada canal dice de dónde sale: tu IPTV o AceStream.
    expect(rowOf('Telecinco').querySelector('.ctab-row__origin')).toHaveTextContent('IPTV');
    expect(rowOf('M+ LaLiga').querySelector('.ctab-row__origin')).toHaveTextContent('AceStream');
    const tele = (await screen.findByRole('link', { name: 'Telecinco' })).closest(
      '.ctab-row',
    ) as HTMLElement;
    await waitFor(() => expect(tele).toHaveTextContent('Informativos Telecinco'));
    expect(tele.querySelector<HTMLElement>('.ctab-row__bar')?.style.getPropertyValue('--p')).toBe(
      '0.5',
    );
    expect(tele.querySelector('.ctab-row__time')).toHaveTextContent('21:30');
    expect(tele).toHaveTextContent('Gran Hermano');
    expect(rowOf('Cine Clásico')).toHaveTextContent('Sin guía para este canal');
    // El canal AceStream de la lista, con la guía del canal de tu IPTV que es (en directo, rojo).
    const liga = rowOf('M+ LaLiga');
    await waitFor(() => expect(liga).toHaveTextContent('El partido de las 21'));
    expect(liga.querySelector('.ctab-row__now--live')).not.toBeNull();
    // Su logo, por el proxy de la guía.
    expect(liga.querySelector('.plate--logo img')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/v1/iptv/guide/art/c9'),
    );
    // La guía se pide con los ids de la tabla: los de tu lista (antes de que llegue
    // tu IPTV, solos) y luego todos en un trozo.
    const guideCalls = net.calls.filter((c) => c.url.startsWith('/api/v1/iptv/guide/now'));
    expect(guideCalls.length).toBeLessThanOrEqual(2);
    expect(new URL(guideCalls.at(-1)!.url, 'http://x').searchParams.get('ids')).toBe(
      [...library.web.map((item) => item.id), iptvId(1), iptvId(2)].join(','),
    );
  });

  it('los chips suman los tipos de la IPTV y el tipo elegido viaja al servidor', async () => {
    setupIptv();
    const group = await screen.findByRole('group', { name: 'Filtrar por tipo de canal' });
    await waitFor(() =>
      expect(
        within(group)
          .getAllByRole('button')
          .map((chip) => chip.textContent),
      ).toEqual(['Todo', 'Deportes', 'Cine']),
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Cine' }));
    await waitFor(() =>
      expect(
        net.calls.some(
          (c) =>
            c.url.startsWith('/api/v1/iptv/browse') &&
            new URL(c.url, 'http://x').searchParams.get('type') === 'cine',
        ),
      ).toBe(true),
    );
  });

  it('«Categorías IPTV» (en «Más opciones») abre el recorrido por categorías y filtros de siempre', async () => {
    setupIptv();
    await screen.findByRole('link', { name: 'Telecinco' });
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones de Canales' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Categorías IPTV' }));
    expect(new URLSearchParams(location.search).get('pestana')).toBe('iptv');
    expect(await screen.findByRole('button', { name: 'Volver a la tabla' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar en tu IPTV' })).toBeInTheDocument();
  });
});

describe('tipos de canal (genres.ts)', () => {
  it('manda la categoría; si no dice nada, el nombre', () => {
    expect(genreOf({ title: 'DAZN 1', category: 'Cine' })).toBe('cine');
    expect(genreOf({ title: 'DAZN 1', category: '' })).toBe('deportes');
    expect(genreOf({ title: 'Clan TVE', category: 'Guardado' })).toBe('infantil');
    expect(genreOf({ title: 'La 1', category: 'Generalistas' })).toBeNull();
  });

  it('las palabras cortas solo valen enteras: «Gol» sí, «Golden» no', () => {
    expect(genreOf({ title: 'Gol Play', category: '' })).toBe('deportes');
    expect(genreOf({ title: 'Golden Hits', category: '' })).toBeNull();
    expect(genreOf({ title: 'Nickel TV', category: '' })).toBeNull();
    expect(genreOf({ title: 'Radio Marca', category: '' })).toBeNull();
    expect(genreOf({ title: 'TNT Sports 1', category: '' })).toBe('deportes');
    // Las que acaban en «*» casan como principio de palabra.
    expect(genreOf({ title: 'Movistar Deportes 2', category: '' })).toBe('deportes');
    expect(genreOf({ title: 'Cinemax', category: '' })).toBe('cine');
  });

  it('la placa del canal: la marca con su color o la primera palabra', () => {
    expect(brandOf('DAZN 1 FHD')?.label).toBe('DAZN');
    expect(brandOf('M+ LaLiga')?.label).toBe('M+');
    expect(brandOf('beIN Sports 1')?.label).toBe('beIN');
    expect(brandOf('Telemadrid')).toBeNull();
    expect(plateLabel('Telemadrid HD')).toBe('Telemadrid');
    expect(plateLabel('La 2')).toBe('La 2');
  });

  it('el relleno de la demo siempre cae dentro del programa (nunca la barra al 100 %)', () => {
    const now = new Date('2026-09-23T19:47:00Z').getTime();
    for (let n = 0; n < 200; n += 1) {
      const id = (n * 7919).toString(16).padStart(6, '0').padEnd(40, 'a');
      const fill = demoFill(id, now);
      expect(fill.now!.start).toBeLessThanOrEqual(now);
      expect(fill.now!.end).toBeGreaterThan(now);
      expect(fill.next!.start).toBe(fill.now!.end);
    }
  });

  it('pide la guía en trozos de 100 ids sin repetir', () => {
    const ids = Array.from({ length: 230 }, (_, n) => `${n}`.padStart(40, 'a'));
    const chunks = chunkIds([...ids, ids[0]!]);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 30]);
  });

  it('un favorito IPTV pide su guía por su id', async () => {
    const id = 'f'.repeat(40);
    const library = makeLibrary({
      favorites: [makeItem('Antena 3', 'fav', { id, category: 'IPTV' })],
      iptvIds: { [id]: 'ok' },
    });
    const view = setup(library, {
      routes: {
        'GET /api/v1/iptv/guide/now': { available: false, version: '', items: [] },
      },
    });
    withIptv(view);
    await screen.findByRole('link', { name: 'Antena 3' });
    await waitFor(() =>
      expect(net.calls.find((c) => c.url.startsWith('/api/v1/iptv/guide/now'))?.url).toContain(id),
    );
    expect(rowOf('Antena 3')).toHaveTextContent('Sin guía para este canal');
  });
});
