import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Capsule } from './Capsule.tsx';
import { VersusCard } from './VersusCard.tsx';

const BARCA = {
  name: 'FC Barcelona',
  short: 'BAR',
  colors: { primary: '#a50044', secondary: '#004d98' },
  crest: null,
};
const JUVE = {
  name: 'Juventus',
  short: 'JUV',
  colors: { primary: '#101010', secondary: '#ffffff' },
  crest: '/api/v1/football/teams/133676/crest?v=abc',
};

describe('VersusCard', () => {
  it('mitades con los colores de club (--h/--a), nombres escritos y competición', () => {
    const { container } = render(
      <VersusCard
        home={BARCA}
        away={JUVE}
        competition="Amistoso"
        when={{ kind: 'time', label: 'VIE 21:00' }}
      />,
    );
    const card = container.querySelector('.versus') as HTMLElement;
    expect(card.tagName).toBe('DIV');
    expect(card.style.getPropertyValue('--h')).toBe('#a50044');
    expect(card.style.getPropertyValue('--a')).toBe('#101010');
    expect(card).toHaveAttribute('data-when', 'time');
    expect(container.querySelectorAll('.versus__half')).toHaveLength(2);
    // Los nombres siempre escritos: «Local vs. Visitante».
    const names = [...container.querySelectorAll('.versus__name')].map((el) => el.textContent);
    expect(names).toEqual(['FC Barcelona', 'Juventus']);
    expect(container.querySelector('.versus__vs')).toHaveTextContent('vs.');
    expect(container.querySelector('.versus__competition')).toHaveTextContent('Amistoso');
    expect(container.querySelector('.versus__when')).toHaveTextContent('VIE 21:00');
    expect(container.querySelector('.versus__comp')).toHaveTextContent('Amistoso');
  });

  it('sin cifras de marcador en el DOM, ni en directo', () => {
    const { container } = render(
      <VersusCard
        home={BARCA}
        away={JUVE}
        competition="Amistoso"
        when={{ kind: 'live', label: 'En directo', minute: '13' }}
        mine
        watching
      />,
    );
    const card = container.querySelector('.versus') as HTMLElement;
    expect(card).toHaveClass('is-live', 'is-mine', 'is-watching');
    expect(container.querySelector('.versus__when')).toHaveTextContent("En directo · 13'");
    expect(container.querySelector('.versus__mine')).toHaveTextContent('Tu equipo');
    expect(container.querySelector('.versus__watching')).toHaveTextContent('En pantalla');
    // Nada que parezca «2-1» o «2 – 1».
    expect(card.textContent).not.toMatch(/\d\s*[-–]\s*\d/);
    expect(container.querySelector('.agenda-team__score')).toBeNull();
  });

  it('escudos: con crest pinta la imagen del backend; sin él, el monograma', () => {
    const { container } = render(
      <VersusCard
        home={BARCA}
        away={JUVE}
        competition="Amistoso"
        competitionLogo="/api/v1/football/competitions/1/logo?v=1"
        when={{ kind: 'done', label: 'Final' }}
        size="xl"
      />,
    );
    const crests = container.querySelectorAll('.versus__crest');
    expect(crests).toHaveLength(2);
    expect(crests[0]).toHaveAttribute('data-crest', 'mono');
    expect(crests[0]?.querySelector('.team__plate')).toHaveTextContent('BAR');
    expect(crests[1]).toHaveAttribute('data-crest', 'loading');
    expect(crests[1]?.querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/football/teams/133676/crest?v=abc',
    );
    expect(container.querySelector('.versus__comp img')).toHaveAttribute(
      'src',
      '/api/v1/football/competitions/1/logo?v=1',
    );
    expect(container.querySelector('.versus')).toHaveClass('versus--xl', 'is-done');
  });

  it('dos rojos: el visitante pasa a su segundo color (data-swapped)', () => {
    const { container } = render(
      <VersusCard
        home={{ name: 'Sevilla', colors: { primary: '#d4021d', secondary: '#ffffff' } }}
        away={{ name: 'Girona', colors: { primary: '#cd2534', secondary: '#ffffff' } }}
        competition="LaLiga"
        when={{ kind: 'tbc', label: 'Por confirmar' }}
      />,
    );
    const card = container.querySelector('.versus') as HTMLElement;
    expect(card).toHaveAttribute('data-swapped', 'true');
    expect(card.style.getPropertyValue('--a')).toBe('#ffffff');
  });

  it('como botón con aria-label y hueco para la cápsula de señal', () => {
    const onClick = vi.fn();
    render(
      <VersusCard
        home={BARCA}
        away={JUVE}
        competition="Amistoso"
        when={{ kind: 'time', label: 'VIE 21:00' }}
        as="button"
        aria-label="Ver canal para FC Barcelona - Juventus"
        onClick={onClick}
        transitionName="partido-demo-1"
      >
        <Capsule tone="ok" size="sm" glass dot>
          Señal lista
        </Capsule>
      </VersusCard>,
    );
    const button = screen.getByRole('button', { name: 'Ver canal para FC Barcelona - Juventus' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('press');
    expect(button.querySelector('.versus__signal')).toHaveTextContent('Señal lista');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('como enlace lleva el href', () => {
    render(
      <VersusCard
        home={BARCA}
        away={JUVE}
        competition="Amistoso"
        when={{ kind: 'time', label: 'VIE 21:00' }}
        as="a"
        href="?vista=partido/demo-1"
        aria-label="Abrir FC Barcelona - Juventus"
      />,
    );
    expect(screen.getByRole('link', { name: 'Abrir FC Barcelona - Juventus' })).toHaveAttribute(
      'href',
      '?vista=partido/demo-1',
    );
  });
});
