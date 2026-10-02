/* Códecs del índice VOD (docs/vod.md §9.4 y §9.11): cadenas RFC 6381 desde
   `avcC`/`hvcC`, la profundidad de color, AAC-LC desde el AudioSpecificConfig
   y la decisión de si un vídeo se puede reproducir. Puro. */

import { AppError } from '../../../core/errors.js';
import type { VodIndex } from './types.js';

const hex2 = (value: number): string => value.toString(16).padStart(2, '0');

export interface AvcConfig {
  readonly codecs: string;
  readonly profile: number;
  readonly bitDepth: number | null;
  /** 1 = 4:2:0; null si el avcC no lo dice. */
  readonly chromaFormat: number | null;
}

/** `avcC` (ISO 14496-15 §5.3.3): perfil, nivel y, si viene, la extensión con el croma y los bits. */
export function parseAvcC(avcC: Buffer): AvcConfig | null {
  if (avcC.length < 7 || avcC[0] !== 1) return null;
  const profile = avcC[1] as number;
  const codecs = `avc1.${hex2(profile)}${hex2(avcC[2] as number)}${hex2(avcC[3] as number)}`;
  let bitDepth: number | null = null;
  let chromaFormat: number | null = null;
  let pos = 5;
  const sps = (avcC[pos] as number) & 0x1f;
  pos += 1;
  for (let i = 0; i < sps && pos + 2 <= avcC.length; i += 1) pos += 2 + avcC.readUInt16BE(pos);
  if (pos < avcC.length) {
    const pps = avcC[pos] as number;
    pos += 1;
    for (let i = 0; i < pps && pos + 2 <= avcC.length; i += 1) pos += 2 + avcC.readUInt16BE(pos);
    if ([100, 110, 122, 144].includes(profile) && pos + 2 <= avcC.length) {
      chromaFormat = (avcC[pos] as number) & 0x03;
      bitDepth = ((avcC[pos + 1] as number) & 0x07) + 8;
    }
  }
  if (bitDepth === null) {
    /* Sin la extensión: High 10 y los perfiles 4:2:2/4:4:4 casi siempre son de más de 8 bits. */
    if (profile === 110 || profile === 122 || profile === 244) bitDepth = 10;
    else if (profile > 0) bitDepth = 8;
  }
  if (chromaFormat === null && (profile === 122 || profile === 244)) chromaFormat = profile === 122 ? 2 : 3;
  return { codecs, profile, bitDepth, chromaFormat };
}

/** Invierte los 32 bits (las banderas de compatibilidad de HEVC van al revés en RFC 6381). */
function reverse32(value: number): number {
  let out = 0;
  for (let i = 0; i < 32; i += 1) out = (out * 2 + ((value >>> i) & 1)) >>> 0;
  return out >>> 0;
}

export interface HevcConfig {
  readonly codecs: string;
  readonly bitDepth: number;
}

/** `hvcC` (ISO 14496-15 §8.3.3): `hvc1.<espacio><perfil>.<compat>.<L|H><nivel>.<restricciones>`. */
export function parseHvcC(hvcC: Buffer): HevcConfig | null {
  if (hvcC.length < 23 || hvcC[0] !== 1) return null;
  const b1 = hvcC[1] as number;
  const space = b1 >> 6;
  const tier = (b1 >> 5) & 1;
  const profile = b1 & 0x1f;
  const compat = reverse32(hvcC.readUInt32BE(2));
  const constraints: number[] = [];
  for (let i = 6; i < 12; i += 1) constraints.push(hvcC[i] as number);
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = hvcC[12] as number;
  const spaceText = space ? String.fromCharCode(64 + space) : '';
  const tail = constraints.map((byte) => `.${byte.toString(16).toUpperCase()}`).join('');
  return {
    codecs: `hvc1.${spaceText}${profile}.${compat.toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${level}${tail}`,
    bitDepth: ((hvcC[17] as number) & 0x07) + 8,
  };
}

/** ¿AudioSpecificConfig de AAC-LC (tipo de objeto 2)? */
export function isAacLcConfig(asc: Buffer | null): boolean {
  if (!asc || asc.length < 2) return true;
  let objectType = (asc[0] as number) >> 3;
  if (objectType === 31) objectType = 32 + ((((asc[0] as number) & 0x07) << 3) | ((asc[1] as number) >> 5));
  return objectType === 2;
}

/**
 * ¿Se puede reproducir el vídeo? (§9.11). H.264 de 8 bits y 4:2:0 en todo;
 * HEVC solo si el cliente lo decodifica (`hevcOk`). Lo demás, `vod_unsupported`.
 */
export function assertPlayable(index: VodIndex, hevcOk: boolean): void {
  const { video } = index;
  if (video.codec === 'h264') {
    const profile = Number.parseInt(video.codecs.slice(5, 7), 16);
    if ((video.bitDepth ?? 8) > 8 || profile === 122 || profile === 244) {
      throw new AppError('vod_unsupported', { detail: 'H.264 de más de 8 bits', data: { reason: 'video' } });
    }
    return;
  }
  if (video.codec === 'hevc') {
    if (!hevcOk) throw new AppError('vod_unsupported', { detail: 'HEVC', data: { reason: 'hevc' } });
    return;
  }
  throw new AppError('vod_unsupported', { detail: `vídeo ${video.codec}`, data: { reason: 'video' } });
}

/** GOP mediano de una lista de fotogramas clave (0 si hay menos de 2). */
export function medianGop(keyframes: Float64Array): number {
  if (keyframes.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < keyframes.length; i += 1) {
    gaps.push((keyframes[i] as number) - (keyframes[i - 1] as number));
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] as number;
}

/**
 * Duración de la pista de vídeo (§9.4): la que se da si no pasa en más de 2
 * GOP al último fotograma clave; si pasa (o no hay), el último fotograma
 * clave más el GOP mediano. En una muestra, una pista de subtítulos estiraba
 * el contenedor a 600 s con 180 s de vídeo.
 */
export function videoDuration(declaredS: number | null, keyframes: Float64Array): number {
  const last = keyframes.length ? (keyframes[keyframes.length - 1] as number) : 0;
  const gop = medianGop(keyframes);
  const fallback = last + (gop || 1);
  if (declaredS === null || !Number.isFinite(declaredS) || declaredS <= last) return fallback;
  if (gop > 0 && declaredS - last > 2 * gop) return fallback;
  return declaredS;
}

/** Ordena, quita repetidos y los tiempos no finitos o negativos más allá del redondeo. */
export function normalizeKeyframes(times: readonly number[]): Float64Array {
  const sorted = times.filter((t) => Number.isFinite(t) && t > -0.5).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    const value = Math.max(0, t);
    if (!out.length || value - (out[out.length - 1] as number) > 1e-6) out.push(value);
  }
  return Float64Array.from(out);
}
