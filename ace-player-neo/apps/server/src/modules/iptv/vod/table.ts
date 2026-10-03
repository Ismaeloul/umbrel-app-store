/* Tabla compacta de Películas y series en memoria (docs/vod.md §4.5, D-VOD2).
   Pura.

   Una tabla por tipo (películas y series) con arrays paralelos en vez de un
   objeto por título: 170 000 títulos caben en ~31 MiB (medido). Los textos
   van unidos en una sola cadena con '\n' y sus desplazamientos:
   - `titles`: los títulos limpios;
   - `folded`: el mismo texto plegado (sin tildes y en minúsculas)
     CONSERVANDO la longitud, así que comparte `offsets` con `titles` y la
     posición de un acierto de `indexOf` da la fila por búsqueda binaria;
   - `compact`: plegado y sin separadores («spiderman» encuentra
     «Spider-Man»), con sus propios desplazamientos.

   Los carteles se guardan partidos en carpeta (internada: las 150 000 rutas
   de TMDB comparten una) y fichero. El `source` (stream_id / series_id)
   nunca sale del módulo: se busca por `bySource`.

   La tabla se monta al lado mientras llega la lista (streaming) y se cambia
   de golpe: la vieja sirve búsquedas mientras tanto. */

import { VOD_TAGS } from '@ace/shared';
import { CAT_NONE, RATING_NONE, type VodListRow } from './parse.js';

export const FLAG_ADULT = 1;
export const FLAG_POSTER = 2;
/** Carpetas de carteles internadas como mucho (`posterDir` es un Uint16 y 0 es «sin cartel»). */
export const POSTER_DIR_MAX = 0xfffe;
/** Centinela de `posterDir`: sin carpeta, el fichero lleva la URL entera (fallo 5). */
export const POSTER_DIR_WHOLE = 0xffff;

/** Filas por trozo al montar los índices (se cede el hilo entre trozos, §4.7). */
export const BUILD_CHUNK = 5_000;

export interface VodTableData {
  readonly n: number;
  readonly source: Float64Array;
  readonly bySource: Uint32Array;
  readonly cat: Uint16Array;
  readonly year: Uint16Array;
  readonly rating: Uint8Array;
  readonly added: Uint32Array;
  readonly ext: Uint8Array;
  readonly flags: Uint8Array;
  readonly tags: Uint8Array;
  /** Bits de `VOD_LANGS` (§4.10): los idiomas de cada fila (0 = no lo indica). */
  readonly langs: Uint16Array;
  readonly titles: string;
  readonly folded: string;
  readonly offsets: Uint32Array;
  readonly compact: string;
  readonly compactOffsets: Uint32Array;
  readonly posterDir: Uint16Array;
  readonly posterFiles: string;
  readonly posterOffsets: Uint32Array;
  readonly cats: readonly string[];
  readonly dirs: readonly string[];
  readonly byAdded: Uint32Array;
  /** Filas por categoría (en orden de `byAdded`); la última cubeta es «Sin categoría». */
  readonly byCatStart: Uint32Array;
  readonly byCatRows: Uint32Array;
}

// --- Plegado que conserva la longitud ---

const foldCache = new Map<number, string>();

/** Un carácter (unidad UTF-16) plegado: sin marcas y en minúsculas; si no mide 1, el mismo. */
function foldUnit(code: number): string {
  const cached = foldCache.get(code);
  if (cached !== undefined) return cached;
  const char = String.fromCharCode(code);
  let folded = char;
  if (code >= 0xd800 && code <= 0xdfff) folded = char;
  else {
    const candidate = char
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (candidate.length === 1) folded = candidate;
  }
  foldCache.set(code, folded);
  return folded;
}

/** Alguna unidad fuera de ASCII (sin la bandera `u`: también cada mitad de un par sustituto). */
const NON_ASCII = /[\u0080-\uffff]/;

/** Plegado carácter a carácter (el camino lento, para textos con «İ» y parecidos). */
function foldEachUnit(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out += code < 0x41 || (code > 0x5a && code < 0x80) ? text[index] : foldUnit(code);
  }
  return out;
}

/**
 * Plegado que conserva la longitud (§4.5): cada unidad UTF-16 da exactamente
 * una. Vale para un título o para todos los títulos unidos con '\n' (así se
 * rehace `folded` al cargar `vod.enc`) y sin una llamada por carácter:
 * `toLowerCase` de una vez (si no cambia la longitud, ninguna letra se ha
 * partido en dos) y solo lo que no es ASCII pasa por `foldUnit`.
 */
export function foldKeepLength(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return foldEachUnit(text);
  if (!NON_ASCII.test(lower)) return lower;
  return lower.replace(/[\u0080-\uffff]+/g, (run) => {
    let out = '';
    for (let index = 0; index < run.length; index += 1) out += foldUnit(run.charCodeAt(index));
    return out;
  });
}

const COMPACT_DROP = /[^\p{L}\p{N}]+/gu;

/** Plegado y sin separadores («Spider-Man» → «spiderman»). */
export function compactOf(folded: string): string {
  return folded.replace(COMPACT_DROP, '');
}

// --- Construcción ---

class Grow<T extends Uint8Array | Uint16Array | Uint32Array | Float64Array> {
  array: T;
  length = 0;
  constructor(private readonly make: (size: number) => T) {
    this.array = make(1024);
  }
  push(value: number): void {
    if (this.length === this.array.length) {
      const next = this.make(this.array.length * 2);
      next.set(this.array);
      this.array = next;
    }
    this.array[this.length] = value;
    this.length += 1;
  }
  done(): T {
    return this.array.slice(0, this.length) as T;
  }
}

/** Cede el hilo (entre trozos de 5 000 filas, §4.7); con `signal` abortada, lanza su motivo al volver. */
export async function yieldThread(signal?: AbortSignal): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  if (signal?.aborted) throw signal.reason;
}

/**
 * Monta una `VodTable` fila a fila (desde el callback del troceador: nunca se
 * guarda el objeto parseado). `categoryOrder` son los nombres en el orden del
 * panel; las que aparezcan sin estar ahí se añaden al final.
 */
export class VodTableBuilder {
  private readonly source = new Grow((n) => new Float64Array(n));
  private readonly cat = new Grow((n) => new Uint16Array(n));
  private readonly year = new Grow((n) => new Uint16Array(n));
  private readonly rating = new Grow((n) => new Uint8Array(n));
  private readonly added = new Grow((n) => new Uint32Array(n));
  private readonly ext = new Grow((n) => new Uint8Array(n));
  private readonly flags = new Grow((n) => new Uint8Array(n));
  private readonly tags = new Grow((n) => new Uint8Array(n));
  private readonly langs = new Grow((n) => new Uint16Array(n));
  private readonly posterDir = new Grow((n) => new Uint16Array(n));
  /* Textos por trozos de 5 000 filas: cada trozo se une en una cadena en
     cuanto se llena, así no quedan 170 000 cadenas pequeñas vivas (§4.5). */
  private readonly texts = {
    titles: new ChunkedText(),
    folded: new ChunkedText(),
    compact: new ChunkedText(),
    posters: new ChunkedText(),
  };
  private readonly catIndex = new Map<string, number>();
  private readonly cats: string[] = [];
  private readonly dirIndex = new Map<string, number>();
  private readonly dirs: string[] = [];
  private readonly seen = new Set<number>();
  /** Filas repetidas (mismo id): se quedan con la primera y cuentan como saltadas. */
  duplicates = 0;

  constructor(
    readonly max: number,
    categoryOrder: readonly string[] = [],
  ) {
    for (const name of categoryOrder) this.categoryOf(name);
  }

  get size(): number {
    return this.source.length;
  }

  get full(): boolean {
    return this.size >= this.max;
  }

  private categoryOf(name: string): number {
    if (!name) return CAT_NONE;
    const known = this.catIndex.get(name);
    if (known !== undefined) return known;
    /* 65 535 categorías como mucho (la última cubeta es «Sin categoría»). */
    if (this.cats.length >= CAT_NONE - 1) return CAT_NONE;
    const index = this.cats.length;
    this.cats.push(name);
    this.catIndex.set(name, index);
    return index;
  }

  private dirOf(dir: string): number {
    const known = this.dirIndex.get(dir);
    if (known !== undefined) return known + 1;
    /* Tabla de carpetas llena (un panel con una carpeta por título): la fila
       guarda la URL entera con el centinela «sin carpeta» (fallo 5). Antes
       perdía el cartel a partir del título 65 534, sin aviso. */
    if (this.dirs.length >= POSTER_DIR_MAX) return POSTER_DIR_WHOLE;
    this.dirs.push(dir);
    this.dirIndex.set(dir, this.dirs.length - 1);
    return this.dirs.length;
  }

  /**
   * Una fila del catálogo anterior (modo por categorías: lo que no se ha
   * podido leer se queda como estaba). Si el id ya está, se deja la nueva
   * sin contarla como repetida.
   */
  carry(row: VodListRow): boolean {
    if (this.seen.has(row.source)) return false;
    return this.add(row);
  }

  /** Añade una fila. false si la tabla ya está llena (quien llama corta la descarga) o el id se repite. */
  add(row: VodListRow): boolean {
    if (this.full) return false;
    if (this.seen.has(row.source)) {
      this.duplicates += 1;
      return false;
    }
    this.seen.add(row.source);
    this.source.push(row.source);
    this.cat.push(this.categoryOf(row.category));
    this.year.push(row.year);
    this.rating.push(row.rating);
    this.added.push(row.added);
    this.ext.push(row.ext);
    let dir = 0;
    let file = '';
    if (row.poster) {
      const slash = row.poster.lastIndexOf('/');
      dir = this.dirOf(row.poster.slice(0, slash + 1));
      file = dir === POSTER_DIR_WHOLE ? row.poster : row.poster.slice(slash + 1);
    }
    this.flags.push((row.adult ? FLAG_ADULT : 0) | (dir ? FLAG_POSTER : 0));
    this.tags.push(row.tags);
    this.langs.push(row.langs ?? 0);
    this.posterDir.push(dir);
    const title = row.title.replace(/\n/g, ' ');
    const folded = foldKeepLength(title);
    this.texts.titles.push(title);
    this.texts.folded.push(folded);
    this.texts.compact.push(compactOf(folded));
    this.texts.posters.push(file.replace(/\n/g, ''));
    return true;
  }

  /**
   * Cierra la tabla: textos unidos e índices, cediendo el hilo por trozos.
   * Con `signal`, mira entre trozos si hay que soltar (la sincronización VOD
   * cede el cerrojo al directo y a la guía, fallo 8).
   */
  async build(signal?: AbortSignal): Promise<VodTable> {
    const n = this.size;
    const titles = this.texts.titles.done();
    const folded = this.texts.folded.done();
    const compact = this.texts.compact.done();
    const posters = this.texts.posters.done();
    const data = {
      n,
      source: this.source.done(),
      cat: this.cat.done(),
      year: this.year.done(),
      rating: this.rating.done(),
      added: this.added.done(),
      ext: this.ext.done(),
      flags: this.flags.done(),
      tags: this.tags.done(),
      langs: this.langs.done(),
      titles: titles.text,
      folded: folded.text,
      offsets: titles.offsets,
      compact: compact.text,
      compactOffsets: compact.offsets,
      posterDir: this.posterDir.done(),
      posterFiles: posters.text,
      posterOffsets: posters.offsets,
      cats: [...this.cats],
      dirs: [...this.dirs],
    };
    await yieldThread(signal);
    const indexes = await buildIndexes(data, signal);
    return new VodTable({ ...data, ...indexes });
  }
}

/** Texto unido con '\n' que se monta por trozos, con sus desplazamientos (n + 1). */
export class ChunkedText {
  private readonly chunks: string[] = [];
  private current: string[] = [];
  private readonly offsets = new Grow((n) => new Uint32Array(n));
  private at = 0;

  push(text: string): void {
    this.offsets.push(this.at);
    this.at += text.length + 1;
    this.current.push(text);
    if (this.current.length >= BUILD_CHUNK) this.flush();
  }

  private flush(): void {
    if (!this.current.length) return;
    this.chunks.push(`${this.current.join('\n')}\n`);
    this.current = [];
  }

  done(): { text: string; offsets: Uint32Array } {
    this.flush();
    this.offsets.push(this.at);
    const text = this.chunks.join('');
    this.chunks.length = 0;
    return { text, offsets: this.offsets.done() };
  }
}

/** `bySource`, `byAdded` y `byCat` (§4.7: por trozos, cediendo el hilo). */
export async function buildIndexes(
  data: Pick<VodTableData, 'n' | 'source' | 'added' | 'cat' | 'cats' | 'offsets' | 'folded'>,
  signal?: AbortSignal,
): Promise<Pick<VodTableData, 'bySource' | 'byAdded' | 'byCatStart' | 'byCatRows'>> {
  const { n, source, added, cat } = data;
  const bySource = new Uint32Array(n);
  for (let row = 0; row < n; row += 1) bySource[row] = row;
  bySource.sort((a, b) => (source[a] as number) - (source[b] as number));
  await yieldThread(signal);
  const byAdded = new Uint32Array(n);
  for (let row = 0; row < n; row += 1) byAdded[row] = row;
  /* Más reciente primero; a igualdad, por el orden del panel. */
  byAdded.sort((a, b) => (added[b] as number) - (added[a] as number) || a - b);
  await yieldThread(signal);
  const buckets = data.cats.length + 1;
  const counts = new Uint32Array(buckets + 1);
  const bucketOf = (row: number): number => {
    const value = cat[row] as number;
    return value === CAT_NONE || value >= data.cats.length ? data.cats.length : value;
  };
  for (let row = 0; row < n; row += 1) {
    const index = bucketOf(row) + 1;
    counts[index] = (counts[index] as number) + 1;
  }
  const byCatStart = new Uint32Array(buckets + 1);
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    byCatStart[bucket + 1] = (byCatStart[bucket] as number) + (counts[bucket + 1] as number);
  }
  const cursor = byCatStart.slice(0, buckets);
  const byCatRows = new Uint32Array(n);
  for (let index = 0; index < n; index += 1) {
    const row = byAdded[index] as number;
    const bucket = bucketOf(row);
    byCatRows[cursor[bucket] as number] = row;
    cursor[bucket] = (cursor[bucket] as number) + 1;
    if (index % BUILD_CHUNK === BUILD_CHUNK - 1) await yieldThread(signal);
  }
  return { bySource, byAdded, byCatStart, byCatRows };
}

/**
 * `compact` y sus desplazamientos a partir de `folded` (se guardan en
 * memoria pero no en `vod.enc`: se rehacen al cargar).
 */
export function compactColumn(
  folded: string,
  offsets: Uint32Array,
  n: number,
): { text: string; offsets: Uint32Array } {
  const out = new ChunkedText();
  for (let row = 0; row < n; row += 1) {
    out.push(compactOf(folded.slice(offsets[row], (offsets[row + 1] as number) - 1)));
  }
  return out.done();
}

/**
 * Busca la fila cuyo texto empieza en o antes de `position` (desplazamientos
 * crecientes). Con `from` (una fila que empieza en o antes de `position`),
 * avanza a saltos desde ella: los aciertos de `indexOf` van en orden y suelen
 * estar cerca unos de otros.
 */
export function rowAt(offsets: Uint32Array, n: number, position: number, from = 0): number {
  let low = from;
  let high = n - 1;
  for (let step = 1; low + step < n && (offsets[low + step] as number) <= position; step *= 2) {
    low += step;
  }
  if (low + 1 < n && (offsets[low + 1] as number) > position) return low;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] as number) <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}

export class VodTable implements VodTableData {
  readonly n: number;
  readonly source: Float64Array;
  readonly bySource: Uint32Array;
  readonly cat: Uint16Array;
  readonly year: Uint16Array;
  readonly rating: Uint8Array;
  readonly added: Uint32Array;
  readonly ext: Uint8Array;
  readonly flags: Uint8Array;
  readonly tags: Uint8Array;
  readonly langs: Uint16Array;
  readonly titles: string;
  readonly folded: string;
  readonly offsets: Uint32Array;
  readonly compact: string;
  readonly compactOffsets: Uint32Array;
  readonly posterDir: Uint16Array;
  readonly posterFiles: string;
  readonly posterOffsets: Uint32Array;
  readonly cats: readonly string[];
  readonly dirs: readonly string[];
  readonly byAdded: Uint32Array;
  readonly byCatStart: Uint32Array;
  readonly byCatRows: Uint32Array;
  /** A-Z, perezoso (133 ms la primera vez con 150 000, medido). */
  private byTitleCache: Uint32Array | null = null;

  constructor(data: VodTableData) {
    this.n = data.n;
    this.source = data.source;
    this.bySource = data.bySource;
    this.cat = data.cat;
    this.year = data.year;
    this.rating = data.rating;
    this.added = data.added;
    this.ext = data.ext;
    this.flags = data.flags;
    this.tags = data.tags;
    this.langs = data.langs;
    this.titles = data.titles;
    this.folded = data.folded;
    this.offsets = data.offsets;
    this.compact = data.compact;
    this.compactOffsets = data.compactOffsets;
    this.posterDir = data.posterDir;
    this.posterFiles = data.posterFiles;
    this.posterOffsets = data.posterOffsets;
    this.cats = data.cats;
    this.dirs = data.dirs;
    this.byAdded = data.byAdded;
    this.byCatStart = data.byCatStart;
    this.byCatRows = data.byCatRows;
  }

  /** Tabla vacía (sin VOD). */
  static empty(): VodTable {
    return new VodTable({
      n: 0,
      source: new Float64Array(0),
      bySource: new Uint32Array(0),
      cat: new Uint16Array(0),
      year: new Uint16Array(0),
      rating: new Uint8Array(0),
      added: new Uint32Array(0),
      ext: new Uint8Array(0),
      flags: new Uint8Array(0),
      tags: new Uint8Array(0),
      langs: new Uint16Array(0),
      titles: '',
      folded: '',
      offsets: new Uint32Array(1),
      compact: '',
      compactOffsets: new Uint32Array(1),
      posterDir: new Uint16Array(0),
      posterFiles: '',
      posterOffsets: new Uint32Array(1),
      cats: [],
      dirs: [],
      byAdded: new Uint32Array(0),
      byCatStart: new Uint32Array(2),
      byCatRows: new Uint32Array(0),
    });
  }

  /** Título limpio de una fila. */
  title(row: number): string {
    return this.titles.slice(this.offsets[row], (this.offsets[row + 1] as number) - 1);
  }

  foldedTitle(row: number): string {
    return this.folded.slice(this.offsets[row], (this.offsets[row + 1] as number) - 1);
  }

  /** Fila de un `source`, o -1 (búsqueda binaria en `bySource`). */
  rowOf(source: number): number {
    let low = 0;
    let high = this.n - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const row = this.bySource[mid] as number;
      const value = this.source[row] as number;
      if (value === source) return row;
      if (value < source) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  }

  /** URL del cartel de una fila, o null (nunca sale del módulo). */
  posterUrl(row: number): string | null {
    const dir = this.posterDir[row] as number;
    if (!dir) return null;
    const file = this.posterFiles.slice(
      this.posterOffsets[row],
      (this.posterOffsets[row + 1] as number) - 1,
    );
    if (dir === POSTER_DIR_WHOLE) return file || null;
    const base = this.dirs[dir - 1];
    if (base === undefined) return null;
    return `${base}${file}`;
  }

  isAdult(row: number): boolean {
    return ((this.flags[row] as number) & FLAG_ADULT) !== 0;
  }

  /** Nombre de la categoría de una fila ('' = «Sin categoría»). */
  categoryName(row: number): string {
    const value = this.cat[row] as number;
    return value === CAT_NONE ? '' : (this.cats[value] ?? '');
  }

  yearOf(row: number): number | null {
    const value = this.year[row] as number;
    return value ? value : null;
  }

  ratingOf(row: number): number | null {
    const value = this.rating[row] as number;
    return value === RATING_NONE ? null : value / 10;
  }

  /** Cubeta de `byCat` de una categoría (índice en `cats`, o `cats.length` para «Sin categoría»). */
  categoryRows(bucket: number): Uint32Array {
    return this.byCatRows.subarray(this.byCatStart[bucket], this.byCatStart[bucket + 1]);
  }

  /** Orden A-Z plegado, perezoso. */
  byTitle(): Uint32Array {
    if (this.byTitleCache) return this.byTitleCache;
    const rows = new Uint32Array(this.n);
    for (let row = 0; row < this.n; row += 1) rows[row] = row;
    const keys = new Array<string>(this.n);
    for (let row = 0; row < this.n; row += 1) keys[row] = this.foldedTitle(row);
    rows.sort((a, b) => {
      const ka = keys[a] as string;
      const kb = keys[b] as string;
      return ka < kb ? -1 : ka > kb ? 1 : a - b;
    });
    this.byTitleCache = rows;
    return rows;
  }
}

/** La fila `row` de una tabla tal y como llegó de la lista (para pasarla a otra tabla). */
export function tableRow(table: VodTable, row: number): VodListRow {
  return {
    source: table.source[row] as number,
    title: table.title(row),
    year: table.year[row] as number,
    rating: table.rating[row] as number,
    added: table.added[row] as number,
    ext: table.ext[row] as number,
    adult: table.isAdult(row),
    poster: table.posterUrl(row),
    tags: table.tags[row] as number,
    langs: table.langs[row] as number,
    category: table.categoryName(row),
  };
}

/** Cuántas filas de cada distintivo hay en `rows` (para los chips). */
export function countTags(
  table: VodTable,
  rows: Iterable<number>,
): Array<{ tag: (typeof VOD_TAGS)[number]; count: number }> {
  const counts = new Array<number>(VOD_TAGS.length).fill(0);
  for (const row of rows) {
    const bits = table.tags[row] as number;
    if (!bits) continue;
    for (let index = 0; index < VOD_TAGS.length; index += 1) {
      if (bits & (1 << index)) counts[index] = (counts[index] as number) + 1;
    }
  }
  return VOD_TAGS.map((tag, index) => ({ tag, count: counts[index] as number })).filter(
    (item) => item.count > 0,
  );
}
