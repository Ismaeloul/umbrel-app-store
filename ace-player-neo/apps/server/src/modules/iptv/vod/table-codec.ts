/* `VodTable` ↔ bytes para `v2/iptv/vod.enc` (docs/vod.md §4.6, T15). Puro.

   Forma (antes de sellar con `sealBlobBytes`):

     'ACEVOD01' · uint32 LE (bytes de la cabecera) · cabecera JSON · relleno
     a 8 · arrays tipados y textos UTF-8, cada uno alineado a 8 bytes

   La cabecera es pequeña: versión, huella del proveedor, revisión, fecha,
   números, modo y, por tabla, sus categorías, carpetas de carteles y el
   `layout` (nombre, tipo, desplazamiento y longitud de cada array). Al
   cargar solo se hace `JSON.parse` de la cabecera: los arrays se copian
   alineados y los textos se decodifican de una vez. Nada de JSON por fila.

   `folded` y `compact` no se guardan: salen de `titles` al cargar (el
   plegado conserva la longitud y comparte `offsets`). Así el fichero
   descomprimido mide la mitad y el pico de la carga baja (§4.6).

   Cualquier incoherencia (otra versión, longitudes que no cuadran, textos
   que no miden lo que dicen sus desplazamientos) lanza: quien carga descarta
   el fichero y sincroniza otra vez. */

import { VOD_KINDS, type VodKind } from '@ace/shared';
import {
  compactColumn,
  foldKeepLength,
  VodTable,
  yieldThread,
  type VodTableData,
} from './table.js';

const MAGIC = Buffer.from('ACEVOD01', 'ascii');
export const VOD_CODEC_VERSION = 1;
/** Tope de la cabecera (categorías y carpetas): nunca debería pasar de unos cientos de KiB. */
const HEADER_MAX = 8 * 1024 * 1024;

export type VodSyncMode = 'completo' | 'por_categorias';

/** Lo que va en la cabecera además de las tablas. */
export interface VodCatalogMeta {
  readonly providerFp: string;
  readonly revision: number;
  /** ms Unix. */
  readonly builtAt: number;
  readonly truncated: boolean;
  readonly skipped: number;
  readonly mode: VodSyncMode;
}

type ArrayName =
  | 'source'
  | 'bySource'
  | 'cat'
  | 'year'
  | 'rating'
  | 'added'
  | 'ext'
  | 'flags'
  | 'tags'
  | 'offsets'
  | 'posterDir'
  | 'posterOffsets'
  | 'byAdded'
  | 'byCatStart'
  | 'byCatRows';
type TextName = 'titles' | 'posterFiles';

const ARRAYS: Readonly<Record<ArrayName, 'f64' | 'u32' | 'u16' | 'u8'>> = {
  source: 'f64',
  bySource: 'u32',
  cat: 'u16',
  year: 'u16',
  rating: 'u8',
  added: 'u32',
  ext: 'u8',
  flags: 'u8',
  tags: 'u8',
  offsets: 'u32',
  posterDir: 'u16',
  posterOffsets: 'u32',
  byAdded: 'u32',
  byCatStart: 'u32',
  byCatRows: 'u32',
};
const TEXTS: readonly TextName[] = ['titles', 'posterFiles'];

interface LayoutItem {
  readonly name: string;
  readonly type: 'f64' | 'u32' | 'u16' | 'u8' | 'utf8';
  readonly offset: number;
  readonly length: number;
}

interface TableHeader {
  readonly n: number;
  readonly cats: readonly string[];
  readonly dirs: readonly string[];
  readonly layout: readonly LayoutItem[];
}

interface Header extends VodCatalogMeta {
  readonly v: number;
  readonly counts: { readonly movies: number; readonly series: number };
  readonly tables: Readonly<Record<VodKind, TableHeader>>;
}

const pad8 = (value: number): number => (value + 7) & ~7;

function bytesOf(array: Float64Array | Uint32Array | Uint16Array | Uint8Array): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

/** Tablas → bytes (en trozos, sin copiar los arrays: `sealBlobBytes` los junta al comprimir). */
export function encodeVodCatalog(
  meta: VodCatalogMeta,
  tables: Readonly<Record<VodKind, VodTable>>,
): Buffer[] {
  const parts: Buffer[] = [];
  let at = 0;
  const layouts = {} as Record<VodKind, TableHeader>;
  const push = (buffer: Buffer): number => {
    const offset = at;
    parts.push(buffer);
    at += buffer.length;
    const padding = pad8(at) - at;
    if (padding) {
      parts.push(Buffer.alloc(padding));
      at += padding;
    }
    return offset;
  };
  for (const kind of VOD_KINDS) {
    const table = tables[kind];
    const layout: LayoutItem[] = [];
    for (const [name, type] of Object.entries(ARRAYS) as Array<[ArrayName, LayoutItem['type']]>) {
      const array = table[name];
      const offset = push(bytesOf(array));
      layout.push({ name, type, offset, length: array.length });
    }
    for (const name of TEXTS) {
      const bytes = Buffer.from(table[name], 'utf8');
      const offset = push(bytes);
      layout.push({ name, type: 'utf8', offset, length: bytes.length });
    }
    layouts[kind] = { n: table.n, cats: table.cats, dirs: table.dirs, layout };
  }
  const header: Header = {
    v: VOD_CODEC_VERSION,
    ...meta,
    counts: { movies: tables.movie.n, series: tables.series.n },
    tables: layouts,
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const lead = Buffer.alloc(MAGIC.length + 4);
  MAGIC.copy(lead, 0);
  lead.writeUInt32LE(json.length, MAGIC.length);
  const headLength = lead.length + json.length;
  const headPadding = Buffer.alloc(pad8(headLength) - headLength);
  return [lead, json, headPadding, ...parts];
}

function fail(reason: string): never {
  throw new Error(`vod.enc: ${reason}`);
}

function copyArray(
  body: Buffer,
  item: LayoutItem,
): Float64Array | Uint32Array | Uint16Array | Uint8Array {
  const size = { f64: 8, u32: 4, u16: 2, u8: 1, utf8: 1 }[item.type];
  const bytes = item.length * size;
  if (!Number.isInteger(item.offset) || item.offset < 0 || item.offset % 8 !== 0) fail('desplazamiento');
  if (!Number.isInteger(item.length) || item.length < 0 || item.offset + bytes > body.length) {
    fail('longitud');
  }
  /* Copia alineada: el Buffer de gunzip puede empezar en cualquier byte. */
  const copy = new ArrayBuffer(bytes);
  new Uint8Array(copy).set(body.subarray(item.offset, item.offset + bytes));
  switch (item.type) {
    case 'f64':
      return new Float64Array(copy);
    case 'u32':
      return new Uint32Array(copy);
    case 'u16':
      return new Uint16Array(copy);
    default:
      return new Uint8Array(copy);
  }
}

/** Una tabla recién leída: todo menos `folded` y `compact`, que se rehacen sin los bytes. */
export type RawVodTable = Omit<VodTableData, 'folded' | 'compact' | 'compactOffsets'>;

function decodeTable(body: Buffer, header: TableHeader): RawVodTable {
  if (!Number.isInteger(header.n) || header.n < 0) fail('n');
  if (!Array.isArray(header.cats) || !Array.isArray(header.dirs) || !Array.isArray(header.layout)) {
    fail('tabla');
  }
  const byName = new Map(header.layout.map((item) => [item.name, item]));
  const arrays = {} as Record<ArrayName, Float64Array | Uint32Array | Uint16Array | Uint8Array>;
  for (const [name, type] of Object.entries(ARRAYS) as Array<[ArrayName, LayoutItem['type']]>) {
    const item = byName.get(name);
    if (!item || item.type !== type) fail(`falta ${name}`);
    arrays[name] = copyArray(body, item);
  }
  const texts = {} as Record<TextName, string>;
  for (const name of TEXTS) {
    const item = byName.get(name);
    if (!item || item.type !== 'utf8') fail(`falta ${name}`);
    if (item.offset + item.length > body.length) fail('texto');
    texts[name] = body.toString('utf8', item.offset, item.offset + item.length);
  }
  const { n } = header;
  const perRow: ArrayName[] = ['source', 'bySource', 'cat', 'year', 'rating', 'added', 'ext'];
  for (const name of [...perRow, 'flags', 'tags', 'posterDir', 'byAdded', 'byCatRows'] as const) {
    if (arrays[name].length !== n) fail(`${name} no mide n`);
  }
  for (const name of ['offsets', 'posterOffsets'] as const) {
    if (arrays[name].length !== n + 1) fail(`${name} no mide n + 1`);
  }
  const offsets = arrays.offsets as Uint32Array;
  if (texts.titles.length !== offsets[n]) fail('títulos');
  if (texts.posterFiles.length !== (arrays.posterOffsets as Uint32Array)[n]) fail('carteles');
  if (arrays.byCatStart.length !== header.cats.length + 2) fail('byCat');
  return {
    n,
    source: arrays.source as Float64Array,
    bySource: arrays.bySource as Uint32Array,
    cat: arrays.cat as Uint16Array,
    year: arrays.year as Uint16Array,
    rating: arrays.rating as Uint8Array,
    added: arrays.added as Uint32Array,
    ext: arrays.ext as Uint8Array,
    flags: arrays.flags as Uint8Array,
    tags: arrays.tags as Uint8Array,
    offsets,
    posterDir: arrays.posterDir as Uint16Array,
    posterOffsets: arrays.posterOffsets as Uint32Array,
    byAdded: arrays.byAdded as Uint32Array,
    byCatStart: arrays.byCatStart as Uint32Array,
    byCatRows: arrays.byCatRows as Uint32Array,
    titles: texts.titles,
    posterFiles: texts.posterFiles,
    cats: header.cats.map((name) => String(name)),
    dirs: header.dirs.map((dir) => String(dir)),
  };
}

export interface DecodedVodCatalog {
  readonly meta: VodCatalogMeta;
  /** Sin `folded` ni `compact`: `completeVodTables` las termina (ya sin los bytes). */
  readonly raw: Readonly<Record<VodKind, RawVodTable>>;
}

/**
 * Termina las tablas leídas: `folded` (el plegado de todos los títulos de
 * una vez) y `compact`, cediendo el hilo entre pasos. Se llama cuando el
 * `Buffer` descomprimido ya se ha soltado, para que su pico no se sume.
 */
export async function completeVodTables(
  raw: Readonly<Record<VodKind, RawVodTable>>,
): Promise<Record<VodKind, VodTable>> {
  const out = {} as Record<VodKind, VodTable>;
  for (const kind of VOD_KINDS) {
    const table = raw[kind];
    await yieldThread();
    const folded = foldKeepLength(table.titles);
    await yieldThread();
    const compact = compactColumn(folded, table.offsets, table.n);
    out[kind] = new VodTable({ ...table, folded, compact: compact.text, compactOffsets: compact.offsets });
  }
  return out;
}

/** Bytes → tablas a medias (síncrono). Lanza si algo no cuadra (quien carga descarta el fichero). */
export function decodeVodCatalog(body: Buffer): DecodedVodCatalog {
  if (body.length < MAGIC.length + 4 || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail('cabecera');
  }
  const headerLength = body.readUInt32LE(MAGIC.length);
  const start = MAGIC.length + 4;
  if (headerLength > HEADER_MAX || start + headerLength > body.length) fail('cabecera larga');
  let header: Header;
  try {
    header = JSON.parse(body.toString('utf8', start, start + headerLength)) as Header;
  } catch {
    fail('cabecera ilegible');
  }
  if (!header || header.v !== VOD_CODEC_VERSION || !header.tables) fail('versión');
  if (typeof header.providerFp !== 'string' || !Number.isFinite(header.builtAt)) fail('meta');
  const data = body.subarray(pad8(start + headerLength));
  const raw = {
    movie: decodeTable(data, header.tables.movie),
    series: decodeTable(data, header.tables.series),
  };
  return {
    meta: {
      providerFp: header.providerFp,
      revision: Number(header.revision) || 0,
      builtAt: header.builtAt,
      truncated: Boolean(header.truncated),
      skipped: Number(header.skipped) || 0,
      mode: header.mode === 'por_categorias' ? 'por_categorias' : 'completo',
    },
    raw,
  };
}
