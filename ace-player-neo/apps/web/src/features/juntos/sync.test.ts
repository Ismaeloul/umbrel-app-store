import { PARTY, type PartyPlayback } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  addSample,
  bestOffset,
  clock,
  correction,
  forwardBufferEnd,
  isRunning,
  lobbyReport,
  offsetSample,
  pausedSeek,
  StallDetector,
  WAITED_STAY_S,
  targetPosition,
} from './sync.ts';

const playback = (over: Partial<PartyPlayback> = {}): PartyPlayback => ({
  playing: true,
  positionS: 100,
  at: 1_000_000,
  rev: 2,
  waitingFor: [],
  lobby: false,
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

  it('«Esperando a todos»: el % es lo cargado por delante sobre lobbyBufferS; sin vídeo, 0', () => {
    expect(lobbyReport(false, 0, 4, 100, null)).toEqual({ ready: false, progress: 0 });
    expect(lobbyReport(true, 10, 2, 10 + PARTY.lobbyBufferS / 2, null)).toEqual({
      ready: false,
      progress: 50,
    });
    expect(lobbyReport(true, 10, 2, 10 + PARTY.lobbyBufferS, null)).toEqual({
      ready: true,
      progress: 100,
    });
    /* El navegador dice que tiene de sobra (HAVE_ENOUGH_DATA) y hay 4 s por delante, o queda menos que el colchón.
       Con HAVE_ENOUGH_DATA y 1 s, no: el iPhone lo dice con muy poco (§16). */
    expect(lobbyReport(true, 0, 4, 1, null).ready).toBe(false);
    expect(lobbyReport(true, 0, 4, 4, null).ready).toBe(true);
    expect(lobbyReport(true, 99, 2, 100, 100).ready).toBe(true);
  });
});

describe('StallDetector (§16)', () => {
  const base = {
    paused: false,
    seeking: false,
    ended: false,
    readyState: 4,
    aheadS: 10,
    leftS: null,
  };

  it('reproduciendo sin avanzar 0,8 s está atascado; con un fotograma no se da por recuperado', () => {
    const stall = new StallDetector(4);
    expect(stall.update({ ...base, now: 0, currentTime: 10 })).toBe(false);
    expect(stall.update({ ...base, now: 500, currentTime: 10, readyState: 2, aheadS: 0 })).toBe(
      false,
    );
    expect(stall.update({ ...base, now: 900, currentTime: 10, readyState: 2, aheadS: 0 })).toBe(
      true,
    );
    /* Safari vuelve a HAVE_FUTURE_DATA con medio segundo: sigue atascado. */
    expect(stall.update({ ...base, now: 1_400, currentTime: 10, readyState: 3, aheadS: 0.5 })).toBe(
      true,
    );
    /* Con el colchón pedido (4 s en HLS nativo), recuperado. */
    expect(stall.update({ ...base, now: 1_900, currentTime: 10, readyState: 3, aheadS: 4 })).toBe(
      false,
    );
  });

  it('cerca del final basta con lo que queda; avanzar de verdad también lo suelta', () => {
    const stall = new StallDetector(4);
    stall.waiting(0);
    expect(
      stall.update({ ...base, now: 100, currentTime: 98, readyState: 2, aheadS: 1.6, leftS: 2 }),
    ).toBe(false);
    stall.waiting(5_000);
    stall.update({ ...base, now: 5_000, currentTime: 50, readyState: 3, aheadS: 0.5 });
    stall.update({ ...base, now: 5_600, currentTime: 50.6, readyState: 3, aheadS: 0.5 });
    expect(
      stall.update({ ...base, now: 6_200, currentTime: 51.2, readyState: 3, aheadS: 0.5 }),
    ).toBe(false);
  });

  it('si se repite, pide más colchón (4 → 6 → 10) y a los 2 min sin atascos vuelve a 4; los de un salto propio no cuentan', () => {
    const stall = new StallDetector(4);
    const stallAt = (now: number) => {
      stall.waiting(now);
      stall.update({ ...base, now, currentTime: 0, readyState: 4, aheadS: 20 });
    };
    stallAt(0);
    expect(stall.resumeAheadS).toBe(4);
    stallAt(10_000);
    expect(stall.resumeAheadS).toBe(6);
    stallAt(20_000);
    expect(stall.resumeAheadS).toBe(10);
    stall.update({ ...base, now: 200_000, currentTime: 0 });
    expect(stall.resumeAheadS).toBe(4);
    stallAt(201_000);
    stall.moved(205_000, true);
    stallAt(205_500);
    expect(stall.resumeAheadS).toBe(4);
  });

  it('cuenta los atascos repetidos (los que suben el colchón; Safari baja a la ligera con el primero, §17)', () => {
    const stall = new StallDetector(4);
    const stallAt = (now: number) => {
      stall.waiting(now);
      stall.update({ ...base, now, currentTime: 0, readyState: 4, aheadS: 20 });
    };
    stallAt(0);
    expect(stall.escalations).toBe(0);
    stallAt(10_000);
    expect(stall.escalations).toBe(1);
    /* Provocado por un salto nuestro: no cuenta. */
    stall.moved(20_000, true);
    stallAt(20_500);
    expect(stall.escalations).toBe(1);
    stallAt(30_000);
    expect(stall.escalations).toBe(2);
    /* Lejos del anterior (más de 60 s): tampoco. */
    stallAt(200_000);
    expect(stall.escalations).toBe(2);
  });

  it('en pausa (la sala parada) no cuenta como atasco aunque no avance', () => {
    const stall = new StallDetector(3);
    stall.update({ ...base, now: 0, currentTime: 5, paused: true });
    expect(stall.update({ ...base, now: 5_000, currentTime: 5, paused: true })).toBe(false);
  });
});

describe('StallDetector: pausas y saltos (revisión §16)', () => {
  const base = { seeking: false, ended: false, readyState: 3, aheadS: 1, leftS: null };

  it('al reanudar tras una pausa larga no cuenta la pausa como atasco ni sube el colchón', () => {
    const stall = new StallDetector(4);
    stall.update({ ...base, now: 0, currentTime: 20, paused: true });
    stall.update({ ...base, now: 10_000, currentTime: 20, paused: true });
    expect(stall.update({ ...base, now: 10_050, currentTime: 20, paused: false })).toBe(false);
    expect(stall.update({ ...base, now: 10_400, currentTime: 20, paused: false })).toBe(false);
    expect(stall.resumeAheadS).toBe(4);
    /* Si de verdad no arranca, sí: 0,8 s reproduciendo sin avanzar. */
    expect(stall.update({ ...base, now: 10_900, currentTime: 20, paused: false })).toBe(true);
  });

  it('lo mismo tras un salto largo (seeking)', () => {
    const stall = new StallDetector(3);
    stall.update({ ...base, now: 0, currentTime: 5, paused: false });
    stall.update({ ...base, now: 3_000, currentTime: 40, paused: false, seeking: true });
    expect(stall.update({ ...base, now: 3_100, currentTime: 40, paused: false })).toBe(false);
  });
});

describe('StallDetector: el colchón en pausa del iPhone (§16)', () => {
  const base = { seeking: false, ended: false, readyState: 3, leftS: null };
  /** Tres atascos seguidos (cada uno recuperado con colchón de sobra): pide 10 s; y uno más. */
  const escalate = (stall: StallDetector) => {
    for (const now of [0, 10_000, 20_000]) {
      stall.waiting(now);
      stall.update({ ...base, now, currentTime: 0, paused: false, aheadS: 30 });
    }
    expect(stall.resumeAheadS).toBe(10);
    stall.waiting(20_900);
  };

  it('con `pausedMaxS`, en pausa basta con eso aunque los atascos hayan subido el colchón a 10 s', () => {
    const stall = new StallDetector(4, { pausedMaxS: 4 });
    escalate(stall);
    /* La sala espera a este aparato (vídeo en pausa): 4 s por delante bastan. */
    expect(stall.update({ ...base, now: 21_000, currentTime: 0, paused: true, aheadS: 3 })).toBe(
      true,
    );
    expect(stall.update({ ...base, now: 21_500, currentTime: 0, paused: true, aheadS: 4 })).toBe(
      false,
    );
    /* Sin la opción (hls.js), lo de siempre: 10 s. */
    const mse = new StallDetector(4);
    escalate(mse);
    expect(mse.update({ ...base, now: 21_500, currentTime: 0, paused: true, aheadS: 4 })).toBe(
      true,
    );
  });

  it('reproduciendo, el colchón pedido sigue siendo el que han subido los atascos', () => {
    const stall = new StallDetector(4, { pausedMaxS: 4 });
    escalate(stall);
    expect(stall.update({ ...base, now: 20_500, currentTime: 0, paused: false, aheadS: 4 })).toBe(
      true,
    );
  });
});

describe('pausedSeek: el salto en pausa, una vez por orden (§16)', () => {
  const input = {
    rev: 7,
    target: 147.5,
    localS: 145.2,
    last: null,
    now: 10_000,
    backoffMs: 4_000,
    waitedFor: false,
  };

  it('sin salto anterior, o con otro objetivo, salta', () => {
    expect(pausedSeek(input)).toEqual({ to: 147.5, rev: 7, at: 10_000, retries: 0 });
    const last = { to: 147.5, rev: 7, at: 9_900, retries: 1 };
    expect(pausedSeek({ ...input, rev: 8, target: 160, last })).toEqual({
      to: 160,
      rev: 8,
      at: 10_000,
      retries: 0,
    });
  });

  it('otro `rev` con el mismo objetivo («esperando a…», «entra…») no es una orden nueva', () => {
    const last = { to: 147.5, rev: 7, at: 9_900, retries: 1 };
    expect(pausedSeek({ ...input, rev: 8, localS: 147.1, last })).toBeNull();
    expect(pausedSeek({ ...input, rev: 9, localS: 146, last, now: 60_000 })).toBeNull();
  });

  it('al mismo objetivo con la misma orden no vuelve a saltar aunque Safari quedara unas décimas al lado', () => {
    const last = { to: 147.5, rev: 7, at: 9_000, retries: 0 };
    /* Cayó a 0,4 s (más de los 0,3 s de la colocación en pausa): se da por colocado. */
    expect(pausedSeek({ ...input, localS: 147.1, last, now: 20_000 })).toBeNull();
    /* Lo mismo con una diferencia de milésimas en el objetivo. */
    expect(pausedSeek({ ...input, target: 147.52, localS: 147.1, last, now: 20_000 })).toBeNull();
  });

  it('un reintento, solo si quedó a más de driftSeekS y pasado el freno; luego ya no', () => {
    const last = { to: 147.5, rev: 7, at: 10_000, retries: 0 };
    const far = 147.5 - PARTY.driftSeekS - 1.4;
    expect(pausedSeek({ ...input, localS: far, last, now: 13_999 })).toBeNull();
    const retry = pausedSeek({ ...input, localS: far, last, now: 14_000 });
    expect(retry).toEqual({ to: 147.5, rev: 7, at: 14_000, retries: 1 });
    expect(pausedSeek({ ...input, localS: far, last: retry, now: 30_000 })).toBeNull();
  });

  it('si la sala espera a este aparato y está cerca, no se mueve (que llene el colchón ahí)', () => {
    expect(pausedSeek({ ...input, localS: 147.5 - 1.2, waitedFor: true })).toBeNull();
    expect(pausedSeek({ ...input, localS: 147.5 - WAITED_STAY_S, waitedFor: true })).toBeNull();
    /* Más lejos, sí (un servidor viejo que para la sala por delante). */
    expect(pausedSeek({ ...input, localS: 145.2, waitedFor: true })).toMatchObject({ to: 147.5 });
  });
});

describe('correction: el umbral del salto mientras se absorbe lo que quedó al colocarse', () => {
  it('con `seekS`, hasta ahí corrige con la velocidad; más allá, salta', () => {
    expect(correction(146, 147.5, true)).toEqual({ kind: 'seek', to: 147.5 });
    expect(correction(146, 147.5, true, WAITED_STAY_S)).toEqual({
      kind: 'rate',
      rate: 1 + PARTY.driftRate,
    });
    expect(correction(149, 147.5, true, WAITED_STAY_S)).toEqual({
      kind: 'rate',
      rate: 1 - PARTY.driftRate,
    });
    expect(correction(145, 147.5, true, WAITED_STAY_S)).toEqual({ kind: 'seek', to: 147.5 });
  });
});

describe('forwardBufferEnd', () => {
  it('une los tramos separados por huecos pequeños; no cruza un hueco grande', () => {
    expect(
      forwardBufferEnd(
        [
          [100, 106],
          [106.04, 130],
        ],
        100,
      ),
    ).toBe(130);
    expect(
      forwardBufferEnd(
        [
          [100, 106],
          [110, 130],
        ],
        100,
      ),
    ).toBe(106);
    expect(
      forwardBufferEnd(
        [
          [0, 50],
          [100, 106],
          [106.2, 120],
        ],
        100.3,
      ),
    ).toBe(120);
    /* Un tramo que empieza justo después del cabezal cuenta (Safari tras un salto). */
    expect(forwardBufferEnd([[100.3, 110]], 100)).toBe(110);
    expect(forwardBufferEnd([[0, 50]], 100)).toBe(100);
    expect(forwardBufferEnd([], 7)).toBe(7);
  });
});
