/* Lector de fMP4 del banco de pruebas: lo que hacía `split.mjs` en el
   experimento (docs/vod-estado.md §2.4). Lee un fichero ENTERO en memoria y
   dice qué hay: el init (pistas, escala de tiempos, lista de edición) y cada
   fragmento (por pista, `tfdt` con signo, desfase de composición de la
   primera muestra, muestras y si la primera es un fotograma clave).

   Es a propósito una implementación aparte y sencilla del troceador de
   verdad (src/modules/remux/vod/fmp4.ts): las pruebas comparan lo que sale
   del productor con lo que dice este, y con ffprobe. */

export interface Box {
  readonly type: string;
  readonly start: number;
  readonly headerSize: number;
  readonly end: number;
}

/** Cajas hijas de [start, end) (tamaños de 32 y 64 bits; 0 = hasta el final). */
export function listBoxes(data: Buffer, start = 0, end = data.length): Box[] {
  const out: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    let headerSize = 8;
    if (size === 1) {
      size = Number(data.readBigUInt64BE(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize) break;
    out.push({ type, start: pos, headerSize, end: Math.min(end, pos + size) });
    pos += size;
  }
  return out;
}

function child(data: Buffer, box: Box, type: string): Box | undefined {
  return listBoxes(data, box.start + box.headerSize, box.end).find((b) => b.type === type);
}

export interface InitTrack {
  readonly id: number;
  readonly handler: string;
  readonly timescale: number;
  /** `media_time` de la primera entrada no vacía de `elst` (0 sin lista). */
  readonly elstMediaTime: number;
  /** Bytes de `stsd` (para comparar inits). */
  readonly stsd: Buffer;
}

export interface FragmentTrack {
  readonly id: number;
  /** `baseMediaDecodeTime` con signo (el audio de una ejecución desde 0 da −1024). */
  readonly tfdt: number;
  /** Desfase de composición de la primera muestra (0 si no viene). */
  readonly cto: number;
  readonly samples: number;
  readonly duration: number;
  /** null si `trun` no lo dice. */
  readonly firstIsSync: boolean | null;
}

export interface Fragment {
  readonly start: number;
  readonly end: number;
  readonly tracks: FragmentTrack[];
}

export interface Fmp4Summary {
  readonly topTypes: string[];
  readonly tracks: InitTrack[];
  readonly fragments: Fragment[];
}

export function readInit(data: Buffer): InitTrack[] {
  const moov = listBoxes(data).find((box) => box.type === 'moov');
  if (!moov) return [];
  const tracks: InitTrack[] = [];
  for (const trak of listBoxes(data, moov.start + 8, moov.end).filter((b) => b.type === 'trak')) {
    const tkhd = child(data, trak, 'tkhd');
    const mdia = child(data, trak, 'mdia');
    if (!tkhd || !mdia) continue;
    const tkhdVersion = data[tkhd.start + 8];
    const id = data.readUInt32BE(tkhd.start + 12 + (tkhdVersion === 1 ? 16 : 8));
    const mdhd = child(data, mdia, 'mdhd');
    const hdlr = child(data, mdia, 'hdlr');
    if (!mdhd || !hdlr) continue;
    const mdhdVersion = data[mdhd.start + 8];
    const timescale = data.readUInt32BE(mdhd.start + 12 + (mdhdVersion === 1 ? 16 : 8));
    const handler = data.toString('latin1', hdlr.start + 16, hdlr.start + 20);
    let elstMediaTime = 0;
    const edts = child(data, trak, 'edts');
    const elst = edts ? child(data, edts, 'elst') : undefined;
    if (elst) {
      const version = data[elst.start + 8];
      const count = data.readUInt32BE(elst.start + 12);
      let pos = elst.start + 16;
      for (let i = 0; i < count; i += 1) {
        const mediaTime =
          version === 1 ? Number(data.readBigInt64BE(pos + 8)) : data.readInt32BE(pos + 4);
        pos += version === 1 ? 20 : 12;
        if (mediaTime !== -1) {
          elstMediaTime = mediaTime;
          break;
        }
      }
    }
    const minf = child(data, mdia, 'minf');
    const stbl = minf ? child(data, minf, 'stbl') : undefined;
    const stsd = stbl ? child(data, stbl, 'stsd') : undefined;
    tracks.push({
      id,
      handler,
      timescale,
      elstMediaTime,
      stsd: stsd ? Buffer.from(data.subarray(stsd.start, stsd.end)) : Buffer.alloc(0),
    });
  }
  return tracks;
}

function readFragment(data: Buffer, moof: Box, end: number): Fragment {
  const tracks: FragmentTrack[] = [];
  for (const traf of listBoxes(data, moof.start + 8, moof.end).filter((b) => b.type === 'traf')) {
    const tfhd = child(data, traf, 'tfhd');
    const tfdt = child(data, traf, 'tfdt');
    const trun = child(data, traf, 'trun');
    if (!tfhd || !tfdt || !trun) continue;
    const id = data.readUInt32BE(tfhd.start + 12);
    const tfhdFlags = data.readUIntBE(tfhd.start + 9, 3);
    let pos = tfhd.start + 16;
    if (tfhdFlags & 0x1) pos += 8;
    if (tfhdFlags & 0x2) pos += 4;
    const defaultDuration = tfhdFlags & 0x8 ? data.readUInt32BE(pos) : 0;
    if (tfhdFlags & 0x8) pos += 4;
    if (tfhdFlags & 0x10) pos += 4;
    const defaultFlags = tfhdFlags & 0x20 ? data.readUInt32BE(pos) : null;
    const tfdtVersion = data[tfdt.start + 8];
    const decode =
      tfdtVersion === 1
        ? Number(data.readBigInt64BE(tfdt.start + 12))
        : data.readUInt32BE(tfdt.start + 12);
    const trunVersion = data[trun.start + 8];
    const flags = data.readUIntBE(trun.start + 9, 3);
    const count = data.readUInt32BE(trun.start + 12);
    pos = trun.start + 16;
    if (flags & 0x1) pos += 4;
    let firstFlags = defaultFlags;
    if (flags & 0x4) {
      firstFlags = data.readUInt32BE(pos);
      pos += 4;
    }
    let duration = 0;
    let cto = 0;
    for (let i = 0; i < count; i += 1) {
      duration += flags & 0x100 ? data.readUInt32BE(pos) : defaultDuration;
      if (flags & 0x100) pos += 4;
      if (flags & 0x200) pos += 4;
      if (flags & 0x400) {
        if (i === 0 && !(flags & 0x4)) firstFlags = data.readUInt32BE(pos);
        pos += 4;
      }
      if (flags & 0x800) {
        if (i === 0) cto = trunVersion === 1 ? data.readInt32BE(pos) : data.readUInt32BE(pos);
        pos += 4;
      }
    }
    tracks.push({
      id,
      tfdt: decode,
      cto,
      samples: count,
      duration,
      /* sample_is_non_sync_sample (bit 16) a 0 = fotograma clave. */
      firstIsSync: firstFlags === null ? null : (firstFlags & 0x10000) === 0,
    });
  }
  return { start: moof.start, end, tracks };
}

/** Resumen de un fMP4 entero (o de init + segmento pegados). */
export function readFmp4(data: Buffer): Fmp4Summary {
  const top = listBoxes(data);
  const fragments: Fragment[] = [];
  for (let i = 0; i < top.length; i += 1) {
    const box = top[i] as Box;
    if (box.type !== 'moof') continue;
    const next = top[i + 1];
    fragments.push(readFragment(data, box, next?.type === 'mdat' ? next.end : box.end));
  }
  return { topTypes: top.map((box) => box.type), tracks: readInit(data), fragments };
}

/**
 * Tiempo de presentación del principio de un fragmento en la pista `trackId`
 * (en segundos): `tfdt` + desfase de la primera muestra − `media_time` del
 * `elst` del init (docs/vod-estado.md §4.3, P4).
 */
export function fragmentStartS(fragment: Fragment, track: InitTrack): number | null {
  const entry = fragment.tracks.find((t) => t.id === track.id);
  if (!entry) return null;
  return (entry.tfdt + entry.cto - track.elstMediaTime) / track.timescale;
}
