/* Adaptador de mpegts.js (escritorio y Android con MSE, protocolo `mpegts`).

   Configuración EXACTA de la 0.6.59 (index.html:4656-4661): stash del perfil,
   Worker para MSE, arreglo de huecos de audio y limpieza del búfer con 60 s
   hacia atrás dejando 30, más el bloque `mpegts` del perfil de @ace/shared
   (liveSync acelerando un poco en vez de saltar: los saltos vacían el
   colchón en P2P). La URL siempre absoluta (B-069).

   No importa mpegts.js: la librería llega ya cargada (import() dinámico en
   engines/index.ts) y aquí solo se describe lo que se usa de ella, para
   poder probar el adaptador con un motor simulado. */

import { absoluteUrl, type Engine, type EngineArgs } from './types.ts';

export interface MpegtsPlayerLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  attachMediaElement(element: HTMLMediaElement): void;
  load(): void;
  unload?(): void;
  detachMediaElement?(): void;
  destroy(): void;
  statisticsInfo?: { speed?: number; decodedFrames?: number; droppedFrames?: number } | null;
}

export interface MpegtsLib {
  isSupported(): boolean;
  createPlayer(
    source: { type: string; isLive?: boolean; url?: string },
    config?: Record<string, unknown>,
  ): MpegtsPlayerLike;
  Events: { ERROR: string; MEDIA_INFO: string; STATISTICS_INFO?: string };
}

/** La configuración que recibe mpegts.js (exportada para el test). */
export function mpegtsConfig(profile: EngineArgs['profile']): Record<string, unknown> {
  return {
    enableStashBuffer: true,
    stashInitialSize: profile.stash,
    lazyLoad: false,
    enableWorkerForMSE: true,
    fixAudioTimestampGap: true,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 60,
    autoCleanupMinBackwardDuration: 30,
    ...profile.mpegts,
  };
}

export function createMpegtsEngine(lib: MpegtsLib, args: EngineArgs): Engine {
  let player: MpegtsPlayerLike | null = null;
  let destroyed = false;
  let ready = false;
  let speed: number | null = null;

  return {
    kind: 'mpegts',
    preloads: true,
    start() {
      if (destroyed || player) return;
      const created = lib.createPlayer(
        { type: 'mpegts', isLive: true, url: absoluteUrl(args.url) },
        mpegtsConfig(args.profile),
      );
      player = created;
      created.attachMediaElement(args.video);
      created.on(lib.Events.ERROR, (type: unknown, detail: unknown) => {
        if (destroyed) return;
        // El texto es el de la 0.6.59; el detalle de mpegts.js va al registro de fallos.
        const extra = [type, detail].filter((part) => typeof part === 'string').join(' · ');
        args.callbacks.onFatal('La señal se ha cortado: reconectando', extra || undefined);
      });
      created.on(lib.Events.MEDIA_INFO, () => {
        // MEDIA_INFO puede repetirse (cambio de códec a mitad): la precarga, una sola vez.
        if (destroyed || ready) return;
        ready = true;
        args.callbacks.onReady();
      });
      if (lib.Events.STATISTICS_INFO) {
        created.on(lib.Events.STATISTICS_INFO, (stats: unknown) => {
          const value = (stats as { speed?: unknown } | null)?.speed;
          speed = typeof value === 'number' && Number.isFinite(value) ? value : null;
        });
      }
      created.load();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const current = player;
      player = null;
      if (!current) return;
      try {
        current.unload?.();
      } catch {}
      try {
        current.detachMediaElement?.();
      } catch {}
      try {
        current.destroy();
      } catch {}
    },
    liveSyncPosition: () => null,
    info() {
      const stats = player?.statisticsInfo ?? null;
      return {
        speedKBs: speed ?? (typeof stats?.speed === 'number' ? stats.speed : null),
        decodedFrames: stats?.decodedFrames ?? null,
        droppedFrames: stats?.droppedFrames ?? null,
      };
    },
  };
}
