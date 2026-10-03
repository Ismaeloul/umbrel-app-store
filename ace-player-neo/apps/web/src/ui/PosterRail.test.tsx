import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA } from '../lib/media.ts';
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

  describe('flechas y rueda (con ratón)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });
    /** Ratón de verdad (pointer: fine) y una pista de 1000 px en 400, desplazada `left`. */
    function setup(left: number | (() => number) = 0) {
      vi.mocked(window.scrollTo).mockClear();
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
          ({
            matches: query === MEDIA.finePointer,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
          }) as unknown as MediaQueryList,
      );
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000);
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
      vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(
        typeof left === 'number' ? () => left : left,
      );
      const scrollBy = vi.fn();
      HTMLElement.prototype.scrollBy = scrollBy as unknown as typeof HTMLElement.prototype.scrollBy;
      render(
        <PosterRail label="Novedades en películas" list>
          <a href="?vista=cine/1">Uno</a>
          <a href="?vista=cine/2">Dos</a>
          <a href="?vista=cine/3">Tres</a>
        </PosterRail>,
      );
      return { scrollBy, track: screen.getByRole('list', { name: 'Novedades en películas' }) };
    }

    it('la flecha desplaza SOLO en horizontal: ni la página ni scrollIntoView', () => {
      const { scrollBy } = setup();
      const next = screen.getByRole('button', { name: 'Siguientes' });
      fireEvent.pointerDown(next);
      fireEvent.mouseDown(next);
      next.focus();
      fireEvent.pointerUp(next);
      fireEvent.mouseUp(next);
      fireEvent.click(next);
      expect(scrollBy).toHaveBeenCalledTimes(1);
      const [options] = scrollBy.mock.calls[0] as [ScrollToOptions];
      expect(options).toEqual({ left: 320, behavior: 'smooth' });
      expect(options).not.toHaveProperty('top');
      expect(window.scrollTo).not.toHaveBeenCalled();
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    const off = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-disabled') === 'true';

    it('al principio, «Anteriores» está apagada; al final, «Siguientes»', () => {
      setup(0);
      expect(off('Anteriores')).toBe(true);
      expect(off('Siguientes')).toBe(false);
      cleanup();
      setup(600);
      expect(off('Anteriores')).toBe(false);
      expect(off('Siguientes')).toBe(true);
    });

    it('apagada, la flecha sigue ahí y se traga el clic de más (no cae en el cartel de debajo)', () => {
      const { scrollBy } = setup(600);
      const next = screen.getByRole('button', { name: 'Siguientes' });
      // No es `disabled`: un botón deshabilitado no recoge el clic y, con
      // pointer-events: none, el clic lo recibía la tarjeta que hay debajo.
      expect(next).not.toBeDisabled();
      const behind = vi.fn();
      document.addEventListener('click', behind);
      fireEvent.click(next);
      document.removeEventListener('click', behind);
      expect(scrollBy).not.toHaveBeenCalled();
      // El clic lo recibe la flecha (burbujea desde ella, no desde un cartel).
      expect(behind).toHaveBeenCalledTimes(1);
      expect((behind.mock.calls[0]?.[0] as MouseEvent).target).toBe(next);
    });

    it('con teclado, al llegar al final el foco se queda en la flecha', () => {
      const left = { value: 200 };
      const { track } = setup(() => left.value);
      const next = screen.getByRole('button', { name: 'Siguientes' });
      next.focus();
      fireEvent.click(next);
      left.value = 600;
      fireEvent.scroll(track);
      expect(off('Siguientes')).toBe(true);
      expect(document.activeElement).toBe(next);
    });

    it('al desplazarse, se vuelven a mirar los extremos', () => {
      const left = { value: 0 };
      const { track } = setup(() => left.value);
      expect(off('Anteriores')).toBe(true);
      left.value = 250;
      fireEvent.scroll(track);
      expect(off('Anteriores')).toBe(false);
    });

    it('la rueda vertical encima de la fila no se la queda: baja la página', () => {
      const { track, scrollBy } = setup(200);
      const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
      track.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('Mayús + rueda sí la desplaza a los lados', () => {
      const { track, scrollBy } = setup(200);
      const event = new WheelEvent('wheel', {
        deltaY: 120,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      track.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(scrollBy).toHaveBeenCalledWith({ left: 120, behavior: 'auto' });
    });
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
