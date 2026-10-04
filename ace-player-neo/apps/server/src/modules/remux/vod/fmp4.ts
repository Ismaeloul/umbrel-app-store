/* Troceador del fMP4 que saca ffmpeg por su tubería (docs/vod.md §9.7).

   Lee las cajas de primer nivel EN STREAMING (tamaños de 32 y 64 bits, una
   cabecera partida entre dos trozos, `size = 0` hasta el final):

   - `ftyp` + `moov` → el init (`init.mp4`), con lo que hace falta de cada
     pista: id, tipo, escala, lista de edición y los bytes de su `stsd` (para
     saber si el init de un reinicio es compatible con el primero).
   - Cada `moof` se guarda entero (es pequeño) y se lee: del `traf` del VÍDEO,
     `tfdt` (con signo en la versión 1: el audio de una ejecución desde 0 da
     −1024, P2; por eso solo se usa el del vídeo), desfase de composición de
     la primera muestra, si es clave y la duración. Con eso se sabe dónde se
     presenta el fragmento (`tfdt` + desfase − `elst`, P4) ANTES de que llegue
     su `mdat`.
   - Los bytes del fragmento (`moof` y luego el `mdat` a trozos) salen tal
     cual, sin juntarse: nunca hay un segmento entero en memoria (a 25 Mb/s,
     15 s son 47 MB).
   - Lo demás (`mfra`, `free`, `sidx`, `styp`…) se salta. */

import { AppError } from '../../../core/errors.js';

/** Tope del `ftyp`/`moov`/`moof` que se guardan en memoria. */
const META_MAX_BYTES = 8 * 1024 * 1024;

export interface Fmp4Track {
  readonly id: number;
  /** `vide`, `soun`… */
  readonly handler: string;
  readonly timescale: number;
  /** `media_time` de la primera entrada normal de su `elst` (0 sin lista). */
  readonly elstMediaTime: number;
  /** Retraso de las entradas vacías del `elst`, en segundos. */
  readonly emptyEditS: number;
  /** Los bytes de su `stsd`. */
  readonly stsd: Buffer;
}

export interface Fmp4Init {
  /** `ftyp` + `moov`, tal cual (lo que se sirve como `init.mp4`). */
  readonly bytes: Buffer;
  readonly tracks: readonly Fmp4Track[];
  /** La pista de vídeo (null si no hay). */
  readonly video: Fmp4Track | null;
}

export interface Fmp4FragmentInfo {
  readonly sequence: number;
  /** Dónde se presenta su primera muestra de vídeo, en segundos (P4); null sin vídeo. */
  readonly startS: number | null;
  /** `tfdt` del vídeo en segundos (null sin vídeo). */
  readonly decodeS: number | null;
  /** Duración del vídeo del fragmento, en segundos. */
  readonly durationS: number;
  /** ¿Empieza por un fotograma clave? (null si `trun` no lo dice). */
  readonly firstIsSync: boolean | null;
}

export interface Fmp4Handlers {
  onInit(init: Fmp4Init): void;
  /** Empieza un fragmento (su `moof` ya está leído). Lo que sigue son sus bytes. */
  onFragment(info: Fmp4FragmentInfo): void;
  /** Bytes del fragmento en curso (el `moof` entero y luego el `mdat` a trozos). */
  onData(chunk: Buffer): void;
  /** Se acaba el fragmento en curso (su `mdat` está entero). */
  onFragmentEnd(): void;
}

function fmp4Error(detail: string): AppError {
  return new AppError('vod_dropped', { detail: `fMP4: ${detail}` });
}

// --- Cajas (en un búfer entero) ---

interface Box {
  readonly type: string;
  readonly start: number;
  readonly headerSize: number;
  readonly end: number;
}

function children(data: Buffer, start: number, end: number): Box[] {
  const out: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = data.readUInt32BE(pos);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(data.readBigUInt64BE(pos + 8));
      headerSize = 16;
    } else if (size === 0) size = end - pos;
    if (size < headerSize || pos + size > end) break;
    out.push({
      type: data.toString('latin1', pos + 4, pos + 8),
      start: pos,
      headerSize,
      end: pos + size,
    });
    pos += size;
  }
  return out;
}

const inner = (data: Buffer, parent: Box): Box[] =>
  children(data, parent.start + parent.headerSize, parent.end);
const child = (data: Buffer, parent: Box, type: string): Box | undefined =>
  inner(data, parent).find((box) => box.type === type);
const body = (box: Box): number => box.start + box.headerSize;

function readTrack(data: Buffer, trak: Box, movieTimescale: number): Fmp4Track | null {
  const tkhd = child(data, trak, 'tkhd');
  const mdia = child(data, trak, 'mdia');
  const mdhd = mdia ? child(data, mdia, 'mdhd') : undefined;
  const hdlr = mdia ? child(data, mdia, 'hdlr') : undefined;
  if (!tkhd || !mdhd || !hdlr || !mdia) return null;
  const tkhdVersion = data[body(tkhd)];
  const id = data.readUInt32BE(body(tkhd) + (tkhdVersion === 1 ? 20 : 12));
  const mdhdVersion = data[body(mdhd)];
  const timescale = data.readUInt32BE(body(mdhd) + (mdhdVersion === 1 ? 20 : 12));
  const handler = data.toString('latin1', body(hdlr) + 8, body(hdlr) + 12);
  let elstMediaTime = 0;
  let empty = 0;
  const edts = child(data, trak, 'edts');
  const elst = edts ? child(data, edts, 'elst') : undefined;
  if (elst) {
    const p = body(elst);
    const version = data[p];
    const count = data.readUInt32BE(p + 4);
    let pos = p + 8;
    for (let i = 0; i < count && pos < elst.end; i += 1) {
      const segment = version === 1 ? Number(data.readBigUInt64BE(pos)) : data.readUInt32BE(pos);
      const mediaTime =
        version === 1 ? Number(data.readBigInt64BE(pos + 8)) : data.readInt32BE(pos + 4);
      pos += version === 1 ? 20 : 12;
      if (mediaTime === -1) {
        empty += segment;
        continue;
      }
      elstMediaTime = mediaTime;
      break;
    }
  }
  const minf = child(data, mdia, 'minf');
  const stbl = minf ? child(data, minf, 'stbl') : undefined;
  const stsd = stbl ? child(data, stbl, 'stsd') : undefined;
  return {
    id,
    handler,
    timescale,
    elstMediaTime,
    emptyEditS: movieTimescale ? empty / movieTimescale : 0,
    stsd: stsd ? Buffer.from(data.subarray(stsd.start, stsd.end)) : Buffer.alloc(0),
  };
}

/** Lo que importa del `moov` de un fMP4. */
export function parseInit(bytes: Buffer): Fmp4Init {
  const moov = children(bytes, 0, bytes.length).find((box) => box.type === 'moov');
  if (!moov) throw fmp4Error('init sin moov');
  const mvhd = child(bytes, moov, 'mvhd');
  let movieTimescale = 1000;
  if (mvhd) {
    const version = bytes[body(mvhd)];
    movieTimescale = bytes.readUInt32BE(body(mvhd) + (version === 1 ? 20 : 12)) || 1000;
  }
  const tracks = inner(bytes, moov)
    .filter((box) => box.type === 'trak')
    .map((trak) => readTrack(bytes, trak, movieTimescale))
    .filter((track): track is Fmp4Track => track !== null);
  return { bytes, tracks, video: tracks.find((track) => track.handler === 'vide') ?? null };
}

/** ¿Se puede servir el fragmento de una ejecución con el init de otra? (mismos `stsd`). */
export function sameCodecs(a: Fmp4Init, b: Fmp4Init): boolean {
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((track, i) => {
    const other = b.tracks[i] as Fmp4Track;
    return (
      track.id === other.id && track.handler === other.handler && track.stsd.equals(other.stsd)
    );
  });
}

/** Lo que dice el `moof` del vídeo (P2: `tfdt` v1 con signo; P4: tiempo de presentación). */
export function parseMoof(moof: Buffer, init: Fmp4Init): Fmp4FragmentInfo {
  const root = children(moof, 0, moof.length)[0];
  if (!root || root.type !== 'moof') throw fmp4Error('moof ilegible');
  const mfhd = child(moof, root, 'mfhd');
  const sequence = mfhd ? moof.readUInt32BE(body(mfhd) + 4) : 0;
  const video = init.video;
  const empty: Fmp4FragmentInfo = {
    sequence,
    startS: null,
    decodeS: null,
    durationS: 0,
    firstIsSync: null,
  };
  if (!video) return empty;
  for (const traf of inner(moof, root)) {
    if (traf.type !== 'traf') continue;
    const tfhd = child(moof, traf, 'tfhd');
    if (!tfhd || moof.readUInt32BE(body(tfhd) + 4) !== video.id) continue;
    const tfhdFlags = moof.readUIntBE(body(tfhd) + 1, 3);
    let pos = body(tfhd) + 8;
    if (tfhdFlags & 0x1) pos += 8;
    if (tfhdFlags & 0x2) pos += 4;
    const defaultDuration = tfhdFlags & 0x8 ? moof.readUInt32BE(pos) : 0;
    if (tfhdFlags & 0x8) pos += 4;
    if (tfhdFlags & 0x10) pos += 4;
    const defaultFlags = tfhdFlags & 0x20 ? moof.readUInt32BE(pos) : null;
    const tfdt = child(moof, traf, 'tfdt');
    if (!tfdt) throw fmp4Error('traf sin tfdt');
    const decode =
      moof[body(tfdt)] === 1
        ? Number(moof.readBigInt64BE(body(tfdt) + 4))
        : moof.readUInt32BE(body(tfdt) + 4);
    let cto = 0;
    let duration = 0;
    let firstFlags = defaultFlags;
    for (const trun of inner(moof, traf).filter((box) => box.type === 'trun')) {
      const p = body(trun);
      const version = moof[p];
      const flags = moof.readUIntBE(p + 1, 3);
      const count = moof.readUInt32BE(p + 4);
      let q = p + 8;
      if (flags & 0x1) q += 4;
      const first = duration === 0;
      if (flags & 0x4) {
        if (first) firstFlags = moof.readUInt32BE(q);
        q += 4;
      }
      for (let i = 0; i < count && q <= trun.end; i += 1) {
        duration += flags & 0x100 ? moof.readUInt32BE(q) : defaultDuration;
        if (flags & 0x100) q += 4;
        if (flags & 0x200) q += 4;
        if (flags & 0x400) {
          if (first && i === 0 && !(flags & 0x4)) firstFlags = moof.readUInt32BE(q);
          q += 4;
        }
        if (flags & 0x800) {
          if (first && i === 0) cto = version === 1 ? moof.readInt32BE(q) : moof.readUInt32BE(q);
          q += 4;
        }
      }
    }
    const scale = video.timescale || 1;
    return {
      sequence,
      startS: (decode + cto - video.elstMediaTime) / scale + video.emptyEditS,
      decodeS: decode / scale,
      durationS: duration / scale,
      /* sample_is_non_sync_sample (bit 16) a 0 = clave. */
      firstIsSync: firstFlags === null ? null : (firstFlags & 0x10000) === 0,
    };
  }
  return empty;
}

// --- Streaming ---

type State =
  | { readonly kind: 'header' }
  /** Guardando una caja entera (ftyp, moov, moof). */
  | {
      readonly kind: 'meta';
      readonly type: string;
      readonly size: number;
      parts: Buffer[];
      have: number;
    }
  /** Pasando el mdat del fragmento en curso. */
  | { readonly kind: 'mdat'; remaining: number | null }
  /** Saltando una caja que no interesa. */
  | { readonly kind: 'skip'; remaining: number | null };

export class Fmp4Splitter {
  private pending: Buffer = Buffer.alloc(0);
  private state: State = { kind: 'header' };
  private ftyp: Buffer | null = null;
  private init: Fmp4Init | null = null;
  private inFragment = false;
  private broken = false;

  constructor(private readonly handlers: Fmp4Handlers) {}

  /** El init de esta ejecución (null hasta que llega el `moov`). */
  get currentInit(): Fmp4Init | null {
    return this.init;
  }

  push(chunk: Buffer): void {
    if (this.broken) return;
    try {
      this.consume(chunk);
    } catch (error) {
      this.broken = true;
      throw error;
    }
  }

  /** Fin de la salida: un fragmento a medias o una caja cortada es un error. */
  end(): void {
    if (this.broken) return;
    /* Un `mdat` o una caja «hasta el final» (`size = 0`) acaban aquí. */
    if (this.state.kind === 'mdat' && this.state.remaining === null) this.finishFragment();
    if (this.state.kind === 'skip' && this.state.remaining === null)
      this.state = { kind: 'header' };
    if (this.state.kind !== 'header' || this.pending.length) {
      this.broken = true;
      throw fmp4Error('salida cortada a mitad de una caja');
    }
  }

  private consume(chunk: Buffer): void {
    let data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    while (data.length) {
      const state = this.state;
      if (state.kind === 'header') {
        if (data.length < 8) break;
        let size = data.readUInt32BE(0);
        const type = data.toString('latin1', 4, 8);
        let headerSize = 8;
        if (size === 1) {
          if (data.length < 16) break;
          const large = data.readBigUInt64BE(8);
          if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw fmp4Error('caja enorme');
          size = Number(large);
          headerSize = 16;
        }
        const toEnd = size === 0;
        if (!toEnd && size < headerSize) throw fmp4Error(`caja ${type} de tamaño ${size}`);
        if (type === 'ftyp' || type === 'moov' || type === 'moof') {
          if (toEnd || size > META_MAX_BYTES) throw fmp4Error(`${type} enorme`);
          this.state = { kind: 'meta', type, size, parts: [], have: 0 };
          continue;
        }
        if (type === 'mdat' && this.inFragment) {
          const head = data.subarray(0, headerSize);
          this.handlers.onData(Buffer.from(head));
          data = data.subarray(headerSize);
          this.state = { kind: 'mdat', remaining: toEnd ? null : size - headerSize };
          if (!toEnd && size === headerSize) this.finishFragment();
          continue;
        }
        if (type === 'mdat') throw fmp4Error('mdat sin moof');
        data = data.subarray(headerSize);
        this.state = { kind: 'skip', remaining: toEnd ? null : size - headerSize };
        if (!toEnd && size === headerSize) this.state = { kind: 'header' };
        continue;
      }
      if (state.kind === 'meta') {
        const take = Math.min(state.size - state.have, data.length);
        state.parts.push(Buffer.from(data.subarray(0, take)));
        state.have += take;
        data = data.subarray(take);
        if (state.have === state.size) {
          this.state = { kind: 'header' };
          this.finishMeta(state.type, Buffer.concat(state.parts, state.size));
        }
        continue;
      }
      if (state.kind === 'mdat') {
        const take =
          state.remaining === null ? data.length : Math.min(state.remaining, data.length);
        if (take) this.handlers.onData(data.subarray(0, take));
        data = data.subarray(take);
        if (state.remaining !== null) {
          state.remaining -= take;
          if (state.remaining === 0) this.finishFragment();
        }
        continue;
      }
      const take = state.remaining === null ? data.length : Math.min(state.remaining, data.length);
      data = data.subarray(take);
      if (state.remaining !== null) {
        state.remaining -= take;
        if (state.remaining === 0) this.state = { kind: 'header' };
      }
    }
    if (data.length) this.pending = Buffer.from(data);
  }

  private finishMeta(type: string, bytes: Buffer): void {
    if (type === 'ftyp') {
      this.ftyp = bytes;
      return;
    }
    if (type === 'moov') {
      const whole = this.ftyp ? Buffer.concat([this.ftyp, bytes]) : bytes;
      this.init = parseInit(whole);
      this.handlers.onInit(this.init);
      return;
    }
    /* moof */
    if (!this.init) throw fmp4Error('moof antes del moov');
    if (this.inFragment) throw fmp4Error('moof sin su mdat');
    const info = parseMoof(bytes, this.init);
    this.inFragment = true;
    this.handlers.onFragment(info);
    this.handlers.onData(bytes);
  }

  private finishFragment(): void {
    this.inFragment = false;
    this.state = { kind: 'header' };
    this.handlers.onFragmentEnd();
  }
}
