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
import { compareRankedHits, packRankedHit, searchCatalog, type RankedHit } from './search.js';

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
  it('cada forma de «La 1» (ES 4K, ES:, |ES|, ES►, ◉ ES:, #2, TVE…) es una sola fila', () => {
    expect(catalog.buckets('la 1').map((bucket) => bucket.bucket)).toEqual(['']);
    expect(catalog.group('la 1').length).toBeGreaterThanOrEqual(10);
    /* Ninguna clave con el país pegado («es la 1») ni la copia como número («la 1 2»). */
    const keys = [...catalog.groupKeys()];
    expect(keys.filter((key) => /^(?:es|esp|vip)\b/.test(key))).toEqual([]);
    expect(keys).not.toContain('la 1 2');
    expect(keys).not.toContain('la 1 tve');
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
