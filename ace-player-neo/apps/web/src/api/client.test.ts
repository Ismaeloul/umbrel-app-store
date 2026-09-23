import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, json, mockFetch } from '../test/fetch.ts';
import { api, timeoutFor } from './client.ts';
import { registerDemoHandlers } from './demo-registry.ts';
import { ApiError } from './errors.ts';
import { resetMode, setMode } from './mode.ts';

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  resetMode();
});

describe('api()', () => {
  it('GET con la respuesta del contrato (validada con zod en desarrollo)', async () => {
    const net = mockFetch({ 'GET /api/v1/engine/status': fixture('engineStatus') });
    const status = await api('engineStatus');
    expect(status.status).toBe('online');
    expect(net.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/engine/status' });
    expect(net.calls[0]?.headers.get('Accept')).toBe('application/json');
    net.restore();
  });

  it('parámetros de ruta y query', async () => {
    const net = mockFetch({
      'GET /api/v1/football/scans/0123456789abcdef01234567': fixture('footballScan'),
      'GET /api/v1/search': fixture('search'),
    });
    await api('footballScan', { params: { id: '0123456789abcdef01234567' } });
    await api('search', { query: { q: 'dazn' } });
    expect(net.calls.map((c) => c.url)).toEqual([
      '/api/v1/football/scans/0123456789abcdef01234567',
      '/api/v1/search?q=dazn',
    ]);
    net.restore();
  });

  it('POST con cuerpo JSON', async () => {
    const net = mockFetch({ 'POST /api/v1/library': fixture('libraryMutate') });
    const item = { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', title: 'DAZN 1' };
    await api('libraryMutate', { body: { action: 'favorite-upsert', item } });
    expect(net.calls[0]?.method).toBe('POST');
    expect(net.calls[0]?.body).toEqual({ action: 'favorite-upsert', item });
    expect(net.calls[0]?.headers.get('Content-Type')).toBe('application/json');
    net.restore();
  });

  it('un error del servidor sale como ApiError con su mensaje en español', async () => {
    const net = mockFetch({
      'GET /api/v1/engine/status': () =>
        json(
          {
            error: {
              code: 'engine_unavailable',
              message: 'El motor AceStream no responde.',
              requestId: 'r-9',
            },
          },
          503,
        ),
    });
    const error = await api('engineStatus').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'engine_unavailable',
      status: 503,
      requestId: 'r-9',
      message: 'El motor AceStream no responde.',
    });
    net.restore();
  });

  it('sin red: `network`', async () => {
    const net = mockFetch({
      'GET /api/v1/ping': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(api('ping')).rejects.toMatchObject({ code: 'network' });
    net.restore();
  });

  it('plazo agotado: `timeout`; cancelado por quien llama: AbortError', async () => {
    const net = mockFetch({
      'GET /api/v1/ping': (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(call.signal?.reason));
        }),
    });
    await expect(api('ping', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    const controller = new AbortController();
    const pending = api('ping', { signal: controller.signal, timeoutMs: 0 });
    controller.abort(new DOMException('Adiós', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    net.restore();
  });

  it('en desarrollo, una respuesta que no cumple el contrato es un error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const net = mockFetch({ 'GET /api/v1/engine/status': { status: 'volando' } });
    await expect(api('engineStatus')).rejects.toMatchObject({ code: 'invalid_response' });
    expect(spy).toHaveBeenCalled();
    net.restore();
  });

  it('una respuesta que no es JSON: `bad_response`', async () => {
    const net = mockFetch({ 'GET /api/v1/ping': () => new Response('<html>', { status: 200 }) });
    await expect(api('ping')).rejects.toMatchObject({ code: 'bad_response' });
    net.restore();
  });

  it('espera a saber si es demo y, en demo, no toca la red', async () => {
    resetMode();
    const net = mockFetch({});
    const off = registerDemoHandlers({
      ping: () => ({
        ok: true,
        app: 'ace-player-neo',
        version: 'demo',
        apiVersion: 1,
        serverTime: 1,
      }),
    });
    const pending = api('ping');
    setMode('demo', 'param');
    await expect(pending).resolves.toMatchObject({ version: 'demo' });
    expect(net.calls).toHaveLength(0);
    off();
    net.restore();
  });

  it('plazos por ruta', () => {
    expect(timeoutFor('channelStream')).toBe(60_000);
    expect(timeoutFor('ping')).toBe(12_000);
    expect(timeoutFor('libraryMutate')).toBe(12_000);
  });
});
