import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('pista enfocable', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });
    // jsdom no maqueta: se finge una pista que desborda (400 de contenido en 200).
    const overflowing = () => {
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    };

    it('si desborda y no hay nada enfocable dentro, entra en el orden de tabulación', () => {
      overflowing();
      render(
        <PosterRail label="Partidos de muestra" list>
          <article>Uno</article>
          <article>Dos</article>
        </PosterRail>,
      );
      expect(screen.getByRole('list', { name: 'Partidos de muestra' })).toHaveAttribute(
        'tabindex',
        '0',
      );
    });

    it('con carteles enfocables, no (el foco ya la desplaza)', () => {
      overflowing();
      render(
        <PosterRail label="Emitiendo ahora">
          <a href="?vista=agenda">Uno</a>
          <a href="?vista=agenda">Dos</a>
        </PosterRail>,
      );
      expect(screen.getByRole('group', { name: 'Emitiendo ahora' })).not.toHaveAttribute(
        'tabindex',
      );
    });

    it('sin desbordar, tampoco', () => {
      render(
        <PosterRail label="Partidos de muestra">
          <article>Uno</article>
        </PosterRail>,
      );
      expect(screen.getByRole('group', { name: 'Partidos de muestra' })).not.toHaveAttribute(
        'tabindex',
      );
    });
  });
});
