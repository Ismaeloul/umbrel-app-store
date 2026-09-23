/* Informes, cuarentenas y correcciones como funciones puras (T-076, T-077;
   B-052 a B-054, B-066) y contraste con la 0.6.59. */

import { normalizeChannelKey, type ChannelFeedback, type SourceReport } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_EPOCH } from '../../core/clock.js';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import * as scannerLegacy from '../scanner/legacy-exports.js';
import * as legacy from './legacy-exports.js';
import {
  SOURCE_QUALITY_QUARANTINE_MS,
  SOURCE_REPORT_QUARANTINE_MS,
  SOURCE_WRONG_CHANNEL_QUARANTINE_MS,
  applyLearnedSourceRules,
  buildFeedback,
  buildReport,
  normalizeChannelFeedback,
  normalizeChannelFeedbacks,
  normalizeSourceReport,
  normalizeSourceReports,
  publicSourceReport,
  quarantineMsFor,
  reportAfterProbe,
  reportWithoutProbe,
  sourceReportApplies,
  validIso,
} from './reports.js';

type AnyFn = (...args: unknown[]) => unknown;
const original = loadLegacyServer() as unknown as Record<string, AnyFn>;

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const ID_C = 'c'.repeat(40);
const NOW = FAKE_CLOCK_EPOCH;
const iso = (ms: number): string => new Date(ms).toISOString();

function report(extra: Record<string, unknown> = {}): SourceReport {
  return normalizeSourceReport({ id: ID_A, reportId: 'r1', ...extra }, NOW) as SourceReport;
}

describe('normalización (B-052, B-054)', () => {
  it('T-076 · normaliza reportes y correcciones locales sin aceptar motivos arbitrarios', () => {
    const r = normalizeSourceReport(
      {
        id: ID_A,
        title: 'M+ Liga de Campeones',
        channel: 'Movistar Liga de Campeones',
        reason: 'wrong_channel',
        state: 'checking',
        quarantineUntil: iso(NOW + 60_000),
      },
      NOW,
    );
    expect(r?.id).toBe(ID_A);
    expect(r?.reason).toBe('wrong_channel');
    expect(r?.channelKey).toBe(normalizeChannelKey('Movistar Liga de Campeones'));
    const fallback = normalizeSourceReport({ id: ID_B, reason: 'inventado' }, NOW);
    expect(fallback?.reason).toBe('not_starting');

    const feedback = normalizeChannelFeedback(
      { id: ID_A, channel: 'M+ Liga de Campeones', verdict: 'correct' },
      NOW,
    );
    expect(feedback?.verdict).toBe('correct');
    expect(
      normalizeChannelFeedback({ id: ID_A, channel: 'M+', verdict: 'quizas' }, NOW),
    ).toBeNull();
  });

  it('los valores raros se sanean como en la 0.6.59', () => {
    const r = normalizeSourceReport(
      {
        id: `acestream://${ID_A.toUpperCase()}`,
        reportId: 'r!1 ',
        source: 'x'.repeat(50),
        matchId: 'fltv 2026/09*1',
        state: 'raro',
        checkReason: 'no media!',
        reportCount: '2000',
        reportedAt: 'ayer',
        lastCheckedAt: iso(NOW),
      },
      NOW,
      () => 'nunca',
    );
    expect(r).toMatchObject({
      id: ID_A,
      reportId: 'r1',
      source: 'x'.repeat(30),
      matchId: 'fltv2026091',
      state: 'reported',
      checkReason: 'nomedia',
      reportCount: 999,
      reportedAt: iso(NOW),
      lastCheckedAt: iso(NOW),
      quarantineUntil: null,
      title: `Stream ${ID_A.slice(0, 8)}`,
    });
    expect(normalizeSourceReport({ id: 'x' }, NOW)).toBeNull();
    expect(normalizeSourceReport(null, NOW)).toBeNull();
    expect(normalizeSourceReport({ id: ID_A }, NOW)?.reportId).toMatch(/^[a-f0-9]{16}$/);
    const onlyKey = normalizeChannelFeedback(
      { id: ID_A, channelKey: 'dazn 1', verdict: 'incorrect' },
      NOW,
    );
    expect(onlyKey).toMatchObject({ channel: 'dazn 1', reason: 'wrong_channel', corrections: 1 });
    expect(validIso(5)).toBeNull();
  });

  it('listas: uno por terna o por pareja y 300 como máximo', () => {
    const reports = normalizeSourceReports(
      [
        { id: ID_A, channel: 'X', reason: 'audio' },
        { id: ID_A, channel: 'x', reason: 'audio' },
        { id: 'malo' },
        ...Array.from({ length: 310 }, (_, n) => ({ id: ID_B, channel: `C${n}` })),
      ],
      NOW,
    );
    expect(reports).toHaveLength(300);
    expect(normalizeSourceReports('nada', NOW)).toEqual([]);
    const feedback = normalizeChannelFeedbacks(
      [
        { id: ID_A, channel: 'X', verdict: 'correct' },
        { id: ID_A, channel: 'x', verdict: 'incorrect' },
        { id: ID_A, verdict: 'correct' },
        ...Array.from({ length: 310 }, (_, n) => ({
          id: ID_B,
          channel: `C${n}`,
          verdict: 'correct',
        })),
      ],
      NOW,
    );
    expect(feedback).toHaveLength(300);
    expect(feedback[0]?.verdict).toBe('correct');
  });

  it('contraste con la 0.6.59 (con reportId y fechas fijadas)', () => {
    const values = [
      {
        id: ID_A,
        reportId: 'k',
        reportedAt: iso(NOW),
        channel: '<b>DAZN</b> &amp; 1',
        reason: 'audio',
      },
      {
        id: `acestream://${ID_B}`,
        reportId: 'k',
        reportedAt: iso(NOW),
        channelKey: 'M+ Liga',
        ih: true,
      },
      { id: ID_C, reportId: 'k', reportedAt: iso(NOW), reportCount: 7.9, quarantineUntil: 'x' },
    ];
    for (const value of values) {
      expect(normalizeSourceReport(value, NOW)).toEqual(original.normalizeSourceReport?.(value));
      const feedback = { ...value, verdict: 'incorrect', updatedAt: iso(NOW) };
      expect(normalizeChannelFeedback(feedback, NOW)).toEqual(
        original.normalizeChannelFeedback?.(feedback),
      );
    }
  });
});

describe('reglas aprendidas en la resolución (B-054, B-066)', () => {
  it('T-077 · la correccion humana manda sobre la IA y la cuarentena', () => {
    const channel = 'M+ Liga de Campeones';
    const state = {
      channelFeedback: [
        normalizeChannelFeedback({ id: ID_A, channel, verdict: 'incorrect' }, NOW),
        normalizeChannelFeedback({ id: ID_B, channel, verdict: 'correct' }, NOW),
      ],
      sourceReports: [
        normalizeSourceReport(
          {
            id: ID_C,
            channel,
            reason: 'not_starting',
            state: 'failed',
            quarantineUntil: iso(NOW + 60_000),
          },
          NOW,
        ),
      ],
    };
    const candidates = applyLearnedSourceRules(
      state,
      [channel],
      [
        { id: ID_A, title: channel, score: 100 },
        { id: ID_B, title: 'Rotulo raro ELCANO', score: 12 },
        { id: ID_C, title: channel, score: 100 },
      ],
      NOW,
    );
    expect(candidates.map((item) => item.id)).toEqual([ID_B]);
    expect(candidates[0]?.score).toBe(98);
    expect(candidates[0]?.learned).toBe('correct');
    expect(
      legacy.applyLearnedSourceRules(state, [channel], [{ id: ID_B, score: 99 }], NOW)[0]?.score,
    ).toBe(99);
  });

  it('un canal equivocado solo aparta en ese canal; una cuarentena vencida no aparta', () => {
    const wrong = report({
      reason: 'wrong_channel',
      channel: 'DAZN 1',
      quarantineUntil: iso(NOW + 1000),
    });
    const keys = new Set([normalizeChannelKey('DAZN 1')]);
    expect(sourceReportApplies(wrong, keys, NOW)).toBe(true);
    expect(sourceReportApplies(wrong, new Set(['otro']), NOW)).toBe(false);
    expect(sourceReportApplies({ ...wrong, channelKey: '' }, keys, NOW)).toBe(false);
    expect(sourceReportApplies(wrong, keys, NOW + 1000)).toBe(false);
    expect(sourceReportApplies(null, keys, NOW)).toBe(false);
    const kept = applyLearnedSourceRules(
      { sourceReports: [wrong] },
      ['DAZN 2'],
      [{ id: ID_A, score: 90 }],
      NOW,
    );
    expect(kept[0]).toMatchObject({ reported: null, quarantined: false, learned: null });
    expect(applyLearnedSourceRules(null, [], [{ id: ID_A, score: 1 }], NOW)).toHaveLength(1);
    const state = { sourceReports: [wrong], channelFeedback: [] as ChannelFeedback[] };
    const input = [{ id: ID_A, score: 90 }];
    expect(applyLearnedSourceRules(state, ['DAZN 2'], input, NOW)).toEqual(
      original.applyLearnedSourceRules?.(state, ['DAZN 2'], input, NOW),
    );
  });
});

describe('informes y correcciones (B-052, B-053, B-054)', () => {
  const empty = { sourceReports: [] as SourceReport[], channelFeedback: [] as ChannelFeedback[] };

  it('cuarentena por motivo: 30 min, 10 min o 30 días', () => {
    expect(quarantineMsFor('not_starting')).toBe(SOURCE_REPORT_QUARANTINE_MS);
    expect(quarantineMsFor('otro')).toBe(30 * 60_000);
    for (const reason of ['stuttering', 'bad_quality', 'audio']) {
      expect(quarantineMsFor(reason)).toBe(SOURCE_QUALITY_QUARANTINE_MS);
    }
    expect(quarantineMsFor('wrong_channel')).toBe(SOURCE_WRONG_CHANNEL_QUARANTINE_MS);
  });

  it('un informe nuevo: checking, cuarentena y, si es canal equivocado, la corrección', () => {
    const built = buildReport(
      empty,
      { id: ID_A, reason: 'wrong_channel', channel: 'M+ Liga', title: 'X --> ELCANO', ih: true },
      { now: NOW, newId: () => 'n1' },
    );
    expect(built.report).toMatchObject({
      reportId: 'n1',
      state: 'checking',
      reportCount: 1,
      ih: true,
      quarantineUntil: iso(NOW + SOURCE_WRONG_CHANNEL_QUARANTINE_MS),
    });
    expect(built.channelFeedback[0]).toMatchObject({ verdict: 'incorrect', corrections: 1 });
    const again = buildReport(
      built,
      { id: ID_A, reason: 'wrong_channel', channel: 'M+ Liga' },
      {
        now: NOW + 1,
      },
    );
    expect(again.report).toMatchObject({ reportId: 'n1', reportCount: 2 });
    expect(again.sourceReports).toHaveLength(1);
    expect(again.channelFeedback[0]?.corrections).toBe(2);
    const noChannel = buildReport(
      empty,
      { id: ID_B, reason: 'wrong_channel' },
      { now: NOW, newId: () => 'n2' },
    );
    expect(noChannel.channelFeedback).toEqual([]);
    const fromProgram = buildReport(
      empty,
      { id: ID_B, matchId: 'm1' },
      {
        now: NOW,
        programChannel: 'DAZN 1',
        newId: () => 'n3',
      },
    );
    expect(fromProgram.report).toMatchObject({ channel: 'DAZN 1', reason: 'not_starting' });
    expect(() => buildReport(empty, { id: 'nada' }, { now: NOW })).toThrowError(
      expect.objectContaining({ code: 'bad_request' }),
    );
  });

  it('"es el canal correcto" levanta los informes de canal equivocado de ese hash y canal', () => {
    const wrong = buildReport(
      empty,
      { id: ID_A, reason: 'wrong_channel', channel: 'M+ Liga' },
      {
        now: NOW,
        newId: () => 'w',
      },
    );
    const other = buildReport(
      wrong,
      { id: ID_A, reason: 'audio', channel: 'M+ Liga' },
      {
        now: NOW,
        newId: () => 'o',
      },
    );
    const built = buildFeedback(
      other,
      { id: ID_A, channel: 'M+ Liga', verdict: 'correct', corrections: 50 },
      NOW + 5,
    );
    expect(built.feedback).toMatchObject({
      verdict: 'correct',
      corrections: 2,
      updatedAt: iso(NOW + 5),
    });
    expect(built.channelFeedback).toHaveLength(1);
    const byReason = Object.fromEntries(built.sourceReports.map((r) => [r.reason, r]));
    expect(byReason.wrong_channel).toMatchObject({ state: 'working', quarantineUntil: null });
    expect(byReason.audio?.state).toBe('checking');
    const incorrect = buildFeedback(
      other,
      { id: ID_A, channel: 'M+ Liga', verdict: 'incorrect' },
      NOW,
    );
    expect(incorrect.sourceReports).toEqual(other.sourceReports);
    expect(() => buildFeedback(empty, { id: ID_A, verdict: 'correct' }, NOW)).toThrowError(
      expect.objectContaining({ code: 'bad_feedback' }),
    );
  });

  it('el destino tras la comprobación (updateReportFromProbe, B-053)', () => {
    const at = (reason: string, state: string) =>
      reportAfterProbe(
        report({ reason, state: 'checking' }),
        { state, reason: 'why', checkedAt: iso(NOW) },
        NOW,
      );
    expect(at('not_starting', 'working')).toMatchObject({
      state: 'working',
      quarantineUntil: null,
      checkReason: 'why',
      lastCheckedAt: iso(NOW),
    });
    expect(at('not_starting', 'weak').state).toBe('weak');
    expect(at('not_starting', 'failed')).toMatchObject({
      state: 'failed',
      quarantineUntil: iso(NOW + SOURCE_REPORT_QUARANTINE_MS),
    });
    expect(at('audio', 'working')).toMatchObject({
      state: 'reported',
      quarantineUntil: iso(NOW + SOURCE_QUALITY_QUARANTINE_MS),
    });
    expect(at('stuttering', 'failed').state).toBe('failed');
    expect(at('wrong_channel', 'working')).toMatchObject({
      state: 'reported',
      quarantineUntil: iso(NOW + SOURCE_WRONG_CHANNEL_QUARANTINE_MS),
    });
    const pending = report({ state: 'checking' });
    expect(reportAfterProbe(pending, { state: 'queued' }, NOW)).toBe(pending);
    expect(reportAfterProbe(pending, { state: 'weak' }, NOW)).toMatchObject({
      checkReason: '',
      lastCheckedAt: iso(NOW),
    });
    expect(reportWithoutProbe(pending).state).toBe('reported');
    const done = report({ state: 'working' });
    expect(reportWithoutProbe(done)).toBe(done);
  });

  it('forma pública y exportaciones antiguas', () => {
    expect(publicSourceReport(null)).toBeNull();
    expect(Object.keys(publicSourceReport(report()))).toEqual([
      'reportId',
      'id',
      'channel',
      'matchId',
      'reason',
      'state',
      'checkReason',
      'reportedAt',
      'lastCheckedAt',
      'quarantineUntil',
    ]);
    const response = legacy.reportSource(
      { sourceReports: [], channelFeedback: [] },
      { id: ID_A, reason: 'stuttering', channel: 'DAZN 1' },
      NOW,
    );
    expect(response).toMatchObject({
      success: true,
      scan: null,
      report: { state: 'checking', quarantineUntil: iso(NOW + SOURCE_QUALITY_QUARANTINE_MS) },
    });
    const saved = legacy.saveSourceFeedback(
      null,
      { id: ID_A, channel: 'DAZN 1', verdict: 'correct' },
      NOW,
    );
    expect(saved).toMatchObject({ success: true, learningCount: 1, feedback: { corrections: 1 } });
  });

  it('T-094 (exportación antigua) · registrarResultadoDeFuente por hash y por proveedor', () => {
    const id = '9'.repeat(40);
    const estado = { sourceStats: null };
    const resultado = legacy.registrarResultadoDeFuente(
      estado,
      { id, title: 'LIGA DE CAMPEONES --> ELCANO', resultado: 'arranco', segundos: 0 },
      NOW,
    );
    expect(resultado.success).toBe(true);
    expect(resultado.hash?.intentos).toBe(1);
    expect(resultado.hash?.exitos).toBe(1);
    expect(resultado.proveedor?.exitos).toBe(1);
    expect(() =>
      legacy.registrarResultadoDeFuente(estado, { id, resultado: 'loquesea' }),
    ).toThrowError(expect.objectContaining({ code: 'bad_outcome' }));
    expect(legacy.registrarResultadoDeFuente(estado, { id, resultado: 'sigue' }, NOW)).toEqual({
      success: true,
      hash: null,
      proveedor: null,
    });
    expect(scannerLegacy.playerVerdictHeld(id, NOW + 1000)).toBe(true);
    const sinProveedor = legacy.registrarResultadoDeFuente(
      estado,
      { id, title: 'Canal --> ', resultado: 'fallo', segundos: '5' },
      NOW,
    );
    expect(sinProveedor.proveedor).toBeNull();
  });
});
