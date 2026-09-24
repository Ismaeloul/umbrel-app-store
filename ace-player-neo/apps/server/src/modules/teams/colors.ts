/* Colores de equipo (informe de fase 2, §10.5). Prioridad: override →
   `strColour1/2` de TheSportsDB → extracción del PNG → null (el cliente
   deriva un tono del nombre; no se duplica aquí). Un par de colores casi
   iguales (mismo tono y luminosidad parecida) se queda en uno. */

import type { PngImage } from './png.js';

export interface TeamColors {
  readonly primary: string;
  readonly secondary: string | null;
}

export type ColorSource = 'override' | 'thesportsdb' | 'image';

export interface ResolvedColors extends TeamColors {
  readonly source: ColorSource;
}

type Rgb = readonly [number, number, number];

/** `#CB3524`, `cb3524` o `#cb3524` → `#cb3524`; cualquier otra cosa, null. */
export function normalizeHex(value: unknown): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(value ?? '').trim());
  return match ? `#${(match[1] as string).toLowerCase()}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Luminosidad HSL (0 negro, 1 blanco). */
export function lightness([r, g, b]: Rgb): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/** Saturación HSV (0 gris, 1 puro). */
export function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/* Por debajo de esta saturación el tono no significa nada (grises, blanco, negro). */
const GRAY_SATURATION = 0.15;

/** Tono en grados (0..360), o null si no tiene (grises). */
export function hue(rgb: Rgb): number | null {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0 || saturation(rgb) < GRAY_SATURATION) return null;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const HUE_APART = 40;
const LIGHT_APART = 0.3;

/** ¿Se distinguen a simple vista (tono a más de 40° o luminosidad a más de 0,3)? */
export function colorsDistinct(a: string, b: string): boolean {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (Math.abs(lightness(ra) - lightness(rb)) > LIGHT_APART) return true;
  const ha = hue(ra);
  const hb = hue(rb);
  if (ha === null || hb === null) return ha !== hb;
  const diff = Math.abs(ha - hb);
  return Math.min(diff, 360 - diff) > HUE_APART;
}

/** `strColour1`/`strColour2` de TheSportsDB: sin primario válido, null; un secundario igual al primario, fuera. */
export function parseApiColors(primary: unknown, secondary: unknown): TeamColors | null {
  const first = normalizeHex(primary);
  if (!first) return null;
  const second = normalizeHex(secondary);
  return { primary: first, secondary: second && colorsDistinct(first, second) ? second : null };
}

/* Un píxel cuenta si es (casi) opaco: los bordes suavizados y el fondo no. */
const ALPHA_MIN = 200;
/* Peso mínimo del secundario respecto al primario: evita que el antialiasing de un borde salga como color. */
const SECONDARY_MIN_SHARE = 0.08;

interface Bucket {
  weight: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Color dominante y secundario de un escudo: píxeles opacos, cubos de 4 bits
 * por canal (4096) con peso `1 + 2·saturación` (los blancos y grises del
 * fondo no ganan por volumen, pero un club blanco sigue saliendo si domina
 * de verdad). `primary` = media del cubo más pesado; `secondary` = el cubo
 * más pesado que se distingue del primario, o null.
 */
export function dominantColors(image: PngImage): TeamColors | null {
  const buckets = new Map<number, Bucket>();
  const { pixels } = image;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] as number) < ALPHA_MIN) continue;
    const r = pixels[i] as number;
    const g = pixels[i + 1] as number;
    const b = pixels[i + 2] as number;
    const weight = 1 + 2 * saturation([r, g, b]);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.weight += weight;
      bucket.r += r * weight;
      bucket.g += g * weight;
      bucket.b += b * weight;
    } else {
      buckets.set(key, { weight, r: r * weight, g: g * weight, b: b * weight });
    }
  }
  if (!buckets.size) return null;
  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  const mean = (bucket: Bucket): string =>
    rgbToHex([
      Math.round(bucket.r / bucket.weight),
      Math.round(bucket.g / bucket.weight),
      Math.round(bucket.b / bucket.weight),
    ]);
  const first = ranked[0] as Bucket;
  const primary = mean(first);
  for (const bucket of ranked.slice(1)) {
    if (bucket.weight < first.weight * SECONDARY_MIN_SHARE) break;
    const candidate = mean(bucket);
    if (colorsDistinct(primary, candidate)) return { primary, secondary: candidate };
  }
  return { primary, secondary: null };
}

/** Prioridad: override → API → imagen → null. */
export function chooseColors(input: {
  readonly override?: readonly [string, string | null] | null | undefined;
  readonly api?: TeamColors | null;
  readonly image?: PngImage | null;
}): ResolvedColors | null {
  if (input.override) {
    const [primary, secondary] = input.override;
    return {
      primary,
      secondary: secondary && colorsDistinct(primary, secondary) ? secondary : null,
      source: 'override',
    };
  }
  if (input.api) return { ...input.api, source: 'thesportsdb' };
  if (input.image) {
    const found = dominantColors(input.image);
    if (found) return { ...found, source: 'image' };
  }
  return null;
}
