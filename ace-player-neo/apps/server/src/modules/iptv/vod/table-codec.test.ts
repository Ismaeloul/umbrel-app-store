/* `vod.enc` binario (docs/vod.md §4.6 y §15.1): ida y vuelta, AAD de otro
   proveedor, fichero corrupto y sin `JSON.parse` de filas al cargar. */

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveIptvKeys } from '../../../config/keys.js';
import { createSilentLogger } from '../../../core/logger.js';
import { loadVodCatalog, makeVodCatalog, saveVodCatalog } from './catalog.js';
import {
  completeVodTables,
  decodeVodCatalog,
  encodeVodCatalog,
  type VodCatalogMeta,
} from './table-codec.js';
import { listRow, tableOf } from './test-support.js';

const KEYS = deriveIptvKeys('semilla-de-prueba-0123456789');
const META: VodCatalogMeta = {
  providerFp: '0123456789abcdef',
  revision: 3,
  builtAt: 1_760_000_000_000,
  truncated: true,
  skipped: 4,
  mode: 'por_categorias',
};

async function sample() {
  const movie = await tableOf(
    [
      listRow(12_345_678_901, 'Oppenheimer', {
        year: 2023,
        rating: 83,
        added: 500,
        ext: 2,
        tags: 17,
        category: 'ES',
        poster: 'https://img.example/p/o.jpg',
      }),
      listRow(2, 'Amélie', { added: 400, adult: true, category: 'XXX' }),
      listRow(3, '東京物語 😀', { added: 300 }),
    ],
    ['ES', 'XXX'],
  );
  const series = await tableOf([
    listRow(9, 'The Office', { added: 700, poster: 'https://img.example/s/1.jpg' }),
  ]);
  return { movie, series };
}

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
});

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vod-enc-'));
  dirs.push(dir);
  return path.join(dir, 'iptv', 'vod.enc');
}

describe('table-codec', () => {
  it('ida y vuelta binaria idéntica, sin JSON.parse de filas', async () => {
    const tables = await sample();
    const bytes = Buffer.concat(encodeVodCatalog(META, tables));
    const parse = vi.spyOn(JSON, 'parse');
    const raw = decodeVodCatalog(bytes);
    /* Solo la cabecera. */
    expect(parse).toHaveBeenCalledTimes(1);
    expect(raw.meta).toEqual(META);
    const decoded = { tables: await completeVodTables(raw.raw) };
    for (const kind of ['movie', 'series'] as const) {
      const a = tables[kind];
      const b = decoded.tables[kind];
      expect(b.n).toBe(a.n);
      expect(b.titles).toBe(a.titles);
      expect(b.folded).toBe(a.folded);
      expect(b.compact).toBe(a.compact);
      expect(b.cats).toEqual(a.cats);
      expect(b.dirs).toEqual(a.dirs);
      expect([...b.source]).toEqual([...a.source]);
      expect([...b.byAdded]).toEqual([...a.byAdded]);
      expect([...b.byCatStart]).toEqual([...a.byCatStart]);
      expect([...b.tags]).toEqual([...a.tags]);
    }
    expect(decoded.tables.movie.rowOf(12_345_678_901)).toBe(0);
    expect(decoded.tables.movie.posterUrl(0)).toBe('https://img.example/p/o.jpg');
    expect(decoded.tables.movie.title(2)).toBe('東京物語 😀');
  });

  it('otra versión o longitudes que no cuadran: lanza', async () => {
    const bytes = Buffer.concat(encodeVodCatalog(META, await sample()));
    expect(() => decodeVodCatalog(bytes.subarray(0, bytes.length - 40))).toThrow();
    const other = Buffer.from(bytes);
    other.write('ACEVOD09', 0, 'ascii');
    expect(() => decodeVodCatalog(other)).toThrow();
    expect(() => decodeVodCatalog(Buffer.from('basura'))).toThrow();
  });

  it('vod.enc sellado: sin textos en claro, AAD de otro proveedor rechazado y fichero corrupto borrado', async () => {
    const file = tempFile();
    const catalog = makeVodCatalog('p_Ab3dE5gH', META, await sample());
    await saveVodCatalog(file, KEYS, catalog);
    const raw = readFileSync(file);
    expect(raw.toString('latin1')).not.toContain('Oppenheimer');
    expect(raw.toString('latin1')).not.toContain('img.example');
    const logger = createSilentLogger();
    const loaded = await loadVodCatalog(file, KEYS, 'p_Ab3dE5gH', META.providerFp, logger);
    expect(loaded?.tables.movie.title(0)).toBe('Oppenheimer');
    expect(loaded?.stamp).toBe(catalog.stamp);
    /* Otra huella (otro proveedor en el mismo id): se descarta. */
    expect(await loadVodCatalog(file, KEYS, 'p_Ab3dE5gH', 'ffffffffffffffff', logger)).toBeNull();
    expect(existsSync(file)).toBe(false);
    /* AAD de otro proveedor. */
    await saveVodCatalog(file, KEYS, catalog);
    expect(await loadVodCatalog(file, KEYS, 'p_otro0000', META.providerFp, logger)).toBeNull();
    expect(existsSync(file)).toBe(false);
    /* Corrupto. */
    await saveVodCatalog(file, KEYS, catalog);
    const broken = readFileSync(file);
    broken[broken.length - 5] = (broken[broken.length - 5] as number) ^ 0xff;
    writeFileSync(file, broken);
    expect(await loadVodCatalog(file, KEYS, 'p_Ab3dE5gH', META.providerFp, logger)).toBeNull();
    expect(existsSync(file)).toBe(false);
    /* Sin fichero. */
    expect(await loadVodCatalog(file, KEYS, 'p_Ab3dE5gH', META.providerFp, logger)).toBeNull();
  });
});
