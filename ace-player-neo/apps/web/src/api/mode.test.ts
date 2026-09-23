import { describe, expect, it, vi } from 'vitest';
import { fixture, json } from '../test/fetch.ts';
import { detectMode } from './mode.ts';

const loc = (search: string, hostname = 'umbrel.local', protocol = 'http:') => ({
  search,
  hostname,
  protocol,
});

describe('detectMode (como la 0.6.59)', () => {
  it('?demo=1 fuerza la demo sin preguntar', async () => {
    const fetchImpl = vi.fn();
    await expect(detectMode({ location: loc('?demo=1'), fetchImpl })).resolves.toMatchObject({
      mode: 'demo',
      reason: 'param',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('el HTML suelto (file:) es demo', async () => {
    await expect(
      detectMode({ location: loc('', '', 'file:'), fetchImpl: vi.fn() }),
    ).resolves.toMatchObject({ mode: 'demo' });
  });

  it('con backend: en vivo y guarda el arranque para sembrar la caché', async () => {
    const fetchImpl = vi.fn(async () => json(fixture('bootstrap')));
    const result = await detectMode({ location: loc(''), fetchImpl });
    expect(result.mode).toBe('live');
    expect(result.bootstrap?.version).toBe('0.7.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/bootstrap',
      expect.objectContaining({ cache: 'no-cache' }),
    );
  });

  it('si falla en localhost: demo', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 502 }));
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      await expect(detectMode({ location: loc('', hostname), fetchImpl })).resolves.toMatchObject({
        mode: 'demo',
        reason: 'offline-local',
      });
    }
  });

  it('en un Umbrel real, un fallo NUNCA activa la demo', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      detectMode({ location: loc('', 'umbrel.local'), fetchImpl }),
    ).resolves.toMatchObject({ mode: 'live', reason: 'offline' });
  });

  it('el plazo de 2,5 s cuenta como fallo', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('x', 'AbortError')),
          ),
        ),
    );
    await expect(
      detectMode({
        location: loc('', 'localhost'),
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 10,
      }),
    ).resolves.toMatchObject({
      mode: 'demo',
    });
  });
});
