/* Lo que hay DENTRO de cada segmento del remux (init.mp4 + index<N>.m4s por
   ffprobe): primer y último DTS de vídeo y de audio y los huecos. Así se ve
   si el remux deja agujeros de vídeo o de audio (un empalme del relé, un
   salto de tiempos del proveedor…) aunque la lista diga que todo va bien. */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface SegmentProbe {
  readonly name: string;
  readonly v: readonly [number, number] | null;
  readonly a: readonly [number, number] | null;
  /** Huecos dentro del segmento (> 0,15 s) o DTS que van hacia atrás. */
  readonly holes: readonly { readonly track: 'v' | 'a'; readonly from: number; readonly to: number }[];
  readonly vFrames: number;
  readonly keyFirst: boolean | null;
}

function run(cmd: string, args: string[], input: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.once('error', () => resolve(''));
    child.once('exit', () => resolve(out));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

export async function probeSegment(dir: string, name: string): Promise<SegmentProbe | null> {
  let data: Buffer;
  try {
    data = Buffer.concat([readFileSync(path.join(dir, 'init.mp4')), readFileSync(path.join(dir, name))]);
  } catch {
    return null;
  }
  const out = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'packet=stream_index,dts_time,flags', '-of', 'csv=p=0', '-i', 'pipe:0'],
    data,
  );
  /* init.mp4 de ffmpeg: vídeo en el índice 0 y audio en el 1 (`-map 0:v:0 -map 0:a:0?`). */
  const v: number[] = [];
  const a: number[] = [];
  let keyFirst: boolean | null = null;
  for (const line of out.split('\n')) {
    const [idx, dts, flags] = line.split(',');
    const t = Number(dts);
    if (!Number.isFinite(t)) continue;
    if (idx === '0') {
      if (keyFirst === null) keyFirst = (flags ?? '').includes('K');
      v.push(t);
    } else if (idx === '1') a.push(t);
  }
  const holes: { track: 'v' | 'a'; from: number; to: number }[] = [];
  const scan = (list: number[], track: 'v' | 'a', max: number): void => {
    for (let i = 1; i < list.length; i += 1) {
      const d = (list[i] as number) - (list[i - 1] as number);
      if (d > max || d < -0.001) holes.push({ track, from: list[i - 1] as number, to: list[i] as number });
    }
  };
  scan(v, 'v', 0.15);
  scan(a, 'a', 0.15);
  const range = (list: number[]): [number, number] | null =>
    list.length ? [Math.min(...list), Math.max(...list)] : null;
  return { name, v: range(v), a: range(a), holes, vFrames: v.length, keyFirst };
}
