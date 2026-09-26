/* Catálogo: lo que la pestaña IPTV necesita guardar además (docs/iptv.md §16.5):
   el orden de las categorías del proveedor y `tvg-country` / `tvg-language`,
   de ida y vuelta por `catalogo.enc`, y un catálogo viejo sin ellos se carga. */

import { describe, expect, it } from 'vitest';
import { Catalog, cleanTvgAttribute, type RawChannel, type StoredCatalog } from './catalog.js';

const channel = (n: number, extra: Partial<RawChannel> = {}): RawChannel => ({
  id: n.toString(16).padStart(40, '0'),
  title: `ES: Canal ${n}`,
  group: n % 2 ? 'ES | DEPORTES' : 'ES | CINE',
  tvgId: `C${n}.es`,
  ref: String(n),
  tvgShift: null,
  userAgent: null,
  referrer: null,
  ...extra,
});

function build(groupOrder?: readonly string[]): Catalog {
  return new Catalog(
    'p_Prueba01',
    3,
    'm3u',
    1_790_000_000_000,
    [],
    null,
    [
      channel(1, { tvgCountry: 'ES', tvgLanguage: 'Spanish;English' }),
      channel(2),
      channel(3, { tvgLanguage: 'cat' }),
    ],
    groupOrder,
  );
}

describe('catálogo para la pestaña IPTV (§16.5)', () => {
  it('groupOrder y tvg-country / tvg-language van y vuelven por toStored y storedChunks', () => {
    const catalog = build(['ES | CINE', 'ES | DEPORTES']);
    const stored = catalog.toStored();
    expect(stored.groupOrder).toEqual(['ES | CINE', 'ES | DEPORTES']);
    expect(stored.entries[0]).toHaveLength(10);
    expect(stored.entries[1]).toHaveLength(8);
    const chunks = JSON.parse([...catalog.storedChunks(2)].join('')) as StoredCatalog;
    expect(chunks).toEqual(JSON.parse(JSON.stringify(stored)));
    const again = Catalog.fromStored(chunks)!;
    expect(again.groupOrder).toEqual(['ES | CINE', 'ES | DEPORTES']);
    expect(again.entries.map((entry) => [entry.tvgCountry, entry.tvgLanguage])).toEqual([
      ['ES', 'Spanish;English'],
      [null, null],
      [null, 'cat'],
    ]);
  });

  it('un catalogo.enc de antes (sin groupOrder ni las dos posiciones nuevas) se carga igual', () => {
    const old = build().toStored();
    const legacy = {
      ...old,
      entries: old.entries.map((entry) => entry.slice(0, 8)),
    } as unknown;
    delete (legacy as { groupOrder?: unknown }).groupOrder;
    const catalog = Catalog.fromStored(legacy)!;
    expect(catalog.size).toBe(3);
    expect(catalog.groupOrder).toEqual([]);
    expect(catalog.entries.every((entry) => entry.tvgCountry === null)).toBe(true);
    expect(catalog.toStored()).not.toHaveProperty('groupOrder');
  });

  it('cleanTvgAttribute: 64 como mucho, sin caracteres de control; vacío es null', () => {
    expect(cleanTvgAttribute(' ES ')).toBe('ES');
    expect(cleanTvgAttribute('x'.repeat(70))).toHaveLength(64);
    expect(cleanTvgAttribute('E\u0000S')).toBe('ES');
    expect(cleanTvgAttribute('   ')).toBe(null);
    expect(cleanTvgAttribute(5)).toBe(null);
  });
});
