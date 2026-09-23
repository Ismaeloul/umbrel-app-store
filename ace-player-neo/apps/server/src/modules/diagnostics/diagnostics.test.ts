/* Tests del registro de fallos (plan E1.7; arquitectura §5.14). Módulo
   nuevo en la 0.7.0: no hay T-xxx de la 0.6.59. Reloj falso y DATA_DIR
   temporal (createTestCore). */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_MEMORY_ENTRIES,
  DiagnosticEntrySchema,
  type DiagnosticEntry,
  type DeviceRecord,
} from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import { createLogger } from '../../core/logger.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import {
  CLIENT_REPORTS_PER_MINUTE,
  DEFAULT_LIST_LIMIT,
  TOTAL_REPORTS_PER_MINUTE,
  createDiagnostics,
  toShortCode,
  type DiagnosticsOptions,
} from './service.js';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const HOUR = 60 * 60 * 1000;

function setup(options: DiagnosticsOptions & { logger?: ReturnType<typeof createLogger> } = {}) {
  const core = createTestCore(options.logger ? { logger: options.logger } : {});
  const diagnostics = createDiagnostics(core, options);
  const published: DiagnosticEntry[] = [];
  core.bus.on('diagnostics.new', (entry) => published.push(entry));
  return { core, diagnostics, published, file: core.config.paths.diagnosticsFile };
}

function device(id = 'dev_iphone01'): AuthenticatedDevice {
  const record: DeviceRecord = {
    id,
    name: 'iPhone',
    platform: 'ios',
    secretSha256: '0'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    revokedAt: null,
  };
  return { deviceId: id, device: record, via: 'bearer' };
}

function readLines(file: string): DiagnosticEntry[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => DiagnosticEntrySchema.parse(JSON.parse(line)));
}

describe('diagnostics · anotar (arquitectura §5.14)', () => {
  it('record: { id, at, cause, code, message, hash?, channel?, deviceId?, sessionId?, requestId? } y diagnostics.new', () => {
    const ctx = setup();
    const entry = ctx.diagnostics.record({
      cause: 'source',
      code: 'source_no_peers',
      message: 'La fuente no tiene pares.',
      hash: HASH,
      channel: 'DAZN 1',
      sessionId: 's_SesionDePrueba01',
      deviceId: 'dev_iphone01',
      requestId: 'req-1',
    });
    expect(DiagnosticEntrySchema.parse(entry)).toEqual(entry);
    expect(entry).toMatchObject({
      at: ctx.core.clock.date().toISOString(),
      cause: 'source',
      code: 'source_no_peers',
      hash: HASH,
      channel: 'DAZN 1',
      sessionId: 's_SesionDePrueba01',
      deviceId: 'dev_iphone01',
      requestId: 'req-1',
    });
    expect(entry.id).toMatch(/^diag_[a-z0-9_]+$/);
    expect(ctx.published).toEqual([entry]);
  });

  it('escucha diagnostics.report del bus (sin depender de nadie) y emite diagnostics.new', () => {
    const ctx = setup();
    ctx.core.bus.emit('diagnostics.report', {
      cause: 'engine',
      code: 'engine_unavailable',
      message: 'motor caído',
    });
    expect(ctx.published).toHaveLength(1);
    expect(ctx.diagnostics.list({}).entries[0]).toMatchObject({ cause: 'engine' });
  });

  it('sanea lo que mandan los módulos: código corto, mensaje de 500, campos con forma', () => {
    const ctx = setup();
    const entry = ctx.diagnostics.record({
      cause: 'network',
      code: 'Fetch Timeout: GET https://x',
      message: 'm'.repeat(900),
      hash: HASH.toUpperCase(),
      channel: `  ${'c'.repeat(200)}  `,
      sessionId: 'no-es-sesion',
      deviceId: 'con.punto',
      requestId: 'r'.repeat(300),
    });
    expect(entry.code).toBe('fetch_timeout_get_https_x');
    expect(entry.message).toHaveLength(500);
    expect(entry.hash).toBe(HASH);
    expect(entry.channel).toHaveLength(120);
    expect(entry).not.toHaveProperty('sessionId');
    expect(entry).not.toHaveProperty('deviceId');
    expect(entry.requestId).toHaveLength(128);
    const bare = ctx.diagnostics.record({
      cause: 'codec',
      code: '***',
      message: '',
      hash: 'no',
      channel: '   ',
    });
    expect(bare.code).toBe('unknown');
    expect(bare).not.toHaveProperty('hash');
    expect(bare).not.toHaveProperty('channel');
  });

  it('toShortCode: [a-z0-9_]{1,40}', () => {
    expect(toShortCode('ENGINE_TIMEOUT')).toBe('engine_timeout');
    expect(toShortCode('a'.repeat(39) + '_b')).toBe('a'.repeat(39));
    expect(toShortCode(undefined)).toBe('unknown');
    expect(toShortCode(42)).toBe('42');
  });

  it('una causa desconocida es un error de programación (bad_request) y no se anota', () => {
    const ctx = setup();
    expect(() =>
      ctx.diagnostics.record({ cause: 'otra' as 'engine', code: 'x', message: '' }),
    ).toThrow(expect.objectContaining({ code: 'bad_request' }));
    expect(ctx.published).toEqual([]);
  });

  it('en memoria solo las 500 últimas', () => {
    const ctx = setup();
    for (let index = 0; index < DIAGNOSTICS_MEMORY_ENTRIES + 20; index += 1) {
      ctx.diagnostics.record({ cause: 'client', code: `c${index}`, message: '' });
    }
    const listed = ctx.diagnostics.list({ limit: 500 });
    expect(listed.total).toBe(DIAGNOSTICS_MEMORY_ENTRIES);
    expect(listed.entries[0]?.code).toBe(`c${DIAGNOSTICS_MEMORY_ENTRIES + 19}`);
    expect(listed.entries.at(-1)?.code).toBe('c20');
  });
});

describe('diagnostics · consultar (GET /api/v1/diagnostics?cause=&since=)', () => {
  it('del más reciente al más antiguo, con filtro por causa y fecha, límite y total', () => {
    const ctx = setup();
    ctx.diagnostics.record({ cause: 'engine', code: 'a', message: '' });
    ctx.core.clock.advance(1000);
    const since = ctx.core.clock.date().toISOString();
    ctx.diagnostics.record({ cause: 'source', code: 'b', message: '' });
    ctx.core.clock.advance(1000);
    ctx.diagnostics.record({ cause: 'engine', code: 'c', message: '' });

    expect(ctx.diagnostics.list({}).entries.map((entry) => entry.code)).toEqual(['c', 'b', 'a']);
    expect(ctx.diagnostics.list({ cause: 'engine' }).entries.map((entry) => entry.code)).toEqual([
      'c',
      'a',
    ]);
    /* "Solo lo posterior": la de `since` justo no entra. */
    expect(ctx.diagnostics.list({ since }).entries.map((entry) => entry.code)).toEqual(['c']);
    const limited = ctx.diagnostics.list({ limit: 1 });
    expect(limited.entries).toHaveLength(1);
    expect(limited.total).toBe(3);
    expect(limited.counts24h).toEqual({ engine: 2, source: 1, network: 0, codec: 0, client: 0 });
  });

  it(`sin limit da ${DEFAULT_LIST_LIMIT}`, () => {
    const ctx = setup();
    for (let index = 0; index < DEFAULT_LIST_LIMIT + 5; index += 1) {
      ctx.diagnostics.record({ cause: 'client', code: 'x', message: '' });
    }
    expect(ctx.diagnostics.list({}).entries).toHaveLength(DEFAULT_LIST_LIMIT);
  });

  it('recuento por causa de las últimas 24 h', () => {
    const ctx = setup();
    ctx.diagnostics.record({ cause: 'engine', code: 'viejo', message: '' });
    ctx.core.clock.advance(23 * HOUR);
    ctx.diagnostics.record({ cause: 'engine', code: 'reciente', message: '' });
    ctx.diagnostics.record({ cause: 'codec', code: 'unsupported_codec', message: '' });
    expect(ctx.diagnostics.counts24h()).toEqual({
      engine: 2,
      source: 0,
      network: 0,
      codec: 1,
      client: 0,
    });
    ctx.core.clock.advance(HOUR + 1);
    expect(ctx.diagnostics.counts24h()).toMatchObject({ engine: 1, codec: 1 });
    ctx.core.clock.advance(24 * HOUR);
    expect(ctx.diagnostics.counts24h()).toEqual({
      engine: 0,
      source: 0,
      network: 0,
      codec: 0,
      client: 0,
    });
  });
});

describe('diagnostics · informes de clientes (POST /api/v1/diagnostics)', () => {
  it('guarda métricas, requestId y el dispositivo del token; la causa por defecto es client', async () => {
    const ctx = setup();
    const response = await ctx.diagnostics.report(
      {
        cause: 'client',
        code: 'player_metrics',
        message: '',
        hash: HASH,
        metrics: { timeToFirstFrameMs: 2300, rebuffers: 2, rebufferMs: 1800, reconnects: 1 },
      },
      { requestId: 'req-9', device: device() },
    );
    expect(response).toEqual({ accepted: true, id: expect.any(String) });
    const [entry] = ctx.diagnostics.list({}).entries;
    expect(entry).toMatchObject({
      id: response.id,
      cause: 'client',
      code: 'player_metrics',
      deviceId: 'dev_iphone01',
      requestId: 'req-9',
      metrics: { timeToFirstFrameMs: 2300, rebuffers: 2 },
    });
    const web = await ctx.diagnostics.report(
      { code: 'autoplay_blocked' } as Parameters<typeof ctx.diagnostics.report>[0],
      { requestId: 'req-10', device: null },
    );
    expect(ctx.diagnostics.list({}).entries[0]).toMatchObject({
      id: web.id,
      cause: 'client',
      message: '',
    });
    expect(ctx.diagnostics.list({}).entries[0]).not.toHaveProperty('deviceId');
  });

  it(`límite: ${CLIENT_REPORTS_PER_MINUTE} por cliente y ${TOTAL_REPORTS_PER_MINUTE} en total por minuto → rate_limited`, async () => {
    const ctx = setup({ clientReportsPerMinute: 3, totalReportsPerMinute: 5 });
    const send = (who: AuthenticatedDevice | null) =>
      ctx.diagnostics.report(
        { cause: 'client', code: 'x', message: '' },
        { requestId: 'r', device: who },
      );
    for (let index = 0; index < 3; index += 1) await send(device('dev_aaaa'));
    await expect(send(device('dev_aaaa'))).rejects.toMatchObject({ code: 'rate_limited' });
    await send(null);
    await send(device('dev_bbbb'));
    await expect(send(device('dev_cccc'))).rejects.toMatchObject({ code: 'rate_limited' });
    ctx.core.clock.advance(60_000);
    await expect(send(device('dev_aaaa'))).resolves.toMatchObject({ accepted: true });
    /* Los informes de backend (bus) no cuentan para el límite de clientes. */
    ctx.diagnostics.record({ cause: 'engine', code: 'y', message: '' });
    expect(ctx.diagnostics.list({}).total).toBe(7);
  });
});

describe('diagnostics · v2/diagnostics.jsonl', () => {
  it('antes de start no toca el disco; al arrancar escribe lo pendiente y luego cada entrada', async () => {
    const ctx = setup();
    ctx.diagnostics.record({ cause: 'engine', code: 'antes', message: '' });
    expect(existsSync(ctx.file)).toBe(false);
    await ctx.diagnostics.start();
    ctx.diagnostics.record({ cause: 'network', code: 'despues', message: '' });
    await ctx.diagnostics.flush();
    expect(readLines(ctx.file).map((entry) => entry.code)).toEqual(['antes', 'despues']);
    await ctx.diagnostics.stop();
  });

  it('rota a 1 MiB (aquí, a un tamaño pequeño): el lleno pasa a .jsonl.1', async () => {
    const ctx = setup({ maxFileBytes: 2048 });
    await ctx.diagnostics.start();
    for (let index = 0; index < 30; index += 1) {
      ctx.diagnostics.record({ cause: 'client', code: `n${index}`, message: 'x'.repeat(200) });
    }
    await ctx.diagnostics.flush();
    const rotated = ctx.diagnostics.rotatedFile();
    expect(rotated).toBe(`${ctx.file}.1`);
    expect(statSync(ctx.file).size).toBeLessThanOrEqual(2048);
    expect(statSync(rotated).size).toBeLessThanOrEqual(2048);
    const current = readLines(ctx.file);
    const previous = readLines(rotated);
    expect(current.at(-1)?.code).toBe('n29');
    expect(previous.at(-1)?.code).toBe(`n${29 - current.length}`);
  });

  it('al arrancar recupera las últimas y el recuento de 24 h de los dos ficheros, sin líneas rotas', async () => {
    const first = setup();
    await first.diagnostics.start();
    first.diagnostics.record({ cause: 'engine', code: 'viejo', message: '' });
    first.core.clock.advance(2 * HOUR);
    first.diagnostics.record({ cause: 'source', code: 'reciente', message: '' });
    await first.diagnostics.stop();
    const old: DiagnosticEntry = {
      id: 'diag_000001',
      at: '2025-12-30T00:00:00.000Z',
      cause: 'codec',
      code: 'rotado',
      message: '',
    };
    writeFileSync(`${first.file}.1`, `${JSON.stringify(old)}\n`);
    writeFileSync(first.file, `${readFileSync(first.file, 'utf8')}{roto\n{"id":"x"}\n\n`);

    const lines: string[] = [];
    const logger = createLogger({
      level: 'trace',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    });
    const core = createTestCore({
      env: { DATA_DIR: first.core.config.dataDir },
      logger,
    });
    core.clock.set(first.core.clock.now());
    const second = createDiagnostics(core);
    second.record({ cause: 'client', code: 'durante_arranque', message: '' });
    await second.start();
    expect(second.list({}).entries.map((entry) => entry.code)).toEqual([
      'durante_arranque',
      'reciente',
      'viejo',
      'rotado',
    ]);
    expect(second.counts24h()).toEqual({ engine: 1, source: 1, network: 0, codec: 0, client: 1 });
    await second.flush();
    const lastLine = readFileSync(first.file, 'utf8').trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(lastLine)).toMatchObject({ code: 'durante_arranque' });
    expect(lines.join('')).toContain('líneas ilegibles ignoradas');
  });

  it('si no se puede escribir, sigue en memoria y lo dice una vez en el log', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'trace',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    });
    const ctx = setup({ logger });
    /* Un directorio donde debería estar el fichero: appendFile falla (EISDIR). */
    mkdirSync(ctx.file, { recursive: true });
    await ctx.diagnostics.start();
    ctx.diagnostics.record({ cause: 'engine', code: 'a', message: '' });
    ctx.diagnostics.record({ cause: 'engine', code: 'b', message: '' });
    await ctx.diagnostics.flush();
    expect(ctx.diagnostics.list({}).total).toBe(2);
    const warnings = lines.join('').split('no se pudo escribir el registro').length - 1;
    expect(warnings).toBe(1);
    expect(lines.join('')).toContain('no se pudo leer el registro');
  });

  it('si ni siquiera se puede crear v2/, arranca igual (solo memoria)', async () => {
    const ctx = setup();
    /* Un fichero donde debería estar el directorio v2/. */
    mkdirSync(path.dirname(path.dirname(ctx.file)), { recursive: true });
    writeFileSync(path.dirname(ctx.file), 'no soy un directorio');
    await ctx.diagnostics.start();
    ctx.diagnostics.record({ cause: 'engine', code: 'a', message: '' });
    await ctx.diagnostics.flush();
    expect(ctx.diagnostics.list({}).total).toBe(1);
  });

  it('start es idempotente; stop se da de baja del bus y start vuelve a suscribirse', async () => {
    const ctx = setup();
    await Promise.all([ctx.diagnostics.start(), ctx.diagnostics.start()]);
    await ctx.diagnostics.stop();
    expect(ctx.core.bus.listenerCount('diagnostics.report')).toBe(0);
    ctx.core.bus.emit('diagnostics.report', { cause: 'engine', code: 'x', message: '' });
    expect(ctx.published).toEqual([]);
    await ctx.diagnostics.start();
    expect(ctx.core.bus.listenerCount('diagnostics.report')).toBe(1);
  });
});
