/* «Calidad ligera para invitados» (docs/ver-juntos.md §17): la versión 720p
   H.264 de una sesión VOD de «Ver juntos», hecha a partir de los segmentos
   que el productor YA tiene en disco.

   - Nunca otra conexión con el relé ni con el proveedor (una sola plaza, y el
     relé da la razón a la petición más nueva, iptv/relay-vod.ts): cada trabajo
     es un ffmpeg corto que lee `init.mp4` + `index<N>.m4s` por la tubería
     (vod/lite-args.ts) y saca `lo_index<N>.m4s`. Los límites, los `EXTINF` y
     los tiempos son los de la original por construcción; el reloj de la sala
     y la sincronía no cambian.
   - Perezosa: se crea con la primera petición `lo_*` de la sesión y solo
     trabaja mientras alguien las pide. Un trabajo a la vez, en orden, como
     mucho `aheadSegments` (3) y `aheadMaxS` (20 s) por delante del último
     `lo_index<N>` pedido (el cursor ligero), por debajo de los 30 s de
     `restartAheadS`: nunca pide un reinicio al productor.
   - Varios invitados en la misma ligera (cada uno con su búfer: uno 30 s por
     delante, otro que acaba de entrar) no se pisan: se recuerdan los cursores
     de las peticiones recientes (`recentMs`, al menos 10 s y dos segmentos) y
     la cola es la unión de sus ventanas. Un trabajo solo se mata si cae fuera
     de TODAS y nadie lo espera; se elige primero lo que alguien espera y
     luego lo más bajo. Sin esto, dos invitados a más de `aheadSegments` se
     mataban el trabajo el uno al otro hasta el 404 de los dos.
   - Lee del productor sin moverlo (`readySegment`, `onSegmentReady`): el
     cursor del productor es UNO, el de las peticiones de verdad (las `lo_*`
     lo mueven con `touch()` desde la ruta, no desde aquí). Fija en el
     productor `[min(cursores) − 1, max(cursores) + aheadSegments]` para que el recorte no
     le borre lo que aún tiene que leer; sus ficheros, en la misma carpeta
     `vod-<sid>`, cuentan en el tope de la sesión y se recortan con la misma
     ventana de 120 s por detrás.
   - Cada salida se comprueba: el primer init es `lo_init.mp4` y los
     siguientes tienen que casar con él (`sameLiteInit`: los mismos `stsd`
     salvo los caudales informativos del audio, que ffmpeg mide en cada
     trabajo); el primer fragmento es clave y empieza donde el original (a
     menos de un fotograma, en presentación y en `tfdt`). Se escribe
     `.part` y se renombra.
   - Plaza: cuenta en el tope de recodificaciones del remux (`MAX_DEINTERLACE`,
     con el desentrelazado y la ligera del directo); la coge con la primera
     petición, sin quitársela a nadie, y la suelta tras `idleMs` (60 s) sin
     peticiones `lo_*`.
   - Fusible (para toda la sesión, `tripped`): 3 trabajos seguidos fallidos o
     inválidos, menos de 1,5× el tiempo real de media en 3 segmentos, un init
     que no casa, sin plaza o sin ffmpeg. Con el fusible, `lo_*` da 404 y el
     reproductor tira de la original (lo de hoy); las concesiones nuevas de la
     sala vuelven a ser `index.m3u8`.
   - Una petición a un segmento que se está codificando espera `waitMs` (4 s);
     a uno que no estaba en la cola (un salto: el cursor se va allí),
     `repositionWaitMs` (6 s). Después, 503 «aún no está»; a la segunda vez,
     404 y el reproductor coge ese trozo de la original en vez de parar la
     sala. */

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LITE_VOD, VOD_PLAY } from '@ace/shared';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import { AppError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { RingLog } from '../process.js';
import { Fmp4Splitter, type Fmp4FragmentInfo, type Fmp4Init } from './fmp4.js';
import { LITE_VIDEO_CODECS, buildVodLiteArgs } from './lite-args.js';
import type { VodPlan } from './plan.js';
import {
  LITE_INIT_FILE,
  LITE_PLAYLIST_FILE,
  LITE_PREFIX,
  VOD_MASTER_FILE,
  averageBitrate,
  liteResolution,
  segmentFileName,
} from './playlist.js';
import type { LiteProcess, LiteProcessLauncher, VodIndex } from './types.js';

/** «Un fotograma» al comprobar los tiempos: el de 24 imágenes por segundo. */
export const LITE_FRAME_TOLERANCE_S = 0.042;
/** Tope de la salida de un trabajo (un segmento de 15 s a 2,5 Mb/s son unos 5 MB). */
export const LITE_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
/** Un trabajo que tarda más que esto (o 3× la duración del segmento) se mata y cuenta como fallo. */
export const LITE_JOB_MIN_TIMEOUT_MS = 20_000;
/** Por encima de esto (y de 720 de alto) la original no necesita versión ligera. */
export const LITE_SOURCE_MIN_BITRATE = 3_000_000;
/** Fuentes de hasta 1080 de alto: más (4K) no da abasto en software en el N300. */
export const LITE_SOURCE_MAX_HEIGHT = 1080;

/**
 * ¿Esta original tiene versión ligera, y cuál? (docs/ver-juntos.md §17)
 * - `master`: H.264 de 8 bits y hasta 1080 de alto que pasa de 720 o de 3 Mb/s: las dos, la ligera
 *   primero.
 * - `lite`: HEVC de 8 bits y hasta 1080 para quien no decodifica HEVC (hoy no puede verla): solo
 *   la ligera. Con HEVC no hay maestra: hls.js no cambia de nivel entre `hvc1` y `avc1`.
 * - null: lo de siempre (`index.m3u8`).
 */
export function liteVariantFor(index: VodIndex, hevcOk: boolean): 'master' | 'lite' | null {
  const { video } = index;
  const height = video.height;
  if (!height || height > LITE_SOURCE_MAX_HEIGHT) return null;
  if ((video.bitDepth ?? 8) > 8 || (video.chromaFormat ?? 1) !== 1) return null;
  if (video.codec === 'h264') {
    return height > 720 || averageBitrate(index) > LITE_SOURCE_MIN_BITRATE ? 'master' : null;
  }
  if (video.codec === 'hevc') return hevcOk ? null : 'lite';
  return null;
}

/** Lo que una sala puede dar a un invitado de fuera en vez de `index.m3u8` (§17). */
export interface LiteOffer {
  /** `master`: las dos (la ligera primero); `lite`: solo la ligera (HEVC sin decodificador). */
  readonly kind: 'master' | 'lite';
  readonly file: typeof VOD_MASTER_FILE | typeof LITE_PLAYLIST_FILE;
  /** Códecs de vídeo RFC 6381 de cada versión (`hd` null: solo hay ligera). */
  readonly variants: { readonly hd: string | null; readonly lite: string };
  /** El vídeo de la ligera (para la concesión cuando solo hay ligera). */
  readonly lite: { readonly codecs: string; readonly width: number; readonly height: number };
}

export interface LiteOfferInput {
  /** `ACE_PARTY_LITE=1`. */
  readonly enabled: boolean;
  readonly ffmpegMissing: boolean;
  /** El fusible de la sesión está fundido. */
  readonly tripped: boolean;
  /** Hay plaza de recodificación (o esta sesión ya tiene la suya). */
  readonly slot: boolean;
  readonly index: VodIndex;
  /** El invitado decodifica HEVC. */
  readonly hevcOk: boolean;
}

/** La decisión entera de `vodLiteOffer` (remux/service.ts), pura: null es `index.m3u8`. */
export function liteOfferFor(input: LiteOfferInput): LiteOffer | null {
  if (!input.enabled || input.ffmpegMissing || input.tripped || !input.slot) return null;
  const kind = liteVariantFor(input.index, input.hevcOk);
  if (!kind) return null;
  const { video } = input.index;
  return {
    kind,
    file: kind === 'master' ? VOD_MASTER_FILE : LITE_PLAYLIST_FILE,
    variants: { hd: kind === 'master' ? video.codecs.slice(0, 64) : null, lite: LITE_VIDEO_CODECS },
    lite: { codecs: LITE_VIDEO_CODECS, ...liteResolution(video.width, video.height) },
  };
}

/** Por qué se ha fundido la versión ligera de una sesión. */
export type LiteTripReason = 'fallos' | 'lento' | 'init' | 'plaza' | 'ffmpeg';

export interface LiteStatus {
  /** `on`: trabajando (con plaza); `off`: sin peticiones (sin plaza); `tripped`: fundida. */
  readonly state: 'on' | 'off' | 'tripped';
  readonly reason: LiteTripReason | null;
  readonly cursor: number | null;
  readonly encoded: number;
  readonly failures: number;
  /** Velocidad media de los últimos trabajos (× tiempo real), o null sin medidas. */
  readonly speed: number | null;
}

/** Lo que la versión ligera lee del productor (vod/producer.ts): nada de esto mueve su cursor. */
export interface LiteSource {
  readonly plan: VodPlan;
  initFilePath(): string | null;
  readySegment(segment: number): string | null;
  requestedSegment(): number;
  onSegmentReady(listener: (segment: number) => void): () => void;
  onRestart(listener: (segment: number) => void): () => void;
  pin(from: number, to: number): void;
  unpin(): void;
  setExtraBytes(bytes: number): void;
}

/** La plaza de recodificación (el tope `MAX_DEINTERLACE` del remux). */
export interface LiteSlot {
  /** true si la hay (y queda cogida); false si no cabe otra recodificación. */
  acquire(): boolean;
  release(): void;
}

export interface LiteLimits {
  readonly aheadSegments: number;
  readonly aheadMaxS: number;
  readonly waitMs: number;
  readonly repositionWaitMs: number;
  readonly idleMs: number;
  readonly minSpeed: number;
  readonly speedWindow: number;
  readonly maxFailures: number;
  readonly missesBeforeGone: number;
  readonly keepBehindS: number;
  /** Cuánto se recuerda el cursor de una petición (mínimo: se alarga a dos segmentos largos). */
  readonly recentMs: number;
}

export const DEFAULT_LITE_LIMITS: LiteLimits = {
  aheadSegments: LITE_VOD.aheadSegments,
  aheadMaxS: LITE_VOD.aheadMaxS,
  waitMs: LITE_VOD.waitMs,
  repositionWaitMs: LITE_VOD.repositionWaitMs,
  idleMs: LITE_VOD.idleMs,
  minSpeed: LITE_VOD.minSpeed,
  speedWindow: LITE_VOD.speedWindow,
  maxFailures: LITE_VOD.maxFailures,
  missesBeforeGone: LITE_VOD.missesBeforeGone,
  keepBehindS: VOD_PLAY.keepBehindS,
  recentMs: 10_000,
};

export interface LiteRenditionDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly launcher: LiteProcessLauncher;
  readonly slot: LiteSlot;
  /** Limpia la cola de stderr de ffmpeg antes de escribirla en el registro. */
  readonly redact?: (text: string) => string;
  /** Se ha fundido (una vez). */
  readonly onTrip?: (reason: LiteTripReason) => void;
}

export interface LiteRenditionOptions {
  readonly sessionId: string;
  /** La carpeta del productor (`remuxDir/vod-<sid>`). */
  readonly dir: string;
  readonly source: LiteSource;
  readonly limits?: Partial<LiteLimits>;
}

export type LiteFileResult =
  | { readonly kind: 'file'; readonly path: string; readonly size: number }
  /** Aún no: 503 con `Retry-After: 1`. */
  | { readonly kind: 'not_yet' }
  /** No va a estar (fundida, fallido o perdido dos veces): 404 y el reproductor coge la original. */
  | { readonly kind: 'missing' };

export interface LiteOutput {
  readonly init: Fmp4Init;
  /** El primer fragmento (su `moof`). */
  readonly first: Fmp4FragmentInfo;
  /** Los fragmentos (`moof` + `mdat`), sin el init: lo que va en `lo_index<N>.m4s`. */
  readonly media: Buffer;
}

/** Init y fragmentos de un fMP4 entero (la salida de un trabajo, o init + segmento original). */
export function splitFmp4(data: Buffer): LiteOutput {
  let init: Fmp4Init | null = null;
  let first: Fmp4FragmentInfo | null = null;
  const parts: Buffer[] = [];
  const splitter = new Fmp4Splitter({
    onInit: (value) => (init = value),
    onFragment: (info) => (first ??= info),
    onData: (chunk) => parts.push(Buffer.from(chunk)),
    onFragmentEnd: () => undefined,
  });
  splitter.push(data);
  splitter.end();
  if (!init || !first) {
    throw new AppError('vod_dropped', { detail: 'fMP4 ligero sin init o sin fragmentos' });
  }
  return { init, first, media: Buffer.concat(parts) };
}

/** Lee un tamaño de descriptor MPEG-4 (1 a 4 bytes de 7 bits). Devuelve la posición siguiente. */
function skipDescriptorSize(data: Buffer, pos: number): number {
  let p = pos;
  for (let i = 0; i < 4 && p < data.length; i += 1) {
    const byte = data[p] as number;
    p += 1;
    if (!(byte & 0x80)) break;
  }
  return p;
}

/**
 * Un `stsd` sin lo que ffmpeg mide en cada trabajo: el `btrt` y los caudales y el búfer del
 * `DecoderConfigDescriptor` del `esds` (informativos: el decodificador no los usa).
 */
export function stsdWithoutBitrates(stsd: Buffer): Buffer {
  const out = Buffer.from(stsd);
  const btrt = out.indexOf('btrt', 0, 'latin1');
  if (btrt >= 4 && btrt + 16 <= out.length) out.fill(0, btrt + 4, btrt + 16);
  const esds = out.indexOf('esds', 0, 'latin1');
  if (esds >= 4) {
    let p = esds + 8; /* tipo + versión y banderas */
    if (out[p] === 0x03) {
      p = skipDescriptorSize(out, p + 1);
      p += 2; /* ES_ID */
      const flags = out[p] ?? 0;
      p += 1;
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + (out[p] ?? 0);
      if (flags & 0x20) p += 2;
      if (out[p] === 0x04) {
        p = skipDescriptorSize(out, p + 1);
        p += 2; /* objectTypeIndication + streamType */
        if (p + 11 <= out.length) out.fill(0, p, p + 11);
      }
    }
  }
  return out;
}

/** ¿Se puede servir un fragmento ligero de un trabajo con el `lo_init.mp4` de otro? */
export function sameLiteInit(a: Fmp4Init, b: Fmp4Init): boolean {
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((track, i) => {
    const other = b.tracks[i];
    if (!other || track.id !== other.id || track.handler !== other.handler) return false;
    if (track.timescale !== other.timescale) return false;
    return stsdWithoutBitrates(track.stsd).equals(stsdWithoutBitrates(other.stsd));
  });
}

interface Job {
  readonly segment: number;
  aborted: boolean;
  kill: () => void;
}

interface JobRun {
  readonly code: number | null;
  readonly output: Buffer | null;
  /** No hay ffmpeg (ENOENT). */
  readonly missing: boolean;
  readonly detail: string | null;
}

export class LiteRendition {
  private readonly limits: LiteLimits;
  private readonly plan: VodPlan;
  private readonly done = new Map<number, number>();
  private readonly bad = new Set<number>();
  private readonly misses = new Map<number, number>();
  private readonly waiters = new Map<number, Set<() => void>>();
  private readonly initWaiters = new Set<() => void>();
  private readonly speeds: { readonly mediaS: number; readonly wallMs: number }[] = [];
  private readonly unsubscribe: (() => void)[];
  /** El último `lo_index<N>` pedido (el estado y `lo_init.mp4`). */
  private cursor: number | null = null;
  /** Los cursores de las peticiones recientes: segmento → última petición (ms del reloj). */
  private readonly recent = new Map<number, number>();
  private readonly recentMs: number;
  private job: Job | null = null;
  private init: Fmp4Init | null = null;
  private initPath: string | null = null;
  private failures = 0;
  private trippedBy: LiteTripReason | null = null;
  private slotHeld = false;
  private idleTimer: TimerHandle | null = null;
  private closed = false;
  private jobs = 0;

  constructor(
    private readonly deps: LiteRenditionDeps,
    private readonly options: LiteRenditionOptions,
  ) {
    this.limits = { ...DEFAULT_LITE_LIMITS, ...options.limits };
    this.plan = options.source.plan;
    /* Un invitado al día pide un segmento por cada uno que ve: su cursor tiene que durar más
       que eso, o el de otro le mataría lo que se le adelanta. */
    let longestMs = 0;
    for (const planned of this.plan.segments) {
      longestMs = Math.max(longestMs, (planned.endS - planned.startS) * 1000);
    }
    this.recentMs = Math.min(this.limits.idleMs, Math.max(this.limits.recentMs, 2 * longestMs));
    this.unsubscribe = [
      options.source.onSegmentReady((segment) => {
        if (this.inAnyWindow(segment)) this.pump();
      }),
      /* La original arranca en otro sitio (un salto): lo que se estuviera codificando fuera de
         todas las ventanas sobra (si nadie lo espera); la cola sale de los cursores, así que no
         hay más que tirar. */
      options.source.onRestart(() => {
        if (this.job && !this.wanted(this.job.segment)) this.abortJob();
        this.pump();
      }),
    ];
  }

  /** ¿Tiene ahora una plaza de recodificación? (cuenta en el tope del remux). */
  get holdsSlot(): boolean {
    return this.slotHeld;
  }

  /** Por qué se fundió, o null. */
  get tripped(): LiteTripReason | null {
    return this.trippedBy;
  }

  status(): LiteStatus {
    return {
      state: this.trippedBy ? 'tripped' : this.slotHeld ? 'on' : 'off',
      reason: this.trippedBy,
      cursor: this.cursor,
      encoded: this.done.size,
      failures: this.failures,
      speed: this.speed(),
    };
  }

  /** `lo_init.mp4`: el init del primer trabajo (lo arranca en el segmento que pide la sala). */
  async initFile(signal?: AbortSignal): Promise<LiteFileResult> {
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    if (this.initPath && this.init) {
      this.touchActivity();
      return { kind: 'file', path: this.initPath, size: this.init.bytes.length };
    }
    this.request(this.cursor ?? this.options.source.requestedSegment());
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    await this.wait(this.initWaiters, this.limits.repositionWaitMs, signal);
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    if (this.initPath && this.init) {
      return { kind: 'file', path: this.initPath, size: this.init.bytes.length };
    }
    return { kind: this.closed || this.trippedBy ? 'missing' : 'not_yet' };
  }

  /** `lo_index<N>.m4s`: mueve el cursor ligero a N y espera lo que toque (ver arriba). */
  async segmentFile(segment: number, signal?: AbortSignal): Promise<LiteFileResult> {
    if (!Number.isInteger(segment) || segment < 0 || segment >= this.plan.segments.length) {
      return { kind: 'missing' };
    }
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    const queued = this.inAnyWindow(segment);
    this.request(segment);
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    const ready = this.ready(segment);
    if (ready) return ready;
    if (this.bad.has(segment)) return { kind: 'missing' };
    if ((this.misses.get(segment) ?? 0) >= this.limits.missesBeforeGone) return { kind: 'missing' };
    const encoding = this.job?.segment === segment;
    await this.waitFor(
      segment,
      encoding || queued ? this.limits.waitMs : this.limits.repositionWaitMs,
      signal,
    );
    if (this.closed || this.trippedBy) return { kind: 'missing' };
    const after = this.ready(segment);
    if (after) {
      this.misses.delete(segment);
      return after;
    }
    if (this.bad.has(segment)) return { kind: 'missing' };
    if (signal?.aborted) return { kind: 'not_yet' };
    const misses = (this.misses.get(segment) ?? 0) + 1;
    this.misses.set(segment, misses);
    return misses >= this.limits.missesBeforeGone ? { kind: 'missing' } : { kind: 'not_yet' };
  }

  /** Suelta la plaza, para el trabajo y se da de baja del productor (la carpeta la borra él). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.deps.clock.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.abortJob();
    this.releaseSlot();
    for (const off of this.unsubscribe) off();
    this.wakeAll();
  }

  // --- Cursor, plaza y pausa ---

  private ready(segment: number): LiteFileResult | null {
    const size = this.done.get(segment);
    if (size === undefined) return null;
    return { kind: 'file', path: this.liteFile(segment), size };
  }

  private liteFile(segment: number): string {
    return path.join(this.options.dir, `${LITE_PREFIX}${segmentFileName(segment)}`);
  }

  /** ¿Está `segment` en la cola que sale de `cursor`? (≤ `aheadSegments` y ≤ `aheadMaxS`). */
  private inWindow(segment: number, cursor: number): boolean {
    if (segment < cursor || segment - cursor > this.limits.aheadSegments) return false;
    if (segment === cursor) return true;
    const from = this.plan.segments[cursor];
    const to = this.plan.segments[segment];
    return !!from && !!to && to.startS - from.startS <= this.limits.aheadMaxS;
  }

  private touchActivity(): void {
    this.deps.clock.clearTimeout(this.idleTimer);
    this.idleTimer = this.deps.clock.setTimeout(() => this.onIdle(), this.limits.idleMs, {
      unref: true,
    });
  }

  /** Los cursores recientes (los caducados fuera), de menor a mayor. */
  private cursors(): number[] {
    const now = this.deps.clock.now();
    for (const [segment, at] of [...this.recent]) {
      if (now - at > this.recentMs) this.recent.delete(segment);
    }
    return [...this.recent.keys()].sort((a, b) => a - b);
  }

  /** ¿Está `segment` en la cola de alguno de los cursores recientes? */
  private inAnyWindow(segment: number): boolean {
    return this.cursors().some((cursor) => this.inWindow(segment, cursor));
  }

  /** ¿Sigue haciendo falta `segment`? (en alguna ventana, o alguien lo espera). */
  private wanted(segment: number): boolean {
    return !!this.waiters.get(segment)?.size || this.inAnyWindow(segment);
  }

  /** Una petición ligera en `segment`: actividad, plaza, cursor, fijado y cola. */
  private request(segment: number): void {
    if (this.closed || this.trippedBy) return;
    this.touchActivity();
    if (!this.slotHeld) {
      if (!this.deps.slot.acquire()) {
        this.trip('plaza', 'no queda plaza de recodificación');
        return;
      }
      this.slotHeld = true;
      this.deps.logger.info(
        { sessionId: this.options.sessionId, segment },
        'Ver juntos: calidad ligera en marcha',
      );
    }
    this.cursor = segment;
    this.recent.set(segment, this.deps.clock.now());
    const cursors = this.cursors();
    const low = cursors[0] ?? segment;
    const high = cursors[cursors.length - 1] ?? segment;
    this.options.source.pin(Math.max(0, low - 1), high + this.limits.aheadSegments);
    /* Solo si no le sirve a nadie: el trabajo de otro invitado (otra ventana) sigue. */
    if (this.job && !this.wanted(this.job.segment)) this.abortJob();
    this.trimOwn();
    this.pump();
  }

  /** Sin peticiones ligeras en `idleMs`: se suelta la plaza (la siguiente la vuelve a coger). */
  private onIdle(): void {
    this.idleTimer = null;
    if (this.closed || this.trippedBy) return;
    this.abortJob();
    this.releaseSlot();
    this.cursor = null;
    this.recent.clear();
    this.deps.logger.info(
      { sessionId: this.options.sessionId },
      'Ver juntos: calidad ligera en pausa (nadie la pide)',
    );
  }

  private releaseSlot(): void {
    if (this.slotHeld) {
      this.slotHeld = false;
      this.deps.slot.release();
    }
    this.options.source.unpin();
  }

  private trip(reason: LiteTripReason, detail: string): void {
    if (this.trippedBy || this.closed) return;
    this.trippedBy = reason;
    this.deps.logger.warn(
      { sessionId: this.options.sessionId, reason, detail },
      'Ver juntos: calidad ligera apagada para esta sesión',
    );
    this.deps.clock.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.abortJob();
    this.releaseSlot();
    this.wakeAll();
    try {
      this.deps.onTrip?.(reason);
    } catch {}
  }

  // --- Trabajos ---

  /**
   * Lanza el siguiente trabajo si no hay ninguno: de la unión de las ventanas de los cursores
   * recientes, lo que no está hecho ni tirado y cuya original ya está en disco; primero lo que
   * alguien espera, luego lo más bajo. Cada ventana va en orden: hasta que la original de un
   * segmento no esté, lo de detrás de él en esa ventana espera (`onSegmentReady`).
   */
  private pump(): void {
    if (this.closed || this.trippedBy || this.job || !this.slotHeld) return;
    const initPath = this.options.source.initFilePath();
    if (!initPath) return;
    const candidates = new Map<number, string>();
    for (const cursor of this.cursors()) {
      for (let segment = cursor; this.inWindow(segment, cursor); segment += 1) {
        if (segment >= this.plan.segments.length) break;
        if (this.done.has(segment) || this.bad.has(segment)) continue;
        const source = this.options.source.readySegment(segment);
        if (!source) break;
        candidates.set(segment, source);
      }
    }
    if (!candidates.size) return;
    const ordered = [...candidates.keys()].sort((a, b) => a - b);
    const segment = ordered.find((n) => !!this.waiters.get(n)?.size) ?? (ordered[0] as number);
    this.startJob(segment, initPath, candidates.get(segment) as string);
  }

  private startJob(segment: number, initPath: string, sourcePath: string): void {
    const job: Job = { segment, aborted: false, kill: () => undefined };
    this.job = job;
    this.jobs += 1;
    const number = this.jobs;
    void this.runJob(job, number, initPath, sourcePath)
      .catch((error: unknown) => {
        this.deps.logger.warn(
          { sessionId: this.options.sessionId, segment, err: error },
          'Ver juntos: trabajo ligero roto',
        );
        if (!job.aborted) this.fail(segment, 'error inesperado');
      })
      .finally(() => {
        if (this.job === job) this.job = null;
        this.pump();
      });
  }

  private abortJob(): void {
    const job = this.job;
    if (!job) return;
    job.aborted = true;
    job.kill();
    this.job = null;
  }

  private async runJob(
    job: Job,
    number: number,
    initPath: string,
    sourcePath: string,
  ): Promise<void> {
    const { segment } = job;
    const planned = this.plan.segments[segment];
    if (!planned) return;
    const started = this.deps.clock.now();
    let input: Buffer;
    try {
      input = Buffer.concat([await readFile(initPath), await readFile(sourcePath)]);
    } catch {
      /* El productor lo recortó entre medias: no es un fallo, se vuelve a mirar la cola. */
      return;
    }
    if (job.aborted || this.closed) return;
    let original: Fmp4FragmentInfo;
    try {
      original = splitFmp4(input).first;
    } catch {
      this.fail(segment, 'el segmento original no se puede leer');
      return;
    }
    const durationS = planned.endS - planned.startS;
    const result = await this.execute(
      job,
      input,
      Math.max(LITE_JOB_MIN_TIMEOUT_MS, durationS * 3 * 1000),
    );
    if (job.aborted || this.closed || this.trippedBy) return;
    if (result.missing) {
      this.trip('ffmpeg', 'no hay ffmpeg');
      return;
    }
    if (result.code !== 0 || !result.output) {
      this.fail(segment, result.detail ?? `ffmpeg salió con ${result.code}`);
      return;
    }
    let output: LiteOutput;
    try {
      output = splitFmp4(result.output);
    } catch {
      this.fail(segment, 'salida fMP4 rota');
      return;
    }
    const mismatch = this.checkTimes(output.first, original);
    if (mismatch) {
      this.fail(segment, mismatch);
      return;
    }
    if (!this.init) {
      const file = path.join(this.options.dir, LITE_INIT_FILE);
      await this.writeAtomic(file, output.init.bytes, number);
      if (job.aborted || this.closed || this.trippedBy) return;
      this.init = output.init;
      this.initPath = file;
      for (const wake of [...this.initWaiters]) wake();
    } else if (!sameLiteInit(this.init, output.init)) {
      this.trip('init', 'el init de un trabajo no casa con lo_init.mp4');
      return;
    }
    await this.writeAtomic(this.liteFile(segment), output.media, number);
    if (job.aborted || this.closed || this.trippedBy) {
      await unlink(this.liteFile(segment)).catch(() => undefined);
      return;
    }
    this.done.set(segment, output.media.length);
    this.failures = 0;
    this.reportBytes();
    this.wake(segment);
    this.speeds.push({ mediaS: durationS, wallMs: this.deps.clock.now() - started });
    while (this.speeds.length > this.limits.speedWindow) this.speeds.shift();
    const speed = this.speed();
    if (speed !== null && this.speeds.length >= this.limits.speedWindow) {
      if (speed < this.limits.minSpeed) {
        this.trip('lento', `${speed.toFixed(2)}× el tiempo real`);
      }
    }
    this.deps.logger.debug(
      { sessionId: this.options.sessionId, segment, bytes: output.media.length, speed },
      'Ver juntos: segmento ligero listo',
    );
  }

  /** ¿Empieza el ligero donde el original? Devuelve el motivo si no (null si casa). */
  private checkTimes(lite: Fmp4FragmentInfo, original: Fmp4FragmentInfo): string | null {
    if (lite.firstIsSync === false) return 'el ligero no empieza por un fotograma clave';
    const start = original.startS;
    if (start === null || lite.startS === null || lite.decodeS === null) {
      return 'sin tiempos de vídeo';
    }
    if (Math.abs(lite.startS - start) > LITE_FRAME_TOLERANCE_S) {
      return `empieza en ${lite.startS.toFixed(3)} y el original en ${start.toFixed(3)}`;
    }
    if (Math.abs(lite.decodeS - start) > LITE_FRAME_TOLERANCE_S) {
      return `tfdt en ${lite.decodeS.toFixed(3)} y el original en ${start.toFixed(3)}`;
    }
    return null;
  }

  /** Un trabajo fallido o inválido: el segmento queda sin ligero (404) y cuenta para el fusible. */
  private fail(segment: number, detail: string): void {
    if (this.closed || this.trippedBy) return;
    this.failures += 1;
    this.bad.add(segment);
    this.deps.logger.warn(
      { sessionId: this.options.sessionId, segment, detail, failures: this.failures },
      'Ver juntos: segmento ligero fallido',
    );
    this.wake(segment);
    if (this.failures >= this.limits.maxFailures) {
      this.trip('fallos', `${this.failures} trabajos seguidos fallidos`);
    }
  }

  private speed(): number | null {
    let mediaS = 0;
    let wallMs = 0;
    for (const sample of this.speeds) {
      mediaS += sample.mediaS;
      wallMs += sample.wallMs;
    }
    if (!this.speeds.length) return null;
    return wallMs > 0 ? (mediaS * 1000) / wallMs : Number.POSITIVE_INFINITY;
  }

  /** Lanza ffmpeg, le da la entrada y recoge la salida entera (un segmento ligero: unos MB). */
  private execute(job: Job, input: Buffer, timeoutMs: number): Promise<JobRun> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: TimerHandle | null = null;
      const settle = (run: JobRun): void => {
        if (settled) return;
        settled = true;
        this.deps.clock.clearTimeout(timer);
        resolve(run);
      };
      let child: LiteProcess;
      try {
        child = this.deps.launcher.spawn(buildVodLiteArgs({ sessionId: this.options.sessionId }));
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        settle({ code: null, output: null, missing: code === 'ENOENT', detail: 'no se lanzó' });
        return;
      }
      const log = new RingLog(16 * 1024);
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      let timedOut = false;
      let exit: number | null | undefined;
      let outputClosed = false;
      const finish = (): void => {
        if (exit === undefined || !outputClosed) return;
        const tail = (): string => {
          const text = log.tail(300);
          return this.deps.redact ? this.deps.redact(text) : text;
        };
        if (overflow || timedOut) {
          settle({
            code: exit,
            output: null,
            missing: false,
            detail: overflow ? 'salida demasiado grande' : 'tarda demasiado',
          });
          return;
        }
        settle({
          code: exit,
          output: exit === 0 ? Buffer.concat(chunks, size) : null,
          missing: false,
          detail: exit === 0 ? null : `ffmpeg salió con ${exit}: ${tail()}`,
        });
      };
      const stop = (): void => {
        child.kill();
        child.stdout.destroy();
      };
      job.kill = stop;
      child.onError((error) => {
        settle({
          code: null,
          output: null,
          missing: error.code === 'ENOENT',
          detail: 'no se pudo lanzar ffmpeg',
        });
      });
      child.onStderr((chunk) => log.push(chunk));
      child.onExit((code) => {
        exit = code;
        finish();
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (overflow) return;
        size += chunk.length;
        if (size > LITE_OUTPUT_MAX_BYTES) {
          overflow = true;
          stop();
          return;
        }
        chunks.push(chunk);
      });
      child.stdout.once('close', () => {
        outputClosed = true;
        finish();
      });
      child.stdout.on('error', () => undefined);
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
      timer = this.deps.clock.setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
    });
  }

  // --- Disco ---

  private async writeAtomic(file: string, bytes: Buffer, number: number): Promise<void> {
    const part = `${file}.${number}.part`;
    await writeFile(part, bytes);
    await rename(part, file);
  }

  /**
   * Lo ligero lejos de los cursores recientes (la ventana de 120 s del productor: por detrás del
   * más bajo y por delante del más alto).
   */
  private trimOwn(): void {
    const cursors = this.cursors();
    const low = cursors[0];
    const high = cursors[cursors.length - 1];
    if (low === undefined || high === undefined) return;
    const lowAt = this.plan.segments[low];
    const highAt = this.plan.segments[high];
    if (!lowAt || !highAt) return;
    for (const segment of [...this.done.keys()]) {
      const planned = this.plan.segments[segment];
      if (!planned) continue;
      const behind = planned.endS < lowAt.startS - this.limits.keepBehindS;
      const ahead = planned.startS > highAt.startS + this.limits.keepBehindS;
      if (!behind && !ahead) continue;
      this.done.delete(segment);
      void unlink(this.liteFile(segment)).catch(() => undefined);
    }
    const far = this.limits.aheadSegments * 4;
    for (const segment of [...this.bad]) {
      if (cursors.every((cursor) => Math.abs(segment - cursor) > far)) this.bad.delete(segment);
    }
    for (const segment of [...this.misses.keys()]) {
      if (segment < low) this.misses.delete(segment);
    }
    this.reportBytes();
  }

  private reportBytes(): void {
    let bytes = this.init?.bytes.length ?? 0;
    for (const size of this.done.values()) bytes += size;
    this.options.source.setExtraBytes(bytes);
  }

  // --- Esperas ---

  private wait(group: Set<() => void>, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        this.deps.clock.clearTimeout(timer);
        signal?.removeEventListener('abort', wake);
        group.delete(wake);
        resolve();
      };
      const timer = this.deps.clock.setTimeout(wake, ms);
      if (signal?.aborted) {
        wake();
        return;
      }
      signal?.addEventListener('abort', wake, { once: true });
      group.add(wake);
    });
  }

  private waitFor(segment: number, ms: number, signal?: AbortSignal): Promise<void> {
    let set = this.waiters.get(segment);
    if (!set) {
      set = new Set();
      this.waiters.set(segment, set);
    }
    const owner = set;
    return this.wait(owner, ms, signal).then(() => {
      if (!owner.size && this.waiters.get(segment) === owner) this.waiters.delete(segment);
    });
  }

  private wake(segment: number): void {
    for (const wake of [...(this.waiters.get(segment) ?? [])]) wake();
  }

  private wakeAll(): void {
    for (const set of [...this.waiters.values()]) for (const wake of [...set]) wake();
    for (const wake of [...this.initWaiters]) wake();
  }
}
