/* Adaptadores de los motores con motores simulados: configuración EXACTA de
   los perfiles de @ace/shared, URL absoluta, recuperación de hls.js y qué
   motor toca a cada protocolo y navegador. */

import { HLS_RECOVERY, PLAYBACK_MODES, PLAYBACK_PROFILES } from '@ace/shared';
import Hls from 'hls.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoEngine } from './demo.ts';
import {
  createHlsEngine,
  HLS_IN_PLACE,
  hlsConfig,
  mediaSequenceOf,
  startPositionFor,
  type HlsLevelDetails,
  type HlsLib,
  type HlsLike,
  type HlsLoaderCallbacks,
} from './hls.ts';
import { chooseEngine, streamClient, type Platform } from './index.ts';
import {
  createMpegtsEngine,
  mpegtsConfig,
  type MpegtsLib,
  type MpegtsPlayerLike,
} from './mpegts.ts';
import { createNativeEngine } from './native.ts';
import type { EngineArgs, EngineCallbacks } from './types.ts';

function callbacks() {
  const calls = {
    ready: 0,
    fatal: [] as string[],
    notices: [] as string[],
    resets: [] as string[],
  };
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
    onReset: (reason) => {
      calls.resets.push(reason);
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
    const playlists: string[] = [];
    const instances: Array<
      HlsLike & {
        config: Record<string, unknown>;
        source: string;
        media: unknown;
        startLoads: number;
        positions: Array<number | undefined>;
        stopLoads: number;
        latestLevelDetails: HlsLevelDetails | null;
        maxLatency: number;
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
        LEVEL_LOADED: 'hlsLevelLoaded',
        FRAG_BUFFERED: 'hlsFragBuffered',
      };
      static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
      /** El cargador «de red»: responde al momento con la siguiente lista de `playlists`. */
      static DefaultConfig = {
        loader: class {
          load(_context: unknown, _config: unknown, callbacks: HlsLoaderCallbacks) {
            callbacks.onSuccess({ data: playlists.shift() });
          }
        },
      };
      config: Record<string, unknown>;
      source = '';
      media: unknown = null;
      startLoads = 0;
      positions: Array<number | undefined> = [];
      stopLoads = 0;
      latestLevelDetails: HlsLevelDetails | null = null;
      maxLatency = 0;
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
      startLoad(position?: number) {
        this.startLoads += 1;
        this.positions.push(position);
      }
      stopLoad() {
        this.stopLoads += 1;
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
    return { Hls: FakeHls as unknown as HlsLib, instances, playlists };
  }

  function start(extra: Partial<EngineArgs> = {}) {
    const fake = fakeHls();
    const { calls, cb } = callbacks();
    // Un <video> mínimo con el cabezal a mano (el de jsdom no deja moverlo).
    const media = { currentTime: 0 };
    const engine = createHlsEngine(fake.Hls, {
      video: media as unknown as HTMLMediaElement,
      url: '/ace/m/abc/s_1.m3u8',
      profile: PLAYBACK_PROFILES.low,
      callbacks: cb,
      ...extra,
    });
    engine.start();
    const hls = fake.instances[0]!;
    return { engine, hls, calls, media, playlists: fake.playlists, Hls: fake.Hls };
  }

  /** Lista de 2 s por segmento: `count` segmentos desde el `sn` `first`, empezando en `start`. */
  function details(start = 100, first = 40, count = 15): HlsLevelDetails {
    const fragments = Array.from({ length: count }, (_, i) => ({
      sn: first + i,
      start: start + i * 2,
      duration: 2,
    }));
    return { live: true, edge: start + count * 2, targetduration: 2, fragments };
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
      liveSyncDuration: 6,
      liveMaxLatencyDuration: 16,
      maxBufferLength: 30,
      maxLiveSyncPlaybackRate: 1.05,
      enableInterstitialPlayback: false,
    });
    expect(hlsConfig(PLAYBACK_PROFILES.stable)).toMatchObject({
      maxBufferLength: 90,
      maxLiveSyncPlaybackRate: 1,
      /* La lista que aún no está (503 del remux) se reintenta sola (docs/iptv.md §18). */
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
    });
    expect(hls.source).toBe(new URL('/ace/m/abc/s_1.m3u8', location.href).href);
    expect(engine.liveSyncPosition()).toBe(42);
  });

  it('la latencia va en segundos (C1) y el hls.js DE VERDAD acepta los tres perfiles', () => {
    expect(hlsConfig(PLAYBACK_PROFILES.balanced)).toMatchObject({
      liveSyncDuration: 10,
      liveMaxLatencyDuration: 22,
    });
    expect(hlsConfig(PLAYBACK_PROFILES.stable)).toMatchObject({
      liveSyncDuration: 14,
      liveMaxLatencyDuration: 26,
    });
    for (const mode of PLAYBACK_MODES) {
      const config = hlsConfig(PLAYBACK_PROFILES[mode]);
      // hls.js lanza si se mezclan recuentos y segundos: no puede quedar ningún recuento.
      expect(config).not.toHaveProperty('liveSyncDurationCount');
      expect(config).not.toHaveProperty('liveMaxLatencyDurationCount');
      const real = new Hls(config);
      expect(real.config.liveSyncDuration).toBe(PLAYBACK_PROFILES[mode].hls.liveSyncDuration);
      expect(real.config.liveMaxLatencyDuration).toBe(
        PLAYBACK_PROFILES[mode].hls.liveMaxLatencyDuration,
      );
      /* Sin intersticiales: su controlador pisaba el startLoad(siguiente) de recoverInPlace (ts-costura). */
      expect(real.config.enableInterstitialPlayback).toBe(false);
      real.destroy();
    }
    // Control: mezclar las dos formas sí rompe (lo que evita quitar los recuentos).
    expect(
      () => new Hls({ ...hlsConfig(PLAYBACK_PROFILES.low), liveSyncDurationCount: 3 }),
    ).toThrow(/don't mix up/);
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

  it('recoverInPlace (C3): recoverMediaError y sigue en el segmento de DESPUÉS del roto; 2 cada 60 s', () => {
    const { engine, hls, media } = start();
    hls.latestLevelDetails = details();
    media.currentTime = 111.3; // dentro del sn 45 (110-112)
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(hls.recovers).toBe(1);
    expect(hls.positions.at(-1)).toBe(112);
    media.currentTime = 112.4;
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(hls.positions.at(-1)).toBe(114);
    // Sin avanzar de verdad, el tercero no: toca reconectar (y de ahí, otra fuente).
    hls.emit('hlsFragBuffered');
    expect(engine.recoverInPlace?.()).toBe(false);
    expect(hls.recovers).toBe(2);
    // Pasado el minuto vuelve el presupuesto.
    vi.advanceTimersByTime(HLS_IN_PLACE.windowMs);
    expect(engine.recoverInPlace?.()).toBe(true);
  });

  it('recoverInPlace: el presupuesto vuelve cuando el cabezal avanza 10 s con fragmentos nuevos', () => {
    const { engine, hls, media } = start();
    hls.latestLevelDetails = details();
    media.currentTime = 104.5;
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(engine.recoverInPlace?.()).toBe(true);
    media.currentTime = 104.5 + HLS_IN_PLACE.progressS;
    hls.emit('hlsFragBuffered');
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(hls.recovers).toBe(3);
  });

  it('recoverInPlace mira 0,3 s por delante (el decodificador va adelantado) y el final de un segmento ya es el siguiente', () => {
    const { engine, hls, media } = start();
    hls.latestLevelDetails = details();
    // 111,97 en el sn 45 (110-112): cuenta ya como el 46 (112-114).
    media.currentTime = 111.97;
    expect(engine.position?.()).toEqual({ sn: 46, offset: 0 });
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(hls.positions.at(-1)).toBe(114);
    // 111,8: el roto probablemente es el siguiente (el decodificador ya estaba en él).
    media.currentTime = 111.8;
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(hls.positions.at(-1)).toBe(114);
  });

  it('sin presupuesto, position() da el segmento de DESPUÉS del roto (la instancia siguiente no vuelve a caer en él)', () => {
    const { engine, hls, media } = start();
    hls.latestLevelDetails = details();
    media.currentTime = 111.3;
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(engine.recoverInPlace?.()).toBe(true);
    expect(engine.position?.()).toEqual({ sn: 45, offset: expect.closeTo(1.3) });
    expect(engine.recoverInPlace?.()).toBe(false);
    expect(engine.position?.()).toEqual({ sn: 46, offset: 0 });

    // Lo mismo si es hls.js el que se rinde con un error de medio.
    const other = start();
    other.hls.latestLevelDetails = details();
    other.media.currentTime = 105;
    const fatalMedia = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };
    for (let i = 0; i < 3; i += 1) other.hls.emit('hlsError', fatalMedia);
    expect(other.calls.fatal).toHaveLength(1);
    expect(other.engine.position?.()).toEqual({ sn: 43, offset: 0 });
  });

  it('un error de medio fatal justo después de recoverInPlace es el mismo fallo: no se recupera dos veces', () => {
    const { engine, hls, media, calls } = start();
    hls.latestLevelDetails = details();
    media.currentTime = 105;
    expect(engine.recoverInPlace?.()).toBe(true);
    const fatalMedia = { fatal: true, type: 'mediaError', details: 'bufferAppendError' };
    hls.emit('hlsError', fatalMedia);
    expect([hls.recovers, hls.swaps]).toEqual([1, 0]);
    expect(calls.fatal).toEqual([]);
    // Pasado el margen, vuelve el camino de siempre.
    vi.advanceTimersByTime(HLS_IN_PLACE.settleMs);
    hls.emit('hlsError', fatalMedia);
    expect(hls.recovers).toBe(2);
  });

  it('inPlaceUsed: el presupuesto gastado pasa a la instancia siguiente (reconectar no lo rellena)', () => {
    const used = [
      { at: Date.now(), position: 111 },
      { at: Date.now(), position: 113 },
    ];
    const { engine, hls, media } = start({ inPlaceUsed: used });
    hls.latestLevelDetails = details();
    media.currentTime = 113.5;
    expect(engine.inPlaceUsed?.()).toEqual(used);
    expect(engine.recoverInPlace?.()).toBe(false);
    expect(hls.recovers).toBe(0);
  });

  it('startFrom (C3): espera a la lista y sigue en el mismo segmento; si ya no está, −1', () => {
    const { hls } = start({ startFrom: { sn: 48, offset: 0.7 } });
    expect(hls.config.autoStartLoad).toBe(false);
    expect(hls.startLoads).toBe(0);
    hls.emit('hlsLevelLoaded', { details: details(0) });
    // sn 48 empieza en 16 → 16,7 (el suelo es 30 − 16 + 2 = 16).
    expect(hls.positions).toEqual([16.7]);
    hls.emit('hlsLevelLoaded', { details: details(0) });
    expect(hls.positions).toHaveLength(1);

    const gone = start({ startFrom: { sn: 3, offset: 1 } });
    gone.hls.emit('hlsLevelLoaded', { details: details(0) });
    expect(gone.hls.positions).toEqual([-1]);
  });

  it('startFrom: nunca más atrás que borde − maxLatency + 2 s (hls.js saltaría solo)', () => {
    const list = details(0, 40, 15); // borde 30
    expect(startPositionFor(list, { sn: 40, offset: 0.5 }, 16)).toBe(16);
    expect(startPositionFor(list, { sn: 52, offset: 1.2 }, 16)).toBeCloseTo(25.2);
    expect(startPositionFor(list, { sn: 99, offset: 0 }, 16)).toBe(-1);
  });

  it('position y liveWindow salen de la lista de nivel', () => {
    const { engine, hls, media } = start();
    expect(engine.position?.()).toBeNull();
    expect(engine.liveWindow?.()).toBeNull();
    hls.latestLevelDetails = details();
    hls.maxLatency = 16;
    media.currentTime = 107.25;
    expect(engine.position?.()).toEqual({ sn: 43, offset: 1.25 });
    expect(engine.liveWindow?.()).toEqual({
      start: 100,
      end: 130,
      targetDuration: 2,
      maxLatency: 16,
    });
  });

  it('guardSequence (C3): una MEDIA-SEQUENCE hacia atrás no llega a hls.js; para y avisa una vez', () => {
    const { hls, calls, playlists } = start({ guardSequence: true });
    const Loader = hls.config.pLoader as new (config: unknown) => {
      load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void;
    };
    expect(Loader).toBeTypeOf('function');
    const seen: unknown[] = [];
    const load = (text: string) => {
      playlists.push(text);
      new Loader({}).load({}, {}, { onSuccess: (response) => seen.push(response.data) });
    };
    load('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:40\n');
    load('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:41\n');
    load('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n');
    load('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n');
    expect(seen).toHaveLength(2);
    expect(hls.stopLoads).toBe(1);
    expect(calls.resets).toHaveLength(1);
    expect(mediaSequenceOf('#EXT-X-MEDIA-SEQUENCE: 7')).toBe(7);
    expect(mediaSequenceOf('#EXTM3U')).toBeNull();
    // Sin IPTV no se toca el cargador.
    expect(start().hls.config).not.toHaveProperty('pLoader');
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
