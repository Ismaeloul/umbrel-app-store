/* @lento · Memoria y rendimiento del catálogo VOD (docs/vod.md §4.5, §9.13
   y §15.2): 150 000 películas y 30 000 series sintéticas por un transporte
   falso, troceadas en streaming.

   - crecimiento del pico VIVO < 100 MB durante la sincronización (se
     muestrea tras un GC cada 20 ms: sin él, `heapUsed` cuenta también la
     basura de la generación joven, que llega a decenas de MB);
   - RETENIDO < 45 MB tras GC (medido en el diseño: 31 MiB con 170 000);
   - p95 de la búsqueda < 25 ms (medido: 2-10 ms);
   - sincronización < 30 s;
   - carga en frío de `vod.enc`, medida en un PROCESO APARTE (fallo 6 de
     docs/vod-estado.md §4.1): pico vivo < 48 MB con lo retenido incluido
     (medido en el PC de Isma, Node 24: 37-40 MB de pico y 22 MB retenidos,
     en ~270 ms; el diseño estimaba < 40 MB sin poder medirlo).

   El GC se pide con `--expose_gc` en caliente (v8 + vm), sin tocar la
   configuración de Vitest. «@lento» es la etiqueta: corre en la tanda normal. */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { deriveIptvKeys } from '../../../config/keys.js';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import { saveVodCatalog, syncVodCatalog, type VodCatalog } from './catalog.js';
import { parseVodQuery, searchTable } from './search.js';

const MOVIES = 150_000;
const SERIES = 30_000;
const HOST = 'grande.example';
const MB = 1024 * 1024;
const PROVIDER_ID = 'p_grande01';
const PROVIDER_FP = '0123456789abcdef';
const SEED = 'semilla-de-prueba-0123456789';
/** Pico vivo de la carga en frío, con lo retenido incluido (§15.2). */
const LOAD_PEAK_MAX_MB = 48;
const QUERIES = [
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
];

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

/** Sincroniza el catálogo grande por el transporte falso. */
async function syncBig(): Promise<VodCatalog> {
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
  const result = await syncVodCatalog(
    {
      net,
      clock: core.clock,
      logger: core.logger,
      credentials: { server: `http://${HOST}`, username: 'usuario', password: 'clave-larga' },
      policy: { lan: false },
      signal: new AbortController().signal,
    },
    { providerId: PROVIDER_ID, providerFp: PROVIDER_FP, revision: 1, mode: 'completo' },
  );
  if (result.state !== 'ready') throw new Error('el catálogo grande no ha salido');
  return result.catalog;
}

function report(line: string): void {
  /* Con VOD_LENTO_INFORME=<fichero>, los números van ahí (Vitest calla la consola si todo pasa). */
  if (process.env.VOD_LENTO_INFORME) appendFileSync(process.env.VOD_LENTO_INFORME, `${line}\n`);
}

/* El guion del proceso aparte: solo carga `vod.enc` y mide (un GC cada 5 ms,
   entre los pasos asíncronos de la carga). Se empaqueta con esbuild, como el
   motor falso en su prueba de la línea de órdenes. */
const LOADER = `
import { loadVodCatalog } from '__CATALOG__';
import { deriveIptvKeys } from '__KEYS__';
const [file, providerId, providerFp, seed] = process.argv.slice(2);
const MB = 1024 * 1024;
const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };
const keys = deriveIptvKeys(seed);
const logger = { warn() {}, info() {}, error() {}, debug() {} };
globalThis.gc(); globalThis.gc();
const base = used();
let peak = base;
const sampler = setInterval(() => { globalThis.gc(); peak = Math.max(peak, used()); }, 5);
const startedAt = performance.now();
const catalog = await loadVodCatalog(file, keys, providerId, providerFp, logger);
const ms = performance.now() - startedAt;
clearInterval(sampler);
peak = Math.max(peak, used());
globalThis.gc();
const retained = used() - base;
process.stdout.write(JSON.stringify({
  movies: catalog ? catalog.tables.movie.n : -1,
  ms,
  peakMb: (peak - base) / MB,
  retainedMb: retained / MB,
}));
`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const asImport = (file: string): string => file.split(path.sep).join('/');

describe('@lento memoria del catálogo VOD', () => {
  it('150 000 películas + 30 000 series: pico, retenido, búsqueda y tiempo de la sincronización', async () => {
    gc();
    const baseline = used();
    let peak = baseline;
    const sampler = setInterval(() => {
      gc();
      peak = Math.max(peak, used());
    }, 20);
    const startedAt = performance.now();
    let catalog: VodCatalog;
    try {
      catalog = await syncBig();
    } finally {
      clearInterval(sampler);
    }
    const syncMs = performance.now() - startedAt;
    peak = Math.max(peak, used());
    expect(catalog.tables.movie.n).toBe(MOVIES);
    expect(catalog.tables.series.n).toBe(SERIES);
    gc();
    const retainedMb = (used() - baseline) / MB;
    const peakMb = (peak - baseline) / MB;

    /* Búsqueda: p95 sobre consultas variadas, sin la caché. De cada consulta
       cuenta la mediana de 5 (la máquina de pruebas comparte CPU). */
    const table = catalog.tables.movie;
    const medians: number[] = [];
    for (const q of QUERIES) {
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
    const p95 = medians[Math.min(medians.length - 1, Math.floor(medians.length * 0.95))] as number;

    report(
      `[vod @lento] sync ${Math.round(syncMs)} ms · pico +${peakMb.toFixed(1)} MB · ` +
        `retenido ${retainedMb.toFixed(1)} MB · p95 búsqueda ${p95.toFixed(1)} ms`,
    );
    expect(syncMs).toBeLessThan(30_000);
    expect(peakMb).toBeLessThan(100);
    expect(retainedMb).toBeLessThan(45);
    expect(p95).toBeLessThan(25);
  }, 120_000);

  /* La carga en frío se mide en un PROCESO APARTE (fallo 6): dentro del de
     Vitest, con el catálogo de la sincronización recién soltado, la medida
     salía «+0,0 MB» o 60 MB según cuándo pasara el GC. Aquí el proceso solo
     tiene el guion: lo que crece es la carga. */
  it('carga en frío de vod.enc en un proceso aparte: pico vivo y retenido', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vod-lento-'));
    try {
      const keys = deriveIptvKeys(SEED);
      const file = path.join(dir, 'vod.enc');
      await saveVodCatalog(file, keys, await syncBig());
      const entry = path.join(dir, 'carga.ts');
      writeFileSync(
        entry,
        LOADER.replace('__CATALOG__', asImport(path.join(HERE, 'catalog.ts'))).replace(
          '__KEYS__',
          asImport(path.join(HERE, '../../../config/keys.ts')),
        ),
      );
      const outfile = path.join(dir, 'carga.mjs');
      await build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'esm',
        banner: {
          js: 'import { createRequire as __aceCreateRequire } from "node:module"; const require = __aceCreateRequire(import.meta.url);',
        },
        logLevel: 'silent',
      });
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--expose-gc', outfile, file, PROVIDER_ID, PROVIDER_FP, SEED],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(stdout) : reject(new Error(`carga: código ${code} ${stderr}`)),
        );
      });
      const measured = JSON.parse(out) as {
        movies: number;
        ms: number;
        peakMb: number;
        retainedMb: number;
      };
      report(
        `[vod @lento] carga en frío ${Math.round(measured.ms)} ms · pico +${measured.peakMb.toFixed(1)} MB · ` +
          `retenido ${measured.retainedMb.toFixed(1)} MB`,
      );
      expect(measured.movies).toBe(MOVIES);
      /* Un número creíble: al menos lo retenido (las tablas ocupan memoria de verdad)… */
      expect(measured.retainedMb).toBeGreaterThan(10);
      expect(measured.peakMb).toBeGreaterThanOrEqual(measured.retainedMb);
      /* …y dentro del presupuesto de §15.2 (pico vivo, lo retenido incluido). */
      expect(measured.retainedMb).toBeLessThan(45);
      expect(measured.peakMb).toBeLessThan(LOAD_PEAK_MAX_MB);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
