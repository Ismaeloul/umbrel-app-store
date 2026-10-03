/* IPTV que entrega a golpes (auditoría 0.9.0).

   El proveedor de Isma manda lo retenido de una vez cada 8-11 s (alguna vez
   15 s), sin perder nada: la lista del remux crece a saltos de 10 s y queda
   quieta entre medias. Con la latencia de siempre (10 s en «Equilibrado» y
   22 de máximo) el reproductor llegaba al borde antes del golpe siguiente
   (parón), y tras rellenar el colchón la distancia pasaba del máximo y hls.js
   saltaba hacia delante: el «para → atrás → adelante» de cada 20-90 s.

   El servidor dice la cadencia en `stream.stats` (`cadenceMs`, p90 de los
   huecos del último minuto; null si llega seguido). Con cadencia c (en s) de
   4 s o más, el perfil sube, nunca baja:
   - colchón de arranque y de parón, y latencia objetivo: ≥ 1,5 × c (hasta 30 s);
   - latencia máxima: objetivo + c + 4 s (un golpe entero cabe sin saltar);
   - búfer de hls.js: máximo + 10 s.
   Los canales que llegan seguidos no cambian. */

import type { PlaybackProfile } from '@ace/shared';

/** Por debajo de esto la entrega es «seguida» y el perfil no cambia (como el relé). */
export const BURSTY_CADENCE_MS = 4_000;
/** Latencia objetivo y colchón: esta vez la cadencia… */
export const CADENCE_TARGET_FACTOR = 1.5;
/** …hasta esto como mucho (s). */
export const CADENCE_TARGET_MAX_S = 30;
/** Holgura de la latencia máxima sobre objetivo + un golpe (s). */
export const CADENCE_MAX_LATENCY_PAD_S = 4;
/** Solo se vuelve a subir si la cadencia nueva pasa la de antes en más de esto (sin vaivenes). */
export const CADENCE_RAISE_MIN_MS = 500;

/** El perfil para una IPTV con esta cadencia de entrega (el mismo si llega seguido). */
export function profileForCadence(
  profile: PlaybackProfile,
  cadenceMs: number | null | undefined,
): PlaybackProfile {
  if (!cadenceMs || cadenceMs < BURSTY_CADENCE_MS) return profile;
  const cadenceS = cadenceMs / 1000;
  const targetS = Math.min(CADENCE_TARGET_MAX_S, Math.ceil(CADENCE_TARGET_FACTOR * cadenceS));
  const syncS = Math.max(profile.hls.liveSyncDuration, targetS);
  const maxLatencyS = Math.max(
    profile.hls.liveMaxLatencyDuration,
    Math.ceil(syncS + cadenceS + CADENCE_MAX_LATENCY_PAD_S),
  );
  return {
    ...profile,
    initial: Math.max(profile.initial, targetS),
    rebuild: Math.max(profile.rebuild, targetS),
    hls: {
      ...profile.hls,
      liveSyncDuration: syncS,
      liveMaxLatencyDuration: maxLatencyS,
      maxBufferLength: Math.max(profile.hls.maxBufferLength, maxLatencyS + 10),
    },
  };
}
