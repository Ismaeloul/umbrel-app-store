/* Perfil para una IPTV que entrega a golpes (auditoría 0.9.0, cadence.ts). */

import { describe, expect, it } from 'vitest';
import { PLAYBACK_PROFILES } from '@ace/shared';
import { profileForCadence } from './cadence.ts';

describe('profileForCadence', () => {
  const balanced = PLAYBACK_PROFILES.balanced;

  it('llega seguido (null, 0 o menos de 4 s): el mismo perfil', () => {
    expect(profileForCadence(balanced, null)).toBe(balanced);
    expect(profileForCadence(balanced, 0)).toBe(balanced);
    expect(profileForCadence(balanced, 3_900)).toBe(balanced);
  });

  it('golpes de 10 s en «Equilibrado»: objetivo y colchón 15 s, máxima 29 s', () => {
    const profile = profileForCadence(balanced, 10_000);
    expect(profile.initial).toBe(15);
    expect(profile.rebuild).toBe(15);
    expect(profile.hls).toMatchObject({
      liveSyncDuration: 15,
      liveMaxLatencyDuration: 29,
      maxBufferLength: 60,
      maxLiveSyncPlaybackRate: balanced.hls.maxLiveSyncPlaybackRate,
    });
    /* La máxima siempre deja caber un golpe entero por encima del objetivo. */
    expect(profile.hls.liveMaxLatencyDuration - profile.hls.liveSyncDuration).toBeGreaterThan(10);
  });

  it('golpes de 15 s: 23 s de objetivo; nunca más de 30 s de objetivo', () => {
    expect(profileForCadence(balanced, 15_000).hls.liveSyncDuration).toBe(23);
    const huge = profileForCadence(PLAYBACK_PROFILES.low, 25_000);
    expect(huge.hls.liveSyncDuration).toBe(30);
    expect(huge.hls.liveMaxLatencyDuration).toBe(59);
    expect(huge.hls.maxBufferLength).toBe(69);
  });

  it('nunca baja lo que el perfil ya tenía («Estable» con golpes de 5 s)', () => {
    const stable = PLAYBACK_PROFILES.stable;
    const profile = profileForCadence(stable, 5_000);
    expect(profile.hls.liveSyncDuration).toBe(stable.hls.liveSyncDuration);
    expect(profile.hls.liveMaxLatencyDuration).toBe(Math.max(26, 14 + 5 + 4));
    expect(profile.initial).toBe(stable.initial);
    expect(profile.rebuild).toBe(stable.rebuild);
  });
});
