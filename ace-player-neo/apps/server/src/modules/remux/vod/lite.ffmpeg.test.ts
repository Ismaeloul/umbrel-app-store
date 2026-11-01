/* El trabajo ligero con el ffmpeg de verdad (docs/ver-juntos.md §17). Se salta
   sin ffmpeg en el PATH, como las demás pruebas con ffmpeg.

   - Una fuente 1080p H.264 CON fotogramas B (lo peor para los tiempos) y AAC.
   - La versión original como la saca el productor: vídeo y audio copiados,
     `-copyts` y los `movflags` del VOD, troceada en segmentos de ≥ 6 s.
   - Cada segmento, por `buildVodLiteArgs`: el ligero empieza donde el
     original (tiempo de presentación y `tfdt`, a menos de un fotograma), el
     init casa entre trabajos (`sameLiteInit`: el vídeo idéntico) y el
     segundo segmento se decodifica con el init del primero; el audio sale idéntico byte a byte. */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VOD_MOVFLAGS } from './args.js';
import { Fmp4Splitter, type Fmp4FragmentInfo, type Fmp4Init } from './fmp4.js';
import { LITE_FRAME_TOLERANCE_S, sameLiteInit, splitFmp4 } from './lite.js';
import { buildVodLiteArgs } from './lite-args.js';

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const QUIET = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];

/** Ejecuta ffmpeg con `input` por la entrada y devuelve su salida. */
function run(args: readonly string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString('utf8').slice(-600)}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? Buffer.alloc(0));
  });
}

interface Fragment {
  readonly info: Fmp4FragmentInfo;
  readonly bytes: Buffer;
}

/** Init y fragmentos de un fMP4 entero (con el troceador del productor). */
function fragmentsOf(data: Buffer): { init: Fmp4Init; fragments: Fragment[] } {
  let init: Fmp4Init | null = null;
  const fragments: { info: Fmp4FragmentInfo; parts: Buffer[] }[] = [];
  const splitter = new Fmp4Splitter({
    onInit: (value) => (init = value),
    onFragment: (info) => fragments.push({ info, parts: [] }),
    onData: (chunk) => fragments[fragments.length - 1]?.parts.push(Buffer.from(chunk)),
    onFragmentEnd: () => undefined,
  });
  splitter.push(data);
  splitter.end();
  if (!init) throw new Error('sin init');
  return {
    init,
    fragments: fragments.map((f) => ({ info: f.info, bytes: Buffer.concat(f.parts) })),
  };
}

/** El audio (ADTS) de un init + segmento. */
const audioOf = (init: Buffer, segment: Buffer): Promise<Buffer> =>
  run(
    [
      ...QUIET,
      '-f',
      'mp4',
      '-i',
      'pipe:0',
      '-map',
      '0:a:0',
      '-c:a',
      'copy',
      '-f',
      'adts',
      'pipe:1',
    ],
    Buffer.concat([init, segment]),
  );

describe.skipIf(!HAS_FFMPEG)('trabajo ligero con ffmpeg de verdad', () => {
  let dir = '';
  let copyInit: Fmp4Init;
  const segments: { bytes: Buffer; first: Fmp4FragmentInfo }[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ace-lite-'));
    const source = path.join(dir, 'fuente.mkv');
    /* 1080p24 con 3 fotogramas B y una clave cada 2 s; AAC-LC estéreo. */
    await run([
      ...QUIET,
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=40'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=40'],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-bf', '3', '-g', '48', '-keyint_min', '48'],
      ...['-sc_threshold', '0', '-pix_fmt', 'yuv420p'],
      ...['-c:a', 'aac', '-b:a', '128k', '-ac', '2'],
      source,
    ]);
    /* La versión original, como la sacaría el productor (vod/args.ts). */
    const copy = await run([
      ...QUIET,
      ...['-i', source, '-map', '0:v:0', '-c:v', 'copy', '-map', '0:a:0', '-c:a', 'copy'],
      ...['-copyts', '-movflags', VOD_MOVFLAGS, '-f', 'mp4', 'pipe:1'],
    ]);
    const parsed = fragmentsOf(copy);
    copyInit = parsed.init;
    /* Segmentos de ≥ 6 s sobre los fragmentos (cada uno empieza en su clave). */
    let current: Fragment[] = [];
    let startS = 0;
    for (const fragment of parsed.fragments) {
      const at = fragment.info.startS ?? 0;
      if (current.length && at - startS >= 6) {
        segments.push({
          bytes: Buffer.concat(current.map((f) => f.bytes)),
          first: (current[0] as Fragment).info,
        });
        current = [];
      }
      if (!current.length) startS = at;
      current.push(fragment);
    }
    if (current.length) {
      segments.push({
        bytes: Buffer.concat(current.map((f) => f.bytes)),
        first: (current[0] as Fragment).info,
      });
    }
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('el ligero empieza donde el original, con el mismo init y el mismo audio (N = 0 y N = 5)', async () => {
    expect(segments.length).toBeGreaterThanOrEqual(6);
    const inits: Fmp4Init[] = [];
    const medias: Buffer[] = [];
    for (const n of [0, 5]) {
      const segment = segments[n] as (typeof segments)[number];
      const lite = await run(
        buildVodLiteArgs({ sessionId: 's_prueba' }),
        Buffer.concat([copyInit.bytes, segment.bytes]),
      );
      const split = splitFmp4(lite);
      inits.push(split.init);
      medias.push(split.media);
      const first = split.first;
      expect(first.firstIsSync).toBe(true);
      expect(Math.abs((first.startS ?? NaN) - (segment.first.startS ?? NaN))).toBeLessThanOrEqual(
        LITE_FRAME_TOLERANCE_S,
      );
      expect(Math.abs((first.decodeS ?? NaN) - (segment.first.startS ?? NaN))).toBeLessThanOrEqual(
        LITE_FRAME_TOLERANCE_S,
      );
      /* La misma duración de vídeo (el mismo trozo de película). */
      const copyDuration = fragmentsOf(Buffer.concat([copyInit.bytes, segment.bytes]))
        .fragments.map((f) => f.info.durationS)
        .reduce((a, b) => a + b, 0);
      const liteDuration = fragmentsOf(lite)
        .fragments.map((f) => f.info.durationS)
        .reduce((a, b) => a + b, 0);
      expect(Math.abs(liteDuration - copyDuration)).toBeLessThanOrEqual(LITE_FRAME_TOLERANCE_S);
      /* El audio, copiado tal cual. */
      const copyAudio = await audioOf(copyInit.bytes, segment.bytes);
      const liteAudio = await audioOf(split.init.bytes, split.media);
      expect(liteAudio.equals(copyAudio)).toBe(true);
    }
    const [a, b] = inits as [Fmp4Init, Fmp4Init];
    /* El vídeo, idéntico; el audio solo cambia en los caudales que ffmpeg mide en cada trabajo. */
    expect(a.video?.stsd.equals(b.video?.stsd ?? Buffer.alloc(0))).toBe(true);
    expect(sameLiteInit(a, b)).toBe(true);
    /* El segmento del segundo trabajo se decodifica con el init del primero (`lo_init.mp4`). */
    await run(
      [...QUIET, '-xerror', '-f', 'mp4', '-i', 'pipe:0', '-f', 'null', '-'],
      Buffer.concat([a.bytes, medias[1] as Buffer]),
    );
    /* 720p de verdad. */
    const probe = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        '-',
      ],
      { input: a.bytes },
    );
    if (probe.status === 0) expect(probe.stdout.toString().trim()).toBe('1280,720');
  }, 120_000);
});
