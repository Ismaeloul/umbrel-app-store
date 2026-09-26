import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { setTheme, setTransparency, themeStore } from '../../app/theme.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import { makeLibrary, renderWithApp } from '../library/test-utils.tsx';
import { getPlaybackMode, resetPlayerApi, setPlaybackMode } from '../../player/api.ts';
import SettingsView, { preferenceSummary } from './SettingsView.tsx';
import { preferenceSummary as sharedSummary } from '../preferences/model.ts';

// Estas pruebas son de las secciones PROPIAS de Ajustes: se simula que ninguna
// otra vista aporta Salud ni Dispositivos (que ya existen en src/features/
// health y devices; su integración con Ajustes la prueban
// health/settings-integration.test.tsx). Añadido por el agente de salud.
vi.mock('./external.tsx', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  externalSection: () => null,
}));

let net: ReturnType<typeof mockFetch>;

function setup(search = '?vista=ajustes', extra: Parameters<typeof mockFetch>[0] = {}) {
  const { web, webSyncedAt, webSources, activeWebSourceId } = makeLibrary();
  net = mockFetch({
    'GET /api/v1/directories': { web, webSyncedAt, webSources, activeWebSourceId },
    'GET /api/v1/settings': { settings: { sameChannelPolicy: 'share' }, source: 'saved' },
    'PUT /api/v1/settings': { settings: { sameChannelPolicy: 'handoff' }, source: 'saved' },
    'GET /api/v1/preferences': fixture('preferencesGet'),
    'GET /api/v1/engine/status': fixture('engineStatus'),
    'POST /api/v1/engine/restart': { restarted: true },
    'GET /api/v1/bootstrap': fixture('bootstrap'),
    'GET /api/v1/playback': fixture('playbackStatus'),
    'GET /api/v1/iptv': { provider: null, refreshHours: 6 },
    ...extra,
  });
  const seccion = new URLSearchParams(search).get('vista')?.split('/')[1] ?? null;
  return renderWithApp(<SettingsView route={{ vista: 'ajustes', seccion }} active />, { search });
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
  setPlaybackMode('balanced');
  resetPlayerApi();
  setTheme('sistema');
  setTransparency('normal');
});

describe('Ajustes', () => {
  it('secciones con su índice; sin Salud ni Dispositivos si nadie los aporta', async () => {
    setup();
    const index = screen.getByRole('navigation', { name: 'Secciones de Ajustes' });
    const names = within(index)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(names).toEqual([
      'Listas',
      'IPTV',
      'Tu fútbol',
      'Reproducción',
      'Dónde se está reproduciendo',
      'Apariencia',
      'Motor AceStream',
      'Acerca de',
    ]);
    expect(await screen.findByRole('heading', { name: 'Listas', level: 2 })).toBeInTheDocument();
    fireEvent.click(within(index).getByRole('link', { name: 'Motor AceStream' }));
    await waitFor(() => expect(screen.getByTestId('ruta')).toHaveTextContent('ajustes/motor'));
  });

  it('«ajustes/salud» sin panel de salud lleva a la sección del motor', async () => {
    setup('?vista=ajustes/salud');
    const index = screen.getByRole('navigation', { name: 'Secciones de Ajustes' });
    expect(within(index).getByRole('link', { name: 'Motor AceStream' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('modo de reproducción: lo guarda el reproductor por visor y avisa', async () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: 'Modo de reproducción' });
    expect(within(group).getByRole('radio', { name: /Equilibrado/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(group).getByRole('radio', { name: /Baja latencia/ }));
    expect(getPlaybackMode()).toBe('low');
    expect(localStorage.getItem('aceneo-pb')).toBe('low');
    expect(within(group).getByRole('radio', { name: /Baja latencia/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(toastStore.get().at(-1)?.text).toBe('Modo «Baja latencia» activado');
    // Flechas: el patrón ARIA del grupo de radios (y el foco va con la selección).
    fireEvent.keyDown(within(group).getByRole('radio', { name: /Baja latencia/ }), {
      key: 'ArrowRight',
    });
    expect(getPlaybackMode()).toBe('balanced');
    expect(within(group).getByRole('radio', { name: /Equilibrado/ })).toHaveFocus();
    fireEvent.keyDown(within(group).getByRole('radio', { name: /Equilibrado/ }), { key: 'End' });
    expect(getPlaybackMode()).toBe('stable');
  });

  it('«Un solo dispositivo a la vez» guarda la política handoff (D5)', async () => {
    setup();
    const toggle = await screen.findByRole('switch', { name: 'Un solo dispositivo a la vez' });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(net.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        sameChannelPolicy: 'handoff',
      }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(toastStore.get().at(-1)?.text).toBe('Un solo dispositivo a la vez: activado');
  });

  it('tema y «Reducir transparencia» propio', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Oscuro' }));
    expect(themeStore.get().theme).toBe('oscuro');
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('switch', { name: 'Reducir transparencia' }));
    expect(themeStore.get().transparency).toBe('reducida');
    expect(document.documentElement.dataset.transparency).toBe('reduced');
  });

  it('reiniciar el motor pide un segundo toque en 6 s y vuelve a mirar el motor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    const button = screen.getByRole('button', { name: 'Reiniciar el motor' });
    fireEvent.click(button);
    expect(
      screen.getByRole('button', { name: '¿Seguro? Pulsa otra vez para reiniciar' }),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(6100));
    expect(screen.getByRole('button', { name: 'Reiniciar el motor' })).toBeInTheDocument();
    expect(net.calls.some((c) => c.url === '/api/v1/engine/restart')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar el motor' }));
    fireEvent.click(screen.getByRole('button', { name: '¿Seguro? Pulsa otra vez para reiniciar' }));
    await waitFor(() =>
      expect(net.calls.some((c) => c.url === '/api/v1/engine/restart')).toBe(true),
    );
    await waitFor(() =>
      expect(toastStore.get().at(-1)?.text).toBe('Reiniciando el motor AceStream…'),
    );
    const before = net.calls.filter((c) => c.url === '/api/v1/engine/status').length;
    await act(() => vi.advanceTimersByTimeAsync(2600));
    await waitFor(() =>
      expect(net.calls.filter((c) => c.url === '/api/v1/engine/status').length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('«Acerca de» con la versión y «Tu fútbol» con el resumen', async () => {
    setup();
    expect(await screen.findByText('0.7.0')).toBeInTheDocument();
    expect(
      await screen.findByText(/^Tu agenda prioriza 2 ligas, 1 equipo y 1 nacionalidad\.$/),
    ).toBeInTheDocument();
    expect(preferenceSummary({ leagues: [], teams: [], nationalities: [] })).toBe(
      'Personaliza la agenda con tus ligas, equipos y nacionalidades.',
    );
  });

  it('el resumen de gustos dice lo mismo que el de la vista de preferencias', () => {
    // Copia deliberada (ver SettingsView.tsx): que no se separen nunca.
    const cases = [
      { leagues: [], teams: [], nationalities: [] },
      { leagues: ['LaLiga'], teams: [], nationalities: [] },
      { leagues: ['LaLiga', 'Premier League'], teams: ['Real Madrid'], nationalities: [] },
      { leagues: [], teams: ['Betis', 'Sevilla'], nationalities: ['España'] },
      { leagues: ['A', 'B', 'C'], teams: ['D'], nationalities: ['E', 'F'] },
    ];
    for (const prefs of cases) expect(preferenceSummary(prefs)).toBe(sharedSummary(prefs));
    expect(preferenceSummary(null)).toBe(sharedSummary(null));
  });
});
