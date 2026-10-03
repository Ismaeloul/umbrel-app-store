/* Índice de un MP4 (o MOV/M4V) leído por Range, sin ffmpeg (docs/vod.md
   §9.4).

   Cajas de primer nivel: el `moov` al principio (faststart) o al final, tras
   el `mdat` (lo normal en los paneles: se salta el `mdat` por su tamaño y se
   lee lo que viene después). En el `trak` de vídeo: `mdhd` (escala y
   lengua), `stts` + `ctts` + `stss` → tiempos de los fotogramas clave, y
   `elst` → dónde caen al presentarlos; `stsd` → códec (`avc1`/`hvc1`… con su
   `avcC`/`hvcC`; `mp4a` con su `esds`; `ac-3`/`ec-3`…). Lo normal son 2-3
   lecturas: la cabecera y el `moov` (~0,7 MB para 10 min, ~7-8 MB para 2 h).

   - Lista de edición (P1): una entrada VACÍA (`media_time = −1`) retrasa
     toda la pista su duración (en la escala del `mvhd`); la primera entrada
     normal adelanta su `media_time` (en la del `mdhd`). Sin sumar la vacía,
     los fotogramas clave salían 21 ms antes que en ffprobe.
   - MP4 fragmentado (`mvex` o `moof`): no en la v1 → `vod_unsupported('indice')`.
   - `moov` de más de 32 MiB → `indice`. */

import { VOD_PLAY } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import {
  isAacLcConfig,
  normalizeKeyframes,
  parseAvcC,
  parseHvcC,
  videoDuration,
  vodUnsupported,
} from './codecs.js';
import type { RangeReader, VodIndex, VodSubtitle, VodTrack, VodVideoInfo } from './types.js';

/** Lo que se lee tras el `mdat` buscando el `moov` (si es más grande, una lectura más). */
const TAIL_WINDOW_BYTES = 1024 * 1024;
/** Cajas de primer nivel que se miran como mucho tras el `mdat`. */
const TAIL_BOXES_MAX = 16;

export interface Mp4Box {
  readonly type: string;
  /** Posición (en el búfer) del principio de la caja. */
  readonly start: number;
  readonly headerSize: number;
  /** Tamaño total, o null si llega hasta el final del fichero (`size = 0`). */
  readonly size: number | null;
}

/** Cabecera de caja en `pos`; null si no cabe (8 o 16 bytes). */
export function readBox(data: Buffer, pos: number): Mp4Box | null {
  if (pos + 8 > data.length) return null;
  let size: number | null = data.readUInt32BE(pos);
  const type = data.toString('latin1', pos + 4, pos + 8);
  let headerSize = 8;
  if (size === 1) {
    if (pos + 16 > data.length) return null;
    const large = data.readBigUInt64BE(pos + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = null;
  }
  if (size !== null && size < headerSize) return null;
  return { type, start: pos, headerSize, size };
}

/** Hijas de [start, end) del búfer (las que no caben enteras se cortan en `end`). */
function boxes(data: Buffer, start: number, end: number): Mp4Box[] {
  const out: Mp4Box[] = [];
  let pos = start;
  const limit = Math.min(end, data.length);
  while (pos + 8 <= limit) {
    const box = readBox(data, pos);
    if (!box) break;
    out.push(box);
    if (box.size === null) break;
    pos += box.size;
  }
  return out;
}

const endOf = (data: Buffer, box: Mp4Box): number =>
  Math.min(data.length, box.size === null ? data.length : box.start + box.size);
const payload = (box: Mp4Box): number => box.start + box.headerSize;

function find(data: Buffer, parent: Mp4Box, type: string): Mp4Box | undefined {
  return boxes(data, payload(parent), endOf(data, parent)).find((box) => box.type === type);
}

function path(data: Buffer, parent: Mp4Box, types: readonly string[]): Mp4Box | undefined {
  let current: Mp4Box | undefined = parent;
  for (const type of types) {
    if (!current) return undefined;
    current = find(data, current, type);
  }
  return current;
}

// --- Cajas del moov ---

interface MovieHeader {
  readonly timescale: number;
  readonly duration: number | null;
}

function readMvhd(data: Buffer, box: Mp4Box): MovieHeader {
  const p = payload(box);
  const version = data[p] as number;
  if (version === 1) {
    const duration = Number(data.readBigUInt64BE(p + 24));
    return { timescale: data.readUInt32BE(p + 20), duration: duration || null };
  }
  const duration = data.readUInt32BE(p + 16);
  return {
    timescale: data.readUInt32BE(p + 12),
    duration: duration && duration !== 0xffffffff ? duration : null,
  };
}

interface MediaHeader {
  readonly timescale: number;
  readonly duration: number | null;
  readonly lang: string | null;
}

function readMdhd(data: Buffer, box: Mp4Box): MediaHeader {
  const p = payload(box);
  const version = data[p] as number;
  const timescale = data.readUInt32BE(p + (version === 1 ? 20 : 12));
  const rawDuration =
    version === 1 ? Number(data.readBigUInt64BE(p + 24)) : data.readUInt32BE(p + 16);
  const packed = data.readUInt16BE(p + (version === 1 ? 32 : 20));
  const code = String.fromCharCode(
    ((packed >> 10) & 0x1f) + 0x60,
    ((packed >> 5) & 0x1f) + 0x60,
    (packed & 0x1f) + 0x60,
  );
  const lang = /^[a-z]{3}$/.test(code) && code !== 'und' ? code : null;
  const duration = rawDuration && rawDuration !== 0xffffffff ? rawDuration : null;
  return { timescale, duration, lang };
}

interface TrackHeader {
  readonly id: number;
  readonly enabled: boolean;
  readonly width: number | null;
  readonly height: number | null;
}

function readTkhd(data: Buffer, box: Mp4Box): TrackHeader {
  const p = payload(box);
  const version = data[p] as number;
  const flags = data.readUIntBE(p + 1, 3);
  const id = data.readUInt32BE(p + (version === 1 ? 20 : 12));
  const end = endOf(data, box);
  const width = end - 8 >= p ? Math.round(data.readUInt32BE(end - 8) / 65536) : 0;
  const height = end - 4 >= p ? Math.round(data.readUInt32BE(end - 4) / 65536) : 0;
  return { id, enabled: (flags & 1) !== 0, width: width || null, height: height || null };
}

interface Edit {
  /** Retraso total de las entradas vacías, en segundos. */
  readonly emptyS: number;
  /** `media_time` de la primera entrada normal, en la escala del `mdhd`. */
  readonly mediaTime: number;
  /** Duración de esa entrada (lo que se presenta), en segundos; null si no viene. */
  readonly segmentS: number | null;
}

function readElst(data: Buffer, box: Mp4Box, movieTimescale: number): Edit {
  const p = payload(box);
  const version = data[p] as number;
  const count = data.readUInt32BE(p + 4);
  let pos = p + 8;
  let empty = 0;
  const end = endOf(data, box);
  for (let i = 0; i < count && pos < end; i += 1) {
    const segment = version === 1 ? Number(data.readBigUInt64BE(pos)) : data.readUInt32BE(pos);
    const mediaTime =
      version === 1 ? Number(data.readBigInt64BE(pos + 8)) : data.readInt32BE(pos + 4);
    pos += version === 1 ? 20 : 12;
    if (mediaTime === -1) {
      empty += segment;
      continue;
    }
    const emptyS = movieTimescale ? empty / movieTimescale : 0;
    const segmentS = movieTimescale && segment ? segment / movieTimescale : null;
    return { emptyS, mediaTime, segmentS };
  }
  return { emptyS: movieTimescale ? empty / movieTimescale : 0, mediaTime: 0, segmentS: null };
}

/** Tiempos de decodificación (en la escala del `mdhd`) de las muestras pedidas (números desde 1, en orden). */
function decodeTimes(data: Buffer, stts: Mp4Box, samples: readonly number[]): number[] {
  const p = payload(stts);
  const count = data.readUInt32BE(p + 4);
  const out: number[] = [];
  let next = 0;
  let first = 1;
  let time = 0;
  for (let i = 0; i < count && next < samples.length; i += 1) {
    const pos = p + 8 + i * 8;
    if (pos + 8 > data.length) break;
    const run = data.readUInt32BE(pos);
    const delta = data.readUInt32BE(pos + 4);
    while (next < samples.length && (samples[next] as number) < first + run) {
      out.push(time + ((samples[next] as number) - first) * delta);
      next += 1;
    }
    first += run;
    time += run * delta;
  }
  return out;
}

/** Desfase de composición de las muestras pedidas (0 sin `ctts`), leído con signo como ffmpeg. */
function compositionOffsets(
  data: Buffer,
  ctts: Mp4Box | undefined,
  samples: readonly number[],
): number[] {
  if (!ctts) return samples.map(() => 0);
  const p = payload(ctts);
  const count = data.readUInt32BE(p + 4);
  const out: number[] = [];
  let next = 0;
  let first = 1;
  for (let i = 0; i < count && next < samples.length; i += 1) {
    const pos = p + 8 + i * 8;
    if (pos + 8 > data.length) break;
    const run = data.readUInt32BE(pos);
    const offset = data.readInt32BE(pos + 4);
    while (next < samples.length && (samples[next] as number) < first + run) {
      out.push(offset);
      next += 1;
    }
    first += run;
  }
  while (out.length < samples.length) out.push(0);
  return out;
}

function totalSamples(data: Buffer, stts: Mp4Box): number {
  const p = payload(stts);
  const count = data.readUInt32BE(p + 4);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const pos = p + 8 + i * 8;
    if (pos + 8 > data.length) break;
    total += data.readUInt32BE(pos);
  }
  return total;
}

/** Números (desde 1) de las muestras clave; sin `stss`, todas lo son. */
function syncSamples(data: Buffer, stss: Mp4Box | undefined, stts: Mp4Box): number[] {
  if (!stss) {
    const total = totalSamples(data, stts);
    if (total > 2_000_000) throw vodUnsupported('indice', 'MP4 sin stss y enorme');
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const p = payload(stss);
  const count = data.readUInt32BE(p + 4);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = p + 8 + i * 4;
    if (pos + 4 > data.length) break;
    out.push(data.readUInt32BE(pos));
  }
  return out.sort((a, b) => a - b);
}

// --- Descripciones de muestra ---

interface SampleEntry {
  readonly format: string;
  /** Posición donde empiezan sus cajas hijas. */
  readonly childrenStart: number;
  readonly end: number;
  readonly channelCount: number | null;
}

function firstSampleEntry(
  data: Buffer,
  stsd: Mp4Box,
  kind: 'video' | 'audio' | 'other',
): SampleEntry | null {
  const p = payload(stsd);
  const entry = readBox(data, p + 8);
  if (!entry) return null;
  const base = entry.start + entry.headerSize + 8;
  const end = endOf(data, entry);
  if (kind === 'video')
    return { format: entry.type, childrenStart: base + 70, end, channelCount: null };
  if (kind === 'audio') {
    if (base + 20 > data.length)
      return { format: entry.type, childrenStart: end, end, channelCount: null };
    const version = data.readUInt16BE(base);
    const channels = data.readUInt16BE(base + 8);
    /* QuickTime: las versiones 1 y 2 del sonido añaden 16 y 36 bytes. */
    const extra = version === 1 ? 16 : version === 2 ? 36 : 0;
    return {
      format: entry.type,
      childrenStart: base + 20 + extra,
      end,
      channelCount: channels || null,
    };
  }
  return { format: entry.type, childrenStart: base, end, channelCount: null };
}

function childOf(data: Buffer, entry: SampleEntry, type: string): Mp4Box | undefined {
  return boxes(data, entry.childrenStart, entry.end).find((box) => box.type === type);
}

/** Longitud de un descriptor de MPEG-4 (1-4 bytes de 7 bits). */
function descriptorLength(data: Buffer, pos: number): { length: number; size: number } {
  let length = 0;
  let size = 0;
  for (let i = 0; i < 4 && pos + i < data.length; i += 1) {
    const byte = data[pos + i] as number;
    length = (length << 7) | (byte & 0x7f);
    size += 1;
    if (!(byte & 0x80)) break;
  }
  return { length, size };
}

/** `esds` → tipo de objeto del decodificador y el AudioSpecificConfig. */
function parseEsds(data: Buffer, esds: Mp4Box): { oti: number | null; config: Buffer | null } {
  let pos = payload(esds) + 4;
  const end = endOf(data, esds);
  let oti: number | null = null;
  let config: Buffer | null = null;
  while (pos + 2 <= end) {
    const tag = data[pos] as number;
    const { length, size } = descriptorLength(data, pos + 1);
    const body = pos + 1 + size;
    if (tag === 0x03) {
      const flags = data[body + 2] as number;
      pos = body + 3 + (flags & 0x80 ? 2 : 0);
      if (flags & 0x40) pos += 1 + (data[pos] as number);
      if (flags & 0x20) pos += 2;
      continue;
    }
    if (tag === 0x04) {
      oti = data[body] as number;
      pos = body + 13;
      continue;
    }
    if (tag === 0x05) {
      config = Buffer.from(data.subarray(body, Math.min(end, body + length)));
      break;
    }
    pos = body + length;
  }
  return { oti, config };
}

/** Canales del AudioSpecificConfig (null si no se sabe). */
function aacChannels(config: Buffer | null): number | null {
  if (!config || config.length < 2) return null;
  let bit = 5;
  if ((config[0] as number) >> 3 === 31) bit += 6;
  const read = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = config[(bit + i) >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - ((bit + i) & 7))) & 1);
    }
    bit += count;
    return value;
  };
  const frequencyIndex = read(4);
  if (frequencyIndex === 15) bit += 24;
  const configuration = read(4);
  if (configuration >= 1 && configuration <= 6) return configuration;
  if (configuration === 7) return 8;
  return null;
}

const AC3_CHANNELS = [2, 1, 2, 3, 3, 4, 4, 5];

/** Canales de un `dac3` (acmod + LFE). */
function ac3Channels(data: Buffer, box: Mp4Box | undefined): number | null {
  if (!box) return null;
  const p = payload(box);
  if (p + 3 > data.length) return null;
  const bits = data.readUIntBE(p, 3);
  const acmod = (bits >> 11) & 0x7;
  const lfe = (bits >> 10) & 0x1;
  return (AC3_CHANNELS[acmod] as number) + lfe;
}

/** Canales de un `dec3` (el primer flujo independiente, + 2 si lleva uno dependiente: 7.1). */
function eac3Channels(data: Buffer, box: Mp4Box | undefined): number | null {
  if (!box) return null;
  const p = payload(box);
  if (p + 5 > data.length) return null;
  const bits = data.readUIntBE(p + 2, 3);
  const acmod = (bits >> 9) & 0x7;
  const lfe = (bits >> 8) & 0x1;
  const dependents = (bits >> 1) & 0xf;
  return (AC3_CHANNELS[acmod] as number) + lfe + (dependents > 0 ? 2 : 0);
}

const AUDIO_FORMATS: Readonly<Record<string, string>> = {
  'ac-3': 'ac3',
  'ec-3': 'eac3',
  Opus: 'opus',
  fLaC: 'flac',
  alac: 'alac',
  dtsc: 'dts',
  dtsh: 'dts',
  dtsl: 'dts',
  dtse: 'dts',
  mlpa: 'truehd',
  '.mp3': 'mp3',
  lpcm: 'pcm',
  sowt: 'pcm',
  twos: 'pcm',
};

const SUBTITLE_FORMATS: Readonly<Record<string, readonly [string, boolean]>> = {
  tx3g: ['mov_text', true],
  text: ['mov_text', true],
  wvtt: ['webvtt', true],
  stpp: ['ttml', false],
  c608: ['eia_608', false],
};

// --- Lectura ---

/** Lo que se sabe de cada `trak`. */
interface TrakInfo {
  readonly handler: string;
  readonly header: TrackHeader;
  readonly media: MediaHeader;
  readonly entry: SampleEntry | null;
  readonly name: string | null;
  readonly box: Mp4Box;
}

function trakInfo(data: Buffer, trak: Mp4Box): TrakInfo | null {
  const tkhd = find(data, trak, 'tkhd');
  const mdia = find(data, trak, 'mdia');
  const mdhd = mdia ? find(data, mdia, 'mdhd') : undefined;
  const hdlr = mdia ? find(data, mdia, 'hdlr') : undefined;
  if (!tkhd || !mdia || !mdhd || !hdlr) return null;
  const handler = data.toString('latin1', payload(hdlr) + 8, payload(hdlr) + 12);
  const stsd = path(data, mdia, ['minf', 'stbl', 'stsd']);
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';
  const udtaName = path(data, trak, ['udta', 'name']);
  const name = udtaName
    ? data
        .toString('utf8', payload(udtaName), endOf(data, udtaName))
        .replace(/\0+$/, '')
        .trim()
        .slice(0, 120) || null
    : null;
  return {
    handler,
    header: readTkhd(data, tkhd),
    media: readMdhd(data, mdhd),
    entry: stsd ? firstSampleEntry(data, stsd, kind) : null,
    name,
    box: trak,
  };
}

function videoOf(data: Buffer, trak: TrakInfo): VodVideoInfo {
  const format = trak.entry?.format ?? '';
  const base = {
    width: trak.header.width,
    height: trak.header.height,
  };
  if ((format === 'avc1' || format === 'avc3') && trak.entry) {
    const box = childOf(data, trak.entry, 'avcC');
    const avc = box ? parseAvcC(data.subarray(payload(box), endOf(data, box))) : null;
    if (avc) {
      return {
        ...base,
        codec: 'h264',
        codecs: avc.codecs,
        bitDepth: avc.bitDepth,
        profile: avc.profile,
        chromaFormat: avc.chromaFormat,
      };
    }
  }
  if ((format === 'hvc1' || format === 'hev1') && trak.entry) {
    const box = childOf(data, trak.entry, 'hvcC');
    const hevc = box ? parseHvcC(data.subarray(payload(box), endOf(data, box))) : null;
    if (hevc) {
      return {
        ...base,
        codec: 'hevc',
        codecs: hevc.codecs,
        bitDepth: hevc.bitDepth,
        profile: hevc.profile,
        chromaFormat: hevc.chromaFormat,
      };
    }
  }
  const codec =
    format === 'mp4v'
      ? 'mpeg4'
      : format === 'avc1' || format === 'avc3'
        ? 'h264-sin-config'
        : format === 'hvc1' || format === 'hev1'
          ? 'hevc-sin-config'
          : format || 'desconocido';
  return { ...base, codec, codecs: '', bitDepth: null, profile: null, chromaFormat: null };
}

function audioOf(data: Buffer, trak: TrakInfo, index: number): VodTrack {
  const entry = trak.entry;
  const format = entry?.format ?? '';
  let codec = AUDIO_FORMATS[format] ?? (format.trim().toLowerCase() || 'desconocido');
  let aacLc = false;
  let channels = entry?.channelCount ?? null;
  if (format === 'mp4a' && entry) {
    const esds = childOf(data, entry, 'esds');
    const { oti, config } = esds ? parseEsds(data, esds) : { oti: null, config: null };
    if (oti === 0x6b || oti === 0x69) codec = 'mp3';
    else if (oti === 0x40 || oti === 0x66 || oti === 0x67 || oti === 0x68 || oti === null) {
      codec = 'aac';
      aacLc = isAacLcConfig(config);
      channels = aacChannels(config) ?? channels;
    } else codec = `mp4a.${oti.toString(16)}`;
  } else if (format === 'ac-3' && entry) {
    channels = ac3Channels(data, childOf(data, entry, 'dac3')) ?? channels;
  } else if (format === 'ec-3' && entry) {
    channels = eac3Channels(data, childOf(data, entry, 'dec3')) ?? channels;
  }
  return {
    index,
    codec,
    aacLc,
    channels,
    lang: trak.media.lang,
    name: trak.name,
    isDefault: trak.header.enabled,
  };
}

/**
 * Índice de un MP4. `head` son los primeros bytes del fichero (ya leídos
 * por quien detecta el contenedor).
 */
export async function readMp4Index(reader: RangeReader, head: Buffer): Promise<VodIndex> {
  const moovMax = VOD_PLAY.moovMaxBytes;
  let moovData: Buffer | null = null;
  let pos = 0;
  /* Primer nivel: en la cabecera y, tras el `mdat`, leyendo lo que sigue. */
  let window = head;
  let windowStart = 0;
  let reads = 0;
  for (let inspected = 0; inspected < TAIL_BOXES_MAX * 4; inspected += 1) {
    if (pos + 16 > windowStart + window.length) {
      const size = reader.size();
      if ((size !== null && pos >= size) || reads >= TAIL_BOXES_MAX) break;
      window = await reader.read(pos, pos + TAIL_WINDOW_BYTES - 1);
      windowStart = pos;
      reads += 1;
      if (window.length < 8) break;
    }
    const at = pos - windowStart;
    const box = readBox(window, at);
    if (!box) throw vodUnsupported('indice', 'caja MP4 ilegible');
    if (box.type === 'moof') throw vodUnsupported('indice', 'MP4 fragmentado');
    if (box.type === 'moov') {
      const size = box.size ?? (reader.size() ?? 0) - pos;
      if (size > moovMax) throw vodUnsupported('indice', 'moov enorme');
      if (at + size <= window.length) {
        moovData = Buffer.from(window.subarray(at, at + size));
      } else {
        const have = window.subarray(at);
        const rest = await reader.read(pos + have.length, pos + size - 1);
        moovData = Buffer.concat([have, rest]);
        if (moovData.length < size) throw vodUnsupported('indice', 'moov cortado');
      }
      break;
    }
    if (box.size === null) break;
    pos += box.size;
  }
  if (!moovData) throw vodUnsupported('indice', 'MP4 sin moov');

  const moov = readBox(moovData, 0) as Mp4Box;
  if (find(moovData, moov, 'mvex')) throw vodUnsupported('indice', 'MP4 fragmentado');
  const mvhd = find(moovData, moov, 'mvhd');
  const movie = mvhd ? readMvhd(moovData, mvhd) : { timescale: 1000, duration: null };
  const traks = boxes(moovData, payload(moov), endOf(moovData, moov))
    .filter((box) => box.type === 'trak')
    .map((trak) => trakInfo(moovData as Buffer, trak))
    .filter((info): info is TrakInfo => info !== null);

  const video = traks.find((trak) => trak.handler === 'vide');
  if (!video) throw vodUnsupported('video', 'MP4 sin vídeo');
  const stbl = path(moovData, video.box, ['mdia', 'minf', 'stbl']);
  const stts = stbl ? find(moovData, stbl, 'stts') : undefined;
  if (!stbl || !stts || !video.media.timescale) throw vodUnsupported('indice', 'MP4 sin stts');
  const samples = syncSamples(moovData, find(moovData, stbl, 'stss'), stts);
  const dts = decodeTimes(moovData, stts, samples);
  const cto = compositionOffsets(moovData, find(moovData, stbl, 'ctts'), samples);
  const elst = path(moovData, video.box, ['edts', 'elst']);
  const edit: Edit = elst
    ? readElst(moovData, elst, movie.timescale)
    : { emptyS: 0, mediaTime: 0, segmentS: null };
  const scale = video.media.timescale;
  const keyframes = normalizeKeyframes(
    dts.map((time, i) => (time + (cto[i] as number) - edit.mediaTime) / scale + edit.emptyS),
  );
  if (!keyframes.length) throw vodUnsupported('indice', 'MP4 sin fotogramas clave');

  /* Lo que se presenta: la entrada de la lista de edición si la hay; si no, la pista. */
  const declared =
    edit.segmentS !== null
      ? edit.emptyS + edit.segmentS
      : video.media.duration !== null
        ? (video.media.duration - Math.max(0, edit.mediaTime)) / scale + edit.emptyS
        : movie.duration !== null && movie.timescale
          ? movie.duration / movie.timescale
          : null;

  const audio = traks
    .filter((trak) => trak.handler === 'soun')
    .map((trak, i) => audioOf(moovData as Buffer, trak, i));
  const subtitles: VodSubtitle[] = traks
    .filter((trak) => ['subt', 'text', 'sbtl', 'clcp'].includes(trak.handler))
    .map((trak, index) => {
      const format = trak.entry?.format ?? '';
      const [codec, text] = SUBTITLE_FORMATS[format] ?? [
        format.trim().toLowerCase() || 'desconocido',
        false,
      ];
      return {
        index,
        codec,
        text,
        lang: trak.media.lang,
        name: trak.name,
        isDefault: trak.header.enabled,
        forced: false,
      };
    });

  const size = reader.size();
  if (size === null) throw new AppError('internal_error', { detail: 'tamaño del MP4 sin saber' });
  return {
    container: 'mp4',
    durationS: videoDuration(declared, keyframes),
    keyframes,
    video: videoOf(moovData, video),
    audio,
    subtitles,
    sizeBytes: size,
  };
}
