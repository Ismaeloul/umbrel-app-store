/* Escritor mínimo de cajas MP4 para las pruebas (docs/vod.md §15.1: «con
   ficheros construidos en el test… sin binarios en el repo»).

   - `buildMp4`: un MP4 con lo que importa al índice (`moov` al principio o
     al final, `mdat` de relleno, `stts`/`ctts`/`stss`/`elst` y las
     descripciones de muestra) y sus rarezas (`mdat` de 64 bits o hasta el
     final, fragmentado, `free` entre medias).
   - Las piezas de fMP4 (`initSegment`, `mediaFragment`) las usa el ffmpeg
     falso de las pruebas del productor. */

export function box(type: string, ...payload: Buffer[]): Buffer {
  const data = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, data]);
}

/** Caja con tamaño de 64 bits (`size = 1`). */
export function largeBox(type: string, ...payload: Buffer[]): Buffer {
  const data = Buffer.concat(payload);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1);
  header.write(type, 4, 'latin1');
  header.writeBigUInt64BE(BigInt(16 + data.length), 8);
  return Buffer.concat([header, data]);
}

export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: Buffer[]
): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(((version & 0xff) << 24) | (flags & 0xffffff));
  return box(type, head, ...payload);
}

export function u8(...values: number[]): Buffer {
  return Buffer.from(values);
}

export function u16(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => out.writeUInt16BE(value, i * 2));
  return out;
}

export function u32(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeUInt32BE(value >>> 0, i * 4));
  return out;
}

/** Como `u32`, sin pasar millones de argumentos (desbordaría la pila). */
export function u32array(values: readonly number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeUInt32BE(value >>> 0, i * 4));
  return out;
}

export function i32(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeInt32BE(value, i * 4));
  return out;
}

export function u64(value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(value));
  return out;
}

export function i64(value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64BE(BigInt(value));
  return out;
}

// --- Descripciones de muestra ---

function visualEntry(format: string, width: number, height: number, ...children: Buffer[]): Buffer {
  return box(
    format,
    Buffer.alloc(6),
    u16(1),
    Buffer.alloc(16),
    u16(width, height),
    u32(0x00480000, 0x00480000, 0),
    u16(1),
    Buffer.alloc(32),
    u16(0x18, 0xffff),
    ...children,
  );
}

export function avc1Entry(avcC: Buffer, width = 1920, height = 1080): Buffer {
  return visualEntry('avc1', width, height, box('avcC', avcC));
}

export function hvc1Entry(hvcC: Buffer, width = 1920, height = 1080): Buffer {
  return visualEntry('hvc1', width, height, box('hvcC', hvcC));
}

export function mp4vEntry(width = 640, height = 360): Buffer {
  return visualEntry('mp4v', width, height);
}

function audioEntry(format: string, channels: number, rate: number, ...children: Buffer[]): Buffer {
  return box(
    format,
    Buffer.alloc(6),
    u16(1),
    u16(0, 0),
    u32(0),
    u16(channels, 16, 0, 0),
    u32(rate * 65536),
    ...children,
  );
}

function descriptor(tag: number, ...payload: Buffer[]): Buffer {
  const data = Buffer.concat(payload);
  return Buffer.concat([u8(tag, data.length), data]);
}

export function esds(asc: Buffer, oti = 0x40): Buffer {
  return fullBox(
    'esds',
    0,
    0,
    descriptor(
      0x03,
      u16(1),
      u8(0),
      descriptor(0x04, u8(oti, 0x15), u8(0, 0, 0), u32(0, 0), descriptor(0x05, asc)),
      descriptor(0x06, u8(0x02)),
    ),
  );
}

export function mp4aEntry(asc: Buffer, channels = 2, oti = 0x40): Buffer {
  return audioEntry('mp4a', channels, 48_000, esds(asc, oti));
}

/** `ac-3` con su `dac3` (acmod 7 = 3/2, con LFE = 5.1). */
export function ac3Entry(acmod = 7, lfe = 1): Buffer {
  const bits = (0 << 22) | (8 << 17) | (0 << 14) | (acmod << 11) | (lfe << 10) | (15 << 5);
  const dac3 = Buffer.alloc(3);
  dac3.writeUIntBE(bits, 0, 3);
  return audioEntry('ac-3', 2, 48_000, box('dac3', dac3));
}

/** `ec-3` con su `dec3`; con un flujo dependiente es 7.1. */
export function ec3Entry(acmod = 7, lfe = 1, dependents = 0): Buffer {
  const head = u16((640 << 3) | 0);
  const bits = (0 << 22) | (16 << 17) | (acmod << 9) | (lfe << 8) | (dependents << 1);
  const sub = Buffer.alloc(3);
  sub.writeUIntBE(bits, 0, 3);
  return audioEntry('ec-3', 2, 48_000, box('dec3', head, sub, u8(0)));
}

export function tx3gEntry(): Buffer {
  return box('tx3g', Buffer.alloc(6), u16(1), Buffer.alloc(30));
}

// --- Un MP4 entero ---

export interface Mp4TrackSpec {
  readonly kind: 'video' | 'audio' | 'subtitle';
  readonly timescale: number;
  /** ISO 639-2; undefined = `und`. */
  readonly lang?: string;
  /** Bandera «activada» del tkhd (la que ffmpeg toma por «por defecto»). */
  readonly enabled?: boolean;
  readonly sampleEntry: Buffer;
  /** Pares (muestras, duración). */
  readonly stts: readonly (readonly [number, number])[];
  readonly ctts?: readonly (readonly [number, number])[];
  readonly cttsVersion?: 0 | 1;
  /** Muestras clave (desde 1); undefined = sin stss (todas lo son). */
  readonly stss?: readonly number[];
  /** Lista de edición: `mediaTime = −1` es una entrada vacía. */
  readonly elst?: readonly { readonly segment: number; readonly mediaTime: number }[];
  readonly elstVersion?: 0 | 1;
  readonly mdhdVersion?: 0 | 1;
  readonly duration?: number;
  readonly name?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface Mp4Spec {
  readonly movieTimescale?: number;
  readonly movieDuration?: number;
  readonly tracks: readonly Mp4TrackSpec[];
  readonly moovAtEnd?: boolean;
  readonly mdatBytes?: number;
  readonly largeMdat?: boolean;
  /** `mdat` con `size = 0` (hasta el final del fichero). */
  readonly mdatToEof?: boolean;
  readonly fragmented?: 'mvex' | 'moof';
  /** Una caja `free` de estos bytes entre el `mdat` y el `moov`. */
  readonly freeBytes?: number;
}

function langCode(lang: string | undefined): number {
  const code = lang ?? 'und';
  return (
    (((code.charCodeAt(0) - 0x60) & 0x1f) << 10) |
    (((code.charCodeAt(1) - 0x60) & 0x1f) << 5) |
    ((code.charCodeAt(2) - 0x60) & 0x1f)
  );
}

function trak(track: Mp4TrackSpec, id: number): Buffer {
  const handler = track.kind === 'video' ? 'vide' : track.kind === 'audio' ? 'soun' : 'sbtl';
  const tkhd = fullBox(
    'tkhd',
    0,
    track.enabled === false ? 0x2 : 0x3,
    u32(0, 0, id, 0, track.duration ?? 0),
    Buffer.alloc(8),
    u16(0, 0, track.kind === 'audio' ? 0x0100 : 0, 0),
    u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000),
    u32((track.width ?? (track.kind === 'video' ? 1920 : 0)) * 65536),
    u32((track.height ?? (track.kind === 'video' ? 1080 : 0)) * 65536),
  );
  const mdhd =
    track.mdhdVersion === 1
      ? fullBox(
          'mdhd',
          1,
          0,
          u64(0),
          u64(0),
          u32(track.timescale),
          u64(track.duration ?? 0),
          u16(langCode(track.lang), 0),
        )
      : fullBox(
          'mdhd',
          0,
          0,
          u32(0, 0, track.timescale, track.duration ?? 0),
          u16(langCode(track.lang), 0),
        );
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    u32(0),
    Buffer.from(handler, 'latin1'),
    Buffer.alloc(12),
    Buffer.from('Handler\0'),
  );
  const stbl: Buffer[] = [
    fullBox('stsd', 0, 0, u32(1), track.sampleEntry),
    fullBox('stts', 0, 0, u32(track.stts.length), ...track.stts.map(([n, d]) => u32(n, d))),
  ];
  if (track.ctts) {
    stbl.push(
      fullBox(
        'ctts',
        track.cttsVersion ?? 0,
        0,
        u32(track.ctts.length),
        ...track.ctts.map(([n, o]) => Buffer.concat([u32(n), i32(o)])),
      ),
    );
  }
  if (track.stss) stbl.push(fullBox('stss', 0, 0, u32(track.stss.length), u32array(track.stss)));
  stbl.push(
    fullBox('stsz', 0, 0, u32(0, 0)),
    fullBox('stsc', 0, 0, u32(0)),
    fullBox('stco', 0, 0, u32(0)),
  );
  const children: Buffer[] = [tkhd];
  if (track.elst) {
    const entries = track.elst.map((entry) =>
      track.elstVersion === 1
        ? Buffer.concat([u64(entry.segment), i64(entry.mediaTime), u32(0x10000)])
        : Buffer.concat([u32(entry.segment), i32(entry.mediaTime), u32(0x10000)]),
    );
    children.push(
      box('edts', fullBox('elst', track.elstVersion ?? 0, 0, u32(entries.length), ...entries)),
    );
  }
  children.push(box('mdia', mdhd, hdlr, box('minf', box('stbl', ...stbl))));
  if (track.name) children.push(box('udta', box('name', Buffer.from(track.name, 'utf8'))));
  return box('trak', ...children);
}

export function buildMp4(spec: Mp4Spec): Buffer {
  const ftyp = box(
    'ftyp',
    Buffer.from('isom', 'latin1'),
    u32(0x200),
    Buffer.from('isomiso2avc1mp41', 'latin1'),
  );
  const movieTimescale = spec.movieTimescale ?? 1000;
  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    u32(0, 0, movieTimescale, spec.movieDuration ?? 60 * movieTimescale),
    u32(0x10000),
    u16(0x100, 0),
    Buffer.alloc(8),
    u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000),
    Buffer.alloc(24),
    u32(spec.tracks.length + 1),
  );
  const extra =
    spec.fragmented === 'mvex' ? [box('mvex', fullBox('trex', 0, 0, u32(1, 1, 0, 0, 0)))] : [];
  const moov = box('moov', mvhd, ...spec.tracks.map((t, i) => trak(t, i + 1)), ...extra);
  const filler = Buffer.alloc(spec.mdatBytes ?? 64 * 1024, 0x33);
  let mdat: Buffer;
  if (spec.mdatToEof) {
    const header = Buffer.alloc(8);
    header.write('mdat', 4, 'latin1');
    mdat = Buffer.concat([header, filler]);
  } else mdat = spec.largeMdat ? largeBox('mdat', filler) : box('mdat', filler);
  const free = spec.freeBytes ? box('free', Buffer.alloc(spec.freeBytes)) : Buffer.alloc(0);
  const moof =
    spec.fragmented === 'moof' ? box('moof', fullBox('mfhd', 0, 0, u32(1))) : Buffer.alloc(0);
  if (spec.mdatToEof) return Buffer.concat([ftyp, moof, mdat]);
  return spec.moovAtEnd
    ? Buffer.concat([ftyp, moof, mdat, free, moov])
    : Buffer.concat([ftyp, moov, moof, free, mdat]);
}
