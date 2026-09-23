/* La máquina de estados completa de una fuente (arquitectura §5.9) y la de
   sus informes (backend-modulos §7.4), transición a transición. */

import type { SourceReport } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { scannerRetryPlan } from '../scanner/evidence.js';
import { normalizeSourceReport } from './reports.js';
import {
  API_NAME_OF_STATE,
  INITIAL_SOURCE,
  stepReport,
  stepSource,
  verdictPolicy,
  type SourceMachine,
} from './state-machine.js';

const MIN = 60_000;
const policy = verdictPolicy(10 * MIN);

function walk(start: SourceMachine, events: Parameters<typeof stepSource>[1][]): string[] {
  const states: string[] = [];
  let machine = start;
  for (const event of events) {
    machine = stepSource(machine, event, policy);
    states.push(machine.state);
  }
  return states;
}

const verdict = (
  state: 'working' | 'weak' | 'failed',
  reason: string,
  now: number,
  by = 'scanner',
) => ({
  type: 'verdict' as const,
  result: { state, reason, by },
  now,
});

describe('máquina de una fuente', () => {
  it('desconocida → comprobando → verificada / floja / fallida', () => {
    for (const [state, expected] of [
      ['working', 'verificada'],
      ['weak', 'floja'],
      ['failed', 'fallida'],
    ] as const) {
      expect(walk(INITIAL_SOURCE, [{ type: 'check', now: 0 }, verdict(state, 'x', 1)])).toEqual([
        'comprobando',
        expected,
      ]);
    }
    expect(Object.values(API_NAME_OF_STATE)).toEqual([
      'queued',
      'checking',
      'working',
      'weak',
      'failed',
    ]);
  });

  it('verificada que falla una sonda por la red → floja; el segundo fallo seguido → fallida', () => {
    expect(
      walk(INITIAL_SOURCE, [
        verdict('working', 'playable_media', 0),
        { type: 'check', now: MIN },
        verdict('failed', 'timeout', MIN),
        { type: 'check', now: 2 * MIN },
        verdict('failed', 'timeout', 2 * MIN),
      ]),
    ).toEqual(['verificada', 'comprobando', 'floja', 'comprobando', 'fallida']);
  });

  it('lo que habla del vídeo no se suaviza: unsupported_codec y no_video → fallida directa', () => {
    for (const reason of ['unsupported_codec', 'no_video']) {
      expect(
        walk(INITIAL_SOURCE, [verdict('working', 'x', 0), verdict('failed', reason, MIN)]),
      ).toEqual(['verificada', 'fallida']);
    }
  });

  it('una verificada de hace más de 10 min ya no se suaviza (y ya era desconocida)', () => {
    expect(
      walk(INITIAL_SOURCE, [
        verdict('working', 'x', 0),
        { type: 'tick', now: 10 * MIN + 1 },
        verdict('failed', 'timeout', 10 * MIN + 1),
      ]),
    ).toEqual(['verificada', 'desconocida', 'fallida']);
  });

  it('el reproductor manda 3 min sobre cualquier sonda; después vuelve a mandar la sonda', () => {
    expect(
      walk(INITIAL_SOURCE, [
        verdict('working', 'player_ok', 0, 'player'),
        verdict('failed', 'timeout', MIN),
        verdict('failed', 'no_video', 2 * MIN),
        verdict('failed', 'player_failed', 2 * MIN, 'player'),
        verdict('working', 'playable_media', 4 * MIN),
        verdict('failed', 'timeout', 5 * MIN + 1),
      ]),
    ).toEqual(['verificada', 'verificada', 'verificada', 'fallida', 'fallida', 'fallida']);
    expect(
      walk(INITIAL_SOURCE, [
        verdict('weak', 'player_dropped', 0, 'player'),
        verdict('working', 'x', 3 * MIN),
      ]),
    ).toEqual(['floja', 'verificada']);
  });

  it('todo caduca a desconocida: 10 min lo bueno, el retraso de reintento lo fallido', () => {
    const shortBad = verdictPolicy(2 * MIN);
    let machine = stepSource(INITIAL_SOURCE, verdict('failed', 'timeout', 0), shortBad);
    expect(stepSource(machine, { type: 'tick', now: 2 * MIN }, shortBad).state).toBe('fallida');
    expect(stepSource(machine, { type: 'tick', now: 2 * MIN + 1 }, shortBad).state).toBe(
      'desconocida',
    );
    for (const state of ['working', 'weak'] as const) {
      machine = stepSource(INITIAL_SOURCE, verdict(state, 'x', 0), policy);
      expect(stepSource(machine, { type: 'tick', now: 10 * MIN }, policy).state).not.toBe(
        'desconocida',
      );
      const expired = stepSource(machine, { type: 'tick', now: 10 * MIN + 1 }, policy);
      expect(expired).toEqual({ state: 'desconocida', entry: null });
    }
    const checking = stepSource(INITIAL_SOURCE, { type: 'check', now: 0 }, policy);
    expect(stepSource(checking, { type: 'tick', now: 99 * MIN }, policy).state).toBe('comprobando');
  });

  it('fallida → comprobando: un único reintento, nunca con unsupported_codec', () => {
    expect(scannerRetryPlan({ state: 'failed', reason: 'timeout' }, 1, 0, 10 * MIN)).toMatchObject({
      state: 'retry_wait',
      retryAt: 10 * MIN,
    });
    expect(scannerRetryPlan({ state: 'failed', reason: 'timeout' }, 2, 0)).toBeNull();
    expect(scannerRetryPlan({ state: 'failed', reason: 'unsupported_codec' }, 1, 0)).toBeNull();
    expect(scannerRetryPlan({ state: 'weak', reason: 'starved' }, 1, 0)).toBeNull();
  });
});

describe('máquina de un informe', () => {
  const NOW = 1_000_000;
  const base = (reason: string): SourceReport =>
    normalizeSourceReport(
      { id: 'a'.repeat(40), reason, state: 'checking', reportId: 'r' },
      NOW,
    ) as SourceReport;

  it('checking → working / weak / failed / reported según motivo y sonda', () => {
    const cases: [string, string, string][] = [
      ['not_starting', 'working', 'working'],
      ['not_starting', 'weak', 'weak'],
      ['not_starting', 'failed', 'failed'],
      ['audio', 'working', 'reported'],
      ['bad_quality', 'weak', 'reported'],
      ['stuttering', 'failed', 'failed'],
      ['wrong_channel', 'working', 'reported'],
      ['wrong_channel', 'failed', 'reported'],
    ];
    for (const [reason, probe, expected] of cases) {
      const next = stepReport(base(reason), { type: 'probe', outcome: { state: probe }, now: NOW });
      expect(next.state, `${reason}/${probe}`).toBe(expected);
    }
  });

  it('sin comprobación → reported; confirmar el canal levanta solo el de canal equivocado', () => {
    expect(stepReport(base('audio'), { type: 'unchecked' }).state).toBe('reported');
    const confirmed = stepReport(base('wrong_channel'), { type: 'confirmed', at: 'x' });
    expect(confirmed).toMatchObject({
      state: 'working',
      quarantineUntil: null,
      lastCheckedAt: 'x',
    });
    const other = base('audio');
    expect(stepReport(other, { type: 'confirmed', at: 'x' })).toBe(other);
  });
});
