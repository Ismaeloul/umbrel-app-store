/* La lista de escritorio en la sala de «Ver juntos» (pestaña Partidos):
   `watchingId` dice cuál suena (el de la sala, no el del reproductor de casa)
   y `uiScope="sala"` guarda día, pestaña y estado aparte, sin mover la
   Agenda. Y el logo de la liga se ve entero (sin redondeo que lo recorte) y
   la fila elegida sin la raya amarilla a la izquierda. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { playerPresence } from '../../app/player-presence.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import { DeskList } from './DeskList.tsx';
import { resetScoreRevealForTests } from './score-reveal.ts';
import { agendaUi, resetAgendaUi, setAgendaStatus } from './state.ts';
import { liveScore, matchAt, NOW, renderWithApp, scheduleOf, TODAY } from './test-utils.tsx';

const LIVE = matchAt(-40, {
  home: 'Málaga',
  away: 'Racing',
  competition: 'LaLiga',
  competitionBadge: { id: 'k-laliga', name: 'LaLiga', logo: '/demo/logo-prueba.png' },
});
const LATER = matchAt(60, { home: 'Betis', away: 'Cádiz', competition: 'LaLiga' });
const PREMIER = matchAt(90, { home: 'Arsenal', away: 'Chelsea', competition: 'Premier League' });

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetMode();
  setMode('live', 'bootstrap');
  resetAgendaUi();
  resetToasts();
  playerPresence.set({ active: false, route: null, immersive: false });
  resetScoreRevealForTests();
  net = mockFetch({
    'GET /api/v1/football': scheduleOf({
      [TODAY]: [LIVE, LATER, PREMIER],
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
      scores: { [LIVE.id]: liveScore(1, 0, "40'") },
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  net.restore();
  resetMode();
  resetToasts();
  playerPresence.set({ active: false, route: null, immersive: false });
});

function rowOf(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('DeskList en la sala de «Ver juntos»', () => {
  it('watchingId manda sobre el reproductor de casa: las barritas van al de la sala', async () => {
    // En casa suena el Betis-Cádiz; en la sala, el Málaga-Racing.
    playerPresence.set({
      active: true,
      route: { vista: 'partido', id: LATER.id, canal: null },
      immersive: false,
    });
    renderWithApp(
      <DeskList
        selectedId={null}
        active
        onOpen={() => {}}
        onSelect={() => {}}
        watchingId={LIVE.id}
        uiScope="sala"
      />,
      { kind: 'wide' },
    );
    const live = await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    expect(live.querySelector('.player-eq')).not.toBeNull();
    // El de la sala se está viendo: su marcador, tapado (regla 29).
    expect(live.querySelector('.desk-row__score')).toBeNull();
    expect(live).toHaveAccessibleDescription(/Lo estás viendo/);
    // Empieza en «En directo»: el Betis-Cádiz ni sale.
    expect(screen.queryByRole('button', { name: /^Betis contra Cádiz/ })).toBeNull();
  });

  it('sin watchingId sigue mandando el reproductor (la Agenda no cambia)', async () => {
    playerPresence.set({
      active: true,
      route: { vista: 'partido', id: LIVE.id, canal: null },
      immersive: false,
    });
    renderWithApp(<DeskList selectedId={null} active onOpen={() => {}} />, { kind: 'wide' });
    const live = await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    expect(live.querySelector('.player-eq')).not.toBeNull();
    // La Agenda empieza con todo (sin el filtro «En directo» de la sala).
    expect(rowOf(/^Betis contra Cádiz/)).toBeInTheDocument();
  });

  it('watchingId={null}: no suena nada aunque el reproductor de casa sí', async () => {
    playerPresence.set({
      active: true,
      route: { vista: 'partido', id: LIVE.id, canal: null },
      immersive: false,
    });
    const { container } = renderWithApp(
      <DeskList selectedId={null} active onOpen={() => {}} watchingId={null} uiScope="sala" />,
      { kind: 'wide' },
    );
    await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    expect(container.querySelector('.player-eq')).toBeNull();
  });

  it('uiScope="sala": estado, liga y día propios; la Agenda no se entera', async () => {
    setAgendaStatus('upcoming');
    const before = agendaUi.get();
    const { container } = renderWithApp(
      <DeskList selectedId={null} active onOpen={() => {}} onSelect={() => {}} uiScope="sala" />,
      { kind: 'wide' },
    );
    // Empieza en hoy y en «En directo» (hay uno), no en el «Próximos» de la Agenda.
    await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    const livePill = screen.getByRole('button', { name: 'En directo: 1' });
    expect(livePill).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.desk-row')).toHaveLength(1);

    // Quitar «En directo» enseña todo el día.
    fireEvent.click(livePill);
    await waitFor(() => expect(container.querySelectorAll('.desk-row')).toHaveLength(3));
    // Una liga y otro día.
    fireEvent.click(screen.getByRole('button', { name: 'Premier League' }));
    await waitFor(() => expect(container.querySelectorAll('.desk-row')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    await waitFor(() =>
      expect(container.querySelector('.desk-day__label')).toHaveTextContent('Mañana'),
    );

    expect(agendaUi.get()).toBe(before);
    expect(agendaUi.get()).toMatchObject({ day: null, chip: null, status: 'upcoming' });
  });

  it('en la Agenda (por defecto) los filtros siguen yendo a state.ts', async () => {
    renderWithApp(<DeskList selectedId={null} active onOpen={() => {}} />, { kind: 'wide' });
    await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'En directo: 1' }));
    });
    expect(agendaUi.get().status).toBe('live');
  });

  it('la fila elegida lleva aria-current y el logo de la liga sale como imagen', async () => {
    const { container } = renderWithApp(
      <DeskList selectedId={LIVE.id} active onOpen={() => {}} onSelect={() => {}} uiScope="sala" />,
      { kind: 'wide' },
    );
    const live = await screen.findByRole('button', { name: /^Málaga contra Racing/ });
    expect(live).toHaveAttribute('aria-current', 'true');
    expect(live).toHaveClass('desk-row--sel');
    const logo = container.querySelector('img.desk-comp__logo');
    expect(logo).toHaveAttribute('src', '/demo/logo-prueba.png');
  });
});

/* Con `css: false` Vitest vacía los .css que se importan: se leen del disco y
   se miran las reglas a mano (la revisión visual mide el radio de verdad). */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const agendaCss = readFileSync(path.join(HERE, 'agenda.css'), 'utf8');
const mobileCss = readFileSync(path.join(HERE, 'agenda-mobile.css'), 'utf8');

/** Las declaraciones de las reglas cuyo selector incluye `selector`. */
function rulesFor(css: string, selector: string): string[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const [, selectors = '', body = ''] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((item) => item.trim().split(/\s+/).includes(selector)))
      out.push(body);
  }
  return out;
}

describe('logo de la liga y fila elegida (CSS)', () => {
  it('el logo no se redondea ni se recorta: radio 0, contain, ancho automático', () => {
    for (const css of [agendaCss, mobileCss]) {
      for (const body of rulesFor(css, '.desk-comp__logo')) {
        for (const [, value = ''] of body.matchAll(/border-radius:\s*([^;]+);/g))
          expect(value.trim()).toBe('0');
        expect(body).not.toMatch(/overflow:\s*hidden/);
      }
    }
    const [base = ''] = rulesFor(agendaCss, '.desk-comp__logo');
    expect(base).toMatch(/border-radius:\s*0;/);
    expect(base).toMatch(/object-fit:\s*contain;/);
    expect(base).toMatch(/width:\s*auto;/);
    expect(base).toMatch(/max-width:\s*44px;/);
    expect(base).toMatch(/height:\s*32px;/);
    expect(rulesFor(mobileCss, '.desk-comp__logo').join('')).toMatch(/height:\s*28px;/);
    // La insignia de siglas conserva su radio.
    expect(rulesFor(agendaCss, '.desk-comp__badge').join('')).toMatch(/border-radius:\s*8px;/);
  });

  it('sin la raya amarilla a la izquierda (ni en la fila elegida ni en «Tu equipo»)', () => {
    expect(agendaCss).not.toMatch(/inset 3px 0 0/);
    expect(mobileCss).not.toMatch(/inset 3px 0 0/);
    expect(rulesFor(agendaCss, '.desk-row--sel').join('')).toMatch(
      /background:\s*var\(--accent-wash\)/,
    );
  });
});
