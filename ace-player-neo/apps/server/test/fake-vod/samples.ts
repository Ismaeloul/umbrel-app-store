/* Muestras de vídeo del banco de pruebas VOD (docs/vod.md §15.3).

   Se generan con ffmpeg (`lavfi`) la primera vez que una prueba las pide y
   se guardan en la carpeta temporal del sistema: nunca hay binarios en el
   repositorio. Sin ffmpeg y ffprobe, `HAS_FFMPEG` es false y las pruebas que
   las usan se saltan (como las de la IPTV).

   Las cuatro de la estrategia C (docs/vod.md §9.2), de 60 s y pequeñas
   (320x180) para que generarlas tarde unos segundos:
   - `mkv-h264-ac3`: MKV H.264 sin fotogramas B, GOP irregular (2,5 s), dos
     AC-3 5.1 (castellano y un inglés con nombre) y un SRT.
   - `mp4-moov-end`: MP4 H.264 con 3 fotogramas B (lista de edición con
     desfase), GOP de 3,4 s, dos AAC (48 y 44,1 kHz) y el moov AL FINAL.
   - `mkv-bframes`: MKV H.264 a 23,976 con 3 fotogramas B y GOP de 2,7 s,
     AC-3 estéreo.
   - `mkv-hevc`: MKV HEVC (Main) con GOP de 2 s y E-AC-3 5.1.
   Y una de 5 min para el laboratorio (`mkv-larga`: H.264 con B, AC-3 5.1 y
   AAC), con la que los saltos reinician ffmpeg con las ventanas de verdad. */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ¿Hay ffmpeg y ffprobe en el PATH? */
export const HAS_FFMPEG =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

export type VodSampleName =
  'mkv-h264-ac3' | 'mp4-moov-end' | 'mkv-bframes' | 'mkv-hevc' | 'mkv-larga';

export interface VodSample {
  readonly name: VodSampleName;
  readonly ext: 'mkv' | 'mp4';
  readonly durationS: number;
  /** Argumentos de ffmpeg (sin la salida). `{srt}` se cambia por el SRT de prueba. */
  readonly args: readonly string[];
}

const DURATION_S = 60;
const VIDEO = (rate: string, duration = DURATION_S): string =>
  `testsrc2=size=320x180:rate=${rate}:duration=${duration}`;
const TONE = (hz: number, rate = 48_000, duration = DURATION_S): string =>
  `sine=frequency=${hz}:sample_rate=${rate}:duration=${duration}`;
/** La larga: 5 min, para que los saltos del laboratorio reinicien con las ventanas de verdad. */
const LONG_S = 300;
const QUIET = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];

export const VOD_SAMPLES: Readonly<Record<VodSampleName, VodSample>> = {
  'mkv-h264-ac3': {
    name: 'mkv-h264-ac3',
    ext: 'mkv',
    durationS: DURATION_S,
    args: [
      ...['-f', 'lavfi', '-i', VIDEO('24')],
      ...['-f', 'lavfi', '-i', TONE(440)],
      ...['-f', 'lavfi', '-i', TONE(660)],
      ...['-i', '{srt}'],
      ...['-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '0', '-pix_fmt', 'yuv420p'],
      ...['-g', '600', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2.5)'],
      ...['-c:a', 'ac3', '-ac', '6', '-b:a', '192k', '-c:s', 'srt'],
      ...['-metadata:s:a:0', 'language=spa', '-metadata:s:a:1', 'language=eng'],
      ...['-metadata:s:a:1', 'title=Inglés (original)', '-metadata:s:s:0', 'language=spa'],
    ],
  },
  'mp4-moov-end': {
    name: 'mp4-moov-end',
    ext: 'mp4',
    durationS: DURATION_S,
    args: [
      ...['-f', 'lavfi', '-i', VIDEO('25')],
      ...['-f', 'lavfi', '-i', TONE(440)],
      ...['-f', 'lavfi', '-i', TONE(550, 44_100)],
      ...['-map', '0:v', '-map', '1:a', '-map', '2:a'],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-bf', '3', '-pix_fmt', 'yuv420p'],
      ...['-g', '600', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*3.4)'],
      ...['-c:a', 'aac', '-b:a', '96k'],
      ...['-metadata:s:a:0', 'language=spa', '-metadata:s:a:1', 'language=eng'],
    ],
  },
  'mkv-bframes': {
    name: 'mkv-bframes',
    ext: 'mkv',
    durationS: DURATION_S,
    args: [
      ...['-f', 'lavfi', '-i', VIDEO('24000/1001')],
      ...['-f', 'lavfi', '-i', TONE(440)],
      ...['-map', '0:v', '-map', '1:a'],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-bf', '3', '-b_strategy', '0'],
      ...['-pix_fmt', 'yuv420p', '-g', '600', '-sc_threshold', '0'],
      ...['-force_key_frames', 'expr:gte(t,n_forced*2.7)'],
      ...['-c:a', 'ac3', '-ac', '2', '-b:a', '128k'],
    ],
  },
  'mkv-hevc': {
    name: 'mkv-hevc',
    ext: 'mkv',
    durationS: DURATION_S,
    args: [
      ...['-f', 'lavfi', '-i', VIDEO('25')],
      ...['-f', 'lavfi', '-i', TONE(440)],
      ...['-map', '0:v', '-map', '1:a'],
      ...['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
      ...['-x265-params', 'keyint=50:min-keyint=50:scenecut=0:log-level=error'],
      ...['-c:a', 'eac3', '-ac', '6', '-b:a', '192k'],
    ],
  },
  'mkv-larga': {
    name: 'mkv-larga',
    ext: 'mkv',
    durationS: LONG_S,
    args: [
      ...['-f', 'lavfi', '-i', VIDEO('24', LONG_S)],
      ...['-f', 'lavfi', '-i', TONE(440, 48_000, LONG_S)],
      ...['-f', 'lavfi', '-i', TONE(330, 48_000, LONG_S)],
      ...['-map', '0:v', '-map', '1:a', '-map', '2:a'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2', '-pix_fmt', 'yuv420p'],
      ...['-g', '600', '-sc_threshold', '0', '-force_key_frames', 'expr:gte(t,n_forced*2.4)'],
      ...['-c:a:0', 'ac3', '-ac:a:0', '6', '-b:a:0', '192k', '-c:a:1', 'aac', '-b:a:1', '96k'],
      ...['-metadata:s:a:0', 'language=spa', '-metadata:s:a:1', 'language=eng'],
    ],
  },
};

const SRT = '1\n00:00:01,000 --> 00:00:03,000\nHola\n\n2\n00:00:30,000 --> 00:00:32,000\nAdiós\n';

/** Sube con cada cambio de las muestras: así no se reutilizan las de antes. */
const SAMPLES_VERSION = 1;

/** Carpeta de las muestras (compartida entre ejecuciones; se puede borrar sin más). */
export function vodSamplesDir(): string {
  return path.join(os.tmpdir(), `ace-vod-muestras-v${SAMPLES_VERSION}`);
}

/**
 * Ruta de la muestra, generándola si aún no existe. Varias pruebas a la vez
 * pueden pedirla: cada una escribe en un nombre propio y lo renombra al
 * final, así nadie lee una muestra a medias.
 */
export function ensureVodSample(name: VodSampleName): string {
  const sample = VOD_SAMPLES[name];
  const dir = vodSamplesDir();
  const file = path.join(dir, `${name}.${sample.ext}`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const srt = path.join(dir, 'muestra.srt');
  if (!existsSync(srt)) writeFileSync(srt, SRT);
  const partial = path.join(dir, `${name}.${process.pid}.${Date.now()}.part.${sample.ext}`);
  const args = sample.args.map((arg) => (arg === '{srt}' ? srt : arg));
  const result = spawnSync('ffmpeg', [...QUIET, ...args, partial], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    rmSync(partial, { force: true });
    throw new Error(`no se pudo generar la muestra ${name}: ${result.stderr || result.error}`);
  }
  try {
    renameSync(partial, file);
  } catch {
    /* Otra prueba la generó a la vez: vale la suya. */
    rmSync(partial, { force: true });
  }
  return file;
}

/** Tiempos de presentación de los fotogramas clave del vídeo, según ffprobe (en segundos). */
export function probeKeyframes(file: string): number[] {
  const result = spawnSync(
    'ffprobe',
    [
      ...['-v', 'error', '-select_streams', 'v:0'],
      ...['-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file],
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`ffprobe: ${result.stderr}`);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.split(','))
    .filter((parts) => (parts[1] ?? '').startsWith('K'))
    .map((parts) => Number(parts[0]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

export interface ProbedStream {
  readonly index: number;
  readonly codecType: string;
  readonly codecName: string;
  readonly channels: number | null;
  readonly language: string | null;
  readonly title: string | null;
}

/** Pistas del fichero según ffprobe. */
export function probeStreams(file: string): ProbedStream[] {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=index,codec_type,codec_name,channels:stream_tags=language,title',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`ffprobe: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    streams: {
      index: number;
      codec_type: string;
      codec_name: string;
      channels?: number;
      tags?: { language?: string; title?: string };
    }[];
  };
  return parsed.streams.map((stream) => ({
    index: stream.index,
    codecType: stream.codec_type,
    codecName: stream.codec_name,
    channels: stream.channels ?? null,
    language: stream.tags?.language ?? null,
    title: stream.tags?.title ?? null,
  }));
}

/**
 * ffmpeg SIN bloquear el proceso (con `spawnSync` el relé y el proveedor
 * falsos, que viven en este mismo proceso, no podrían contestarle). Lo mata
 * al pasar `timeoutMs`: nunca deja un ffmpeg huérfano.
 */
export function runFfmpeg(
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: String(error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** Fotogramas de vídeo decodificados de un fichero (o de init + segmento), y los errores de ffmpeg. */
export function decodeCheck(file: string): { frames: number; errors: string } {
  const result = spawnSync(
    'ffprobe',
    [
      ...['-v', 'error', '-count_frames', '-select_streams', 'v:0'],
      ...['-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file],
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return { frames: Number(result.stdout.trim()) || 0, errors: result.stderr.trim() };
}

/** Lo mismo sin bloquear el proceso (el relé y el productor siguen atendiendo mientras). */
export function decodeCheckAsync(file: string): Promise<{ frames: number; errors: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      [
        ...['-v', 'error', '-count_frames', '-select_streams', 'v:0'],
        ...['-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file],
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let out = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    child.on('error', (error) => resolve({ frames: 0, errors: String(error) }));
    child.on('close', () => resolve({ frames: Number(out.trim()) || 0, errors: errors.trim() }));
  });
}
