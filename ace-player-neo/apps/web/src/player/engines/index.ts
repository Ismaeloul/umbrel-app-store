/* Qué motor usa cada protocolo en cada navegador, y su carga diferida.

   hls.js y mpegts.js pesan (≈ 160 y 60 KB gzip): se piden con import() SOLO
   cuando el reproductor va a enganchar uno de verdad (arquitectura §9). El
   build los deja en trozos propios (`hls-*.js`, `mpegts-*.js`, ver
   vite.config.ts) y nada del JS inicial los arrastra.

   | protocolo del backend | navegador con MSE | iPhone / iPad o sin MSE |
   |-----------------------|-------------------|-------------------------|
   | mpegts (progresivo)   | mpegts.js         | — (no se pide: client=ios) |
   | hls (compartido, D5)  | hls.js            | HLS nativo              |
   | hls-fmp4 (remux)      | HLS nativo si lo hay, si no hls.js | HLS nativo |

   En iOS se pide la URL con `client=ios` y el backend da el remux fMP4
   (reproductor.md §1.3: mpegts.js «cree» que funciona y no reproduce, y
   hls.js sobre ManagedMediaSource provoca ciclos de pausa). */

import type { StreamProtocol } from '@ace/shared';
import { createDemoEngine } from './demo.ts';
import type { HlsLib } from './hls.ts';
import type { MpegtsLib } from './mpegts.ts';
import { createNativeEngine } from './native.ts';
import type { EngineFactory, EngineKind } from './types.ts';

export type { Engine, EngineArgs, EngineCallbacks, EngineFactory, EngineKind } from './types.ts';

export interface Platform {
  /** iPhone, iPod o iPad (también el iPadOS que se presenta como Mac). */
  ios: boolean;
  /** MediaSource de verdad (no ManagedMediaSource): lo que necesitan mpegts.js y hls.js. */
  mse: boolean;
  /** El <video> sabe reproducir HLS solo (Safari). */
  nativeHls: boolean;
}

/** MediaSource de verdad (no ManagedMediaSource) con H.264 + AAC, que es lo que piden mpegts.js y hls.js. */
function hasMediaSource(): boolean {
  try {
    const MS = (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    return (
      typeof MS === 'function' &&
      typeof MS.isTypeSupported === 'function' &&
      MS.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
    );
  } catch {
    return false;
  }
}

function hasNativeHls(): boolean {
  try {
    return (
      typeof document !== 'undefined' &&
      document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== ''
    );
  } catch {
    return false;
  }
}

export function detectPlatform(): Platform {
  const nav = (globalThis.navigator ?? {}) as Navigator;
  const ua = nav.userAgent || '';
  const ios =
    /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  return { ios, mse: hasMediaSource(), nativeHls: hasNativeHls() };
}

/** `client` de GET /api/v1/channels/:id/stream: el iPhone y lo que no tiene MSE, por el remux. */
export function streamClient(platform: Platform): 'web' | 'ios' {
  return platform.ios || !platform.mse ? 'ios' : 'web';
}

/** El motor para lo que ha concedido el backend, o null si este navegador no puede. */
export function chooseEngine(protocol: StreamProtocol, platform: Platform): EngineKind | null {
  switch (protocol) {
    case 'mpegts':
      return platform.mse && !platform.ios ? 'mpegts' : null;
    case 'hls':
      if (platform.mse && !platform.ios) return 'hls';
      return platform.nativeHls ? 'native' : null;
    case 'hls-fmp4':
      if (platform.nativeHls) return 'native';
      return platform.mse ? 'hls' : null;
    default:
      return null;
  }
}

export class EngineUnsupportedError extends Error {
  override readonly name = 'EngineUnsupportedError';
}

export type EngineLoader = (kind: EngineKind) => Promise<EngineFactory>;

/** Carga (con import() dinámico) la librería del motor y devuelve su fábrica. */
export const loadEngine: EngineLoader = async (kind) => {
  switch (kind) {
    case 'mpegts': {
      const [module, { createMpegtsEngine }] = await Promise.all([
        import('mpegts.js'),
        import('./mpegts.ts'),
      ]);
      const lib = ((module as { default?: unknown }).default ?? module) as unknown as MpegtsLib;
      if (!lib.isSupported()) throw new EngineUnsupportedError('mpegts.js no funciona aquí');
      return (args) => createMpegtsEngine(lib, args);
    }
    case 'hls': {
      const [module, { createHlsEngine }] = await Promise.all([
        import('hls.js'),
        import('./hls.ts'),
      ]);
      const Hls = module.default as unknown as HlsLib;
      if (!Hls.isSupported()) throw new EngineUnsupportedError('hls.js no funciona aquí');
      return (args) => createHlsEngine(Hls, args);
    }
    case 'native':
      return createNativeEngine;
    case 'demo':
      return createDemoEngine;
  }
};
