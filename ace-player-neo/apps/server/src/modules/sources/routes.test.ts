/* Rutas de fuentes con su forma exacta de la 0.6.59 (api.md §4.14-4.16) y
   sus gemelas v1 (T-079, T-080, T-123). */

import { describe, expect, it } from 'vitest';
import { notImplementedService } from '../../core/stub.js';
import { createTestApp, createTestCore, web } from '../../../test/helpers/index.js';
import type { FootballService } from '../football/types.js';
import { createTestScanner, scriptedTransport } from '../scanner/test-support.js';
import { normalizeSourceReport } from './reports.js';
import { createMemoryState } from './test-support.js';

const ID_A = 'a'.repeat(40);

async function app(options: { scanner?: boolean; football?: FootballService } = {}) {
  const state = createMemoryState();
  const scanner = options.scanner
    ? createTestScanner(
        createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner' } }),
        scriptedTransport().transport,
      )
    : undefined;
  const made = await createTestApp({
    services: {
      state,
      ...(scanner ? { scanner } : {}),
      ...(options.football ? { football: options.football } : {}),
    },
  });
  const post = (url: string, payload: unknown) =>
    made.app.inject({ method: 'POST', url, headers: web(), payload: JSON.stringify(payload) });
  return { ...made, state, post };
}

describe('POST /api/sources/report (api.md §4.14)', () => {
  it('T-079 · reportar una fuente la pone en cuarentena y canal incorrecto se aprende', async () => {
    const { post, state, core } = await app();
    const response = await post('/api/sources/report', {
      id: ID_A,
      title: 'M+ Liga de Campeones --> ELCANO',
      channel: 'M+ Liga de Campeones',
      reason: 'wrong_channel',
      matchId: 'partido-1',
    });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.success).toBe(true);
    expect(data.report.reason).toBe('wrong_channel');
    expect(data.scan).toBeNull();
    const saved = state.get();
    expect(saved.sourceReports[0]?.id).toBe(ID_A);
    expect(Date.parse(saved.sourceReports[0]?.quarantineUntil ?? '')).toBeGreaterThan(
      core.clock.now(),
    );
    expect(saved.channelFeedback[0]?.verdict).toBe('incorrect');
    expect(Object.keys(data)).toEqual(['success', 'report', 'scan']);
  });

  it('sin hash: 400 bad_request; cuerpo null también', async () => {
    const { post } = await app();
    for (const payload of [{}, null, { id: 'x' }]) {
      const response = await post('/api/sources/report', payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'bad_request' });
    }
  });

  it('sin canal, el de la agenda si football lo sabe; si no, vacío', async () => {
    const football = new Proxy({} as FootballService, {
      get: (_target, property) =>
        property === 'programChannels'
          ? (id: string) => (id === 'm1' ? ['DAZN 1', 7] : null)
          : undefined,
    });
    const { post } = await app({ football });
    const known = await post('/api/sources/report', { id: ID_A, matchId: 'm1' });
    expect(known.json().report.channel).toBe('DAZN 1');
    const unknown = await post('/api/sources/report', { id: ID_A, matchId: 'm2' });
    expect(unknown.json().report.channel).toBe('');
    const stubbed = await app({ football: notImplementedService<FootballService>('football') });
    const fromStub = await stubbed.post('/api/sources/report', { id: ID_A, matchId: 'm1' });
    expect(fromStub.json().report.channel).toBe('');
  });

  it('POST /api/v1/sources/report: sin success y con la URL v1 del trabajo', async () => {
    const { post } = await app({ scanner: true });
    const response = await post('/api/v1/sources/report', {
      id: ID_A,
      reason: 'audio',
      channel: 'X',
    });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data).not.toHaveProperty('success');
    expect(data.report).toMatchObject({ reason: 'audio', state: 'checking' });
    expect(data.scan.statusUrl).toBe(`/api/v1/football/scans/${data.scan.id}`);
    const invalid = await post('/api/v1/sources/report', { id: ID_A, extra: true });
    expect(invalid.statusCode).toBe(400);
    const legacy = await post('/api/sources/report', { id: ID_A, reason: 'audio', channel: 'X' });
    expect(legacy.json().scan.statusUrl).toBe(`/api/football/scan?id=${legacy.json().scan.id}`);
  });
});

describe('POST /api/sources/outcome (api.md §4.15)', () => {
  it('T-123 · el aviso de que un canal sigue renueva el veredicto sin contar como intento', async () => {
    const { post, state, services } = await app();
    const id = '9'.repeat(40);
    const antes = JSON.stringify(state.get().sourceStats.hashes[id] ?? null);
    const response = await post('/api/sources/outcome', { id, resultado: 'sigue' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, hash: null, proveedor: null });
    expect(JSON.stringify(state.get().sourceStats.hashes[id] ?? null)).toBe(antes);
    expect(services.scanner.playerVerdictHeld(id)).toBe(true);
    /* La parte de la web (manda {id, resultado:'sigue'} mientras se ve) es de la Fase 2. */
  });

  it('arranco suma por hash y por proveedor; un resultado inválido es 400 bad_outcome', async () => {
    const { post } = await app();
    const ok = await post('/api/sources/outcome', {
      id: ID_A,
      resultado: 'arranco',
      title: 'LIGA --> ELCANO',
    });
    expect(ok.json()).toMatchObject({
      success: true,
      hash: { intentos: 1, exitos: 1 },
      proveedor: { intentos: 1, exitos: 1 },
    });
    const bad = await post('/api/sources/outcome', { id: ID_A, resultado: 'loquesea' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'bad_outcome' });
  });

  it('POST /api/v1/sources/outcome: sin success; validación y bad_outcome con el error v1', async () => {
    const { post } = await app();
    const ok = await post('/api/v1/sources/outcome', { id: ID_A, resultado: 'fallo', segundos: 3 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ hash: { intentos: 1, exitos: 0 } });
    expect(ok.json()).not.toHaveProperty('success');
    const invalid = await post('/api/v1/sources/outcome', { id: ID_A, resultado: 'x' });
    expect(invalid.statusCode).toBe(400);
    const badHash = await post('/api/v1/sources/outcome', { id: 'nada', resultado: 'fallo' });
    expect(badHash.statusCode).toBe(400);
    expect(badHash.json().error.code).toBe('bad_outcome');
  });
});

describe('POST /api/sources/feedback (api.md §4.16)', () => {
  it('T-080 · confirmar una fuente corrige el aprendizaje y levanta su veto de canal', async () => {
    const { post, state } = await app();
    /* Preparación propia (en la 0.6.59 dependía del estado que dejaba T-079). */
    await state.enqueue(
      (draft) => {
        draft.sourceReports = [
          normalizeSourceReport(
            {
              id: ID_A,
              channel: 'M+ Liga de Campeones',
              reason: 'wrong_channel',
              state: 'reported',
              reportId: 'r1',
              quarantineUntil: '2026-02-01T00:00:00.000Z',
            },
            0,
          ),
        ].filter((item) => item !== null);
      },
      { scopes: ['reports'] },
    );
    const response = await post('/api/sources/feedback', {
      id: ID_A,
      title: 'M+ Liga de Campeones --> ELCANO',
      channel: 'M+ Liga de Campeones',
      verdict: 'correct',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().feedback.verdict).toBe('correct');
    expect(response.json()).toMatchObject({ success: true, learningCount: 1 });
    const saved = state.get();
    expect(saved.channelFeedback[0]?.verdict).toBe('correct');
    const wrongReport = saved.sourceReports.find(
      (item) => item.id === ID_A && item.reason === 'wrong_channel',
    );
    expect(wrongReport?.quarantineUntil).toBeNull();
  });

  it('inválida: 400 bad_feedback (antigua) y validación o bad_feedback (v1)', async () => {
    const { post } = await app();
    const bad = await post('/api/sources/feedback', { id: ID_A, verdict: 'correct' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'bad_feedback' });
    const v1 = await post('/api/v1/sources/feedback', {
      id: ID_A,
      verdict: 'incorrect',
      channel: 'DAZN 1',
    });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ learningCount: 1, feedback: { verdict: 'incorrect' } });
    const v1Bad = await post('/api/v1/sources/feedback', { id: ID_A, verdict: 'correct' });
    expect(v1Bad.statusCode).toBe(400);
    expect(v1Bad.json().error.code).toBe('bad_feedback');
  });
});
