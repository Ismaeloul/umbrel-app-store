/* UNA ejecución de ffmpeg del VOD (docs/vod.md §9.6 y §9.7).

   Lanza ffmpeg con su salida por la tubería, la pasa por el troceador fMP4
   y dice cómo acabó:
   - `complete`: salió con código 0 y la salida estaba entera. Es el final
     del fichero, NO una muerte (nunca pasa por el `died` del directo, T10).
   - `killed`: la paró el productor (reinicio, pausa larga o cierre).
   - `failed`: otro código, una salida rota o no hay ffmpeg.

   - Contrapresión: `pause(motivo)` deja de leer `pipe:1` (ffmpeg se para,
     deja de leer del relé y el relé del proveedor); `resume(motivo)` sigue
     cuando no queda ningún motivo (el productor pausa por ir por delante y
     por el disco).
   - Su stderr va a un búfer circular de 64 KiB (redactado al leerlo). Un
     «Non-monotonic DTS» ahí no es un fallo (P4): solo cuenta el código.
   - Matar espera a que el proceso salga Y a que su salida se cierre: nunca
     quedan dos ffmpeg del VOD a la vez ni un hijo huérfano. */

import { AppError } from '../../../core/errors.js';
import { RingLog } from '../process.js';
import { Fmp4Splitter, type Fmp4Handlers } from './fmp4.js';
import type { VodProcess, VodProcessLauncher } from './types.js';

export type VodRunEnd =
  | { readonly kind: 'complete' }
  | { readonly kind: 'killed' }
  | {
      readonly kind: 'failed';
      readonly error: AppError;
      readonly code: number | null;
      readonly signal: string | null;
    };

export interface VodRunOptions {
  readonly launcher: VodProcessLauncher;
  readonly args: readonly string[];
  readonly handlers: Fmp4Handlers;
  /** Limpia la cola de stderr antes de que salga a un registro. */
  readonly redact?: (text: string) => string;
}

export class VodRun {
  readonly ended: Promise<VodRunEnd>;
  private readonly process: VodProcess | null = null;
  private readonly log = new RingLog();
  private readonly splitter: Fmp4Splitter;
  private readonly pauses = new Set<string>();
  private killed = false;
  private splitError: AppError | null = null;
  private exit: { code: number | null; signal: string | null } | null = null;
  private outputClosed = false;
  private settle: (end: VodRunEnd) => void = () => undefined;
  private done = false;

  constructor(private readonly options: VodRunOptions) {
    this.splitter = new Fmp4Splitter(options.handlers);
    this.ended = new Promise((resolve) => (this.settle = resolve));
    let child: VodProcess;
    try {
      child = options.launcher.spawn(options.args);
    } catch (error) {
      this.finish({ kind: 'failed', error: this.spawnError(error), code: null, signal: null });
      return;
    }
    this.process = child;
    child.onError((error) => {
      this.finish({ kind: 'failed', error: this.spawnError(error), code: null, signal: null });
    });
    child.onStderr((chunk) => this.log.push(chunk));
    child.onExit((code, signal) => {
      this.exit = { code, signal };
      this.maybeFinish();
    });
    const out = child.stdout;
    out.on('data', (chunk: Buffer) => {
      if (this.splitError || this.killed) return;
      try {
        this.splitter.push(chunk);
      } catch (error) {
        this.splitError = toAppError(error);
        child.kill();
        out.destroy();
      }
    });
    out.once('end', () => {
      if (this.splitError || this.killed) return;
      try {
        this.splitter.end();
      } catch (error) {
        this.splitError = toAppError(error);
      }
    });
    out.once('close', () => {
      this.outputClosed = true;
      this.maybeFinish();
    });
    out.on('error', () => undefined);
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get finished(): boolean {
    return this.done;
  }

  /** Deja de leer la salida (contrapresión) por `reason`. */
  pause(reason: string): void {
    this.pauses.add(reason);
    this.process?.stdout.pause();
  }

  /** Sigue leyendo si ya no queda ningún motivo para parar. */
  resume(reason: string): void {
    this.pauses.delete(reason);
    if (!this.pauses.size && !this.killed) this.process?.stdout.resume();
  }

  isPaused(reason?: string): boolean {
    return reason === undefined ? this.pauses.size > 0 : this.pauses.has(reason);
  }

  pauseReasons(): string[] {
    return [...this.pauses].sort();
  }

  /** Mata el proceso y espera a que salga y se cierre su salida. */
  kill(): Promise<VodRunEnd> {
    if (!this.done) {
      this.killed = true;
      this.process?.kill();
      this.process?.stdout.destroy();
    }
    return this.ended;
  }

  /** Lo último que dijo ffmpeg por stderr (redactado). */
  stderrTail(chars = 2_000): string {
    const tail = this.log.tail(chars);
    return this.options.redact ? this.options.redact(tail) : tail;
  }

  private maybeFinish(): void {
    if (this.done || !this.exit || !this.outputClosed) return;
    if (this.killed) {
      this.finish({ kind: 'killed' });
      return;
    }
    const { code, signal } = this.exit;
    if (this.splitError) {
      this.finish({ kind: 'failed', error: this.splitError, code, signal });
      return;
    }
    if (code === 0) {
      this.finish({ kind: 'complete' });
      return;
    }
    this.finish({
      kind: 'failed',
      error: new AppError('vod_dropped', {
        detail: `ffmpeg VOD salió con ${code ?? signal}: ${this.stderrTail(300)}`,
      }),
      code,
      signal,
    });
  }

  private finish(end: VodRunEnd): void {
    if (this.done) return;
    this.done = true;
    this.settle(end);
  }

  private spawnError(error: unknown): AppError {
    const code = (error as { code?: string } | null)?.code;
    return code === 'ENOENT'
      ? new AppError('ffmpeg_missing', { cause: error })
      : new AppError('vod_dropped', { cause: error, detail: 'no se pudo lanzar ffmpeg' });
  }
}

function toAppError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('vod_dropped', { cause: error, detail: 'troceador fMP4' });
}
