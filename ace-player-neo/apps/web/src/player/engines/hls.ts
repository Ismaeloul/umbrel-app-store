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
   - Solo errores `fatal`: los demás los arregla hls.js solo.
   - Con el remux del servidor (la IPTV en la web, docs/multidispositivo.md
     §4.4) va EN SEGUNDOS y no en segmentos: `liveSyncDuration` y
     `liveMaxLatencyDuration` de la concesión (o de `remuxLatency` con el
     TARGETDURATION real), así los tres modos valen lo mismo que con
     mpegts.js sea cual sea el GOP del canal. Si el TARGETDURATION cambia
     (`LEVEL_UPDATED`), se recalcula sin reenganchar. */

import { HLS_RECOVERY, remuxLatency } from '@ace/shared';
import {
  absoluteUrl,
  type Engine,
  type EngineArgs,
  type EngineInfo,
  type RemuxTuning,
} from './types.ts';

export interface HlsLike {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: unknown) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
  swapAudioCodec(): void;
  destroy(): void;
  readonly liveSyncPosition: number | null;
  /** La configuración viva (hls.js relee `liveSyncDuration` y compañía en cada cálculo). */
  readonly config?: Record<string, unknown>;
  /** Segundos por detrás del final de la lista (hls.js ≥ 1.1). */
  readonly latency?: number;
}

export interface HlsLib {
  new (config: Record<string, unknown>): HlsLike;
  isSupported(): boolean;
  readonly Events: {
    MANIFEST_PARSED: string;
    FRAG_LOADED: string;
    ERROR: string;
    LEVEL_UPDATED?: string;
  };
  readonly ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
}

interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
}

interface LevelUpdatedData {
  details?: { targetduration?: number; fragments?: ReadonlyArray<{ duration?: number }> };
}

/** Lo que se persigue con el remux: de la concesión o, si no trae, de `remuxLatency`. */
function remuxLive(tuning: RemuxTuning, targetDurationS: number | null) {
  const calc = remuxLatency(tuning.mode, targetDurationS, 'web');
  const live = targetDurationS === null && tuning.liveSync ? tuning.liveSync : calc;
  return { targetS: live.targetS, maxS: live.maxS, rate: live.rate, bufferS: calc.bufferS };
}

/** La configuración que recibe hls.js (exportada para el test). */
export function hlsConfig(
  profile: EngineArgs['profile'],
  remux: RemuxTuning | null = null,
): Record<string, unknown> {
  if (!remux) {
    return {
      manifestLoadingTimeOut: 20_000,
      fragLoadingTimeOut: 20_000,
      ...profile.hls,
    };
  }
  const live = remuxLive(remux, null);
  return {
    manifestLoadingTimeOut: 20_000,
    fragLoadingTimeOut: 20_000,
    liveSyncDuration: live.targetS,
    liveMaxLatencyDuration: live.maxS,
    maxLiveSyncPlaybackRate: live.rate,
    maxBufferLength: live.bufferS,
    lowLatencyMode: false,
    backBufferLength: 30,
  };
}

export function createHlsEngine(Hls: HlsLib, args: EngineArgs): Engine {
  let hls: HlsLike | null = null;
  let destroyed = false;
  let ready = false;
  let networkRetries = 0;
  let mediaRecoveries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const remux = args.remux ?? null;
  /** Lo que dice la lista que ve hls.js: TARGETDURATION y lo que duran de verdad los segmentos. */
  let segment: { targetS: number; minS: number | null; maxS: number | null } | null = null;

  /* El TARGETDURATION de la lista ha cambiado (o se sabe por primera vez):
     misma regla que el servidor, escrita en la configuración viva. */
  function onLevelUpdated(instance: HlsLike, raw: unknown): void {
    const details = (raw as LevelUpdatedData | undefined)?.details;
    const target = details?.targetduration;
    if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return;
    const values = (details?.fragments ?? [])
      .map((fragment) => fragment.duration)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const previous = segment?.targetS ?? null;
    segment = {
      targetS: target,
      minS: values.length ? Math.min(...values) : null,
      maxS: values.length ? Math.max(...values) : null,
    };
    if (!remux || target === previous) return;
    const config = instance.config;
    if (!config) return;
    const live = remuxLive(remux, target);
    if (config.liveSyncDuration === live.targetS && config.liveMaxLatencyDuration === live.maxS)
      return;
    config.liveSyncDuration = live.targetS;
    config.liveMaxLatencyDuration = live.maxS;
  }

  return {
    kind: 'hls',
    preloads: true,
    start() {
      if (destroyed || hls) return;
      const instance = new Hls(hlsConfig(args.profile, remux));
      hls = instance;
      instance.loadSource(absoluteUrl(args.url));
      instance.attachMedia(args.video);
      instance.on(Hls.Events.FRAG_LOADED, () => {
        networkRetries = 0;
      });
      if (Hls.Events.LEVEL_UPDATED) {
        instance.on(Hls.Events.LEVEL_UPDATED, (_event, data) => {
          if (!destroyed && hls === instance) onLevelUpdated(instance, data);
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
    info(): EngineInfo {
      const latency = hls?.latency;
      return {
        ...(typeof latency === 'number' && Number.isFinite(latency) && latency >= 0
          ? { latencyS: latency }
          : {}),
        ...(segment ? { segment: { ...segment } } : {}),
      };
    },
  };
}
