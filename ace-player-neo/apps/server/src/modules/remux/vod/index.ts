/* Índice común de un título VOD (docs/vod.md §9.4): mira los primeros
   bytes del fichero y llama al lector de su contenedor.

   - EBML (`1A 45 DF A3`) → MKV/WebM; `ftyp`/`moov`/`mdat`/… → MP4.
   - AVI (`RIFF…AVI `) → `vod_unsupported('formato')`; MPEG-TS (sincronía
     0x47 cada 188 o 192 bytes) → `vod_unsupported('indice')` en la v1; lo
     demás → `formato`.
   - LRU de 8 índices (unos 50 KB cada uno): reanudar o saltar en la misma
     película no lo vuelve a leer. Una lectura en curso se comparte; un fallo
     no se guarda. */

import { VOD_PLAY } from '@ace/shared';
import { vodUnsupported } from './codecs.js';
import { MKV_HEAD_BYTES, readMkvIndex, readMkvTracks } from './index-mkv.js';
import { readMp4Index } from './index-mp4.js';
import type { RangeReader, VodIndex } from './types.js';

export { assertPlayable } from './codecs.js';

/** Lo primero que se lee del fichero (cabe en la caché de cabecera del relé, 2 MiB). */
export const VOD_HEAD_BYTES = MKV_HEAD_BYTES;

export type VodSniff = 'mkv' | 'mp4' | 'avi' | 'ts' | 'desconocido';

const MP4_FIRST_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'styp']);

function looksLikeTs(head: Buffer, packet: number, offset: number): boolean {
  if (head.length < offset + packet * 2 + 1) return false;
  for (let i = 0; i < 3; i += 1) {
    const pos = offset + i * packet;
    if (pos >= head.length) break;
    if (head[pos] !== 0x47) return false;
  }
  return true;
}

/** Contenedor por los bytes (nunca por la extensión del panel). */
export function sniffContainer(head: Buffer): VodSniff {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'mkv';
  if (head.length >= 8 && MP4_FIRST_BOXES.has(head.toString('latin1', 4, 8))) return 'mp4';
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    head.toString('latin1', 8, 12) === 'AVI '
  ) {
    return 'avi';
  }
  if (looksLikeTs(head, 188, 0) || looksLikeTs(head, 192, 4)) return 'ts';
  return 'desconocido';
}

/** Lee el índice del fichero que hay detrás de `reader`. */
export async function readVodIndex(reader: RangeReader): Promise<VodIndex> {
  const head = await reader.read(0, VOD_HEAD_BYTES - 1);
  switch (sniffContainer(head)) {
    case 'mkv':
      return readMkvIndex(reader, head);
    case 'mp4':
      return readMp4Index(reader, head);
    case 'avi':
      throw vodUnsupported('formato', 'AVI');
    case 'ts':
      throw vodUnsupported('indice', 'MPEG-TS sin índice');
    default:
      throw vodUnsupported('formato', 'contenedor desconocido');
  }
}

/** Lo primero que se lee para saber solo las pistas (la ficha, docs/vod.md §4.11). */
export const VOD_TRACKS_HEAD_BYTES = 64 * 1024;

/**
 * Solo las pistas de audio y de subtítulos (la ficha de un título «sin
 * indicar», docs/vod.md §4.11): en un MKV, la cabecera y `Tracks` (sin los
 * Cues); en un MP4, el `moov` (las pistas van dentro). Los mismos lectores
 * que la reproducción.
 */
export async function readVodTracks(
  reader: RangeReader,
): Promise<Pick<VodIndex, 'audio' | 'subtitles'>> {
  const head = await reader.read(0, VOD_TRACKS_HEAD_BYTES - 1);
  switch (sniffContainer(head)) {
    case 'mkv':
      return readMkvTracks(reader, head);
    case 'mp4': {
      const index = await readMp4Index(reader, head);
      return { audio: index.audio, subtitles: index.subtitles };
    }
    case 'avi':
      throw vodUnsupported('formato', 'AVI');
    case 'ts':
      throw vodUnsupported('indice', 'MPEG-TS sin índice');
    default:
      throw vodUnsupported('formato', 'contenedor desconocido');
  }
}

/** LRU de índices por título (la clave la pone quien llama: el id del título). */
export class VodIndexCache {
  private readonly entries = new Map<string, Promise<VodIndex>>();

  constructor(private readonly max: number = VOD_PLAY.indexCache) {}

  get size(): number {
    return this.entries.size;
  }

  /** El índice guardado (y lo pone el último), o undefined. */
  peek(key: string): Promise<VodIndex> | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** El índice de `key`: el guardado, la lectura en curso o uno nuevo con `read`. */
  get(key: string, read: () => Promise<VodIndex>): Promise<VodIndex> {
    const cached = this.peek(key);
    if (cached) return cached;
    const pending = read();
    this.entries.set(key, pending);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
    return pending;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
