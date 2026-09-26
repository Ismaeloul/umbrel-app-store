import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, json } from '../test/fetch.ts';
import { bootApi, iptvActive, seedFromBootstrap } from './boot.ts';
import { modeStore, resetMode } from './mode.ts';
import { createQueryClient, routeKey } from './query.ts';
import { realtimeStore } from './realtime-store.ts';

afterEach(() => {
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

describe('arranque de la capa de datos', () => {
  it('siembra las consultas que trae /api/v1/bootstrap (una sola petición para la primera pantalla)', () => {
    const client = new QueryClient();
    const boot = fixture<Parameters<typeof seedFromBootstrap>[1]>('bootstrap');
    seedFromBootstrap(client, boot);
    expect(client.getQueryData(routeKey('libraryGet'))).toEqual(boot.library);
    expect(client.getQueryData(routeKey('preferencesGet'))).toEqual({
      preferences: boot.preferences,
    });
    expect(client.getQueryData(routeKey('playbackStatus'))).toEqual(boot.playback);
    expect(client.getQueryData(routeKey('engineStatus'))).toEqual(boot.engine);
  });

  it('en demo avisa y no abre el SSE', async () => {
    const client = new QueryClient();
    const result = await bootApi(client, {
      detect: {
        location: { search: '?demo=1', protocol: 'http:', hostname: 'x' },
        fetchImpl: vi.fn(),
      },
    });
    expect(result.mode).toBe('demo');
    expect(result.notice?.text).toBe('Modo demo: sin backend, canales de muestra cargados');
    expect(realtimeStore.get().status).toBe('demo');
    expect(modeStore.get().mode).toBe('demo');
  });

  it('en vivo siembra y abre el SSE; sin backend en el Umbrel, avisa y sigue', async () => {
    class Quiet {
      readyState = 0;
      onopen = null;
      onerror = null;
      addEventListener() {}
      close() {}
    }
    const client = new QueryClient();
    const ok = await bootApi(client, {
      detect: {
        location: { search: '', protocol: 'http:', hostname: 'umbrel.local' },
        fetchImpl: vi.fn(async () => json(fixture('bootstrap'))),
      },
      realtime: { EventSourceImpl: Quiet as unknown as typeof EventSource },
    });
    expect(ok.notice).toBeNull();
    expect(client.getQueryData(routeKey('engineStatus'))).toBeDefined();
    expect(realtimeStore.get().status).toBe('connecting');
    ok.stop();

    resetMode();
    const offline = await bootApi(new QueryClient(), {
      detect: {
        location: { search: '', protocol: 'http:', hostname: 'umbrel.local' },
        fetchImpl: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      },
      realtime: { EventSourceImpl: Quiet as unknown as typeof EventSource },
    });
    expect(offline.mode).toBe('live');
    expect(offline.notice).toEqual({
      tone: 'warn',
      text: 'Backend no disponible; la app seguirá reintentando',
    });
    offline.stop();
  });

  it('iptvActive() sigue en pie pasada media hora sin nadie que observe el bootstrap (gcTime)', () => {
    vi.useFakeTimers();
    try {
      const client = createQueryClient();
      const boot = fixture<Parameters<typeof seedFromBootstrap>[1]>('bootstrap');
      seedFromBootstrap(client, { ...boot, features: { ...boot.features, iptv: true } });
      expect(iptvActive(client)).toBe(true);
      vi.advanceTimersByTime(30 * 60_000);
      expect(iptvActive(client)).toBe(true);
      // Las demás consultas siguen con la recogida normal.
      client.setQueryData(routeKey('health'), { ok: true } as never);
      vi.advanceTimersByTime(6 * 60_000);
      expect(client.getQueryData(routeKey('health'))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
