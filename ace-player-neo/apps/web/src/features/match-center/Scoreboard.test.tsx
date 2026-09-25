/* Marcador del teatro (inventario §6; Palco W5): la cápsula sobre el vídeo,
   tapada por defecto (regla 29), destapar y volver a tapar, `pre` nunca se
   pinta y el momento de gol (C3 + rebote W14); la cabecera bajo el vídeo
   (competición, estado y el h1 con el título) y el marcador grande de la
   pestaña «Partido» con la barra del partido. */

import type { LiveScore } from '@ace/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScoreRevealForTests } from '../agenda/score-reveal.ts';
import { matchAt, NOW, TODAY } from '../agenda/test-utils.tsx';
import { MatchHead } from './MatchHead.tsx';
import { MatchPanel } from './MatchPanel.tsx';
import { GOAL_MS, Scoreboard } from './Scoreboard.tsx';

const score = (home: number, away: number, state = 'in', clock = "72'"): LiveScore => ({
  home,
  away,
  state,
  clock,
  detail: '2ª parte',
  confidence: 0.9,
});

beforeEach(() => resetScoreRevealForTests());
afterEach(() => vi.useRealTimers());

const live = matchAt(-72, {
  id: 'm-live',
  home: 'Atlético de Madrid',
  away: 'Tottenham',
  competition: 'Champions League',
});

describe('cápsula del marcador (sobre el vídeo)', () => {
  it('en directo: marcador TAPADO («Marcador») y el minuto a la vista', () => {
    const { container } = render(<Scoreboard match={live} score={score(2, 1)} now={NOW} />);
    const cover = screen.getByRole('button', { name: 'Ver marcador' });
    expect(cover).toHaveTextContent('Marcador');
    expect(screen.queryByLabelText(/Atlético de Madrid 2/)).toBeNull();
    // Num se lee entero con su texto oculto («Minuto 72»).
    expect(screen.getByText('Minuto 72')).toBeInTheDocument();
    expect(container.querySelector('.mc-scap')).toHaveClass('is-live', 'is-covered');
    // El marcador se anuncia solo (aria-live) sin robar el foco.
    expect(container.querySelector('.mc-scap__live')).toHaveAttribute('aria-live', 'polite');
  });

  it('se destapa con un toque y se puede volver a tapar', () => {
    render(<Scoreboard match={live} score={score(2, 1)} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver marcador' }));
    expect(screen.getByLabelText('Atlético de Madrid 2, Tottenham 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tapar el marcador/ }));
    expect(screen.getByRole('button', { name: 'Ver marcador' })).toBeInTheDocument();
  });

  it('«pre» nunca se pinta: sale la hora y cuánto falta', () => {
    const later = matchAt(90, { id: 'm-later' });
    render(<Scoreboard match={later} score={score(0, 0, 'pre', '')} now={NOW} />);
    expect(screen.queryByRole('button', { name: 'Ver marcador' })).toBeNull();
    expect(screen.getByText(`A las ${later.time}`)).toBeInTheDocument();
    expect(screen.getByText('En 1 h 30 min')).toBeInTheDocument();
  });

  it('terminado: «Final»', () => {
    const done = matchAt(-200, { id: 'm-done' });
    const { container } = render(
      <Scoreboard match={done} score={score(1, 0, 'post', 'FT')} now={NOW} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver marcador' }));
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(container.querySelector('.mc-scap')).toHaveClass('is-done');
  });

  it('un gol con el marcador destapado hace el rebote 1,2 s (C3, W14)', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <Scoreboard match={live} score={score(1, 1)} now={NOW} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver marcador' }));
    rerender(<Scoreboard match={live} score={score(2, 1)} now={NOW} />);
    expect(container.querySelector('.mc-scap')).toHaveClass('is-goal', 'is-goal-home');
    act(() => {
      vi.advanceTimersByTime(GOAL_MS);
    });
    expect(container.querySelector('.mc-scap')).not.toHaveClass('is-goal');
  });

  it('tapado no se celebra nada', () => {
    const { container, rerender } = render(
      <Scoreboard match={live} score={score(1, 1)} now={NOW} />,
    );
    rerender(<Scoreboard match={live} score={score(1, 2)} now={NOW} />);
    expect(container.querySelector('.mc-scap')).not.toHaveClass('is-goal-away');
  });
});

describe('cabecera bajo el vídeo', () => {
  it('competición y estado en el rótulo, y el h1 con el título (lo buscan las e2e)', () => {
    render(<MatchHead match={live} score={score(2, 1)} now={NOW} />);
    expect(screen.getByText("Champions League · En directo · 72'")).toBeInTheDocument();
    const title = screen.getByRole('heading', {
      level: 1,
      name: 'Atlético de Madrid vs Tottenham',
    });
    expect(title).toHaveAttribute('tabindex', '-1');
    // Los nombres visibles no se leen dos veces; y ninguna cifra del marcador.
    expect(document.querySelector('.mc-head__teams')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('2')).toBeNull();
  });

  it('antes de empezar: cuánto falta', () => {
    const later = matchAt(90, { id: 'm-later', competition: 'LaLiga' });
    render(<MatchHead match={later} score={null} now={NOW} />);
    expect(screen.getByText('LaLiga · En 1 h 30 min')).toBeInTheDocument();
  });
});

describe('pestaña «Partido»', () => {
  it('escudos, marcador tapado con «Destapar», barra del partido y dónde se emite', () => {
    render(
      <MatchPanel
        match={live}
        score={score(2, 1)}
        now={NOW}
        channels={[{ name: 'M+ Liga de Campeones', inLibrary: true }]}
        today={TODAY}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Minuto 72 de 90' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Atlético de Madrid 2, Tottenham 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Destapar el marcador' }));
    expect(screen.getByLabelText('Atlético de Madrid 2, Tottenham 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dónde se emite' })).toBeInTheDocument();
    expect(screen.getByText('M+ Liga de Campeones')).toBeInTheDocument();
  });
});
