/* La cola del comprobador con un motor de guion y reloj falso: trabajos,
   caché, reintentos, cancelación, tope de 20, ritmo con alguien viendo,
   veredicto del reproductor, poda, fugas y eventos del bus
   (B-014, B-015, B-022 a B-028; arquitectura §5.8). */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvents } from '../../core/bus.js';
import { createSilentLogger } from '../../core/logger.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { createScannerService } from './index.js';
import {
  ENGINE_STUB,
  createTestScanner,
  scriptedTransport,
  tick,
  type ScriptedOutcome,
} from './test-support.js';
import type { ScannerService } from './types.js';

const MIN = 60_000;
const h = (n: number): string => n.toString(16).padStart(40, 'a');

const running: ScannerService[] = [];
afterEach(async () => {
  while (running.length) await running.pop()?.stop();
});

function setup(
  outcomes: Record<string, ScriptedOutcome> = {},
  env: Record<string, string> = {},
  logger = createSilentLogger(),
) {
  const core = createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner', ...env }, logger });
  const script = scriptedTransport(outcomes);
  const scanner = createTestScanner(core, script.transport);
  running.push(scanner);
  const events = {
    verdicts: [] as DomainEvents['scan.verdict'][],
    progress: [] as DomainEvents['scan.progress'][],
    done: [] as DomainEvents['scan.jobDone'][],
    diagnostics: [] as DomainEvents['diagnostics.report'][],
  };
  core.bus.on('scan.verdict', (event) => events.verdicts.push(event));
  core.bus.on('scan.progress', (event) => events.progress.push(event));
  core.bus.on('scan.jobDone', (event) => events.done.push(event));
  core.bus.on('diagnostics.report', (event) => events.diagnostics.push(event));
  const settle = (ms: number): Promise<void> => tick(core.clock, ms, 100);
  return { core, clock: core.clock, script, scanner, events, settle };
}

describe('sin comprobador (B-015)', () => {
  it('no crea trabajos, no encuentra ninguno y la salud dice "disabled"', async () => {
    const core = createTestCore();
    const scanner = createScannerService({ ...core, engine: ENGINE_STUB });
    expect(scanner.isEnabled()).toBe(false);
    expect(
      scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(1), ih: false }] }),
    ).toBeNull();
    expect(() => scanner.job('0'.repeat(24))).toThrowError(
      expect.objectContaining({ code: 'scan_not_found' }),
    );
    await expect(scanner.ping()).resolves.toEqual({ status: 'disabled', online: false });
    await expect(scanner.searchRaw('dazn')).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(scanner.stats()).toMatchObject({ enabled: false, queue: 0, activeJobs: 0 });
    /* El veredicto del reproductor se anota igual (server.js no mira si hay comprobador). */
    expect(
      scanner.recordVerdict(h(1), { state: 'working', reason: 'player_ok', by: 'player' }).by,
    ).toBe('player');
    expect(scanner.playerVerdictHeld(h(1))).toBe(true);
  });
});

describe('trabajos y cola (B-014, B-022, B-023, B-024, B-027)', () => {
  it('normaliza, quita repetidos y deja 100 candidatos como máximo', () => {
    const { scanner } = setup();
    const candidates = [
      { id: 'no es un hash', ih: false },
      { id: `acestream://${h(0).toUpperCase()}`, ih: true },
      ...Array.from({ length: 110 }, (_, n) => ({ id: h(n), ih: false })),
    ];
    const ref = scanner.enqueue({ kind: 'interactive', candidates });
    expect(ref).toEqual({
      id: '0'.repeat(24),
      statusUrl: `/api/football/scan?id=${'0'.repeat(24)}`,
      total: 100,
      initialCount: 3,
    });
    const job = scanner.job(ref?.id ?? '');
    expect(job.candidates[0]).toMatchObject({ id: h(0), state: 'queued', attempts: 0 });
    expect(
      scanner.enqueue({ kind: 'interactive', candidates: [{ id: 'x', ih: false }] }),
    ).toBeNull();
  });

  it('prueba una fuente cada vez, cierra cada sesión y un fallo espera su único reintento', async () => {
    const { scanner, script, settle, events } = setup({ [h(1)]: 'working', [h(2)]: 'failed' });
    const ref = scanner.enqueue({
      kind: 'interactive',
      candidates: [
        { id: h(1), ih: true },
        { id: h(2), ih: false },
      ],
      clientKey: 'dev-1',
    });
    const jobId = ref?.id ?? '';
    await settle(1000);
    expect(scanner.job(jobId).candidates.map((item) => item.state)).toEqual(['checking', 'queued']);
    expect(scanner.stats()).toMatchObject({ busy: true, activeJobs: 1 });
    await settle(3000);
    let job = scanner.job(jobId);
    expect(job.status).toBe('waiting');
    expect(job.candidates.map((item) => item.state)).toEqual(['working', 'failed']);
    expect(job).toMatchObject({ checked: 2, playable: 1, failed: 1, waiting: 1 });
    expect(job.candidates[1]).toMatchObject({ reason: 'no_media', attempts: 1 });
    expect(script.calls.meta).toEqual([h(1), h(2)]);
    expect(script.calls.stops).toEqual([h(1), h(2)]);

    await settle(10 * MIN + 3000);
    job = scanner.job(jobId);
    expect(job.status).toBe('complete');
    expect(job.candidates[1]).toMatchObject({ state: 'failed', attempts: 2, retryAt: null });
    expect(script.calls.meta).toEqual([h(1), h(2), h(2)]);
    expect(script.calls.stops).toHaveLength(3);
    expect(events.done).toEqual([
      {
        jobId,
        kind: 'interactive',
        status: 'complete',
        matchId: null,
        reportKey: null,
        total: 2,
        playable: 1,
      },
    ]);
    const verdicts = events.verdicts.map((event) => [event.hash, event.state, event.jobId]);
    expect(verdicts).toEqual([
      [h(1), 'working', jobId],
      [h(2), 'failed', jobId],
      [h(2), 'failed', jobId],
    ]);
    expect(events.progress.some((event) => event.status === 'waiting' && event.waiting === 1)).toBe(
      true,
    );
  });

  /* Verificación del backend (23-09-2026): el test de arriba ve que a los
     10 min + 3 s ya se reintentó, pero no que ANTES no se reintente. B-024:
     "no se recomprueba a los pocos segundos", retryAt = fallo + 10 min
     (server.js:3437-3471, ACESTREAM_SCANNER_RETRY_DELAY_MS = 600000). El 10
     va escrito a mano a propósito: si cambia el defecto, esto falla. Y el id
     del trabajo son 24 hex (B-027, server.js:3562). */
  it('un fallo no se reintenta antes de los 10 min; el id del trabajo son 24 hex (B-024, B-027)', async () => {
    const { scanner, script, settle, clock } = setup({ [h(3)]: 'failed' });
    const ref = scanner.enqueue({
      kind: 'interactive',
      candidates: [{ id: h(3), ih: false }],
      clientKey: 'dev-1',
    });
    expect(ref?.id).toMatch(/^[0-9a-f]{24}$/);
    const jobId = ref?.id ?? '';
    await settle(3000);
    const waiting = scanner.job(jobId);
    expect(waiting.status).toBe('waiting');
    expect(waiting.candidates[0]).toMatchObject({ state: 'failed', attempts: 1 });
    expect(script.calls.meta).toEqual([h(3)]);
    const retryAt = Date.parse(String(waiting.candidates[0]?.retryAt));
    /* El fallo llegó dentro de esos 3 s: retryAt queda a 10 min de él. */
    expect(retryAt - clock.now()).toBeGreaterThan(10 * MIN - 3000);
    expect(retryAt - clock.now()).toBeLessThanOrEqual(10 * MIN);
    /* Hasta 1 s antes de retryAt no se vuelve a probar... */
    await settle(retryAt - clock.now() - 1000);
    expect(script.calls.meta).toEqual([h(3)]);
    expect(scanner.job(jobId).status).toBe('waiting');
    /* ...y al vencer, sí (su único reintento). */
    await settle(4000);
    expect(script.calls.meta).toEqual([h(3), h(3)]);
    expect(scanner.job(jobId)).toMatchObject({ status: 'complete' });
  });

  it('un segundo fallo de una verificada es floja primero y fallida después; HEVC no se reintenta', async () => {
    const { scanner, script, settle } = setup({ [h(3)]: 'working', [h(4)]: 'hevc' });
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(3), ih: false }] });
    await settle(3000);
    script.set(h(3), 'failed');
    const ref = scanner.enqueue({
      kind: 'research',
      candidates: [
        { id: h(3), ih: false },
        { id: h(4), ih: false },
      ],
      force: true,
    });
    await settle(5000);
    const job = scanner.job(ref?.id ?? '');
    expect(job.candidates[0]).toMatchObject({ state: 'weak', reason: 'intermittent' });
    expect(job.candidates[1]).toMatchObject({ state: 'failed', reason: 'unsupported_codec' });
    expect(job.status).toBe('complete');
    expect(scanner.verdict(h(4))).toMatchObject({
      state: 'failed',
      reason: 'unsupported_codec',
      videoCodec: 'hevc',
      playableOn: { web: false, ios: true },
    });
    expect(scanner.verdict(h(3))?.playableOn).toEqual({ web: true, ios: true });
  });

  it('sin force se reutiliza el veredicto vigente: el trabajo nace completo y lo avisa después', async () => {
    const { scanner, script, settle, events } = setup();
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(5), ih: false }] });
    await settle(3000);
    const ref = scanner.enqueue({
      kind: 'preheat',
      candidates: [{ id: h(5), ih: false }],
      matchId: 'm1',
    });
    const job = scanner.job(ref?.id ?? '');
    expect(job.status).toBe('complete');
    expect(job.candidates[0]).toMatchObject({ state: 'working', cached: true });
    expect(events.done).toHaveLength(1);
    await settle(10);
    expect(events.done[1]).toMatchObject({
      jobId: ref?.id,
      matchId: 'm1',
      kind: 'preheat',
      playable: 1,
    });
    expect(script.calls.meta).toEqual([h(5)]);
    /* A los 10 min caduca y se vuelve a probar. */
    await settle(10 * MIN + 1000);
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(5), ih: false }] });
    await settle(3000);
    expect(script.calls.meta).toEqual([h(5), h(5)]);
  });

  it('T-122 (drenador) · con force se vuelve a probar, salvo que mande el reproductor', async () => {
    const { scanner, script, settle } = setup();
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(6), ih: false }] });
    await settle(3000);
    scanner.enqueue({ kind: 'research', candidates: [{ id: h(6), ih: false }], force: true });
    await settle(3000);
    expect(script.calls.meta).toEqual([h(6), h(6)]);
    scanner.recordVerdict(h(6), { state: 'weak', reason: 'player_dropped', by: 'player' });
    const ref = scanner.enqueue({
      kind: 'research',
      candidates: [{ id: h(6), ih: false }],
      force: true,
    });
    await settle(3000);
    expect(script.calls.meta).toEqual([h(6), h(6)]);
    expect(scanner.job(ref?.id ?? '').candidates[0]).toMatchObject({
      state: 'weak',
      reason: 'player_dropped',
      cached: true,
    });
  });

  it('un trabajo nuevo del mismo cliente cancela el anterior; los prioritarios van delante', async () => {
    const { scanner, script, settle, events } = setup();
    const preheat = scanner.enqueue({
      kind: 'preheat',
      candidates: [{ id: h(7), ih: false }],
      clientKey: 'preheat_x',
    });
    const first = scanner.enqueue({
      kind: 'interactive',
      candidates: [{ id: h(8), ih: false }],
      clientKey: 'dev/1!',
    });
    const second = scanner.enqueue({
      kind: 'interactive',
      candidates: [{ id: h(9), ih: false }],
      clientKey: 'dev1',
    });
    expect(scanner.job(first?.id ?? '').status).toBe('cancelled');
    expect(events.done).toEqual([
      expect.objectContaining({ jobId: first?.id, status: 'cancelled' }),
    ]);
    await settle(8000);
    expect(script.calls.meta).toEqual([h(9), h(7)]);
    expect(scanner.job(second?.id ?? '').status).toBe('complete');
    expect(scanner.job(preheat?.id ?? '').status).toBe('complete');
  });

  it('cola acotada a 20 trabajos vivos: sale el más viejo sin cliente', () => {
    const { scanner, events } = setup();
    const refs = Array.from({ length: 20 }, (_, n) =>
      scanner.enqueue({
        kind: n === 0 ? 'interactive' : 'preheat',
        candidates: [{ id: h(100 + n), ih: false }],
        clientKey: n < 2 ? '' : `c${n}`,
      }),
    );
    expect(scanner.stats().activeJobs).toBe(20);
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(200), ih: false }] });
    expect(scanner.stats().activeJobs).toBe(20);
    /* El 1 no tiene cliente y no es prioritario: es el primero en salir. */
    expect(scanner.job(refs[1]?.id ?? '').status).toBe('cancelled');
    expect(scanner.job(refs[0]?.id ?? '').status).not.toBe('cancelled');
    expect(events.done.map((event) => event.jobId)).toEqual([refs[1]?.id]);
  });

  it('job(): el id se pasa a minúsculas; otro formato o uno que no existe, scan_not_found', () => {
    const { scanner } = setup();
    const ref = scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(10), ih: false }] });
    expect(scanner.job(` ${String(ref?.id).toUpperCase()} `).id).toBe(ref?.id);
    for (const bad of ['', 'x', 'f'.repeat(24), 'g'.repeat(24)]) {
      expect(() => scanner.job(bad)).toThrowError(
        expect.objectContaining({ code: 'scan_not_found' }),
      );
    }
  });
});

describe('con alguien viendo (arquitectura §5.8)', () => {
  it('nunca prueba el hash que se ve: el trabajo espera hasta que dejan de verlo', async () => {
    const { scanner, script, settle, core } = setup();
    await scanner.start();
    core.bus.emit('playback.activity', { watching: true, hashes: [h(11)], viewers: 1 });
    const ref = scanner.enqueue({
      kind: 'research',
      candidates: [
        { id: h(11), ih: false },
        { id: h(12), ih: false },
      ],
      force: true,
    });
    await settle(60_000);
    expect(script.calls.meta).toEqual([h(12)]);
    let job = scanner.job(ref?.id ?? '');
    expect(job.status).toBe('waiting');
    expect(job.candidates[0]?.state).toBe('queued');
    /* La misma actividad otra vez no cambia nada. */
    core.bus.emit('playback.activity', { watching: true, hashes: [h(11)], viewers: 2 });
    await settle(1000);
    expect(scanner.job(ref?.id ?? '').status).toBe('waiting');
    core.bus.emit('playback.activity', { watching: false, hashes: [], viewers: 0 });
    await settle(3000);
    job = scanner.job(ref?.id ?? '');
    expect(job.status).toBe('complete');
    expect(script.calls.meta).toEqual([h(12), h(11)]);
  });

  it('el veredicto del reproductor completa el trabajo que esperaba por el hash visto', async () => {
    const { scanner, script, settle, core, events } = setup();
    await scanner.start();
    core.bus.emit('playback.activity', { watching: true, hashes: [h(13)], viewers: 1 });
    const ref = scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(13), ih: false }] });
    await settle(1000);
    expect(scanner.job(ref?.id ?? '').status).toBe('waiting');
    scanner.recordVerdict(h(13), { state: 'working', reason: 'player_ok', by: 'player' });
    await settle(100);
    expect(scanner.job(ref?.id ?? '')).toMatchObject({ status: 'complete', playable: 1 });
    expect(script.calls.meta).toEqual([]);
    expect(events.verdicts.at(-1)).toMatchObject({ hash: h(13), by: 'player', jobId: null });
    /* Si ya había veredicto, el hash visto lo toma sin probar. */
    const again = scanner.enqueue({
      kind: 'research',
      candidates: [{ id: h(13), ih: false }],
      force: true,
    });
    await settle(1000);
    expect(scanner.job(again?.id ?? '').candidates[0]).toMatchObject({
      state: 'working',
      cached: true,
    });
    expect(script.calls.meta).toEqual([]);
  });

  it('como mucho una sonda cada 20 s; si dejan de ver, sigue sin esperar', async () => {
    const { scanner, script, settle, core, clock } = setup();
    await scanner.start();
    core.bus.emit('playback.activity', { watching: true, hashes: [h(99)], viewers: 1 });
    const start = clock.now();
    const probedAt: number[] = [];
    const original = script.transport.sample;
    script.transport.sample = async (...args) => {
      probedAt.push(clock.now() - start);
      return original(...args);
    };
    scanner.enqueue({
      kind: 'interactive',
      candidates: [14, 15, 16].map((n) => ({ id: h(n), ih: false })),
    });
    await settle(25_000);
    expect(probedAt).toHaveLength(2);
    expect((probedAt[1] ?? 0) - (probedAt[0] ?? 0)).toBeGreaterThanOrEqual(20_000);
    await settle(5000);
    core.bus.emit('playback.activity', { watching: false, hashes: [], viewers: 0 });
    await settle(3000);
    expect(probedAt).toHaveLength(3);
    expect((probedAt[2] ?? 0) - (probedAt[1] ?? 0)).toBeLessThan(20_000);
  });

  it('el reproductor pisa a los trabajos abiertos, salvo un fallo sobre un reintento pendiente', async () => {
    const { scanner, settle } = setup({ [h(17)]: 'failed' });
    const ref = scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(17), ih: false }] });
    await settle(3000);
    expect(scanner.job(ref?.id ?? '').status).toBe('waiting');
    scanner.recordVerdict(h(17), { state: 'failed', reason: 'player_failed', by: 'player' });
    expect(scanner.job(ref?.id ?? '').candidates[0]?.reason).toBe('no_media');
    /* Ya se ve: el reintento sobra y el trabajo se completa (antes se quedaba en queued). */
    scanner.recordVerdict(h(17), { state: 'working', reason: 'player_ok', by: 'player' });
    const job = scanner.job(ref?.id ?? '');
    expect(job).toMatchObject({ status: 'complete', waiting: 0, retryAt: null });
    expect(job.candidates[0]).toMatchObject({
      state: 'working',
      reason: 'player_ok',
      cached: true,
    });
    await settle(11 * MIN);
    expect(scanner.job(ref?.id ?? '').status).toBe('complete');
  });

  it('un reintento que vence antes que otro ya resuelto reprograma el siguiente', async () => {
    const { scanner, settle } = setup({ [h(18)]: 'failed', [h(19)]: 'failed' });
    const ref = scanner.enqueue({
      kind: 'interactive',
      candidates: [
        { id: h(18), ih: false },
        { id: h(19), ih: false },
      ],
    });
    await settle(5000);
    scanner.recordVerdict(h(18), { state: 'working', reason: 'player_ok', by: 'player' });
    expect(scanner.job(ref?.id ?? '').status).toBe('waiting');
    await settle(11 * MIN);
    expect(scanner.job(ref?.id ?? '').status).toBe('complete');
  });
});

describe('poda, apagado, fugas y utilidades', () => {
  it('un trabajo vivo sin actividad en 25 min se poda y avisa como cancelado (§8.2.11)', async () => {
    const { scanner, settle, core, events } = setup();
    await scanner.start();
    core.bus.emit('playback.activity', { watching: true, hashes: [h(20)], viewers: 1 });
    const ref = scanner.enqueue({
      kind: 'report',
      candidates: [{ id: h(20), ih: false }],
      reportKey: 'r1',
      clientKey: 'report_r1',
      force: true,
    });
    /* Verificación del backend (23-09-2026): B-027 dice 25 min; a los 24,5
       el trabajo sigue ahí (la poda pasa cada minuto, así que se borra entre
       el 25 y el 26). */
    await settle(24 * MIN + 30_000);
    expect(events.done).toEqual([]);
    expect(scanner.job(ref?.id ?? '').status).not.toBe('cancelled');
    await settle(90_000);
    expect(events.done).toEqual([
      expect.objectContaining({ jobId: ref?.id, status: 'cancelled', reportKey: 'r1' }),
    ]);
    expect(() => scanner.job(ref?.id ?? '')).toThrowError(
      expect.objectContaining({ code: 'scan_not_found' }),
    );
  });

  it('al apagar se cancelan los trabajos vivos y se deja de probar; start y stop son idempotentes', async () => {
    const { scanner, script, settle, events } = setup();
    await scanner.start();
    await scanner.start();
    const ref = scanner.enqueue({
      kind: 'interactive',
      candidates: [21, 22].map((n) => ({ id: h(n), ih: false })),
    });
    await settle(500);
    await scanner.stop();
    await scanner.stop();
    await settle(5000);
    expect(scanner.job(ref?.id ?? '').status).toBe('cancelled');
    expect(events.done).toHaveLength(1);
    expect(script.calls.meta).toEqual([h(21)]);
    expect(script.calls.stops).toEqual([h(21)]);
    await scanner.start();
    scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(23), ih: false }] });
    await settle(3000);
    expect(script.calls.meta).toEqual([h(21), h(23)]);
  });

  it('las sesiones que quizá quedaron abiertas se cuentan una hora y van a diagnóstico', async () => {
    const logger = createSilentLogger();
    const warn = vi.spyOn(logger, 'warn');
    const { scanner, script, settle, events } = setup({ '*': 'meta_timeout' }, {}, logger);
    for (let n = 0; n < 6; n += 1) {
      scanner.enqueue({ kind: 'interactive', candidates: [{ id: h(30 + n), ih: false }] });
    }
    await settle(6 * 30_000);
    script.set('*', 'working');
    expect(scanner.stats().leakedSessionsLastHour).toBe(6);
    expect(events.diagnostics[0]).toMatchObject({
      cause: 'engine',
      code: 'scanner_session_leak',
      /* Los interactivos entran por delante: el último creado va primero. */
      hash: h(35),
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await settle(61 * MIN);
    expect(scanner.stats().leakedSessionsLastHour).toBe(0);
  });

  it('ping, búsqueda en el motor comprobador y veredictos a mano', async () => {
    const { scanner, script } = setup();
    await expect(scanner.ping()).resolves.toEqual({ status: 'ready', online: true });
    await expect(scanner.searchRaw('M+ Liga')).resolves.toContain('"results"');
    expect(script.calls.searches).toEqual(['/search?query=M%2B%20Liga&page_size=60']);
    script.transport.request = async () => ({ statusCode: 503, body: '' });
    await expect(scanner.ping()).resolves.toEqual({ status: 'offline', online: false });
    await expect(scanner.searchRaw('x')).rejects.toMatchObject({ code: 'engine_unavailable' });
    script.transport.request = async () => {
      throw new Error('scanner_timeout');
    };
    await expect(scanner.ping()).resolves.toEqual({ status: 'offline', online: false });
    await expect(scanner.searchRaw('x')).rejects.toMatchObject({ code: 'ace_timeout' });
    script.transport.request = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(scanner.searchRaw('x')).rejects.toMatchObject({ code: 'engine_unavailable' });

    expect(() =>
      scanner.recordVerdict('nada', { state: 'working', reason: 'x', by: 'player' }),
    ).toThrowError(expect.objectContaining({ code: 'bad_request' }));
    const verdict = scanner.recordVerdict(h(40), {
      state: 'weak',
      reason: 'player_dropped',
      by: 'player',
    });
    expect(verdict).toMatchObject({
      hash: h(40),
      state: 'weak',
      by: 'player',
      videoCodec: null,
      audioCodecs: [],
      playableOn: { web: true, ios: true },
    });
    const held = scanner.recordVerdict(h(40), {
      state: 'failed',
      reason: 'timeout',
      by: 'scanner',
    });
    expect(held.state).toBe('weak');
    expect(scanner.verdict(`acestream://${h(40)}`)?.reason).toBe('player_dropped');
    expect(scanner.verdict('nada')).toBeNull();
    scanner.forget(h(40));
    scanner.forget('nada');
    expect(scanner.verdict(h(40))).toBeNull();
    expect(scanner.playerVerdictHeld('nada')).toBe(false);
    expect(scanner.stats()).toMatchObject({ enabled: true, cachedSources: 0 });
  });

  it('el transporte por defecto sale de la configuración (sin red en este test)', () => {
    const core = createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner-host' } });
    const scanner = createScannerService({ ...core, engine: ENGINE_STUB });
    expect(scanner.isEnabled()).toBe(true);
    expect(scanner.stats().enabled).toBe(true);
  });
});
