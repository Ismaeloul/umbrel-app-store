/* `latency` e `iptvInput` de la concesión (docs/multidispositivo.md §4.4). */

import { describe, expect, it } from 'vitest';
import { PLAYBACK_MODES } from '@ace/shared';
import { iptvInputOf, latencyFor } from './grant.js';

describe('latencyFor con el remux', () => {
  it('iPhone: 3 / 6 / 10 s con TD 1 y 6 / 6 / 10 s con TD 2; colchón = max(rebuild, objetivo)', () => {
    const at = (td: number) =>
      PLAYBACK_MODES.map((mode) => latencyFor(mode, 'hls-fmp4', { targetDurationS: td }).ios);
    expect(at(1)).toEqual([
      { preferredForwardBufferDuration: 12, liveEdgeOffsetS: 10 },
      { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 6 },
      { preferredForwardBufferDuration: 4, liveEdgeOffsetS: 3 },
    ]);
    expect(at(2)).toEqual([
      { preferredForwardBufferDuration: 12, liveEdgeOffsetS: 10 },
      { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 6 },
      { preferredForwardBufferDuration: 6, liveEdgeOffsetS: 6 },
    ]);
    expect(latencyFor('low', 'hls-fmp4', { targetDurationS: 1 }).liveSync).toBeNull();
  });

  it('web con el remux (IPTV): seguimiento en segundos también en «Estable»', () => {
    expect(latencyFor('stable', 'hls', { targetDurationS: 1 }).liveSync).toEqual({
      targetS: 10,
      maxS: 24,
      rate: 1,
    });
    expect(latencyFor('low', 'hls', { targetDurationS: 1 }).liveSync).toEqual({
      targetS: 3,
      maxS: 7,
      rate: 1.05,
    });
    expect(latencyFor('low', 'hls', { targetDurationS: 2 }).liveSync?.targetS).toBe(4);
  });

  it('sin remux, lo de siempre (mpegts.js y el HLS del motor; nada en «Estable»)', () => {
    expect(latencyFor('stable', 'mpegts').liveSync).toBeNull();
    expect(latencyFor('stable', 'hls').liveSync).toBeNull();
    expect(latencyFor('low', 'mpegts').liveSync).toEqual({ targetS: 3, maxS: 7, rate: 1.05 });
    expect(latencyFor('balanced', 'hls').liveSync).toEqual({ targetS: 6, maxS: 14, rate: 1.03 });
    /* Un visor iOS sin remux conocido: el respaldo fijo. */
    expect(latencyFor('low', 'hls-fmp4').ios).toEqual({
      preferredForwardBufferDuration: 4,
      liveEdgeOffsetS: 3,
    });
  });

  it('iptvInput: ts o hls según lo que entrega el proveedor', () => {
    expect(iptvInputOf({ isHls: false })).toBe('ts');
    expect(iptvInputOf({ isHls: true })).toBe('hls');
  });
});
