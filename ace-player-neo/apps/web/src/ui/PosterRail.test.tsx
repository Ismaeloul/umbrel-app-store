import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PosterRail } from './PosterRail.tsx';

describe('PosterRail', () => {
  it('como grupo con nombre, con los hijos dentro de la pista', () => {
    const { container } = render(
      <PosterRail label="Partidos de LaLiga" itemWidth="220px">
        <article>Uno</article>
        <article>Dos</article>
      </PosterRail>,
    );
    const track = screen.getByRole('group', { name: 'Partidos de LaLiga' });
    expect(track).toHaveClass('prail__track');
    expect(track.children).toHaveLength(2);
    expect(
      (container.querySelector('.prail') as HTMLElement).style.getPropertyValue('--prail-item-w'),
    ).toBe('220px');
    // Sin ratón (jsdom: ninguna media query) no hay flechas.
    expect(screen.queryByRole('button', { name: 'Siguientes' })).toBeNull();
  });

  it('como lista: un elemento por hijo, saltándose los vacíos', () => {
    render(
      <PosterRail label="Emitiendo ahora" list bleed className="extra">
        <span>A</span>
        {null}
        <span>B</span>
        {false}
      </PosterRail>,
    );
    const list = screen.getByRole('list', { name: 'Emitiendo ahora' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list.parentElement).toHaveClass('prail', 'prail--bleed', 'extra');
  });
});
