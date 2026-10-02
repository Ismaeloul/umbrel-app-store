/* Utilidades de los tests de remux y playback (no es código de producto:
   solo lo importan los *.test.ts).

   - `createFakeLauncher()`: un "ffmpeg" en memoria que escribe de verdad en la
     carpeta de la sesión index.m3u8, init.mp4 e index<N>.m4s cuando el test se
     lo pide (o nada más lanzarse), y que muere o se deja matar a voluntad.
     Hace caso, como el de verdad, a `-start_number`, `-hls_list_size`,
     `-hls_fmp4_init_filename` y `discont_start` (reinicio continuo, B2).
   - `FAKE_FFMPEG_SCRIPT`: el mismo ffmpeg falso como script de node, para
     probar el `spawn` real (grupo de procesos, stderr y kill). */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FakeClock } from '../../core/clock.js';
import { ACE_SESSION_MARK } from './args.js';
import type { ProcessLauncher, RemuxProcess } from './types.js';

/**
 * Deja correr la E/S real (fs y sockets) hasta que el reloj falso tenga al
 * menos `min` temporizadores pendientes: así se sabe que el código ya está
 * "aparcado" esperando al reloj. El tope en tiempo real es solo una red de
 * seguridad para que un test roto no se cuelgue.
 */
export async function parked(clock: FakeClock, min = 1, maxMs = 3000): Promise<void> {
  const start = performance.now();
  while (clock.pendingTimers() < min && performance.now() - start < maxMs) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Unas vueltas del bucle de eventos para que termine la E/S en curso. */
export async function ioTurns(turns = 30): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Avanza el reloj a pasos, esperando entre paso y paso a que el código se aparque. */
export async function advanceParked(
  clock: FakeClock,
  ms: number,
  options: { readonly step?: number; readonly min?: number } = {},
): Promise<void> {
  const step = options.step ?? 1000;
  let left = ms;
  while (left > 0) {
    const delta = Math.min(step, left);
    await parked(clock, options.min ?? 1);
    await clock.advanceAsync(delta);
    left -= delta;
  }
}

let nextPid = 41_000;

export class FakeFfmpeg implements RemuxProcess {
  readonly pid: number;
  readonly dir: string;
  readonly input: string;
  readonly sessionId: string;
  alive = true;
  killed = false;
  /** Init que escribe (`-hls_fmp4_init_filename`). */
  readonly initName: string;
  /** Número del primer segmento (`-start_number`). */
  readonly startNumber: number;
  private readonly listSize: number;
  private readonly discontStart: boolean;
  private readonly durations: number[] = [];
  private readonly exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
  private readonly errorListeners: ((error: Error & { code?: string }) => void)[] = [];
  private readonly stderrListeners: ((chunk: Buffer) => void)[] = [];

  constructor(readonly args: readonly string[]) {
    this.pid = nextPid++;
    this.dir = path.dirname(args[args.length - 1] ?? '.');
    this.input = args[args.indexOf('-i') + 1] ?? '';
    const mark = args.find((arg) => arg.startsWith(ACE_SESSION_MARK)) ?? '';
    this.sessionId = mark.slice(ACE_SESSION_MARK.length);
    const option = (name: string): string | undefined =>
      args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
    this.initName = option('-hls_fmp4_init_filename') ?? 'init.mp4';
    this.startNumber = Number(option('-start_number') ?? 0);
    this.listSize = Number(option('-hls_list_size') ?? 0);
    this.discontStart = (option('-hls_flags') ?? '').includes('discont_start');
  }

  /** Escribe segmentos nuevos (en segundos) y reescribe la lista con la ventana (`-hls_list_size`). */
  writeSegments(durations: readonly number[]): void {
    if (!this.alive) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(path.join(this.dir, this.initName), Buffer.from('init-mp4-fake'));
    for (const duration of durations) {
      const number = this.startNumber + this.durations.length;
      writeFileSync(path.join(this.dir, `index${number}.m4s`), Buffer.from(`segmento ${number}`));
      this.durations.push(duration);
    }
    const first = this.listSize > 0 ? Math.max(0, this.durations.length - this.listSize) : 0;
    const target = Math.max(2, ...this.durations.slice(first).map((d) => Math.round(d)));
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      `#EXT-X-TARGETDURATION:${target}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.startNumber + first}`,
    ];
    /* Como ffmpeg: el `#EXT-X-DISCONTINUITY` de `discont_start` va con el primer segmento y sale con él. */
    if (this.discontStart && first === 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXT-X-MAP:URI="${this.initName}"`);
    this.durations.slice(first).forEach((duration, index) => {
      lines.push(`#EXTINF:${duration.toFixed(3)},`, `index${this.startNumber + first + index}.m4s`);
    });
    writeFileSync(path.join(this.dir, 'index.m3u8'), `${lines.join('\n')}\n`);
  }

  stderr(text: string): void {
    for (const listener of this.stderrListeners) listener(Buffer.from(text));
  }

  /** ffmpeg termina solo (código de salida). */
  exit(code: number | null = 1, signal: string | null = null): void {
    if (!this.alive) return;
    this.alive = false;
    for (const listener of this.exitListeners) listener(code, signal);
  }

  /** Error al lanzar (`ENOENT` = no hay ffmpeg). */
  fail(code = 'ENOENT'): void {
    this.alive = false;
    const error = Object.assign(new Error(`spawn ffmpeg ${code}`), { code });
    for (const listener of this.errorListeners) listener(error);
  }

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.exitListeners.push(listener);
  }

  onError(listener: (error: Error & { code?: string }) => void): void {
    this.errorListeners.push(listener);
  }

  onStderr(listener: (chunk: Buffer) => void): void {
    this.stderrListeners.push(listener);
  }

  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.killed = true;
    queueMicrotask(() => {
      for (const listener of this.exitListeners) listener(null, 'SIGKILL');
    });
  }
}

export interface FakeLauncherOptions {
  /** Segmentos que escribe nada más lanzarse (por defecto 3 de 2 s: listo al momento). `null` = ninguno. */
  readonly autoSegments?: readonly number[] | null;
  /** Sin ffmpeg: cada lanzamiento da ENOENT. */
  readonly missing?: boolean;
}

export interface FakeLauncher {
  readonly launcher: ProcessLauncher;
  readonly spawned: FakeFfmpeg[];
  /** Procesos vivos. */
  alive(): number;
  last(): FakeFfmpeg;
  /** A partir de ahora, cada lanzamiento da ENOENT (o vuelve a funcionar). */
  setMissing(missing: boolean): void;
  /** Segmentos que escriben los PRÓXIMOS lanzamientos nada más lanzarse (`null` = ninguno). */
  setAutoSegments(segments: readonly number[] | null): void;
}

export function createFakeLauncher(options: FakeLauncherOptions = {}): FakeLauncher {
  const spawned: FakeFfmpeg[] = [];
  let auto = options.autoSegments === undefined ? [2, 2, 2] : options.autoSegments;
  let missing = options.missing === true;
  return {
    spawned,
    launcher: {
      spawn(args) {
        const proc = new FakeFfmpeg(args);
        spawned.push(proc);
        if (missing) queueMicrotask(() => proc.fail('ENOENT'));
        else if (auto) proc.writeSegments(auto);
        return proc;
      },
    },
    alive: () => spawned.filter((proc) => proc.alive).length,
    setMissing: (value) => {
      missing = value;
    },
    setAutoSegments: (segments) => {
      auto = segments;
    },
    last: () => {
      const proc = spawned[spawned.length - 1];
      if (!proc) throw new Error('no se ha lanzado ningún ffmpeg');
      return proc;
    },
  };
}

/**
 * Script de node que hace de ffmpeg: escribe 3 segmentos de 2 s en la
 * carpeta del último argumento, deja algo en stderr y se queda vivo hasta que
 * lo maten.
 */
export const FAKE_FFMPEG_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[process.argv.length - 1];
const dir = path.dirname(out);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'init.mp4'), 'init');
const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MAP:URI="init.mp4"'];
for (let i = 0; i < 3; i += 1) {
  fs.writeFileSync(path.join(dir, 'index' + i + '.m4s'), 'seg' + i);
  lines.push('#EXTINF:2.000,', 'index' + i + '.m4s');
}
fs.writeFileSync(out, lines.join('\\n') + '\\n');
process.stderr.write('ffmpeg falso: ' + process.argv.slice(2).join(' ') + '\\n');
setInterval(() => {}, 1000);
`;
