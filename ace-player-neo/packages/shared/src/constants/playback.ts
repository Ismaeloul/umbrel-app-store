/* Modos de reproducción Estable / Equilibrado / Baja latencia.
   Los perfiles de la web son EXACTAMENTE los de `PB` en la 0.6.59
   (index.html:2387-2402, reproductor.md §3), con los mismos nombres de campo
   para que el reproductor nuevo los pase tal cual a mpegts.js y a hls.js.

   mpegts.js 1.8 permite recuperar latencia acelerando un poco playbackRate.
   Se evita liveBufferLatencyChasing porque corrige saltando currentTime, y en
   P2P esos saltos vacían el colchón y producen cortes nuevos. */

export const PLAYBACK_MODES = ['stable', 'balanced', 'low'] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

/** Por defecto, Equilibrado (index.html:2360). */
export const DEFAULT_PLAYBACK_MODE: PlaybackMode = 'balanced';

export interface MpegtsProfile {
  readonly liveBufferLatencyChasing: false;
  readonly liveSync: boolean;
  readonly liveSyncMaxLatency?: number;
  readonly liveSyncTargetLatency?: number;
  readonly liveSyncPlaybackRate?: number;
}

export interface HlsProfile {
  readonly liveSyncDurationCount: number;
  readonly liveMaxLatencyDurationCount: number;
  readonly maxBufferLength: number;
  readonly maxLiveSyncPlaybackRate: number;
}

export interface PlaybackProfile {
  /** Texto que ve el usuario en Ajustes. */
  readonly label: string;
  /** `stashInitialSize` de mpegts.js, en bytes. */
  readonly stash: number;
  /** Colchón para arrancar, en segundos. */
  readonly initial: number;
  /** Colchón tras un parón, en segundos. También es el tope de distancia al directo. */
  readonly rebuild: number;
  readonly mpegts: MpegtsProfile;
  readonly hls: HlsProfile;
}

export const PLAYBACK_PROFILES: Readonly<Record<PlaybackMode, PlaybackProfile>> = {
  stable: {
    label: 'Estable',
    stash: 2 * 1024 * 1024,
    initial: 10,
    rebuild: 12,
    mpegts: { liveBufferLatencyChasing: false, liveSync: false },
    hls: {
      liveSyncDurationCount: 7,
      liveMaxLatencyDurationCount: 14,
      maxBufferLength: 90,
      maxLiveSyncPlaybackRate: 1,
    },
  },
  balanced: {
    label: 'Equilibrado',
    stash: 1024 * 1024,
    initial: 6,
    rebuild: 8,
    mpegts: {
      liveBufferLatencyChasing: false,
      liveSync: true,
      liveSyncMaxLatency: 14,
      liveSyncTargetLatency: 6,
      liveSyncPlaybackRate: 1.03,
    },
    hls: {
      liveSyncDurationCount: 5,
      liveMaxLatencyDurationCount: 10,
      maxBufferLength: 60,
      maxLiveSyncPlaybackRate: 1.03,
    },
  },
  low: {
    label: 'Baja latencia',
    stash: 512 * 1024,
    initial: 3,
    rebuild: 4,
    mpegts: {
      liveBufferLatencyChasing: false,
      liveSync: true,
      liveSyncMaxLatency: 7,
      liveSyncTargetLatency: 3,
      liveSyncPlaybackRate: 1.05,
    },
    hls: {
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 7,
      maxBufferLength: 30,
      maxLiveSyncPlaybackRate: 1.05,
    },
  },
};

/* Traducción a AVPlayer. Hoy en iPhone los modos casi no hacen nada: el
   remux tiene valores fijos y solo se usaba `rebuild` para calcular el
   directo, y encima cambiar de modo reconectaba (P11). En la app nativa:
   - `preferredForwardBufferDuration` = `rebuild`: el mismo colchón que la web
     rehace tras un parón es el que AVPlayer intenta tener por delante.
   - `liveEdgeOffsetS` = `rebuild`: la distancia al borde del directo, que en
     la web es el tope de `bufferSafety` (index.html:5030). En AVPlayer se
     aplica con `configuredTimeOffsetFromLive`.
   Cambiar de modo en iOS solo toca estos dos valores; no reconecta. */
export interface IosPlaybackProfile {
  readonly preferredForwardBufferDuration: number;
  readonly liveEdgeOffsetS: number;
}

export const IOS_PLAYBACK_PROFILES: Readonly<Record<PlaybackMode, IosPlaybackProfile>> = {
  stable: { preferredForwardBufferDuration: 12, liveEdgeOffsetS: 12 },
  balanced: { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 8 },
  low: { preferredForwardBufferDuration: 4, liveEdgeOffsetS: 4 },
};

/* Política de reconexión del reproductor (reproductor.md §4.1).
   - 3 reconexiones como máximo; 1 si se está en el arranque automático por
     fuentes verificadas y la fuente aún no ha arrancado (index.html:5217).
   - Novedad de la v2: espera exponencial entre reconexiones (hoy no hay
     ninguna y la siguiente empieza en cuanto se detecta el fallo, P4). */
export const RECONNECT_POLICY = {
  maxAttempts: 3,
  maxAttemptsAutoStart: 1,
  backoffBaseMs: 1000,
  backoffFactor: 2,
  backoffMaxMs: 8000,
} as const;

/** Espera antes de la reconexión número `attempt` (1, 2, 3…): 1 s, 2 s, 4 s… con tope de 8 s. */
export function reconnectDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const delay = RECONNECT_POLICY.backoffBaseMs * RECONNECT_POLICY.backoffFactor ** (n - 1);
  return Math.min(RECONNECT_POLICY.backoffMaxMs, delay);
}

/** Recuperación interna de hls.js sin reiniciar el canal (index.html:4770-4789). */
export const HLS_RECOVERY = {
  /** Errores de red fatales: reintentos con `startLoad()`, esperando 750 ms × 2^n. */
  networkRetries: 3,
  networkRetryBaseMs: 750,
  /** Errores de medio fatales: `recoverMediaError()`; el segundo, además, `swapAudioCodec()`. */
  mediaRecoveries: 2,
} as const;
