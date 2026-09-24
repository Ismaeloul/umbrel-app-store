/* Decodificador PNG mínimo y sin dependencias (informe de fase 2, §10.5):
   lo justo para sacar los colores de un escudo. Admite lo que TheSportsDB
   sirve (8 bits, RGB, RGBA, gris, gris+alfa y paleta con tRNS, sin
   entrelazado; la paleta y el gris también a 1, 2 y 4 bits). Cualquier otra
   cosa (16 bits, entrelazado Adam7, firma o IHDR rotos, chunks truncados)
   lanza `PngError` y el escudo queda como `bad_image`. Los CRC no se
   comprueban: si los datos están mal, `inflateSync` o la longitud lo delatan.
   Trabaja con un solo búfer transitorio de ≤ 1024×1024×4 bytes. */

import { inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type PngErrorReason =
  | 'bad_signature'
  | 'bad_header'
  | 'too_large'
  | 'unsupported_depth'
  | 'unsupported_color'
  | 'interlaced'
  | 'truncated'
  | 'bad_data'
  | 'bad_filter'
  | 'missing_palette'
  | 'bad_palette';

export class PngError extends Error {
  override readonly name = 'PngError';
  constructor(readonly reason: PngErrorReason) {
    super(reason);
  }
}

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  /** 0 gris, 2 RGB, 3 paleta, 4 gris+alfa, 6 RGBA. */
  readonly colorType: number;
  readonly interlace: number;
}

export interface PngImage extends PngHeader {
  /** RGBA, 4 bytes por píxel, fila a fila. */
  readonly pixels: Buffer;
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Firma e IHDR (los primeros 33 bytes). Lanza `PngError`. */
export function readPngHeader(buffer: Buffer): PngHeader {
  if (!isPng(buffer)) throw new PngError('bad_signature');
  if (
    buffer.length < 33 ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    throw new PngError('bad_header');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) throw new PngError('bad_header');
  return {
    width,
    height,
    bitDepth: buffer[24] as number,
    colorType: buffer[25] as number,
    interlace: buffer[28] as number,
  };
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Lo que hace falta para poder decodificar: tamaño, tipo, profundidad y sin entrelazado. */
export function checkPngHeader(header: PngHeader, maxDimension: number): void {
  if (header.width > maxDimension || header.height > maxDimension) throw new PngError('too_large');
  const channels = CHANNELS[header.colorType];
  if (channels === undefined) throw new PngError('unsupported_color');
  const depths = header.colorType === 0 || header.colorType === 3 ? [1, 2, 4, 8] : [8];
  if (!depths.includes(header.bitDepth)) throw new PngError('unsupported_depth');
  if (header.interlace !== 0) throw new PngError('interlaced');
}

interface Chunks {
  readonly idat: Buffer[];
  plte: Buffer | null;
  trns: Buffer | null;
}

function readChunks(buffer: Buffer): Chunks {
  const chunks: Chunks = { idat: [], plte: null, trns: null };
  let offset = 8;
  for (;;) {
    if (offset + 8 > buffer.length) throw new PngError('truncated');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new PngError('truncated');
    if (type === 'IEND') return chunks;
    if (type === 'IDAT') chunks.idat.push(buffer.subarray(start, end));
    else if (type === 'PLTE') chunks.plte = buffer.subarray(start, end);
    else if (type === 'tRNS') chunks.trns = buffer.subarray(start, end);
    offset = end + 4; // CRC
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* Deshace el filtro de cada fila (`raw` lleva 1 byte de filtro + rowBytes por fila). */
function unfilter(raw: Buffer, height: number, rowBytes: number, bpp: number): Buffer {
  const out = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)] as number;
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[src + x] as number;
      const left = x >= bpp ? (out[dst + x - bpp] as number) : 0;
      const up = y > 0 ? (out[prev + x] as number) : 0;
      const upLeft = y > 0 && x >= bpp ? (out[prev + x - bpp] as number) : 0;
      let decoded: number;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + ((left + up) >> 1);
          break;
        case 4:
          decoded = value + paeth(left, up, upLeft);
          break;
        default:
          throw new PngError('bad_filter');
      }
      out[dst + x] = decoded & 0xff;
    }
  }
  return out;
}

/* Muestra número `index` de `depth` bits (1, 2 o 4) de una fila. */
function sampleAt(row: Buffer, index: number, depth: number): number {
  const bit = index * depth;
  const byte = row[bit >> 3] as number;
  const shift = 8 - depth - (bit & 7);
  return (byte >> shift) & ((1 << depth) - 1);
}

/**
 * Decodifica a RGBA. Lanza `PngError` con el motivo si el fichero no es un
 * PNG que sepamos leer o pasa de `maxDimension` por lado.
 */
export function decodePng(
  buffer: Buffer,
  options: { readonly maxDimension?: number } = {},
): PngImage {
  const header = readPngHeader(buffer);
  checkPngHeader(header, options.maxDimension ?? 1024);
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType] as number;
  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const chunks = readChunks(buffer);
  if (!chunks.idat.length) throw new PngError('truncated');
  const expected = height * (rowBytes + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(chunks.idat), { maxOutputLength: expected });
  } catch {
    throw new PngError('bad_data');
  }
  if (raw.length < expected) throw new PngError('truncated');
  const data = unfilter(raw, height, rowBytes, bpp);

  const palette = chunks.plte;
  const trns = chunks.trns;
  if (colorType === 3 && (!palette || palette.length < 3)) throw new PngError('missing_palette');
  const scale = 255 / ((1 << bitDepth) - 1);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      switch (colorType) {
        case 6: {
          const i = x * 4;
          pixels[out] = row[i] as number;
          pixels[out + 1] = row[i + 1] as number;
          pixels[out + 2] = row[i + 2] as number;
          pixels[out + 3] = row[i + 3] as number;
          break;
        }
        case 2: {
          const i = x * 3;
          pixels[out] = row[i] as number;
          pixels[out + 1] = row[i + 1] as number;
          pixels[out + 2] = row[i + 2] as number;
          pixels[out + 3] = 255;
          break;
        }
        case 4: {
          const gray = row[x * 2] as number;
          pixels[out] = gray;
          pixels[out + 1] = gray;
          pixels[out + 2] = gray;
          pixels[out + 3] = row[x * 2 + 1] as number;
          break;
        }
        case 0: {
          const sample = bitDepth === 8 ? (row[x] as number) : sampleAt(row, x, bitDepth);
          const gray = Math.round(sample * scale);
          pixels[out] = gray;
          pixels[out + 1] = gray;
          pixels[out + 2] = gray;
          pixels[out + 3] = 255;
          break;
        }
        default: {
          const index = bitDepth === 8 ? (row[x] as number) : sampleAt(row, x, bitDepth);
          const p = palette as Buffer;
          if (index * 3 + 2 >= p.length) throw new PngError('bad_palette');
          pixels[out] = p[index * 3] as number;
          pixels[out + 1] = p[index * 3 + 1] as number;
          pixels[out + 2] = p[index * 3 + 2] as number;
          pixels[out + 3] = trns && index < trns.length ? (trns[index] as number) : 255;
        }
      }
    }
  }
  return { ...header, pixels };
}
