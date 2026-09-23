import type { DiagnosticEntry, DiagnosticsListResponse, HealthResponse } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { routeKey } from '../../api/query.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch } from '../../test/fetch.ts';
import { DIAG_LIMIT, VIRTUAL_FROM } from './DiagnosticsLog.tsx';
import { CONFIRM_RESTART_MS, RECHECK_AFTER_RESTART_MS } from './engine.ts';
import { HealthSection } from './HealthSection.tsx';
import { renderSection } from './test-utils.tsx';
import HealthSettings from './ajustes.tsx';

let net: ReturnType<typeof mockFetch>;

function entries(count: number, over: Partial<DiagnosticEntry> = {}): DiagnosticEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `diag_${String(index).padStart(6, '0')}`,
    at: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
    cause: 'engine' as const,
    code: 'engine_stalled',
    message: `Fallo ${index + 1}`,
    ...over,
  }));
}

function mock(extra: Parameters<typeof mockFetch>[0] = {}) {
  net = mockFetch({
    'GET /api/v1/health': fixture('health'),
    'GET /api/v1/engine/status': fixture('engineStatus'),
    'GET /api/v1/diagnostics': (call) => {
      const cause = new URL(call.url, 'http://x').searchParams.get('cause');
      const base = fixture<DiagnosticsListResponse>('diagnosticsList');
      return json(cause ? { ...base, entries: base.entries.filter((e) => e.cause === cause) } : base);
    },
    'POST /api/v1/engine/restart': { restarted: true },
    'GET /api/v1/devices': fixture('devicesList'),
    ...extra,
  });
}

function setup(extra: Parameters<typeof mockFetch>[0] = {}) {
  mock(extra);
  return renderSection(<HealthSection />);
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  vi.useRealTimers();
  net?.restore();
  resetToasts();
  resetMode();
});

describe('Salud del sistema', () => {
  it('resumen, cuadrícula por servicio con forma y palabra, y sin sondeos', async () => {
    setup();
    expect(screen.getByText('Comprobando el NAS y los servicios…')).toBeInTheDocument();
    expect(await screen.findByText('Todo funciona.')).toBeInTheDocument();
    expect(screen.getByText(/^1 fuente en cuarentena · 4 correcciones aprendidas · comprobado \d\d:\d\d$/)).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Servicios' });
    const tiles = within(grid).getAllByRole('listitem');
    expect(tiles.map((t) => within(t).getByRole('heading').textContent)).toEqual([
      'Backend',
      'Motor principal',
      'Segundo motor',
      'IA local',
      'Agenda',
      'Directorios M3U',
      'Datos guardados',
      'Reproducción',
    ]);
    const engine = tiles[1] as HTMLElement;
    expect(engine).toHaveAttribute('data-signal', 'ok');
    expect(within(engine).getByText('Listo')).toBeInTheDocument();
    expect(within(engine).getByText('Aceptando reproducción · versión 3.2.3')).toBeInTheDocument();
    // La IA desactivada: gris y «Desactivado», nunca solo color.
    expect(tiles[3]).toHaveAttribute('data-signal', 'pending');
    expect(within(tiles[3] as HTMLElement).getByText('Desactivado')).toBeInTheDocument();
    // Una petición por ruta al abrir; nada más (no hay sondeo).
    await waitFor(() => expect(net.calls.filter((c) => c.url.startsWith('/api/v1/health'))).toHaveLength(1));
    expect(net.calls.find((c) => c.url.startsWith('/api/v1/diagnostics'))?.url).toBe(
      `/api/v1/diagnostics?limit=${DIAG_LIMIT}`,
    );
  });

  it('«Volver a comprobar» vuelve a pedir la salud, el registro y el motor', async () => {
    setup();
    await screen.findByText('Todo funciona.');
    const before = net.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Volver a comprobar' }));
    await waitFor(() => {
      const urls = net.calls.slice(before).map((c) => c.url.split('?')[0]);
      expect(urls).toEqual(expect.arrayContaining(['/api/v1/health', '/api/v1/diagnostics']));
    });
  });

  it('el motor en vivo (SSE engine.status) manda sobre la foto de /health', async () => {
    const { client } = setup();
    await screen.findByText('Todo funciona.');
    // Que termine la primera lectura del motor: el evento llega después.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    act(() => {
      client.setQueryData(routeKey('engineStatus'), {
        ...fixture<HealthResponse>('health').components.engine,
        status: 'offline',
        online: false,
      });
    });
    // TanStack Query avisa a los componentes en la siguiente vuelta del bucle.
    const engine = () => document.querySelector('[data-service="engine"]') as HTMLElement;
    await waitFor(() => expect(engine()).toHaveAttribute('data-signal', 'fail'));
    expect(within(engine()).getByText('No responde')).toBeInTheDocument();
    expect(screen.getByText('Motor principal: sin conexión.')).toBeInTheDocument();
  });

  it('reiniciar el motor pide un segundo toque (6 s) y luego vuelve a mirar', async () => {
    const { client } = setup();
    await screen.findByText('Todo funciona.');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const button = screen.getByRole('button', { name: 'Reiniciar el motor' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '¿Seguro? Pulsa otra vez' })).toBeInTheDocument();
    expect(screen.getByText(/Reiniciarlo corta la reproducción en todos los dispositivos/)).toBeInTheDocument();
    expect(net.calls.some((c) => c.method === 'POST')).toBe(false);
    // Pasado el plazo, se desarma solo.
    act(() => vi.advanceTimersByTime(CONFIRM_RESTART_MS + 10));
    expect(screen.getByRole('button', { name: 'Reiniciar el motor' })).toBeInTheDocument();
    // Dos toques seguidos: reinicia.
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar el motor' }));
    fireEvent.click(screen.getByRole('button', { name: '¿Seguro? Pulsa otra vez' }));
    await waitFor(() => expect(net.calls.some((c) => c.method === 'POST' && c.url === '/api/v1/engine/restart')).toBe(true));
    expect((client.getQueryData(routeKey('engineStatus')) as { status: string }).status).toBe('restarting');
    await waitFor(() => expect(toastStore.get().at(-1)?.text).toBe('Reiniciando el motor AceStream…'));
    const before = net.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(RECHECK_AFTER_RESTART_MS + 10);
    });
    await waitFor(() =>
      expect(net.calls.slice(before).map((c) => c.url)).toEqual(expect.arrayContaining(['/api/v1/engine/status'])),
    );
  });

  it('si el reinicio falla, sale el mensaje del backend', async () => {
    setup({
      'POST /api/v1/engine/restart': () =>
        json({ error: { code: 'restart_cooldown', message: 'Espera unos segundos antes de volver a reiniciarlo.', requestId: 'r' } }, 409),
    });
    await screen.findByText('Todo funciona.');
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar el motor' }));
    fireEvent.click(screen.getByRole('button', { name: '¿Seguro? Pulsa otra vez' }));
    await waitFor(() =>
      expect(toastStore.get().at(-1)?.text).toBe(
        'No se pudo reiniciar el motor. Espera unos segundos antes de volver a reiniciarlo.',
      ),
    );
  });

  it('sin salud: estado de error con salida (regla 32)', async () => {
    setup({
      'GET /api/v1/health': () => json({ error: { code: 'internal_error', message: 'Algo falló.', requestId: 'r' } }, 500),
    });
    expect(await screen.findByRole('heading', { name: 'No se pudo leer la salud' })).toBeInTheDocument();
    expect(screen.getByText('Vuelve a comprobar cuando el NAS esté accesible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a comprobar' })).toBeInTheDocument();
  });

  it('avisos del backend tal cual', async () => {
    setup({
      'GET /api/v1/health': {
        ...fixture<HealthResponse>('health'),
        warnings: [{ code: 'auto_restart_exhausted', message: 'El motor ya se ha reiniciado 3 veces esta hora.' }],
      },
    });
    const list = await screen.findByRole('list', { name: 'Avisos' });
    expect(within(list).getByText('El motor ya se ha reiniciado 3 veces esta hora.')).toBeInTheDocument();
    expect(screen.getByText('Todo funciona, con avisos.')).toBeInTheDocument();
  });
});

describe('registro de fallos', () => {
  it('lista en claro con causa, canal y hora; recuento de 24 h; chips solo con fallos', async () => {
    setup();
    const log = await screen.findByRole('list', { name: 'Fallos registrados' });
    const row = within(log).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(row).getByText('La fuente no tiene pares.')).toBeInTheDocument();
    expect(within(row).getByText('Fuente')).toBeInTheDocument();
    expect(within(row).getByText('DAZN 1')).toBeInTheDocument();
    expect(within(row).getByText('source_no_peers')).toBeInTheDocument();
    const filter = screen.getByRole('group', { name: 'Filtrar por causa' });
    const chips = within(filter).getAllByRole('button');
    // 1 + 3 + 0 + 1 + 2 + 0 = 7; «Red» y «Datos guardados» no tienen fallos: no salen.
    expect(chips.map((c) => c.textContent)).toEqual(['Todo7', 'Motor1', 'Fuente3', 'Códec1', 'Reproductor2']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    // Hay 7 guardados y se enseña 1.
    expect(screen.getByText('Sale el más reciente de 7 guardados.')).toBeInTheDocument();
  });

  it('filtrar por causa pide al backend ya filtrado y explica la causa', async () => {
    setup();
    await screen.findByRole('list', { name: 'Fallos registrados' });
    fireEvent.click(screen.getByRole('button', { name: /^Motor/ }));
    expect(screen.getByText('El motor AceStream se cayó, no pudo abrir un canal o se reinició.')).toBeInTheDocument();
    await waitFor(() =>
      expect(net.calls.map((c) => c.url)).toContain(`/api/v1/diagnostics?cause=engine&limit=${DIAG_LIMIT}`),
    );
    expect(await screen.findByText('Sin fallos de «Motor» registrados.')).toBeInTheDocument();
    // Otra vez el mismo chip: vuelve a «Todo».
    fireEvent.click(screen.getByRole('button', { name: /^Motor/ }));
    expect(await screen.findByText('La fuente no tiene pares.')).toBeInTheDocument();
  });

  it('por fuente: las que fallan en 24 h, agrupadas', async () => {
    setup({
      'GET /api/v1/diagnostics': {
        entries: [
          ...entries(2, { cause: 'source', hash: 'a'.repeat(40), channel: 'DAZN 1' }),
          ...entries(1, { cause: 'client', channel: 'Teledeporte', id: 'diag_tele01' }),
        ],
        counts24h: { engine: 0, source: 2, network: 0, codec: 0, client: 1, state: 0 },
        total: 3,
      },
    });
    const list = await screen.findByRole('list', { name: 'Fuentes con fallos en las últimas 24 horas' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('DAZN 1');
    expect(rows[0]).toHaveTextContent('2 fallos');
    expect(rows[1]).toHaveTextContent('Teledeporte');
    expect(rows[1]).toHaveTextContent('Reproductor');
  });

  it('los fallos de un dispositivo emparejado llevan su nombre', async () => {
    setup({
      'GET /api/v1/diagnostics': {
        entries: entries(1, { cause: 'client', code: 'autoplay_blocked', message: '', deviceId: 'dev_iphone01' }),
        counts24h: { engine: 0, source: 0, network: 0, codec: 0, client: 1, state: 0 },
        total: 1,
      },
    });
    expect(await screen.findByText('iPhone de prueba')).toBeInTheDocument();
  });

  it(`más de ${VIRTUAL_FROM} fallos: lista virtualizada (no se pintan todos)`, async () => {
    setup({
      'GET /api/v1/diagnostics': {
        entries: entries(150),
        counts24h: { engine: 150, source: 0, network: 0, codec: 0, client: 0, state: 0 },
        total: 150,
      },
    });
    const log = await screen.findByRole('list', { name: 'Fallos registrados' });
    const painted = within(log).getAllByRole('listitem').length;
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(150);
  });

  it('sin fallos: lo dice (es buena noticia, no un vacío que resolver)', async () => {
    setup({
      'GET /api/v1/diagnostics': {
        entries: [],
        counts24h: { engine: 0, source: 0, network: 0, codec: 0, client: 0, state: 0 },
        total: 0,
      },
    });
    expect(await screen.findByText('Sin fallos registrados. Todo ha ido bien.')).toBeInTheDocument();
  });

  it('si el registro no se puede leer: aviso con «Reintentar»', async () => {
    setup({
      'GET /api/v1/diagnostics': () =>
        json({ error: { code: 'internal_error', message: 'Algo falló.', requestId: 'r' } }, 500),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo leer el registro.');
    expect(within(alert).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

describe('entrada de Ajustes', () => {
  it('ajustes.tsx exporta la sección (sin cabecera propia)', async () => {
    mock();
    renderSection(<HealthSettings route={{ vista: 'ajustes', seccion: 'salud' }} active />);
    expect(await screen.findByText('Todo funciona.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
