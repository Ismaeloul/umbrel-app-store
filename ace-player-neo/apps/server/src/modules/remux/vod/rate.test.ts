/* Tasa de bits cerca del cabezal para el ritmo del relé VOD (auditoría 0.9.0):
   la posición de cada fotograma clave (CueClusterPosition del MKV) y la tasa
   de una ventana desde donde se está. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HAS_FFMPEG, ensureVodSample } from '../../../../test/fake-vod/samples.js';
import { readVodIndex } from './index.js';
import { bitrateNear, keyframeBytesOf } from './rate.js';
import { createBufferReader } from './reader.js';
import type { VodIndex } from './types.js';

function index(times: number[], bytes: number[] | null, size = 0, durationS = 0): VodIndex {
  return {
    container: 'mkv',
    durationS: durationS || (times.at(-1) ?? 0) + 2,
    keyframes: Float64Array.from(times),
    ...(bytes ? { keyframeBytes: Float64Array.from(bytes) } : {}),
    video: {
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    },
    audio: [],
    subtitles: [],
    sizeBytes: size,
  };
}

describe('keyframeBytesOf', () => {
  it('alinea las posiciones con los fotogramas clave (por tiempo) y deja NaN donde no hay', () => {
    const out = keyframeBytesOf(Float64Array.from([0, 2, 4, 6]), [
      [4, 4_000],
      [0, 100],
      [2, 2_000],
    ]);
    expect(out && [...out]).toEqual([100, 2_000, 4_000, Number.NaN]);
  });

  it('sin pares, o con menos de la mitad, null', () => {
    expect(keyframeBytesOf(Float64Array.from([0, 2]), [])).toBeNull();
    expect(keyframeBytesOf(Float64Array.from([0, 2, 4, 6, 8]), [[0, 1]])).toBeNull();
  });
});

describe('bitrateNear', () => {
  /* 1 MB/s los primeros 100 s y 4 MB/s después (una escena cara). */
  const times = Array.from({ length: 101 }, (_, i) => i * 2);
  let at = 0;
  const bytes = times.map((t, i) => {
    if (i > 0) at += (t <= 100 ? 1_000_000 : 4_000_000) * 2;
    return at;
  });
  const movie = index(times, bytes, at + 8_000_000, 202);

  it('la tasa de la ventana desde donde se está, no la media', () => {
    expect(bitrateNear(movie, 0, 60)).toBeCloseTo(1_000_000, -3);
    expect(bitrateNear(movie, 120, 60)).toBeCloseTo(4_000_000, -3);
    /* A caballo: la media de la ventana. */
    expect(bitrateNear(movie, 80, 40)).toBeCloseTo(2_500_000, -3);
  });

  it('cerca del final, hasta el final del fichero', () => {
    expect(bitrateNear(movie, 200, 60)).toBeCloseTo(4_000_000, -3);
  });

  it('sin posiciones (un MP4) o sin que crezcan, null', () => {
    expect(bitrateNear(index(times, null, 1_000), 0)).toBeNull();
    expect(bitrateNear(index([0, 2, 4], [10, 10, 10], 10, 6), 0)).toBeNull();
  });
});

describe.skipIf(!HAS_FFMPEG)('con un MKV de verdad', () => {
  it('el índice trae la posición de cada fotograma clave y la tasa sale cerca de la media', async () => {
    const data = readFileSync(ensureVodSample('mkv-larga'));
    const found = await readVodIndex(createBufferReader(data));
    const positions = found.keyframeBytes;
    expect(positions).toBeDefined();
    expect(positions?.length).toBe(found.keyframes.length);
    for (let i = 1; i < (positions?.length ?? 0); i += 1) {
      expect(positions?.[i]).toBeGreaterThan(positions?.[i - 1] as number);
    }
    const mean = found.sizeBytes / found.durationS;
    const near = bitrateNear(found, found.durationS / 2) as number;
    expect(near).toBeGreaterThan(mean / 2);
    expect(near).toBeLessThan(mean * 2);
  });
});
