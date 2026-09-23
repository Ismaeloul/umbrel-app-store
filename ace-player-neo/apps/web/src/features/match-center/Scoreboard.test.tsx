/* Marcador del centro de partido (inventario §6): tapado por defecto
   (regla 29), destapar y volver a tapar, `pre` nunca se pinta, antetítulo,
   meta y el momento de gol (C3). */

import type { LiveScore } from '@ace/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScoreRevealForTests } from '../agenda/score-reveal.ts';
import { matchAt, NOW } from '../agenda/test-utils.tsx';
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

describe('Scoreboard', () => {
  const live = matchAt(-72, {
    id: 'm-live',
    home: 'Atlético de Madrid',
    away: 'Tottenham',
    competition: 'Champions League',
  });

  it('en directo: antetítulo, meta, marcador TAPADO y el minuto', () => {
    render(
      <Scoreboard match={live} score={score(2, 1)} now={NOW} channels={['M+ Liga de Campeones']} />,
    );
    expect(screen.getByText(/En directo · Centro de partido/)).toBeInTheDocument();
    expect(
      screen.getByText(`Champions League · ${live.time} · M+ Liga de Campeones`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Atlético de Madrid vs Tottenham' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver marcador' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Atlético de Madrid 2/)).toBeNull();
    // Num se lee entero con su texto oculto («Minuto 72»).
    expect(screen.getByText('Minuto 72')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Minuto 72 de 90' })).toBeInTheDocument();
  });

  it('se destapa con un toque y se puede volver a tapar', () => {
    render(<Scoreboard match={live} score={score(2, 1)} now={NOW} channels={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver marcador' }));
    expect(screen.getByLabelText('Atlético de Madrid 2, Tottenham 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tapar el marcador/ }));
    expect(screen.getByRole('button', { name: 'Ver marcador' })).toBeInTheDocument();
  });

  it('«pre» nunca se pinta: sale la hora', () => {
    const later = matchAt(90, { id: 'm-later' });
    render(<Scoreboard match={later} score={score(0, 0, 'pre', '')} now={NOW} channels={[]} />);
    expect(screen.queryByRole('button', { name: 'Ver marcador' })).toBeNull();
    expect(screen.getByText(`A las ${later.time}`)).toBeInTheDocument();
    expect(screen.getByText('Centro de partido')).toBeInTheDocument();
    expect(screen.getByText('En 1 h 30 min')).toBeInTheDocument();
  });

  it('terminado: «Final» y sin luces', () => {
    const done = matchAt(-200, { id: 'm-done' });
    const { container } = render(
      <Scoreboard match={done} score={score(1, 0, 'post', 'FT')} now={NOW} channels={[]} />,
    );
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(container.querySelector('.mc-score')).toHaveClass('is-done');
  });

  it('un gol con el marcador destapado ilumina al que marca 1,2 s (C3)', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <Scoreboard match={live} score={score(1, 1)} now={NOW} channels={[]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver marcador' }));
    rerender(<Scoreboard match={live} score={score(2, 1)} now={NOW} channels={[]} />);
    expect(container.querySelector('.mc-score')).toHaveClass('is-goal-home');
    act(() => {
      vi.advanceTimersByTime(GOAL_MS);
    });
    expect(container.querySelector('.mc-score')).not.toHaveClass('is-goal-home');
  });

  it('tapado no se celebra nada', () => {
    const { container, rerender } = render(
      <Scoreboard match={live} score={score(1, 1)} now={NOW} channels={[]} />,
    );
    rerender(<Scoreboard match={live} score={score(1, 2)} now={NOW} channels={[]} />);
    expect(container.querySelector('.mc-score')).not.toHaveClass('is-goal-away');
  });
});
