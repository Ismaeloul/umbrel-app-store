/* Códecs del índice VOD (docs/vod.md §9.4 y §9.11) con los arreglos de la
   auditoría (docs/vod-estado.md §4.3): HEVC solo Main y Main 10 en 4:2:0
   (P3), holgura de la duración `max(2 GOP, 30 s)` (P5), sin
   AudioSpecificConfig no es AAC-LC y los CodecID antiguos del MKV (P8), y
   H.264 de los perfiles 110, 122, 144 y 244 no se reproduce (P10). */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import {
  assertPlayable,
  isAacLcConfig,
  medianGop,
  mkvAacIsLc,
  normalizeKeyframes,
  parseAvcC,
  parseHvcC,
  videoDuration,
} from './codecs.js';
import type { VodIndex, VodVideoInfo } from './types.js';

/* avcC con un SPS y un PPS de pega y, para los perfiles High, la extensión. */
function avcC(profile: number, level: number, ext?: { chroma: number; bits: number }): Buffer {
  const sps = [0x67, profile, 0x00, level, 0xac];
  const pps = [0x68, 0xee, 0x3c, 0x80];
  const bytes = [0x01, profile, 0x00, level, 0xff, 0xe1, 0x00, sps.length, ...sps];
  bytes.push(0x01, 0x00, pps.length, ...pps);
  if (ext) bytes.push(0xfc | ext.chroma, 0xf8 | (ext.bits - 8), 0xf8 | (ext.bits - 8), 0x00);
  return Buffer.from(bytes);
}

/* hvcC de 23 bytes (sin matrices de NAL). */
function hvcC(opts: {
  profile: number;
  compat: number;
  constraint0: number;
  level: number;
  chroma?: number;
  bits?: number;
  tier?: number;
}): Buffer {
  const out = Buffer.alloc(23);
  out[0] = 1;
  out[1] = ((opts.tier ?? 0) << 5) | opts.profile;
  out.writeUInt32BE(opts.compat >>> 0, 2);
  out[6] = opts.constraint0;
  out[12] = opts.level;
  out[13] = 0xf0;
  out[15] = 0xfc;
  out[16] = 0xfc | (opts.chroma ?? 1);
  out[17] = 0xf8 | ((opts.bits ?? 8) - 8);
  out[18] = 0xf8 | ((opts.bits ?? 8) - 8);
  out[21] = 0x0f;
  return out;
}

function index(video: Partial<VodVideoInfo> & Pick<VodVideoInfo, 'codec'>): VodIndex {
  return {
    container: 'mkv',
    durationS: 60,
    keyframes: Float64Array.from([0, 2]),
    video: {
      codecs: video.codec === 'hevc' ? 'hvc1.1.6.L90.90' : 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: null,
      chromaFormat: null,
      ...video,
    },
    audio: [],
    subtitles: [],
    sizeBytes: 1,
  };
}

function reasonOf(run: () => void): string | null {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('vod_unsupported');
    return (error as AppError & { data: { reason: string } }).data.reason;
  }
  return null;
}

describe('parseAvcC', () => {
  it('High 8 bits 4:2:0 → avc1.640028 con su perfil, bits y croma', () => {
    expect(parseAvcC(avcC(100, 0x28, { chroma: 1, bits: 8 }))).toEqual({
      codecs: 'avc1.640028',
      profile: 100,
      bitDepth: 8,
      chromaFormat: 1,
    });
    expect(parseAvcC(avcC(100, 0x1f, { chroma: 1, bits: 8 }))?.codecs).toBe('avc1.64001f');
  });

  it('High 10 por la extensión; Baseline sin extensión → 8 bits', () => {
    expect(parseAvcC(avcC(110, 0x28, { chroma: 1, bits: 10 }))?.bitDepth).toBe(10);
    expect(parseAvcC(avcC(66, 0x1e))).toEqual({
      codecs: 'avc1.42001e',
      profile: 66,
      bitDepth: 8,
      chromaFormat: null,
    });
  });

  it('sin la extensión, 4:2:2 y 4:4:4 se deducen del perfil', () => {
    expect(parseAvcC(avcC(122, 0x28))).toMatchObject({ bitDepth: 10, chromaFormat: 2 });
    expect(parseAvcC(avcC(244, 0x28))).toMatchObject({ bitDepth: 10, chromaFormat: 3 });
    expect(parseAvcC(avcC(144, 0x28))).toMatchObject({ bitDepth: 10, chromaFormat: 3 });
  });

  it('versión mala o corto → null', () => {
    expect(parseAvcC(Buffer.from([0x02, 0x64, 0, 0x28, 0xff, 0xe1, 0]))).toBeNull();
    expect(parseAvcC(Buffer.from([0x01, 0x64]))).toBeNull();
  });
});

describe('parseHvcC', () => {
  it('Main 8 bits → hvc1.1.6.L90.90 (banderas invertidas, ceros finales fuera)', () => {
    expect(
      parseHvcC(hvcC({ profile: 1, compat: 0x60000000, constraint0: 0x90, level: 90 })),
    ).toEqual({ codecs: 'hvc1.1.6.L90.90', profile: 1, bitDepth: 8, chromaFormat: 1 });
  });

  it('Main 10 en el nivel alto → hvc1.2.4.H120.B0', () => {
    expect(
      parseHvcC(
        hvcC({ profile: 2, compat: 0x20000000, constraint0: 0xb0, level: 120, bits: 10, tier: 1 }),
      ),
    ).toEqual({ codecs: 'hvc1.2.4.H120.B0', profile: 2, bitDepth: 10, chromaFormat: 1 });
  });

  it('RExt compatible con Main cuenta como Main; RExt 4:2:2 se queda como 4 (P3)', () => {
    expect(
      parseHvcC(hvcC({ profile: 4, compat: 0x48000000, constraint0: 0, level: 93 })),
    ).toMatchObject({ profile: 1, chromaFormat: 1 });
    expect(
      parseHvcC(hvcC({ profile: 4, compat: 0x08000000, constraint0: 0, level: 93, chroma: 2 })),
    ).toMatchObject({ profile: 4, chromaFormat: 2 });
  });

  it('corto → null', () => {
    expect(parseHvcC(Buffer.alloc(10, 1))).toBeNull();
  });
});

describe('AAC-LC', () => {
  it('AudioSpecificConfig: LC sí, HE-AAC y SBR explícito no; sin él, no (P8)', () => {
    expect(isAacLcConfig(Buffer.from([0x12, 0x10]))).toBe(true);
    expect(isAacLcConfig(Buffer.from([0x11, 0x90]))).toBe(true);
    expect(isAacLcConfig(Buffer.from([0x2b, 0x92, 0x08, 0x00]))).toBe(false);
    expect(isAacLcConfig(Buffer.from([0xe8, 0x10]))).toBe(false);
    expect(isAacLcConfig(null)).toBe(false);
    expect(isAacLcConfig(Buffer.from([0x12]))).toBe(false);
  });

  it('CodecID del MKV: manda el CodecPrivate; si no, LC y no LC/SBR (P8)', () => {
    expect(mkvAacIsLc('A_AAC', Buffer.from([0x12, 0x10]))).toBe(true);
    expect(mkvAacIsLc('A_AAC', Buffer.from([0x2b, 0x92]))).toBe(false);
    expect(mkvAacIsLc('A_AAC', null)).toBe(false);
    expect(mkvAacIsLc('A_AAC/MPEG4/LC', null)).toBe(true);
    expect(mkvAacIsLc('A_AAC/MPEG2/LC', null)).toBe(true);
    expect(mkvAacIsLc('A_AAC/MPEG4/LC/SBR', null)).toBe(false);
    expect(mkvAacIsLc('A_AAC/MPEG2/LC/SBR', null)).toBe(false);
    expect(mkvAacIsLc('A_AAC/MPEG4/MAIN', null)).toBe(false);
    expect(mkvAacIsLc('A_AAC/MPEG4/LTP', null)).toBe(false);
  });
});

describe('assertPlayable', () => {
  it('H.264 de 8 bits y 4:2:0 se ve; HEVC solo con hevcOk', () => {
    expect(
      reasonOf(() => assertPlayable(index({ codec: 'h264', profile: 100 }), false)),
    ).toBeNull();
    expect(reasonOf(() => assertPlayable(index({ codec: 'hevc', profile: 1 }), false))).toBe(
      'hevc',
    );
    expect(
      reasonOf(() => assertPlayable(index({ codec: 'hevc', profile: 2, bitDepth: 10 }), true)),
    ).toBeNull();
  });

  it('H.264 de 10 bits, 4:2:2 o perfiles 44/110/122/144/244 → video (P10)', () => {
    for (const profile of [44, 110, 122, 144, 244]) {
      expect(reasonOf(() => assertPlayable(index({ codec: 'h264', profile }), true))).toBe('video');
    }
    expect(reasonOf(() => assertPlayable(index({ codec: 'h264', bitDepth: 10 }), true))).toBe(
      'video',
    );
    expect(
      reasonOf(() => assertPlayable(index({ codec: 'h264', profile: 100, chromaFormat: 2 }), true)),
    ).toBe('video');
    /* Sin perfil apuntado se lee de la cadena de códecs. */
    expect(
      reasonOf(() => assertPlayable(index({ codec: 'h264', codecs: 'avc1.f4001f' }), true)),
    ).toBe('video');
  });

  it('HEVC que no es Main/Main 10 o no es 4:2:0 → video aunque se pueda HEVC (P3)', () => {
    expect(reasonOf(() => assertPlayable(index({ codec: 'hevc', profile: 4 }), true))).toBe(
      'video',
    );
    expect(
      reasonOf(() => assertPlayable(index({ codec: 'hevc', profile: 1, chromaFormat: 3 }), true)),
    ).toBe('video');
    expect(reasonOf(() => assertPlayable(index({ codec: 'hevc', profile: 4 }), false))).toBe(
      'video',
    );
  });

  it('MPEG-4 parte 2, MPEG-2 y VC-1 → video', () => {
    for (const codec of ['mpeg4', 'mpeg2video', 'vc1']) {
      expect(reasonOf(() => assertPlayable(index({ codec }), true))).toBe('video');
    }
  });
});

describe('duración y fotogramas clave', () => {
  const every2 = (count: number): Float64Array =>
    Float64Array.from({ length: count }, (_, i) => i * 2);

  it('medianGop', () => {
    expect(medianGop(Float64Array.from([0, 2, 4, 10]))).toBe(2);
    expect(medianGop(Float64Array.from([5]))).toBe(0);
  });

  it('la declarada vale si no pasa de max(2 GOP, 30 s) al último fotograma clave (P5)', () => {
    const keyframes = every2(91); // último en 180 s
    expect(videoDuration(182, keyframes)).toBe(182);
    /* Créditos sin cortes: 25 s tras el último fotograma clave sigue valiendo. */
    expect(videoDuration(205, keyframes)).toBe(205);
    /* Un subtítulo que estira el contenedor a 600 s no. */
    expect(videoDuration(600, keyframes)).toBe(182);
    expect(videoDuration(null, keyframes)).toBe(182);
    expect(videoDuration(150, keyframes)).toBe(182);
    expect(videoDuration(Number.NaN, keyframes)).toBe(182);
  });

  it('con GOP largos, la holgura es de 2 GOP', () => {
    const keyframes = Float64Array.from([0, 40, 80, 120]);
    expect(videoDuration(195, keyframes)).toBe(195);
    expect(videoDuration(205, keyframes)).toBe(160);
  });

  it('normalizeKeyframes ordena, quita repetidos y no finitos, y lleva −0,04 a 0', () => {
    expect(Array.from(normalizeKeyframes([4, 2, Number.NaN, 2, -0.04, -3, 6, Infinity]))).toEqual([
      0, 2, 4, 6,
    ]);
  });
});
