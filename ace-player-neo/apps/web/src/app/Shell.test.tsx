/* Tests del armazón (Shell) SIN las vistas de verdad: views.tsx se sustituye
   por vistas, panel, columna y reproductor de mentira. Así lo que se prueba
   aquí es el armazón (navegación, vistas montadas, reproductor único,
   maquetación por anchos, avisos y atajos) y estos tests no se rompen cuando
   los agentes de las vistas cambian las suyas. El contrato con las vistas
   reales lo vigila views.test.tsx. */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/query.ts';
import { resetMode, setMode } from '../api/mode.ts';
import { readItem, STORAGE_KEYS } from '../lib/storage.ts';
import { noticeFlags } from '../notices/notify.ts';
import { fixture, mockFetch } from '../test/fetch.ts';
import { App } from './App.tsx';
// Solo tipos: se borran al compilar, así que sirven dentro de la fábrica de vi.mock.
import type { PlayerDockProps, ViewProps } from './contracts.ts';
import { playerPresence } from './player-presence.ts';
import { installShortcutListener, shortcutStore } from './shortcuts.ts';

vi.mock('./views.tsx', async () => {
  const { lazy, useState } = await import('react');
  const { ViewHeader } = await import('./ViewHeader.tsx');
  const { VISTA_TITLE } = await import('./routes.ts');
  const { useLayout } = await import('./layout.tsx');
  const { setPlayerPresence } = await import('./player-presence.ts');

  /** Vista de mentira con estado propio (para ver que se conserva al volver). */
  function StubView({ route, active }: ViewProps) {
    const [note, setNote] = useState('');
    const layout = useLayout();
    return (
      <div>
        <ViewHeader title={VISTA_TITLE[route.vista]} />
        <label>
          Nota de {route.vista}
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <p>{active ? 'visible' : 'oculta'}</p>
        {layout.asideAvailable ? (
          <button type="button" onClick={() => layout.setAsideOpen(!layout.asideVisible)}>
            Plegar panel
          </button>
        ) : null}
      </div>
    );
  }
  function StubAside() {
    return <p>Contenido del panel</p>;
  }
  function StubColumn() {
    return <p>Columna de agenda</p>;
  }
  function StubDock({ presentation, route, onMinimize, onExpand }: PlayerDockProps) {
    return (
      <div data-testid="dock" data-presentation={presentation}>
        <button type="button" onClick={() => setPlayerPresence({ active: true, route })}>
          Reproducir
        </button>
        <button type="button" onClick={onMinimize}>
          Minimizar
        </button>
        <button type="button" onClick={onExpand}>
          Abrir lo que suena
        </button>
      </div>
    );
  }
  const cache = new Map<string, unknown>();
  return {
    FEATURE_FOLDER: {
      agenda: 'agenda',
      biblioteca: 'biblioteca',
      buscar: 'buscar',
      ajustes: 'ajustes',
      partido: 'partido',
    },
    viewComponent: (vista: string) => {
      if (!cache.has(vista))
        cache.set(
          vista,
          vista === 'sistema'
            ? lazy(() => import('./sistema/SistemaPage.tsx'))
            : lazy(async () => ({ default: StubView })),
        );
      return cache.get(vista);
    },
    asideComponent: (vista: string) => {
      if (vista !== 'biblioteca') return null;
      if (!cache.has('aside'))
        cache.set(
          'aside',
          lazy(async () => ({ default: StubAside })),
        );
      return cache.get('aside');
    },
    AgendaColumn: lazy(async () => ({ default: StubColumn })),
    PlayerDock: lazy(async () => ({ default: StubDock })),
    preloadView: () => {},
  };
});

let uninstall: () => void = () => {};
let net: ReturnType<typeof mockFetch>;
const realMatchMedia = window.matchMedia;

/** Simula un ancho de pantalla para las consultas de medios que mira el armazón. */
function setViewport(width: number, height = 900) {
  window.matchMedia = ((query: string) => {
    const ok = query.split(' and ').every((part) => {
      const min = /min-width:\s*(\d+)px/.exec(part);
      if (min) return width >= Number(min[1]);
      const maxH = /max-height:\s*(\d+)px/.exec(part);
      if (maxH) return height <= Number(maxH[1]);
      if (part.includes('orientation: landscape')) return width > height;
      return false;
    });
    return {
      matches: ok,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  resetMode();
  setMode('live', 'bootstrap');
  net = mockFetch({ 'GET /api/v1/engine/status': fixture('engineStatus') });
  uninstall = installShortcutListener(window);
  setViewport(390, 844);
});
afterEach(() => {
  uninstall();
  net.restore();
  resetMode();
  shortcutStore.set([]);
  playerPresence.set({ active: false, route: null, immersive: false });
  window.matchMedia = realMatchMedia;
  history.replaceState(null, '', '/');
});

function renderApp(search = '') {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(<App client={createQueryClient()} initialSearch={search} />, { container: root });
}

const nav = () => screen.getAllByRole('navigation', { name: 'Principal' });
const app = () => document.querySelector('.app') as HTMLElement;

describe('armazón', () => {
  it('navegación con los cuatro destinos (barra inferior y superior) y enlace para saltar al contenido', async () => {
    renderApp();
    expect(nav()).toHaveLength(2);
    // La barra superior tiene la marca, los destinos y la ayuda de atajos.
    expect(document.querySelector('.topbar')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Atajos de teclado' })).toBeInTheDocument();
    for (const bar of nav()) {
      const links = within(bar).getAllByRole('link');
      expect(links.map((a) => a.textContent)).toEqual(
        expect.arrayContaining(['Agenda', 'Canales', 'Buscar', 'Ajustes']),
      );
      expect(within(bar).getByRole('link', { name: 'Agenda' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // Enlaces de verdad: se pueden abrir en otra pestaña (la vista sigue
      // siendo `biblioteca` en la URL aunque se titule «Canales»).
      expect(within(bar).getByRole('link', { name: 'Canales' })).toHaveAttribute(
        'href',
        '?vista=biblioteca',
      );
    }
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute(
      'href',
      '#contenido',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido');
    expect(await screen.findByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(app()).toHaveAttribute('data-layout', 'mobile');
    // El estado del motor llega de la API.
    expect(await screen.findAllByText('Motor en línea')).not.toHaveLength(0);
  });

  it('navegar conserva montada la vista anterior (con su estado) y mueve la gota', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Agenda' });
    fireEvent.change(screen.getByLabelText('Nota de agenda'), { target: { value: 'hola' } });
    fireEvent.click(within(nav()[0] as HTMLElement).getByRole('link', { name: 'Canales' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Canales' })).toBeInTheDocument();
    expect(location.search).toBe('?vista=biblioteca');
    const agenda = document.querySelector('.view[data-vista="agenda"]') as HTMLElement;
    expect(agenda.style.display).toBe('none');
    expect(document.querySelector('.tabbar')?.getAttribute('style')).toContain('--i: 1');
    // Vuelta a la agenda: la misma vista, con lo que se había escrito.
    fireEvent.click(within(nav()[0] as HTMLElement).getByRole('link', { name: 'Agenda' }));
    await waitFor(() => expect(agenda.style.display).not.toBe('none'));
    expect(screen.getByLabelText('Nota de agenda')).toHaveValue('hola');
  });

  it('«?» abre la ayuda con los atajos registrados y «/» lleva a la biblioteca', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Agenda' });
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    const dialog = await screen.findByRole('dialog', { name: 'Atajos de teclado' });
    expect(within(dialog).getByText('Enseña esta ayuda')).toBeInTheDocument();
    expect(within(dialog).getByText('Abre la biblioteca y enfoca el buscador')).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cerrar' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
      );
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Canales' })).toBeInTheDocument();
  });

  it('el reproductor es UNO: de grande en el partido a «mini» fuera sin recrearse', async () => {
    renderApp('?vista=partido/fltv-2026-09-23-3');
    const dock = await screen.findByTestId('dock');
    expect(dock).toHaveAttribute('data-presentation', 'stage');
    // En el partido: sin barra inferior y con la línea de estado bajo el vídeo.
    expect(document.querySelector('.tabbar')).toHaveAttribute('hidden');
    expect(document.querySelector('.status-host')).toHaveAttribute('aria-live', 'polite');
    expect(noticeFlags.get().watching).toBe(true);

    fireEvent.click(within(dock).getByRole('button', { name: 'Reproducir' }));
    fireEvent.click(within(dock).getByRole('button', { name: 'Minimizar' }));
    await screen.findByRole('heading', { level: 1, name: 'Agenda' });
    // El MISMO nodo (el <video> de dentro no se recrea), ahora en «mini».
    expect(screen.getByTestId('dock')).toBe(dock);
    expect(dock).toHaveAttribute('data-presentation', 'mini');
    expect(app()).toHaveAttribute('data-mini', 'true');
    expect(document.querySelector('.tabbar')).not.toHaveAttribute('hidden');
    expect(noticeFlags.get().watching).toBe(false);

    // Tocar el mini vuelve a lo que suena.
    fireEvent.click(within(dock).getByRole('button', { name: 'Abrir lo que suena' }));
    await waitFor(() => expect(dock).toHaveAttribute('data-presentation', 'stage'));
    expect(location.search).toBe('?vista=partido/fltv-2026-09-23-3');
  });

  it('sin nada sonando, salir del partido desmonta el reproductor', async () => {
    renderApp('?vista=partido/abc');
    const dock = await screen.findByTestId('dock');
    fireEvent.click(within(dock).getByRole('button', { name: 'Minimizar' }));
    await screen.findByRole('heading', { level: 1, name: 'Agenda' });
    expect(screen.queryByTestId('dock')).toBeNull();
    expect(app()).toHaveAttribute('data-mini', 'false');
  });

  it('inmersivo (vídeo a pantalla completa): ningún toast encima', async () => {
    renderApp('?vista=partido/abc');
    await screen.findByTestId('dock');
    act(() => playerPresence.set({ active: true, route: null, immersive: true }));
    await waitFor(() => expect(app()).toHaveAttribute('data-immersive', 'true'));
    expect(noticeFlags.get().immersive).toBe(true);
    expect(document.querySelector('.toaster')).toHaveAttribute('data-immersive', 'true');
  });

  it('escritorio: barra superior + vista + panel lateral plegable (se recuerda)', async () => {
    setViewport(1440, 900);
    renderApp('?vista=biblioteca');
    await screen.findByRole('heading', { level: 1, name: 'Canales' });
    expect(app()).toHaveAttribute('data-layout', 'wide');
    expect(await screen.findByText('Contenido del panel')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Panel lateral' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Plegar panel' }));
    await waitFor(() => expect(screen.queryByText('Contenido del panel')).toBeNull());
    expect(readItem(STORAGE_KEYS.aside)).toBe('plegado');
    // En la agenda (sin aside.tsx) no hay panel.
    fireEvent.click(within(nav()[0] as HTMLElement).getByRole('link', { name: 'Agenda' }));
    await screen.findByRole('heading', { level: 1, name: 'Agenda' });
    expect(screen.queryByRole('complementary', { name: 'Panel lateral' })).toBeNull();
  });

  it('pantalla ancha: en el partido, columna de agenda + reproductor a la vez', async () => {
    setViewport(1920, 1080);
    renderApp('?vista=partido/abc');
    expect(await screen.findByText('Columna de agenda')).toBeInTheDocument();
    expect(screen.getByTestId('dock')).toHaveAttribute('data-presentation', 'stage');
    expect(app()).toHaveAttribute('data-column', 'true');
  });

  it('tableta (768-1023): barra superior y sin panel lateral', async () => {
    setViewport(800, 1024);
    renderApp('?vista=biblioteca');
    await screen.findByRole('heading', { level: 1, name: 'Canales' });
    expect(app()).toHaveAttribute('data-layout', 'tablet');
    expect(screen.queryByText('Contenido del panel')).toBeNull();
  });

  it('?vista=sistema enseña la página de muestra en desarrollo', async () => {
    renderApp('?vista=sistema');
    expect(await screen.findByRole('heading', { name: 'Sistema', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Tema' })).toBeInTheDocument();
  });
});
