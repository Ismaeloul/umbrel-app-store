import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DayStrip } from './DayStrip.tsx';
import { TODAY } from './test-utils.tsx';

const DAYS = [
  { date: '2026-09-22', count: 9 },
  { date: TODAY, count: 8 },
  { date: '2026-09-24', count: 1 },
  { date: '2026-09-25', count: 4 },
];

describe('tira de días', () => {
  it('Ayer, Hoy, Mañana y el día abreviado, con el recuento de partidos visibles', () => {
    render(<DayStrip days={DAYS} selected={TODAY} today={TODAY} onSelect={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.querySelector('.agenda-day__label')?.textContent)).toEqual([
      'Ayer',
      'Hoy',
      'Mañana',
      'Vie',
    ]);
    expect(
      screen.getByRole('tab', { name: 'Hoy, miércoles, 23 de septiembre: 8 partidos' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('tab', { name: 'Mañana, jueves, 24 de septiembre: 1 partido' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Días' })).toBeInTheDocument();
  });

  it('un toque elige el día; flechas, Inicio y Fin mueven el día y el foco', () => {
    const onSelect = vi.fn();
    render(<DayStrip days={DAYS} selected={TODAY} today={TODAY} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /^Mañana/ }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-24');
    const today = screen.getByRole('tab', { name: /^Hoy/ });
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-24');
    fireEvent.keyDown(today, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-22');
    fireEvent.keyDown(today, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-25');
    fireEvent.keyDown(today, { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-22');
  });

  it('no se recoloca sola al repintar: solo al cambiar de día (regla 1)', () => {
    const scrollTo = vi.mocked(Element.prototype.scrollTo);
    const { rerender } = render(
      <DayStrip days={DAYS} selected={TODAY} today={TODAY} onSelect={() => {}} />,
    );
    const track = screen.getByRole('tablist');
    // jsdom no mide: se simula que la tira desborda y el activo está a la derecha.
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 44, height: 44 }),
    });
    for (const tab of screen.getAllByRole('tab')) {
      Object.defineProperty(tab, 'getBoundingClientRect', {
        value: () => ({ left: 300, width: 80, right: 380, top: 0, bottom: 44, height: 44 }),
      });
    }
    scrollTo.mockClear();
    // Mismo día con otro recuento (el filtro cambió): nada se mueve.
    rerender(
      <DayStrip
        days={DAYS.map((day) => ({ ...day, count: day.count + 1 }))}
        selected={TODAY}
        today={TODAY}
        onSelect={() => {}}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();
    // Otro día: se enseña (solo en horizontal).
    rerender(<DayStrip days={DAYS} selected="2026-09-25" today={TODAY} onSelect={() => {}} />);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0]?.[0]).toMatchObject({ left: expect.any(Number) });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('en escritorio, teselas con «n partidos»; sin días solo guarda el hueco (sin pestañas)', () => {
    const { rerender, container } = render(
      <DayStrip days={DAYS} selected={TODAY} today={TODAY} onSelect={() => {}} variant="tiles" />,
    );
    expect(container.querySelector('.agenda-days--tiles')).not.toBeNull();
    expect(screen.getByText('8 partidos')).toBeInTheDocument();
    rerender(<DayStrip days={[]} selected={null} today={TODAY} onSelect={() => {}} />);
    // Mientras carga la agenda, pastillas vacías del mismo alto (sin saltos
    // al llegar los días), escondidas a los lectores y sin nada que pulsar.
    const pending = container.querySelector('.agenda-days--pending');
    expect(pending).not.toBeNull();
    expect(pending).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
