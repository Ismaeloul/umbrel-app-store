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
     exacta si se aparta más de 0,3 s, pero una vez por orden (`pausedSeek`). */

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

/**
 * Qué hacer con el vídeo para ir a la par: saltar, cambiar la velocidad o nada. `seekS` es a partir
 * de cuánto se salta reproduciendo (`PARTY.driftSeekS`; más, mientras se absorbe con la velocidad lo
 * que quedó al colocarse, §16).
 */
export function correction(
  localS: number,
  targetS: number,
  running: boolean,
  seekS: number = PARTY.driftSeekS,
): Correction {
  const drift = targetS - localS;
  const size = Math.abs(drift);
  if (!running) return size > PAUSED_SNAP_S ? { kind: 'seek', to: targetS } : { kind: 'none' };
  if (size > seekS) return { kind: 'seek', to: targetS };
  if (size > PARTY.driftRateS) {
    return { kind: 'rate', rate: drift > 0 ? 1 + PARTY.driftRate : 1 - PARTY.driftRate };
  }
  return { kind: 'rate', rate: 1 };
}

/** El último salto en pausa: a dónde, con qué orden de la sala (`rev`), cuándo y cuántos reintentos. */
export interface PausedSeek {
  readonly to: number;
  readonly rev: number;
  readonly at: number;
  readonly retries: number;
}

/** Dos objetivos más cerca que esto son el mismo (la sala manda posiciones con milésimas). */
export const SAME_TARGET_S = 0.05;
/** Reintentos de un salto en pausa al mismo objetivo con la misma orden. */
const PAUSED_SEEK_RETRIES = 1;
/**
 * Si la sala espera a este aparato y está a esto o menos, no se mueve: que llene el colchón ahí. Al
 * seguir la sala, lo que quede hasta esto se absorbe con la velocidad (`correction`, `seekS`), no
 * con otro salto que tiraría ese mismo colchón (§16).
 */
export const WAITED_STAY_S = 2;

export interface PausedSeekInput {
  /** La orden de la sala (`playback.rev`, solo para recordarla) y la posición a la que hay que ir. */
  readonly rev: number;
  readonly target: number;
  /** Dónde está el vídeo ahora. */
  readonly localS: number;
  readonly last: PausedSeek | null;
  readonly now: number;
  /** Entre el salto y su reintento pasa al menos esto. */
  readonly backoffMs: number;
  /** ¿La sala espera a este aparato (`waitingFor`)? */
  readonly waitedFor: boolean;
}

/**
 * En pausa (la sala parada o esperando a alguien), ¿saltar a la posición de la sala? Devuelve el
 * salto que se hace (para recordarlo) o null si no se salta (docs/ver-juntos.md §16).
 *
 * Antes se saltaba siempre que el vídeo estuviera a más de 0,3 s, en cada tic. En el iPhone
 * (HLS nativo) un salto preciso a mitad de un trozo cae en otro sitio (el fotograma clave, o unas
 * décimas al lado), vacía lo cargado y vuelve a bajar el trozo entero: con la sala esperando a
 * ese mismo aparato, eran ~45 peticiones del mismo segmento en 18 s y nunca llenaba el colchón.
 * - La sala espera a este aparato y está a `WAITED_STAY_S` o menos: no se mueve.
 * - Ya saltó a este objetivo con esta orden: se da por colocado aunque Safari haya quedado unas
 *   décimas al lado. Solo se reintenta una vez, si quedó a más de `PARTY.driftSeekS` y pasado
 *   `backoffMs`.
 * - Otro objetivo (un salto o una pausa del líder): se salta. Un `rev` nuevo con el mismo objetivo
 *   (alguien más carga, alguien entra, la sala sigue) no es una orden nueva: cada uno volvía a
 *   vaciar lo cargado de todos los Safari que habían caído unas décimas al lado.
 */
export function pausedSeek(input: PausedSeekInput): PausedSeek | null {
  const { rev, target, localS, last, now } = input;
  const drift = Math.abs(target - localS);
  if (input.waitedFor && drift <= WAITED_STAY_S) return null;
  if (last === null || Math.abs(last.to - target) >= SAME_TARGET_S) {
    return { to: target, rev, at: now, retries: 0 };
  }
  if (last.retries >= PAUSED_SEEK_RETRIES) return null;
  if (drift <= PARTY.driftSeekS || now - last.at < input.backoffMs) return null;
  return { to: target, rev, at: now, retries: last.retries + 1 };
}

/**
 * «Esperando a todos» (docs/ver-juntos.md §13): cuánto lleva cargado este
 * aparato (el 100 % son `PARTY.lobbyBufferS` por delante, o hasta el final si
 * queda menos) y si ya puede empezar. Sin vídeo abierto, 0 y no listo.
 */
export function lobbyReport(
  hasVideo: boolean,
  positionS: number,
  readyState: number,
  bufferedS: number,
  durationS: number | null,
): { ready: boolean; progress: number } {
  if (!hasVideo) return { ready: false, progress: 0 };
  const left = durationS !== null ? Math.max(0, durationS - positionS) : PARTY.lobbyBufferS;
  const target = Math.max(0.5, Math.min(PARTY.lobbyBufferS, left));
  const ahead = Math.max(0, bufferedS - positionS);
  const progress = Math.min(100, Math.floor((ahead / target) * 100));
  /* HAVE_ENOUGH_DATA: el navegador cree que puede seguir sin parar. En el iPhone lo dice
     con muy poco por delante: además, al menos 4 s (o lo que quede, si es menos). */
  const ready = progress >= 100 || (readyState >= 4 && ahead >= Math.min(4, target));
  return { ready, progress: ready ? 100 : progress };
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

// --- ¿Está atascado? (docs/ver-juntos.md §16) ---

/** Huecos entre trozos cargados que se pasan por alto al medir el colchón. */
const BUFFER_GAP_S = 0.5;

/**
 * Hasta dónde hay vídeo cargado seguido desde `t`: el tramo que lo contiene
 * (o empieza justo después) y los siguientes separados por menos de
 * `BUFFER_GAP_S`. Safari y hls.js parten a veces lo cargado en tramos con
 * huecos de centésimas; sin unirlos, el colchón parecía de 6 s con 30 cargados.
 * `ranges` en orden, como `video.buffered`. Sin tramo útil, `t`.
 */
export function forwardBufferEnd(
  ranges: readonly (readonly [number, number])[],
  t: number,
  gapS = BUFFER_GAP_S,
): number {
  let end: number | null = null;
  for (const [start, stop] of ranges) {
    if (end === null) {
      if (stop <= t || start > t + gapS) continue;
      end = stop;
    } else if (start <= end + gapS) {
      end = Math.max(end, stop);
    } else {
      break;
    }
  }
  return end ?? t;
}

/** Colchón por delante para darse por recuperado: hls.js y el HLS nativo (Safari pide más). */
export const RESUME_AHEAD_S = { mse: 3, native: 4 } as const;
/** Tope del colchón cuando los atascos se repiten (cabe de sobra en `PARTY.holdMaxMs`). */
const RESUME_AHEAD_MAX_S = 10;
/** Un atasco a menos de esto del anterior sube el colchón pedido. */
const REPEAT_STALL_MS = 60_000;
/** Sin atascos en este tiempo, el colchón vuelve a ser el de partida. */
const CALM_MS = 120_000;
/** Reproduciendo sin que avance el tiempo durante esto, está atascado. */
const STILL_MS = 800;
/** Lo que tiene que haber avanzado el vídeo en `ADVANCE_WINDOW_MS` para darlo por suelto aunque falte colchón. */
const ADVANCE_S = 1;
const ADVANCE_WINDOW_MS = 1_600;
/** Los atascos hasta esto después de un salto nuestro no suben el colchón (los provoca el salto). */
const SELF_SEEK_MS = 2_000;

export interface StallInput {
  readonly now: number;
  readonly currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  /** Segundos de vídeo cargado por delante del cabezal. */
  readonly aheadS: number;
  /** Lo que queda de título, o null si no se sabe. */
  readonly leftS: number | null;
}

/**
 * Si el vídeo está atascado, con histéresis. Antes se miraba solo
 * `readyState < 3`: en el iPhone (HLS nativo) vuelve a 3 con apenas un
 * fotograma, la sala seguía sin colchón y el atasco volvía enseguida (el
 * «CD rayado»).
 *
 * - Entra si reproduce y el tiempo no avanza `STILL_MS`, si llega 'waiting'
 *   o si `readyState < 2` (no hay ni el fotograma actual).
 * - Sale solo con colchón: `aheadS` llega al pedido (o a lo que queda de
 *   título), con `readyState === 4` y 2 s por delante, o si el vídeo de
 *   verdad avanza (1 s en 1,6 s).
 * - Si los atascos se repiten (a menos de 60 s), pide más colchón: 4 → 6 →
 *   10 s en el iPhone; tras 2 min sin atascos, vuelve al de partida. Con `pausedMaxS`
 *   (el iPhone), en pausa no se piden más de esos segundos.
 */
export class StallDetector {
  private stalled = false;
  private lastTime = Number.NaN;
  private movedAt = 0;
  private samples: { at: number; t: number }[] = [];
  private needS: number;
  private lastStallAt = Number.NEGATIVE_INFINITY;
  private selfSeekAt = Number.NEGATIVE_INFINITY;
  private repeats = 0;

  /**
   * `pausedMaxS`: con el vídeo en pausa, el colchón pedido no pasa de esto. En el iPhone, con la
   * sala esperando a este aparato, AVPlayer puede no llenar 10 s en pausa y la espera llegaba
   * siempre al tope (§16); el `resumeSettleMs` del servidor ya cubre un «ya no cargo» corto.
   */
  constructor(
    private readonly baseS: number,
    private readonly options: { readonly pausedMaxS?: number } = {},
  ) {
    this.needS = baseS;
  }

  /** Colchón que se pide ahora para darse por recuperado. */
  get resumeAheadS(): number {
    return this.needS;
  }

  get isStalled(): boolean {
    return this.stalled;
  }

  /**
   * Atascos repetidos (a menos de 60 s del anterior y no provocados por un salto nuestro) desde
   * que se creó: cada uno sube el colchón. En Safari, el primero pasa a la versión ligera
   * (docs/ver-juntos.md §17).
   */
  get escalations(): number {
    return this.repeats;
  }

  /** Un salto o una carga nuestra: el tiempo vuelve a contar desde aquí. */
  moved(now: number, selfSeek: boolean): void {
    this.lastTime = Number.NaN;
    this.movedAt = now;
    this.samples = [];
    if (selfSeek) this.selfSeekAt = now;
  }

  /** Llegó 'waiting' del vídeo: se queda sin datos ya. */
  waiting(now: number): void {
    this.enter(now);
  }

  /** Quita el estado (vídeo nuevo). */
  reset(now: number): void {
    this.stalled = false;
    this.moved(now, false);
  }

  update(input: StallInput): boolean {
    const { now } = input;
    if (now - this.lastStallAt > CALM_MS) this.needS = this.baseS;
    const playing = !input.paused && !input.seeking && !input.ended;
    /* El reloj de «no avanza» solo corre reproduciendo: en pausa (la sala espera) o
       saltando, se pone a cero. Si no, al reanudar contaba toda la pausa como
       atasco y volvía a parar la sala (revisión del 1-11-2026). */
    if (!playing) {
      this.movedAt = now;
      this.samples = [];
    }
    if (Number.isNaN(this.lastTime) || input.currentTime !== this.lastTime) {
      if (!Number.isNaN(this.lastTime) && input.currentTime > this.lastTime) this.movedAt = now;
      if (Number.isNaN(this.lastTime)) this.movedAt = now;
      this.lastTime = input.currentTime;
    }
    this.samples = [...this.samples, { at: now, t: input.currentTime }].filter(
      (sample) => now - sample.at <= ADVANCE_WINDOW_MS,
    );
    if (!this.stalled) {
      const still = playing && input.readyState >= 1 && now - this.movedAt >= STILL_MS;
      if (input.readyState < 2 || still) this.enter(now);
      return this.stalled;
    }
    const asked =
      input.paused && this.options.pausedMaxS !== undefined
        ? Math.min(this.needS, this.options.pausedMaxS)
        : this.needS;
    const need = input.leftS === null ? asked : Math.min(asked, Math.max(0, input.leftS - 0.5));
    const oldest = this.samples[0];
    const advancing =
      playing &&
      input.readyState >= 3 &&
      oldest !== undefined &&
      now - oldest.at >= ADVANCE_WINDOW_MS - 600 &&
      input.currentTime - oldest.t >= ADVANCE_S;
    if (input.aheadS >= need || (input.readyState === 4 && input.aheadS >= 2) || advancing) {
      this.stalled = false;
      this.movedAt = now;
    }
    return this.stalled;
  }

  private enter(now: number): void {
    if (this.stalled) return;
    this.stalled = true;
    /* Repetido y no provocado por un salto nuestro: más colchón la próxima vez. */
    if (now - this.lastStallAt < REPEAT_STALL_MS && now - this.selfSeekAt > SELF_SEEK_MS) {
      this.needS = Math.min(RESUME_AHEAD_MAX_S, this.needS === this.baseS ? 6 : RESUME_AHEAD_MAX_S);
      this.repeats += 1;
    }
    this.lastStallAt = now;
  }
}
