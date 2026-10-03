/* @lento · Memoria y rendimiento del catálogo VOD (docs/vod.md §4.5, §9.13
   y §15.2): 150 000 películas y 30 000 series sintéticas por un transporte
   falso, troceadas en streaming.

   - crecimiento del pico VIVO < 100 MB durante la sincronización (se
     muestrea tras un GC cada 20 ms: sin él, `heapUsed` cuenta también la
     basura de la generación joven, que llega a decenas de MB);
   - RETENIDO < 45 MB tras GC (medido en el diseño: 31 MiB con 170 000);
   - p95 de la búsqueda < 25 ms (medido: 2-10 ms);
   - sincronización < 30 s;
   - carga en frío de `vod.enc` con un pico vivo < 40 MB (lo retenido incluido).

   El GC se pide con `--expose_gc` en caliente (v8 + vm), sin tocar la
   configuración de Vitest. «@lento» es la etiqueta: corre en la tanda normal. */

import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deriveIptvKeys } from '../../../config/keys.js';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import { loadVodCatalog, saveVodCatalog, syncVodCatalog, type VodCatalog } from './catalog.js';
import { parseVodQuery, searchTable } from './search.js';

const MOVIES = 150_000;
const SERIES = 30_000;
const HOST = 'grande.example';
const MB = 1024 * 1024;

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

const WORDS = [
  'amor',
  'guerra',
  'noche',
  'ciudad',
  'sombra',
  'río',
  'último',
  'viaje',
  'reino',
  'fuego',
  'hielo',
  'secreto',
  'mar',
  'camino',
  'sueño',
  'lluvia',
  'destino',
  'luz',
  'tiempo',
  'lobo',
  'Oppenheimer',
  'Matrix',
  'Spider-Man',
  'Amélie',
  'Dune',
  'Toy Story',
  'Up',
  'Coco',
  'Alien',
  'Rocky',
  'Titanic',
  'Gladiator',
  'Avatar',
  'Frozen',
  'Joker',
  'Parásitos',
  'Shrek',
  'Heat',
];
const ARTICLES = ['La', 'El', 'Los', 'Una', 'Mi', 'Operación', 'Regreso a', 'Misión'];
const PREFIXES = ['ES| ', '|LAT| ', '', '', 'EN - ', '4K - '];

/** Títulos variados como los de un panel: prefijos, artículos, sagas, números y años. */
function titleOf(i: number): string {
  const a = WORDS[i % WORDS.length] as string;
  const b = WORDS[(i * 7 + 3) % WORDS.length] as string;
  const article = ARTICLES[(i * 3) % ARTICLES.length] as string;
  const prefix = PREFIXES[i % PREFIXES.length] as string;
  const saga = i % 11 === 0 ? ` ${2 + (i % 4)}` : '';
  return `${prefix}${article} ${a} ${i % 3 ? 'y' : 'de'} ${b}${saga} ${i} (${1950 + (i % 75)})${i % 9 === 0 ? ' 4K' : ''}`;
}

function* listJson(kind: 'movie' | 'series', n: number): Generator<Buffer> {
  yield Buffer.from('[');
  let batch: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const title = titleOf(i);
    const item =
      kind === 'movie'
        ? {
            num: i + 1,
            name: title,
            stream_type: 'movie',
            stream_id: i + 1,
            stream_icon: `https://image.tmdb.org/t/p/w600_and_h900_bestv2/p${i.toString(36)}abcdefghijk.jpg`,
            rating: String((i % 90) / 10),
            rating_5based: (i % 90) / 20,
            added: String(1_600_000_000 + i),
            is_adult: 0,
            category_id: String(i % 120),
            container_extension: i % 2 ? 'mkv' : 'mp4',
            custom_sid: '',
            direct_source: '',
          }
        : {
            num: i + 1,
            name: title,
            series_id: i + 1,
            cover: `https://image.tmdb.org/t/p/w600_and_h900_bestv2/s${i.toString(36)}abcdefghijk.jpg`,
            plot: 'Una sinopsis de la lista que se tira al sincronizar. '.repeat(4),
            cast: 'Actriz Uno, Actor Dos, Actriz Tres',
            director: 'Directora',
            genre: 'Drama',
            releaseDate: '2010-01-01',
            last_modified: String(1_650_000_000 + i),
            rating: '7.5',
            category_id: String(i % 40),
            backdrop_path: ['https://image.tmdb.org/t/p/w1280/fondo.jpg'],
          };
    batch.push(JSON.stringify(item));
    if (batch.length === 1_000) {
      yield Buffer.from(`${i < 1_000 ? '' : ','}${batch.join(',')}`);
      batch = [];
    }
  }
  if (batch.length) yield Buffer.from(`${n <= batch.length ? '' : ','}${batch.join(',')}`);
  yield Buffer.from(']');
}

const categories = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      category_id: String(i),
      category_name: `Categoría ${i}`,
    })),
  );

function used(): number {
  const memory = process.memoryUsage();
  return memory.heapUsed + memory.arrayBuffers;
}

describe('@lento memoria del catálogo VOD', () => {
  it('150 000 películas + 30 000 series: pico, retenido, búsqueda, tiempo y carga en frío', async () => {
    const core = createTestCore();
    const transport = fakeTransport((request) => {
      const action = request.url.searchParams.get('action');
      if (action === 'get_vod_categories') return { body: categories(120) };
      if (action === 'get_series_categories') return { body: categories(40) };
      if (action === 'get_vod_streams') return { body: Readable.from(listJson('movie', MOVIES)) };
      if (action === 'get_series') return { body: Readable.from(listJson('series', SERIES)) };
      return { status: 404 };
    });
    const net = createNetClient({
      ...core,
      resolver: tableResolver({ [HOST]: [{ address: '93.184.216.34', family: 4 }] }),
      transport,
    });
    gc();
    const baseline = used();
    let peak = baseline;
    const sampler = setInterval(() => {
      gc();
      peak = Math.max(peak, used());
    }, 20);
    const startedAt = performance.now();
    let catalog: VodCatalog | null = null;
    try {
      const result = await syncVodCatalog(
        {
          net,
          clock: core.clock,
          logger: core.logger,
          credentials: { server: `http://${HOST}`, username: 'usuario', password: 'clave-larga' },
          policy: { lan: false },
          signal: new AbortController().signal,
        },
        { providerId: 'p_grande01', providerFp: '0123456789abcdef', revision: 1, mode: 'completo' },
      );
      if (result.state === 'ready') catalog = result.catalog;
    } finally {
      clearInterval(sampler);
    }
    const syncMs = performance.now() - startedAt;
    peak = Math.max(peak, used());
    expect(catalog?.tables.movie.n).toBe(MOVIES);
    expect(catalog?.tables.series.n).toBe(SERIES);
    gc();
    const retainedMb = (used() - baseline) / MB;
    const peakMb = (peak - baseline) / MB;

    /* Búsqueda: p95 sobre consultas variadas, sin la caché. De cada consulta
       cuenta la mediana de 5 (la máquina de pruebas comparte CPU). */
    const p95 = ((table) => {
      const medians: number[] = [];
      for (const q of [
        'la',
        'amor',
        'matrix',
        'spiderman',
        'dune 2021',
        'toy story',
        'parasitos',
        'regreso a',
        'xyz',
        'rio',
      ]) {
        const runs: number[] = [];
        for (let round = 0; round < 5; round += 1) {
          const t0 = performance.now();
          searchTable(table, parseVodQuery(q), null);
          runs.push(performance.now() - t0);
        }
        runs.sort((a, b) => a - b);
        medians.push(runs[2] as number);
      }
      medians.sort((a, b) => a - b);
      return medians[Math.min(medians.length - 1, Math.floor(medians.length * 0.95))] as number;
    })((catalog as VodCatalog).tables.movie);

    /* Carga en frío de vod.enc. */
    const keys = deriveIptvKeys('semilla-de-prueba-0123456789');
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'vod-lento-')), 'vod.enc');
    await saveVodCatalog(file, keys, catalog as VodCatalog);
    catalog = null;
    gc();
    const loadBase = used();
    let loadPeak = loadBase;
    const loadSampler = setInterval(() => {
      gc();
      loadPeak = Math.max(loadPeak, used());
    }, 10);
    const loaded = await loadVodCatalog(file, keys, 'p_grande01', '0123456789abcdef', core.logger);
    clearInterval(loadSampler);
    loadPeak = Math.max(loadPeak, used());
    expect(loaded?.tables.movie.n).toBe(MOVIES);
    /* El pico VIVO de la carga, con lo que queda retenido dentro (se muestrea
       tras un GC en cada paso asíncrono: descifrar, descomprimir, leer y
       rehacer `folded` y `compact`). */
    const loadPeakMb = (loadPeak - loadBase) / MB;

    const report =
      `[vod @lento] sync ${Math.round(syncMs)} ms · pico +${peakMb.toFixed(1)} MB · retenido ${retainedMb.toFixed(1)} MB · ` +
      `p95 búsqueda ${p95.toFixed(1)} ms · carga en frío +${loadPeakMb.toFixed(1)} MB`;
    /* Con VOD_LENTO_INFORME=<fichero>, los números van ahí (Vitest calla la consola si todo pasa). */
    if (process.env.VOD_LENTO_INFORME) appendFileSync(process.env.VOD_LENTO_INFORME, `${report}\n`);
    expect(syncMs).toBeLessThan(30_000);
    expect(peakMb).toBeLessThan(100);
    expect(retainedMb).toBeLessThan(45);
    expect(p95).toBeLessThan(25);
    expect(loadPeakMb).toBeLessThan(40);
  }, 120_000);
});
