/* El productor de una sesión VOD (docs/vod.md §9.7): de lo que saca ffmpeg
   a `index<N>.m4s` en disco, con la lista VOD completa desde el índice.

   - Init: se guarda el de la PRIMERA ejecución y se sirve siempre ese. En
     cada reinicio se comparan los `stsd`: si cambian, la sesión se cierra
     con `vod_dropped` (la web reabre en la posición) en vez de mezclar inits.
   - De fragmento a segmento (P4): cada fragmento va por su tiempo de
     presentación al fotograma clave más cercano del índice (`placeFragment`).
     Uno que abre segmento cierra el anterior (`.part` → `.m4s`, y despierta
     a quien lo esperaba) y abre el suyo; lo que llega antes del primer
     fotograma clave que abre segmento se tira.
   - Caída tardía: si la ejecución pedida para el segmento N empieza DESPUÉS
     de N, se reinicia en el anterior (2 veces como mucho; si ni así, se
     acepta lo que haya y, si sigue sin caer, `vod_dropped` antes que dar
     vueltas).
   - Regla de reinicio: un segmento en disco se sirve; si está por delante de
     lo producido en 30 s de vídeo o menos, se espera; si no (lejos por
     delante, o por detrás y ya borrado), se mata la ejecución, se espera a
     que salga y se arranca otra en ese segmento. Reinicios agrupados: entre
     dos pasan al menos 1,5 s y solo cuenta la última petición.
   - Contrapresión: se deja de leer `pipe:1` cuando lo producido va más de
     120 s por delante del FINAL del último segmento pedido, y se sigue por
     debajo de 60 s (auditoría 0.9.0; antes 60/30); nunca mientras ese
     segmento no esté hecho (se quedaría a medias: solo se cierra con el
     fotograma clave del siguiente). También se para mientras el disco no da
     abasto. `stats().aheadS` lo dice (el relé lo usa de suelo de su ritmo).
   - Espera de un segmento: 15 s como mucho; después, `not_yet` (503 con
     `Retry-After: 1`, hls.js reintenta).
   - Arranque y tras un salto (auditoría 0.9.0, el criterio de Isma: que
     tarde lo que tenga que tardar al empezar, pero que no se pare mientras
     ve): el segmento pedido no sale hasta que la ejecución lleva `warmupS`
     (25 s) producidos desde él, o el final, dentro del mismo plazo de 15 s.
   - Primer fragmento (auditoría 0.9.0): una ejecución que empieza a mitad y
     no saca ni un fragmento en 8 s (ffmpeg esperando una petición al relé
     colgada, la de los Cues sobre todo, hasta los 55 s de `-rw_timeout`) se
     mata y se relanza en el mismo sitio, 2 veces como mucho.
   - Ventana en disco: desde el último pedido − 120 s y como mucho 256 MiB
     por detrás; tope duro de 1,5 GiB por sesión, borrando primero lo más
     lejano. Al cerrar, la carpeta entera fuera.
   - Pausa larga: sin peticiones de segmentos en 5 min se mata ffmpeg y se
     avisa (`onIdle`) para soltar el proveedor; la siguiente petición
     reinicia donde haga falta.
   - Fin: código 0 con el último segmento del plan abierto es «completo»
     (nunca una muerte). Código 0 ANTES de llegar ahí es un fallo: ffmpeg toma
     un error de lectura de la entrada por el final del fichero (el relé cortó
     o no pudo reabrir), así que el segmento a medias se tira en vez de
     publicarlo cortado. Una ejecución que falla se reintenta UNA vez desde el
     primer segmento que falte; la segunda, `vod_dropped`.

   Lo que NO hace (VOD-5): servir los ficheros con Range (lo hace
   `files.ts` con la ruta que da `file()`), el registro de sesiones del
   remux, las plazas y el barrido al arrancar (`sweepVodDirs` está aquí para
   que lo llame). */

import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VOD_PLAY } from '@ace/shared';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import { AppError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { buildVodArgs } from './args.js';
import { sameCodecs, type Fmp4FragmentInfo, type Fmp4Init } from './fmp4.js';
import { placeFragment, planSegments, segmentAt, type VodPlan } from './plan.js';
import { VOD_INIT_FILE, buildVodPlaylist, segmentFileName, segmentIndexOf } from './playlist.js';
import { VodRun, type VodRunEnd } from './run.js';
import type { VodIndex, VodProcessLauncher, VodTrack } from './types.js';

/** Prefijo de las carpetas de las sesiones VOD dentro de `remuxDir`. */
export const VOD_DIR_PREFIX = 'vod-';

export interface VodProducerLimits {
  readonly restartAheadS: number;
  readonly restartMinGapMs: number;
  readonly aheadMaxS: number;
  readonly aheadResumeS: number;
  readonly keepBehindS: number;
  readonly keepBehindMaxBytes: number;
  readonly sessionDiskMaxBytes: number;
  readonly diskFreeMinBytes: number;
  readonly segmentWaitMs: number;
  readonly idleReleaseMs: number;
  /** Reinicios por caída tardía para un mismo segmento antes de aceptar lo que haya. */
  readonly lateRetries: number;
  /** Ejecuciones fallidas seguidas que se reintentan. */
  readonly failureRetries: number;
  /** Una ejecución a mitad sin ningún fragmento en este rato se relanza… */
  readonly firstFragmentMs: number;
  /** …estas veces como mucho por segmento querido. */
  readonly firstFragmentRetries: number;
  /** Arranque y tras un salto: el segmento pedido sale con al menos esto producido desde él (0 = sin espera). */
  readonly warmupS: number;
}

export const DEFAULT_VOD_LIMITS: VodProducerLimits = {
  restartAheadS: VOD_PLAY.restartAheadS,
  restartMinGapMs: VOD_PLAY.restartMinGapMs,
  aheadMaxS: VOD_PLAY.aheadMaxS,
  aheadResumeS: VOD_PLAY.aheadResumeS,
  keepBehindS: VOD_PLAY.keepBehindS,
  keepBehindMaxBytes: VOD_PLAY.keepBehindMaxBytes,
  sessionDiskMaxBytes: VOD_PLAY.sessionDiskMaxBytes,
  diskFreeMinBytes: VOD_PLAY.diskFreeMinBytes,
  segmentWaitMs: VOD_PLAY.segmentWaitMs,
  idleReleaseMs: VOD_PLAY.idleReleaseMs,
  lateRetries: 2,
  failureRetries: 1,
  firstFragmentMs: VOD_PLAY.firstFragmentMs,
  firstFragmentRetries: VOD_PLAY.firstFragmentRetries,
  warmupS: VOD_PLAY.warmupS,
};

/** Caídas tardías de más (tras aceptar) que se aguantan antes de cerrar la sesión. */
const LATE_GIVE_UP_EXTRA = 3;

export interface VodProducerDeps {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly launcher: VodProcessLauncher;
  /** Limpia la cola de stderr de ffmpeg antes de escribirla en el registro. */
  readonly redact?: (text: string) => string;
  /** Bytes libres en el disco de `dir` (por defecto, `fs.statfs`). */
  readonly freeBytes?: (dir: string) => Promise<number>;
  /** La pausa larga ha matado ffmpeg: ya se puede soltar el proveedor. */
  readonly onIdle?: () => void;
  /** La sesión no puede seguir (`vod_dropped`, `vod_disk_full`…): quien la abrió la cierra. */
  readonly onDropped?: (error: AppError) => void;
}

export interface VodProducerOptions {
  readonly sessionId: string;
  /** `remuxDir/vod-<sid>` (se crea y se borra entera al cerrar). */
  readonly dir: string;
  /** La URL del relé (`http://127.0.0.1:<p>/r/<ticket>/vod.<ext>`). */
  readonly inputUrl: string;
  readonly index: VodIndex;
  readonly audio: VodTrack | null;
  readonly hevc: boolean;
  /** Dónde se empieza (reanudar); la primera ejecución arranca en su segmento. */
  readonly startS?: number;
  readonly limits?: Partial<VodProducerLimits>;
}

export type VodFileResult =
  | { readonly kind: 'file'; readonly path: string; readonly size: number }
  /** Aún no está: 503 con `Retry-After: 1`. */
  | { readonly kind: 'not_yet' }
  /** No existe (o la sesión está cerrada): 404. */
  | { readonly kind: 'missing' };

export interface VodProducerStats {
  readonly running: boolean;
  readonly paused: boolean;
  /** Por qué está parada la lectura de ffmpeg: `adelanto` (va por delante) o `disco`. */
  readonly pausedBy: readonly string[];
  readonly runs: number;
  readonly restarts: number;
  readonly segmentsOnDisk: number;
  readonly bytesOnDisk: number;
  readonly lastRequested: number;
  /** Dónde empieza el último segmento pedido (s). */
  readonly requestedS: number;
  /**
   * Segundos producidos por delante del final del último segmento pedido (lo que mira la
   * contrapresión), o null si no hay ejecución que lo esté produciendo.
   */
  readonly aheadS: number | null;
}

interface Writer {
  readonly segment: number;
  readonly part: string;
  /** null: el segmento ya estaba en disco y sus bytes se tiran. */
  readonly stream: WriteStream | null;
  bytes: number;
  /** Se está tirando: sus errores (escrituras pendientes al destruirlo) no cuentan. */
  aborted: boolean;
}

/** Un reinicio: dónde arranca ffmpeg y qué segmento quiere de verdad el reproductor. */
interface RestartTarget {
  readonly segment: number;
  readonly wanted: number;
}

/** Lo de una ejecución: sus avisos llegan aquí y nunca tocan la siguiente. */
interface RunContext {
  readonly run: VodRun;
  /** Número de ejecución (va en el nombre de sus `.part`: dos ejecuciones nunca comparten uno). */
  readonly number: number;
  readonly startSegment: number;
  /** El segmento que motivó esta ejecución (una caída tardía reinicia antes, pero lo quiere a él). */
  readonly wanted: number;
  /** Ya llegó el primer fragmento que abre un segmento. */
  opened: boolean;
  writer: Writer | null;
  /** Hasta dónde llega lo producido por esta ejecución (fin del último fragmento), en s. */
  producedS: number;
  /** Segmentos que ha cerrado. */
  finished: number;
  /** Se va a tirar (caída tardía, init incompatible o fallo de disco). */
  abandoned: boolean;
  /** Vigilante del primer fragmento (solo las ejecuciones a mitad), o null. */
  firstTimer: TimerHandle | null;
  /** Ya lleva `warmupS` producidos desde lo que se pidió al lanzarla (o llegó al final). */
  warmed: boolean;
  /** Se cumple cuando la ejecución ha acabado y su final está atendido. */
  settled: Promise<void>;
}

/** Disco libre por `statfs` (bloques disponibles para quien no es root). */
async function statfsFree(dir: string): Promise<number> {
  const info = await statfs(dir);
  return Number(info.bavail) * Number(info.bsize);
}

/**
 * Borra las carpetas `vod-*` de `remuxDir` que no son de ninguna sesión viva
 * (las de un proceso anterior que murió sin limpiar). Para el arranque.
 */
export async function sweepVodDirs(
  remuxDir: string,
  alive: ReadonlySet<string>,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(remuxDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(VOD_DIR_PREFIX)) continue;
    if (alive.has(entry.slice(VOD_DIR_PREFIX.length))) continue;
    await rm(path.join(remuxDir, entry), { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry);
  }
  return removed;
}

export class VodProducer {
  readonly plan: VodPlan;
  private readonly limits: VodProducerLimits;
  private readonly keyframes: Float64Array;
  private readonly onDisk = new Map<number, number>();
  private readonly waiters = new Map<number, Set<() => void>>();
  private readonly initWaiters = new Set<() => void>();
  /** Quien espera a que la ejecución de ahora esté caliente (`warmupS`). */
  private readonly warmWaiters = new Set<() => void>();
  /** Caídas tardías por segmento querido. */
  private readonly lateAttempts = new Map<number, number>();
  /** Relanzamientos por no sacar ningún fragmento a tiempo, por segmento querido. */
  private readonly slowStarts = new Map<number, number>();
  private init: Fmp4Init | null = null;
  private initPath: string | null = null;
  private current: RunContext | null = null;
  private lastRequested: number;
  private restartTimer: TimerHandle | null = null;
  private idleTimer: TimerHandle | null = null;
  /** El reinicio que toca (solo cuenta la última petición). */
  private pending: RestartTarget | null = null;
  /** El reinicio en curso (matando la ejecución vieja). */
  private restarting: RestartTarget | null = null;
  private lastRestartAt = -Infinity;
  private failures = 0;
  private runs = 0;
  private restarts = 0;
  private closed = false;
  /** La sesión no puede seguir: ya se avisó (una sola vez) y no se produce más. */
  private failure: AppError | null = null;
  /** Segmentos cerrados cuyo `.part` aún se está renombrando: cuentan como hechos. */
  private readonly finalizing = new Set<number>();
  private fsChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly deps: VodProducerDeps,
    private readonly options: VodProducerOptions,
  ) {
    this.limits = { ...DEFAULT_VOD_LIMITS, ...options.limits };
    this.keyframes = options.index.keyframes;
    this.plan = planSegments(options.index.keyframes, options.index.durationS);
    this.lastRequested = segmentAt(this.plan, options.startS ?? 0);
  }

  /**
   * Comprueba el disco (`vod_disk_full` con menos de 2 GiB libres), crea la
   * carpeta y arranca la primera ejecución en el segmento de `startS`.
   */
  static async open(deps: VodProducerDeps, options: VodProducerOptions): Promise<VodProducer> {
    const producer = new VodProducer(deps, options);
    const parent = path.dirname(options.dir);
    await mkdir(parent, { recursive: true });
    const free = await (deps.freeBytes ?? statfsFree)(parent).catch(() => Infinity);
    if (free < producer.limits.diskFreeMinBytes) {
      throw new AppError('vod_disk_full', { detail: `quedan ${Math.round(free / 2 ** 20)} MiB` });
    }
    await rm(options.dir, { recursive: true, force: true });
    await mkdir(options.dir, { recursive: true });
    producer.armIdle();
    producer.startRun({ segment: producer.lastRequested, wanted: producer.lastRequested });
    return producer;
  }

  /** La `index.m3u8` (con `EXT-X-START` si se reanuda). */
  playlist(startS?: number): string {
    return buildVodPlaylist(this.plan, startS === undefined ? {} : { startS });
  }

  stats(): VodProducerStats {
    let bytes = 0;
    for (const size of this.onDisk.values()) bytes += size;
    const ctx = this.current;
    const requested = this.plan.segments[this.lastRequested];
    return {
      running: ctx !== null && !ctx.run.finished,
      paused: ctx?.run.isPaused() ?? false,
      pausedBy: ctx?.run.pauseReasons() ?? [],
      runs: this.runs,
      restarts: this.restarts,
      segmentsOnDisk: this.onDisk.size,
      bytesOnDisk: bytes,
      lastRequested: this.lastRequested,
      requestedS: requested?.startS ?? 0,
      aheadS:
        ctx && !ctx.run.finished && !ctx.abandoned && requested
          ? Math.max(0, ctx.producedS - requested.endS)
          : null,
    };
  }

  /** Segmentos en disco, en orden (para las pruebas y el diagnóstico). */
  segmentsOnDisk(): number[] {
    return [...this.onDisk.keys()].sort((a, b) => a - b);
  }

  /**
   * Un fichero de la sesión: `init.mp4` o `index<N>.m4s` (la lista la da
   * `playlist()`). Espera como mucho `segmentWaitMs`; si no está, `not_yet`.
   * Pedir un segmento cuenta como actividad del reproductor.
   */
  async file(name: string, signal?: AbortSignal): Promise<VodFileResult> {
    if (this.closed || this.failure) return { kind: 'missing' };
    if (name === VOD_INIT_FILE) return this.initFile(signal);
    const segment = segmentIndexOf(name);
    if (segment === null || segment >= this.plan.segments.length) return { kind: 'missing' };
    this.lastRequested = segment;
    this.armIdle();
    this.applyBackpressure();
    this.trimDisk();
    const deadline = this.deps.clock.now() + this.limits.segmentWaitMs;
    const ready = this.segmentFile(segment);
    if (ready) {
      this.cancelRestart();
      if (!this.warming(segment)) return ready;
      await this.waitWarm(segment, deadline, signal);
      return (
        this.segmentFile(segment) ?? { kind: this.closed || this.failure ? 'missing' : 'not_yet' }
      );
    }
    /* Solo cuenta la última petición: si esta la cubre lo que ya hay (o se está
       terminando de escribir), el reinicio pendiente sobra. */
    if (this.finalizing.has(segment) || this.willProduce(segment)) this.cancelRestart();
    else this.requestRestart({ segment, wanted: segment });
    await this.waitFor(segment, signal);
    if (this.segmentFile(segment) && this.warming(segment)) {
      await this.waitWarm(segment, deadline, signal);
    }
    return (
      this.segmentFile(segment) ?? { kind: this.closed || this.failure ? 'missing' : 'not_yet' }
    );
  }

  /*
   * Arranque y tras un salto (auditoría 0.9.0): la ejecución de ahora aún no lleva `warmupS`
   * producidos desde lo que se le pidió, y este segmento es de los suyos. Isma prefiere esperar
   * unos segundos más al empezar que ver el vídeo pararse a los pocos segundos.
   */
  private warming(segment: number): boolean {
    const ctx = this.current;
    if (!ctx || ctx.warmed || ctx.abandoned || ctx.run.finished) return false;
    if (this.closed || this.failure) return false;
    return segment >= ctx.startSegment;
  }

  /** Espera a que la ejecución de ahora esté caliente (o acabe), hasta `deadline`. */
  private async waitWarm(segment: number, deadline: number, signal?: AbortSignal): Promise<void> {
    while (this.warming(segment) && !signal?.aborted) {
      const left = deadline - this.deps.clock.now();
      if (left <= 0) return;
      await this.wait(this.warmWaiters, signal, left);
    }
  }

  /** ¿La ejecución ya lleva `warmupS` producidos desde lo que se pidió (o el final del título)? */
  private checkWarm(ctx: RunContext): void {
    if (ctx.warmed || !ctx.opened) return;
    const wanted = this.plan.segments[ctx.wanted];
    const last = this.plan.segments[this.plan.segments.length - 1];
    if (!wanted || !last) return;
    /* Nunca más de lo que deja la contrapresión (si no, la espera se comería su plazo entero). */
    const warmupS = Math.min(this.limits.warmupS, this.limits.aheadMaxS);
    const want = Math.min(wanted.startS + warmupS, last.endS - 0.5);
    if (ctx.producedS < want) return;
    ctx.warmed = true;
    for (const wake of [...this.warmWaiters]) wake();
  }

  /** ¿Está hecho (en disco o terminando de escribirse)? */
  private produced(segment: number): boolean {
    return this.onDisk.has(segment) || this.finalizing.has(segment);
  }

  /** Para ffmpeg, espera a que salga y borra la carpeta. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.deps.clock.clearTimeout(this.restartTimer);
    this.deps.clock.clearTimeout(this.idleTimer);
    this.restartTimer = null;
    this.idleTimer = null;
    await this.stopRun();
    for (const set of [...this.waiters.values()]) for (const wake of [...set]) wake();
    this.waiters.clear();
    for (const wake of [...this.initWaiters]) wake();
    this.initWaiters.clear();
    for (const wake of [...this.warmWaiters]) wake();
    await this.fsChain.catch(() => undefined);
    await rm(this.options.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  // --- Servir ---

  private segmentFile(segment: number): VodFileResult | null {
    const size = this.onDisk.get(segment);
    if (size === undefined) return null;
    return { kind: 'file', path: path.join(this.options.dir, segmentFileName(segment)), size };
  }

  private async initFile(signal?: AbortSignal): Promise<VodFileResult> {
    if (!this.initPath) await this.wait(this.initWaiters, signal);
    if (this.closed) return { kind: 'missing' };
    if (!this.initPath || !this.init) return { kind: 'not_yet' };
    return { kind: 'file', path: this.initPath, size: this.init.bytes.length };
  }

  private waitFor(segment: number, signal?: AbortSignal): Promise<void> {
    let set = this.waiters.get(segment);
    if (!set) {
      set = new Set();
      this.waiters.set(segment, set);
    }
    const owner = set;
    return this.wait(owner, signal).then(() => {
      if (!owner.size && this.waiters.get(segment) === owner) this.waiters.delete(segment);
    });
  }

  /** Espera a que alguien despierte el grupo, o al plazo (`segmentWaitMs` o `ms`), o a la señal. */
  private wait(group: Set<() => void>, signal?: AbortSignal, ms?: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        this.deps.clock.clearTimeout(timer);
        signal?.removeEventListener('abort', wake);
        group.delete(wake);
        resolve();
      };
      const timer = this.deps.clock.setTimeout(wake, ms ?? this.limits.segmentWaitMs);
      if (signal?.aborted) {
        wake();
        return;
      }
      signal?.addEventListener('abort', wake, { once: true });
      group.add(wake);
    });
  }

  private wake(segment: number): void {
    for (const wake of [...(this.waiters.get(segment) ?? [])]) wake();
  }

  // --- Regla de reinicio ---

  /** ¿La ejecución en marcha (o la que está arrancando) llegará a este segmento? (≤ 30 s por delante). */
  private willProduce(segment: number): boolean {
    const target = this.plan.segments[segment];
    if (!target) return false;
    let position: number;
    let producedS: number;
    const ctx = this.current;
    if (this.restarting) {
      position = this.restarting.segment;
      producedS = this.plan.segments[position]?.startS ?? 0;
    } else if (ctx && !ctx.run.finished && !ctx.abandoned) {
      position = ctx.writer?.segment ?? ctx.startSegment;
      producedS = ctx.opened ? ctx.producedS : (this.plan.segments[position]?.startS ?? 0);
    } else {
      return false;
    }
    if (segment < position) return false;
    return target.startS - producedS <= this.limits.restartAheadS;
  }

  /** Pide un reinicio; con otro en marcha o reciente, se agrupa y gana la última petición. */
  private requestRestart(target: RestartTarget, immediate = false): void {
    this.pending = target;
    if (immediate) this.lastRestartAt = -Infinity;
    if (this.restartTimer || this.restarting) return;
    const wait = this.lastRestartAt + this.limits.restartMinGapMs - this.deps.clock.now();
    if (wait <= 0) {
      void this.restartNow();
      return;
    }
    this.restartTimer = this.deps.clock.setTimeout(() => {
      this.restartTimer = null;
      void this.restartNow();
    }, wait);
  }

  /** Olvida el reinicio pendiente (el que está en marcha, si lo hay, sigue). */
  private cancelRestart(): void {
    this.pending = null;
    this.deps.clock.clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  /** Mata la ejecución, espera a que salga y arranca otra donde toca. */
  private async restartNow(): Promise<void> {
    const target = this.pending;
    this.pending = null;
    if (this.closed || this.failure || !target || this.restarting) return;
    this.lastRestartAt = this.deps.clock.now();
    this.restarts += 1;
    this.restarting = target;
    try {
      await this.stopRun();
      if (!this.closed) this.startRun(target);
    } finally {
      this.restarting = null;
    }
    /* Mientras se reiniciaba pudo llegar otra petición que esta ejecución no cubre. */
    const next = this.pending as RestartTarget | null;
    if (this.closed || !next) return;
    this.pending = null;
    if (!this.produced(next.wanted) && !this.willProduce(next.wanted)) this.requestRestart(next);
  }

  private async stopRun(): Promise<void> {
    const ctx = this.current;
    if (!ctx) return;
    await ctx.run.kill();
    await ctx.settled;
  }

  // --- Ejecuciones ---

  private startRun(target: RestartTarget): void {
    const segment = this.plan.segments[target.segment];
    if (!segment || this.closed || this.failure) return;
    this.runs += 1;
    const args = buildVodArgs({
      inputUrl: this.options.inputUrl,
      sessionId: this.options.sessionId,
      segment: target.segment,
      keyframeS: segment.keyframeS,
      audio: this.options.audio,
      hevc: this.options.hevc,
    });
    const holder: { ctx: RunContext | null } = { ctx: null };
    const run = new VodRun({
      launcher: this.deps.launcher,
      args,
      ...(this.deps.redact ? { redact: this.deps.redact } : {}),
      handlers: {
        onInit: (init) => holder.ctx && this.onInit(holder.ctx, init),
        onFragment: (info) => holder.ctx && this.onFragment(holder.ctx, info),
        onData: (chunk) => holder.ctx && this.onData(holder.ctx, chunk),
        onFragmentEnd: () => undefined,
      },
    });
    const ctx: RunContext = {
      run,
      number: this.runs,
      startSegment: target.segment,
      wanted: target.wanted,
      opened: false,
      writer: null,
      producedS: segment.startS,
      finished: 0,
      abandoned: false,
      firstTimer: null,
      warmed: this.limits.warmupS <= 0,
      settled: Promise.resolve(),
    };
    ctx.settled = run.ended.then((end) => this.onRunEnd(ctx, end));
    holder.ctx = ctx;
    this.current = ctx;
    if (target.segment > 0) {
      ctx.firstTimer = this.deps.clock.setTimeout(
        () => this.onSlowStart(ctx),
        this.limits.firstFragmentMs,
      );
    }
    this.deps.logger.debug(
      { sessionId: this.options.sessionId, segment: target.segment, keyframeS: segment.keyframeS },
      'VOD: arranca ffmpeg',
    );
  }

  private onInit(ctx: RunContext, init: Fmp4Init): void {
    if (ctx.abandoned || this.closed) return;
    if (!this.init) {
      this.init = init;
      const file = path.join(this.options.dir, VOD_INIT_FILE);
      this.queueFs(async () => {
        await writeFile(file, init.bytes);
        this.initPath = file;
        for (const wake of [...this.initWaiters]) wake();
      });
      return;
    }
    if (!sameCodecs(this.init, init)) {
      this.abandon(ctx);
      this.drop(
        new AppError('vod_dropped', { detail: 'el init del reinicio no casa con el primero' }),
      );
    }
  }

  /*
   * Una ejecución a mitad que no ha sacado ni un fragmento en `firstFragmentMs` (auditoría 0.9.0):
   * ffmpeg está esperando una petición al relé que no contesta (la de los Cues, sobre todo) y la
   * esperaría los 55 s de `-rw_timeout`. Se mata y se relanza en el mismo sitio (unas pocas veces;
   * después se le deja seguir).
   */
  private onSlowStart(ctx: RunContext): void {
    ctx.firstTimer = null;
    if (this.current !== ctx || ctx.abandoned || ctx.run.finished || this.closed || this.failure) {
      return;
    }
    const attempts = (this.slowStarts.get(ctx.wanted) ?? 0) + 1;
    this.slowStarts.set(ctx.wanted, attempts);
    if (attempts > this.limits.firstFragmentRetries) {
      this.deps.logger.warn(
        { sessionId: this.options.sessionId, wanted: ctx.wanted, attempts },
        'VOD: ffmpeg sigue sin sacar nada; se le deja seguir',
      );
      return;
    }
    this.deps.logger.warn(
      { sessionId: this.options.sessionId, wanted: ctx.wanted, attempts },
      'VOD: ffmpeg no saca nada a tiempo; se relanza en el mismo sitio',
    );
    this.abandon(ctx);
    this.requestRestart({ segment: ctx.startSegment, wanted: ctx.wanted }, true);
  }

  private onFragment(ctx: RunContext, info: Fmp4FragmentInfo): void {
    if (ctx.firstTimer) {
      this.deps.clock.clearTimeout(ctx.firstTimer);
      ctx.firstTimer = null;
      this.slowStarts.delete(ctx.wanted);
    }
    if (ctx.abandoned || this.closed) return;
    const place =
      info.startS === null ? null : placeFragment(this.plan, this.keyframes, info.startS);
    if (!ctx.opened) {
      this.deps.logger.debug(
        { sessionId: this.options.sessionId, startS: info.startS, place },
        'VOD: fragmento antes de abrir segmento',
      );
    }
    if (place?.kind === 'opens' && place.segment !== ctx.writer?.segment) {
      if (!ctx.opened && place.segment > ctx.wanted && this.lateLanding(ctx, place.segment)) return;
      if (ctx.writer && place.segment < ctx.writer.segment) {
        /* El tiempo ha ido hacia atrás: no se rompe lo que hay, se sigue en el mismo. */
        this.deps.logger.warn({ sessionId: this.options.sessionId }, 'VOD: fragmento hacia atrás');
      } else {
        ctx.opened = true;
        this.closeWriter(ctx);
        this.openWriter(ctx, place.segment);
      }
    } else if (ctx.opened && place && ctx.writer && place.segment > ctx.writer.segment) {
      /* El fotograma clave que abría este segmento no llegó a abrir fragmento: se empieza aquí. */
      this.deps.logger.warn(
        { sessionId: this.options.sessionId, segment: place.segment },
        'VOD: segmento sin su fotograma clave de inicio',
      );
      this.closeWriter(ctx);
      this.openWriter(ctx, place.segment);
    }
    if (ctx.opened && info.startS !== null) {
      ctx.producedS = Math.max(ctx.producedS, info.startS + info.durationS);
    }
    this.checkWarm(ctx);
    this.applyBackpressure();
  }

  /**
   * La ejecución cayó después del segmento querido. Se reinicia un segmento
   * antes (2 veces); después se acepta lo que haya; y si ni así cae, la
   * sesión se cierra antes que dar vueltas. true = esta ejecución se tira.
   */
  private lateLanding(ctx: RunContext, landed: number): boolean {
    const attempts = (this.lateAttempts.get(ctx.wanted) ?? 0) + 1;
    this.lateAttempts.set(ctx.wanted, attempts);
    this.deps.logger.warn(
      { sessionId: this.options.sessionId, wanted: ctx.wanted, landed, attempts },
      'VOD: ffmpeg cayó después del segmento pedido',
    );
    if (ctx.startSegment === 0 || attempts > this.limits.lateRetries) {
      if (attempts > this.limits.lateRetries + LATE_GIVE_UP_EXTRA) {
        this.abandon(ctx);
        this.drop(new AppError('vod_dropped', { detail: 'ffmpeg no cae donde dice el índice' }));
        return true;
      }
      return false;
    }
    this.abandon(ctx);
    this.requestRestart({ segment: ctx.startSegment - 1, wanted: ctx.wanted }, true);
    return true;
  }

  private abandon(ctx: RunContext): void {
    ctx.abandoned = true;
    void ctx.run.kill();
  }

  private onData(ctx: RunContext, chunk: Buffer): void {
    const writer = ctx.writer;
    if (ctx.abandoned || !writer?.stream) return;
    writer.bytes += chunk.length;
    const stream = writer.stream;
    if (!stream.write(chunk) && !ctx.run.isPaused('disco')) {
      /* El disco no da abasto: se para hasta que vacíe. Ojo: tras `end()` Node
         ya no emite 'drain', así que también vale 'finish' o 'close' (si no, un
         segmento cerrado con la pausa puesta lo dejaba todo parado). */
      ctx.run.pause('disco');
      const release = (): void => {
        stream.off('drain', release);
        stream.off('finish', release);
        stream.off('close', release);
        ctx.run.resume('disco');
      };
      stream.on('drain', release);
      stream.on('finish', release);
      stream.on('close', release);
    }
  }

  private openWriter(ctx: RunContext, segment: number): void {
    const part = path.join(this.options.dir, `${segmentFileName(segment)}.${ctx.number}.part`);
    /* Si ya está hecho (por otra ejecución), no se reescribe: sus bytes se tiran. */
    const stream = this.produced(segment) ? null : createWriteStream(part);
    const writer: Writer = { segment, part, stream, bytes: 0, aborted: false };
    stream?.on('error', (error: NodeJS.ErrnoException) => {
      if (writer.aborted || ctx.abandoned || this.closed || this.failure) return;
      this.abandon(ctx);
      this.drop(
        error.code === 'ENOSPC'
          ? new AppError('vod_disk_full', { cause: error })
          : new AppError('vod_dropped', {
              cause: error,
              detail: `no se pudo escribir el segmento (${error.code ?? error.message})`,
            }),
      );
    });
    ctx.writer = writer;
    this.deps.logger.debug(
      { sessionId: this.options.sessionId, segment, discard: stream === null },
      'VOD: abre segmento',
    );
  }

  /** Cierra el segmento en curso: `.part` → `.m4s`, despierta a quien lo esperaba y recorta el disco. */
  private closeWriter(ctx: RunContext): void {
    const writer = ctx.writer;
    ctx.writer = null;
    if (!writer) return;
    ctx.finished += 1;
    if (ctx.finished >= 2) this.failures = 0;
    this.lateAttempts.delete(writer.segment);
    if (!writer.stream) return;
    const stream = writer.stream;
    const final = path.join(this.options.dir, segmentFileName(writer.segment));
    this.finalizing.add(writer.segment);
    this.queueFs(async () => {
      try {
        /* Hasta el 'close' (fichero cerrado), no solo el 'finish': así se renombra cerrado. */
        await new Promise<void>((resolve, reject) => {
          stream.once('error', reject);
          stream.once('close', () => resolve());
          stream.end();
        });
        if (this.closed) return;
        await rename(writer.part, final);
        this.onDisk.set(writer.segment, writer.bytes);
        this.deps.logger.debug(
          { sessionId: this.options.sessionId, segment: writer.segment, bytes: writer.bytes },
          'VOD: segmento listo',
        );
      } finally {
        this.finalizing.delete(writer.segment);
      }
      this.wake(writer.segment);
      this.trimDisk();
      this.applyBackpressure();
    });
  }

  /** Tira el segmento a medias de una ejecución que se ha parado. */
  private abortWriter(ctx: RunContext): void {
    const writer = ctx.writer;
    ctx.writer = null;
    if (!writer?.stream) return;
    writer.aborted = true;
    const stream = writer.stream;
    this.queueFs(async () => {
      if (!stream.closed) {
        await new Promise<void>((resolve) => {
          stream.once('close', () => resolve());
          stream.destroy();
        });
      }
      await unlink(writer.part).catch(() => undefined);
    });
  }

  /** ¿Esta ejecución llegó al último segmento del plan? (Solo entonces su código 0 es el final.) */
  private reachedEnd(ctx: RunContext): boolean {
    return ctx.opened && ctx.writer?.segment === this.plan.segments.length - 1;
  }

  private onRunEnd(ctx: RunContext, ended: VodRunEnd): void {
    this.deps.clock.clearTimeout(ctx.firstTimer);
    ctx.firstTimer = null;
    if (this.current === ctx) this.current = null;
    /* Sin ejecución no hay nada que esperar: lo que haya en disco sale ya. */
    for (const wake of [...this.warmWaiters]) wake();
    let end = ended;
    if (end.kind === 'complete' && !ctx.abandoned) {
      if (this.reachedEnd(ctx)) {
        if (end.inputError) {
          this.deps.logger.warn(
            { sessionId: this.options.sessionId, stderr: end.inputError },
            'VOD: ffmpeg llegó al último segmento con un error de la entrada',
          );
        }
        this.closeWriter(ctx);
        this.deps.logger.debug({ sessionId: this.options.sessionId }, 'VOD: ffmpeg llegó al final');
        return;
      }
      /* Código 0 ANTES del final: ffmpeg toma un error de lectura de la entrada
         (el relé cortó o no pudo reabrir) por el final del fichero. Es un fallo:
         el segmento a medias se tira (nunca se publica cortado) y cuenta para el
         reintento. */
      end = {
        kind: 'failed',
        error: new AppError('vod_dropped', {
          detail: `ffmpeg acabó antes del final (${end.inputError ?? 'sin error en stderr'})`,
        }),
        code: 0,
        signal: null,
      };
    }
    this.abortWriter(ctx);
    if (end.kind !== 'failed' || ctx.abandoned || this.closed || this.failure) return;
    this.deps.logger.warn(
      {
        sessionId: this.options.sessionId,
        errorCode: end.error.code,
        exitCode: end.code,
        stderr: ctx.run.stderrTail(400),
      },
      'VOD: ffmpeg ha fallado',
    );
    if (end.error.code === 'ffmpeg_missing') {
      this.drop(end.error);
      return;
    }
    this.failures += 1;
    if (this.failures > this.limits.failureRetries) {
      this.drop(
        new AppError('vod_dropped', { cause: end.error, detail: 'ffmpeg VOD falló dos veces' }),
      );
      return;
    }
    let first = this.lastRequested;
    while (this.produced(first)) first += 1;
    if (first < this.plan.segments.length) this.requestRestart({ segment: first, wanted: first });
  }

  // --- Contrapresión, disco y pausa larga ---

  /**
   * Contrapresión, contada desde el FINAL del último segmento pedido. Nunca
   * se para mientras ese segmento no está hecho: un segmento solo se cierra
   * cuando llega el fotograma clave del siguiente (o el final del fichero),
   * así que parar antes lo dejaría a medias para siempre con el reproductor
   * esperándolo (y, al final del fichero, sin vaciar la salida de un ffmpeg
   * que ya ha salido).
   */
  private applyBackpressure(): void {
    const ctx = this.current;
    if (!ctx || ctx.run.finished) return;
    const requested = this.plan.segments[this.lastRequested];
    if (!requested || !ctx.opened || !this.onDisk.has(this.lastRequested)) {
      ctx.run.resume('adelanto');
      return;
    }
    const ahead = ctx.producedS - requested.endS;
    if (ahead > this.limits.aheadMaxS) ctx.run.pause('adelanto');
    else if (ahead < this.limits.aheadResumeS) ctx.run.resume('adelanto');
  }

  /** Ventana: desde el último pedido − 120 s, ≤ 256 MiB por detrás y ≤ 1,5 GiB en total. */
  private trimDisk(): void {
    const requested = this.plan.segments[this.lastRequested];
    if (!requested) return;
    const doomed = new Set<number>();
    const behind = [...this.onDisk.keys()]
      .filter((segment) => segment < this.lastRequested)
      .sort((a, b) => a - b);
    let behindBytes = 0;
    for (const segment of behind) behindBytes += this.onDisk.get(segment) ?? 0;
    for (const segment of behind) {
      const end = this.plan.segments[segment]?.endS ?? 0;
      if (
        end < requested.startS - this.limits.keepBehindS ||
        behindBytes > this.limits.keepBehindMaxBytes
      ) {
        doomed.add(segment);
        behindBytes -= this.onDisk.get(segment) ?? 0;
      }
    }
    let total = 0;
    for (const [segment, size] of this.onDisk) if (!doomed.has(segment)) total += size;
    if (total > this.limits.sessionDiskMaxBytes) {
      const byDistance = [...this.onDisk.keys()]
        .filter((segment) => !doomed.has(segment) && segment !== this.lastRequested)
        .sort((a, b) => Math.abs(b - this.lastRequested) - Math.abs(a - this.lastRequested));
      for (const segment of byDistance) {
        if (total <= this.limits.sessionDiskMaxBytes) break;
        doomed.add(segment);
        total -= this.onDisk.get(segment) ?? 0;
      }
    }
    for (const segment of doomed) {
      this.onDisk.delete(segment);
      const file = path.join(this.options.dir, segmentFileName(segment));
      this.queueFs(() => unlink(file).catch(() => undefined));
    }
  }

  private armIdle(): void {
    this.deps.clock.clearTimeout(this.idleTimer);
    this.idleTimer = this.deps.clock.setTimeout(
      () => {
        this.idleTimer = null;
        if (this.closed || !this.current) return;
        this.deps.logger.info(
          { sessionId: this.options.sessionId },
          'VOD: pausa larga, se suelta el proveedor',
        );
        void this.stopRun().then(() => {
          if (!this.closed) this.deps.onIdle?.();
        });
      },
      this.limits.idleReleaseMs,
      { unref: true },
    );
  }

  /**
   * La sesión no puede seguir: se avisa UNA vez, se para ffmpeg, se despierta
   * a quien esperaba y ya no se produce más (quien la abrió la cierra).
   */
  private drop(error: AppError): void {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.deps.logger.warn(
      { sessionId: this.options.sessionId, errorCode: error.code },
      'VOD: la sesión no puede seguir',
    );
    this.cancelRestart();
    void this.stopRun();
    for (const set of [...this.waiters.values()]) for (const wake of [...set]) wake();
    for (const wake of [...this.initWaiters]) wake();
    for (const wake of [...this.warmWaiters]) wake();
    try {
      this.deps.onDropped?.(error);
    } catch {}
  }

  private queueFs(work: () => Promise<void>): void {
    this.fsChain = this.fsChain.then(work).catch((error: unknown) => {
      this.deps.logger.warn(
        { sessionId: this.options.sessionId, err: error },
        'VOD: fallo de disco',
      );
    });
  }
}
