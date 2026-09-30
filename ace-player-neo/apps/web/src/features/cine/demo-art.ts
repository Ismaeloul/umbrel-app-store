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

/** Parte un título en líneas de ~`max` letras (3 como mucho). */
function lines(title: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.slice(0, 3);
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
  const text = poster
    ? lines(title, 12)
        .map(
          (line, i) =>
            `<text x="16" y="${228 + i * 24}" font-family="system-ui,sans-serif" font-size="21" font-weight="700" fill="#fff">${escapeXml(line)}</text>`,
        )
        .join('')
    : '';
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
