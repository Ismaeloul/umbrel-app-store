/* Errores (formatos antiguo y v1), validación con zod y redacción del log. */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, errorCodeOf, notImplemented, toLegacyError, toV1Error } from './errors.js';
import { REDACTED, createLogger, redactUrl } from './logger.js';
import { createRouteCollector } from './router.js';
import { notImplementedService } from './stub.js';
import { normalizeQuery, parseInput, parseOutput } from './validation.js';

describe('AppError y sus formatos', () => {
  it('el message es el código (como `new Error("bad_json")` de la 0.6.59)', () => {
    const error = new AppError('bad_json', { detail: 'x', data: { a: 1 } });
    expect(error.message).toBe('bad_json');
    expect(error.code).toBe('bad_json');
    expect(error.detail).toBe('x');
    expect(errorCodeOf(error)).toBe('bad_json');
    expect(errorCodeOf(new Error('fetch_timeout'))).toBe('fetch_timeout');
    expect(errorCodeOf(new Error('http_429'))).toBe('http_429');
    expect(errorCodeOf(new Error('ECONNREFUSED'))).toBeNull();
    expect(errorCodeOf({ code: 'FST_ERR_CTP_BODY_TOO_LARGE' })).toBe('body_too_large');
    expect(errorCodeOf('texto')).toBeNull();
  });

  it('antiguo: HTTP de la 0.6.59; lo que no estaba en su lista blanca, 500', () => {
    expect(toLegacyError(new AppError('source_limit'))).toMatchObject({
      status: 400,
      body: { error: 'source_limit' },
    });
    expect(toLegacyError(new Error('http_502'))).toMatchObject({
      status: 400,
      body: { error: 'http_502' },
    });
    expect(toLegacyError(new AppError('remux_timeout')).status).toBe(504);
    /* `unauthorized` no existía en la 0.6.59: en una ruta antigua es un 500. */
    expect(toLegacyError(new AppError('unauthorized'))).toMatchObject({
      status: 500,
      body: { error: 'internal_error' },
      internal: true,
    });
    expect(toLegacyError(new TypeError('x')).internal).toBe(true);
  });

  it('v1: HTTP correcto, mensaje del catálogo y requestId', () => {
    const out = toV1Error(new Error('http_503'), 'r1');
    expect(out.status).toBe(502);
    expect(out.body.error.requestId).toBe('r1');
    expect(toV1Error(new AppError('validation_error'), 'r2')).toMatchObject({
      status: 400,
      internal: false,
    });
    /* Los códigos internos (`scanner_*`, `ollama_*`…) no salen tal cual. */
    const internal = toV1Error(new AppError('scanner_timeout'), 'r3');
    expect(internal).toMatchObject({ status: 500, internal: true });
    expect(internal.body.error.code).toBe('internal_error');
    expect(toV1Error(new AppError('internal_error'), 'r4').internal).toBe(true);
    expect(notImplemented('algo').code).toBe('not_implemented');
  });
});

describe('validación', () => {
  const schema = z.strictObject({ n: z.coerce.number().int(), tag: z.string().optional() });

  it('parseInput devuelve lo parseado o lanza validation_error con el detalle para el log', () => {
    expect(parseInput(schema, { n: '3' }, 'query')).toEqual({ n: 3 });
    try {
      parseInput(schema, { n: 'x', extra: 1 }, 'body');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('validation_error');
      expect((error as AppError).data).toEqual(
        expect.arrayContaining([expect.objectContaining({ part: 'body' })]),
      );
    }
  });

  it('parseOutput: una respuesta que no cumple es un fallo del servidor', () => {
    expect(parseOutput(schema, { n: 1 }, 'ruta')).toEqual({ n: 1 });
    expect(() => parseOutput(schema, { n: 'x' }, 'ruta')).toThrowError(
      expect.objectContaining({ code: 'internal_error' }),
    );
  });

  it('normalizeQuery copia el objeto y tolera lo que no lo es', () => {
    expect(normalizeQuery({ a: ['1', '2'] })).toEqual({ a: ['1', '2'] });
    expect(normalizeQuery(null)).toEqual({});
  });
});

describe('logs con redacción (arquitectura §5.12)', () => {
  it('redactUrl tapa t, token y code y deja el resto', () => {
    expect(redactUrl('/api/v1/video/s_x/index.m3u8?t=abc.def&x=1')).toBe(
      `/api/v1/video/s_x/index.m3u8?t=${REDACTED}&x=1`,
    );
    expect(redactUrl('/a?Token=1&code=2&c=3')).toBe(`/a?Token=${REDACTED}&code=${REDACTED}&c=3`);
    expect(redactUrl('/sin-query')).toBe('/sin-query');
    expect(redactUrl('/a?t&%zz=1')).toBe('/a?t&%zz=1');
  });

  it('pino no escribe Authorization, token, t ni code', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ level: 'info', destination });
    logger.info(
      {
        req: { headers: { authorization: 'Bearer secreto' } },
        token: 'dev.secreto',
        code: '123456',
        body: { code: '654321' },
        errorCode: 'engine_timeout',
      },
      'prueba',
    );
    logger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const text = lines.join('');
    expect(text).toContain('"level":"info"');
    expect(text).toContain('engine_timeout');
    for (const secret of ['secreto', '123456', '654321']) expect(text).not.toContain(secret);
  });
});

describe('esqueleto', () => {
  it('un servicio de esqueleto lanza not_implemented en cualquier método y no es una promesa', async () => {
    const service = notImplementedService<{ hola(): number }>('prueba');
    expect(() => service.hola()).toThrowError(expect.objectContaining({ code: 'not_implemented' }));
    expect((service as unknown as { then?: unknown }).then).toBeUndefined();
    expect(await Promise.resolve(service)).toBe(service);
  });

  it('el recolector de rutas rechaza ids desconocidos y duplicados', () => {
    const collector = createRouteCollector();
    collector.v1.handle('ping', () => ({
      ok: true as const,
      app: 'ace-player-neo' as const,
      version: 'x',
      apiVersion: 1 as const,
      serverTime: 0,
    }));
    expect(() => collector.v1.handle('ping', () => ({}) as never)).toThrow(/ya tiene/);
    expect(() => collector.v1.handle('nope' as 'ping', () => ({}) as never)).toThrow(/desconocida/);
    collector.legacy.handle('GET', '/api/state', () => ({}));
    expect(() => collector.legacy.handle('GET', '/api/state', () => ({}))).toThrow(/ya tiene/);
    expect(() => collector.legacy.handle('GET', '/api/nope', () => ({}))).toThrow(/desconocida/);
    expect(collector.v1Handlers.size).toBe(1);
    expect(collector.legacyHandlers.size).toBe(1);
  });
});
