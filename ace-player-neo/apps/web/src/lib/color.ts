/* Color: conversión sRGB ⇄ OKLCH, contraste WCAG y los tonos de equipo y de
   canal. Sin dependencias; las fórmulas son las de Björn Ottosson (OKLab) y
   las de WCAG 2.x para la luminancia relativa.

   Lo usan TeamMark y ChannelMark para convertir el color que da ESPN (hex sin
   «#») en luz normalizada por tema, y el test de tokens para comprobar AA. */

export interface Rgb {
  /** 0..1 en sRGB con gamma. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  l: number;
  c: number;
  /** Tono en grados, 0..360. */
  h: number;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** `#rgb`, `#rrggbb`, `rrggbb` (así los da ESPN) → Rgb. `null` si no es un hex. */
export function parseHex(value: string | null | undefined): Rgb | null {
  if (!value) return null;
  const clean = value.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? [...clean].map((ch) => ch + ch).join('')
      : clean.length === 6
        ? clean
        : null;
  if (!full || !/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((x) =>
      Math.round(clamp01(x) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH → sRGB, recortando al gamut (suficiente para contraste y respaldos). */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp01(toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)),
    g: clamp01(toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)),
    b: clamp01(toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)),
  };
}

export function oklchCss({ l, c, h }: Oklch, alpha = 1): string {
  const round = (n: number, d: number) => Number(n.toFixed(d));
  const base = `${round(l, 3)} ${round(c, 3)} ${round(h, 1)}`;
  return alpha < 1 ? `oklch(${base} / ${round(alpha, 2)})` : `oklch(${base})`;
}

/** `oklch(0.83 0.12 222)` o `oklch(0.83 0.12 222 / 0.5)` → Oklch (sin el alfa). */
export function parseOklch(value: string): Oklch | null {
  const match =
    /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)/i.exec(value);
  if (!match) return null;
  const [, lRaw = '', c = '', h = ''] = match;
  const l = lRaw.endsWith('%') ? Number.parseFloat(lRaw) / 100 : Number.parseFloat(lRaw);
  return { l, c: Number.parseFloat(c), h: Number.parseFloat(h) };
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** Contraste WCAG 2.x entre dos colores opacos (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// ---- Tonos de equipo y de canal --------------------------------------------

/** Hash estable y barato de un texto (FNV-1a de 32 bits). */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* Tonos vetados (regla de tonos de la opción C, injerto C2): el violeta
   (280-320, rechazado por Isma), el verde de «verificada» (140-160) y el rojo
   de «sin señal» (15-40), para que un color de canal nunca se lea como un
   estado. Los marrones se evitan con la luminosidad, no con el tono. */
const FORBIDDEN_HUES: ReadonlyArray<readonly [number, number]> = [
  [15, 40],
  [140, 160],
  [280, 320],
];

export function isForbiddenHue(hue: number): boolean {
  const h = ((hue % 360) + 360) % 360;
  return FORBIDDEN_HUES.some(([from, to]) => h >= from && h <= to);
}

/** Tono sacado del nombre, fuera de las franjas vetadas. */
export function hueFromName(name: string): number {
  const allowed: number[] = [];
  for (let h = 0; h < 360; h += 5) if (!isForbiddenHue(h)) allowed.push(h);
  return allowed[hashText(name.trim().toLowerCase()) % allowed.length] ?? 220;
}

export type Scheme = 'light' | 'dark';

/**
 * Color de equipo convertido en «luz» para un tema: halos, velos y focos.
 * Nunca se usa en un indicador pequeño junto a un estado.
 * - La luminosidad se lleva a una banda que se ve sobre el fondo del tema.
 * - Un color casi blanco no se ve sobre el claro: se usa el segundo color del
 *   club (como el Real Madrid o el Tottenham en la maqueta) o un gris azulado.
 */
export function teamLight(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  scheme: Scheme,
): Oklch | null {
  const first = parseHex(primary);
  if (!first) return null;
  let color = rgbToOklch(first);
  const nearWhite = color.l > 0.9 && color.c < 0.04;
  if (scheme === 'light' && nearWhite) {
    const second = parseHex(secondary);
    const alt = second ? rgbToOklch(second) : null;
    color = alt && !(alt.l > 0.9 && alt.c < 0.04) ? alt : { l: 0.58, c: 0.06, h: 255 };
  }
  const [min, max] = scheme === 'dark' ? [0.55, 0.93] : [0.5, 0.74];
  return { l: Math.min(max, Math.max(min, color.l)), c: Math.min(color.c, 0.22), h: color.h };
}

/** Relleno de una ficha de canal (dorsal) sacado del nombre, legible con texto blanco. */
export function channelTone(name: string): Oklch {
  const h = hueFromName(name);
  // Amarillos y naranjas oscuros se leen como marrón u oliva: esos tonos van
  // más claros y con más croma.
  const warm = h >= 40 && h <= 115;
  return { l: warm ? 0.56 : 0.46, c: warm ? 0.13 : 0.11, h };
}
