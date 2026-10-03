/* Escritor mínimo de EBML para las pruebas del índice MKV (docs/vod.md
   §15.1: «ficheros construidos en el test… sin binarios en el repo»).

   `buildMkv` monta un MKV con lo que importa al índice (cabecera, SeekHead,
   Info, Tracks, un Cluster de relleno y los Cues) y deja elegir las rarezas:
   SeekHead que apunta a otro al final, Segment o Cluster de tamaño
   desconocido, relleno grande antes de Tracks, sin Cues, etc. */

const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** Tamaño EBML (VINT) con la longitud mínima. */
export function vint(value: number): Buffer {
  for (let length = 1; length <= 8; length += 1) {
    const max = 2 ** (7 * length) - 2;
    if (value <= max) {
      const out = Buffer.alloc(length);
      let rest = value;
      for (let i = length - 1; i >= 0; i -= 1) {
        out[i] = rest % 256;
        rest = Math.floor(rest / 256);
      }
      out[0] = (out[0] as number) | (0x80 >> (length - 1));
      return out;
    }
  }
  throw new Error('tamaño EBML enorme');
}

function idBytes(id: number): Buffer {
  const bytes: number[] = [];
  let rest = id;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Buffer.from(bytes);
}

export function el(id: number, ...payload: Buffer[]): Buffer {
  const data = Buffer.concat(payload);
  return Buffer.concat([idBytes(id), vint(data.length), data]);
}

export function elUnknown(id: number, ...payload: Buffer[]): Buffer {
  return Buffer.concat([idBytes(id), UNKNOWN_SIZE, ...payload]);
}

export function uint(id: number, value: number, width?: number): Buffer {
  let length = width ?? 1;
  if (width === undefined) while (value >= 2 ** (8 * length)) length += 1;
  const out = Buffer.alloc(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return el(id, out);
}

export function float(id: number, value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeDoubleBE(value);
  return el(id, out);
}

export function str(id: number, value: string): Buffer {
  return el(id, Buffer.from(value, 'utf8'));
}

// --- Un MKV entero ---

const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Void: 0xec,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
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
  Audio: 0xe1,
  Channels: 0x9f,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
} as const;

export interface MkvTrackSpec {
  readonly number: number;
  readonly type: 'video' | 'audio' | 'subtitle';
  readonly codecId: string;
  readonly codecPrivate?: Buffer;
  /** undefined = sin el elemento (la norma dice `eng`). */
  readonly language?: string;
  readonly bcp47?: string;
  readonly name?: string;
  readonly flagDefault?: 0 | 1;
  readonly flagForced?: 0 | 1;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
}

export interface MkvSpec {
  readonly docType?: string;
  /** TimestampScale (por defecto 1 000 000: milisegundos). */
  readonly scale?: number;
  /** Duración en unidades de TimestampScale; null = sin Duration. */
  readonly duration?: number | null;
  readonly tracks: readonly MkvTrackSpec[];
  /** Puntos de los Cues, en unidades de TimestampScale. */
  readonly cues: readonly { readonly time: number; readonly track: number }[];
  readonly clusterBytes?: number;
  /** Relleno (Void) entre el SeekHead y el Info. */
  readonly voidBytes?: number;
  /** El primer SeekHead apunta a otro, al final, que es el que dice dónde están los Cues. */
  readonly seekHeadAtEnd?: boolean;
  readonly unknownSegmentSize?: boolean;
  readonly unknownClusterSize?: boolean;
  readonly noCues?: boolean;
}

function trackEntry(track: MkvTrackSpec): Buffer {
  const type = track.type === 'video' ? 1 : track.type === 'audio' ? 2 : 17;
  const parts = [uint(ID.TrackNumber, track.number), uint(ID.TrackType, type)];
  parts.push(str(ID.CodecID, track.codecId));
  if (track.codecPrivate) parts.push(el(ID.CodecPrivate, track.codecPrivate));
  if (track.language !== undefined) parts.push(str(ID.Language, track.language));
  if (track.bcp47 !== undefined) parts.push(str(ID.LanguageBCP47, track.bcp47));
  if (track.name !== undefined) parts.push(str(ID.Name, track.name));
  if (track.flagDefault !== undefined) parts.push(uint(ID.FlagDefault, track.flagDefault));
  if (track.flagForced !== undefined) parts.push(uint(ID.FlagForced, track.flagForced));
  if (track.type === 'video') {
    parts.push(
      el(
        ID.Video,
        uint(ID.PixelWidth, track.width ?? 1920),
        uint(ID.PixelHeight, track.height ?? 1080),
      ),
    );
  }
  if (track.type === 'audio' && track.channels !== undefined) {
    parts.push(el(ID.Audio, uint(ID.Channels, track.channels)));
  }
  return el(ID.TrackEntry, ...parts);
}

/** SeekHead con posiciones de 8 bytes (así su tamaño no depende de ellas). */
function seekHead(entries: readonly (readonly [number, number])[]): Buffer {
  return el(
    ID.SeekHead,
    ...entries.map(([id, position]) =>
      el(ID.Seek, el(ID.SeekID, idBytes(id)), uint(ID.SeekPosition, position, 8)),
    ),
  );
}

export function buildMkv(spec: MkvSpec): Buffer {
  const header = el(ID.EBML, uint(ID.EBMLVersion, 1), str(ID.DocType, spec.docType ?? 'matroska'));
  const info = el(
    ID.Info,
    uint(ID.TimestampScale, spec.scale ?? 1_000_000),
    ...(spec.duration === null ? [] : [float(ID.Duration, spec.duration ?? 60_000)]),
  );
  const tracks = el(ID.Tracks, ...spec.tracks.map(trackEntry));
  const filler = Buffer.alloc(spec.clusterBytes ?? 4096, 0x5a);
  const cluster = spec.unknownClusterSize
    ? elUnknown(ID.Cluster, uint(ID.Timestamp, 0), filler)
    : el(ID.Cluster, uint(ID.Timestamp, 0), filler);
  const cues = el(
    ID.Cues,
    ...spec.cues.map((cue) =>
      el(
        ID.CuePoint,
        uint(ID.CueTime, cue.time),
        el(ID.CueTrackPositions, uint(ID.CueTrack, cue.track), uint(ID.CueClusterPosition, 0)),
      ),
    ),
  );
  const pad = spec.voidBytes ? el(ID.Void, Buffer.alloc(spec.voidBytes)) : Buffer.alloc(0);

  /* Dos pasadas: los tamaños no dependen de las posiciones (8 bytes fijos). */
  const firstEntries = (positions: Record<string, number>): [number, number][] => {
    const entries: [number, number][] = [
      [ID.Info, positions.info ?? 0],
      [ID.Tracks, positions.tracks ?? 0],
    ];
    if (spec.seekHeadAtEnd) entries.push([ID.SeekHead, positions.tail ?? 0]);
    else if (!spec.noCues) entries.push([ID.Cues, positions.cues ?? 0]);
    return entries;
  };
  const head1 = seekHead(firstEntries({}));
  const positions: Record<string, number> = {};
  let pos = head1.length + pad.length;
  positions.info = pos;
  pos += info.length;
  positions.tracks = pos;
  pos += tracks.length + cluster.length;
  positions.cues = pos;
  if (!spec.noCues) pos += cues.length;
  positions.tail = pos;
  const body = Buffer.concat([
    seekHead(firstEntries(positions)),
    pad,
    info,
    tracks,
    cluster,
    spec.noCues ? Buffer.alloc(0) : cues,
    spec.seekHeadAtEnd ? seekHead([[ID.Cues, positions.cues ?? 0]]) : Buffer.alloc(0),
  ]);
  const segment = spec.unknownSegmentSize ? elUnknown(ID.Segment, body) : el(ID.Segment, body);
  return Buffer.concat([header, segment]);
}
