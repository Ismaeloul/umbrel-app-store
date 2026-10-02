/* Clips de origen del laboratorio IPTV (scripts/iptv-lab/README.md).

   Se codifican UNA vez con ffmpeg (sin prisa, no en tiempo real) y se guardan
   en la caché: luego el «proveedor» los emite en bucle a velocidad de directo
   con `-c copy`, así que emitir no gasta CPU y el Chrome del laboratorio tiene
   los 4 núcleos para decodificar.

   Lo que llevan:
   - vídeo H.264 High de verdad (testsrc2 en movimiento) con el GOP que se pida
     (2 s como un IPTV normal, 5-8 s en los casos difíciles), CBR con relleno
     (el caudal en la red es el de un canal real: 4-8 Mbit/s en 1080p) y
     B-frames;
   - audio AC-3 (lo más habitual en la IPTV española), E-AC-3, MP2 o AAC;
   - una TIRA DE CÓDIGO arriba a la izquierda: 18 bloques de 40×40 px. El
     primero siempre blanco, el último siempre negro y los 16 del medio son el
     número de fotograma del clip en binario (bit 0 primero). La página de
     pruebas la lee con un <canvas> y así sabe QUÉ trozo de la emisión se ve
     en cada momento, aunque el remux reinicie sus tiempos: un salto atrás en
     el contenido (se repite lo ya visto) o adelante (se pierde imagen) se ve
     sin depender de `currentTime`. */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

export type AudioCodec = 'ac3' | 'eac3' | 'aac' | 'mp2';

export interface ClipSpec {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Segundos entre fotogramas clave (GOP fijo, sin cortes de escena). */
  readonly gopS: number;
  readonly videoKbps: number;
  readonly audio: AudioCodec;
  /** Duración del clip (se emite en bucle). */
  readonly seconds: number;
  /** Entrelazado (x264 MBAFF, tff), como muchas cadenas de TDT en 1080i/576i. */
  readonly interlaced?: boolean;
  /** GOP abierto (I no IDR con B delante), como algunos codificadores de emisión. */
  readonly openGop?: boolean;
}

/** Geometría de la tira de código (la misma en clips.ts y en la página). */
export const CODE = { blocks: 18, blockPx: 40, heightPx: 40 } as const;

export function describeClip(spec: ClipSpec): string {
  return `${spec.width}x${spec.height}${spec.interlaced ? 'i' : 'p'}${spec.fps} GOP ${spec.gopS}s ${spec.videoKbps} kbit/s ${spec.audio}${spec.openGop ? ' GOP abierto' : ''}`;
}

export function clipFile(cacheDir: string, spec: ClipSpec): string {
  const key = createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  const name = `clip-${spec.width}x${spec.height}-${spec.fps}-g${spec.gopS}-${spec.videoKbps}k-${spec.audio}${spec.interlaced ? '-i' : ''}${spec.openGop ? '-open' : ''}-${spec.seconds}s-${key}.ts`;
  return path.join(cacheDir, name);
}

function audioArgs(codec: AudioCodec): string[] {
  switch (codec) {
    case 'ac3':
      return ['-c:a', 'ac3', '-b:a', '384k'];
    case 'eac3':
      return ['-c:a', 'eac3', '-b:a', '256k'];
    case 'mp2':
      return ['-c:a', 'mp2', '-b:a', '256k'];
    case 'aac':
      return ['-c:a', 'aac', '-b:a', '128k'];
  }
}

/** La tira: blanco, 16 bits del número de fotograma y negro. */
function codeFilter(): string {
  const { blockPx: b, blocks } = CODE;
  const last = (blocks - 1) * b;
  return `geq=lum='if(lt(X,${b}),235,if(gte(X,${last}),16,if(mod(floor(N/pow(2,floor(X/${b})-1)),2),235,16)))'`;
}

export function clipArgs(spec: ClipSpec, out: string): string[] {
  const gop = Math.max(1, Math.round(spec.gopS * spec.fps));
  const k = spec.videoKbps;
  const x264: string[] = ['nal-hrd=cbr', 'force-cfr=1'];
  if (spec.openGop) x264.push('open-gop=1');
  if (spec.interlaced) x264.push('tff=1');
  const codeW = CODE.blocks * CODE.blockPx;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}:duration=${spec.seconds}`,
    '-f',
    'lavfi',
    '-i',
    `color=c=black:size=${codeW}x${CODE.heightPx}:rate=${spec.fps}:duration=${spec.seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:beep_factor=4:sample_rate=48000:duration=${spec.seconds}`,
    '-filter_complex',
    `[1:v]format=gray,${codeFilter()}[code];[0:v][code]overlay=0:0:shortest=1,format=yuv420p${spec.interlaced ? ',setfield=tff' : ''}[v]`,
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    '-level:v',
    '4.1',
    '-g',
    String(gop),
    '-keyint_min',
    String(gop),
    '-sc_threshold',
    '0',
    '-bf',
    '2',
    ...(spec.interlaced ? ['-flags', '+ildct+ilme'] : []),
    '-b:v',
    `${k}k`,
    '-minrate',
    `${k}k`,
    '-maxrate',
    `${k}k`,
    '-bufsize',
    `${Math.round(k / 2)}k`,
    '-x264-params',
    x264.join(':'),
    '-ac',
    '2',
    ...audioArgs(spec.audio),
    '-f',
    'mpegts',
    out,
  ];
}

/** El clip de la caché (lo codifica si no está). */
export async function ensureClip(
  cacheDir: string,
  spec: ClipSpec,
  log: (line: string) => void = () => undefined,
): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const file = clipFile(cacheDir, spec);
  if (existsSync(file) && statSync(file).size > 0) return file;
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  log(
    `codificando el clip ${describeClip(spec)} (${spec.seconds} s): una sola vez, queda en ${cacheDir}`,
  );
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', clipArgs(spec, tmp), { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg (clip) terminó con ${code}: ${err.slice(-800)}`));
    });
  });
  renameSync(tmp, file);
  log(`clip listo en ${((Date.now() - started) / 1000).toFixed(0)} s: ${path.basename(file)}`);
  return file;
}
