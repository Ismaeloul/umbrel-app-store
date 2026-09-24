/* Decodificador PNG propio (informe de fase 2, §10.5) con PNG sintéticos:
   los píxeles esperados son exactos. */

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PNG_SIGNATURE, PngError, decodePng, isPng, readPngHeader } from './png.js';
import { encodePng, pngChunk, solidPng } from './test-support.js';

function pixel(image: { pixels: Buffer; width: number }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.pixels.subarray(at, at + 4)];
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PngError) return error.reason;
    throw error;
  }
  throw new Error('no lanzó');
}

describe('decodePng', () => {
  it('RGBA de 8 bits: los píxeles salen tal cual', () => {
    const image = decodePng(solidPng(3, 2, [10, 20, 30, 255]));
    expect([image.width, image.height, image.colorType, image.bitDepth]).toEqual([3, 2, 6, 8]);
    expect(image.pixels).toHaveLength(3 * 2 * 4);
    expect(pixel(image, 2, 1)).toEqual([10, 20, 30, 255]);
  });

  it('RGB con cada filtro (None, Sub, Up, Average, Paeth) da la misma imagen', () => {
    const sample = (x: number, y: number): number[] => [
      (x * 37 + y * 11) & 255,
      (x * 5) & 255,
      200 - y * 3,
    ];
    const reference = decodePng(
      encodePng({ width: 7, height: 5, colorType: 2, filter: 0, sample }),
    );
    for (const filter of [1, 2, 3, 4]) {
      const image = decodePng(encodePng({ width: 7, height: 5, colorType: 2, filter, sample }));
      expect(image.pixels.equals(reference.pixels), `filtro ${filter}`).toBe(true);
    }
    const mixed = decodePng(
      encodePng({ width: 7, height: 5, colorType: 2, filter: (y) => y % 5, sample }),
    );
    expect(mixed.pixels.equals(reference.pixels)).toBe(true);
    expect(pixel(reference, 3, 2)).toEqual([(3 * 37 + 22) & 255, 15, 194, 255]);
  });

  it('paleta de 8 bits con tRNS: color de la paleta y alfa del tRNS (255 si falta)', () => {
    const image = decodePng(
      encodePng({
        width: 3,
        height: 1,
        colorType: 3,
        palette: [
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
        ],
        trns: [0, 128],
        sample: (x) => [x],
      }),
    );
    expect(pixel(image, 0, 0)).toEqual([255, 0, 0, 0]);
    expect(pixel(image, 1, 0)).toEqual([0, 255, 0, 128]);
    expect(pixel(image, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('paleta de 4 bits y gris de 1 bit desempaquetan las muestras', () => {
    const palette = decodePng(
      encodePng({
        width: 5,
        height: 1,
        colorType: 3,
        bitDepth: 4,
        palette: Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0] as const),
        sample: (x) => [x * 3],
      }),
    );
    expect(pixel(palette, 4, 0)).toEqual([12 * 16, 0, 0, 255]);
    const gray = decodePng(
      encodePng({ width: 9, height: 1, colorType: 0, bitDepth: 1, sample: (x) => [x % 2] }),
    );
    expect(pixel(gray, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(gray, 7, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(gray, 8, 0)).toEqual([0, 0, 0, 255]);
  });

  it('gris y gris+alfa de 8 bits', () => {
    const gray = decodePng(
      encodePng({ width: 2, height: 1, colorType: 0, sample: (x) => [x * 100] }),
    );
    expect(pixel(gray, 1, 0)).toEqual([100, 100, 100, 255]);
    const grayAlpha = decodePng(
      encodePng({ width: 1, height: 1, colorType: 4, sample: () => [77, 33] }),
    );
    expect(pixel(grayAlpha, 0, 0)).toEqual([77, 77, 77, 33]);
  });

  it('rechaza 16 bits, entrelazado, firma rota y 5000×5000', () => {
    expect(
      reason(() =>
        decodePng(
          encodePng({ width: 1, height: 1, colorType: 2, bitDepth: 16, sample: () => [0, 0, 0] }),
        ),
      ),
    ).toBe('unsupported_depth');
    expect(
      reason(() =>
        decodePng(
          encodePng({
            width: 1,
            height: 1,
            colorType: 6,
            interlace: 1,
            sample: () => [0, 0, 0, 0],
          }),
        ),
      ),
    ).toBe('interlaced');
    expect(reason(() => decodePng(Buffer.from('GIF89a…')))).toBe('bad_signature');
    const huge = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', Buffer.from([0, 0, 0x13, 0x88, 0, 0, 0x13, 0x88, 8, 6, 0, 0, 0])),
    ]);
    expect(reason(() => decodePng(huge))).toBe('too_large');
    expect(readPngHeader(huge)).toMatchObject({ width: 5000, height: 5000, colorType: 6 });
    /* Con un tope mayor pasa la cabecera y falla por lo siguiente: no hay IDAT. */
    expect(reason(() => decodePng(huge, { maxDimension: 5000 }))).toBe('truncated');
  });

  it('rechaza chunks truncados, datos corruptos y paleta que falta', () => {
    const good = solidPng(4, 4, [1, 2, 3, 4]);
    expect(reason(() => decodePng(good.subarray(0, good.length - 20)))).toBe('truncated');
    const corrupt = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])),
      pngChunk('IDAT', Buffer.from('esto no es zlib')),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    expect(reason(() => decodePng(corrupt))).toBe('bad_data');
    const short = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])),
      pngChunk('IDAT', deflateSync(Buffer.alloc(5))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    expect(reason(() => decodePng(short))).toBe('truncated');
    const noPalette = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0])),
      pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    expect(reason(() => decodePng(noPalette))).toBe('missing_palette');
    expect(isPng(good)).toBe(true);
    expect(isPng(Buffer.from('nope'))).toBe(false);
  });
});
