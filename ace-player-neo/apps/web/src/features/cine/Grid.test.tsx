/* Rejilla de carteles (docs/vod.md §12.4): una lista de tarjetas con su
   posición y el total, columnas por el ancho, relleno sin cartel. */

import type { VodCard } from '@ace/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { PosterGrid } from './Grid.tsx';
import { PosterCard } from './PosterCard.tsx';
import { renderCine } from './test-utils.tsx';

function card(i: number, extra: Partial<VodCard> = {}): VodCard {
  return {
    id: i.toString(16).padStart(40, 'a'),
    kind: 'movie',
    title: `Película ${i}`,
    year: 2000 + (i % 25),
    rating: 7.3,
    poster: i % 2 ? 'abcdef01' : null,
    tags: [],
    adult: false,
    progress: null,
    ...extra,
  };
}

let width = 1024;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('vlist__row') ? 300 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const w = this.classList.contains('cine-grid') ? width : 0;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: w,
      bottom: 0,
      width: w,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetMode();
});

describe('rejilla', () => {
  it('una lista de tarjetas con aria-setsize (el total) y aria-posinset', () => {
    width = 1024;
    const cards = Array.from({ length: 12 }, (_, i) => card(i + 1));
    renderCine({ ui: <PosterGrid cards={cards} total={1234} label="Películas" /> });
    const list = screen.getByRole('list', { name: 'Películas' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveAttribute('aria-setsize', '1234');
    expect(items[11]).toHaveAttribute('aria-posinset', '12');
    // 6 columnas a 1024 px: dos filas.
    expect(list.style.getPropertyValue('--cols')).toBe('6');
    expect(list.querySelectorAll('.cine-grid__cells')).toHaveLength(2);
  });

  it.each([
    [360, '3'],
    [480, '4'],
    [768, '5'],
    [1280, '7'],
  ])('a %d px, %s columnas', (w, cols) => {
    width = w;
    renderCine({ ui: <PosterGrid cards={[card(1), card(2)]} total={2} label="Series" /> });
    expect(screen.getByRole('list', { name: 'Series' }).style.getPropertyValue('--cols')).toBe(
      cols,
    );
  });
});

describe('tarjeta', () => {
  it('enlace a la ficha con un nombre que lo dice todo; sin cartel, el monograma', () => {
    const item = card(4, {
      title: 'La sociedad de la nieve',
      tags: ['4k', 'castellano'],
      poster: null,
      progress: 0.4,
      adult: true,
    });
    renderCine({ search: '?vista=cine&flag=cine', ui: <PosterCard card={item} /> });
    const link = screen.getByRole('link', {
      name: 'La sociedad de la nieve, 2004, nota 7,3, Castellano, 4K, +18, visto: 40 %',
    });
    expect(link).toHaveAttribute('href', `?vista=cine/${item.id}&flag=cine`);
    expect(link.querySelector('.cine-art')).toHaveAttribute('data-state', 'fill');
    expect(link.querySelector('.cine-art__mono')?.textContent).toBe('SN');
    expect(within(link).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('con cartel, la imagen sale de vodArt por id y sello (nunca del proveedor)', () => {
    renderCine({ ui: <PosterCard card={card(3)} /> });
    const img = document.querySelector('.cine-art__img');
    expect(img?.getAttribute('src')).toBe(`/api/v1/vod/titles/${card(3).id}/art/poster?v=abcdef01`);
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});
