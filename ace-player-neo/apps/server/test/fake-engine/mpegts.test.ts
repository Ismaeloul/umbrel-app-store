/* Tests del generador MPEG-TS y de las piezas puras del motor falso
   (línea de tiempo, catálogo, modos y reloj).

   Lo importante: la analyzeTransportStream ORIGINAL de la 0.6.59 tiene que
   leer de lo generado el mismo códec y el mismo bitrate que se pidieron; si
   no, el comprobador de canales del backend nuevo se probaría contra algo
   que el viejo no habría entendido. */

import { afterAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOG,
  contentIdToInfohash,
  demoContentId,
  normalizeContent,
  parseCatalog,
} from './catalog.js';
import { FakeClock } from './clock.js';
import { holdsData, parseMode } from './modes.js';
import {
  AUDIO_STREAM_TYPE,
  FPS,
  PID_AUDIO_FIRST,
  PID_NULL,
  PID_PMT,
  PID_VIDEO,
  TS_PACKET_SIZE,
  TsMuxer,
  VIDEO_STREAM_TYPE,
  colorFromSeed,
  crc32Mpeg2,
  generateSegment,
  type AudioCodec,
  type VideoCodec,
} from './mpegts.js';
import {
  completedSegments,
  makeSegmentPlan,
  renderPlaylist,
  segmentDurationSec,
  segmentStartSec,
} from './timeline.js';
import {
  collectPes,
  h264NalTypes,
  hevcNalTypes,
  loadLegacyAnalyzer,
  parsePackets,
  pesPayload,
  pesPts,
  type TsPacket,
} from './test-utils.js';

const legacy = loadLegacyAnalyzer();
afterAll(() => legacy.cleanup());

const COLOR = colorFromSeed('0123456789abcdef0123456789abcdef01234567');

function segment(
  video: VideoCodec,
  audio: AudioCodec[],
  bitrateKbps: number,
  startSec = 3600,
  seconds = 5,
): Buffer {
  return generateSegment({
    video,
    audio,
    bitrateKbps,
    startSec,
    endSec: startSec + seconds,
    color: COLOR,
  });
}

/* Sección PSI completa del primer paquete con PUSI de ese PID. */
function psiSection(packets: readonly TsPacket[], pid: number): Buffer {
  const packet = packets.find((p) => p.pid === pid && p.pusi);
  if (!packet) throw new Error(`no hay PSI en el PID ${pid}`);
  const pointer = packet.payload[0] ?? 0;
  const start = 1 + pointer;
  const length =
    (((packet.payload[start + 1] ?? 0) & 0x0f) << 8) | (packet.payload[start + 2] ?? 0);
  return packet.payload.subarray(start, start + 3 + length);
}

function pmtStreams(section: Buffer): Array<{ type: number; pid: number }> {
  const infoLength = (((section[10] ?? 0) & 0x0f) << 8) | (section[11] ?? 0);
  const end = section.length - 4;
  const out: Array<{ type: number; pid: number }> = [];
  for (let i = 12 + infoLength; i + 5 <= end;) {
    const esInfo = (((section[i + 3] ?? 0) & 0x0f) << 8) | (section[i + 4] ?? 0);
    out.push({
      type: section[i] ?? 0,
      pid: (((section[i + 1] ?? 0) & 0x1f) << 8) | (section[i + 2] ?? 0),
    });
    i += 5 + esInfo;
  }
  return out;
}

describe('generador MPEG-TS: PAT y PMT', () => {
  it('CRC-32/MPEG-2 da el valor de referencia', () => {
    expect(crc32Mpeg2(Buffer.from('123456789'))).toBe(0x0376e6e7);
  });

  const combos: Array<[VideoCodec, AudioCodec[]]> = [
    ['h264', ['aac']],
    ['h264', ['mp2']],
    ['h264', ['ac3']],
    ['hevc', ['aac']],
    ['hevc', ['ac3', 'aac']],
  ];

  it.each(combos)('%s + %j: PAT a la PMT y PMT con los tipos de flujo reales', (video, audio) => {
    const packets = parsePackets(segment(video, audio, 2500));
    expect(packets[0]?.pid).toBe(0);
    const pat = psiSection(packets, 0);
    expect(pat[0]).toBe(0x00);
    expect(crc32Mpeg2(pat)).toBe(0); // CRC bien puesto: sobre la sección entera da 0
    expect((((pat[10] ?? 0) & 0x1f) << 8) | (pat[11] ?? 0)).toBe(PID_PMT);

    const pmt = psiSection(packets, PID_PMT);
    expect(pmt[0]).toBe(0x02);
    expect(crc32Mpeg2(pmt)).toBe(0);
    expect((((pmt[8] ?? 0) & 0x1f) << 8) | (pmt[9] ?? 0)).toBe(PID_VIDEO); // PCR_PID
    expect(pmtStreams(pmt)).toEqual([
      { type: VIDEO_STREAM_TYPE[video], pid: PID_VIDEO },
      ...audio.map((codec, i) => ({ type: AUDIO_STREAM_TYPE[codec], pid: PID_AUDIO_FIRST + i })),
    ]);
  });

  it('los tipos de flujo son los del motor real: h264 0x1b, hevc 0x24, aac 0x0f, mp2 0x03, ac3 0x81', () => {
    expect(VIDEO_STREAM_TYPE).toEqual({ h264: 0x1b, hevc: 0x24 });
    expect(AUDIO_STREAM_TYPE).toEqual({ aac: 0x0f, mp2: 0x03, ac3: 0x81 });
  });

  it('PAT y PMT se repiten (cada 100 ms) para que un cliente pueda engancharse a mitad', () => {
    const packets = parsePackets(segment('h264', ['aac'], 2500));
    const pats = packets.filter((p) => p.pid === 0).length;
    expect(pats).toBeGreaterThanOrEqual(49);
    expect(pats).toBeLessThanOrEqual(51);
  });
});

describe('generador MPEG-TS: analyzeTransportStream ORIGINAL de la 0.6.59', () => {
  const cases: Array<[VideoCodec, AudioCodec[], number, string, string[]]> = [
    ['h264', ['aac'], 3500, 'h264', ['aac']],
    ['h264', ['mp2'], 1000, 'h264', ['mp2']],
    ['h264', ['ac3'], 4000, 'h264', ['ac3']],
    ['hevc', ['aac'], 6000, 'hevc', ['aac']],
    ['hevc', ['ac3', 'aac'], 8000, 'hevc', ['ac3', 'aac']],
    ['h264', ['aac'], 20000, 'h264', ['aac']],
  ];

  it.each(cases)(
    'segmento %s %j a %i kbit/s',
    (video, audio, kbps, expectedVideo, expectedAudio) => {
      const result = legacy.analyze(segment(video, audio, kbps));
      expect(result.videoCodec).toBe(expectedVideo);
      expect(result.audioCodecs).toEqual(expectedAudio);
      expect(result.streamKbps).toBe(kbps);
      expect(result.pcrSpanMs).toBeGreaterThan(4900);
      expect(result.pcrSpanMs).toBeLessThanOrEqual(5000);
    },
  );

  it('el progresivo (muxer sin fin, leído a trozos) también da el bitrate exacto', () => {
    const mux = new TsMuxer({
      video: 'h264',
      audio: ['mp2'],
      bitrateKbps: 2500,
      startSec: 7200,
      color: COLOR,
    });
    const chunks: Buffer[] = [];
    // trozos de tamaño irregular, como los que manda el pump del motor
    for (const count of [17, 400, 1, 1203, 999, 3000]) chunks.push(mux.nextPackets(count));
    const result = legacy.analyze(Buffer.concat(chunks));
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodecs).toEqual(['mp2']);
    expect(result.streamKbps).toBe(2500);
  });
});

describe('generador MPEG-TS: relojes y continuidad', () => {
  it('cada PCR cae exactamente en el byte que le toca según el bitrate (CBR)', () => {
    const kbps = 3000;
    const packets = parsePackets(segment('h264', ['aac'], kbps));
    const withPcr = packets.filter((p) => p.pcr !== null);
    expect(withPcr.length).toBeGreaterThan(100); // uno cada 40 ms
    const first = withPcr[0];
    if (!first || first.pcr === null) throw new Error('sin PCR');
    for (const packet of withPcr) {
      const seconds = ((packet.pcr ?? 0) - first.pcr) / 27_000_000;
      const expectedBytes = (seconds * kbps * 1000) / 8;
      expect(Math.abs(packet.offset - first.offset - expectedBytes)).toBeLessThan(1);
    }
    // PCR como mucho cada 40 ms (el límite de la norma es 100 ms)
    for (let i = 1; i < withPcr.length; i += 1) {
      const gap = ((withPcr[i]?.pcr ?? 0) - (withPcr[i - 1]?.pcr ?? 0)) / 27_000;
      expect(gap).toBeLessThanOrEqual(41);
    }
  });

  it('el contador de continuidad de cada PID avanza de uno en uno y el segmento arranca marcado como discontinuidad', () => {
    const packets = parsePackets(segment('h264', ['aac', 'mp2'], 2500));
    const last = new Map<number, number>();
    for (const packet of packets) {
      if (packet.pid === PID_NULL) continue;
      const previous = last.get(packet.pid);
      if (previous === undefined) {
        // primer paquete de cada PID con campo de adaptación: discontinuidad
        if (packet.pid !== 0 && packet.pid !== PID_PMT) expect(packet.discontinuity).toBe(true);
      } else if (packet.hasPayload) {
        expect(packet.cc).toBe((previous + 1) & 0x0f);
      } else {
        expect(packet.cc).toBe(previous); // sin carga no se incrementa
      }
      if (packet.hasPayload || previous === undefined) last.set(packet.pid, packet.cc);
    }
  });

  it('segmentos deterministas y contiguos: dos peticiones dan los mismos bytes y el PCR sigue de uno al siguiente', () => {
    const a = segment('h264', ['aac'], 2500, 3600, 5);
    expect(segment('h264', ['aac'], 2500, 3600, 5).equals(a)).toBe(true);
    const b = segment('h264', ['aac'], 2500, 3605, 4);
    const lastA = parsePackets(a)
      .filter((p) => p.pcr !== null)
      .at(-1);
    const firstB = parsePackets(b).find((p) => p.pcr !== null);
    const gapMs = ((firstB?.pcr ?? 0) - (lastA?.pcr ?? 0)) / 27_000;
    expect(gapMs).toBeGreaterThan(0);
    expect(gapMs).toBeLessThanOrEqual(41);
    // tamaño = duración x bitrate (más, como mucho, un puñado de paquetes de vaciado)
    const expected = (5 * 2500 * 1000) / 8;
    expect(Math.abs(a.length - expected)).toBeLessThan(TS_PACKET_SIZE * 8);
  });

  it('cada segmento empieza por un IDR H.264 con AUD, SPS, PPS e IDR y marca de acceso aleatorio', () => {
    const packets = parsePackets(segment('h264', ['aac'], 2500));
    const firstVideo = packets.find((p) => p.pid === PID_VIDEO && p.pusi);
    expect(firstVideo?.randomAccess).toBe(true);
    const pes = collectPes(packets, PID_VIDEO);
    expect(pes.length).toBe(5 * FPS);
    expect(h264NalTypes(pesPayload(pes[0] ?? Buffer.alloc(0)))).toEqual([9, 7, 8, 5]);
    expect(h264NalTypes(pesPayload(pes[1] ?? Buffer.alloc(0)))).toEqual([9, 1]);
    // un IDR por segundo (GOP de 1 s)
    const idrs = pes.filter((p) => h264NalTypes(pesPayload(p)).includes(5)).length;
    expect(idrs).toBe(5);
    // PTS de 25 fps: 3600 ticks de 90 kHz entre cuadros
    const pts = pes.map(pesPts);
    for (let i = 1; i < pts.length; i += 1) expect((pts[i] ?? 0) - (pts[i - 1] ?? 0)).toBe(3600);
  });

  it('dentro de los NAL H.264 no aparece un código de inicio falso (bytes de prevención de emulación)', () => {
    const packets = parsePackets(segment('h264', ['aac'], 2500));
    const idr = pesPayload(collectPes(packets, PID_VIDEO)[0] ?? Buffer.alloc(0));
    // solo 4 códigos de inicio: AUD, SPS, PPS e IDR
    expect(h264NalTypes(idr)).toHaveLength(4);
  });

  it('HEVC: VPS, SPS, PPS e IDR_W_RADL al principio de cada GOP', () => {
    const packets = parsePackets(segment('hevc', ['aac'], 6000));
    const pes = collectPes(packets, PID_VIDEO);
    expect(hevcNalTypes(pesPayload(pes[0] ?? Buffer.alloc(0)))).toEqual([35, 32, 33, 34, 19]);
    expect(hevcNalTypes(pesPayload(pes[1] ?? Buffer.alloc(0)))).toEqual([35, 1]);
  });

  it.each([
    ['aac' as AudioCodec, [0xff, 0xf1], 1024],
    ['mp2' as AudioCodec, [0xff, 0xfd], 1152],
    ['ac3' as AudioCodec, [0x0b, 0x77], 1536],
  ])(
    'audio %s: palabra de sincronía correcta y PTS al ritmo de la trama',
    (codec, sync, samples) => {
      const packets = parsePackets(segment('h264', [codec], 2500));
      const pes = collectPes(packets, PID_AUDIO_FIRST);
      const first = pesPayload(pes[0] ?? Buffer.alloc(0));
      expect([first[0], first[1]]).toEqual(sync);
      const step = (samples * 90000) / 48000;
      const pts = pes.map(pesPts);
      for (let i = 1; i < pts.length; i += 1)
        expect((pts[i] ?? 0) - (pts[i - 1] ?? 0)).toBeCloseTo(step, 0);
      expect(pes.length).toBeGreaterThanOrEqual(Math.floor((5 * 48000) / samples));
    },
  );

  it('rechaza bitrates fuera de rango y comienzos que no son un segundo entero', () => {
    expect(() => segment('h264', ['aac'], 500)).toThrow(/bitrate/);
    expect(() => segment('h264', ['aac'], 50_000)).toThrow(/bitrate/);
    expect(
      () =>
        new TsMuxer({
          video: 'h264',
          audio: ['aac'],
          bitrateKbps: 2500,
          startSec: 1.5,
          color: COLOR,
        }),
    ).toThrow(/startSec/);
    expect(() =>
      new TsMuxer({
        video: 'h264',
        audio: ['aac'],
        bitrateKbps: 2500,
        startSec: 0,
        color: COLOR,
      }).finish(),
    ).toThrow(/finish/);
  });

  it('cada canal tiene su color (dentro del rango de vídeo)', () => {
    const a = colorFromSeed(contentIdToInfohash(demoContentId(1)));
    const b = colorFromSeed(contentIdToInfohash(demoContentId(2)));
    expect(a).not.toEqual(b);
    for (const value of [a.y, a.cb, a.cr, b.y, b.cb, b.cr]) {
      expect(value).toBeGreaterThanOrEqual(16);
      expect(value).toBeLessThanOrEqual(235);
    }
  });
});

describe('línea de tiempo HLS', () => {
  const plan = makeSegmentPlan([5, 4, 6, 5]);

  it('inicio, duración y segmentos completos cuadran entre sí', () => {
    expect(plan.cycleSec).toBe(20);
    expect(plan.targetDuration).toBe(6);
    for (let n = 0; n < 50; n += 1) {
      const start = segmentStartSec(plan, n);
      const end = start + segmentDurationSec(plan, n);
      expect(completedSegments(plan, end)).toBe(n + 1);
      expect(completedSegments(plan, end - 0.001)).toBe(n);
    }
    expect(completedSegments(plan, 0)).toBe(0);
  });

  it('lista viva de la versión 3 con URL absolutas', () => {
    const text = renderPlaylist(plan, 10, 13, (n) => `http://motor:6878/ace/c/abc/${n}.ts`);
    expect(text).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:10',
        '#EXTINF:6.000000,',
        'http://motor:6878/ace/c/abc/10.ts',
        '#EXTINF:5.000000,',
        'http://motor:6878/ace/c/abc/11.ts',
        '#EXTINF:5.000000,',
        'http://motor:6878/ace/c/abc/12.ts',
        '',
      ].join('\n'),
    );
    expect(text).not.toContain('#EXT-X-ENDLIST');
  });

  it('valida las duraciones', () => {
    expect(() => makeSegmentPlan([])).toThrow();
    expect(() => makeSegmentPlan([0])).toThrow();
    expect(() => makeSegmentPlan([4.5])).toThrow();
    expect(() => makeSegmentPlan([11])).toThrow();
  });
});

describe('catálogo', () => {
  it('el catálogo por defecto tiene 8 canales inventados válidos, uno sin pares', () => {
    const contents = parseCatalog(DEFAULT_CATALOG);
    expect(contents).toHaveLength(8);
    expect(contents.filter((c) => c.peers === 0)).toHaveLength(1);
    expect(new Set(contents.map((c) => c.video))).toEqual(new Set(['h264', 'hevc']));
    expect(new Set(contents.flatMap((c) => c.audio))).toEqual(new Set(['aac', 'mp2', 'ac3']));
    for (const content of contents) {
      expect(content.id.startsWith('fa4ec0de')).toBe(true);
      expect(content.infohash).toBe(contentIdToInfohash(content.id));
    }
  });

  it('infohash determinista y distinto del id; se respeta uno explícito', () => {
    const id = 'a'.repeat(40);
    expect(contentIdToInfohash(id)).toBe(contentIdToInfohash(id.toUpperCase()));
    expect(contentIdToInfohash(id)).not.toBe(id);
    expect(normalizeContent({ id, infohash: 'B'.repeat(40) }).infohash).toBe('b'.repeat(40));
    expect(normalizeContent({ id, title: 'Canal X --> PROV' }).searchName).toBe('Canal X');
  });

  it('rechaza entradas malas y repetidas', () => {
    expect(() => normalizeContent({ id: 'corto' })).toThrow(/id/);
    expect(() => normalizeContent({ id: 'a'.repeat(40), video: 'vp9' as VideoCodec })).toThrow(
      /vídeo/,
    );
    expect(() => normalizeContent({ id: 'a'.repeat(40), audio: 'opus' as AudioCodec })).toThrow(
      /audio/,
    );
    expect(() => normalizeContent({ id: 'a'.repeat(40), bitrateKbps: 10 })).toThrow(/bitrate/);
    expect(() => normalizeContent({ id: 'a'.repeat(40), intakeRatio: 0 })).toThrow(/intakeRatio/);
    expect(() => parseCatalog([{ id: 'a'.repeat(40) }, { id: 'A'.repeat(40) }])).toThrow(
      /repetido/,
    );
    expect(() => parseCatalog({ nada: true })).toThrow(/array/);
    expect(parseCatalog({ contents: [{ id: 'c'.repeat(40) }] })).toHaveLength(1);
  });
});

describe('modos de fallo', () => {
  it('valores por defecto razonables con el nombre suelto', () => {
    expect(parseMode('slowStart')).toEqual({ kind: 'slowStart', ms: 5000 });
    expect(parseMode('cut')).toEqual({ kind: 'cut', afterBytes: 256 * 1024 });
    expect(parseMode({ kind: 'cut', afterMs: 100 })).toEqual({ kind: 'cut', afterMs: 100 });
    expect(parseMode({ kind: 'down', how: 'reset' })).toEqual({ kind: 'down', how: 'reset' });
    expect(parseMode({ kind: 'slowStart', ms: 10, firstByteMs: 0 })).toEqual({
      kind: 'slowStart',
      ms: 10,
      firstByteMs: 0,
    });
  });

  it('rechaza modos desconocidos y valores fuera de rango', () => {
    expect(() => parseMode('explota')).toThrow(/desconocido/);
    expect(() => parseMode({ kind: 'down', how: 'boom' })).toThrow(/how/);
    expect(() => parseMode({ kind: 'slowStart', ms: -1 })).toThrow(/rango/);
    expect(() => parseMode(null)).toThrow();
  });

  it('solo silence, noPeers y stall retienen los datos', () => {
    expect(holdsData(parseMode('silence'))).toBe(true);
    expect(holdsData(parseMode('noPeers'))).toBe(true);
    expect(holdsData(parseMode('stall'))).toBe(true);
    expect(holdsData(parseMode('normal'))).toBe(false);
    expect(holdsData(parseMode('cut'))).toBe(false);
  });
});

describe('reloj falso', () => {
  it('dispara los temporizadores en orden y los que se programan dentro de la ventana', () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push('b'), 20);
    clock.setTimeout(() => {
      order.push('a');
      clock.setTimeout(() => order.push('a2'), 5);
    }, 10);
    clock.setTimeout(() => order.push('c'), 20);
    const cancelled = clock.setTimeout(() => order.push('nunca'), 15);
    clock.clearTimeout(cancelled);
    clock.advance(20);
    expect(order).toEqual(['a', 'a2', 'b', 'c']);
    expect(clock.now()).toBe(20);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('no va hacia atrás ni acepta avances negativos', () => {
    const clock = new FakeClock(1000);
    expect(() => clock.advance(-1)).toThrow();
    expect(() => clock.set(10)).toThrow();
    clock.set(5000);
    expect(clock.now()).toBe(5000);
  });
});
