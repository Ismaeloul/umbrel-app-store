/* Carteles del modo demo (docs/vod.md §12.11): SVG `data:` generados del id,
   sin red ni ficheros (la CSP `img-src 'self' data:` los deja pasar). Cada
   título sale con su color, unas formas y su nombre, para que la rejilla de
   la demo se parezca a una de verdad. Diminuto a propósito: lo importa
   data.ts, que va con la vista. */

import type { VodArtKind } from '@ace/shared';

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Parte un título en líneas de ~`max` letras (`limit` como mucho, la última con «…» si no cabe). */
function lines(title: string, max: number, limit: number = POSTER_TEXT.maxLines): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  if (out.length <= limit) return out;
  const kept = out.slice(0, limit);
  kept[limit - 1] = `${kept[limit - 1]}…`;
  return kept;
}

/**
 * El título de un cartel de la demo, con la MISMA geometría que el de un
 * cartel sin imagen (`.cine-art__name` en cine.css): sobre 200 × 300, a 18 px
 * (9 %) del borde izquierdo, letra de 24 (12 % del ancho), líneas de 25,2
 * (1,05) y la ÚLTIMA línea siempre a la misma altura, a 24 px (8 %) del
 * borde de abajo; un título de 2 o 3 líneas crece hacia arriba. Antes la
 * primera línea iba fija a 228 y crecía hacia abajo, y en una fila los de la
 * demo y los de respaldo quedaban unos altos y otros bajos (lo vio Isma con
 * «Relatos salvajes» y «Coco», 0.9.0).
 */
export const POSTER_TEXT = {
  x: 18,
  size: 24,
  lineHeight: 25.2,
  /**
   * Línea base de la última línea: su caja acaba en 276 (300 − 24) y mide
   * 25,2; Mona Sans pone la línea base a 21 de su borde de arriba (medido en
   * Chrome): 276 − 25,2 + 21 ≈ 272.
   */
  lastBaseline: 272,
  maxLines: 4,
  /** Letras por línea (unas 11 de 24 px en los 164 px de ancho útil). */
  maxChars: 11,
} as const;

/** Las líneas base del título en un cartel de la demo (de arriba abajo). */
export function posterTextBaselines(count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    Number((POSTER_TEXT.lastBaseline - (count - 1 - i) * POSTER_TEXT.lineHeight).toFixed(1)),
  );
}

export function demoArtSvg(id: string, art: VodArtKind, v: string, title = ''): string {
  const h = hash(`${id}:${v}`);
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >> 9) % 80)) % 360;
  const poster = art === 'poster';
  const [w, hgt] = poster ? [200, 300] : [320, 180];
  const cx = 30 + ((h >> 3) % (w - 60));
  const cy = 30 + ((h >> 11) % (hgt - 60));
  const r = 40 + ((h >> 17) % 60);
  const titleLines = poster ? lines(title, POSTER_TEXT.maxChars) : [];
  const baselines = posterTextBaselines(titleLines.length);
  const text = titleLines
    .map(
      (line, i) =>
        `<text x="${POSTER_TEXT.x}" y="${baselines[i]}" font-family="system-ui,sans-serif" font-size="${POSTER_TEXT.size}" font-weight="800" fill="#fff">${escapeXml(line)}</text>`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 18%)"/>` +
    `</linearGradient><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${hgt}" fill="url(#g)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue2} 80% 70%)" fill-opacity=".35"/>` +
    `<path d="M0 ${hgt * 0.7} Q ${w / 2} ${hgt * 0.5} ${w} ${hgt * 0.75} V ${hgt} H 0 Z" fill="hsl(${hue} 40% 12%)" fill-opacity=".55"/>` +
    `<rect width="${w}" height="${hgt}" fill="url(#s)"/>` +
    text +
    `</svg>`
  );
}

/** El SVG como `data:` URI para un `<img>`. */
export function demoArtSrc(id: string, art: VodArtKind, v: string, title = ''): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(demoArtSvg(id, art, v, title))}`;
}
