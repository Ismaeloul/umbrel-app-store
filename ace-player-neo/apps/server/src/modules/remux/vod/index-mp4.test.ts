/* Índice MP4 (docs/vod.md §9.4 y §15.1) con ficheros construidos con el
   escritor de cajas del banco: `moov` al final o al principio, `ctts` con
   fotogramas B, lista de edición con la entrada VACÍA sumada (P1), sin
   `stss`, `mdat` de 64 bits o hasta el final, fragmentado, `moov` enorme y
   las pistas (avcC/hvcC, AAC con su esds, AC-3/E-AC-3 con sus canales,
   subtítulos tx3g). Con ffmpeg (@ffmpeg): la muestra con el moov al final
   y una con el vídeo retrasado 21 ms (entrada vacía de verdad) dan los
   fotogramas clave de ffprobe. */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { loopbackHost } from '../../../../test/fake-engine/test-utils.js';
import {
  ac3Entry,
  avc1Entry,
  buildMp4,
  ec3Entry,
  hvc1Entry,
  mp4aEntry,
  mp4vEntry,
  tx3gEntry,
  type Mp4Spec,
  type Mp4TrackSpec,
} from '../../../../test/fake-vod/mp4.js';
import { createFakeVodOrigin } from '../../../../test/fake-vod/origin.js';
import { createTestVodRelay } from '../../../../test/fake-vod/relay.js';
import {
  HAS_FFMPEG,
  ensureVodSample,
  probeKeyframes,
  probeStreams,
  runFfmpeg,
} from '../../../../test/fake-vod/samples.js';
import { readMp4Index } from './index-mp4.js';
import { createBufferReader, createHttpRangeReader } from './reader.js';

const HEAD = 256 * 1024;
const AVCC = Buffer.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x05, 0x67, 0x64, 0x00, 0x28, 0xac, 0x01, 0x00, 0x04,
  0x68, 0xee, 0x3c, 0x80, 0xfd, 0xf8, 0xf8, 0x00,
]);
const HVCC = Buffer.from([
  0x01, 0x02, 0x20, 0x00, 0x00, 0x00, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x78, 0xf0, 0x00, 0xfc,
  0xfd, 0xfa, 0xfa, 0x00, 0x00, 0x0f, 0x00,
]);
/* AAC-LC estéreo 48 kHz y HE-AAC (SBR explícito). */
const ASC_LC = Buffer.from([0x11, 0x90]);
const ASC_HE = Buffer.from([0x2b, 0x92, 0x08, 0x00]);

/* 60 s a 25 fps en escala 12 800 (512 por cuadro), clave cada 85 cuadros (3,4 s). */
const FRAMES = 1500;
const STSS = Array.from({ length: Math.ceil(FRAMES / 85) }, (_, i) => i * 85 + 1);

const VIDEO: Mp4TrackSpec = {
  kind: 'video',
  timescale: 12_800,
  sampleEntry: avc1Entry(AVCC, 1920, 800),
  stts: [[FRAMES, 512]],
  stss: STSS,
  duration: FRAMES * 512,
  width: 1920,
  height: 800,
};

/* Con 3 fotogramas B: la clave se presenta 2 cuadros después de decodificarse. */
const VIDEO_B: Mp4TrackSpec = {
  ...VIDEO,
  ctts: [[FRAMES, 1024]],
  elst: [{ segment: 60_000, mediaTime: 1024 }],
};

const AUDIO: readonly Mp4TrackSpec[] = [
  {
    kind: 'audio',
    timescale: 48_000,
    lang: 'spa',
    sampleEntry: mp4aEntry(ASC_LC, 2),
    stts: [[2813, 1024]],
  },
  {
    kind: 'audio',
    timescale: 48_000,
    lang: 'eng',
    enabled: false,
    name: 'Comentarios',
    sampleEntry: ac3Entry(7, 1),
    stts: [[1875, 1536]],
  },
  {
    kind: 'audio',
    timescale: 48_000,
    lang: 'fra',
    enabled: false,
    sampleEntry: ec3Entry(7, 1, 1),
    stts: [[1875, 1536]],
  },
  {
    kind: 'audio',
    timescale: 48_000,
    enabled: false,
    sampleEntry: mp4aEntry(ASC_HE, 2),
    stts: [[10, 2048]],
  },
];

const expectedKeyframes = (shiftS = 0): number[] =>
  STSS.map((s) => ((s - 1) * 512) / 12_800 + shiftS);

async function indexOf(data: Buffer) {
  const reads: { start: number; end: number }[] = [];
  const reader = createBufferReader(data, reads);
  const head = await reader.read(0, HEAD - 1);
  return { index: await readMp4Index(reader, head), reads };
}

async function failure(spec: Mp4Spec): Promise<AppError> {
  try {
    await indexOf(buildMp4(spec));
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('debía fallar');
}

function close(actual: Float64Array, expected: readonly number[], tolerance = 1e-9): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, i) =>
    expect(Math.abs((actual[i] as number) - value)).toBeLessThan(tolerance),
  );
}

describe('readMp4Index con MP4 construidos', () => {
  it('moov al final, tras un mdat grande: 2 lecturas, fotogramas clave, duración y pistas', async () => {
    const { index, reads } = await indexOf(
      buildMp4({ tracks: [VIDEO, ...AUDIO], moovAtEnd: true, mdatBytes: 2_000_000 }),
    );
    expect(index.container).toBe('mp4');
    close(index.keyframes, expectedKeyframes());
    expect(index.durationS).toBe(60);
    expect(index.video).toEqual({
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 800,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    });
    expect(index.audio).toEqual([
      {
        index: 0,
        codec: 'aac',
        aacLc: true,
        channels: 2,
        lang: 'spa',
        name: null,
        isDefault: true,
      },
      {
        index: 1,
        codec: 'ac3',
        aacLc: false,
        channels: 6,
        lang: 'eng',
        name: 'Comentarios',
        isDefault: false,
      },
      {
        index: 2,
        codec: 'eac3',
        aacLc: false,
        channels: 8,
        lang: 'fra',
        name: null,
        isDefault: false,
      },
      {
        index: 3,
        codec: 'aac',
        aacLc: false,
        channels: 2,
        lang: null,
        name: null,
        isDefault: false,
      },
    ]);
    expect(reads).toHaveLength(2);
  });

  it('moov al principio (faststart): una sola lectura', async () => {
    const { index, reads } = await indexOf(buildMp4({ tracks: [VIDEO, ...AUDIO.slice(0, 1)] }));
    close(index.keyframes, expectedKeyframes());
    expect(reads).toHaveLength(1);
  });

  it('fotogramas B: ctts y la lista de edición dejan la clave donde la presenta ffprobe', async () => {
    const { index } = await indexOf(buildMp4({ tracks: [VIDEO_B], moovAtEnd: true }));
    close(index.keyframes, expectedKeyframes());
    expect(index.durationS).toBe(60);
  });

  it('una entrada VACÍA en la lista de edición retrasa los fotogramas clave (P1)', async () => {
    const { index } = await indexOf(
      buildMp4({
        movieTimescale: 1000,
        tracks: [
          {
            ...VIDEO_B,
            elst: [
              { segment: 21, mediaTime: -1 },
              { segment: 60_000, mediaTime: 1024 },
            ],
          },
        ],
      }),
    );
    close(index.keyframes, expectedKeyframes(0.021));
  });

  it('elst y ctts de versión 1 (64 bits y con signo)', async () => {
    const { index } = await indexOf(
      buildMp4({
        movieTimescale: 90_000,
        tracks: [
          {
            ...VIDEO,
            mdhdVersion: 1,
            cttsVersion: 1,
            ctts: [[FRAMES, 512]],
            elstVersion: 1,
            elst: [
              { segment: 45_000, mediaTime: -1 },
              { segment: 5_400_000, mediaTime: 512 },
            ],
          },
        ],
      }),
    );
    close(index.keyframes, expectedKeyframes(0.5));
  });

  it('sin stss todas las muestras son clave', async () => {
    const { index } = await indexOf(
      buildMp4({ tracks: [{ ...VIDEO, stss: undefined, stts: [[50, 6400]] }] }),
    );
    expect(index.keyframes.length).toBe(50);
    expect(index.keyframes[1]).toBe(0.5);
  });

  it('mdat de 64 bits y una caja free antes del moov', async () => {
    const { index, reads } = await indexOf(
      buildMp4({
        tracks: [VIDEO],
        moovAtEnd: true,
        largeMdat: true,
        freeBytes: 5000,
        mdatBytes: 600_000,
      }),
    );
    close(index.keyframes, expectedKeyframes());
    expect(reads).toHaveLength(2);
  });

  it('HEVC Main 10 desde el hvcC; MPEG-4 parte 2; subtítulos tx3g', async () => {
    const { index } = await indexOf(
      buildMp4({
        tracks: [
          { ...VIDEO, sampleEntry: hvc1Entry(HVCC) },
          {
            kind: 'subtitle',
            timescale: 1000,
            lang: 'spa',
            sampleEntry: tx3gEntry(),
            stts: [[2, 1000]],
          },
        ],
      }),
    );
    expect(index.video).toMatchObject({
      codec: 'hevc',
      codecs: 'hvc1.2.4.L120.B0',
      bitDepth: 10,
      profile: 2,
    });
    expect(index.subtitles).toEqual([
      {
        index: 0,
        codec: 'mov_text',
        text: true,
        lang: 'spa',
        name: null,
        isDefault: true,
        forced: false,
      },
    ]);
    const mp4v = await indexOf(buildMp4({ tracks: [{ ...VIDEO, sampleEntry: mp4vEntry() }] }));
    expect(mp4v.index.video.codec).toBe('mpeg4');
  });

  it('fragmentado (mvex o moof) → vod_unsupported índice', async () => {
    expect((await failure({ tracks: [VIDEO], fragmented: 'mvex' })).data).toEqual({
      reason: 'indice',
    });
    expect((await failure({ tracks: [VIDEO], fragmented: 'moof', moovAtEnd: true })).data).toEqual({
      reason: 'indice',
    });
  });

  it('mdat hasta el final sin moov delante → índice; sin vídeo → video', async () => {
    expect((await failure({ tracks: [VIDEO], mdatToEof: true })).data).toEqual({
      reason: 'indice',
    });
    expect((await failure({ tracks: AUDIO })).data).toEqual({ reason: 'video' });
  });

  it('moov de más de 32 MiB → índice sin leerlo', async () => {
    const file = buildMp4({ tracks: [VIDEO], moovAtEnd: true });
    /* El moov es la última caja: se cambia su tamaño por 40 MiB. */
    let pos = 0;
    while (file.toString('latin1', pos + 4, pos + 8) !== 'moov') pos += file.readUInt32BE(pos);
    file.writeUInt32BE(40 * 1024 * 1024, pos);
    const reads: { start: number; end: number }[] = [];
    const reader = createBufferReader(file, reads);
    const error = await readMp4Index(reader, await reader.read(0, HEAD - 1)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).data).toEqual({ reason: 'indice' });
    expect(reads).toHaveLength(1);
  });
});

describe.skipIf(!HAS_FFMPEG)('readMp4Index con MP4 de ffmpeg (@ffmpeg)', () => {
  let host: string;
  let work: string;
  beforeAll(async () => {
    host = await loopbackHost();
    work = mkdtempSync(path.join(os.tmpdir(), 'ace-index-mp4-'));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  async function viaRelay(file: string) {
    const origin = await createFakeVodOrigin(host, { '3.mp4': file });
    closers.push(() => origin.close());
    const relay = await createTestVodRelay(host, origin.url('3.mp4'), 'mp4');
    closers.push(() => relay.close());
    const reader = createHttpRangeReader(relay.inputUrl);
    const index = await readMp4Index(reader, await reader.read(0, HEAD - 1));
    return { index, relay };
  }

  it('mp4-moov-end: fotogramas clave y pistas de ffprobe, en ≤ 3 peticiones', async () => {
    const file = ensureVodSample('mp4-moov-end');
    const { index, relay } = await viaRelay(file);
    close(index.keyframes, probeKeyframes(file), 1e-6);
    const audio = probeStreams(file).filter((s) => s.codecType === 'audio');
    expect(index.audio.map((a) => [a.codec, a.aacLc, a.channels, a.lang])).toEqual(
      audio.map((s) => [s.codecName, true, s.channels, s.language]),
    );
    expect(index.durationS).toBeCloseTo(60, 1);
    expect(index.sizeBytes).toBe(statSync(file).size);
    expect(relay.stats.requests).toBeLessThanOrEqual(3);
  });

  it('vídeo retrasado 21 ms (entrada vacía de verdad, P1): los de ffprobe', async () => {
    const sample = ensureVodSample('mp4-moov-end');
    const delayed = path.join(work, 'retrasado.mp4');
    const result = await runFfmpeg([
      ...['-loglevel', 'error', '-y', '-itsoffset', '0.021', '-i', sample, '-i', sample],
      ...['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', delayed],
    ]);
    expect(result.code, result.stderr).toBe(0);
    const { index } = await viaRelay(delayed);
    const expected = probeKeyframes(delayed);
    expect(expected[0]).toBeGreaterThan(0.02);
    close(index.keyframes, expected, 1e-6);
  });
});
