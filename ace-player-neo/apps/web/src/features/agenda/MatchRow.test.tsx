import type { FootballMatch } from '@ace/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchRowView, type MatchRowViewProps } from './MatchRow.tsx';
import { liveScore, matchAt, NOW } from './test-utils.tsx';

function renderRow(overrides: Partial<MatchRowViewProps> & { match?: FootballMatch } = {}) {
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  const onReveal = vi.fn();
  const match =
    overrides.match ??
    matchAt(30, { home: 'Real Madrid', away: 'Bayern', title: 'Real Madrid - Bayern' });
  const utils = render(
    <MatchRowView
      match={match}
      now={NOW}
      score={null}
      signal={null}
      channels={[{ name: 'M+ Liga de Campeones', inLibrary: true }]}
      mine={false}
      scoreHidden={false}
      onReveal={onReveal}
      onOpen={onOpen}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onOpen, onSelect, onReveal, match };
}

describe('franja de partido', () => {
  it('hora, cuenta atrás, equipos y «Ver canal para …» cuando el canal está en tu biblioteca', () => {
    const { onOpen, match } = renderRow();
    expect(screen.getByText('A las 21:00')).toBeInTheDocument();
    expect(screen.getByText('En 30 min')).toBeInTheDocument();
    expect(screen.getByText('Real Madrid')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Ver canal para Real Madrid - Bayern' });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(match);
    // B3: borde continuo y su explicación.
    expect(screen.getByTitle('Disponible en tu biblioteca')).toHaveClass('is-lib');
  });

  it('«Buscar canal» si no está en tu biblioteca; «Canal por confirmar» sin canales', () => {
    const { unmount } = renderRow({ channels: [{ name: 'GOL Play', inLibrary: false }] });
    expect(screen.getByRole('button', { name: /^Buscar canal para/ })).toBeInTheDocument();
    expect(screen.getByTitle('Se buscará al reproducir')).toHaveClass('is-search');
    unmount();
    renderRow({ channels: [] });
    expect(screen.getByText('Canal por confirmar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /canal por confirmar/ })).toBeInTheDocument();
  });

  it('en directo: anillo del minuto, marcador con el que gana en negrita y barra del partido', () => {
    const match = matchAt(-60, { home: 'Atlético', away: 'Tottenham' });
    const { container } = renderRow({ match, score: liveScore(2, 1, "45'+2'") });
    expect(screen.getByText('Minuto 45+2, en directo')).toBeInTheDocument();
    expect(screen.getByText('En directo')).toBeInTheDocument();
    expect(container.querySelector('.agenda-row')).toHaveClass('is-live');
    expect(container.querySelector('.agenda-team.is-lead')).toHaveTextContent('Atlético');
    expect(container.querySelector('.agenda-team.is-trail')).toHaveTextContent('Tottenham');
    expect(screen.getByRole('progressbar', { name: 'Progreso del partido' })).toBeInTheDocument();
  });

  it('«pre» no se pinta (siempre llega 0-0)', () => {
    const { container } = renderRow({ score: { ...liveScore(0, 0), state: 'pre' } });
    expect(container.querySelector('.agenda-team__score')?.textContent).toBe('');
  });

  it('sin señal ni marcador, los nombres usan también el hueco de la señal', () => {
    const { container, unmount } = renderRow();
    expect(container.querySelector('.agenda-row')).toHaveClass('agenda-row--roomy');
    expect(container.querySelector('.agenda-row__sig')).toBeNull();
    unmount();
    // Con marcador, no: las cifras siguen alineadas con las de las demás franjas.
    const match = matchAt(-60, { home: 'Atlético', away: 'Tottenham' });
    const other = renderRow({ match, score: liveScore(2, 1, "60'") });
    expect(other.container.querySelector('.agenda-row')).not.toHaveClass('agenda-row--roomy');
  });

  it('el partido que ves sale TAPADO y se destapa con un toque (regla 29)', () => {
    const match = matchAt(-30, { home: 'Girona', away: 'Sevilla' });
    const { onReveal, onOpen, container, rerender } = renderRow({
      match,
      score: liveScore(1, 1),
      scoreHidden: true,
    });
    expect(container.querySelector('.agenda-team__score')?.textContent).toBe('');
    const reveal = screen.getByRole('button', { name: 'Ver marcador' });
    expect(reveal).toHaveAttribute('title', 'Tu emisión va por detrás del directo');
    fireEvent.click(reveal);
    expect(onReveal).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    rerender(
      <MatchRowView
        match={match}
        now={NOW}
        score={liveScore(1, 1)}
        signal={null}
        channels={[]}
        mine={false}
        scoreHidden={false}
        onReveal={onReveal}
        onOpen={onOpen}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Ver marcador' })).toBeNull();
    // Al destapar las cifras giran como una paleta (B5).
    expect(container.querySelector('.agenda-flip')).not.toBeNull();
  });

  it('terminado y «Tu equipo» sin cambiar de sitio', () => {
    const { container } = renderRow({
      match: matchAt(-200),
      score: { ...liveScore(1, 0), state: 'post' },
      mine: true,
    });
    expect(container.querySelector('.agenda-row')).toHaveClass('is-done', 'is-mine');
    expect(screen.getByText('Terminado')).toBeInTheDocument();
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
  });

  it('señal con su palabra (B7: «Sin señal · reintento 20:51»)', () => {
    renderRow({ signal: { state: 'fail', label: 'Sin señal · reintento 20:51', summary: '' } });
    expect(screen.getByText('Sin señal · reintento 20:51')).toBeInTheDocument();
  });

  it('en escritorio el primer toque elige y el segundo (o doble clic) abre', () => {
    const { onOpen, onSelect, rerender, match } = renderRow({ interaction: 'select' });
    const button = screen.getByRole('button', { name: /Real Madrid vs Bayern/ });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(match);
    expect(onOpen).not.toHaveBeenCalled();
    rerender(
      <MatchRowView
        match={match}
        now={NOW}
        score={null}
        signal={null}
        channels={[]}
        mine={false}
        scoreHidden={false}
        onReveal={() => {}}
        onOpen={onOpen}
        onSelect={onSelect}
        interaction="select"
        selected
      />,
    );
    expect(button).toHaveAttribute('aria-current', 'true');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(button);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('menú contextual con clic derecho', () => {
    const onSelect = vi.fn();
    renderRow({
      menuItems: [{ id: 'seguir', label: 'Seguir a Real Madrid', onSelect }],
    });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Ver canal para/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seguir a Real Madrid' }));
    expect(onSelect).toHaveBeenCalled();
  });

  it('«Por confirmar» cuando no hay hora', () => {
    renderRow({ match: { ...matchAt(10), time: 'Por confirmar' } });
    expect(screen.getByText('Por confirmar')).toBeInTheDocument();
  });
});
