/* ffmpeg falso del productor VOD (docs/vod.md §15.1: «producer.test.ts con
   ffmpeg falso que escribe cajas»).

   Un proceso en memoria que hace lo que el de verdad con
   `-noaccurate_seek -ss K+0,2 … -movflags +frag_keyframe… pipe:1`: saca el
   init y luego un fragmento por GOP desde el fotograma clave ≤ -ss, con los
   tiempos absolutos (`-copyts`), el desfase de los fotogramas B y su lista
   de edición. Respeta la contrapresión de verdad: solo escribe cuando quien
   lee su salida le pide más (un Readable). Se le pueden pedir las rarezas
   de las pruebas: caer tarde, fallar a mitad (también con código 0, como el
   de verdad cuando se le corta la entrada), cambiar de códec, ir lento o
   escribir «Non-monotonic DTS» en stderr. */

import { Readable } from 'node:stream';
import type { VodProcess, VodProcessLauncher } from '../../src/modules/remux/vod/types.js';
import { initSegment, mediaFragment } from './mp4.js';

export interface FakeMovie {
  /** Fotogramas clave (inicio de cada GOP), en segundos. */
  readonly keyframes: readonly number[];
  readonly durationS: number;
  readonly videoTimescale?: number;
  /** Bytes de vídeo por segundo (por defecto 20 000). */
  readonly bytesPerSecond?: number;
  /** Desfase de los fotogramas B, en la escala del vídeo (y la lista de edición que lo compensa). */
  readonly cto?: number;
}

export interface FakeRun {
  readonly index: number;
  readonly args: readonly string[];
  /** Segundo pedido con -ss (0 sin él). */
  readonly ss: number;
  /** Fragmentos escritos hasta ahora. */
  fragments: number;
  alive: boolean;
}

export interface FakeFfmpegBehavior {
  /** GOP de más que se salta al caer (caída tardía), por ejecución (desde 0). */
  readonly lateGops?: (run: number) => number;
  /** Sale tras escribir estos fragmentos (null: no falla), con `failCode` (por defecto 1). */
  readonly failAfter?: (run: number) => number | null;
  /**
   * Código con el que sale al fallar. 0 es lo que hace el ffmpeg de verdad
   * cuando su entrada HTTP se corta: lo toma por el final del fichero.
   */
  readonly failCode?: number;
  /** Lo que escribe en stderr al fallar (p. ej. «Error during demuxing: I/O error»). */
  readonly failStderr?: string;
  /** Etiqueta del códec de vídeo del init (cambiarla da un stsd distinto). */
  readonly codecTag?: (run: number) => string;
  /** Espera real entre fragmentos (ms). */
  readonly fragmentDelayMs?: number;
  /** Lo que escribe en stderr al empezar. */
  readonly stderr?: string;
}

export class FakeFfmpegLauncher implements VodProcessLauncher {
  readonly runs: FakeRun[] = [];
  alive = 0;
  maxAlive = 0;

  constructor(
    private readonly movie: FakeMovie,
    private readonly behavior: FakeFfmpegBehavior = {},
  ) {}

  /** Lo que se pidió con -ss en cada ejecución. */
  get starts(): number[] {
    return this.runs.map((run) => run.ss);
  }

  spawn(args: readonly string[]): VodProcess {
    const index = this.runs.length;
    const ssAt = args.indexOf('-ss');
    const ss = ssAt >= 0 ? Number(args[ssAt + 1]) : 0;
    const record: FakeRun = { index, args, ss, fragments: 0, alive: true };
    this.runs.push(record);
    this.alive += 1;
    this.maxAlive = Math.max(this.maxAlive, this.alive);

    const { keyframes, durationS } = this.movie;
    const scale = this.movie.videoTimescale ?? 16_000;
    const cto = this.movie.cto ?? 0;
    let gop = 0;
    for (let i = 0; i < keyframes.length; i += 1)
      if ((keyframes[i] as number) <= ss + 1e-9) gop = i;
    gop += this.behavior.lateGops?.(index) ?? 0;
    const failAfter = this.behavior.failAfter?.(index) ?? null;
    const codecTag = this.behavior.codecTag?.(index) ?? 'avc1';

    let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
    let exited = false;
    let killed = false;
    const exit = (code: number | null, signal: string | null): void => {
      if (exited) return;
      exited = true;
      record.alive = false;
      this.alive -= 1;
      setImmediate(() => exitListener?.(code, signal));
    };

    const stderrListeners: ((chunk: Buffer) => void)[] = [];
    let sentInit = false;
    let timer: NodeJS.Timeout | null = null;
    const stdout = new Readable({
      highWaterMark: 16 * 1024,
      read: () => {
        if (killed || timer) return;
        if (!sentInit) {
          sentInit = true;
          stdout.push(
            initSegment([
              { id: 1, handler: 'vide', timescale: scale, elstMediaTime: cto, codecTag },
              { id: 2, handler: 'soun', timescale: 48_000 },
            ]),
          );
          return;
        }
        const emit = (): void => {
          timer = null;
          if (killed) return;
          if (failAfter !== null && record.fragments >= failAfter) {
            const failStderr = this.behavior.failStderr;
            if (failStderr) {
              const text = Buffer.from(failStderr);
              stderrListeners.forEach((listener) => listener(text));
            }
            stdout.push(null);
            stdout.once('end', () => exit(this.behavior.failCode ?? 1, null));
            return;
          }
          if (gop >= keyframes.length) {
            stdout.push(null);
            stdout.once('end', () => exit(0, null));
            return;
          }
          const start = keyframes[gop] as number;
          const end = (keyframes[gop + 1] as number | undefined) ?? durationS;
          const samples = Math.max(1, Math.round((end - start) * 25));
          const sampleDuration = Math.round(((end - start) * scale) / samples);
          const bytes = Math.max(
            64,
            Math.round((end - start) * (this.movie.bytesPerSecond ?? 20_000)),
          );
          record.fragments += 1;
          gop += 1;
          stdout.push(
            mediaFragment(record.fragments, [
              {
                id: 1,
                tfdt: Math.round(start * scale),
                samples,
                sampleDuration,
                cto,
                bytes,
              },
              {
                id: 2,
                tfdt: start === 0 ? -1024 : Math.round(start * 48_000),
                samples: Math.round((end - start) * 47),
                sampleDuration: 1024,
                bytes: 256,
              },
            ]),
          );
        };
        if (this.behavior.fragmentDelayMs) timer = setTimeout(emit, this.behavior.fragmentDelayMs);
        else emit();
      },
    });
    stdout.on('close', () => {
      if (timer) clearTimeout(timer);
    });

    if (this.behavior.stderr) {
      const text = Buffer.from(this.behavior.stderr);
      setImmediate(() => stderrListeners.forEach((listener) => listener(text)));
    }

    return {
      pid: 40_000 + index,
      stdout,
      onExit(listener) {
        exitListener = listener;
      },
      onError() {},
      onStderr(listener) {
        stderrListeners.push(listener);
      },
      kill() {
        if (exited) return;
        killed = true;
        stdout.destroy();
        exit(null, 'SIGKILL');
      },
    };
  }
}
