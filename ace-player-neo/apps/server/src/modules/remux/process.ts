/* Procesos ffmpeg del remux (arquitectura §5.7).

   - Lanzador inyectable: en producción `spawn('ffmpeg', …)`; en los tests un
     ffmpeg falso (un script de node o un proceso simulado en memoria).
   - Grupo de procesos propio (`detached` en POSIX) para matarlo entero con
     `kill(-pgid)`; prioridad baja con `os.setPriority(pid, 10)` (= nice 10).
   - La salida de error va a un búfer circular de 64 KiB en memoria (hoy
     `ffmpeg.log` crece sin límite en disco, backend-modulos §8.4.20).
   - Huérfanos: ffmpeg con `ace_session=` en /proc/<pid>/cmdline que no estén
     en el registro (de un proceso anterior que murió sin limpiar). */

import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REMUX_LOG_BYTES } from '@ace/shared';
import { ACE_SESSION_MARK } from './args.js';
import type { ProcessLauncher, RemuxProcess } from './types.js';

/** Prioridad de los ffmpeg (arquitectura §5.7: nice 10). */
export const REMUX_NICENESS = 10;

const IS_WINDOWS = process.platform === 'win32';

/** Mata un proceso y, en POSIX, su grupo entero. Nunca lanza. */
export function killProcessTree(pid: number | undefined, child?: ChildProcess): void {
  if (pid && !IS_WINDOWS) {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {}
  }
  try {
    if (child) child.kill('SIGKILL');
    else if (pid) process.kill(pid, 'SIGKILL');
  } catch {}
}

export interface SpawnLauncherOptions {
  /** Ejecutable (`ffmpeg`; en los tests, `process.execPath`). */
  readonly command?: string;
  /** Argumentos que van delante de los de ffmpeg (el script del ffmpeg falso). */
  readonly prefixArgs?: readonly string[];
  readonly niceness?: number;
}

/** Lanzador real con `child_process.spawn`. */
export function createSpawnLauncher(options: SpawnLauncherOptions = {}): ProcessLauncher {
  const command = options.command ?? 'ffmpeg';
  const prefix = options.prefixArgs ?? [];
  const niceness = options.niceness ?? REMUX_NICENESS;
  return {
    spawn(args) {
      const child = spawn(command, [...prefix, ...args], {
        detached: !IS_WINDOWS,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      /* Un 'error' sin escuchar tumbaría el proceso: el servicio pone el suyo,
         pero por si acaso este no se pierde nunca. */
      child.on('error', () => {});
      if (child.pid) {
        try {
          os.setPriority(child.pid, niceness);
        } catch {}
      }
      const handle: RemuxProcess = {
        pid: child.pid,
        onExit(listener) {
          child.once('exit', (code, signal) => listener(code, signal));
        },
        onError(listener) {
          child.once('error', listener);
        },
        onStderr(listener) {
          child.stderr?.on('data', (chunk: Buffer) => listener(chunk));
        },
        kill() {
          killProcessTree(child.pid, child);
        },
      };
      return handle;
    },
  };
}

/** Búfer circular de bytes: se queda con los últimos `max`. */
export class RingLog {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly max: number = REMUX_LOG_BYTES) {}

  get bytes(): number {
    return this.size;
  }

  push(chunk: Buffer): void {
    if (!chunk.length) return;
    if (chunk.length >= this.max) {
      this.chunks = [Buffer.from(chunk.subarray(chunk.length - this.max))];
      this.size = this.max;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.max) {
      const first = this.chunks[0] as Buffer;
      const excess = this.size - this.max;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  /** Los últimos `chars` caracteres (para el diagnóstico). */
  tail(chars: number): string {
    const text = this.text().trim();
    return text.length > chars ? text.slice(text.length - chars) : text;
  }
}

/**
 * Pids de ffmpeg del remux que no están en el registro: los que llevan
 * `ace_session=<id>` en su línea de órdenes con un id desconocido.
 */
export async function findOrphanPids(
  procRoot: string,
  knownSessions: ReadonlySet<string>,
  ownPid: number,
): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return [];
  }
  const orphans: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === ownPid) continue;
    let cmdline: string;
    try {
      cmdline = await readFile(path.join(procRoot, entry, 'cmdline'), 'utf8');
    } catch {
      continue;
    }
    const mark = cmdline.split('\0').find((arg) => arg.startsWith(ACE_SESSION_MARK));
    if (!mark) continue;
    const sessionId = mark.slice(ACE_SESSION_MARK.length);
    if (!knownSessions.has(sessionId)) orphans.push(pid);
  }
  return orphans;
}
