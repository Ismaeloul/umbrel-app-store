/* Segmentos sobre los fotogramas clave (docs/vod.md §9.5 y §15.1): ≥ 6 s,
   TARGETDURATION, GOP largo, recorte de la duración, el último trozo corto
   junto al anterior, la lista desde 0 aunque la clave esté en 0,021 s (P1)
   y a qué segmento va cada fragmento por su tiempo de presentación (P4). */

import { describe, expect, it } from 'vitest';
import {
  extinf,
  nearestKeyframe,
  placeFragment,
  planSegments,
  segmentAt,
  type VodPlan,
} from './plan.js';

const every = (step: number, until: number, from = 0): Float64Array => {
  const out: number[] = [];
  for (let t = from; t < until - 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return Float64Array.from(out);
};

const starts = (plan: VodPlan): number[] => plan.segments.map((s) => s.startS);

describe('planSegments', () => {
  it('GOP de 2 s en 60 s: 10 segmentos de 6 s y TARGETDURATION 6', () => {
    const plan = planSegments(every(2, 60), 60);
    expect(starts(plan)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);
    expect(plan.segments.every((s) => extinf(s) === 6)).toBe(true);
    expect(plan.targetDurationS).toBe(6);
    expect(plan.segments[3]).toEqual({
      index: 3,
      startS: 18,
      endS: 24,
      keyframe: 9,
      keyframeS: 18,
    });
  });

  it('GOP irregular de 2,5 s: cada segmento ≥ 6 s, techo 8', () => {
    const plan = planSegments(every(2.5, 60), 60);
    expect(starts(plan).slice(0, 4)).toEqual([0, 7.5, 15, 22.5]);
    expect(plan.segments.every((s) => extinf(s) >= 6)).toBe(true);
    expect(plan.targetDurationS).toBe(8);
  });

  it('GOP largo (15 s): segmentos de 15 s', () => {
    const plan = planSegments(every(15, 120), 120);
    expect(starts(plan)).toEqual([0, 15, 30, 45, 60, 75, 90, 105]);
    expect(plan.targetDurationS).toBe(15);
  });

  it('el último trozo corto va con el anterior', () => {
    const plan = planSegments(every(2, 56), 55.5);
    expect(starts(plan).at(-1)).toBe(48);
    expect(plan.segments.at(-1)?.endS).toBe(55.5);
    expect(plan.targetDurationS).toBe(8);
  });

  it('los fotogramas clave más allá de la duración no abren nada (recorte)', () => {
    const plan = planSegments(every(2, 120), 30);
    expect(starts(plan)).toEqual([0, 6, 12, 18, 24]);
    expect(plan.durationS).toBe(30);
    expect(plan.segments.at(-1)?.endS).toBe(30);
  });

  it('la lista empieza en 0 aunque el primer fotograma clave esté en 0,021 s (P1)', () => {
    const plan = planSegments(every(3.4, 60, 0.021), 60);
    expect(plan.segments[0]).toMatchObject({ startS: 0, keyframe: 0, keyframeS: 0.021 });
    expect(plan.segments[1]?.startS).toBeCloseTo(6.821, 6);
  });

  it('las duraciones suman la duración; sin fotogramas clave, un solo segmento', () => {
    const plan = planSegments(every(2.7, 3600), 3600.04);
    const total = plan.segments.reduce((sum, s) => sum + (s.endS - s.startS), 0);
    expect(total).toBeCloseTo(3600.04, 6);
    const lone = planSegments(new Float64Array(), 42);
    expect(lone.segments).toEqual([{ index: 0, startS: 0, endS: 42, keyframe: 0, keyframeS: 0 }]);
    expect(lone.targetDurationS).toBe(42);
  });
});

describe('segmentAt y nearestKeyframe', () => {
  const plan = planSegments(every(2, 60), 60);
  it('segmentAt', () => {
    expect(segmentAt(plan, 0)).toBe(0);
    expect(segmentAt(plan, 5.999)).toBe(0);
    expect(segmentAt(plan, 6)).toBe(1);
    expect(segmentAt(plan, 59.9)).toBe(9);
    expect(segmentAt(plan, 500)).toBe(9);
    expect(segmentAt(plan, -3)).toBe(0);
  });
  it('nearestKeyframe', () => {
    const kf = Float64Array.from([0, 2, 4.5, 9]);
    expect(nearestKeyframe(kf, 2.1)).toBe(1);
    expect(nearestKeyframe(kf, 3.3)).toBe(2);
    expect(nearestKeyframe(kf, 100)).toBe(3);
    expect(nearestKeyframe(kf, -1)).toBe(0);
    expect(nearestKeyframe(new Float64Array(), 1)).toBe(-1);
  });
});

describe('placeFragment (P4)', () => {
  const keyframes = Float64Array.from([0, 2, 4, 6, 6.15, 8, 10, 12, 14]);
  const plan = planSegments(keyframes, 20);

  it('un fragmento en la clave que abre segmento lo abre, con el desfase que quede', () => {
    expect(placeFragment(plan, keyframes, 6.03)).toEqual({ kind: 'opens', segment: 1 });
    expect(placeFragment(plan, keyframes, 5.97)).toEqual({ kind: 'opens', segment: 1 });
    expect(placeFragment(plan, keyframes, 0)).toEqual({ kind: 'opens', segment: 0 });
  });

  it('una clave que no abre segmento va dentro; dos claves juntas no se confunden', () => {
    expect(placeFragment(plan, keyframes, 2)).toEqual({ kind: 'inside', segment: 0 });
    expect(placeFragment(plan, keyframes, 6.15)).toEqual({ kind: 'inside', segment: 1 });
    expect(placeFragment(plan, keyframes, 12)).toEqual({ kind: 'opens', segment: 2 });
  });

  it('sin clave cerca (Cues que no las apuntan todas): dentro, por su tiempo', () => {
    expect(placeFragment(plan, keyframes, 7)).toEqual({ kind: 'inside', segment: 1 });
    expect(placeFragment(plan, keyframes, 13)).toEqual({ kind: 'inside', segment: 2 });
  });
});
