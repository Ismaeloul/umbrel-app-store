/* Índice MKV (docs/vod.md §9.4 y §15.1). Con ficheros construidos aquí con
   el escritor EBML del banco (test/fake-vod/ebml.ts): SeekHead que apunta a
   otro al final, Segment y Cluster de tamaño desconocido, relleno que deja
   Tracks fuera de la cabecera, sin Cues, lenguas por defecto y BCP 47. Y con
   ffmpeg (@ffmpeg): las muestras de verdad, leídas por el relé de prueba,
   dan exactamente los fotogramas clave y las pistas de ffprobe en 2-3
   peticiones. */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { AppError } from '../../../core/errors.js';
import { loopbackHost } from '../../../../test/fake-engine/test-utils.js';
import { buildMkv, type MkvSpec, type MkvTrackSpec } from '../../../../test/fake-vod/ebml.js';
import { createFakeVodOrigin } from '../../../../test/fake-vod/origin.js';
import { createTestVodRelay } from '../../../../test/fake-vod/relay.js';
import {
  HAS_FFMPEG,
  ensureVodSample,
  probeKeyframes,
  probeStreams,
  type VodSampleName,
} from '../../../../test/fake-vod/samples.js';
import { MKV_HEAD_BYTES, readMkvIndex } from './index-mkv.js';
import { createBufferReader, createHttpRangeReader } from './reader.js';
import type { RangeReader } from './types.js';

/* avcC High 4.0 de 8 bits 4:2:0 y hvcC Main (los de codecs.test.ts). */
const AVCC = Buffer.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x05, 0x67, 0x64, 0x00, 0x28, 0xac, 0x01, 0x00, 0x04,
  0x68, 0xee, 0x3c, 0x80, 0xfd, 0xf8, 0xf8, 0x00,
]);
const HVCC = Buffer.from([
  0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5a, 0xf0, 0x00, 0xfc,
  0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 0x00,
]);
const ASC_LC = Buffer.from([0x11, 0x90]);

const VIDEO: MkvTrackSpec = {
  number: 1,
  type: 'video',
  codecId: 'V_MPEG4/ISO/AVC',
  codecPrivate: AVCC,
  language: 'und',
  width: 1920,
  height: 800,
};

const TRACKS: readonly MkvTrackSpec[] = [
  VIDEO,
  { number: 2, type: 'audio', codecId: 'A_AC3', language: 'spa', channels: 6, flagDefault: 1 },
  {
    number: 3,
    type: 'audio',
    codecId: 'A_AAC',
    codecPrivate: ASC_LC,
    language: 'eng',
    name: 'Comentarios del director',
    channels: 2,
    flagDefault: 0,
  },
  { number: 4, type: 'audio', codecId: 'A_AAC/MPEG4/LC/SBR', language: 'fre', channels: 2 },
  { number: 5, type: 'subtitle', codecId: 'S_TEXT/UTF8', language: 'spa', flagForced: 1 },
  { number: 6, type: 'subtitle', codecId: 'S_HDMV/PGS', bcp47: 'es-419', language: 'spa' },
];

/** Cues cada 2,5 s de vídeo con puntos del audio en medio (que no cuentan). */
function cues(count: number, step = 2_500): MkvSpec['cues'] {
  const out: { time: number; track: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ time: i * step, track: 1 });
    out.push({ time: i * step + 1_000, track: 2 });
  }
  return out;
}

function counted(data: Buffer): { reader: RangeReader; reads: { start: number; end: number }[] } {
  const reads: { start: number; end: number }[] = [];
  return { reader: createBufferReader(data, reads), reads };
}

async function indexOf(data: Buffer) {
  const { reader, reads } = counted(data);
  const head = await reader.read(0, MKV_HEAD_BYTES - 1);
  const index = await readMkvIndex(reader, head);
  return { index, reads };
}

async function failure(data: Buffer): Promise<AppError> {
  try {
    await indexOf(data);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('debía fallar');
}

describe('readMkvIndex con MKV construidos', () => {
  it('lo normal: fotogramas clave del vídeo, duración, pistas y lenguas', async () => {
    const { index, reads } = await indexOf(
      buildMkv({ tracks: TRACKS, cues: cues(24), duration: 60_000 }),
    );
    expect(index.container).toBe('mkv');
    expect(Array.from(index.keyframes)).toEqual(Array.from({ length: 24 }, (_, i) => i * 2.5));
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
        codec: 'ac3',
        aacLc: false,
        channels: 6,
        lang: 'spa',
        name: null,
        isDefault: true,
      },
      {
        index: 1,
        codec: 'aac',
        aacLc: true,
        channels: 2,
        lang: 'eng',
        name: 'Comentarios del director',
        isDefault: false,
      },
      /* HE-AAC (LC/SBR): no se copia (P8); sin FlagDefault vale 1 (la norma). */
      {
        index: 2,
        codec: 'aac',
        aacLc: false,
        channels: 2,
        lang: 'fre',
        name: null,
        isDefault: true,
      },
    ]);
    expect(index.subtitles).toEqual([
      {
        index: 0,
        codec: 'subrip',
        text: true,
        lang: 'spa',
        name: null,
        isDefault: true,
        forced: true,
      },
      {
        index: 1,
        codec: 'hdmv_pgs_subtitle',
        text: false,
        lang: 'es-419',
        name: null,
        isDefault: true,
        forced: false,
      },
    ]);
    /* La cabecera lo trae todo menos los Cues: 2 lecturas. */
    expect(reads).toHaveLength(2);
  });

  it('sin Language la norma dice inglés; und no es una lengua', async () => {
    const { index } = await indexOf(
      buildMkv({
        tracks: [
          VIDEO,
          { number: 2, type: 'audio', codecId: 'A_DTS', channels: 6 },
          { number: 3, type: 'audio', codecId: 'A_TRUEHD', language: 'und' },
        ],
        cues: cues(4),
      }),
    );
    expect(index.audio.map((track) => [track.codec, track.lang, track.channels])).toEqual([
      ['dts', 'eng', 6],
      ['truehd', null, 1],
    ]);
  });

  it('SeekHead que apunta a otro al final (con los Cues), Segment y Cluster de tamaño desconocido', async () => {
    const { index, reads } = await indexOf(
      buildMkv({
        tracks: TRACKS,
        cues: cues(10),
        seekHeadAtEnd: true,
        unknownSegmentSize: true,
        unknownClusterSize: true,
        clusterBytes: 600_000,
      }),
    );
    expect(index.keyframes.length).toBe(10);
    expect(reads).toHaveLength(3);
  });

  it('Info y Tracks fuera de la cabecera (relleno grande): se leen por el SeekHead', async () => {
    const { index, reads } = await indexOf(
      buildMkv({ tracks: TRACKS, cues: cues(6), voidBytes: 400_000, clusterBytes: 1_000_000 }),
    );
    expect(index.audio).toHaveLength(3);
    expect(index.keyframes.length).toBe(6);
    expect(reads.length).toBeLessThanOrEqual(4);
  });

  it('TimestampScale que no es 1 ms y sin Duration (en directo)', async () => {
    const { index } = await indexOf(
      buildMkv({
        tracks: [VIDEO],
        scale: 100_000,
        duration: null,
        cues: [0, 20_020, 40_040].map((time) => ({ time, track: 1 })),
      }),
    );
    expect(Array.from(index.keyframes)).toEqual([0, 2.002, 4.004]);
    /* Sin duración: el último fotograma clave más el GOP mediano. */
    expect(index.durationS).toBeCloseTo(6.006, 6);
  });

  it('una pista de subtítulos que estira el contenedor no estira la película', async () => {
    const { index } = await indexOf(
      buildMkv({ tracks: [VIDEO], cues: cues(73, 2_500), duration: 600_000 }),
    );
    expect(index.durationS).toBeCloseTo(182.5, 6);
  });

  it('Cues más grandes que la primera ventana: una lectura más', async () => {
    const many = Array.from({ length: 40_000 }, (_, i) => ({ time: i * 2_000, track: 1 }));
    const { index, reads } = await indexOf(buildMkv({ tracks: [VIDEO], cues: many }));
    expect(index.keyframes.length).toBe(40_000);
    expect(reads).toHaveLength(3);
  });

  it('HEVC: hvc1 desde el hvcC; MPEG-4 parte 2 se apunta como mpeg4', async () => {
    const hevc = await indexOf(
      buildMkv({
        tracks: [{ ...VIDEO, codecId: 'V_MPEGH/ISO/HEVC', codecPrivate: HVCC }],
        cues: cues(3),
      }),
    );
    expect(hevc.index.video).toMatchObject({
      codec: 'hevc',
      codecs: 'hvc1.1.6.L90.90',
      profile: 1,
    });
    const asp = await indexOf(
      buildMkv({
        tracks: [{ ...VIDEO, codecId: 'V_MPEG4/ISO/ASP', codecPrivate: undefined }],
        cues: cues(3),
      }),
    );
    expect(asp.index.video.codec).toBe('mpeg4');
    const naked = await indexOf(
      buildMkv({ tracks: [{ ...VIDEO, codecPrivate: undefined }], cues: cues(3) }),
    );
    expect(naked.index.video.codec).toBe('h264-sin-config');
  });

  it('sin Cues → vod_unsupported índice', async () => {
    const error = await failure(buildMkv({ tracks: TRACKS, cues: [], noCues: true }));
    expect(error.code).toBe('vod_unsupported');
    expect(error.data).toEqual({ reason: 'indice' });
  });

  it('Cues sin la pista de vídeo → índice; sin vídeo → video; otro DocType → formato', async () => {
    expect(
      (await failure(buildMkv({ tracks: TRACKS, cues: [{ time: 0, track: 2 }] }))).data,
    ).toEqual({ reason: 'indice' });
    expect((await failure(buildMkv({ tracks: TRACKS.slice(1), cues: cues(2) }))).data).toEqual({
      reason: 'video',
    });
    expect(
      (await failure(buildMkv({ docType: 'otracosa', tracks: TRACKS, cues: cues(2) }))).data,
    ).toEqual({ reason: 'formato' });
  });
});

/* Las muestras de verdad, por el relé de prueba y el lector HTTP. */
describe.skipIf(!HAS_FFMPEG)('readMkvIndex con las muestras de ffmpeg (@ffmpeg)', () => {
  let host: string;
  beforeAll(async () => {
    host = await loopbackHost();
  });
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  const cases: readonly [VodSampleName, string, number][] = [
    ['mkv-h264-ac3', 'h264', 2],
    ['mkv-bframes', 'h264', 1],
    ['mkv-hevc', 'hevc', 1],
  ];
  for (const [name, codec, audioTracks] of cases) {
    it(`${name}: los mismos fotogramas clave y pistas que ffprobe, en ≤ 3 peticiones`, async () => {
      const file = ensureVodSample(name);
      const origin = await createFakeVodOrigin(host, { '9.mkv': file });
      closers.push(() => origin.close());
      const relay = await createTestVodRelay(host, origin.url('9.mkv'), 'mkv');
      closers.push(() => relay.close());
      const reader = createHttpRangeReader(relay.inputUrl);
      const head = await reader.read(0, MKV_HEAD_BYTES - 1);
      const index = await readMkvIndex(reader, head);

      const expected = probeKeyframes(file);
      expect(index.keyframes.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i += 1) {
        expect(Math.abs((index.keyframes[i] as number) - (expected[i] as number))).toBeLessThan(
          1e-6,
        );
      }
      expect(index.durationS).toBeGreaterThan(59);
      expect(index.durationS).toBeLessThan(61);
      expect(index.video.codec).toBe(codec);
      expect(index.video.width).toBe(320);
      expect(index.video.height).toBe(180);
      const streams = probeStreams(file).filter((s) => s.codecType === 'audio');
      expect(index.audio).toHaveLength(audioTracks);
      expect(index.audio.map((a) => [a.codec, a.channels, a.lang ?? null, a.name])).toEqual(
        streams.map((s) => [s.codecName, s.channels, s.language, s.title]),
      );
      expect(index.sizeBytes).toBe(statSync(file).size);
      expect(relay.stats.requests).toBeLessThanOrEqual(3);
      expect(origin.stats.bytesSent).toBeLessThan(MKV_HEAD_BYTES + 600 * 1024);
    });
  }

  it('mkv-h264-ac3: el SRT sale como subtítulo de texto en castellano', async () => {
    const file = ensureVodSample('mkv-h264-ac3');
    const data = readFileSync(file);
    const { reader } = counted(data);
    const index = await readMkvIndex(reader, await reader.read(0, MKV_HEAD_BYTES - 1));
    expect(index.subtitles).toEqual([
      expect.objectContaining({ codec: 'subrip', text: true, lang: 'spa' }),
    ]);
    expect(index.video.codecs).toMatch(/^avc1\.42c0/);
  });
});
