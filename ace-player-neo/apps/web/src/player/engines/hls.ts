/* Adaptador de hls.js (protocolo `hls`: la sesión compartida del motor, D5).

   - Configuración EXACTA de la 0.6.59 (index.html:4750): 20 s de plazo para
     el manifiesto y los fragmentos, más el bloque `hls` del perfil de
     @ace/shared (liveSyncDuration, liveMaxLatencyDuration, en segundos,
     maxBufferLength y maxLiveSyncPlaybackRate).
   - Recuperación SIN reiniciar el canal (index.html:4770-4789, B-071), con
     los números de HLS_RECOVERY de @ace/shared:
       · error de red fatal: hasta 3 `startLoad()` esperando 750 ms × 2ⁿ; el
         contador vuelve a 0 con cada fragmento cargado; el primero avisa
         «HLS perdió la señal: reintentando sin reiniciar el canal»;
       · error de medio fatal: hasta 2 `recoverMediaError()`; el segundo,
         además, `swapAudioCodec()`;
       · lo demás: reconexión completa «HLS no pudo recuperarse (…)».
   - Solo errores `fatal`: los demás los arregla hls.js solo.
   - IPTV (docs/diagnostico-iptv-0.8.2.md, C3):
       · `recoverInPlace()`: un vídeo que Chrome no puede decodificar (empalme
         roto, PIPELINE_ERROR_DECODE) se arregla con `recoverMediaError()` y
         siguiendo en el segmento de DESPUÉS del roto; 2 cada 60 s, y el
         presupuesto vuelve cuando el cabezal avanza de verdad;
       · `startFrom`: otra instancia sobre el mismo remux sigue en el segmento
         en el que iba la anterior, no 5 por detrás del borde;
       · `guardSequence`: si la MEDIA-SEQUENCE va hacia atrás (un servidor de
         antes reinicia el remux desde 0), no se deja a hls.js leer esa lista
         (buscaría 30-58 s atrás): se para y se avisa para reengancharlo. */

import { HLS_RECOVERY } from '@ace/shared';
import {
  absoluteUrl,
  type Engine,
  type EngineArgs,
  type LiveWindow,
  type StreamPosition,
} from './types.ts';

/** Lo que se usa de un `LevelDetails` de hls.js. */
export interface HlsLevelDetails {
  live: boolean;
  edge: number;
  targetduration: number;
  fragments: ReadonlyArray<{ sn: number | string; start: number; duration: number }>;
}

export interface HlsLike {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: unknown) => void): void;
  startLoad(startPosition?: number): void;
  stopLoad?(): void;
  recoverMediaError(): void;
  swapAudioCodec(): void;
  destroy(): void;
  readonly liveSyncPosition: number | null;
  readonly latestLevelDetails?: HlsLevelDetails | null;
  readonly maxLatency?: number;
}

/** El cargador de hls.js, lo justo para envolver el de las listas. */
export interface HlsLoaderCallbacks {
  onSuccess(response: { data?: unknown }, ...rest: unknown[]): void;
}
export interface HlsLoaderLike {
  load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void;
}
export type HlsLoaderClass = new (config: unknown) => HlsLoaderLike;

export interface HlsLib {
  new (config: Record<string, unknown>): HlsLike;
  isSupported(): boolean;
  readonly Events: {
    MANIFEST_PARSED: string;
    FRAG_LOADED: string;
    ERROR: string;
    LEVEL_LOADED?: string;
    FRAG_BUFFERED?: string;
  };
  readonly ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
  readonly DefaultConfig?: { loader: HlsLoaderClass };
}

interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
}

/** Reintentos de la lista (maestra y de nivel) ante un 503 «aún no está»: 4, cada 0,5 s y 2 s como mucho. */
export const HLS_PLAYLIST_RETRY = {
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 500,
  manifestLoadingMaxRetryTimeout: 2_000,
  levelLoadingMaxRetry: 4,
  levelLoadingRetryDelay: 500,
  levelLoadingMaxRetryTimeout: 2_000,
} as const;

/**
 * Recuperación en el sitio (C3): 2 como mucho cada 60 s. El presupuesto
 * vuelve cuando, con un fragmento nuevo en el búfer, el cabezal ya va 10 s
 * por delante de la última recuperación. Una señal que no se puede
 * decodificar nunca avanza: agota el presupuesto y acaba en `fail()` (y de
 * ahí, en AceStream), que es lo que tiene que pasar.
 */
export const HLS_IN_PLACE = { budget: 2, windowMs: 60_000, progressS: 10 } as const;

/** Con `startFrom`, no más atrás que borde − maxLatency + 2 s (si no, hls.js saltaría solo). */
export const START_FROM_MARGIN_S = 2;

/** La configuración que recibe hls.js (exportada para el test). */
export function hlsConfig(profile: EngineArgs['profile']): Record<string, unknown> {
  return {
    manifestLoadingTimeOut: 20_000,
    fragLoadingTimeOut: 20_000,
    /* La lista del remux puede no estar aún (arranca o se reinicia): el servidor responde 503 con
       Retry-After (docs/iptv.md §18) y hls.js lo reintenta solo, sin error a la vista. */
    ...HLS_PLAYLIST_RETRY,
    ...profile.hls,
  };
}

/** El número de `#EXT-X-MEDIA-SEQUENCE` de una lista, o null si no lo lleva. */
export function mediaSequenceOf(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/** El fragmento que contiene `time` (con 50 ms de margen al final), o null. */
function fragmentAt(details: HlsLevelDetails | null | undefined, time: number) {
  if (!details || !Number.isFinite(time)) return null;
  for (const fragment of details.fragments) {
    if (time >= fragment.start && time < fragment.start + fragment.duration - 0.05) return fragment;
  }
  return null;
}

/**
 * Dónde arrancar con `startFrom`: el mismo segmento y el mismo punto dentro
 * de él, sin quedar más atrás que borde − maxLatency + 2 s. −1 (lo de
 * siempre: hls.js elige) si ese segmento ya no está en la lista nueva.
 */
export function startPositionFor(
  details: HlsLevelDetails,
  from: StreamPosition,
  maxLatency: number,
): number {
  const fragment = details.fragments.find((f) => f.sn === from.sn);
  if (!fragment) return -1;
  const offset = Math.min(Math.max(0, from.offset), Math.max(0, fragment.duration - 0.1));
  const floor = details.edge - maxLatency + START_FROM_MARGIN_S;
  return Math.min(details.edge, Math.max(fragment.start + offset, floor));
}

export function createHlsEngine(Hls: HlsLib, args: EngineArgs): Engine {
  let hls: HlsLike | null = null;
  let destroyed = false;
  let ready = false;
  let networkRetries = 0;
  let mediaRecoveries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Recuperaciones en el sitio: cuándo y en qué punto del vídeo. */
  let inPlace: Array<{ at: number; position: number }> = [];
  let lastSequence: number | null = null;
  let resetSent = false;
  const maxLatencyOf = (instance: HlsLike | null) =>
    instance?.maxLatency || args.profile.hls.liveMaxLatencyDuration;

  /** La lista ha vuelto a empezar: no se la deja leer a hls.js y se avisa una vez. */
  const onSequenceBack = (from: number, to: number) => {
    const instance = hls;
    if (resetSent || destroyed || !instance) return;
    resetSent = true;
    try {
      instance.stopLoad?.();
    } catch {}
    args.callbacks.onReset?.(`La lista del remux ha vuelto a empezar (${from} → ${to})`);
  };

  /** Envuelve el cargador de listas para mirar la MEDIA-SEQUENCE ANTES de que hls.js la lea. */
  const guardedPlaylistLoader = (): HlsLoaderClass | null => {
    const Base = Hls.DefaultConfig?.loader;
    if (!Base) return null;
    return class GuardedPlaylistLoader extends Base {
      override load(context: unknown, config: unknown, callbacks: HlsLoaderCallbacks): void {
        super.load(context, config, {
          ...callbacks,
          onSuccess: (response, ...rest) => {
            const sequence = mediaSequenceOf(response.data);
            if (sequence !== null && lastSequence !== null && sequence < lastSequence) {
              onSequenceBack(lastSequence, sequence);
              return;
            }
            if (sequence !== null) lastSequence = sequence;
            callbacks.onSuccess(response, ...rest);
          },
        });
      }
    };
  };

  return {
    kind: 'hls',
    preloads: true,
    start() {
      if (destroyed || hls) return;
      const config = hlsConfig(args.profile);
      if (args.guardSequence) {
        const loader = guardedPlaylistLoader();
        if (loader) config.pLoader = loader;
      }
      const startFrom = args.startFrom ?? null;
      const levelLoaded = Hls.Events.LEVEL_LOADED;
      // Con posición heredada se espera a la lista para decir desde dónde cargar.
      if (startFrom && levelLoaded) config.autoStartLoad = false;
      const instance = new Hls(config);
      hls = instance;
      instance.loadSource(absoluteUrl(args.url));
      instance.attachMedia(args.video);
      instance.on(Hls.Events.FRAG_LOADED, () => {
        networkRetries = 0;
      });
      if (startFrom && levelLoaded) {
        let started = false;
        instance.on(levelLoaded, (_event, raw) => {
          if (started || destroyed || hls !== instance) return;
          started = true;
          const details = (raw as { details?: HlsLevelDetails } | null)?.details;
          instance.startLoad(
            details ? startPositionFor(details, startFrom, maxLatencyOf(null)) : -1,
          );
        });
      }
      if (Hls.Events.FRAG_BUFFERED) {
        instance.on(Hls.Events.FRAG_BUFFERED, () => {
          const last = inPlace.at(-1);
          if (last && args.video.currentTime - last.position >= HLS_IN_PLACE.progressS)
            inPlace = [];
        });
      }
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed || ready) return;
        ready = true;
        args.callbacks.onReady();
      });
      instance.on(Hls.Events.ERROR, (_event, raw) => {
        const data = (raw ?? {}) as HlsErrorData;
        if (destroyed || !data.fatal) return;
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          networkRetries < HLS_RECOVERY.networkRetries
        ) {
          const delay = HLS_RECOVERY.networkRetryBaseMs * 2 ** networkRetries;
          networkRetries += 1;
          if (networkRetries === 1)
            args.callbacks.onNotice?.('HLS perdió la señal: reintentando sin reiniciar el canal');
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!destroyed && hls === instance) instance.startLoad();
          }, delay);
          return;
        }
        if (
          data.type === Hls.ErrorTypes.MEDIA_ERROR &&
          mediaRecoveries < HLS_RECOVERY.mediaRecoveries
        ) {
          mediaRecoveries += 1;
          if (mediaRecoveries === 2) instance.swapAudioCodec();
          instance.recoverMediaError();
          return;
        }
        args.callbacks.onFatal(
          `HLS no pudo recuperarse (${data.details || data.type || 'error'})`,
          data.details || data.type,
        );
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const current = hls;
      hls = null;
      try {
        current?.destroy();
      } catch {}
    },
    liveSyncPosition() {
      const position = hls?.liveSyncPosition;
      return typeof position === 'number' && Number.isFinite(position) ? position : null;
    },
    recoverInPlace() {
      const instance = hls;
      if (destroyed || !instance) return false;
      const now = Date.now();
      inPlace = inPlace.filter((entry) => now - entry.at < HLS_IN_PLACE.windowMs);
      if (inPlace.length >= HLS_IN_PLACE.budget) return false;
      const time = args.video.currentTime;
      const bad = fragmentAt(instance.latestLevelDetails, time);
      // Se sigue en el segmento de después del roto; sin lista aún, donde estaba.
      const next = bad ? bad.start + bad.duration : Number.isFinite(time) ? time : -1;
      inPlace.push({ at: now, position: Number.isFinite(time) ? time : 0 });
      try {
        instance.recoverMediaError();
        instance.startLoad(next);
      } catch {
        return false;
      }
      return true;
    },
    liveWindow(): LiveWindow | null {
      const details = hls?.latestLevelDetails;
      const first = details?.fragments[0];
      if (!details?.live || !first) return null;
      if (!Number.isFinite(first.start) || !Number.isFinite(details.edge)) return null;
      return {
        start: first.start,
        end: details.edge,
        targetDuration: details.targetduration,
        maxLatency: maxLatencyOf(hls),
      };
    },
    position(): StreamPosition | null {
      const time = args.video.currentTime;
      const fragment = fragmentAt(hls?.latestLevelDetails, time);
      if (!fragment || typeof fragment.sn !== 'number') return null;
      return { sn: fragment.sn, offset: time - fragment.start };
    },
    info: () => ({}),
  };
}
