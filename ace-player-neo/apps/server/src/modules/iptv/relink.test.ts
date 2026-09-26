/* Re-emparejado de favoritos y recientes IPTV (docs/iptv.md §14.6, D28):
   en su sitio y con el `alias` mandando, sin repetir ids, recientes sin
   pareja fuera, favoritos sin pareja fuera solo pasadas 24 h, la variante
   que deja de ser la mejor pasa a la mejor, y lo que no es IPTV no se toca. */

import { describe, expect, it } from 'vitest';
import type { Item } from '@ace/shared';
import { relinkLibrary, type RelinkOptions } from './relink.js';

const HOUR = 3_600_000;
const OLD_TELE = '1'.repeat(40);
const OLD_ANTENA = '2'.repeat(40);
const OLD_GONE = '3'.repeat(40);
const NEW_TELE = '4'.repeat(40);
const NEW_ANTENA = '5'.repeat(40);
const ANTENA_HD = '6'.repeat(40);
const ACE = 'a'.repeat(40);
const IPTV_IDS = new Set([OLD_TELE, OLD_ANTENA, OLD_GONE, NEW_TELE, NEW_ANTENA, ANTENA_HD]);

function item(id: string, title: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    title,
    type: 'fav',
    category: 'IPTV',
    date: '2026-09-26T10:00:00.000Z',
    fromWebSync: false,
    ih: false,
    ...extra,
  };
}

/* Catálogo del proveedor nuevo: Telecinco y Antena 3 (FHD la mejor, HD otra variante). */
function options(overrides: Partial<RelinkOptions> = {}): RelinkOptions {
  const catalog = new Map([
    [NEW_TELE, NEW_TELE],
    [NEW_ANTENA, NEW_ANTENA],
    [ANTENA_HD, NEW_ANTENA],
  ]);
  const names = new Map([
    ['telecinco', NEW_TELE],
    ['antena 3', NEW_ANTENA],
  ]);
  return {
    isIptvId: (id) => IPTV_IDS.has(id),
    currentBest: (id) => catalog.get(id) ?? null,
    matchByName: (name) => names.get(name.toLowerCase()) ?? null,
    missingSince: new Map(),
    now: 0,
    ...overrides,
  };
}

describe('relinkLibrary (§14.6)', () => {
  it('cambio de proveedor: favorito y reciente re-emparejados en su sitio; el alias manda sobre el nombre renombrado', () => {
    const favorites = [
      item(ACE, 'Canal de AceStream'),
      item(OLD_TELE, 'Tele 5 (mío)', { alias: 'Telecinco' }),
      item(OLD_ANTENA, 'Antena 3'),
    ];
    const history = [item(OLD_TELE, 'Telecinco', { type: 'recent', category: '' })];
    const result = relinkLibrary({ favorites, history }, options());
    expect(result.changed).toBe(true);
    expect(result.favorites.map((entry) => entry.id)).toEqual([ACE, NEW_TELE, NEW_ANTENA]);
    /* Mismo título, alias, categoría, fecha y posición. */
    expect(result.favorites[1]).toEqual({ ...favorites[1], id: NEW_TELE });
    expect(result.favorites[0]).toBe(favorites[0]);
    expect(result.history).toEqual([{ ...history[0], id: NEW_TELE }]);
    expect(result.relinked).toBe(3);
  });

  it('si el id nuevo ya estaba en la colección, se quita el viejo', () => {
    const favorites = [item(NEW_TELE, 'Telecinco'), item(OLD_TELE, 'Telecinco')];
    const result = relinkLibrary({ favorites, history: [] }, options());
    expect(result.favorites.map((entry) => entry.id)).toEqual([NEW_TELE]);
    expect(result.removed).toBe(1);
  });

  it('un reciente sin pareja se quita al momento', () => {
    const history = [item(OLD_GONE, 'Canal que ya no está', { type: 'recent' }), item(ACE, 'Otro')];
    const result = relinkLibrary({ favorites: [], history }, options());
    expect(result.history.map((entry) => entry.id)).toEqual([ACE]);
  });

  it('un favorito sin pareja sigue 24 h (con «Ya no está en tu IPTV») y luego se va', () => {
    const favorites = [item(OLD_GONE, 'Canal que ya no está')];
    const missingSince = new Map<string, number>();
    const first = relinkLibrary({ favorites, history: [] }, options({ missingSince, now: 0 }));
    expect(first.changed).toBe(false);
    expect(missingSince.get(OLD_GONE)).toBe(0);
    const later = relinkLibrary(
      { favorites, history: [] },
      options({ missingSince, now: 23 * HOUR }),
    );
    expect(later.favorites.map((entry) => entry.id)).toEqual([OLD_GONE]);
    const gone = relinkLibrary(
      { favorites, history: [] },
      options({ missingSince, now: 24 * HOUR }),
    );
    expect(gone.favorites).toEqual([]);
    expect(gone.changed).toBe(true);
    expect(missingSince.has(OLD_GONE)).toBe(false);
  });

  it('si vuelve a casar antes de las 24 h, deja de contar', () => {
    const favorites = [item(OLD_GONE, 'Telecinco')];
    const missingSince = new Map([[OLD_GONE, 0]]);
    const result = relinkLibrary(
      { favorites, history: [] },
      options({ missingSince, now: 30 * HOUR }),
    );
    expect(result.favorites.map((entry) => entry.id)).toEqual([NEW_TELE]);
    expect(missingSince.size).toBe(0);
  });

  it('una variante que deja de ser la mejor pasa a la mejor', () => {
    const favorites = [item(ANTENA_HD, 'Antena 3')];
    const result = relinkLibrary({ favorites, history: [] }, options());
    expect(result.favorites.map((entry) => entry.id)).toEqual([NEW_ANTENA]);
  });

  it('lo que ya está bien, o no es IPTV, no cambia (y no hay que escribir nada)', () => {
    const favorites = [item(NEW_TELE, 'Telecinco'), item(ACE, 'Canal de AceStream')];
    const history = [item(ACE, 'Canal de AceStream', { type: 'recent' })];
    const result = relinkLibrary({ favorites, history }, options());
    expect(result.changed).toBe(false);
    expect(result.favorites).toEqual(favorites);
    expect(result.history).toEqual(history);
  });
});
