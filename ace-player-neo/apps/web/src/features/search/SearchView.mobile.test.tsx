/* Buscar en el móvil (por debajo de 768; maqueta buscar-ajustes.html): la
   flecha y el campo en la cabecera; sin texto, Recientes, Atajos y «Pegar un
   enlace»; con texto, Partidos, tus canales, Pelis y series y el motor,
   agrupados y con chips. Las reglas del motor y de tu IPTV (las mismas en
   los dos tamaños) las prueba SearchView.test.tsx. */

import type { BootstrapResponse } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { madridClock } from '../agenda/domain.ts';
import { resetScoreRevealForTests, setScoreHiding } from '../agenda/score-reveal.ts';
import { liveScore, matchAt, scheduleOf } from '../agenda/test-utils.tsx';
import { makeLibrary, renderWithApp, resetPlayback } from '../library/test-utils.tsx';
import { readRecents, RECENTS_KEY } from './quick-model.ts';
import SearchView from './SearchView.tsx';

const HASH = 'a3f19c2b7d4e8f0a1b2c3d4e5f6a7b8c9d0e1f2a';

let net: ReturnType<typeof mockFetch>;

/** vodBrowse con las pelis del ejemplo, filtradas por el texto (sin series). */
function browse(url: string) {
  const params = new URL(url, 'http://x').searchParams;
  const page = fixture<{ items: Array<{ kind: string; title: string }> }>('vodBrowse');
  const q = (params.get('q') ?? '').toLowerCase();
  const items = params.get('kind') === 'movie' ? page.items : [];
  return json({ ...page, items: items.filter((item) => item.title.toLowerCase().includes(q)) });
}

function setup({ vod = false, search = '?vista=buscar' } = {}) {
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
    'GET /api/v1/vod/browse': (call) => browse(call.url),
    'GET /api/v1/search': (call) => {
      const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
      return json({ query: q, results: [] });
    },
  });
  // Móvil: el tamaño por defecto de renderWithApp.
  const view = renderWithApp(<SearchView route={{ vista: 'buscar' }} active />, { search });
  if (vod) {
    const boot = fixture<BootstrapResponse>('bootstrap');
    act(() => {
      view.client.setQueryData(routeKey('bootstrap'), {
        ...boot,
        features: { ...boot.features, vod: true },
      });
    });
  }
  return view;
}

const field = () => screen.getByRole('searchbox', { name: /^Buscar partidos/ });
const type = (value: string) => {
  fireEvent.change(field(), { target: { value } });
  fireEvent.keyDown(field(), { key: 'Enter' });
};
const searchCalls = () => net.calls.filter((c) => c.url.startsWith('/api/v1/search'));

beforeEach(() => {
  localStorage.clear();
  resetMemoryStorage();
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  vi.restoreAllMocks();
  net?.restore();
  resetToasts();
  resetMode();
  resetPlayback();
});

describe('Buscar en el móvil · vacío', () => {
  it('el campo va en la cabecera; sin texto, Recientes, Atajos y «Pegar un enlace»', () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(['Real Madrid', 'DAZN']));
    setup();
    const head = screen.getByRole('banner');
    expect(
      within(head).getByRole('searchbox', { name: 'Buscar partidos y canales' }),
    ).toHaveAttribute('placeholder', 'Partidos, canales…');
    // El titular sigue para los lectores de pantalla (y para el foco del armazón).
    expect(screen.getByRole('heading', { name: 'Buscar', level: 1 })).toBeInTheDocument();
    const recents = screen.getByRole('region', { name: 'Recientes' });
    expect(within(recents).getByRole('button', { name: 'Real Madrid' })).toBeInTheDocument();
    const shortcuts = screen.getByRole('region', { name: 'Atajos' });
    for (const name of ['En directo ahora', 'Mis equipos', 'Mi lista', 'Mis avisos']) {
      expect(within(shortcuts).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /acestream:\/\/ o Content ID/ })).toBeInTheDocument();
    // Ni la pista del motor ni su sección sin texto.
    expect(screen.queryByText('Busca canales publicados en el motor AceStream.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'En el motor AceStream' })).toBeNull();
  });

  it('sin recientes, no sale su rótulo; con IPTV o pelis, el campo lo dice', () => {
    setup({ vod: true });
    expect(screen.queryByRole('region', { name: 'Recientes' })).toBeNull();
    expect(
      screen.getByRole('searchbox', { name: 'Buscar partidos, canales, pelis y series' }),
    ).toHaveAttribute('placeholder', 'Partidos, canales, pelis…');
  });

  it('tocar un reciente lo busca al momento; la ✕ lo quita', async () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(['Real Madrid', 'DAZN']));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar «DAZN» de recientes' }));
    expect(screen.queryByRole('button', { name: 'DAZN' })).toBeNull();
    expect(readRecents()).toEqual(['Real Madrid']);
    fireEvent.click(screen.getByRole('button', { name: 'Real Madrid' }));
    expect(field()).toHaveValue('Real Madrid');
    await waitFor(() => expect(searchCalls().at(-1)?.url).toBe('/api/v1/search?q=Real+Madrid'));
    expect(await screen.findByRole('region', { name: 'Partidos' })).toBeInTheDocument();
  });

  it('el atajo «Mis avisos» lleva a Ajustes → Tu fútbol', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mis avisos' }));
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('ajustes/futbol'));
  });

  it('«Pegar un enlace» con un acestream:// copiado: sale «Enlace detectado»', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => `acestream://${HASH}`) },
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /acestream:\/\/ o Content ID/ }));
    expect(
      await screen.findByRole('heading', { name: 'Es un Content ID de AceStream' }),
    ).toBeInTheDocument();
    expect(field()).toHaveValue(`acestream://${HASH}`);
  });

  it('«Pegar un enlace» sin permiso para leer el portapapeles: la hoja de pegar', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => {
          throw new Error('denegado');
        }),
      },
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /acestream:\/\/ o Content ID/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Buscar en el móvil · resultados', () => {
  it('agrupa: Partidos con el directo primero, tus canales y el motor; chips con lo que hay', async () => {
    setup();
    type('barc');
    const partidos = await screen.findByRole('region', { name: 'Partidos' });
    const rows = within(partidos).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Real Madrid – Barcelona');
    expect(rows[0]).toHaveAttribute('href', '?vista=partido/clasico');
    expect(rows[1]).toHaveTextContent('Barcelona – Inter');
    const chips = screen.getByRole('group', { name: 'Qué enseñar' });
    await waitFor(() =>
      expect(
        within(chips)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Todo · 2', 'Partidos · 2']),
    );
    // El motor, al final (aquí sin nada más).
    expect(
      await screen.findByText('El motor AceStream no tiene nada más para «barc».'),
    ).toBeInTheDocument();
  });

  it('el chip de un grupo deja solo ese grupo (sin el motor)', async () => {
    setup();
    type('barc');
    await screen.findByRole('region', { name: 'Partidos' });
    fireEvent.click(await screen.findByRole('button', { name: 'Partidos · 2' }));
    expect(screen.getByRole('button', { name: 'Partidos · 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('region', { name: 'En el motor AceStream' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Todo · 2' }));
    expect(
      await screen.findByRole('region', { name: 'En el motor AceStream' }),
    ).toBeInTheDocument();
  });

  it('tocar un partido abre su ficha y apunta lo escrito en Recientes', async () => {
    setup();
    type('madrid');
    const partidos = await screen.findByRole('region', { name: 'Partidos' });
    fireEvent.click(within(partidos).getByRole('link', { name: /Real Madrid – Barcelona/ }));
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('partido/clasico'));
    expect(readRecents()).toEqual(['madrid']);
  });

  it('Pelis y series del catálogo (features.vod): tocar una abre su ficha', async () => {
    setup({ vod: true });
    type('dune');
    const pelis = await screen.findByRole('region', { name: 'Pelis y series' });
    const dune = within(pelis).getByRole('link', { name: /Dune/ });
    expect(dune).toHaveTextContent('Película');
    fireEvent.click(dune);
    await waitFor(() =>
      expect(screen.getByTestId('ruta')).toHaveTextContent(
        'cine/4b5c6d7e8f9012345678abcdef0123457a8b9c0d',
      ),
    );
    expect(readRecents()).toEqual(['dune']);
  });

  it('tus canales salen con sus filas de siempre («En tu biblioteca») y cuentan en «Canales»', async () => {
    setup();
    type('dazn');
    const local = await screen.findByRole('region', { name: 'En tu biblioteca' });
    expect(within(local).getByRole('link', { name: 'DAZN 1' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Canales · 1' })).toBeInTheDocument();
    // Sin avisos: el motor vacío es una línea, porque tus canales ya están arriba.
    expect(toastStore.get()).toHaveLength(0);
  });
});

/* «Marcador oculto» (Ajustes): en el móvil la fila de tu canal que echa un
   partido lo tapa como la Agenda móvil (puntos/guion, sin cifras). El
   escritorio, sin cambios: allí la fila sigue con la regla 29 de siempre. */
describe('Buscar · el marcador de lo que echa tu canal', () => {
  function setupScore(layout: { kind?: 'desktop' } = {}) {
    const now = Date.now();
    const live = matchAt(
      -36,
      {
        id: 'girona-sevilla',
        home: 'Girona',
        away: 'Sevilla',
        channels: [{ id: 'd', name: 'DAZN 1' }],
      },
      now,
    );
    net = mockFetch({
      'GET /api/v1/library': makeLibrary(),
      'GET /api/v1/football': scheduleOf({ [madridClock(now).date]: [live] }),
      'GET /api/v1/scores': {
        available: true,
        generatedAt: new Date(now).toISOString(),
        source: 'espn',
        attribution: 'ESPN',
        leagues: 1,
        scores: { [live.id]: liveScore(1, 1, "36'") },
      },
      'GET /api/v1/search': (call) => {
        const q = new URL(call.url, 'http://x').searchParams.get('q') ?? '';
        return json({ query: q, results: [] });
      },
    });
    return renderWithApp(<SearchView route={{ vista: 'buscar' }} active />, {
      search: '?vista=buscar',
      layout,
    });
  }
  afterEach(() => {
    setScoreHiding(true);
    resetScoreRevealForTests();
  });

  it('móvil con «Marcador oculto»: «Girona – Sevilla» sin cifras y «Marcador oculto»', async () => {
    setScoreHiding(true);
    setupScore();
    type('dazn');
    const local = await screen.findByRole('region', { name: 'En tu biblioteca' });
    expect(await within(local).findByText('Girona – Sevilla')).toBeInTheDocument();
    expect(local.querySelector('.ch__score')).toBeNull();
    expect(within(local).getByText('Marcador oculto')).toBeInTheDocument();
  });

  it('escritorio con el interruptor apagado: el marcador se ve', async () => {
    setScoreHiding(false);
    setupScore({ kind: 'desktop' });
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'dazn' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('.ch__score')).not.toBeNull());
    expect(document.querySelector('.ch__score')?.textContent).toContain('1');
    expect(screen.queryByText('Marcador oculto')).toBeNull();
  });
});
