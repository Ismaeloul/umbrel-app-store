/* El servicio de fuentes con estado en memoria y el comprobador de guion:
   resultados de reproducción (T-094), informes y su comprobación (B-052,
   B-053), correcciones (B-054) y los arreglos de arquitectura §5.9. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../core/logger.js';
import type { TestCore } from '../../../test/helpers/index.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { notImplementedService } from '../../core/stub.js';
import { tick } from '../scanner/test-support.js';
import type { ScannerService } from '../scanner/types.js';
import type { StateService } from '../state/types.js';
import { createSourcesService } from './index.js';
import {
  SOURCE_QUALITY_QUARANTINE_MS,
  SOURCE_REPORT_QUARANTINE_MS,
  normalizeSourceReport,
} from './reports.js';
import { createTestSources } from './test-support.js';
import type { SourcesService } from './types.js';

const MIN = 60_000;
const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);
const ELCANO = 'LIGA DE CAMPEONES --> ELCANO';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function core(enabled = true, logger = createSilentLogger()): TestCore {
  return createTestCore({ env: enabled ? { ACESTREAM_SCANNER_HOST: 'scanner' } : {}, logger });
}

async function started(testCore: TestCore, options: Parameters<typeof createTestSources>[1] = {}) {
  const made = createTestSources(testCore, options);
  await made.sources.start();
  cleanups.push(async () => {
    await made.sources.stop();
    await made.scanner.stop();
  });
  const settle = (ms: number): Promise<void> => tick(testCore.clock, ms, 100);
  return { ...made, settle };
}

describe('resultado de reproducir (B-055, B-056)', () => {
  it('T-094 · el veredicto de una reproduccion se guarda por hash y por proveedor', async () => {
    const { sources, scanner, state } = await started(core());
    const resultado = await sources.outcome({
      id: '9'.repeat(40),
      title: ELCANO,
      resultado: 'arranco',
      segundos: 0,
    });
    expect(resultado.hash?.intentos).toBe(1);
    expect(resultado.hash?.exitos).toBe(1);
    expect(resultado.proveedor?.exitos).toBe(1);
    await expect(
      sources.outcome({ id: '9'.repeat(40), resultado: 'loquesea' }),
    ).rejects.toMatchObject({
      code: 'bad_outcome',
    });
    await expect(sources.outcome({ id: 'x', resultado: 'arranco' })).rejects.toMatchObject({
      code: 'bad_outcome',
    });
    expect(state.writes).toEqual([['stats']]);
    expect(state.get().sourceStats.proveedores.elcano?.intentos).toBe(1);
    expect(scanner.verdict('9'.repeat(40))).toMatchObject({ state: 'working', by: 'player' });
  });

  it('"sigue" renueva el veredicto del reproductor sin escribir nada', async () => {
    const { sources, scanner, state } = await started(core(false));
    await expect(sources.outcome({ id: ID_A, resultado: 'sigue' })).resolves.toEqual({
      hash: null,
      proveedor: null,
    });
    expect(state.writes).toEqual([]);
    expect(scanner.playerVerdictHeld(ID_A)).toBe(true);
  });

  it('caerse enseguida en un hash nuevo no deja nada que contar; el proveedor por defecto es "otros"', async () => {
    const { sources, scanner, state } = await started(core());
    const result = await sources.outcome({ id: ID_A, resultado: 'cayo', segundos: '12' });
    expect(result).toEqual({ hash: null, proveedor: null });
    expect(scanner.verdict(ID_A)).toMatchObject({ state: 'failed', reason: 'player_failed' });
    const long = await sources.outcome({
      id: ID_B,
      resultado: 'fallo',
      segundos: 1e9,
      listaId: 'principal',
    });
    expect(long.proveedor).toMatchObject({ intentos: 1 });
    expect(Object.keys(state.get().sourceStats.proveedores)).toEqual(['principal']);
    const dropped = await sources.outcome({ id: ID_B, resultado: 'cayo', segundos: 600 });
    expect(dropped.hash).toMatchObject({ caidas: 1, segundos: 600 });
    expect(scanner.verdict(ID_B)).toMatchObject({ state: 'weak', reason: 'player_dropped' });
    const titleArrow = await sources.outcome({ id: ID_B, resultado: 'fallo', title: 'Canal --> ' });
    expect(titleArrow.proveedor).toBeNull();
  });
});

describe('informes y su comprobación (B-052, B-053; arquitectura §5.9)', () => {
  it('no_starting que la sonda da por viva: se levanta la cuarentena', async () => {
    const { sources, script, state, settle } = await started(core());
    const response = await sources.report({
      id: ID_A,
      reason: 'raro',
      channel: 'DAZN 1',
      ih: true,
    });
    expect(response.report).toMatchObject({
      reason: 'not_starting',
      state: 'checking',
      channel: 'DAZN 1',
    });
    expect(response.scan).toMatchObject({ total: 1, initialCount: 1 });
    expect(response.scan?.statusUrl).toBe(`/api/football/scan?id=${response.scan?.id}`);
    await settle(3000);
    const saved = state.get().sourceReports[0];
    expect(saved).toMatchObject({
      state: 'working',
      checkReason: 'playable_media',
      quarantineUntil: null,
    });
    expect(saved?.lastCheckedAt).not.toBeNull();
    expect(script.calls.meta).toEqual([ID_A]);
    expect(script.calls.stops).toEqual([ID_A]);
    expect(state.writes).toEqual([['reports', 'learning'], ['reports']]);
  });

  it('corte, calidad o audio con la señal viva: "reported" 10 min más', async () => {
    const testCore = core();
    const { sources, state, settle } = await started(testCore);
    await sources.report({ id: ID_A, reason: 'stuttering', channel: 'DAZN 1' });
    await settle(3000);
    const saved = state.get().sourceReports[0];
    expect(saved?.state).toBe('reported');
    expect(Date.parse(saved?.quarantineUntil ?? '')).toBe(
      Date.parse(saved?.lastCheckedAt ?? '') + SOURCE_QUALITY_QUARANTINE_MS,
    );
  });

  it('una sonda fallida espera su reintento en checking y al final renueva 30 min', async () => {
    const testCore = core();
    const { sources, state, settle } = await started(testCore, { outcomes: { [ID_A]: 'failed' } });
    await sources.report({ id: ID_A, channel: 'DAZN 1' });
    await settle(3000);
    expect(state.get().sourceReports[0]?.state).toBe('checking');
    await settle(10 * MIN + 1000);
    const saved = state.get().sourceReports[0];
    expect(saved?.state).toBe('failed');
    expect(saved?.checkReason).toBe('no_media');
    expect(Date.parse(saved?.quarantineUntil ?? '')).toBeGreaterThan(
      testCore.clock.now() + SOURCE_REPORT_QUARANTINE_MS - 5000,
    );
  });

  it('§8.2.8: si manda el reproductor, el informe no borra su veredicto ni prueba la fuente', async () => {
    const { sources, scanner, script, state, settle } = await started(core());
    await sources.outcome({ id: ID_A, resultado: 'arranco' });
    const response = await sources.report({ id: ID_A, reason: 'not_starting', channel: 'DAZN 1' });
    expect(response.scan).not.toBeNull();
    expect(scanner.verdict(ID_A)?.by).toBe('player');
    await settle(3000);
    expect(script.calls.meta).toEqual([]);
    expect(state.get().sourceReports[0]).toMatchObject({
      state: 'working',
      checkReason: 'player_ok',
    });
  });

  it('sin veredicto del reproductor, el informe sí borra el guardado (como la 0.6.59)', async () => {
    const { sources, scanner } = await started(core());
    scanner.recordVerdict(ID_A, { state: 'working', reason: 'playable_media', by: 'scanner' });
    await sources.report({ id: ID_A, channel: 'DAZN 1' });
    expect(scanner.verdict(ID_A)).toBeNull();
  });

  it('un informe repetido cancela su trabajo anterior sin quedarse en reported', async () => {
    const { sources, state, settle } = await started(core());
    const first = await sources.report({ id: ID_A, reason: 'audio', channel: 'DAZN 1' });
    const second = await sources.report({ id: ID_A, reason: 'audio', channel: 'DAZN 1' });
    expect(second.report.reportId).toBe(first.report.reportId);
    expect(second.scan?.id).not.toBe(first.scan?.id);
    await settle(10);
    expect(state.get().sourceReports[0]).toMatchObject({ state: 'checking', reportCount: 2 });
    await settle(5000);
    expect(state.get().sourceReports).toHaveLength(1);
    expect(state.get().sourceReports[0]?.state).toBe('reported');
    expect(state.get().sourceReports[0]?.checkReason).toBe('playable_media');
  });

  it('§8.2.11: si su trabajo se cancela, el informe pasa de checking a reported', async () => {
    const { sources, scanner, state, settle } = await started(core());
    await sources.report({ id: ID_A, channel: 'DAZN 1' });
    await scanner.stop();
    await settle(10);
    expect(state.get().sourceReports[0]?.state).toBe('reported');
  });

  it('api.md §6.8: sin comprobador, el informe se guarda ya como reported (una sola escritura)', async () => {
    const { sources, state } = await started(core(false));
    const response = await sources.report({
      id: ID_A,
      reason: 'wrong_channel',
      channel: 'M+ Liga',
    });
    expect(response.scan).toBeNull();
    expect(response.report.state).toBe('reported');
    expect(state.get().sourceReports[0]?.state).toBe('reported');
    expect(state.get().channelFeedback[0]?.verdict).toBe('incorrect');
    expect(state.writes).toEqual([['reports', 'learning']]);
  });

  it('el canal de la agenda cuando el cuerpo no trae canal (api.md §4.14)', async () => {
    const { sources } = await started(core(false));
    const programChannels = vi.fn(() => ['DAZN LaLiga', 'DAZN']);
    const fromProgram = await sources.report({ id: ID_A, matchId: 'm-1' }, { programChannels });
    expect(fromProgram.report.channel).toBe('DAZN LaLiga');
    expect(programChannels).toHaveBeenCalledWith('m-1');
    const own = await sources.report(
      { id: ID_B, matchId: 'm-1', channel: 'M+' },
      { programChannels },
    );
    expect(own.report.channel).toBe('M+');
    expect(programChannels).toHaveBeenCalledTimes(1);
    const none = await sources.report({ id: ID_B, matchId: 'm-2' }, { programChannels: () => [] });
    expect(none.report.channel).toBe('');
  });

  it('un informe sin hash: bad_request y no se escribe', async () => {
    const { sources, state } = await started(core());
    await expect(sources.report({ id: 'nada' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(sources.report(null as unknown as Record<string, unknown>)).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(state.writes).toEqual([]);
  });

  it('al arrancar, los informes que quedaron en checking pasan a reported; start y stop idempotentes', async () => {
    const stuck = normalizeSourceReport({ id: ID_A, state: 'checking', reportId: 'r0' }, 0);
    const done = normalizeSourceReport({ id: ID_B, state: 'failed', reportId: 'r1' }, 0);
    const { sources, state } = await started(core(), {
      state: { sourceReports: [stuck, done].filter((item) => item !== null) },
    });
    expect(state.get().sourceReports.map((item) => item.state)).toEqual(['reported', 'failed']);
    await sources.start();
    expect(state.writes).toHaveLength(1);
    await sources.stop();
    await sources.stop();
  });

  it('un fallo al guardar la comprobación se anota y no tumba nada (B-028)', async () => {
    const logger = createSilentLogger();
    const error = vi.spyOn(logger, 'error');
    const { sources, state, settle } = await started(core(true, logger));
    await sources.report({ id: ID_A, channel: 'DAZN 1' });
    state.failNextWrite();
    await settle(3000);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: expect.any(String) }),
      '[sources] no se pudo anotar la comprobación',
    );
    expect(state.get().sourceReports[0]?.state).toBe('checking');
  });

  it('avisos de trabajos que no son de un informe vigente se ignoran', async () => {
    const testCore = core();
    const { state } = await started(testCore);
    testCore.bus.emit('scan.jobDone', {
      jobId: '0'.repeat(24),
      kind: 'report',
      status: 'complete',
      matchId: null,
      reportKey: 'r-desconocido',
      total: 1,
      playable: 1,
    });
    testCore.bus.emit('scan.jobDone', {
      jobId: '0'.repeat(24),
      kind: 'interactive',
      status: 'complete',
      matchId: null,
      reportKey: null,
      total: 1,
      playable: 1,
    });
    await tick(testCore.clock, 10);
    expect(state.writes).toEqual([]);
  });

  it('un estado que aún no se puede leer al arrancar solo deja un error en el log', async () => {
    const logger = createSilentLogger();
    const error = vi.spyOn(logger, 'error');
    const testCore = core(false, logger);
    const sources = createSourcesService({
      ...testCore,
      state: notImplementedService<StateService>('state'),
      scanner: notImplementedService<ScannerService>('scanner'),
    });
    await sources.start();
    await sources.stop();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('correcciones y lecturas (B-054, B-057)', () => {
  it('"es el canal correcto": guarda, cuenta y levanta el canal equivocado', async () => {
    const { sources, state } = await started(core(false));
    await sources.report({ id: ID_A, reason: 'wrong_channel', channel: 'M+ Liga' });
    const response = await sources.feedback({ id: ID_A, channel: 'M+ Liga', verdict: 'correct' });
    expect(response).toMatchObject({
      learningCount: 1,
      feedback: { verdict: 'correct', corrections: 2 },
    });
    expect(state.get().sourceReports[0]).toMatchObject({ state: 'working', quarantineUntil: null });
    await expect(
      sources.feedback({ id: ID_A, verdict: 'quizas', channel: 'x' }),
    ).rejects.toMatchObject({
      code: 'bad_feedback',
    });
    expect(state.writes).toHaveLength(2);
  });

  it('reglas aprendidas, fiabilidad, cuentas y funciones puras', async () => {
    const testCore = core(false);
    const { sources } = await started(testCore);
    await sources.report({ id: ID_A, reason: 'not_starting', channel: 'DAZN 1' });
    await sources.feedback({ id: ID_B, channel: 'DAZN 1', verdict: 'correct' });
    await sources.outcome({ id: ID_B, resultado: 'arranco', title: ELCANO });
    const candidate = (id: string) =>
      ({
        id,
        title: 'DAZN 1 --> ELCANO',
        alias: null,
        ih: false,
        source: 'm3u',
        score: 90,
        matchedChannel: 'DAZN 1',
        soloFamilia: false,
        familyFallbackAllowed: false,
        listaId: null,
        availability: null,
        bitrate: null,
        learned: null,
        reported: null,
        rejectedByLearning: false,
        quarantined: false,
      }) as const;
    const learned = sources.applyLearnedRules(['DAZN 1'], [candidate(ID_A), candidate(ID_B)]);
    expect(learned.map((item) => [item.id, item.score])).toEqual([[ID_B, 98]]);
    expect(
      sources.applyLearnedRules(['DAZN 1'], [candidate(ID_A)], testCore.clock.now() + 31 * MIN),
    ).toHaveLength(1);
    expect(sources.reliability(candidate(ID_B))).toBeGreaterThan(0);
    expect(sources.reliability(candidate('c'.repeat(40)))).toBeCloseTo(
      (sources.reliableRate({ intentos: 1, exitos: 1 }) ?? 0) * 0.9,
    );
    expect(sources.counts()).toEqual({ total: 1, quarantined: 1, learningCount: 1 });
    expect(sources.addOutcome(null, 'arranco', 0, 5)).toMatchObject({
      intentos: 1,
      exitos: 1,
      ultimo: 5,
    });
    expect(sources.reliableRate(null)).toBeNull();
    expect(sources.providerOf({ title: 'x --> Y' })).toBe('y');
  });
});

describe('fábrica', () => {
  it('createSourcesService monta el servicio real', async () => {
    const testCore = core(false);
    const { state } = createTestSources(testCore);
    const sources: SourcesService = createSourcesService({
      ...testCore,
      state,
      scanner: notImplementedService<ScannerService>('scanner'),
    });
    expect(sources.counts()).toEqual({ total: 0, quarantined: 0, learningCount: 0 });
  });
});
