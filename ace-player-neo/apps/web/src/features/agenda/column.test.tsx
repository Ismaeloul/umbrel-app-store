import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import AgendaColumn from './column.tsx';
import { resetScoreRevealForTests } from './score-reveal.ts';
import { resetAgendaUi, setAgendaMode } from './state.ts';
import { liveScore, matchAt, NOW, renderWithApp, scheduleOf, TODAY } from './test-utils.tsx';

const CURRENT = matchAt(-40, { home: 'Real Madrid', away: 'Girona', competition: 'LaLiga' });
const OTHER = matchAt(20, { home: 'Betis', away: 'Cádiz', competition: 'LaLiga' });
const NONE = matchAt(80, { home: 'Elche', away: 'Eibar', competition: 'LaLiga', channels: [] });

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  history.replaceState(null, '', `/?vista=partido/${CURRENT.id}`);
  resetMode();
  setMode('live', 'bootstrap');
  resetAgendaUi();
  resetToasts();
  resetScoreRevealForTests();
  net = mockFetch({
    'GET /api/v1/football': scheduleOf({
      [TODAY]: [CURRENT, OTHER, NONE],
      '2026-09-24': [matchAt(1440)],
    }),
    'GET /api/v1/preferences': fixture('preferencesGet'),
    'GET /api/v1/library': fixture('libraryGet'),
    'GET /api/v1/scores': {
      available: true,
      generatedAt: new Date(NOW).toISOString(),
      source: 'espn',
      attribution: 'ESPN',
      leagues: 1,
      scores: { [CURRENT.id]: liveScore(3, 0, "40'") },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  net.restore();
  resetMode();
  resetToasts();
  history.replaceState(null, '', '/');
});

function renderColumn() {
  // jsdom no mide: la columna del armazón (la que desplaza) mide 300 × 800,
  // como en una pantalla ancha. Sin alto, el virtualizador no pinta nada.
  const measured = (element: HTMLDivElement | null) => {
    if (!element) return;
    Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 300 });
    Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 800 });
  };
  return renderWithApp(
    <div className="app-column" ref={measured}>
      <AgendaColumn route={{ vista: 'partido', id: CURRENT.id, canal: null }} active />
    </div>,
    { kind: 'wide', search: `?vista=partido/${CURRENT.id}` },
  );
}

describe('columna compacta de la agenda (centro de partido)', () => {
  it('franjas compactas del día, el partido abierto marcado y con su marcador tapado', async () => {
    const { container } = renderColumn();
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    const current = await screen.findByRole('button', { name: /Real Madrid vs Girona/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(container.querySelectorAll('.agenda-row--compact').length).toBe(3);
    // El partido abierto va tapado aunque el reproductor no haya arrancado.
    expect(await screen.findByRole('button', { name: 'Ver marcador' })).toBeInTheDocument();
    expect(screen.getByText('Hoy 23')).toBeInTheDocument();
  });

  it('otra franja abre ese partido; sin canal, avisa', async () => {
    renderColumn();
    fireEvent.click(await screen.findByRole('button', { name: /^Ver canal para Betis/ }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${OTHER.id}`));
    fireEvent.click(screen.getByRole('button', { name: /canal por confirmar/ }));
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
  });

  it('comparte el día y el filtro con la vista (y cambia de día con sus flechas)', async () => {
    renderColumn();
    await screen.findByRole('button', { name: /Real Madrid vs Girona/ });
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    expect(await screen.findByText('Mañana 24')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Real Madrid vs Girona/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    const group = screen.getByRole('radiogroup', { name: 'Qué partidos ver' });
    expect(within(group).getByRole('radio', { name: 'Para ti' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    setAgendaMode('all');
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Todos' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });
});
