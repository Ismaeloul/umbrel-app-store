/* «Ver juntos» (docs/ver-juntos.md §6): cómo se mantiene cada reproductor a
   la par de la sala. Funciones puras: se prueban solas.

   - Reloj: la sala manda horas del servidor. El desfase con el reloj de este
     aparato se estima con la ida y vuelta de cada petición (`status`,
     `control`): servidor ≈ local + desfase, quedándose con la muestra de
     menor ida y vuelta de las últimas.
   - Posición de la sala «ahora»: la de `playback` más lo transcurrido si
     reproduce y nadie carga.
   - Corrección: con más de `driftSeekS` de diferencia se salta; entre
     `driftRateS` y eso, se acelera o frena un 5 % (no se nota y no vacía el
     colchón); por debajo, velocidad normal. En pausa se salta a la posición
     exacta si se aparta más de 0,3 s. */

import { PARTY, type PartyPlayback } from '@ace/shared';

/** Muestras del desfase que se guardan. */
const OFFSET_SAMPLES = 8;
/** En pausa, a partir de esto se coloca el vídeo en la posición exacta. */
const PAUSED_SNAP_S = 0.3;

export interface OffsetSample {
  readonly offsetMs: number;
  readonly rttMs: number;
}

/** Una muestra: `sentAt` y `receivedAt` en hora local, `serverNow` la que dijo el servidor. */
export function offsetSample(sentAt: number, receivedAt: number, serverNow: number): OffsetSample {
  const rttMs = Math.max(0, receivedAt - sentAt);
  return { offsetMs: serverNow - (sentAt + rttMs / 2), rttMs };
}

/** Añade una muestra y devuelve las que se guardan (las últimas `OFFSET_SAMPLES`). */
export function addSample(samples: readonly OffsetSample[], sample: OffsetSample): OffsetSample[] {
  return [...samples, sample].slice(-OFFSET_SAMPLES);
}

/** El desfase de la muestra con menos ida y vuelta (la más fiable); 0 sin muestras. */
export function bestOffset(samples: readonly OffsetSample[]): number {
  let best: OffsetSample | null = null;
  for (const sample of samples) if (!best || sample.rttMs < best.rttMs) best = sample;
  return best?.offsetMs ?? 0;
}

/** ¿El reloj de la sala corre? (reproduce y nadie carga). */
export function isRunning(playback: PartyPlayback): boolean {
  return playback.playing && playback.waitingFor.length === 0;
}

/** Posición de la sala a la hora del servidor `serverNow`, con tope en la duración. */
export function targetPosition(
  playback: PartyPlayback,
  serverNow: number,
  durationS: number | null,
): number {
  let position = playback.positionS;
  if (isRunning(playback)) position += Math.max(0, serverNow - playback.at) / 1000;
  if (durationS !== null) position = Math.min(position, durationS);
  return Math.max(0, position);
}

export type Correction =
  | { readonly kind: 'none' }
  | { readonly kind: 'seek'; readonly to: number }
  | { readonly kind: 'rate'; readonly rate: number };

/** Qué hacer con el vídeo para ir a la par: saltar, cambiar la velocidad o nada. */
export function correction(localS: number, targetS: number, running: boolean): Correction {
  const drift = targetS - localS;
  const size = Math.abs(drift);
  if (!running) return size > PAUSED_SNAP_S ? { kind: 'seek', to: targetS } : { kind: 'none' };
  if (size > PARTY.driftSeekS) return { kind: 'seek', to: targetS };
  if (size > PARTY.driftRateS) {
    return { kind: 'rate', rate: drift > 0 ? 1 + PARTY.driftRate : 1 - PARTY.driftRate };
  }
  return { kind: 'rate', rate: 1 };
}

/** «43:12» o «1:05:09» (el mismo formato que los avisos del servidor). */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
