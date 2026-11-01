import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import AgendaColumn from './column.tsx';
import {
  byChip,
  competitionInitials,
  competitionTone,
  FOR_YOU_CHIP,
  splitLeagueChips,
} from './DeskList.tsx';
import { hideScore, resetScoreRevealForTests } from './score-reveal.ts';
import { resetAgendaUi, setAgendaStatus } from './state.ts';
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
  it('la misma lista compacta del día, el partido abierto marcado y su marcador tapado', async () => {
    const { container } = renderColumn();
    expect(screen.getByRole('heading', { name: 'Agenda' })).toBeInTheDocument();
    const current = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(container.querySelectorAll('.desk-row').length).toBe(3);
    // Es el que tienes abierto (aunque el vídeo no haya arrancado): sin cifras (regla 29).
    await waitFor(() => expect(current.querySelector('.desk-row__state')).toHaveTextContent("40'"));
    expect(current.querySelector('.desk-row__score')).toBeNull();
    expect(container.querySelectorAll('.agenda-score .num')).toHaveLength(0);
  });

  it('un directo que NO tienes abierto enseña su marcador en la fila; tapado a mano, no', async () => {
    history.replaceState(null, '', `/?vista=partido/${OTHER.id}`);
    const measured = (element: HTMLDivElement | null) => {
      if (!element) return;
      Object.defineProperty(element, 'offsetWidth', { configurable: true, value: 300 });
      Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 800 });
    };
    renderWithApp(
      <div className="app-column" ref={measured}>
        <AgendaColumn route={{ vista: 'partido', id: OTHER.id, canal: null }} active />
      </div>,
      { kind: 'wide', search: `?vista=partido/${OTHER.id}` },
    );
    const live = await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    expect(await within(live).findByLabelText('Marcador: 3 a 0')).toHaveClass(
      'desk-row__score--live',
    );
    act(() => hideScore(CURRENT.id));
    expect(live.querySelector('.desk-row__score')).toBeNull();
  });

  it('cada fila dice dónde lo echan (solo el primer canal); sin canal, nada', async () => {
    const { container } = renderColumn();
    const row = await screen.findByRole('button', { name: /^Betis contra Cádiz/ });
    expect(row.querySelector('.desk-row__channel')).toHaveTextContent('M+ LaLiga');
    const none = screen.getByRole('button', { name: /^Elche contra Eibar/ });
    expect(none.querySelector('.desk-row__channel')).toBeNull();
    expect(container.querySelectorAll('.desk-row__channel')).toHaveLength(2);
  });

  it('otro partido se abre aquí al lado; sin canal, avisa', async () => {
    renderColumn();
    fireEvent.click(await screen.findByRole('button', { name: /^Betis contra Cádiz/ }));
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${OTHER.id}`));
    fireEvent.click(screen.getByRole('button', { name: /^Elche contra Eibar/ }));
    expect(toastStore.get().map((t) => t.text)).toContain('El canal todavía no está anunciado');
  });

  it('comparte los filtros con la vista: «En directo» deja solo el que está en juego', async () => {
    renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    setAgendaStatus('live');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Betis contra Cádiz/ })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /^Real Madrid contra Girona/ })).toBeInTheDocument();
  });

  it('el día en su píldora (‹ Hoy ›): las flechas y la lista de días lo cambian', async () => {
    const { container } = renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const picker = screen.getByRole('group', { name: 'Día' });
    expect(within(picker).getByRole('button', { name: 'Día anterior' })).toBeDisabled();
    const label = within(picker).getByRole('button', { name: /Elegir otro día$/ });
    expect(label).toHaveTextContent('Hoy');
    const next = within(picker).getByRole('button', { name: 'Día siguiente' });
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(label).toHaveTextContent('Mañana'));
    // Era el último día: la flecha se apaga y el foco pasa al nombre del día.
    expect(next).toBeDisabled();
    expect(label).toHaveFocus();
    expect(container.querySelectorAll('.desk-row')).toHaveLength(1);
    // El nombre abre la lista de días, cada uno con cuántos partidos trae.
    fireEvent.click(label);
    const list = await screen.findByRole('dialog', { name: 'Días' });
    const today = within(list).getByRole('button', { name: /^Hoy, .*: 3 partidos$/ });
    expect(today).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(today);
    await waitFor(() => expect(label).toHaveTextContent('Hoy'));
    expect(container.querySelectorAll('.desk-row')).toHaveLength(3);
  });

  it('en la columna un clic ABRE el partido (no hay detalle al lado)', async () => {
    renderColumn();
    const row = await screen.findByRole('button', { name: /^Betis contra Cádiz/ });
    expect(row).not.toHaveAttribute('title');
    fireEvent.click(row);
    await waitFor(() => expect(location.search).toBe(`?vista=partido/${OTHER.id}`));
  });

  it('cada liga con su insignia de color, su país y el contador (en rojo, los directos)', async () => {
    const { container } = renderColumn();
    await screen.findByRole('button', { name: /^Real Madrid contra Girona/ });
    const badge = container.querySelector<HTMLElement>('.desk-comp__badge');
    expect(badge).toHaveTextContent('LL');
    expect(badge?.style.getPropertyValue('--bb')).toBe(competitionTone('LaLiga'));
    expect(container.querySelector('.desk-comp__area')).toHaveTextContent('España');
    const count = container.querySelector('.desk-comp__count');
    expect(count).toHaveClass('desk-comp__count--live');
    expect(count?.querySelector('[aria-hidden="true"]')).toHaveTextContent('1');
    expect(count?.querySelector('.sr-only')).toHaveTextContent('3 partidos, 1 en directo');
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

describe('«Más ligas»', () => {
  it('tres ligas con chip y el resto aparte; la elegida del resto se queda a la vista', () => {
    const all = ['A', 'B', 'C', 'D', 'E'];
    expect(splitLeagueChips(all, null)).toEqual({ shown: ['A', 'B', 'C'], more: ['D', 'E'] });
    expect(splitLeagueChips(all, 'E')).toEqual({ shown: ['A', 'B', 'C', 'E'], more: ['D'] });
    expect(splitLeagueChips(all, 'B')).toEqual({ shown: ['A', 'B', 'C'], more: ['D', 'E'] });
    expect(splitLeagueChips(['A', 'B'], null)).toEqual({ shown: ['A', 'B'], more: [] });
  });

  it('primero las tuyas, luego las grandes (no sus primas de otros países) y después el resto', () => {
    const day = [
      '3. Liga',
      'Premier League Ucrania',
      'Serie A Italiana',
      'Eredivisie',
      'La Liga EA Sports',
      'Premier League',
    ];
    expect(splitLeagueChips(day, null).shown).toEqual([
      'La Liga EA Sports',
      'Premier League',
      'Serie A Italiana',
    ]);
    expect(splitLeagueChips(day, null, new Set(['Eredivisie'])).shown).toEqual([
      'Eredivisie',
      'La Liga EA Sports',
      'Premier League',
    ]);
  });

  it('con muchas ligas el resto sale en una lista y se elige desde ella', async () => {
    net.restore();
    const names = ['LaLiga', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'Eredivisie'];
    net = mockFetch({
      'GET /api/v1/football': scheduleOf({
        [TODAY]: [
          CURRENT,
          ...names.slice(1).map((competition, index) =>
            matchAt(30 + index * 10, {
              home: `Local ${index}`,
              away: `Visita ${index}`,
              competition,
            }),
          ),
        ],
      }),
      'GET /api/v1/preferences': fixture('preferencesGet'),
      'GET /api/v1/library': fixture('libraryGet'),
    });
    renderColumn();
    const group = await screen.findByRole('group', { name: 'Filtrar partidos' });
    const more = await within(group).findByRole('button', { name: 'Más ligas: 3' });
    expect(within(group).queryByRole('button', { name: 'Eredivisie' })).toBeNull();
    fireEvent.click(more);
    const list = await screen.findByRole('dialog', { name: 'Más ligas' });
    fireEvent.click(within(list).getByRole('button', { name: /Eredivisie/ }));
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'Eredivisie' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(within(group).getByRole('button', { name: 'Más ligas: 2' })).toBeInTheDocument();
  });
});

describe('«Para ti» en el escritorio', () => {
  it('deja solo lo de tus gustos (tus equipos y ligas), como en el móvil', () => {
    const preferences = { leagues: [], teams: ['Betis'], nationalities: [] };
    const day = [CURRENT, OTHER, NONE];
    expect(byChip(day, FOR_YOU_CHIP, preferences).map((match) => match.id)).toEqual([OTHER.id]);
    // Sin gustos no filtra nada; una liga deja solo los suyos.
    expect(byChip(day, FOR_YOU_CHIP, null)).toHaveLength(3);
    expect(byChip(day, 'Premier League', null)).toHaveLength(0);
  });
});
