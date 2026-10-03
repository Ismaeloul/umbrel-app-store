/* Códecs del índice VOD (docs/vod.md §9.4 y §9.11): cadenas RFC 6381 desde
   `avcC`/`hvcC`, la profundidad de color y el croma, AAC-LC desde el
   AudioSpecificConfig (o el CodecID del MKV) y la decisión de si un vídeo se
   puede reproducir. Puro. */

import type { VodUnsupportedReason } from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import type { VodIndex } from './types.js';

const hex2 = (value: number): string => value.toString(16).padStart(2, '0');

/** `vod_unsupported` con su motivo tipado (docs/vod.md §11.3). */
export function vodUnsupported(reason: VodUnsupportedReason, detail: string): AppError {
  return new AppError('vod_unsupported', { detail, data: { reason } });
}

export interface AvcConfig {
  readonly codecs: string;
  readonly profile: number;
  readonly bitDepth: number | null;
  /** 1 = 4:2:0, 2 = 4:2:2, 3 = 4:4:4; null si el avcC no lo dice. */
  readonly chromaFormat: number | null;
}

/** Perfiles H.264 que llevan la extensión de croma y bits en el avcC (ISO 14496-15 §5.3.3.1.2). */
const AVC_HIGH_PROFILES = [100, 110, 122, 144, 244];

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
    if (AVC_HIGH_PROFILES.includes(profile) && pos + 2 <= avcC.length) {
      chromaFormat = (avcC[pos] as number) & 0x03;
      bitDepth = ((avcC[pos + 1] as number) & 0x07) + 8;
    }
  }
  if (bitDepth === null) {
    /* Sin la extensión: High 10 y los perfiles 4:2:2/4:4:4 casi siempre son de más de 8 bits. */
    if (profile === 110 || profile === 122 || profile === 144 || profile === 244) bitDepth = 10;
    else if (profile > 0) bitDepth = 8;
  }
  if (chromaFormat === null) {
    if (profile === 122) chromaFormat = 2;
    else if (profile === 144 || profile === 244 || profile === 44) chromaFormat = 3;
  }
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
  /**
   * Perfil efectivo: `general_profile_idc` si es Main (1) o Main 10 (2); si
   * no, 1 o 2 cuando las banderas de compatibilidad dicen que el flujo se
   * decodifica como tal; si tampoco, el `profile_idc` tal cual.
   */
  readonly profile: number;
  readonly bitDepth: number;
  /** 1 = 4:2:0. */
  readonly chromaFormat: number;
}

/** `hvcC` (ISO 14496-15 §8.3.3): `hvc1.<espacio><perfil>.<compat>.<L|H><nivel>.<restricciones>`. */
export function parseHvcC(hvcC: Buffer): HevcConfig | null {
  if (hvcC.length < 23 || hvcC[0] !== 1) return null;
  const b1 = hvcC[1] as number;
  const space = b1 >> 6;
  const tier = (b1 >> 5) & 1;
  const profileIdc = b1 & 0x1f;
  const flags = hvcC.readUInt32BE(2);
  const compat = reverse32(flags);
  const constraints: number[] = [];
  for (let i = 6; i < 12; i += 1) constraints.push(hvcC[i] as number);
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = hvcC[12] as number;
  const spaceText = space ? String.fromCharCode(64 + space) : '';
  const tail = constraints.map((byte) => `.${byte.toString(16).toUpperCase()}`).join('');
  /* general_profile_compatibility_flag[j] va en el bit (31 − j). */
  const compatible = (j: number): boolean => ((flags >>> (31 - j)) & 1) === 1;
  let profile = profileIdc;
  if (profileIdc !== 1 && profileIdc !== 2) {
    if (compatible(1)) profile = 1;
    else if (compatible(2)) profile = 2;
  }
  return {
    codecs: `hvc1.${spaceText}${profileIdc}.${compat.toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${level}${tail}`,
    profile,
    bitDepth: ((hvcC[17] as number) & 0x07) + 8,
    chromaFormat: (hvcC[16] as number) & 0x03,
  };
}

/**
 * ¿AudioSpecificConfig de AAC-LC (tipo de objeto 2)? Sin él no se sabe: se
 * da por que NO (pasar a AAC siempre funciona; copiar un HE-AAC no).
 */
export function isAacLcConfig(asc: Buffer | null): boolean {
  if (!asc || asc.length < 2) return false;
  let objectType = (asc[0] as number) >> 3;
  if (objectType === 31)
    objectType = 32 + ((((asc[0] as number) & 0x07) << 3) | ((asc[1] as number) >> 5));
  return objectType === 2;
}

/**
 * AAC-LC en un MKV: manda el AudioSpecificConfig (CodecPrivate) si viene;
 * si no, el CodecID antiguo: `A_AAC/MPEG4/LC` y `A_AAC/MPEG2/LC` lo son,
 * `…/LC/SBR` es HE-AAC y `…/MAIN`, `…/SSR` o `…/LTP` tampoco.
 */
export function mkvAacIsLc(codecId: string, codecPrivate: Buffer | null): boolean {
  if (codecPrivate && codecPrivate.length >= 2) return isAacLcConfig(codecPrivate);
  return /^A_AAC\/MPEG[24]\/LC$/.test(codecId);
}

/** H.264 que se ve en todo: 8 bits y 4:2:0 (§9.11). */
const AVC_BLOCKED_PROFILES = [44, 110, 122, 144, 244];

/**
 * ¿Se puede reproducir el vídeo? (§9.11). H.264 de 8 bits y 4:2:0 en todo;
 * HEVC Main o Main 10 en 4:2:0, solo si el cliente lo decodifica (`hevcOk`).
 * Lo demás, `vod_unsupported`.
 */
export function assertPlayable(index: VodIndex, hevcOk: boolean): void {
  const { video } = index;
  if (video.codec === 'h264') {
    const profile = video.profile ?? Number.parseInt(video.codecs.slice(5, 7), 16);
    if (
      (video.bitDepth ?? 8) > 8 ||
      AVC_BLOCKED_PROFILES.includes(profile) ||
      (video.chromaFormat ?? 1) !== 1
    ) {
      throw vodUnsupported('video', `H.264 perfil ${profile}, ${video.bitDepth ?? '?'} bits`);
    }
    return;
  }
  if (video.codec === 'hevc') {
    if (
      (video.profile !== null && video.profile !== 1 && video.profile !== 2) ||
      (video.chromaFormat ?? 1) !== 1 ||
      (video.bitDepth ?? 8) > 10
    ) {
      throw vodUnsupported('video', `HEVC perfil ${video.profile ?? '?'}`);
    }
    if (!hevcOk) throw vodUnsupported('hevc', 'HEVC sin decodificador en el cliente');
    return;
  }
  throw vodUnsupported('video', `vídeo ${video.codec}`);
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

/** Holgura mínima entre el último fotograma clave y el final declarado (P5). */
const DURATION_SLACK_MIN_S = 30;

/**
 * Duración de la pista de vídeo (§9.4): la que se da si no pasa en más de
 * `max(2 GOP, 30 s)` al último fotograma clave; si pasa (o no hay), el
 * último fotograma clave más el GOP mediano. En una muestra, una pista de
 * subtítulos estiraba el contenedor a 600 s con 180 s de vídeo; y un GOP
 * largo al final (créditos sin cortes) no debe recortar la película.
 */
export function videoDuration(declaredS: number | null, keyframes: Float64Array): number {
  const last = keyframes.length ? (keyframes[keyframes.length - 1] as number) : 0;
  const gop = medianGop(keyframes);
  const fallback = last + (gop || 1);
  if (declaredS === null || !Number.isFinite(declaredS) || declaredS <= last) return fallback;
  if (declaredS - last > Math.max(2 * gop, DURATION_SLACK_MIN_S)) return fallback;
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
