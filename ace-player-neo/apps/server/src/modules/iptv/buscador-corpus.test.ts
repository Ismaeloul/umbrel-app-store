/* El buscador de la IPTV con el corpus de nombres raros (0.9.0, docs/buscador.md): la tabla consulta → los
   primeros de packages/shared/test/corpus/esperados.ts, pasando por TODO el camino del servidor (limpieza del
   catálogo, variantes juntas, índice, niveles y orden) en Buscar (`searchCatalog`) y en la pestaña IPTV de
   Canales (`browseIndex`); tus favoritos; y 20 000 canales al teclear. */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keySearchWords, nameFactsOf, nameSearchWords } from '@ace/shared';
import {
  corpusIptv,
  corpusIptvGrande,
  type CanalCorpus,
} from '../../../../../packages/shared/test/corpus/canales-iptv.js';
import { ESPERADOS, checkEsperado } from '../../../../../packages/shared/test/corpus/esperados.js';
import { browseIndex, buildBrowseIndex, type BrowseIndex } from './browse.js';
import { Catalog, channelIdOf, type RawChannel } from './catalog.js';
import {
  NAME_CACHE_MAX,
  cachedKeyNames,
  compareRankedHits,
  packRankedHit,
  searchCatalog,
  type RankedHit,
} from './search.js';

function catalogOf(corpus: readonly CanalCorpus[]): Catalog {
  const raws: RawChannel[] = corpus.map((channel, i) => ({
    id: createHash('sha1').update(`corpus-${i}`).digest('hex'),
    title: channel.title,
    group: channel.group,
    tvgId: '',
    ref: String(i + 1),
    tvgShift: null,
    userAgent: null,
    referrer: null,
  }));
  return new Catalog('p_Corpus01', 1, 'xtream', 1_790_000_000_000, [], 'ts', raws);
}

/* La etiqueta de esperados.ts: las palabras que cuentan del nombre enseñado y el país si no es de casa. */
const label = (display: string, country: string | null | undefined): string =>
  `${nameFactsOf(display).sig}${country && country !== 'ES' ? `/${country}` : ''}`;

const catalog = catalogOf(corpusIptv());
const browse = buildBrowseIndex(catalog);

function searchLabels(q: string, favorites?: ReadonlySet<string>): string[] {
  return searchCatalog(catalog, q, 50, favorites ? { favorites } : {}).groups.map((group) =>
    label(group.best.display, group.bucket),
  );
}

function browseLabels(index: BrowseIndex, q: string, favorites?: ReadonlySet<string>): string[] {
  index.cache.clear();
  return browseIndex(index, {
    q,
    offset: 0,
    limit: 60,
    withSummary: false,
    ...(favorites ? { favorites, favoritesKey: [...favorites].join(',') } : {}),
  }).rows.map((row) => label(index.best[row]?.display ?? '', index.country[row]));
}

describe('el corpus en el catálogo del servidor', () => {
  it('cada forma de «La 1» (ES 4K, ES:, |ES|, ES►, ◉ ES:, (2), TVE…) es una sola fila', () => {
    expect(catalog.buckets('la 1').map((bucket) => bucket.bucket)).toEqual(['']);
    expect(catalog.group('la 1').length).toBeGreaterThanOrEqual(10);
    /* Ninguna clave con el país pegado («es la 1») ni la copia como número («la 1 2»). */
    const keys = [...catalog.groupKeys()];
    expect(keys.filter((key) => /^(?:es|esp|vip)\b/.test(key))).toEqual([]);
    expect(keys).not.toContain('la 1 2');
    expect(keys).not.toContain('la 1 tve');
  });

  it('«#N» numera canales distintos: cada uno su fila, sin copias que el relé use de respaldo', () => {
    const small = catalogOf([
      { title: 'ES: LALIGA+ PPV #1', group: 'ES | LALIGA' },
      { title: 'ES: LALIGA+ PPV #2', group: 'ES | LALIGA' },
      { title: 'ES: LALIGA+ PPV #3', group: 'ES | LALIGA' },
      { title: 'ES: DAZN PPV', group: 'ES | DAZN' },
      { title: 'ES: DAZN PPV #2', group: 'ES | DAZN' },
      { title: 'US: NBA LEAGUE PASS #1', group: 'US | NBA' },
      { title: 'US: NBA LEAGUE PASS #2', group: 'US | NBA' },
    ]);
    for (const key of ['laligaplus ppv 1', 'laligaplus ppv 2', 'laligaplus ppv 3', 'dazn ppv 2']) {
      expect(small.group(key), key).toHaveLength(1);
      expect(small.group(key)[0]?.backup, key).toBe(false);
    }
    /* Con el canal sin número al lado, «#2» tampoco es su copia (puede ser otro evento). */
    expect(small.group('dazn ppv')).toHaveLength(1);
    expect(small.group('nba league pass 2')).toHaveLength(1);
    const labels = (q: string): string[] =>
      searchCatalog(small, q, 10).groups.map((group) => label(group.best.display, group.bucket));
    expect(labels('laliga+ ppv')).toEqual([
      'laligaplus ppv 1',
      'laligaplus ppv 2',
      'laligaplus ppv 3',
    ]);
    const index = buildBrowseIndex(small);
    expect(browseLabels(index, 'laliga+ ppv')).toEqual([
      'laligaplus ppv 1',
      'laligaplus ppv 2',
      'laligaplus ppv 3',
    ]);
    expect(browseLabels(index, 'nba')).toEqual(['nba league pass 1/US', 'nba league pass 2/US']);
  });

  it('el TELE 5 de fuera sin país que se deduzca no se mete en la fila de Telecinco (ni se abre de respaldo)', () => {
    const small = catalogOf([
      { title: 'TELECINCO HD', group: 'ES | TDT' },
      { title: 'TELE 5 FHD', group: 'POLSKA' },
      { title: 'TELE 5', group: 'GERMANY' },
      { title: 'TELE 5 50FPS', group: 'ALLEMAGNE' },
      { title: 'DE - TELE 5 HD', group: 'DEUTSCHLAND' },
      { title: 'ES: TELE5 SD', group: 'ES | TDT' },
    ]);
    expect(small.group('telecinco').map((entry) => entry.title)).toEqual([
      'TELECINCO HD',
      'ES: TELE5 SD',
    ]);
    const labels = (q: string): string[] =>
      searchCatalog(small, q, 10).groups.map((group) => label(group.best.display, group.bucket));
    expect(labels('telecinco')).toEqual(['telecinco']);
    expect(labels('tele 5')).toEqual(['telecinco', 'tele 5', 'tele 5/DE']);
    const index = buildBrowseIndex(small);
    expect(browseLabels(index, 'telecinco')).toEqual(['telecinco']);
    expect(browseLabels(index, 'tele 5')[0]).toBe('telecinco');
  });

  it('las palabras rápidas de una clave son las mismas que las de `nameSearchWords`', () => {
    for (const key of catalogOf(corpusIptvGrande(20_000)).groupKeys()) {
      expect(keySearchWords(key), key).toEqual(nameSearchWords(key));
    }
  });
});

describe('Buscar con el corpus: consulta → los primeros (esperados.ts)', () => {
  it.each(ESPERADOS.map((item) => [item.q, item] as const))('«%s»', (q, esperado) => {
    checkEsperado(searchLabels(q), esperado);
  });
});

describe('la pestaña IPTV de Canales con el corpus: el mismo orden', () => {
  it.each(ESPERADOS.map((item) => [item.q, item] as const))('«%s»', (q, esperado) => {
    checkEsperado(browseLabels(browse, q), esperado);
  });
});

describe('Buscar y la pestaña IPTV ordenan igual', () => {
  /* Lo que difiere a propósito se deja fuera: Buscar también encuentra por la categoría (nivel 7; la pestaña enseña
     las categorías aparte: «deportes») y el país de una fila de la pestaña es el de sus filtros (§16.4: «AR» es
     árabe, no Argentina, y «USA» se escribe «US»). */
  const parity = catalogOf(corpusIptv().filter((channel) => !channel.title.startsWith('AR:')));
  const parityBrowse = buildBrowseIndex(parity);
  const sameCountry = (item: string): string => item.replace(/\/USA$/, '/US');
  const extra = ['laliga', 'liga', 'gol', 'sport', 'canal', 'tv', 'm+', 'la', 'cine', 'bein'];
  it.each([...ESPERADOS.map((item) => item.q), ...extra])('«%s»: los 15 primeros', (q) => {
    const found = searchCatalog(parity, q, 15).groups.map((group) =>
      sameCountry(label(group.best.display, group.bucket)),
    );
    expect(browseLabels(parityBrowse, q).slice(0, 15)).toEqual(found);
  });

  it('con la mejor variante en una plataforma o de reserva (la pestaña miraba solo esa)', () => {
    const small = catalogOf([
      { title: 'ES: LA LIGA 1 FHD', group: 'EU | ES | RAKUTEN TV' },
      { title: 'ES: LA LIGA 1 HD', group: 'EU | ES | DEPORTES' },
      { title: 'ES: LA LIGA 2 HD', group: 'EU | ES | DEPORTES' },
      { title: 'ES: DAZN LALIGA HD', group: 'EU | ES | DAZN' },
      { title: 'ES: GOL PLAY HEVC', group: 'EU | ES | DEPORTES' },
      { title: 'ES: GOL PLAY (BACKUP)', group: 'EU | ES | DEPORTES' },
      { title: 'ES: GOL MUNDIAL', group: 'EU | ES | DEPORTES' },
    ]);
    const index = buildBrowseIndex(small);
    const labels = (q: string): string[] =>
      searchCatalog(small, q, 10).groups.map((group) => label(group.best.display, group.bucket));
    for (const q of ['laliga', 'la liga', 'liga', 'gol']) {
      expect(browseLabels(index, q), q).toEqual(labels(q));
    }
    expect(labels('laliga')).toEqual(['laliga 1', 'laliga 2', 'dazn laliga']);
    expect(labels('gol')).toEqual(['gol play', 'gol mundial']);
  });

  it('con un filtro, lo que queda sale en el mismo orden que sin él', () => {
    const filtered = (q: string, country: string[]): string[] => {
      browse.cache.clear();
      return browseIndex(browse, {
        q,
        country,
        offset: 0,
        limit: 200,
        withSummary: false,
      }).rows.map((row) => label(browse.best[row]?.display ?? '', browse.country[row]));
    };
    for (const q of ['laliga tv', 'dazn', 'la 1', 'sport']) {
      const kept = new Set(filtered(q, ['ES']));
      browse.cache.clear();
      const all = browseIndex(browse, { q, offset: 0, limit: 200, withSummary: false }).rows.map(
        (row) => label(browse.best[row]?.display ?? '', browse.country[row]),
      );
      expect(filtered(q, ['ES']), q).toEqual(all.filter((item) => kept.has(item)));
    }
  });
});

describe('«liga» encuentra lo que la lleva dentro (LaLiga+, Bundesliga, Euroliga), detrás de lo bueno', () => {
  it.each([
    ['Buscar', (q: string) => searchLabels(q)],
    ['la pestaña IPTV', (q: string) => browseLabels(browse, q)],
  ] as const)('%s', (_where, labels) => {
    const found = labels('liga');
    for (const name of ['laligaplus ppv 1', 'sky sport bundesliga 1/DE', 'movistar euroliga']) {
      expect(found, name).toContain(name);
    }
    /* Lo que casa por dentro va detrás de lo que tiene «liga» como palabra («M+ Liga de Campeones»). */
    expect(found.indexOf('movistar liga de campeones')).toBeLessThan(
      found.indexOf('movistar euroliga'),
    );
  });
});

describe('tus favoritos desempatan, nunca delante de lo igual', () => {
  const channelOf = (key: string): string => {
    const entry = catalog.group(key)[0];
    if (!entry) throw new Error(key);
    return channelIdOf(entry);
  };

  it('«la 1» con La 1 Canarias en favoritos: La 1, La 1 Canarias, La 1 Catalunya', () => {
    const favorites = new Set([channelOf('la 1 canarias')]);
    expect(searchLabels('la 1', favorites).slice(0, 3)).toEqual([
      'la 1',
      'la 1 canarias',
      'la 1 catalunya',
    ]);
    const catalunya = new Set([channelOf('la 1 catalunya')]);
    expect(searchLabels('la 1', catalunya).slice(0, 3)).toEqual([
      'la 1',
      'la 1 catalunya',
      'la 1 canarias',
    ]);
    expect(browseLabels(browse, 'la 1', catalunya).slice(0, 3)).toEqual([
      'la 1',
      'la 1 catalunya',
      'la 1 canarias',
    ]);
  });

  it('«dazn» con DAZN F1 en favoritos: DAZN F1 delante de la familia DAZN 1-4', () => {
    const favorites = new Set([channelOf('dazn f1')]);
    expect(searchLabels('dazn', favorites)[0]).toBe('dazn f1');
    expect(browseLabels(browse, 'dazn', favorites)[0]).toBe('dazn f1');
  });
});

describe('la caché de nombres de un índice', () => {
  it('llena, no se vacía: una consulta amplia no obliga a recalcularlo todo en la siguiente', () => {
    const cache = new Map<string, ReturnType<typeof cachedKeyNames>>();
    for (let i = 0; i < NAME_CACHE_MAX; i += 1) cachedKeyNames(cache, `canal ${i}`);
    expect(cache.size).toBe(NAME_CACHE_MAX);
    const extra = cachedKeyNames(cache, 'canal extra');
    expect(extra[0]?.words).toEqual(['canal', 'extra']);
    expect(cache.size).toBe(NAME_CACHE_MAX);
    /* Lo guardado sigue ahí (antes se vaciaba entera al llegar al tope). */
    expect(cache.has('canal 0')).toBe(true);
    expect(cache.has('canal extra')).toBe(false);
  });
});

describe('packRankedHit ordena igual que compareRankedHits', () => {
  it('con 3 000 pares al azar (semilla fija) dentro de los topes', () => {
    let seed = 1234567;
    const random = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    const hit = (): RankedHit => ({
      rank: {
        tier: random(7),
        region: random(4) - 1,
        lead: random(2) === 0,
        favorite: random(3) === 0,
      },
      penalty: random(4),
      miss: random(3),
      familyLength: random(20),
      familyOrder: random(50),
      number: random(12),
      quality: random(5),
      keyLength: random(25),
      keyOrder: random(50),
      abroad: random(2),
      order: random(200),
    });
    const sign = (value: number): number => Math.sign(value);
    for (let i = 0; i < 3000; i += 1) {
      const a = hit();
      const b = hit();
      const [a1, a2] = packRankedHit(a);
      const [b1, b2] = packRankedHit(b);
      expect(sign(a1 - b1 || a2 - b2), JSON.stringify([a, b])).toBe(sign(compareRankedHits(a, b)));
    }
  });
});

describe('@lento rendimiento: 20 000 canales al teclear', () => {
  it('Buscar y la pestaña IPTV contestan cada tecla en menos de 50 ms (mediana)', () => {
    const big = catalogOf(corpusIptvGrande(20_000));
    const index = buildBrowseIndex(big);
    searchCatalog(big, 'calentar');
    const typed = [
      'l',
      'la',
      'la ',
      'la 1',
      'd',
      'da',
      'daz',
      'dazn',
      'dazn 1',
      'm+',
      'm+ la',
      'm+ laliga',
    ];
    const times: number[] = [];
    for (const q of typed) {
      if (q.trim().length < 2) continue;
      const start = performance.now();
      searchCatalog(big, q);
      index.cache.clear();
      browseIndex(index, { q, offset: 0, limit: 60, withSummary: true });
      times.push(performance.now() - start);
    }
    const sorted = [...times].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(50);
  });
});
