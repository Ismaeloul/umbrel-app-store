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

/* Traducción a AVPlayer (P11; docs/multidispositivo.md §4.4). En la app nativa:
   - `preferredForwardBufferDuration` = `rebuild`: el mismo colchón que la web
     rehace tras un parón es el que AVPlayer intenta tener por delante.
   - `liveEdgeOffsetS` = `initial`: la distancia al borde del directo, la misma
     que persigue mpegts.js en la web (3/6/10 s). En AVPlayer se aplica con
     `configuredTimeOffsetFromLive`. Es el respaldo de la app cuando la
     concesión no trae `latency.ios`; con ella manda `remuxLatency`, que nunca
     baja de 3 × TARGETDURATION (lo que aguanta AVPlayer sin LL-HLS).
   Hasta la 0.8.1 los dos valían `rebuild` (4/8/12).
   Cambiar de modo en iOS solo toca estos dos valores; no reconecta. */
export interface IosPlaybackProfile {
  readonly preferredForwardBufferDuration: number;
  readonly liveEdgeOffsetS: number;
}

export const IOS_PLAYBACK_PROFILES: Readonly<Record<PlaybackMode, IosPlaybackProfile>> = {
  stable: { preferredForwardBufferDuration: 12, liveEdgeOffsetS: 10 },
  balanced: { preferredForwardBufferDuration: 8, liveEdgeOffsetS: 6 },
  low: { preferredForwardBufferDuration: 4, liveEdgeOffsetS: 3 },
};

/* Distancia al directo de quien lee el HLS del remux (IPTV en la web, iPhone),
   en SEGUNDOS y no en segmentos: así los tres modos valen lo mismo que con
   mpegts.js, sea cual sea el GOP del canal (docs/multidispositivo.md §4.4).

   - Suelo por TARGETDURATION (TD): el iPhone no baja de 3 × TD; hls.js aguanta
     algo menos (2 / 3 / 4 × TD según el modo).
   - Tope para acelerar (`maxS`): 7 / 14 / 24 s, o el objetivo más 2 TD.
   - Velocidad de alcance y colchón por delante, los de hls.js de siempre. */
export const REMUX_WEB_TD_FACTOR: Readonly<Record<PlaybackMode, number>> = {
  low: 2,
  balanced: 3,
  stable: 4,
};
export const REMUX_MAX_LATENCY_S: Readonly<Record<PlaybackMode, number>> = {
  low: 7,
  balanced: 14,
  stable: 24,
};
export const REMUX_RATE: Readonly<Record<PlaybackMode, number>> = {
  low: 1.05,
  balanced: 1.03,
  stable: 1,
};
export const REMUX_BUFFER_S: Readonly<Record<PlaybackMode, number>> = {
  low: 10,
  balanced: 30,
  stable: 60,
};

export interface RemuxLatency {
  /** Distancia al final de la lista que se persigue. */
  readonly targetS: number;
  /** Por encima de esto, se acelera para volver. */
  readonly maxS: number;
  readonly rate: number;
  /** Colchón por delante (`maxBufferLength` de hls.js). */
  readonly bufferS: number;
}

/** Distancia al directo de un visor del remux (docs/multidispositivo.md §4.4). */
export function remuxLatency(
  mode: PlaybackMode,
  targetDurationS: number | null,
  client: 'web' | 'ios',
): RemuxLatency {
  const td = Math.max(1, Math.ceil(targetDurationS ?? 2));
  const profile = PLAYBACK_PROFILES[mode];
  const floor = client === 'ios' ? 3 * td : REMUX_WEB_TD_FACTOR[mode] * td;
  const targetS = Math.max(profile.initial, floor);
  const maxS = Math.max(REMUX_MAX_LATENCY_S[mode], targetS + 2 * td);
  return { targetS, maxS, rate: REMUX_RATE[mode], bufferS: REMUX_BUFFER_S[mode] };
}

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
