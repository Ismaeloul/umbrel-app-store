/* Piezas de la respuesta de GET /api/v1/channels/:id/stream (arquitectura
   §6.3): latencia por modo (perfiles de @ace/shared), códec del veredicto y
   URL de cada tipo de visor. */

import {
  IOS_PLAYBACK_PROFILES,
  PLAYBACK_PROFILES,
  type EngineSessionMode,
  type PlaybackMode,
  type StreamLatency,
  type StreamProtocol,
} from '@ace/shared';
import type { ScannerService } from '../scanner/types.js';

/** Protocolo de un visor que lee directamente la sesión del motor. */
export function directProtocol(mode: EngineSessionMode): StreamProtocol {
  return mode === 'hls' ? 'hls' : 'mpegts';
}

/** Lista del remux para la app nativa (se firma con `?t=` en la ruta). */
export function nativeVideoPath(sessionId: string): string {
  return `/native/api/v1/video/${sessionId}/index.m3u8`;
}

/** Lista del remux de una IPTV para la web (hls.js, sin token: el login de Umbrel basta, docs/iptv.md §5.4). */
export function webVideoPath(sessionId: string): string {
  return `/api/v1/video/${sessionId}/index.m3u8`;
}

/** Lista del remux por la ruta de siempre (visor iOS desde la web, 0.6.x). */
export function legacyVideoPath(hash: string): string {
  return `/remux/${hash}/index.m3u8`;
}

/**
 * `latency` de la respuesta: `initial`/`rebuild` del perfil; seguimiento del
 * directo de mpegts.js en segundos (null en Estable); en iOS, los valores de
 * AVPlayer (P11) y sin seguimiento por velocidad.
 */
export function latencyFor(mode: PlaybackMode, protocol: StreamProtocol): StreamLatency {
  const profile = PLAYBACK_PROFILES[mode];
  const base = { mode, initialBufferS: profile.initial, rebuildS: profile.rebuild };
  if (protocol === 'hls-fmp4') {
    return { ...base, liveSync: null, ios: { ...IOS_PLAYBACK_PROFILES[mode] } };
  }
  const mpegts = profile.mpegts;
  const liveSync = mpegts.liveSync
    ? {
        targetS: mpegts.liveSyncTargetLatency ?? profile.initial,
        maxS: mpegts.liveSyncMaxLatency ?? profile.rebuild,
        rate:
          protocol === 'hls'
            ? profile.hls.maxLiveSyncPlaybackRate
            : (mpegts.liveSyncPlaybackRate ?? 1),
      }
    : null;
  return { ...base, liveSync };
}

export interface StreamCodec {
  readonly video: string;
  readonly audio: string;
  readonly source: 'scanner' | 'player' | 'ffprobe' | 'unknown';
}

const UNKNOWN_CODEC: StreamCodec = { video: 'unknown', audio: 'unknown', source: 'unknown' };

/** Códec del veredicto del comprobador o del reproductor; si no hay, `unknown`. */
export function codecFor(scanner: ScannerService, hash: string): StreamCodec {
  let verdict: ReturnType<ScannerService['verdict']>;
  try {
    verdict = scanner.verdict(hash);
  } catch {
    return UNKNOWN_CODEC;
  }
  if (!verdict || (!verdict.videoCodec && !verdict.audioCodecs.length)) return UNKNOWN_CODEC;
  return {
    video: verdict.videoCodec ?? 'unknown',
    audio: verdict.audioCodecs[0] ?? 'unknown',
    source: verdict.by,
  };
}
