/* Distancia al directo de quien lee el remux (docs/multidispositivo.md §4.4 y
   §4.7): en segundos, con el suelo de 3 TD en el iPhone. */

import { describe, expect, it } from 'vitest';
import {
  IOS_PLAYBACK_PROFILES,
  PLAYBACK_MODES,
  remuxLatency,
  remuxReadySeconds,
  type PlaybackMode,
} from '../src/index.js';

const table = (td: number | null, client: 'web' | 'ios') =>
  Object.fromEntries(
    PLAYBACK_MODES.map((mode) => [mode, remuxLatency(mode, td, client)]),
  ) as Record<PlaybackMode, ReturnType<typeof remuxLatency>>;

describe('remuxLatency', () => {
  it('TD 1: los tres modos valen lo que dicen (3 / 6 / 10 s) en la web y en el iPhone', () => {
    for (const client of ['web', 'ios'] as const) {
      const t = table(1, client);
      expect([t.low.targetS, t.balanced.targetS, t.stable.targetS]).toEqual([3, 6, 10]);
      expect([t.low.maxS, t.balanced.maxS, t.stable.maxS]).toEqual([7, 14, 24]);
    }
  });

  it('TD 2: el iPhone no baja de 6 s (3 TD); la web, de 4 s en «Baja latencia» (2 TD)', () => {
    const ios = table(2, 'ios');
    expect([ios.low.targetS, ios.balanced.targetS, ios.stable.targetS]).toEqual([6, 6, 10]);
    const web = table(2, 'web');
    expect([web.low.targetS, web.balanced.targetS, web.stable.targetS]).toEqual([4, 6, 10]);
  });

  it('TD 4: 12 s en el iPhone y 8 / 12 / 16 s en la web; el tope sube con el objetivo', () => {
    const ios = table(4, 'ios');
    expect([ios.low.targetS, ios.balanced.targetS, ios.stable.targetS]).toEqual([12, 12, 12]);
    expect(ios.low.maxS).toBe(20);
    const web = table(4, 'web');
    expect([web.low.targetS, web.balanced.targetS, web.stable.targetS]).toEqual([8, 12, 16]);
    expect(web.stable.maxS).toBe(24);
  });

  it('sin TD conocido se toma 2; un TD fraccionario se redondea hacia arriba', () => {
    expect(remuxLatency('low', null, 'ios')).toEqual(remuxLatency('low', 2, 'ios'));
    expect(remuxLatency('low', 1.2, 'ios').targetS).toBe(6);
    expect(remuxLatency('low', 0, 'ios').targetS).toBe(3);
  });

  it('velocidad y colchón por modo', () => {
    const t = table(1, 'web');
    expect([t.low.rate, t.balanced.rate, t.stable.rate]).toEqual([1.05, 1.03, 1]);
    expect([t.low.bufferS, t.balanced.bufferS, t.stable.bufferS]).toEqual([10, 30, 60]);
  });

  it('respaldo del iPhone sin `latency.ios`: 3 / 6 / 10 s del directo y 4 / 8 / 12 s de colchón', () => {
    expect(IOS_PLAYBACK_PROFILES).toEqual({
      low: { preferredForwardBufferDuration: 4, liveEdgeOffsetS: 3 },
      balanced: { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 6 },
      stable: { preferredForwardBufferDuration: 12, liveEdgeOffsetS: 10 },
    });
  });

  it('lista lista: max(4 s, 3 TD + 1 s)', () => {
    expect([1, 2, 3, 4].map(remuxReadySeconds)).toEqual([4, 7, 10, 13]);
  });
});
