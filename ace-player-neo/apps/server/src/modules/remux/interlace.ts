/* ¿La IPTV viene entrelazada? (0.9.2)

   Hay canales 1080i (25 imágenes/s de dos campos). El navegador los
   desentrelaza al pintarlos, pero el iPhone (AVPlayer) no: se ven a tirones y
   con «peinado». Para saberlo no se abre otra conexión con el proveedor (el
   relé solo admite una por ticket): ffprobe lee, por la tubería, el init y el
   primer segmento que el remux ya ha escrito en disco con `-c:v copy` (el
   H.264 va tal cual, con sus campos) y decodifica las primeras imágenes.
   `interlaced_frame` es fiable con PAFF y con MBAFF; `field_order` del flujo
   no siempre lo trae el fMP4. */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import type { Readable, Writable } from 'node:stream';

/** Imágenes que se decodifican (medio segundo a 25i). */
export const INTERLACE_PROBE_FRAMES = 12;
/** Tope de la sonda: un segmento de 2 s en local se lee en décimas. */
export const INTERLACE_PROBE_TIMEOUT_MS = 10_000;

export const INTERLACE_PROBE_ARGS: readonly string[] = [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-read_intervals',
  `%+#${INTERLACE_PROBE_FRAMES}`,
  '-show_entries',
  'frame=interlaced_frame',
  '-of',
  'csv=p=0',
  '-i',
  'pipe:0',
];

/**
 * Veredicto de la salida de ffprobe (una línea por imagen, `1` o `0`, a veces con una coma detrás): `true`
 * si al menos la mitad de las imágenes vienen entrelazadas, `null` si no salió ninguna.
 */
export function interlacedFromFfprobe(stdout: string): boolean | null {
  let total = 0;
  let interlaced = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const flag = line.trim().charAt(0);
    if (flag !== '0' && flag !== '1') continue;
    total += 1;
    if (flag === '1') interlaced += 1;
  }
  if (!total) return null;
  return interlaced * 2 >= total;
}

interface ProbeChild {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export type InterlaceSpawner = (command: string, args: readonly string[]) => ProbeChild;

const defaultSpawner: InterlaceSpawner = (command, args) =>
  spawn(command, [...args], { stdio: ['pipe', 'pipe', 'ignore'] });

/**
 * ffprobe sobre `files` seguidos (init + segmento). Nunca lanza: sin ffprobe, con un error o pasado el tope,
 * `null` (se queda como está, copiando).
 */
export function probeInterlaced(
  files: readonly string[],
  signal: AbortSignal,
  spawner: InterlaceSpawner = defaultSpawner,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let child: ProbeChild;
    try {
      child = spawner('ffprobe', INTERLACE_PROBE_ARGS);
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let settled = false;
    const finish = (value: boolean | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      child.kill('SIGKILL');
      finish(null);
    };
    const timer = setTimeout(onAbort, INTERLACE_PROBE_TIMEOUT_MS);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => finish(null));
    child.on('close', () => finish(interlacedFromFfprobe(out)));
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (out.length < 64 * 1024) out += chunk;
    });
    /* ffprobe cierra la tubería en cuanto tiene sus imágenes: EPIPE es lo normal. */
    const stdin = child.stdin;
    stdin?.on('error', () => undefined);
    const pump = async (): Promise<void> => {
      for (const file of files) {
        if (settled || !stdin || stdin.destroyed) return;
        await new Promise<void>((done) => {
          const stream = createReadStream(file);
          stream.on('error', () => done());
          stream.on('end', () => done());
          stdin.on('close', () => done());
          stream.pipe(stdin, { end: false });
        });
      }
      stdin?.end();
    };
    pump().catch(() => stdin?.destroy());
  });
}
