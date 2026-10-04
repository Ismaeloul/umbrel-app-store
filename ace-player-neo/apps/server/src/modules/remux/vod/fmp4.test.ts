/* Troceador fMP4 en streaming (docs/vod.md §9.7 y §15.1): cortes de trozo
   (hasta de 1 byte), tamaños de 64 bits, `tfdt` v0 y v1, `tfdt` v1 NEGATIVO
   del audio (P2), tiempo de presentación con el desfase de los fotogramas B
   y la lista de edición (P4), cajas que se saltan y salidas cortadas. Con
   ffmpeg (@ffmpeg): lo que sale de un ffmpeg de verdad se trocea igual que
   lo lee el lector de referencia del banco (test/fake-vod/boxes.ts). */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { fragmentStartS, readFmp4 } from '../../../../test/fake-vod/boxes.js';
import {
  box,
  initSegment,
  mediaFragment,
  type FragTrackSpec,
} from '../../../../test/fake-vod/mp4.js';
import { HAS_FFMPEG, ensureVodSample, runFfmpeg } from '../../../../test/fake-vod/samples.js';
import {
  Fmp4Splitter,
  parseInit,
  sameCodecs,
  type Fmp4FragmentInfo,
  type Fmp4Init,
} from './fmp4.js';

const TRACKS: readonly FragTrackSpec[] = [
  { id: 1, handler: 'vide', timescale: 16_000, elstMediaTime: 1280 },
  { id: 2, handler: 'soun', timescale: 48_000 },
];

/* Tres GOP de 2 s con fotogramas B (desfase 1280 = 0,08 s) y su audio; el
   primer audio empieza en −1024 (P2). */
function stream(options: { largeMdat?: boolean; tfdtVersion?: 0 | 1 } = {}): {
  init: Buffer;
  fragments: Buffer[];
} {
  const init = initSegment(TRACKS);
  const fragments = [0, 1, 2].map((i) =>
    mediaFragment(
      i + 1,
      [
        {
          id: 1,
          tfdt: i * 32_000,
          tfdtVersion: options.tfdtVersion ?? 1,
          samples: 50,
          sampleDuration: 640,
          cto: 1280,
          bytes: 30_000 + i,
        },
        {
          id: 2,
          tfdt: i === 0 ? -1024 : i * 96_000,
          samples: 94,
          sampleDuration: 1024,
          bytes: 4_000,
        },
      ],
      { largeMdat: options.largeMdat ?? false },
    ),
  );
  return { init, fragments };
}

interface Recorded {
  inits: Fmp4Init[];
  infos: Fmp4FragmentInfo[];
  fragments: Buffer[];
  ends: number;
}

function record(): { splitter: Fmp4Splitter; out: Recorded } {
  const out: Recorded = { inits: [], infos: [], fragments: [], ends: 0 };
  let current: Buffer[] = [];
  const splitter = new Fmp4Splitter({
    onInit: (init) => out.inits.push(init),
    onFragment: (info) => {
      out.infos.push(info);
      current = [];
    },
    onData: (chunk) => current.push(Buffer.from(chunk)),
    onFragmentEnd: () => {
      out.fragments.push(Buffer.concat(current));
      out.ends += 1;
    },
  });
  return { splitter, out };
}

function feed(data: Buffer, sizes: (i: number) => number): Recorded {
  const { splitter, out } = record();
  let pos = 0;
  for (let i = 0; pos < data.length; i += 1) {
    const size = Math.max(1, sizes(i));
    splitter.push(data.subarray(pos, pos + size));
    pos += size;
  }
  splitter.end();
  return out;
}

function failure(run: () => void): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('debía fallar');
}

describe('Fmp4Splitter', () => {
  const { init, fragments } = stream();
  const whole = Buffer.concat([init, ...fragments, box('mfra', Buffer.alloc(16))]);

  it('init, tres fragmentos con su tiempo de presentación y sus bytes tal cual', () => {
    const out = feed(whole, () => whole.length);
    expect(out.inits).toHaveLength(1);
    expect(out.inits[0]?.bytes.equals(init)).toBe(true);
    expect(out.inits[0]?.video).toMatchObject({
      id: 1,
      handler: 'vide',
      timescale: 16_000,
      elstMediaTime: 1280,
    });
    expect(
      out.infos.map((info) => [info.sequence, info.startS, info.durationS, info.firstIsSync]),
    ).toEqual([
      [1, 0, 2, true],
      [2, 2, 2, true],
      [3, 4, 2, true],
    ]);
    /* tfdt (decodificación) va 0,08 s por delante en el tiempo de presentación. */
    expect(out.infos[1]?.decodeS).toBe(2);
    expect(out.fragments.map((f, i) => f.equals(fragments[i] as Buffer))).toEqual([
      true,
      true,
      true,
    ]);
    expect(out.ends).toBe(3);
  });

  it('da igual cómo lleguen los trozos (de 1 byte, de 7, al azar)', () => {
    const reference = feed(whole, () => whole.length);
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return 1 + (seed % 5000);
    };
    for (const sizes of [() => 1, () => 7, () => 4096, random]) {
      const out = feed(whole, sizes);
      expect(out.infos).toEqual(reference.infos);
      expect(out.fragments.map((f) => f.length)).toEqual(reference.fragments.map((f) => f.length));
      expect(Buffer.concat(out.fragments).equals(Buffer.concat(reference.fragments))).toBe(true);
    }
  });

  it('mdat de 64 bits y tfdt v0', () => {
    const large = stream({ largeMdat: true, tfdtVersion: 0 });
    const out = feed(Buffer.concat([large.init, ...large.fragments]), () => 1000);
    expect(out.infos.map((info) => info.startS)).toEqual([0, 2, 4]);
    expect(out.fragments[2]?.equals(large.fragments[2] as Buffer)).toBe(true);
  });

  it('el audio con tfdt v1 negativo (−1024) no mueve el fragmento: manda el vídeo (P2)', () => {
    const out = feed(whole, () => whole.length);
    expect(out.infos[0]?.startS).toBe(0);
    expect(out.infos[0]?.decodeS).toBe(0);
  });

  it('un vídeo con tfdt negativo de verdad se lee con signo', () => {
    const negative = mediaFragment(9, [
      { id: 1, tfdt: -640, samples: 2, sampleDuration: 640, cto: 1280, bytes: 10 },
    ]);
    const out = feed(Buffer.concat([init, negative]), () => 100);
    expect(out.infos[0]?.decodeS).toBe(-0.04);
    expect(out.infos[0]?.startS).toBe(-0.04);
  });

  it('se saltan styp, sidx, free y mfra; un mdat hasta el final acaba con end()', () => {
    const header = Buffer.alloc(8);
    header.write('mdat', 4, 'latin1');
    const fragment = fragments[0] as Buffer;
    const moofSize = fragment.readUInt32BE(0);
    const open = Buffer.concat([fragment.subarray(0, moofSize), header, Buffer.alloc(500, 9)]);
    const data = Buffer.concat([
      init,
      box('styp', Buffer.alloc(8)),
      box('sidx', Buffer.alloc(20)),
      box('free'),
      open,
    ]);
    const out = feed(data, () => 333);
    expect(out.ends).toBe(1);
    expect(out.fragments[0]?.length).toBe(moofSize + 8 + 500);
  });

  it('salidas rotas → vod_dropped', () => {
    expect(failure(() => record().splitter.push(fragments[0] as Buffer)).code).toBe('vod_dropped');
    const lone = Buffer.concat([init, box('mdat', Buffer.alloc(10))]);
    expect(failure(() => record().splitter.push(lone)).code).toBe('vod_dropped');
    const cut = Buffer.concat([init, (fragments[0] as Buffer).subarray(0, 2000)]);
    const { splitter } = record();
    splitter.push(cut);
    expect(failure(() => splitter.end()).code).toBe('vod_dropped');
    const huge = Buffer.alloc(16);
    huge.writeUInt32BE(64 * 1024 * 1024);
    huge.write('moov', 4, 'latin1');
    expect(failure(() => record().splitter.push(huge)).code).toBe('vod_dropped');
  });
});

describe('sameCodecs', () => {
  it('mismos stsd → compatibles; otro códec → no', () => {
    const a = parseInit(initSegment(TRACKS));
    expect(sameCodecs(a, parseInit(initSegment(TRACKS)))).toBe(true);
    const hevc = parseInit(
      initSegment([
        { ...(TRACKS[0] as FragTrackSpec), codecTag: 'hvc1' },
        TRACKS[1] as FragTrackSpec,
      ]),
    );
    expect(sameCodecs(a, hevc)).toBe(false);
    expect(sameCodecs(a, parseInit(initSegment(TRACKS.slice(0, 1))))).toBe(false);
  });
});

describe.skipIf(!HAS_FFMPEG)('con la salida de un ffmpeg de verdad (@ffmpeg)', () => {
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(path.join(os.tmpdir(), 'ace-fmp4-'));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  for (const [name, ss] of [
    ['mkv-bframes', '8.333'],
    ['mp4-moov-end', '0'],
  ] as const) {
    it(`${name} desde ${ss} s: los mismos fragmentos y tiempos que el lector de referencia`, async () => {
      const out = path.join(work, `${name}.mp4`);
      const result = await runFfmpeg([
        '-loglevel',
        'error',
        ...(ss === '0' ? [] : ['-noaccurate_seek', '-ss', ss]),
        ...['-t', '20', '-i', ensureVodSample(name), '-map', '0:v:0', '-map', '0:a:0'],
        ...['-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-copyts'],
        ...['-movflags', '+frag_keyframe+delay_moov+default_base_moof+frag_discont'],
        ...['-f', 'mp4', '-y', out],
      ]);
      expect(result.code, result.stderr).toBe(0);
      const data = readFileSync(out);
      const reference = readFmp4(data);
      const refVideo = reference.tracks.find((t) => t.handler === 'vide');
      const split = feed(data, () => 65_536);
      expect(split.infos).toHaveLength(reference.fragments.length);
      split.infos.forEach((info, i) => {
        const expected = fragmentStartS(
          reference.fragments[i] as never,
          refVideo as never,
        ) as number;
        expect(Math.abs((info.startS as number) - expected)).toBeLessThan(1e-9);
        expect(info.firstIsSync).toBe(true);
      });
      /* init + fragmentos = el fichero sin el mfra del final. */
      const rebuilt = Buffer.concat([split.inits[0]?.bytes ?? Buffer.alloc(0), ...split.fragments]);
      expect(rebuilt.equals(data.subarray(0, rebuilt.length))).toBe(true);
      expect(data.toString('latin1', rebuilt.length + 4, rebuilt.length + 8)).toBe('mfra');
    });
  }
});
