/* Windows (solo desarrollo, auditoría 0.9.0): ffmpeg escribe index.m3u8.tmp y
   lo renombra encima de la lista, y en Windows el renombrado falla si el
   backend la tiene abierta en ese momento (la lista se queda congelada). Con
   `platform: 'win32'` el remux lee la lista como mucho una vez cada 250 ms
   por carpeta; en Linux (el Umbrel), sin esperas. */

import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as RemuxFiles from './files.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { IPTV_STALL_MIN_MS, WIN32_PLAYLIST_READ_GAP_MS, createRemuxRuntime } from './service.js';
import { createFakeLauncher } from './test-support.js';
import type { RemuxSource } from './types.js';

const lecturas = vi.hoisted(() => ({ at: [] as number[] }));

vi.mock('./files.js', async (importOriginal) => {
  const original = await importOriginal<typeof RemuxFiles>();
  return {
    ...original,
    readPlaylistInfo: async (file: string) => {
      lecturas.at.push(performance.now());
      return original.readPlaylistInfo(file);
    },
  };
});

const RELAY = 'http://127.0.0.1:41999/r/AbCdEfGhIjKlMnOpQrStUv/in.ts';
const source: RemuxSource = {
  sessionId: 's_iptvsesion000000000002',
  hash: 'd'.repeat(40),
  playbackUrl: RELAY,
  mode: 'hls',
  inputUrl: RELAY,
  origin: 'iptv',
};

describe('lecturas de index.m3u8 en Windows', () => {
  const stops: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (stops.length) await stops.pop()?.();
  });

  async function stalledReads(platform: NodeJS.Platform): Promise<number[]> {
    const core = createTestCore();
    const ffmpeg = createFakeLauncher({ autoSegments: [2, 2, 2] });
    const rt = createRemuxRuntime({
      ...core,
      engine: {} as never,
      launcher: ffmpeg.launcher,
      procRoot: null,
      watchFiles: false,
      platform,
    });
    stops.push(() => rt.service.stopAll());
    await rt.service.ensure(source, 'v_web');
    /* La lista quieta más de 10 s: cada vuelta del vigilante la lee. Tres a la vez. */
    core.clock.advance(IPTV_STALL_MIN_MS + 1_000);
    lecturas.at = [];
    await Promise.all([rt.watchStalls(), rt.watchStalls(), rt.watchStalls()]);
    return [...lecturas.at];
  }

  it('win32: como mucho una lectura cada 250 ms', async () => {
    const reads = await stalledReads('win32');
    expect(reads).toHaveLength(3);
    for (let i = 1; i < reads.length; i += 1) {
      expect(reads[i]! - reads[i - 1]!).toBeGreaterThanOrEqual(WIN32_PLAYLIST_READ_GAP_MS - 20);
    }
  });

  it('linux: sin esperas', async () => {
    const reads = await stalledReads('linux');
    expect(reads).toHaveLength(3);
    expect(reads[2]! - reads[0]!).toBeLessThan(WIN32_PLAYLIST_READ_GAP_MS);
  });
});
