import type { FootballMatch } from '@ace/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('tarjeta de partido', () => {
  it('hora, cuenta atrás, equipos y «Ver canal para …» cuando el canal está en tu biblioteca', () => {
    const { onOpen, match } = renderRow();
    // El chip de la tarjeta versus dice el día y la hora; debajo, la cuenta atrás.
    expect(screen.getByText('Hoy 21:00')).toBeInTheDocument();
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

  it('en directo: chip con el minuto, marcador en su cápsula (nunca en las mitades) y barra del partido', () => {
    const match = matchAt(-60, { home: 'Atlético', away: 'Tottenham' });
    const { container } = renderRow({ match, score: liveScore(2, 1, "45'+2'") });
    expect(screen.getByText("En directo · 45+2'")).toBeInTheDocument();
    expect(screen.getByText('En directo')).toBeInTheDocument();
    expect(container.querySelector('.agenda-row')).toHaveClass('is-live');
    expect(container.querySelector('.versus')).toHaveAttribute('data-when', 'live');
    const score = screen.getByTitle('Marcador');
    expect(score).toHaveClass('agenda-score');
    expect(score).toHaveTextContent(/2.*1/);
    expect(container.querySelector('.versus .agenda-score')).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Progreso del partido' })).toBeInTheDocument();
  });

  it('«pre» no se pinta (siempre llega 0-0)', () => {
    const { container } = renderRow({ score: { ...liveScore(0, 0), state: 'pre' } });
    expect(container.querySelector('.agenda-score')).toBeNull();
    expect(container.querySelector('.agenda-row')).not.toHaveClass('has-corner');
  });

  it('sin marcador, los nombres ocupan todo el ancho; con él, le dejan su esquina', () => {
    const { container, unmount } = renderRow();
    expect(container.querySelector('.agenda-row')).not.toHaveClass('has-corner');
    expect(container.querySelector('.agenda-row__corner')).toBeNull();
    unmount();
    const match = matchAt(-60, { home: 'Atlético', away: 'Tottenham' });
    const other = renderRow({ match, score: liveScore(2, 1, "60'") });
    expect(other.container.querySelector('.agenda-row')).toHaveClass('has-corner');
    const corner = other.container.querySelector('.agenda-row__corner') as HTMLElement;
    expect(within(corner).getByTitle('Marcador')).toBeInTheDocument();
  });

  it('el partido que ves sale TAPADO y se destapa con un toque (regla 29)', () => {
    const match = matchAt(-30, { home: 'Girona', away: 'Sevilla' });
    const { onReveal, onOpen, container, rerender } = renderRow({
      match,
      score: liveScore(1, 1),
      scoreHidden: true,
    });
    expect(container.querySelector('.agenda-score')).toBeNull();
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
    expect(screen.getByTitle('Marcador')).toHaveTextContent(/1.*1/);
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
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByText('Tu equipo')).toBeInTheDocument();
  });

  it('señal con su palabra (B7: «Sin señal · reintento 20:51»)', () => {
    renderRow({ signal: { state: 'fail', label: 'Sin señal · reintento 20:51', summary: '' } });
    expect(screen.getByText('Sin señal · reintento 20:51')).toBeInTheDocument();
  });

  it('la cápsula de señal va en la fila de arriba de la tarjeta, con tono y forma', () => {
    const { container } = renderRow({
      signal: { state: 'ok', summary: '3 fuentes verificadas' },
    });
    const capsule = container.querySelector('.versus__top .agenda-sig') as HTMLElement;
    expect(capsule).toHaveClass('capsule--ok');
    expect(capsule).toHaveAttribute('title', '3 fuentes verificadas');
    expect(within(capsule).getByText('Señal')).toBeInTheDocument();
    expect(capsule.querySelector('.sig')).toHaveAttribute('data-state', 'ok');
  });

  it('los colores de club vienen de la API cuando los da (lib/teams.ts)', () => {
    const match = matchAt(30, {
      home: 'Real Madrid',
      away: 'Girona',
      homeTeam: {
        id: 'k-real-madrid',
        name: 'Real Madrid',
        short: 'RMA',
        crest: null,
        colors: { primary: '#febe10', secondary: '#1a1a5e' },
      },
    });
    const { container } = renderRow({ match });
    // El escudo (monograma) del local lleva el color de la API.
    const crest = container.querySelector('.versus__crest') as HTMLElement;
    expect(crest.style.getPropertyValue('--team')).toBe('#febe10');
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
