/* ¿La IPTV viene entrelazada? (0.9.2)

   Hay canales 1080i (25 imágenes/s de dos campos). El navegador los
   desentrelaza al pintarlos, pero el iPhone (AVPlayer) no: se ven a tirones y
   con «peinado». Para saberlo no se abre otra conexión con el proveedor (el
   relé solo admite una por ticket): ffprobe lee, por la tubería, el init y el
   primer segmento que el remux ya ha escrito en disco con `-c:v copy` (el
   H.264 va tal cual, con sus campos) y decodifica las primeras imágenes.
   `interlaced_frame` es fiable con PAFF y con MBAFF; `field_order` del flujo
   no siempre lo trae el fMP4.

   0.9.6: hay canales «entrelazados camuflados» (DAZN y M+ LaLiga en el
   proveedor de Isma): la imagen viene peinada pero cada fotograma dice ser
   progresivo, así que la marca no basta y en el iPhone se veían las rayas
   sobre el césped. Si la marca dice progresivo, se mira la imagen: el filtro
   `idet` de ffmpeg cuenta los fotogramas peinados (TFF/BFF) frente a los
   progresivos píxel a píxel. Su veredicto sale por stdout con `metadata`
   (la misma tubería, sin leer stderr). Solo en lo que puede venir de una
   emisión entrelazada: 1080 líneas y hasta 30 imágenes/s (idet confunde a
   veces imágenes muy movidas de poca resolución con peinadas, y un 720p50
   nunca es entrelazado). */

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
  'frame=interlaced_frame,height',
  '-of',
  'default=noprint_wrappers=1',
  '-i',
  'pipe:0',
];

/**
 * La segunda mirada (0.9.6): ffmpeg con `idet` sobre las mismas imágenes, que escribe por stdout una línea
 * `lavfi.idet.multiple.current_frame=tff|bff|progressive|undetermined` por imagen.
 */
export const COMBING_PROBE_ARGS: readonly string[] = [
  '-hide_banner',
  '-v',
  'error',
  '-nostdin',
  '-i',
  'pipe:0',
  '-map',
  '0:v:0',
  '-frames:v',
  String(INTERLACE_PROBE_FRAMES * 5),
  '-vf',
  'idet,metadata=mode=print:key=lavfi.idet.multiple.current_frame:file=-',
  '-an',
  '-f',
  'null',
  '-',
];

/** Altura de las imágenes según ffprobe (`height=1080`), o null. */
export function heightFromFfprobe(stdout: string): number | null {
  const m = /height=(\d+)/.exec(stdout);
  return m ? Number(m[1]) : null;
}

/** Imágenes por segundo según los tiempos de `metadata` (`pts_time:0.04`), o null. */
export function fpsFromIdet(stdout: string): number | null {
  const tiempos = [...stdout.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  if (tiempos.length < 3) return null;
  const tramo = (tiempos[tiempos.length - 1] as number) - (tiempos[0] as number);
  return tramo > 0 ? (tiempos.length - 1) / tramo : null;
}

/** Lo que puede ser una emisión entrelazada: 1080 líneas (1080i) a 25 o 29,97 imágenes/s. */
export const COMBING_MIN_HEIGHT = 1000;
export const COMBING_MAX_FPS = 31;

/** Imágenes peinadas que hacen falta para fiarse de `idet` (con menos, no se decide). */
export const COMBING_MIN_FRAMES = 8;

/**
 * Veredicto de `idet`: `true` si las imágenes peinadas (TFF + BFF) superan a las progresivas y son al
 * menos `COMBING_MIN_FRAMES`; `false` si mandan las progresivas; `null` sin datos.
 */
export function interlacedFromIdet(stdout: string): boolean | null {
  let peinadas = 0;
  let progresivas = 0;
  for (const match of stdout.matchAll(/current_frame=(tff|bff|progressive|undetermined)/g)) {
    if (match[1] === 'tff' || match[1] === 'bff') peinadas += 1;
    else if (match[1] === 'progressive') progresivas += 1;
  }
  if (peinadas + progresivas === 0) return null;
  return peinadas > progresivas && peinadas >= COMBING_MIN_FRAMES;
}

/**
 * Veredicto de la salida de ffprobe (una línea por imagen, `1` o `0`, a veces con una coma detrás): `true`
 * si al menos la mitad de las imágenes vienen entrelazadas, `null` si no salió ninguna.
 */
export function interlacedFromFfprobe(stdout: string): boolean | null {
  let total = 0;
  let interlaced = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    /* `interlaced_frame=1` (con la altura al lado) o, como antes, la cifra sola. */
    const line = raw.trim().replace(/^interlaced_frame=/, '');
    if (/^height=/.test(line)) continue;
    const flag = line.charAt(0);
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
export async function probeInterlaced(
  files: readonly string[],
  signal: AbortSignal,
  spawner: InterlaceSpawner = defaultSpawner,
): Promise<boolean | null> {
  const sonda = await runPiped('ffprobe', INTERLACE_PROBE_ARGS, files, signal, spawner);
  if (sonda === null) return null;
  const marca = interlacedFromFfprobe(sonda);
  /* Entrelazado según la marca, o sin poder mirar: eso manda. Progresivo según la marca: se mira la imagen. */
  if (marca !== false) return marca;
  const alto = heightFromFfprobe(sonda);
  if (alto !== null && alto < COMBING_MIN_HEIGHT) return false;
  const imagen = await runPiped('ffmpeg', COMBING_PROBE_ARGS, files, signal, spawner);
  if (imagen === null) return false;
  const fps = fpsFromIdet(imagen);
  if (fps !== null && fps > COMBING_MAX_FPS) return false;
  return interlacedFromIdet(imagen) ?? false;
}

/** Lanza `command` con `files` seguidos por stdin y devuelve su stdout (null si no se pudo). */
function runPiped(
  command: string,
  args: readonly string[],
  files: readonly string[],
  signal: AbortSignal,
  spawner: InterlaceSpawner,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    let child: ProbeChild;
    try {
      child = spawner(command, args);
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let settled = false;
    const finish = (value: string | null): void => {
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
    child.on('close', () => finish(out));
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
