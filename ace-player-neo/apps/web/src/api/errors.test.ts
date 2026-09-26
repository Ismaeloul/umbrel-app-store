import { ERROR_CATALOG } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  CLIENT_ERRORS,
  describeFailure,
  errorFromResponse,
  isAbortError,
  messageFor,
} from './errors.ts';
import { json } from '../test/fetch.ts';

describe('mensajes en español', () => {
  it('del catálogo de @ace/shared o de los del cliente', () => {
    expect(messageFor('engine_unavailable')).toBe(ERROR_CATALOG.engine_unavailable.message);
    expect(messageFor('network')).toBe(CLIENT_ERRORS.network);
    expect(messageFor('http_429')).toMatch(/429/);
    expect(messageFor('codigo_raro')).toBe(ERROR_CATALOG.internal_error.message);
  });

  it('ApiError sin mensaje toma el del código', () => {
    const error = new ApiError({ code: 'timeout' });
    expect(error.message).toBe(CLIENT_ERRORS.timeout);
    expect(error.isClientSide).toBe(true);
    expect(error.retryable).toBe(true);
    expect(new ApiError({ code: 'validation_error', status: 400 }).retryable).toBe(false);
    expect(new ApiError({ code: 'engine_timeout', status: 504 }).retryable).toBe(true);
  });

  it('describeFailure y isAbortError', () => {
    expect(describeFailure(new ApiError({ code: 'network' }))).toBe(CLIENT_ERRORS.network);
    expect(describeFailure(new Error('x'))).toBe(ERROR_CATALOG.internal_error.message);
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

describe('errorFromResponse', () => {
  it('error v1 con código, mensaje e id de petición', async () => {
    const error = await errorFromResponse(
      json(
        {
          error: {
            code: 'engine_unavailable',
            message: 'El motor no responde.',
            requestId: 'req-1',
          },
        },
        503,
      ),
      'channelStream',
    );
    expect(error).toMatchObject({
      code: 'engine_unavailable',
      message: 'El motor no responde.',
      requestId: 'req-1',
      status: 503,
      route: 'channelStream',
    });
  });

  it('forma antigua o una página de error de la pasarela', async () => {
    expect((await errorFromResponse(json({ error: 'fetch_timeout' }, 400), 'x')).code).toBe(
      'fetch_timeout',
    );
    const html = new Response('<html>Bad gateway</html>', { status: 502 });
    const error = await errorFromResponse(html, 'x');
    expect(error.code).toBe('http_502');
    expect(error.message).toMatch(/502/);
    expect(error.attempts).toBeNull();
  });

  it('los intentos del servidor (`error.attempts`, docs/iptv.md §16.8), solo si tienen sentido', async () => {
    const body = (attempts: unknown) => ({
      error: { code: 'iptv_unreachable', message: 'No responde.', requestId: 'r', attempts },
    });
    const twice = await errorFromResponse(json(body(2), 502), 'iptvSave');
    expect(twice.attempts).toBe(2);
    expect((await errorFromResponse(json(body('2'), 502), 'iptvSave')).attempts).toBeNull();
    expect((await errorFromResponse(json(body(1), 502), 'iptvSave')).attempts).toBeNull();
    expect((await errorFromResponse(json(body(2.5), 502), 'iptvSave')).attempts).toBeNull();
  });
});
