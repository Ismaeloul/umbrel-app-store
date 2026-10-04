/* Índice de un MKV leído por Range, sin ffmpeg (docs/vod.md §9.4).

   EBML: cabecera (DocType `matroska` o `webm`) → Segment → SeekHead (y el
   segundo SeekHead si el primero apunta a él, p. ej. al final del fichero)
   → Info (TimestampScale, Duration) → Tracks → Cues de la pista de vídeo.
   Lo normal son 2-3 peticiones y unas decenas de KB: la cabecera (que ya
   suele traer SeekHead, Info y Tracks) y los Cues (casi siempre al final).

   - Un Segment o un Cluster de tamaño desconocido (MKV grabados en directo)
     se aceptan: las posiciones del SeekHead cuentan desde el principio de
     los datos del Segment y la cabecera se recorre hasta el primer Cluster.
   - Sin Cues no hay saltos: `vod_unsupported('indice')`.
   - Los tiempos de los fotogramas clave son los CueTime de la pista de
     vídeo × TimestampScale, como los da ffprobe (49/49 y 30/30 en el
     experimento). */

import { AppError } from '../../../core/errors.js';
import {
  mkvAacIsLc,
  normalizeKeyframes,
  parseAvcC,
  parseHvcC,
  videoDuration,
  vodUnsupported,
} from './codecs.js';
import { keyframeBytesOf } from './rate.js';
import type { RangeReader, VodIndex, VodSubtitle, VodTrack, VodVideoInfo } from './types.js';

// --- IDs (Matroska, RFC 9559) ---

export const MKV_ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagEnabled: 0xb9,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  Name: 0x536e,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Colour: 0x55b0,
  BitsPerChannel: 0x55b2,
  Audio: 0xe1,
  Channels: 0x9f,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
} as const;

/** Lo primero que se lee del fichero (el relé guarda los 2 primeros MiB). */
export const MKV_HEAD_BYTES = 256 * 1024;
/** Ventana con la que se leen los Cues de una vez (si son más, una lectura más). */
const CUES_WINDOW_BYTES = 512 * 1024;
/** Tope de un Info, un Tracks o un SeekHead leído aparte. */
const ELEMENT_MAX_BYTES = 4 * 1024 * 1024;
/** Tope de los Cues (el mismo que el moov de un MP4). */
const CUES_MAX_BYTES = 32 * 1024 * 1024;

const TRACK_VIDEO = 1;
const TRACK_AUDIO = 2;
const TRACK_SUBTITLE = 17;

// --- EBML ---

export interface EbmlElement {
  readonly id: number;
  /** Posición (en el búfer) del principio de la cabecera. */
  readonly start: number;
  /** Posición del principio de los datos. */
  readonly dataStart: number;
  /** Tamaño de los datos, o null si es desconocido (todo unos). */
  readonly size: number | null;
}

/** Lee un ID (1-4 bytes, con su marca). null si no cabe o no es válido. */
function readId(data: Buffer, pos: number): { id: number; length: number } | null {
  if (pos >= data.length) return null;
  const first = data[pos] as number;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 4 || pos + length > data.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + (data[pos + i] as number);
  return { id, length };
}

/** Lee un tamaño (VINT de 1-8 bytes, sin la marca). `size` null = desconocido. */
function readSize(data: Buffer, pos: number): { size: number | null; length: number } | null {
  if (pos >= data.length) return null;
  const first = data[pos] as number;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || pos + length > data.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = data[pos + i] as number;
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  if (allOnes) return { size: null, length };
  if (!Number.isSafeInteger(value)) return null;
  return { size: value, length };
}

/** Cabecera de un elemento en `pos`; null si no cabe entera en el búfer. */
export function readElement(data: Buffer, pos: number): EbmlElement | null {
  const id = readId(data, pos);
  if (!id) return null;
  const size = readSize(data, pos + id.length);
  if (!size) return null;
  return { id: id.id, start: pos, dataStart: pos + id.length + size.length, size: size.size };
}

/**
 * Hijos de [start, end) del búfer. Un hijo de tamaño desconocido llega
 * hasta `end`; uno que se sale del búfer se devuelve igual (quien lo lee
 * mira si cabe).
 */
export function children(data: Buffer, start: number, end: number): EbmlElement[] {
  const out: EbmlElement[] = [];
  let pos = start;
  const limit = Math.min(end, data.length);
  while (pos < limit) {
    const element = readElement(data, pos);
    if (!element) break;
    out.push(element);
    if (element.size === null) break;
    pos = element.dataStart + element.size;
  }
  return out;
}

const endOf = (element: EbmlElement, fallback: number): number =>
  element.size === null ? fallback : element.dataStart + element.size;

function uintOf(data: Buffer, element: EbmlElement): number {
  const end = Math.min(endOf(element, element.dataStart), data.length);
  let value = 0;
  for (let i = element.dataStart; i < end; i += 1) value = value * 256 + (data[i] as number);
  return value;
}

function floatOf(data: Buffer, element: EbmlElement): number | null {
  if (element.size === 4) return data.readFloatBE(element.dataStart);
  if (element.size === 8) return data.readDoubleBE(element.dataStart);
  return null;
}

function stringOf(data: Buffer, element: EbmlElement): string {
  const end = Math.min(endOf(element, element.dataStart), data.length);
  return data.toString('utf8', element.dataStart, end).replace(/\0+$/, '');
}

function bytesOf(data: Buffer, element: EbmlElement): Buffer {
  const end = Math.min(endOf(element, element.dataStart), data.length);
  return Buffer.from(data.subarray(element.dataStart, end));
}

const fits = (data: Buffer, element: EbmlElement): boolean =>
  element.size !== null && element.dataStart + element.size <= data.length;

// --- Pistas ---

interface RawTrack {
  number: number;
  type: number;
  codecId: string;
  codecPrivate: Buffer | null;
  lang: string | null;
  name: string | null;
  isDefault: boolean;
  forced: boolean;
  width: number | null;
  height: number | null;
  bitsPerChannel: number | null;
  channels: number | null;
}

/** Lengua de la pista: BCP 47 si viene; si no, ISO 639-2 (sin el elemento es `eng`, como dice la norma). */
function languageOf(bcp47: string | null, iso: string | null): string | null {
  const value = (bcp47 ?? iso ?? 'eng').trim();
  if (!value || value === 'und' || value === 'mul' || value === 'zxx') return null;
  return value.slice(0, 35);
}

function parseTrackEntry(data: Buffer, entry: EbmlElement): RawTrack {
  const track: RawTrack = {
    number: 0,
    type: 0,
    codecId: '',
    codecPrivate: null,
    lang: null,
    name: null,
    isDefault: true,
    forced: false,
    width: null,
    height: null,
    bitsPerChannel: null,
    channels: null,
  };
  let iso: string | null = null;
  let bcp47: string | null = null;
  for (const child of children(data, entry.dataStart, endOf(entry, data.length))) {
    switch (child.id) {
      case MKV_ID.TrackNumber:
        track.number = uintOf(data, child);
        break;
      case MKV_ID.TrackType:
        track.type = uintOf(data, child);
        break;
      case MKV_ID.CodecID:
        track.codecId = stringOf(data, child);
        break;
      case MKV_ID.CodecPrivate:
        track.codecPrivate = bytesOf(data, child);
        break;
      case MKV_ID.Language:
        iso = stringOf(data, child);
        break;
      case MKV_ID.LanguageBCP47:
        bcp47 = stringOf(data, child);
        break;
      case MKV_ID.Name:
        track.name = stringOf(data, child).trim().slice(0, 120) || null;
        break;
      case MKV_ID.FlagDefault:
        track.isDefault = uintOf(data, child) !== 0;
        break;
      case MKV_ID.FlagForced:
        track.forced = uintOf(data, child) !== 0;
        break;
      case MKV_ID.Video:
        for (const v of children(data, child.dataStart, endOf(child, data.length))) {
          if (v.id === MKV_ID.PixelWidth) track.width = uintOf(data, v);
          else if (v.id === MKV_ID.PixelHeight) track.height = uintOf(data, v);
          else if (v.id === MKV_ID.Colour) {
            for (const c of children(data, v.dataStart, endOf(v, data.length))) {
              if (c.id === MKV_ID.BitsPerChannel) track.bitsPerChannel = uintOf(data, c) || null;
            }
          }
        }
        break;
      case MKV_ID.Audio:
        for (const a of children(data, child.dataStart, endOf(child, data.length))) {
          if (a.id === MKV_ID.Channels) track.channels = uintOf(data, a);
        }
        break;
      default:
        break;
    }
  }
  track.lang = languageOf(bcp47, iso);
  /* Channels vale 1 si no viene (la norma). */
  if (track.type === TRACK_AUDIO && track.channels === null) track.channels = 1;
  return track;
}

/** Códec de vídeo desde el CodecID (y el FourCC de VFW). */
function videoCodec(codecId: string, codecPrivate: Buffer | null): string {
  if (codecId === 'V_MPEG4/ISO/AVC') return 'h264';
  if (codecId === 'V_MPEGH/ISO/HEVC') return 'hevc';
  if (codecId.startsWith('V_MPEG4/ISO/')) return 'mpeg4';
  if (codecId === 'V_MPEG2') return 'mpeg2video';
  if (codecId === 'V_MPEG1') return 'mpeg1video';
  if (codecId === 'V_MS/VFW/FOURCC' && codecPrivate && codecPrivate.length >= 20) {
    return `vfw:${codecPrivate.toString('latin1', 16, 20).trim().toLowerCase()}`;
  }
  return codecId.replace(/^V_/, '').toLowerCase() || 'desconocido';
}

const AUDIO_CODECS: readonly (readonly [RegExp, string])[] = [
  [/^A_AAC/, 'aac'],
  [/^A_AC3/, 'ac3'],
  [/^A_EAC3/, 'eac3'],
  [/^A_DTS/, 'dts'],
  [/^A_TRUEHD/, 'truehd'],
  [/^A_MLP/, 'mlp'],
  [/^A_FLAC/, 'flac'],
  [/^A_OPUS/, 'opus'],
  [/^A_VORBIS/, 'vorbis'],
  [/^A_MPEG\/L3/, 'mp3'],
  [/^A_MPEG\/L2/, 'mp2'],
  [/^A_MPEG\/L1/, 'mp1'],
  [/^A_PCM\//, 'pcm'],
];

function audioCodec(codecId: string): string {
  for (const [pattern, name] of AUDIO_CODECS) if (pattern.test(codecId)) return name;
  return codecId.replace(/^A_/, '').toLowerCase() || 'desconocido';
}

const SUBTITLE_CODECS: Readonly<Record<string, readonly [string, boolean]>> = {
  'S_TEXT/UTF8': ['subrip', true],
  'S_TEXT/ASCII': ['subrip', true],
  'S_TEXT/ASS': ['ass', true],
  'S_TEXT/SSA': ['ass', true],
  S_ASS: ['ass', true],
  S_SSA: ['ass', true],
  'S_TEXT/WEBVTT': ['webvtt', true],
  'S_HDMV/PGS': ['hdmv_pgs_subtitle', false],
  S_VOBSUB: ['dvd_subtitle', false],
  S_DVBSUB: ['dvb_subtitle', false],
  'S_HDMV/TEXTST': ['hdmv_text_subtitle', false],
};

function videoInfo(track: RawTrack): VodVideoInfo {
  const codec = videoCodec(track.codecId, track.codecPrivate);
  if (codec === 'h264' && track.codecPrivate) {
    const avc = parseAvcC(track.codecPrivate);
    if (avc) {
      return {
        codec,
        codecs: avc.codecs,
        width: track.width,
        height: track.height,
        bitDepth: avc.bitDepth ?? track.bitsPerChannel,
        profile: avc.profile,
        chromaFormat: avc.chromaFormat,
      };
    }
  }
  if (codec === 'hevc' && track.codecPrivate) {
    const hevc = parseHvcC(track.codecPrivate);
    if (hevc) {
      return {
        codec,
        codecs: hevc.codecs,
        width: track.width,
        height: track.height,
        bitDepth: hevc.bitDepth,
        profile: hevc.profile,
        chromaFormat: hevc.chromaFormat,
      };
    }
  }
  /* Sin avcC/hvcC no se puede copiar a MP4: se apunta como lo que es y
     assertPlayable lo rechaza si hace falta. */
  return {
    codec: codec === 'h264' || codec === 'hevc' ? `${codec}-sin-config` : codec,
    codecs: '',
    width: track.width,
    height: track.height,
    bitDepth: track.bitsPerChannel,
    profile: null,
    chromaFormat: null,
  };
}

// --- Lectura ---

interface Located {
  /** Posición absoluta en el fichero. */
  readonly offset: number;
  readonly data: Buffer;
  readonly element: EbmlElement;
}

/** Lee el elemento que empieza en `offset` (absoluto), entero, con un tope. */
async function readWhole(
  reader: RangeReader,
  offset: number,
  window: number,
  max: number,
): Promise<Located> {
  let data = await reader.read(offset, offset + window - 1);
  const element = readElement(data, 0);
  if (!element || element.size === null) {
    throw vodUnsupported('indice', 'elemento MKV ilegible');
  }
  const total = element.dataStart + element.size;
  if (total > max) throw vodUnsupported('indice', 'elemento MKV enorme');
  if (total > data.length) {
    const rest = await reader.read(offset + data.length, offset + total - 1);
    data = Buffer.concat([data, rest]);
    if (data.length < total) throw vodUnsupported('indice', 'elemento MKV cortado');
  }
  return { offset, data, element };
}

/** Lo que dice el SeekHead: posición absoluta de cada elemento de primer nivel. */
function parseSeekHead(
  data: Buffer,
  element: EbmlElement,
  segmentStart: number,
  into: Map<number, number>,
): void {
  for (const seek of children(data, element.dataStart, endOf(element, data.length))) {
    if (seek.id !== MKV_ID.Seek) continue;
    let id: number | null = null;
    let position: number | null = null;
    for (const field of children(data, seek.dataStart, endOf(seek, data.length))) {
      if (field.id === MKV_ID.SeekID) id = uintOf(data, field);
      else if (field.id === MKV_ID.SeekPosition) position = uintOf(data, field);
    }
    if (id !== null && position !== null && !into.has(id)) into.set(id, segmentStart + position);
  }
}

/**
 * Índice de un MKV. `head` son los primeros bytes del fichero (ya leídos
 * por quien detecta el contenedor).
 */
export async function readMkvIndex(reader: RangeReader, head: Buffer): Promise<VodIndex> {
  return (await readMkv(reader, head, false)) as VodIndex;
}

/**
 * Solo las pistas de audio y de subtítulos de un MKV (la ficha, docs/vod.md
 * §4.11): la cabecera y `Tracks`, sin los Cues (unos pocos KB).
 */
export async function readMkvTracks(
  reader: RangeReader,
  head: Buffer,
): Promise<Pick<VodIndex, 'audio' | 'subtitles'>> {
  const { tracks } = (await readMkv(reader, head, true)) as { tracks: RawTrack[] };
  return { audio: audioTracksOf(tracks), subtitles: subtitleTracksOf(tracks) };
}

function audioTracksOf(raw: readonly RawTrack[]): VodTrack[] {
  return raw
    .filter((track) => track.type === TRACK_AUDIO)
    .map((track, index) => {
      const codec = audioCodec(track.codecId);
      return {
        index,
        codec,
        aacLc: codec === 'aac' && mkvAacIsLc(track.codecId, track.codecPrivate),
        channels: track.channels,
        lang: track.lang,
        name: track.name,
        isDefault: track.isDefault,
      };
    });
}

function subtitleTracksOf(raw: readonly RawTrack[]): VodSubtitle[] {
  return raw
    .filter((track) => track.type === TRACK_SUBTITLE)
    .map((track, index) => {
      const [codec, text] = SUBTITLE_CODECS[track.codecId] ?? [
        track.codecId.replace(/^S_/, '').toLowerCase(),
        false,
      ];
      return {
        index,
        codec,
        text,
        lang: track.lang,
        name: track.name,
        isDefault: track.isDefault,
        forced: track.forced,
      };
    });
}

async function readMkv(
  reader: RangeReader,
  head: Buffer,
  tracksOnly: boolean,
): Promise<VodIndex | { readonly tracks: RawTrack[] }> {
  const ebml = readElement(head, 0);
  if (!ebml || ebml.id !== MKV_ID.EBML || !fits(head, ebml)) {
    throw vodUnsupported('formato', 'cabecera EBML ilegible');
  }
  let docType = 'matroska';
  for (const child of children(head, ebml.dataStart, endOf(ebml, head.length))) {
    if (child.id === MKV_ID.DocType) docType = stringOf(head, child);
  }
  if (docType !== 'matroska' && docType !== 'webm') {
    throw vodUnsupported('formato', `DocType ${docType.slice(0, 20)}`);
  }
  const segment = readElement(head, endOf(ebml, head.length));
  if (!segment || segment.id !== MKV_ID.Segment) {
    throw vodUnsupported('formato', 'MKV sin Segment');
  }
  const segmentStart = segment.dataStart;

  /* Primer nivel dentro de la cabecera, hasta el primer Cluster. */
  const positions = new Map<number, number>();
  const found = new Map<number, Located>();
  const seekHeads: EbmlElement[] = [];
  for (const child of children(head, segmentStart, head.length)) {
    if (child.id === MKV_ID.Cluster) break;
    if (!fits(head, child)) {
      positions.set(child.id, child.start);
      break;
    }
    if (child.id === MKV_ID.SeekHead) seekHeads.push(child);
    else if (!found.has(child.id)) found.set(child.id, { offset: 0, data: head, element: child });
  }
  for (const seekHead of seekHeads) parseSeekHead(head, seekHead, segmentStart, positions);
  /* Un SeekHead puede apuntar a otro (al final del fichero, con los Cues). */
  const second = positions.get(MKV_ID.SeekHead);
  if (second !== undefined && second >= head.length) {
    const more = await readWhole(reader, second, 64 * 1024, ELEMENT_MAX_BYTES);
    if (more.element.id === MKV_ID.SeekHead) {
      parseSeekHead(more.data, more.element, segmentStart, positions);
    }
  }

  const locate = async (id: number, window: number, max: number): Promise<Located | null> => {
    const already = found.get(id);
    if (already) return already;
    const offset = positions.get(id);
    if (offset === undefined) return null;
    const located = await readWhole(reader, offset, window, max);
    if (located.element.id !== id) throw vodUnsupported('indice', 'SeekHead del MKV no válido');
    return located;
  };

  const info = await locate(MKV_ID.Info, 64 * 1024, ELEMENT_MAX_BYTES);
  const tracks = await locate(MKV_ID.Tracks, 256 * 1024, ELEMENT_MAX_BYTES);
  if (!tracks) throw vodUnsupported('indice', 'MKV sin Tracks');

  let timestampScale = 1_000_000;
  let declaredTicks: number | null = null;
  if (info) {
    const { data, element } = info;
    for (const child of children(data, element.dataStart, endOf(element, data.length))) {
      if (child.id === MKV_ID.TimestampScale) timestampScale = uintOf(data, child) || 1_000_000;
      else if (child.id === MKV_ID.Duration) declaredTicks = floatOf(data, child);
    }
  }

  const raw: RawTrack[] = [];
  for (const entry of children(
    tracks.data,
    tracks.element.dataStart,
    endOf(tracks.element, tracks.data.length),
  )) {
    if (entry.id === MKV_ID.TrackEntry) raw.push(parseTrackEntry(tracks.data, entry));
  }
  if (tracksOnly) return { tracks: raw };
  const videoTrack = raw.find((track) => track.type === TRACK_VIDEO);
  if (!videoTrack) throw vodUnsupported('video', 'MKV sin vídeo');

  const cues = await locate(MKV_ID.Cues, CUES_WINDOW_BYTES, CUES_MAX_BYTES);
  if (!cues) throw vodUnsupported('indice', 'MKV sin Cues');
  const ticks: number[] = [];
  /* Dónde empieza (en el fichero) el cluster de cada CueTime del vídeo: la tasa de bits cerca del cabezal. */
  const clusterAt = new Map<number, number>();
  const { data, element } = cues;
  for (const point of children(data, element.dataStart, endOf(element, data.length))) {
    if (point.id !== MKV_ID.CuePoint) continue;
    let time: number | null = null;
    let isVideo = false;
    let cluster: number | null = null;
    for (const field of children(data, point.dataStart, endOf(point, data.length))) {
      if (field.id === MKV_ID.CueTime) time = uintOf(data, field);
      else if (field.id === MKV_ID.CueTrackPositions) {
        let mine = false;
        let at: number | null = null;
        for (const position of children(data, field.dataStart, endOf(field, data.length))) {
          if (position.id === MKV_ID.CueTrack && uintOf(data, position) === videoTrack.number) {
            mine = true;
          } else if (position.id === MKV_ID.CueClusterPosition) at = uintOf(data, position);
        }
        if (mine) {
          isVideo = true;
          if (at !== null) cluster = segmentStart + at;
        }
      }
    }
    if (time !== null && isVideo) {
      ticks.push(time);
      if (cluster !== null && !clusterAt.has(time)) clusterAt.set(time, cluster);
    }
  }
  /* (tick × escala) / 1e9 y no tick × (escala / 1e9): sale el mismo número que da ffprobe. */
  const toSeconds = (tick: number): number => (tick * timestampScale) / 1e9;
  const keyframes = normalizeKeyframes(ticks.map(toSeconds));
  if (!keyframes.length) throw vodUnsupported('indice', 'Cues sin la pista de vídeo');
  const keyframeBytes = keyframeBytesOf(
    keyframes,
    [...clusterAt].map(([tick, at]) => [toSeconds(tick), at]),
  );

  const audio = audioTracksOf(raw);
  const subtitles = subtitleTracksOf(raw);

  const size = reader.size();
  if (size === null) throw new AppError('internal_error', { detail: 'tamaño del MKV sin saber' });
  return {
    container: 'mkv',
    durationS: videoDuration(declaredTicks === null ? null : toSeconds(declaredTicks), keyframes),
    keyframes,
    ...(keyframeBytes ? { keyframeBytes } : {}),
    video: videoInfo(videoTrack),
    audio,
    subtitles,
    sizeBytes: size,
  };
}
