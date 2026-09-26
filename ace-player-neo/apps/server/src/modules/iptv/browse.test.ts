/* Índice y consulta de la pestaña IPTV (docs/iptv.md §16.3 y §16.5): filas por
   clave y país, categorías del proveedor en su orden, facetas disyuntivas,
   texto por niveles, páginas sin repetir, cursor y rendimiento con 30 000
   canales (100 000 en @lento). */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IPTV_BROWSE } from '@ace/shared';
import { bigCatalog } from '../../../test/fake-iptv/catalogo-grande.js';
import {
  browseIndex,
  buildBrowseIndex,
  buildBrowseIndexSteps,
  catalogStamp,
  categoryId,
  cleanBrowseQuery,
  decodeCursor,
  encodeCursor,
  rowQualities,
  type BrowseIndex,
  type BrowseRequest,
} from './browse.js';
import { Catalog, type RawChannel } from './catalog.js';
import { searchCatalog } from './search.js';

const PROVIDER = 'p_Prueba01';

function hexId(n: number): string {
  return createHash('sha1').update(`canal-${n}`).digest('hex');
}

function raw(n: number, title: string, group: string, extra: Partial<RawChannel> = {}): RawChannel {
  return {
    id: hexId(n),
    title,
    group,
    tvgId: '',
    ref: String(n),
    tvgShift: null,
    userAgent: null,
    referrer: null,
    ...extra,
  };
}

function catalogOf(channels: readonly RawChannel[], groupOrder?: readonly string[]): Catalog {
  return new Catalog(PROVIDER, 1, 'xtream', 1_790_000_000_000, [], 'ts', channels, groupOrder);
}

function query(index: BrowseIndex, request: Partial<BrowseRequest> = {}) {
  return browseIndex(index, { offset: 0, limit: 60, withSummary: true, ...request });
}

function titles(index: BrowseIndex, rows: readonly number[]): string[] {
  return rows.map((row) => `${index.best[row]?.display}/${index.country[row] ?? '-'}`);
}

/* Un catálogo pequeño con las trampas de §16.3. */
const SMALL = [
  raw(1, 'ES: DAZN 1 FHD', 'ES | DEPORTES'),
  raw(2, 'ES: DAZN 1 HD', 'ES | DEPORTES'),
  raw(3, 'ES: DAZN 1 (Backup)', 'ES | DEPORTES'),
  raw(4, 'UK: DAZN 1', 'UK | SPORTS'),
  raw(5, 'DAZN LaLiga FHD', 'ES | DEPORTES'),
  raw(6, 'DAZN LaLiga HD', 'ES | DAZN'),
  raw(7, 'DAZN F1', 'ES | DAZN'),
  raw(8, 'LA LIGA 1', 'ES | DEPORTES'),
  raw(9, 'XXX: HOT 1', 'XXX | ADULTS'),
  raw(10, 'Canal sin grupo', ''),
  raw(11, 'CLAN', 'ES | INFANTIL'),
  raw(12, 'ANTENA 3 ᴴᴰ', 'ES | GENERALISTAS'),
  raw(13, 'ANTENA 3 INTERNACIONAL', 'ES | GENERALISTAS'),
  raw(14, 'DIRECTO ANTENA 3 ᴿᴬᵂ', 'ES | GENERALISTAS'),
];

describe('filas y categorías (§16.3)', () => {
  it('una fila = clave limpia + país: «UK: DAZN 1» aparte de «ES: DAZN 1»; calidades de sus variantes; la mejor variante manda', () => {
    const index = buildBrowseIndex(catalogOf(SMALL));
    const all = query(index, { limit: 100 });
    const dazn1 = all.rows.filter((row) => index.key[row] === 'dazn 1');
    expect(titles(index, dazn1)).toEqual(['DAZN 1/ES', 'DAZN 1/UK']);
    const es = dazn1[0] as number;
    expect(index.best[es]?.id).toBe(hexId(1));
    expect(rowQualities(index, es)).toEqual(['fhd', 'hd']);
    expect(rowQualities(index, dazn1[1] as number)).toEqual([]);
    expect(index.rowCount).toBe(SMALL.length - 3);
  });

  it('una fila está en todas las categorías de sus variantes y cuenta en las dos; su categoría es la de la mejor', () => {
    const index = buildBrowseIndex(catalogOf(SMALL));
    const deportes = index.categoryById.get(categoryId(PROVIDER, 'ES | DEPORTES'));
    const dazn = index.categoryById.get(categoryId(PROVIDER, 'ES | DAZN'));
    expect(deportes && dazn).toBeTruthy();
    const inDazn = query(index, { category: dazn!.id });
    expect(titles(index, inDazn.rows)).toEqual(['DAZN LaLiga/ES', 'DAZN F1/ES']);
    const laliga = inDazn.rows[0] as number;
    expect(index.categories[index.category[laliga] as number]?.name).toBe('ES | DEPORTES');
    const root = query(index);
    const counts = Object.fromEntries(
      (root.categories ?? []).map((item) => [item.category.name, item.count]),
    );
    expect(counts['ES | DEPORTES']).toBe(3);
    expect(counts['ES | DAZN']).toBe(2);
  });

  it('categorías en el orden del proveedor (Xtream) o de primera aparición (M3U); «Sin categoría» al final', () => {
    const order = ['ES | GENERALISTAS', 'ES | DAZN', 'NO EXISTE', 'ES | DEPORTES'];
    const xtream = buildBrowseIndex(catalogOf(SMALL, order));
    expect(xtream.categories.map((item) => item.name)).toEqual([
      'ES | GENERALISTAS',
      'ES | DAZN',
      'ES | DEPORTES',
      'UK | SPORTS',
      'XXX | ADULTS',
      'ES | INFANTIL',
      '',
    ]);
    const m3u = buildBrowseIndex(catalogOf(SMALL));
    expect(m3u.categories.map((item) => item.name)).toEqual([
      'ES | DEPORTES',
      'UK | SPORTS',
      'ES | DAZN',
      'XXX | ADULTS',
      'ES | INFANTIL',
      'ES | GENERALISTAS',
      '',
    ]);
    expect(m3u.categories.at(-1)?.id).toBe('none');
  });

  it('ids de categoría: 12 hex estables con el nombre; otro proveedor da otros; sin nombre, none', () => {
    const id = categoryId(PROVIDER, 'ES | DAZN');
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(categoryId(PROVIDER, 'ES | DAZN')).toBe(id);
    expect(categoryId('p_Otro0001', 'ES | DAZN')).not.toBe(id);
    expect(categoryId(PROVIDER, '')).toBe('none');
  });

  it('filas sin texto en el orden del proveedor (primera aparición de cualquiera de sus variantes)', () => {
    const channels = [
      raw(1, 'ES: B HD', 'G'),
      raw(2, 'ES: A', 'G'),
      raw(3, 'ES: B FHD', 'G'),
      raw(4, 'ES: C', 'G'),
    ];
    const index = buildBrowseIndex(catalogOf(channels));
    expect(titles(index, query(index).rows)).toEqual(['B/ES', 'A/ES', 'C/ES']);
    expect(index.best[0]?.id).toBe(hexId(3));
  });
});

describe('texto (§16.3)', () => {
  it('casa como el buscador: principio de palabra, dentro con 3 letras y clave sin espacios', () => {
    const index = buildBrowseIndex(catalogOf(SMALL));
    expect(titles(index, query(index, { q: 'dazn' }).rows)).toEqual([
      'DAZN 1/ES',
      'DAZN 1/UK',
      'DAZN LaLiga/ES',
      'DAZN F1/ES',
    ]);
    /* «liga» está dentro de «laliga» en las dos (nivel 3): el orden del proveedor. */
    expect(titles(index, query(index, { q: 'liga' }).rows)).toEqual([
      'DAZN LaLiga/ES',
      'LA LIGA 1/ES',
    ]);
    expect(titles(index, query(index, { q: 'antena' }).rows)).toHaveLength(3);
  });

  it('niveles: clave igual → empieza por → palabras en orden → el resto; dentro, el del proveedor', () => {
    const channels = [
      raw(1, 'ES: SUPER DAZN 1', 'G'),
      raw(2, 'ES: DAZN 1 EXTRA', 'G'),
      raw(3, 'ES: 1 DAZN', 'G'),
      raw(4, 'ES: DAZN 1', 'G'),
    ];
    const index = buildBrowseIndex(catalogOf(channels));
    expect(titles(index, query(index, { q: 'dazn 1' }).rows)).toEqual([
      'DAZN 1/ES',
      'DAZN 1 EXTRA/ES',
      'SUPER DAZN 1/ES',
      '1 DAZN/ES',
    ]);
  });

  it('las mismas claves que el buscador para la misma consulta (en lo que el buscador enseña)', () => {
    const catalog = catalogOf(SMALL);
    const index = buildBrowseIndex(catalog);
    for (const q of ['dazn', 'liga', 'antena 3', 'la liga', 'lasexta', 'clan']) {
      const fromSearch = new Set(searchCatalog(catalog, q, 50).groups.map((group) => group.key));
      const fromBrowse = new Set(query(index, { q, limit: 100 }).rows.map((row) => index.key[row]));
      for (const key of fromSearch) expect(fromBrowse.has(key), `${q}: ${key}`).toBe(true);
    }
  });

  it('con la grafía de la lista real (§18): «m+ la liga», «mov laliga» o «movistar plus» casan como en el buscador', () => {
    const catalog = catalogOf([
      raw(1, 'M+ LALIGA HD', 'ES | DEPORTES'),
      raw(2, 'MOVISTAR LALIGA 2', 'ES | DEPORTES'),
      raw(3, 'MOVISTAR PLUS +2', 'ES | MOVISTAR'),
      raw(4, 'LALIGA+ PPV 1', 'ES | DEPORTES'),
      raw(5, 'LA LIGA TV BAR', 'ES | DEPORTES'),
      raw(6, 'MOVISTAR 2022 1', 'ES | MOVISTAR'),
      raw(7, 'LA SEXTA', 'ES | GENERALISTAS'),
    ]);
    const index = buildBrowseIndex(catalog);
    for (const q of [
      'm+ la liga',
      'mov laliga',
      'm. laliga',
      'movistar plus',
      'la sexta',
      'laliga+',
    ]) {
      const fromSearch = new Set(searchCatalog(catalog, q, 50).groups.map((group) => group.key));
      const fromBrowse = new Set(query(index, { q, limit: 100 }).rows.map((row) => index.key[row]));
      expect(fromSearch.size, q).toBeGreaterThan(0);
      for (const key of fromSearch) expect(fromBrowse.has(key), `${q}: ${key}`).toBe(true);
    }
  });

  it('en la raíz con texto, las categorías con el texto en el nombre (5 como mucho), contadas sin el texto', () => {
    const channels = Array.from({ length: 8 }, (_, i) =>
      raw(i + 1, `CANAL ${i}`, `ES | DAZN ${i}`),
    );
    const index = buildBrowseIndex(catalogOf([...channels, raw(99, 'DAZN F1', 'ES | OTRA')]));
    const result = query(index, { q: 'dazn' });
    expect(result.categories?.map((item) => item.category.name)).toEqual([
      'ES | DAZN 0',
      'ES | DAZN 1',
      'ES | DAZN 2',
      'ES | DAZN 3',
      'ES | DAZN 4',
    ]);
    expect(result.categories?.every((item) => item.count === 1)).toBe(true);
    expect(titles(index, result.rows)).toEqual(['DAZN F1/ES']);
  });

  it('menos de 2 letras se ignora; solo calidad («hd») no casa con nada', () => {
    const index = buildBrowseIndex(catalogOf(SMALL));
    expect(cleanBrowseQuery(' a ')).toBe('');
    expect(query(index, { q: 'a' }).total).toBe(index.rowCount);
    expect(query(index, { q: 'hd' }).total).toBe(0);
  });
});

describe('facetas (§16.4 y §16.5)', () => {
  const index = buildBrowseIndex(catalogOf(SMALL));
  const counts = (
    facets: ReturnType<typeof query>['facets'],
    name: 'country' | 'type' | 'sport' | 'quality' | 'language',
  ) => Object.fromEntries((facets?.[name] ?? []).map((item) => [item.value, item.count]));

  it('recuentos disyuntivos: «España» con «Fútbol» elegido cuenta con fútbol; «Fútbol» no cuenta su propio filtro', () => {
    const result = query(index, { sport: ['futbol'] });
    expect(titles(index, result.rows)).toEqual(['DAZN LaLiga/ES', 'LA LIGA 1/ES']);
    expect(counts(result.facets, 'country')).toEqual({ ES: 2 });
    const sports = counts(result.facets, 'sport');
    expect(sports.futbol).toBe(2);
    expect(sports.f1).toBe(1);
    const both = query(index, { sport: ['futbol', 'f1'], country: ['ES'] });
    expect(both.total).toBe(3);
    expect(counts(both.facets, 'country')).toEqual({ ES: 3 });
  });

  it('O dentro de un filtro y Y entre filtros', () => {
    expect(query(index, { country: ['ES', 'UK'] }).total).toBe(
      query(index, { country: ['ES'] }).total + query(index, { country: ['UK'] }).total,
    );
    expect(query(index, { country: ['UK'], sport: ['futbol'] }).total).toBe(0);
  });

  it('un valor elegido sale aunque cuente 0 (también uno que el catálogo no tiene)', () => {
    const result = query(index, { country: ['UK'], sport: ['f1'] });
    expect(result.total).toBe(0);
    const f1 = result.facets?.sport.find((item) => item.value === 'f1');
    expect(f1).toEqual({ value: 'f1', count: 0, selected: true });
    const unknown = query(index, { country: ['HU'] });
    expect(unknown.facets?.country.find((item) => item.value === 'HU')).toEqual({
      value: 'HU',
      count: 0,
      selected: true,
    });
  });

  it('none en país, idioma, tipo y calidad (al final); adultos solo como tipo propio', () => {
    const result = query(index);
    expect(result.facets?.country.at(-1)?.value).toBe('none');
    expect(result.facets?.language.at(-1)?.value).toBe('none');
    expect(result.facets?.type.at(-1)?.value).toBe('none');
    expect(result.facets?.quality.map((item) => item.value)).toEqual(['fhd', 'hd', 'none']);
    const adults = query(index, { type: ['adultos'] });
    expect(titles(index, adults.rows)).toEqual(['HOT 1/-']);
    expect(counts(adults.facets, 'sport')).toEqual({});
    expect(query(index, { type: ['none'] }).rows.map((row) => index.best[row]?.display)).toEqual([
      'Canal sin grupo',
    ]);
  });

  it('calidad: una fila casa con «1080p» si alguna variante lo es; «Sin marca» si ninguna lleva', () => {
    expect(query(index, { quality: ['hd'] }).rows.map((row) => index.key[row])).toEqual([
      'dazn 1',
      'dazn laliga',
      'antena 3',
    ]);
    expect(query(index, { quality: ['none'] }).rows.map((row) => index.key[row])).toContain(
      'directo antena 3',
    );
  });

  it('orden de valores: de más a menos; tipos por su orden fijo al empatar; calidad en orden fijo', () => {
    const types = query(index).facets?.type.map((item) => item.value) ?? [];
    expect(types[0]).toBe('deportes');
    expect(types.indexOf('generalistas')).toBeLessThan(types.indexOf('infantil'));
  });
});

describe('páginas y cursor (§16.2)', () => {
  const catalog = catalogOf(
    bigCatalog(1_000).channels.map((c, i) => raw(i + 1, c.name, c.category)),
  );
  const index = buildBrowseIndex(catalog);

  it('recorrer todas las páginas da `total` filas sin repetir; limit 0 da solo el resumen', () => {
    const seen = new Set<number>();
    let offset: number | null = 0;
    let total = 0;
    while (offset !== null) {
      const page = query(index, { offset, withSummary: offset === 0 });
      total = page.total;
      for (const row of page.rows) seen.add(row);
      offset = page.nextOffset;
    }
    expect(seen.size).toBe(total);
    expect(total).toBe(index.rowCount);
    const summary = query(index, { limit: 0 });
    expect(summary.rows).toEqual([]);
    expect(summary.nextOffset).toBe(null);
    expect(summary.categories?.length).toBeGreaterThan(0);
  });

  it('una categoría desconocida: missing, sin filas', () => {
    const result = query(index, { category: 'abcdefabcdef' });
    expect(result.category).toBe('missing');
    expect(result.total).toBe(0);
  });

  it('cursor: base64url(sello.posición) que va y vuelve; lo demás, null', () => {
    const stamp = catalogStamp(catalog);
    expect(stamp).toMatch(/^[a-z0-9]{1,16}$/);
    const cursor = encodeCursor(stamp, 60);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(decodeCursor(cursor)).toEqual({ stamp, offset: 60 });
    expect(decodeCursor('bm8tdmFsZQ')).toBe(null);
    expect(decodeCursor(encodeCursor(stamp, 0))).toBe(null);
  });

  it('las páginas siguientes salen de la caché (16 consultas como mucho)', () => {
    for (let i = 0; i < IPTV_BROWSE.cacheEntries + 4; i += 1) query(index, { q: `canal ${i}` });
    expect(index.cache.size).toBeLessThanOrEqual(IPTV_BROWSE.cacheEntries);
  });
});

describe('rendimiento (§16.5)', () => {
  function big(total: number): Catalog {
    const { channels, categories } = bigCatalog(total);
    return catalogOf(
      channels.map((c, i) => raw(i + 1, c.name, c.category)),
      categories.map((item) => item.name),
    );
  }

  it('el índice se monta a trozos (cede el hilo cada 5 000 canales)', () => {
    const steps = buildBrowseIndexSteps(big(12_000), 5_000);
    let yields = 0;
    for (let next = steps.next(); !next.done; next = steps.next()) yields += 1;
    expect(yields).toBeGreaterThanOrEqual(2);
  });

  it('30 000 canales: montar < 1,5 s; consulta en frío < 20 ms; página siguiente < 2 ms', () => {
    const catalog = big(30_000);
    const started = performance.now();
    const index = buildBrowseIndex(catalog);
    const buildMs = performance.now() - started;
    expect(buildMs).toBeLessThan(1_500);
    /* «En frío» es sin la caché de consultas, no con el código sin compilar: se calienta con un índice pequeño. */
    query(buildBrowseIndex(catalogOf(SMALL)), { q: 'dazn canal', country: ['ES'] });
    const requests: Partial<BrowseRequest>[] = [
      {},
      { limit: 0 },
      { q: 'dazn' },
      { q: 'canal 12' },
      { country: ['ES'], sport: ['futbol'] },
      { type: ['deportes'], quality: ['fhd', 'hd'] },
      { language: ['en'], q: 'sports' },
      { category: index.categories[1]?.id },
    ];
    const colds: number[] = [];
    const warms: number[] = [];
    for (const request of requests) {
      index.cache.clear();
      const cold = performance.now();
      const first = query(index, request);
      const coldMs = performance.now() - cold;
      colds.push(coldMs);
      /* Cada una, dentro de lo que puede tardar la respuesta entera (§16.5). */
      expect(coldMs, JSON.stringify(request)).toBeLessThan(100);
      if (first.nextOffset !== null) {
        const warm = performance.now();
        query(index, { ...request, offset: first.nextOffset, withSummary: false });
        warms.push(performance.now() - warm);
      }
    }
    /* Con margen si la máquina va cargada (la tanda entera a la vez): la mediana. */
    const median = (times: number[]): number =>
      [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] as number;
    expect(median(colds)).toBeLessThan(20);
    expect(median(warms)).toBeLessThan(2);
  });

  it('@lento 100 000 canales: consulta en frío < 60 ms', () => {
    const index = buildBrowseIndex(big(100_000));
    index.cache.clear();
    const cold = performance.now();
    query(index, { country: ['ES'], q: 'canal' });
    expect(performance.now() - cold).toBeLessThan(60);
  }, 30_000);
});
