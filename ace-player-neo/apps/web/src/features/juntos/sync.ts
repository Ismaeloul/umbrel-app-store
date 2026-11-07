/* «Ver juntos» (docs/ver-juntos.md §6): cómo se mantiene cada reproductor a
   la par de la sala. Funciones puras: se prueban solas.

   - Reloj: la sala manda horas del servidor. El desfase con el reloj de este
     aparato se estima con cada petición (`status`, `control`): con las cuatro
     marcas (salida, llegada al servidor, respuesta, vuelta) si el servidor
     manda `receivedAt`; si no, con la mitad de la ida y vuelta. Gana la
     muestra de menos retardo de las del último minuto. Un cambio pequeño se
     acerca poco a poco (`slewOffset`): un salto de reloj de 50 ms en mitad de
     la película era un tirón de velocidad para nada.
   - Posición de la sala «ahora»: la de `playback` más lo transcurrido si
     reproduce y nadie carga.
   - Corrección (`correction`): con más de `seekS` de diferencia se salta; por
     debajo, control proporcional de la velocidad (`DRIFT_TAU_S`), con
     histéresis para no oscilar y un tope por motor. En pausa se salta a la
     posición exacta si se aparta más de `PAUSED_SNAP_S`, pero una vez por
     orden (`pausedSeek`).
   - Latencia de un salto (`seekLead`): lo que tarda el vídeo en volver a
     avanzar tras un salto, medido en este aparato (aparte los saltos con
     datos y los que caen sin datos, `coldSeekLead`). Reproduciendo, se salta
     a la posición de la sala más eso, para caer donde ya va la sala. */

import { PARTY, type PartyPlayback } from '@ace/shared';

/** Muestras del desfase que se guardan. */
const OFFSET_SAMPLES = 8;
/** Una muestra del desfase de más de esto ya no cuenta (el reloj del aparato también deriva). */
export const OFFSET_MAX_AGE_MS = 60_000;
/** Un desfase nuevo que se aparta menos de esto se acerca poco a poco; más, de golpe. */
export const OFFSET_JUMP_MS = 300;
/** Al acercarse poco a poco, como mucho esto por cada `OFFSET_STEP_EVERY_MS` (un tic). */
export const OFFSET_STEP_MS = 10;
export const OFFSET_STEP_EVERY_MS = 500;

/** El motor del vídeo: hls.js (MSE) o el HLS nativo de Safari y el iPhone. */
export type SyncEngine = 'mse' | 'native';

/**
 * En pausa, a partir de esto se coloca el vídeo en la posición exacta. hls.js cae justo donde se
 * le pide; Safari, en el fotograma clave o unas décimas al lado (§16).
 */
export const PAUSED_SNAP_S: Readonly<Record<SyncEngine, number>> = { mse: 0.05, native: 0.3 };

/**
 * Hora de este aparato que no va hacia atrás: `performance.timeOrigin + performance.now()` (un
 * cambio de hora del sistema o un ajuste de NTP no mueve el desfase); `Date.now()` si no hay.
 */
export function monotonicNow(): number {
  try {
    const perf = globalThis.performance as Performance | undefined;
    if (perf && typeof perf.now === 'function' && Number.isFinite(perf.timeOrigin)) {
      return perf.timeOrigin + perf.now();
    }
  } catch {}
  return Date.now();
}

export interface OffsetSample {
  readonly offsetMs: number;
  /** El retardo de red de la muestra (ida y vuelta menos lo que tardó el servidor). */
  readonly rttMs: number;
  /** Cuándo se tomó (hora local); sin ella, no caduca. */
  readonly at?: number;
}

/**
 * Una muestra: `sentAt` y `receivedAt` en hora local, `serverNow` la que dijo el servidor al
 * responder y `serverReceivedAt` la de cuando le llegó la petición (`receivedAt` de la respuesta).
 * Con las cuatro marcas (como NTP): desfase = ((t1 − t0) + (t2 − t3)) / 2 y retardo =
 * (t3 − t0) − (t2 − t1); lo que tarda el servidor en responder (`status` espera al latido de la
 * sesión de vídeo) ya no tuerce el desfase. Sin `serverReceivedAt`, la mitad de la ida y vuelta.
 */
export function offsetSample(
  sentAt: number,
  receivedAt: number,
  serverNow: number,
  serverReceivedAt?: number,
): OffsetSample {
  if (serverReceivedAt !== undefined && serverReceivedAt <= serverNow) {
    const offsetMs = (serverReceivedAt - sentAt + (serverNow - receivedAt)) / 2;
    const rttMs = Math.max(0, receivedAt - sentAt - (serverNow - serverReceivedAt));
    return { offsetMs, rttMs, at: receivedAt };
  }
  const rttMs = Math.max(0, receivedAt - sentAt);
  return { offsetMs: serverNow - (sentAt + rttMs / 2), rttMs, at: receivedAt };
}

/**
 * Añade una muestra y devuelve las que se guardan: las últimas `OFFSET_SAMPLES` que no hayan
 * caducado (`OFFSET_MAX_AGE_MS` antes de `now`; sin `now`, no caduca ninguna).
 */
export function addSample(
  samples: readonly OffsetSample[],
  sample: OffsetSample,
  now?: number,
): OffsetSample[] {
  return freshSamples([...samples, sample], now).slice(-OFFSET_SAMPLES);
}

/** Las muestras de menos de `OFFSET_MAX_AGE_MS` antes de `now` (las que no dicen cuándo, también). */
export function freshSamples(samples: readonly OffsetSample[], now?: number): OffsetSample[] {
  if (now === undefined) return [...samples];
  return samples.filter(
    (sample) => sample.at === undefined || now - sample.at <= OFFSET_MAX_AGE_MS,
  );
}

/** La muestra con menos retardo (la más fiable), o null. */
export function bestSample(samples: readonly OffsetSample[]): OffsetSample | null {
  let best: OffsetSample | null = null;
  for (const sample of samples) if (!best || sample.rttMs < best.rttMs) best = sample;
  return best;
}

/** El desfase de la muestra con menos retardo; 0 sin muestras. */
export function bestOffset(samples: readonly OffsetSample[]): number {
  return bestSample(samples)?.offsetMs ?? 0;
}

/**
 * El desfase que se usa, acercándose de `fromMs` a `toMs`: `OFFSET_STEP_MS` por cada
 * `OFFSET_STEP_EVERY_MS` transcurridos (`elapsedMs`), sin pasarse.
 */
export function slewOffset(fromMs: number, toMs: number, elapsedMs: number): number {
  const step = (Math.max(0, elapsedMs) / OFFSET_STEP_EVERY_MS) * OFFSET_STEP_MS;
  const diff = toMs - fromMs;
  return fromMs + Math.max(-step, Math.min(step, diff));
}

/** ¿Un desfase nuevo se aplica de golpe? (se aparta `OFFSET_JUMP_MS` o más del que se usa). */
export function offsetJumps(currentMs: number, nextMs: number): boolean {
  return Math.abs(nextMs - currentMs) >= OFFSET_JUMP_MS;
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

/** Control proporcional: la velocidad corrige la deriva en unos `DRIFT_TAU_S` (sin tope). */
export const DRIFT_TAU_S = 4;
/**
 * Se empieza a corregir con más de esto de deriva… En Safari (AVPlayer), cada cambio de
 * `playbackRate` corta el audio un instante para recolocarlo: con 0,06 s (la 1.1.2) cambiaba cada
 * pocos segundos y en el iPhone se oía «a trozos». Ahí solo se corrige un desfase que se note.
 */
export const DRIFT_START_S: Readonly<Record<SyncEngine, number>> = { mse: 0.06, native: 0.3 };
/** …y se para con menos de esto (histéresis: entre los dos, sigue como iba). */
export const DRIFT_STOP_S: Readonly<Record<SyncEngine, number>> = { mse: 0.02, native: 0.08 };
/** Pasos de la velocidad (un 1 %): no se cambia en cada tic por milésimas. */
export const RATE_STEP = 0.01;
/** Lo más que se acelera o frena con hls.js: lo aguanta sin vaciar el colchón. */
export const DRIFT_MAX_RATE: Readonly<Record<SyncEngine, number>> = { mse: 0.1, native: 0.05 };
/**
 * En Safari, una sola velocidad fija por corrección (no proporcional): cada escalón sería otro
 * corte de audio. 0,3 s se recuperan en unos 6 s.
 */
export const DRIFT_RATE_NATIVE = 0.05;
/** En Safari, entre el fin de una corrección y el principio de la siguiente, al menos esto. */
export const NATIVE_RATE_HOLD_MS = 8_000;

export interface CorrectionOptions {
  /**
   * A partir de cuánto se salta reproduciendo (`PARTY.driftSeekS`; en Safari, más mientras se
   * absorbe con la velocidad lo que quedó al colocarse, §16).
   */
  readonly seekS?: number;
  readonly engine?: SyncEngine;
  /** ¿Se estaba corrigiendo con la velocidad en el tic anterior? (la histéresis). */
  readonly correcting?: boolean;
}

/** La velocidad para una deriva (`drift` > 0: el vídeo va por detrás), ya con tope y en pasos. */
export function driftRate(drift: number, engine: SyncEngine): number {
  if (engine === 'native') return Number((1 + Math.sign(drift) * DRIFT_RATE_NATIVE).toFixed(2));
  const size = Math.abs(drift);
  const max = DRIFT_MAX_RATE[engine];
  const raw = Math.min(max, size / DRIFT_TAU_S);
  /* En pasos de `RATE_STEP`, y al menos uno: corrigiendo, la velocidad nunca se queda en 1. */
  const stepped = Math.max(RATE_STEP, Math.min(max, Math.round(raw / RATE_STEP) * RATE_STEP));
  return Number((1 + Math.sign(drift) * stepped).toFixed(2));
}

/**
 * Qué hacer con el vídeo para ir a la par: saltar, cambiar la velocidad o nada.
 *
 * Antes, por debajo de `PARTY.driftRateS` (0,25 s) no se corregía nada y, por encima, un ±5 % fijo:
 * casi un segundo de retraso podía quedarse ahí. Ahora la velocidad es proporcional a la deriva
 * (`1 + deriva / DRIFT_TAU_S`, con tope por motor) y se corrige desde `DRIFT_START_S` hasta bajar
 * de `DRIFT_STOP_S`. Los números de `PARTY` (`driftRate`, `driftRateS`) no cambian: los copia la
 * app iOS.
 */
export function correction(
  localS: number,
  targetS: number,
  running: boolean,
  options: CorrectionOptions = {},
): Correction {
  const engine = options.engine ?? 'mse';
  const seekS = options.seekS ?? PARTY.driftSeekS;
  const drift = targetS - localS;
  const size = Math.abs(drift);
  if (!running) {
    return size > PAUSED_SNAP_S[engine] ? { kind: 'seek', to: targetS } : { kind: 'none' };
  }
  if (size > seekS) return { kind: 'seek', to: targetS };
  const threshold = options.correcting ? DRIFT_STOP_S[engine] : DRIFT_START_S[engine];
  if (size <= threshold) return { kind: 'rate', rate: 1 };
  return { kind: 'rate', rate: driftRate(drift, engine) };
}

// --- Lo que tarda un salto (docs/ver-juntos.md §6) ---

/** Lo que tarda un salto hasta que el vídeo vuelve a avanzar, de partida, por motor. */
export const SEEK_LEAD_DEFAULT_MS: Readonly<Record<SyncEngine, number>> = {
  mse: 150,
  native: 800,
};
/** Más que esto no se compensa (una medida así es un atasco, no un salto). */
export const SEEK_LEAD_MAX_MS = 3_000;
/** Peso de cada medida nueva en la media móvil. */
export const SEEK_LEAD_ALPHA = 0.3;
/** Si lo que se salta de más no está cargado, como mucho esto (sin datos, el salto tarda más). */
export const SEEK_LEAD_UNBUFFERED_MS = 300;

/**
 * La latencia de un salto en este aparato: la media móvil (EWMA, `SEEK_LEAD_ALPHA`) de las medidas
 * (`samples`, en ms, de la más vieja a la más nueva), empezando por la de partida del motor y con
 * tope en `SEEK_LEAD_MAX_MS`. Cada medida es lo que pasó desde el salto hasta que el vídeo volvió
 * a avanzar de verdad: al llegar el primer `timeupdate` que avanza (o `playing` tras `seeked`), lo
 * ya avanzado se descuenta (`timeupdate` llega cada ~250 ms). Solo saltos que cayeron en lo
 * cargado; los demás van a `coldSeekLead`.
 */
export function seekLead(samples: readonly number[], engine: SyncEngine): number {
  let lead: number = SEEK_LEAD_DEFAULT_MS[engine];
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    const clamped = Math.max(0, Math.min(SEEK_LEAD_MAX_MS, sample));
    lead += SEEK_LEAD_ALPHA * (clamped - lead);
  }
  return Math.max(0, Math.min(SEEK_LEAD_MAX_MS, lead));
}

/**
 * Lo que tarda un salto SIN datos en este aparato (bajar el trozo y arrancar): la media móvil de
 * lo medido en saltos que cayeron fuera de lo cargado, empezando por la primera medida; null si aún
 * no hay ninguna. Va aparte de `seekLead`: mezclados, un salto sin datos (1,5-3 s) inflaba la media
 * y los saltos con datos caían por delante de la sala.
 */
export function coldSeekLead(samples: readonly number[]): number | null {
  let lead: number | null = null;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    const clamped = Math.max(0, Math.min(SEEK_LEAD_MAX_MS, sample));
    lead = lead === null ? clamped : lead + SEEK_LEAD_ALPHA * (clamped - lead);
  }
  return lead;
}

/** A dónde saltar y si el salto cae en lo cargado (para medirlo con las suyas). */
export interface SeekPlan {
  readonly to: number;
  readonly loaded: boolean;
}

/**
 * A dónde saltar reproduciendo: la posición de la sala más lo que tarda el salto. Si eso está
 * cargado, con lo medido en saltos con datos (`leadMs`); si no, con lo medido en saltos sin datos
 * (`coldLeadMs`) o, sin medidas, `SEEK_LEAD_UNBUFFERED_MS` como mucho. Con tope en la duración.
 */
export function seekPlan(
  targetS: number,
  leadMs: number,
  ranges: readonly (readonly [number, number])[],
  durationS: number | null,
  coldLeadMs: number | null = null,
): SeekPlan {
  const full = targetS + leadMs / 1000;
  const loaded = ranges.some(([start, stop]) => start <= targetS && full <= stop);
  const extraMs = loaded ? leadMs : (coldLeadMs ?? Math.min(leadMs, SEEK_LEAD_UNBUFFERED_MS));
  const to = targetS + extraMs / 1000;
  return { to: durationS !== null ? Math.min(to, durationS) : to, loaded };
}

/** `seekPlan`, solo la posición. */
export function leadTarget(
  targetS: number,
  leadMs: number,
  ranges: readonly (readonly [number, number])[],
  durationS: number | null,
  coldLeadMs: number | null = null,
): number {
  return seekPlan(targetS, leadMs, ranges, durationS, coldLeadMs).to;
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
