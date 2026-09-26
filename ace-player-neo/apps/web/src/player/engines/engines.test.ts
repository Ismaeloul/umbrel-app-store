/* Adaptadores de los motores con motores simulados: configuración EXACTA de
   los perfiles de @ace/shared, URL absoluta, recuperación de hls.js y qué
   motor toca a cada protocolo y navegador. */

import { HLS_RECOVERY, PLAYBACK_PROFILES } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoEngine } from './demo.ts';
import { createHlsEngine, hlsConfig, type HlsLib, type HlsLike } from './hls.ts';
import { chooseEngine, streamClient, type Platform } from './index.ts';
import {
  createMpegtsEngine,
  mpegtsConfig,
  type MpegtsLib,
  type MpegtsPlayerLike,
} from './mpegts.ts';
import { createNativeEngine } from './native.ts';
import type { EngineCallbacks } from './types.ts';

function callbacks() {
  const calls = { ready: 0, fatal: [] as string[], notices: [] as string[] };
  const cb: EngineCallbacks = {
    onReady: () => {
      calls.ready += 1;
    },
    onFatal: (reason) => {
      calls.fatal.push(reason);
    },
    onNotice: (text) => {
      calls.notices.push(text);
    },
  };
  return { calls, cb };
}

const video = () => document.createElement('video');

describe('mpegts.js', () => {
  function fakeMpegts() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const player: MpegtsPlayerLike & {
      attached: unknown;
      loaded: number;
      destroyed: number;
      unloaded: number;
    } = {
      attached: null,
      loaded: 0,
      destroyed: 0,
      unloaded: 0,
      on: (event, listener) => handlers.set(event, listener),
      attachMediaElement(element) {
        player.attached = element;
      },
      load() {
        player.loaded += 1;
      },
      unload() {
        player.unloaded += 1;
      },
      detachMediaElement() {},
      destroy() {
        player.destroyed += 1;
      },
    };
    const created: Array<{ source: unknown; config: unknown }> = [];
    const lib: MpegtsLib = {
      isSupported: () => true,
      createPlayer: (source, config) => {
        created.push({ source, config });
        return player;
      },
      Events: { ERROR: 'error', MEDIA_INFO: 'media_info', STATISTICS_INFO: 'statistics_info' },
    };
    return {
      lib,
      player,
      created,
      emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
    };
  }

  it('configuración exacta del perfil Equilibrado y URL absoluta (B-069)', () => {
    const fake = fakeMpegts();
    const { cb } = callbacks();
    const el = video();
    const engine = createMpegtsEngine(fake.lib, {
      video: el,
      url: '/ace/r/abc/s_1',
      profile: PLAYBACK_PROFILES.balanced,
      callbacks: cb,
    });
    engine.start();
    expect(fake.created[0]?.source).toEqual({
      type: 'mpegts',
      isLive: true,
      url: new URL('/ace/r/abc/s_1', location.href).href,
    });
    expect(fake.created[0]?.config).toEqual({
      enableStashBuffer: true,
      stashInitialSize: 1024 * 1024,
      lazyLoad: false,
      enableWorkerForMSE: true,
      fixAudioTimestampGap: true,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 60,
      autoCleanupMinBackwardDuration: 30,
      liveBufferLatencyChasing: false,
      liveSync: true,
      liveSyncMaxLatency: 14,
      liveSyncTargetLatency: 6,
      liveSyncPlaybackRate: 1.03,
    });
    expect(fake.player.attached).toBe(el);
    expect(fake.player.loaded).toBe(1);
    expect(engine.preloads).toBe(true);
  });

  it('Estable sin liveSync y 2 MiB de stash; Baja latencia con 512 KiB', () => {
    expect(mpegtsConfig(PLAYBACK_PROFILES.stable)).toMatchObject({
      stashInitialSize: 2 * 1024 * 1024,
      liveSync: false,
      liveBufferLatencyChasing: false,
    });
    expect(mpegtsConfig(PLAYBACK_PROFILES.low)).toMatchObject({
      stashInitialSize: 512 * 1024,
      liveSyncTargetLatency: 3,
      liveSyncMaxLatency: 7,
      liveSyncPlaybackRate: 1.05,
    });
  });

  it('MEDIA_INFO arranca la precarga una sola vez; ERROR pide reconectar; destruir suelta todo', () => {
    const fake = fakeMpegts();
    const { calls, cb } = callbacks();
    const engine = createMpegtsEngine(fake.lib, {
      video: video(),
      url: '/ace/r/x',
      profile: PLAYBACK_PROFILES.balanced,
      callbacks: cb,
    });
    engine.start();
    fake.emit('media_info');
    fake.emit('media_info');
    expect(calls.ready).toBe(1);
    fake.emit('statistics_info', { speed: 512 });
    expect(engine.info().speedKBs).toBe(512);
    fake.emit('error', 'NetworkError', 'Exception');
    expect(calls.fatal).toEqual(['La señal se ha cortado: reconectando']);
    engine.destroy();
    expect(fake.player.unloaded).toBe(1);
    expect(fake.player.destroyed).toBe(1);
    // Después de destruido no avisa de nada.
    fake.emit('error');
    expect(calls.fatal).toHaveLength(1);
  });
});

describe('hls.js', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeHls() {
    const instances: Array<
      HlsLike & {
        config: Record<string, unknown>;
        source: string;
        media: unknown;
        startLoads: number;
        recovers: number;
        swaps: number;
        destroyed: boolean;
        emit(event: string, data?: unknown): void;
      }
    > = [];
    class FakeHls {
      static isSupported = () => true;
      static Events = {
        MANIFEST_PARSED: 'hlsManifestParsed',
        FRAG_LOADED: 'hlsFragLoaded',
        ERROR: 'hlsError',
      };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      config: Record<string, unknown>;
      source = '';
      media: unknown = null;
      startLoads = 0;
      recovers = 0;
      swaps = 0;
      destroyed = false;
      liveSyncPosition: number | null = 42;
      private handlers = new Map<string, (event: string, data: unknown) => void>();
      constructor(config: Record<string, unknown>) {
        this.config = config;
        instances.push(this);
      }
      loadSource(url: string) {
        this.source = url;
      }
      attachMedia(media: unknown) {
        this.media = media;
      }
      on(event: string, listener: (event: string, data: unknown) => void) {
        this.handlers.set(event, listener);
      }
      emit(event: string, data?: unknown) {
        this.handlers.get(event)?.(event, data);
      }
      startLoad() {
        this.startLoads += 1;
      }
      recoverMediaError() {
        this.recovers += 1;
      }
      swapAudioCodec() {
        this.swaps += 1;
      }
      destroy() {
        this.destroyed = true;
      }
    }
    return { Hls: FakeHls as unknown as HlsLib, instances };
  }

  function start() {
    const fake = fakeHls();
    const { calls, cb } = callbacks();
    const engine = createHlsEngine(fake.Hls, {
      video: video(),
      url: '/ace/m/abc/s_1.m3u8',
      profile: PLAYBACK_PROFILES.low,
      callbacks: cb,
    });
    engine.start();
    const hls = fake.instances[0]!;
    return { engine, hls, calls };
  }

  it('configuración exacta: 20 s de plazos más el bloque hls del perfil', () => {
    const { hls, engine } = start();
    expect(hls.config).toEqual({
      manifestLoadingTimeOut: 20_000,
      fragLoadingTimeOut: 20_000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 500,
      manifestLoadingMaxRetryTimeout: 2_000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 500,
      levelLoadingMaxRetryTimeout: 2_000,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 7,
      maxBufferLength: 30,
      maxLiveSyncPlaybackRate: 1.05,
    });
    expect(hlsConfig(PLAYBACK_PROFILES.stable)).toMatchObject({
      maxBufferLength: 90,
      maxLiveSyncPlaybackRate: 1,
      /* La lista que aún no está (503 del remux) se reintenta sola (docs/iptv.md §17). */
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
    });
    expect(hls.source).toBe(new URL('/ace/m/abc/s_1.m3u8', location.href).href);
    expect(engine.liveSyncPosition()).toBe(42);
  });

  it('errores de red: 3 reintentos esperando 750 ms × 2ⁿ sin reiniciar el canal; el 4º reconecta', () => {
    const { hls, calls } = start();
    const fatalNetwork = { fatal: true, type: 'networkError', details: 'fragLoadError' };
    hls.emit('hlsError', fatalNetwork);
    expect(calls.notices).toEqual(['HLS perdió la señal: reintentando sin reiniciar el canal']);
    vi.advanceTimersByTime(HLS_RECOVERY.networkRetryBaseMs - 1);
    expect(hls.startLoads).toBe(0);
    vi.advanceTimersByTime(1);
    expect(hls.startLoads).toBe(1);
    hls.emit('hlsError', fatalNetwork);
    vi.advanceTimersByTime(1500);
    hls.emit('hlsError', fatalNetwork);
    vi.advanceTimersByTime(3000);
    expect(hls.startLoads).toBe(3);
    expect(calls.notices).toHaveLength(1);
    hls.emit('hlsError', fatalNetwork);
    expect(calls.fatal).toEqual(['HLS no pudo recuperarse (fragLoadError)']);
  });

  it('un fragmento cargado devuelve el presupuesto de reintentos de red', () => {
    const { hls, calls } = start();
    const fatalNetwork = { fatal: true, type: 'networkError' };
    for (let i = 0; i < 3; i += 1) hls.emit('hlsError', fatalNetwork);
    hls.emit('hlsFragLoaded');
    hls.emit('hlsError', fatalNetwork);
    expect(calls.fatal).toEqual([]);
  });

  it('errores de medio: 2 recuperaciones, la segunda cambiando el códec de audio', () => {
    const { hls, calls } = start();
    const fatalMedia = { fatal: true, type: 'mediaError', details: 'bufferStalledError' };
    hls.emit('hlsError', fatalMedia);
    expect([hls.recovers, hls.swaps]).toEqual([1, 0]);
    hls.emit('hlsError', fatalMedia);
    expect([hls.recovers, hls.swaps]).toEqual([2, 1]);
    hls.emit('hlsError', fatalMedia);
    expect(calls.fatal).toEqual(['HLS no pudo recuperarse (bufferStalledError)']);
  });

  it('los errores no fatales se los arregla hls.js solo; MANIFEST_PARSED arranca la precarga', () => {
    const { hls, calls, engine } = start();
    hls.emit('hlsError', { fatal: false, type: 'networkError' });
    expect(calls.fatal).toEqual([]);
    hls.emit('hlsManifestParsed');
    hls.emit('hlsManifestParsed');
    expect(calls.ready).toBe(1);
    engine.destroy();
    expect(hls.destroyed).toBe(true);
  });
});

describe('HLS nativo y demo', () => {
  it('el nativo pone la URL absoluta en el vídeo y no precarga', () => {
    const { calls, cb } = callbacks();
    const el = video();
    el.load = () => {};
    const engine = createNativeEngine({
      video: el,
      url: '/remux/abc/index.m3u8',
      profile: PLAYBACK_PROFILES.balanced,
      callbacks: cb,
    });
    engine.start();
    expect(el.src).toBe(new URL('/remux/abc/index.m3u8', location.href).href);
    expect(engine.preloads).toBe(false);
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(calls.ready).toBe(1);
  });

  it('la demo da señal a los 1,8 s; el canal caído de muestra falla', () => {
    vi.useFakeTimers();
    const ok = callbacks();
    createDemoEngine({
      video: video(),
      url: 'demo:',
      profile: PLAYBACK_PROFILES.balanced,
      callbacks: ok.cb,
    }).start();
    vi.advanceTimersByTime(1800);
    expect(ok.calls.ready).toBe(1);
    const ko = callbacks();
    createDemoEngine({
      video: video(),
      url: 'demo:',
      profile: PLAYBACK_PROFILES.balanced,
      callbacks: ko.cb,
      demoFails: true,
    }).start();
    vi.advanceTimersByTime(1800);
    expect(ko.calls.fatal).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('qué motor toca', () => {
  const desktop: Platform = { ios: false, mse: true, nativeHls: false };
  const iphone: Platform = { ios: true, mse: false, nativeHls: true };
  const safariMac: Platform = { ios: false, mse: true, nativeHls: true };

  it('el iPhone pide el remux (client=ios); el escritorio, el progresivo', () => {
    expect(streamClient(desktop)).toBe('web');
    expect(streamClient(iphone)).toBe('ios');
    expect(streamClient({ ios: false, mse: false, nativeHls: true })).toBe('ios');
  });

  it('tabla protocolo × navegador', () => {
    expect(chooseEngine('mpegts', desktop)).toBe('mpegts');
    expect(chooseEngine('hls', desktop)).toBe('hls');
    expect(chooseEngine('hls-fmp4', desktop)).toBe('hls');
    expect(chooseEngine('hls-fmp4', iphone)).toBe('native');
    expect(chooseEngine('hls', iphone)).toBe('native');
    expect(chooseEngine('mpegts', iphone)).toBeNull();
    expect(chooseEngine('hls-fmp4', safariMac)).toBe('native');
    expect(chooseEngine('hls', { ios: false, mse: false, nativeHls: false })).toBeNull();
  });
});
