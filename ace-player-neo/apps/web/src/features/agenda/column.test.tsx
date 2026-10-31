import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import AgendaColumn from './column.tsx';
import { competitionInitials, competitionTone } from './DeskList.tsx';
import { resetScoreRevealForTests } from './score-reveal.ts';
import { resetAgendaUi, setAgendaChip } from './state.ts';
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

describe('columna de la agenda junto al vídeo (escritorio)', () => {
  it('la misma lista compacta del día, el partido abierto marcado y sin marcadores', async () => {
    const { container } = renderColumn();
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    const current = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(container.querySelectorAll('.desk-row').length).toBe(3);
    expect(container.querySelectorAll('.agenda-score .num')).toHaveLength(0);
  });

  it('otro partido se abre aquí al lado; sin canal, avisa', async () => {
    renderColumn();
    fireEvent.click(await screen.findByRole('button', { name: /^Betis contra Cádiz/ }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${OTHER.id}`));
    fireEvent.click(screen.getByRole('button', { name: /^Elche contra Eibar/ }));
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
  });

  it('comparte el chip con la vista: «Directo» deja solo el que está en juego', async () => {
    renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    setAgendaChip('live');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Betis contra Cádiz/ })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /^Real Madrid contra Girona/ })).toBeInTheDocument();
  });

  it('tira de días de la maqueta: «Hoy» y el día de la semana, el elegido marcado', async () => {
    const { container } = renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const days = [...container.querySelectorAll('.desk-days__day')];
    expect(days.map((day) => day.querySelector('.desk-days__name')?.textContent)).toEqual([
      'Hoy',
      'Jue',
    ]);
    expect(days[0]).toHaveAttribute('aria-pressed', 'true');
    expect(days[0]).toHaveAccessibleName(/^Hoy, .*: 3 partidos$/);
    fireEvent.click(days[1]!);
    await waitFor(() => expect(days[1]).toHaveAttribute('aria-pressed', 'true'));
  });

  it('cada liga con su insignia de color y «n partidos»', async () => {
    const { container } = renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const badge = container.querySelector<HTMLElement>('.desk-comp__badge');
    expect(badge).toHaveTextContent('LL');
    expect(badge?.style.getPropertyValue('--bb')).toBe(competitionTone('LaLiga'));
    expect(container.querySelector('.desk-comp__count')).toHaveTextContent('3 partidos');
  });
});

describe('insignias de competición', () => {
  it('siglas de las ligas conocidas y, si no, las iniciales', () => {
    expect(competitionInitials('LaLiga EA Sports')).toBe('LL');
    expect(competitionInitials('Premier League')).toBe('PL');
    expect(competitionInitials('Serie A')).toBe('SA');
    expect(competitionInitials('Amistoso')).toBe('AM');
    expect(competitionInitials('Copa Libertadores')).toBe('CL');
  });

  it('un color por liga (el de su marca o uno sacado del nombre), siempre el mismo', () => {
    expect(competitionTone('LaLiga')).not.toBe(competitionTone('Premier League'));
    expect(competitionTone('Amistoso')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(competitionTone('Amistoso')).toBe(competitionTone('Amistoso'));
  });
});
