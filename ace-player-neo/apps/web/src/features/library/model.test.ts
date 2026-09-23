import { describe, expect, it } from 'vitest';
import {
  availabilityPercent,
  filterItems,
  findKnownItem,
  groupByCategory,
  initialTab,
  isFallenFavorite,
  libraryFooter,
  recentGroups,
  subtitleFor,
} from './model.ts';
import { makeItem, makeLibrary } from './test-utils.tsx';

describe('pestaña inicial (regla 32)', () => {
  it('Favoritos si hay favoritos; si no, Recientes; si no, Listas', () => {
    const fav = makeItem('A', 'fav');
    const recent = makeItem('B', 'recent');
    expect(initialTab({ favorites: [fav], history: [recent] })).toBe('favoritos');
    expect(initialTab({ favorites: [], history: [recent] })).toBe('recientes');
    expect(initialTab({ favorites: [], history: [] })).toBe('listas');
  });
});

describe('filtro local', () => {
  const items = [
    makeItem('Fútbol Uno', 'web', { category: 'Deportes' }),
    makeItem('La 1', 'web', { category: 'Generalistas' }),
    makeItem('ESPN', 'web', { category: 'Internacional' }),
  ];
  it('busca por título o categoría, sin tildes ni mayúsculas', () => {
    expect(filterItems(items, 'futbol').map((i) => i.title)).toEqual(['Fútbol Uno']);
    expect(filterItems(items, 'GENERAL').map((i) => i.title)).toEqual(['La 1']);
    expect(filterItems(items, '  ')).toHaveLength(3);
    expect(filterItems(items, 'nada')).toEqual([]);
  });
});

describe('agrupados', () => {
  it('categorías en orden alfabético y las vacías en «General»', () => {
    const groups = groupByCategory([
      makeItem('B', 'web', { category: 'Música' }),
      makeItem('A', 'web', { category: '' }),
      makeItem('C', 'web', { category: 'Deportes' }),
      makeItem('D', 'web', { category: 'deportes extra' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      'Deportes',
      'deportes extra',
      'General',
      'Música',
    ]);
  });

  it('recientes con cabeceras de Hoy, Ayer, Esta semana y Antes sin reordenar', () => {
    const now = new Date('2026-09-23T20:00:00').getTime();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
    const groups = recentGroups(
      [
        makeItem('uno', 'recent', { date: at(1) }),
        makeItem('dos', 'recent', { date: at(22) }),
        makeItem('tres', 'recent', { date: at(24 * 3) }),
        makeItem('cuatro', 'recent', { date: at(24 * 30) }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.title)])).toEqual([
      ['Hoy', ['uno']],
      ['Ayer', ['dos']],
      ['Esta semana', ['tres']],
      ['Antes', ['cuatro']],
    ]);
  });
});

describe('subtítulos de la tarjeta', () => {
  const item = makeItem('X', 'fav', { category: 'Guardado' });
  it('búsqueda con disponibilidad; lista con categoría; si no, 14 del hash', () => {
    expect(subtitleFor({ ...item, category: 'Deportes' }, 'search', 0.914)).toBe(
      'Deportes · disp. 91%',
    );
    expect(subtitleFor({ ...item, category: '' }, 'search', null)).toBe('Búsqueda');
    expect(subtitleFor({ ...item, category: 'Cine' }, 'web')).toBe('Cine');
    expect(subtitleFor(item, 'favorites')).toBe(`${item.id.slice(0, 14)}…`);
    expect(subtitleFor({ ...item, category: 'Deportes' }, 'favorites')).toBe('Deportes');
  });
  it('disponibilidad a porcentaje entero y acotado', () => {
    expect(availabilityPercent(1.7)).toBe(100);
    expect(availabilityPercent(-1)).toBe(0);
    expect(availabilityPercent(null)).toBeNull();
  });
});

describe('canal caído y pie', () => {
  it('un favorito sincronizado que ya no está en la lista activa', () => {
    const fav = makeItem('Viejo', 'fav', { fromWebSync: true });
    expect(isFallenFavorite(fav, new Set(['otro']))).toBe(true);
    expect(isFallenFavorite(fav, new Set([fav.id]))).toBe(false);
    expect(isFallenFavorite({ ...fav, fromWebSync: false }, new Set(['otro']))).toBe(false);
    // Sin lista cargada no hay con qué comparar.
    expect(isFallenFavorite(fav, new Set())).toBe(false);
  });

  it('pie con el total, la fecha de la lista y «demo»', () => {
    const library = makeLibrary();
    const text = libraryFooter(library, true);
    expect(text).toMatch(/^6 canales en biblioteca · lista sincronizada \d+ \S+ · demo$/);
    expect(libraryFooter({ ...library, webSyncedAt: null }, false)).toBe('6 canales en biblioteca');
  });

  it('encuentra el título de un hash en cualquier colección', () => {
    const library = makeLibrary();
    expect(findKnownItem(library, library.history[0]!.id)?.title).toBe('Canal de prueba');
    expect(findKnownItem(library, 'f'.repeat(40))).toBeNull();
    expect(findKnownItem(undefined, 'x')).toBeNull();
  });
});
