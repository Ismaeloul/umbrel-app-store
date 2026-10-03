/* Índice común (docs/vod.md §9.4): el contenedor se decide por los bytes
   (AVI → formato, TS → índice, otra cosa → formato), cada uno va a su
   lector, y el LRU de 8 comparte la lectura en curso y no guarda fallos. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { buildMkv } from '../../../../test/fake-vod/ebml.js';
import { avc1Entry, buildMp4 } from '../../../../test/fake-vod/mp4.js';
import { VodIndexCache, readVodIndex, sniffContainer } from './index.js';
import { createBufferReader } from './reader.js';
import type { VodIndex } from './types.js';

const AVCC = Buffer.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x05, 0x67, 0x64, 0x00, 0x28, 0xac, 0x01, 0x00, 0x04,
  0x68, 0xee, 0x3c, 0x80, 0xfd, 0xf8, 0xf8, 0x00,
]);

function ts(packet: 188 | 192): Buffer {
  const out = Buffer.alloc(packet * 5, 0xff);
  for (let i = 0; i < 5; i += 1) out[i * packet + (packet === 192 ? 4 : 0)] = 0x47;
  return out;
}

async function reasonOf(data: Buffer): Promise<string> {
  const error = await readVodIndex(createBufferReader(data)).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('vod_unsupported');
  return (error as AppError & { data: { reason: string } }).data.reason;
}

describe('sniffContainer', () => {
  it('por los bytes', () => {
    expect(sniffContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toBe('mkv');
    expect(sniffContainer(Buffer.from('\0\0\0\x18ftypisom', 'latin1'))).toBe('mp4');
    expect(sniffContainer(Buffer.from('\0\0\0\x08free', 'latin1'))).toBe('mp4');
    expect(sniffContainer(Buffer.from('RIFF\x10\0\0\0AVI LIST', 'latin1'))).toBe('avi');
    expect(sniffContainer(ts(188))).toBe('ts');
    expect(sniffContainer(ts(192))).toBe('ts');
    expect(sniffContainer(Buffer.from('<html>hola</html>'))).toBe('desconocido');
    expect(sniffContainer(Buffer.alloc(0))).toBe('desconocido');
  });
});

describe('readVodIndex', () => {
  it('MKV y MP4 van a su lector', async () => {
    const mkv = buildMkv({
      tracks: [{ number: 1, type: 'video', codecId: 'V_MPEG4/ISO/AVC', codecPrivate: AVCC }],
      cues: [0, 2000, 4000].map((time) => ({ time, track: 1 })),
    });
    expect((await readVodIndex(createBufferReader(mkv))).container).toBe('mkv');
    const mp4 = buildMp4({
      tracks: [
        {
          kind: 'video',
          timescale: 1000,
          sampleEntry: avc1Entry(AVCC),
          stts: [[30, 1000]],
          stss: [1, 11, 21],
        },
      ],
      moovAtEnd: true,
    });
    const index = await readVodIndex(createBufferReader(mp4));
    expect(index.container).toBe('mp4');
    expect(Array.from(index.keyframes)).toEqual([0, 10, 20]);
  });

  it('AVI → formato; TS → índice; otra cosa → formato', async () => {
    expect(await reasonOf(Buffer.from('RIFF\x10\0\0\0AVI LIST', 'latin1'))).toBe('formato');
    expect(await reasonOf(ts(188))).toBe('indice');
    expect(await reasonOf(Buffer.from('<!DOCTYPE html><title>403</title>'))).toBe('formato');
    expect(await reasonOf(Buffer.alloc(0))).toBe('formato');
  });
});

describe('VodIndexCache', () => {
  const fake = (n: number): VodIndex => ({ sizeBytes: n }) as VodIndex;

  it('guarda 8 y echa al más antiguo; consultar lo refresca', async () => {
    const cache = new VodIndexCache();
    for (let i = 0; i < 8; i += 1) await cache.get(`t${i}`, async () => fake(i));
    await cache.peek('t0');
    await cache.get('t8', async () => fake(8));
    expect(cache.size).toBe(8);
    expect(cache.peek('t1')).toBeUndefined();
    expect(await cache.peek('t0')).toEqual(fake(0));
  });

  it('dos peticiones a la vez leen una sola vez', async () => {
    const cache = new VodIndexCache(2);
    let reads = 0;
    let release: (index: VodIndex) => void = () => undefined;
    const read = (): Promise<VodIndex> => {
      reads += 1;
      return new Promise((resolve) => (release = resolve));
    };
    const a = cache.get('x', read);
    const b = cache.get('x', read);
    release(fake(1));
    expect(await a).toBe(await b);
    expect(reads).toBe(1);
  });

  it('un fallo no se guarda: la siguiente vez se vuelve a leer', async () => {
    const cache = new VodIndexCache();
    await expect(cache.get('y', () => Promise.reject(new Error('caído')))).rejects.toThrow();
    expect(cache.peek('y')).toBeUndefined();
    expect(await cache.get('y', async () => fake(2))).toEqual(fake(2));
    cache.delete('y');
    expect(cache.size).toBe(0);
  });
});
