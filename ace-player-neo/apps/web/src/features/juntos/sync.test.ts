import { PARTY, type PartyPlayback } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  addSample,
  bestOffset,
  clock,
  correction,
  isRunning,
  offsetSample,
  targetPosition,
} from './sync.ts';

const playback = (over: Partial<PartyPlayback> = {}): PartyPlayback => ({
  playing: true,
  positionS: 100,
  at: 1_000_000,
  rev: 2,
  waitingFor: [],
  ...over,
});

describe('«Ver juntos»: sincronización (docs/ver-juntos.md §6)', () => {
  it('la posición de la sala corre solo si reproduce y nadie carga, con tope en la duración', () => {
    expect(targetPosition(playback(), 1_010_000, null)).toBe(110);
    expect(targetPosition(playback({ playing: false }), 1_010_000, null)).toBe(100);
    expect(targetPosition(playback({ waitingFor: ['m_AnaInvitada01'] }), 1_010_000, null)).toBe(
      100,
    );
    expect(targetPosition(playback(), 1_010_000, 105)).toBe(105);
    /* Un reloj que va por detrás no da posiciones hacia atrás. */
    expect(targetPosition(playback(), 990_000, null)).toBe(100);
    expect(isRunning(playback({ waitingFor: ['m_AnaInvitada01'] }))).toBe(false);
  });

  it('corrige: salta lejos, acelera o frena un 5 % cerca, y en pausa coloca el vídeo', () => {
    expect(correction(100, 103, true)).toEqual({ kind: 'seek', to: 103 });
    expect(correction(100, 100.5, true)).toEqual({ kind: 'rate', rate: 1 + PARTY.driftRate });
    expect(correction(100.5, 100, true)).toEqual({ kind: 'rate', rate: 1 - PARTY.driftRate });
    expect(correction(100, 100.1, true)).toEqual({ kind: 'rate', rate: 1 });
    expect(correction(100, 100.5, false)).toEqual({ kind: 'seek', to: 100.5 });
    expect(correction(100, 100.2, false)).toEqual({ kind: 'none' });
  });

  it('el desfase de reloj sale de la ida y vuelta, y gana la muestra más rápida', () => {
    /* Enviado a las 1000, recibido a las 1100: el servidor dijo 5050 a mitad de camino. */
    expect(offsetSample(1_000, 1_100, 5_050)).toEqual({ offsetMs: 4_000, rttMs: 100 });
    let samples = addSample([], { offsetMs: 4_200, rttMs: 400 });
    samples = addSample(samples, { offsetMs: 4_000, rttMs: 40 });
    samples = addSample(samples, { offsetMs: 4_100, rttMs: 120 });
    expect(bestOffset(samples)).toBe(4_000);
    expect(bestOffset([])).toBe(0);
    for (let i = 0; i < 20; i += 1) samples = addSample(samples, { offsetMs: i, rttMs: 500 });
    expect(samples).toHaveLength(8);
  });

  it('el reloj de pantalla', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(2_000)).toBe('33:20');
    expect(clock(3_909)).toBe('1:05:09');
  });
});
