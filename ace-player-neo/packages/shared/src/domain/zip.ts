/* Un .zip mínimo («Descargar logs», 0.9.0): sin dependencias, para que el
   servidor y la demo de la web monten el mismo fichero. Solo lo que hace
   falta: ficheros sueltos (sin carpetas), nombres en UTF-8, «almacenado»
   (método 0) o ya comprimido con deflate crudo (método 8: el servidor lo
   comprime con zlib, que corre fuera del hilo principal). Sin ZIP64: cada
   fichero y el total, por debajo de 4 GiB (el registro va acotado a decenas
   de MiB). Lo abren el Explorador de Windows, «Archivos» del iPhone, unzip y
   cualquier programa de zip. */

/* Tabla del CRC-32 (IEEE 802.3, polinomio invertido 0xEDB88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 de unos bytes; con `previous`, sigue el de los bytes de antes (por trozos). */
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let index = 0; index < data.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

export interface ZipEntry {
  /** Nombre dentro del zip (sin carpetas). */
  readonly name: string;
  /** Los bytes tal cual van en el zip: los originales (método 0) o el deflate crudo (método 8). */
  readonly data: Uint8Array;
  /** 0 = almacenado; 8 = deflate. */
  readonly method: 0 | 8;
  /** CRC-32 de los bytes SIN comprimir. */
  readonly crc32: number;
  /** Tamaño sin comprimir. */
  readonly size: number;
}

/** Un fichero almacenado tal cual (sin comprimir). */
export function storedEntry(name: string, data: Uint8Array): ZipEntry {
  return { name, data, method: 0, crc32: crc32(data), size: data.length };
}

/* Fecha y hora MS-DOS (sin zona: se usa la de Madrid, como el resto de la app). */
function dosDateTime(at: Date): { date: number; time: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const year = Math.min(2107, Math.max(1980, parts.year ?? 1980));
  return {
    date: ((year - 1980) << 9) | ((parts.month ?? 1) << 5) | (parts.day ?? 1),
    time:
      ((parts.hour ?? 0) << 11) | ((parts.minute ?? 0) << 5) | Math.floor((parts.second ?? 0) / 2),
  };
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;

/** Monta el zip con los ficheros en este orden. */
export function zipArchive(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(at);
  const names = entries.map((entry) => encoder.encode(entry.name));
  const localSize = entries.reduce(
    (sum, entry, index) => sum + 30 + (names[index]?.length ?? 0) + entry.data.length,
    0,
  );
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const offsets: number[] = [];

  entries.forEach((entry, index) => {
    const name = names[index] ?? new Uint8Array();
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, VERSION, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, entry.method, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, entry.crc32 >>> 0, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.size, true);
    view.setUint16(offset + 26, name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(name, offset + 30);
    out.set(entry.data, offset + 30 + name.length);
    offset += 30 + name.length + entry.data.length;
  });

  const centralStart = offset;
  entries.forEach((entry, index) => {
    const name = names[index] ?? new Uint8Array();
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, VERSION, true);
    view.setUint16(offset + 6, VERSION, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, entry.method, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, entry.crc32 >>> 0, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, name.length, true);
    // extra, comentario, disco, atributos internos y externos: 0
    view.setUint32(offset + 42, offsets[index] ?? 0, true);
    out.set(name, offset + 46);
    offset += 46 + name.length;
  });

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}
