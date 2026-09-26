/* Piezas puras del relé para HLS y MPEG-TS (docs/iptv.md §6.1).

   - Lista maestra: se elige UNA variante (la de mayor BANDWIDTH con
     RESOLUTION ≤ 1920×1080, o la mayor si no hay resolución) entre las que
     llevan el audio muxeado. Si todas usan una rendición de audio aparte
     (un grupo `#EXT-X-MEDIA TYPE=AUDIO` en el que todas llevan `URI`),
     `iptv_unsupported`. Un grupo con alguna rendición sin `URI` es audio muxeado.
   - Lista de medios: reescritura por LISTA BLANCA. Solo pasan `#EXTM3U`,
     `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION`, `#EXT-X-MEDIA-SEQUENCE`,
     `#EXT-X-DISCONTINUITY-SEQUENCE`, `#EXT-X-DISCONTINUITY`,
     `#EXT-X-PROGRAM-DATE-TIME`, `#EXT-X-ENDLIST`, `#EXTINF` con su URI,
     `#EXT-X-MAP` y `#EXT-X-KEY` (`METHOD=NONE` o `AES-128`). Todo lo demás
     se descarta. Cada URI conservada se reescribe a `s/<seq>.<ext>` o
     `k/<n>` del relé; la extensión se normaliza (`.ts`, `.m4s`, `.aac`,
     `.mp4` para el MAP) aunque el proveedor sirva `.php` o nada.
   - MPEG-TS: lectura del PCR de los paquetes para ver si la base de tiempos
     salta tras reconectar. */

import { IPTV_RELAY } from '@ace/shared';
import { AppError } from '../../core/errors.js';

export type SegmentExt = 'ts' | 'm4s' | 'aac' | 'mp4';

export interface MasterVariant {
  readonly uri: string;
  readonly bandwidth: number;
  readonly width: number | null;
  readonly height: number | null;
  /** Grupo de audio aparte con URI (no muxeado). */
  readonly separateAudio: boolean;
}

/** Atributos `CLAVE=valor` de una etiqueta HLS (con o sin comillas). */
export function hlsAttributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    out.set(match[1] as string, match[3] ?? (match[2] as string));
  }
  return out;
}

function lines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isMasterPlaylist(text: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(text);
}

export function isPlaylist(text: string): boolean {
  return /^\uFEFF?\s*#EXTM3U/.test(text);
}

/** Variantes de una lista maestra. */
export function masterVariants(text: string): MasterVariant[] {
  const all = lines(text);
  /* Un grupo de audio va aparte solo si TODAS sus rendiciones llevan URI. Una
     rendición sin URI es el audio que ya va muxeado en la variante (RFC 8216
     §4.3.4.1): las televisiones públicas declaran así su audio principal y
     añaden aparte el original o la audiodescripción. */
  const audioWithUri = new Set<string>();
  const audioMuxed = new Set<string>();
  for (const line of all) {
    if (!line.toUpperCase().startsWith('#EXT-X-MEDIA:')) continue;
    const attributes = hlsAttributes(line.slice(line.indexOf(':') + 1));
    if (attributes.get('TYPE') !== 'AUDIO') continue;
    const group = attributes.get('GROUP-ID') ?? '';
    if (attributes.get('URI')) audioWithUri.add(group);
    else audioMuxed.add(group);
  }
  for (const group of audioMuxed) audioWithUri.delete(group);
  const out: MasterVariant[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const line = all[index] as string;
    if (!line.toUpperCase().startsWith('#EXT-X-STREAM-INF:')) continue;
    const uri = all[index + 1];
    if (!uri || uri.startsWith('#')) continue;
    const attributes = hlsAttributes(line.slice(line.indexOf(':') + 1));
    const resolution = /^(\d+)x(\d+)$/.exec(attributes.get('RESOLUTION') ?? '');
    const audio = attributes.get('AUDIO');
    out.push({
      uri,
      bandwidth: Number(attributes.get('BANDWIDTH')) || 0,
      width: resolution ? Number(resolution[1]) : null,
      height: resolution ? Number(resolution[2]) : null,
      separateAudio: audio !== undefined && audioWithUri.has(audio),
    });
  }
  return out;
}

/**
 * Elige la variante: mayor BANDWIDTH con resolución ≤ 1080p entre las de
 * audio muxeado (o la mayor si ninguna declara resolución). Lanza
 * `iptv_unsupported` si todas llevan el audio aparte.
 */
export function pickMasterVariant(variants: readonly MasterVariant[]): MasterVariant {
  const muxed = variants.filter((variant) => !variant.separateAudio);
  if (!muxed.length)
    throw new AppError('iptv_unsupported', { detail: 'audio en rendición aparte' });
  const byBandwidth = (list: readonly MasterVariant[]): MasterVariant =>
    [...list].sort((a, b) => b.bandwidth - a.bandwidth)[0] as MasterVariant;
  const withResolution = muxed.filter(
    (variant) => variant.width !== null && variant.height !== null,
  );
  if (!withResolution.length) return byBandwidth(muxed);
  const fits = withResolution.filter(
    (variant) =>
      (variant.width as number) <= IPTV_RELAY.maxWidth &&
      (variant.height as number) <= IPTV_RELAY.maxHeight,
  );
  if (fits.length) return byBandwidth(fits);
  /* Ninguna cabe en 1080p: la más pequeña. */
  return [...withResolution].sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0] as MasterVariant;
}

/** Extensión normalizada a partir de la ruta (null si no se sabe). */
export function extFromPath(uri: string): SegmentExt | null {
  const path = uri.split(/[?#]/)[0] ?? '';
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  const ext = match?.[1]?.toLowerCase();
  if (ext === 'ts' || ext === 'mts' || ext === 'm2ts') return 'ts';
  if (ext === 'm4s' || ext === 'm4v' || ext === 'cmfv') return 'm4s';
  if (ext === 'aac' || ext === 'adts') return 'aac';
  if (ext === 'mp4' || ext === 'm4a' || ext === 'fmp4') return 'mp4';
  return null;
}

/** Tipo real de un segmento por sus primeros bytes y su Content-Type. */
export function sniffSegment(head: Buffer, contentType: string | null): SegmentExt | null {
  if (head.length >= 1 && head[0] === 0x47) return 'ts';
  if (head.length >= 8) {
    const box = head.subarray(4, 8).toString('latin1');
    if (['ftyp', 'styp', 'moof', 'sidx', 'moov'].includes(box)) return 'm4s';
  }
  if (head.length >= 3 && head.subarray(0, 3).toString('latin1') === 'ID3') return 'aac';
  if (head.length >= 2 && head[0] === 0xff && ((head[1] as number) & 0xf0) === 0xf0) return 'aac';
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('mp2t')) return 'ts';
  if (type.includes('mp4')) return 'm4s';
  if (type.includes('aac') || type.includes('audio/mpeg')) return 'aac';
  return null;
}

export const EXT_CONTENT_TYPE: Readonly<Record<SegmentExt, string>> = {
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  aac: 'audio/aac',
  mp4: 'video/mp4',
};

/** Lo que el relé recuerda de una lista de medios reescrita. */
export interface RewrittenPlaylist {
  readonly text: string;
  /** seq → URL real (absoluta) y extensión con la que se publicó. */
  readonly segments: ReadonlyMap<number, { readonly url: string; readonly ext: SegmentExt }>;
  /** n → URL real de la clave. */
  readonly keys: ReadonlyMap<number, string>;
  readonly mediaSequence: number;
  readonly discontinuitySequence: number;
  readonly endList: boolean;
}

const KEPT_TAGS = new Set([
  '#EXTM3U',
  '#EXT-X-VERSION',
  '#EXT-X-TARGETDURATION',
  '#EXT-X-MEDIA-SEQUENCE',
  '#EXT-X-DISCONTINUITY-SEQUENCE',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-PROGRAM-DATE-TIME',
  '#EXT-X-ENDLIST',
  '#EXT-X-PLAYLIST-TYPE',
  '#EXT-X-INDEPENDENT-SEGMENTS',
]);

function resolve(uri: string, base: string): string | null {
  try {
    const url = new URL(uri, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Reescribe una lista de medios por lista blanca. `prefix` es la ruta del
 * relé (`/r/<ticket>/`); `guessExt` la extensión cuando la ruta no la dice.
 */
export function rewriteMediaPlaylist(
  text: string,
  baseUrl: string,
  prefix: string,
  guessExt: SegmentExt,
): RewrittenPlaylist {
  if (!isPlaylist(text)) throw new AppError('iptv_unsupported', { detail: 'no es una lista HLS' });
  if (isMasterPlaylist(text)) throw new AppError('iptv_unsupported', { detail: 'maestra anidada' });
  const out: string[] = [];
  const segments = new Map<number, { url: string; ext: SegmentExt }>();
  const keys = new Map<number, string>();
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let endList = false;
  let seq: number | null = null;
  let pendingInf: string | null = null;
  let keyCount = 0;
  let mapCount = 0;
  for (const line of lines(text)) {
    if (!line.startsWith('#')) {
      if (pendingInf === null) continue; // URI suelta sin #EXTINF: fuera
      const url = resolve(line, baseUrl);
      const inf = pendingInf;
      pendingInf = null;
      if (seq === null) seq = mediaSequence;
      const current = seq;
      seq += 1;
      if (!url) continue;
      const ext = extFromPath(line) ?? guessExt;
      segments.set(current, { url, ext });
      out.push(inf, `${prefix}s/${current}.${ext}`);
      continue;
    }
    const colon = line.indexOf(':');
    const tag = (colon < 0 ? line : line.slice(0, colon)).toUpperCase();
    const value = colon < 0 ? '' : line.slice(colon + 1);
    if (tag === '#EXTINF') {
      pendingInf = `#EXTINF:${value.replace(/[\r\n]/g, '')}`;
      continue;
    }
    if (tag === '#EXT-X-MEDIA-SEQUENCE') {
      mediaSequence = Math.max(0, Math.floor(Number(value) || 0));
      out.push(`#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`);
      continue;
    }
    if (tag === '#EXT-X-DISCONTINUITY-SEQUENCE') {
      discontinuitySequence = Math.max(0, Math.floor(Number(value) || 0));
      out.push(`#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence}`);
      continue;
    }
    if (tag === '#EXT-X-ENDLIST') endList = true;
    if (tag === '#EXT-X-KEY') {
      const attributes = hlsAttributes(value);
      const method = (attributes.get('METHOD') ?? '').toUpperCase();
      if (method === 'NONE') {
        out.push('#EXT-X-KEY:METHOD=NONE');
        continue;
      }
      if (method !== 'AES-128')
        throw new AppError('iptv_unsupported', { detail: `cifrado ${method.slice(0, 20)}` });
      const uri = attributes.get('URI');
      const url = uri ? resolve(uri, baseUrl) : null;
      if (!url) continue;
      keyCount += 1;
      keys.set(keyCount, url);
      const iv = attributes.get('IV');
      out.push(
        `#EXT-X-KEY:METHOD=AES-128,URI="${prefix}k/${keyCount}"${iv && /^0x[0-9a-f]+$/i.test(iv) ? `,IV=${iv}` : ''}`,
      );
      continue;
    }
    if (tag === '#EXT-X-MAP') {
      const attributes = hlsAttributes(value);
      const uri = attributes.get('URI');
      const url = uri ? resolve(uri, baseUrl) : null;
      if (!url) continue;
      mapCount += 1;
      /* El MAP va con un número negativo para no chocar con los segmentos. */
      const mapSeq = -mapCount;
      segments.set(mapSeq, { url, ext: 'mp4' });
      out.push(`#EXT-X-MAP:URI="${prefix}s/map${mapCount}.mp4"`);
      continue;
    }
    if (KEPT_TAGS.has(tag)) out.push(colon < 0 ? tag : `${tag}:${value.replace(/[\r\n]/g, '')}`);
    /* Lo demás (EXT-X-MEDIA, I-FRAME, SESSION-KEY, PART, PRELOAD-HINT, SKIP…) se descarta. */
  }
  if (!out.length || out[0] !== '#EXTM3U') out.unshift('#EXTM3U');
  return {
    text: `${out.join('\n')}\n`,
    segments,
    keys,
    mediaSequence,
    discontinuitySequence,
    endList,
  };
}

// --- MPEG-TS: PCR ---

export const TS_PACKET = 188;

/**
 * Lector del PCR de un flujo TS que llega por trozos: guarda el resto de
 * paquete entre trozos y apunta el último PCR visto (en segundos).
 */
export class PcrTracker {
  private rest: Buffer = Buffer.alloc(0);
  last: number | null = null;
  first: number | null = null;

  push(chunk: Buffer): void {
    let data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    let offset = 0;
    /* Busca la sincronía si hace falta. */
    while (offset < data.length && data[offset] !== 0x47) offset += 1;
    for (; offset + TS_PACKET <= data.length; offset += TS_PACKET) {
      if (data[offset] !== 0x47) {
        const next = data.indexOf(0x47, offset + 1);
        if (next < 0) {
          offset = data.length;
          break;
        }
        offset = next - TS_PACKET;
        continue;
      }
      const pcr = pcrOfPacket(data, offset);
      if (pcr !== null) {
        this.first ??= pcr;
        this.last = pcr;
      }
    }
    data = data.subarray(Math.min(offset, data.length));
    this.rest = data.length > TS_PACKET * 2 ? Buffer.alloc(0) : Buffer.from(data);
  }

  reset(): void {
    this.rest = Buffer.alloc(0);
    this.first = null;
  }
}

/** PCR en segundos de un paquete TS, o null si no lleva. */
export function pcrOfPacket(data: Buffer, offset: number): number | null {
  const flags = data[offset + 3] as number;
  const hasAdaptation = (flags & 0x20) !== 0;
  if (!hasAdaptation) return null;
  const length = data[offset + 4] as number;
  if (length < 7) return null;
  const adaptationFlags = data[offset + 5] as number;
  if ((adaptationFlags & 0x10) === 0) return null;
  const b = offset + 6;
  const base =
    (data[b] as number) * 2 ** 25 +
    (data[b + 1] as number) * 2 ** 17 +
    (data[b + 2] as number) * 2 ** 9 +
    (data[b + 3] as number) * 2 +
    ((data[b + 4] as number) >> 7);
  const ext = (((data[b + 4] as number) & 0x01) << 8) | (data[b + 5] as number);
  return (base * 300 + ext) / 27_000_000;
}
