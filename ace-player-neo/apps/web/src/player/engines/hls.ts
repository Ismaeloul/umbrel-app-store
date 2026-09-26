/* Adaptador de hls.js (protocolo `hls`: la sesión compartida del motor, D5).

   - Configuración EXACTA de la 0.6.59 (index.html:4750): 20 s de plazo para
     el manifiesto y los fragmentos, más el bloque `hls` del perfil de
     @ace/shared (liveSyncDurationCount, liveMaxLatencyDurationCount,
     maxBufferLength y maxLiveSyncPlaybackRate).
   - Recuperación SIN reiniciar el canal (index.html:4770-4789, B-071), con
     los números de HLS_RECOVERY de @ace/shared:
       · error de red fatal: hasta 3 `startLoad()` esperando 750 ms × 2ⁿ; el
         contador vuelve a 0 con cada fragmento cargado; el primero avisa
         «HLS perdió la señal: reintentando sin reiniciar el canal»;
       · error de medio fatal: hasta 2 `recoverMediaError()`; el segundo,
         además, `swapAudioCodec()`;
       · lo demás: reconexión completa «HLS no pudo recuperarse (…)».
   - Solo errores `fatal`: los demás los arregla hls.js solo. */

import { HLS_RECOVERY } from '@ace/shared';
import { absoluteUrl, type Engine, type EngineArgs } from './types.ts';

export interface HlsLike {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: unknown) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
  swapAudioCodec(): void;
  destroy(): void;
  readonly liveSyncPosition: number | null;
}

export interface HlsLib {
  new (config: Record<string, unknown>): HlsLike;
  isSupported(): boolean;
  readonly Events: { MANIFEST_PARSED: string; FRAG_LOADED: string; ERROR: string };
  readonly ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
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

export function createHlsEngine(Hls: HlsLib, args: EngineArgs): Engine {
  let hls: HlsLike | null = null;
  let destroyed = false;
  let ready = false;
  let networkRetries = 0;
  let mediaRecoveries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    kind: 'hls',
    preloads: true,
    start() {
      if (destroyed || hls) return;
      const instance = new Hls(hlsConfig(args.profile));
      hls = instance;
      instance.loadSource(absoluteUrl(args.url));
      instance.attachMedia(args.video);
      instance.on(Hls.Events.FRAG_LOADED, () => {
        networkRetries = 0;
      });
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
    info: () => ({}),
  };
}
