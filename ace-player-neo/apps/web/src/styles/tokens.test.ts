/* El sistema de diseño se vigila solo:
   - contraste AA de cada texto (4,5:1) y de cada medidor o borde de control
     (3:1) contra los cuatro fondos, en claro y en oscuro;
   - el respaldo en hex es la conversión de su OKLCH (no se desincroniza);
   - ningún texto por debajo de 11 px en ninguna hoja de estilos. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  oklchToRgb,
  parseHex,
  parseOklch,
  rgbToHex,
  type Rgb,
} from '../lib/color.ts';

// Se leen del disco: con `css: false` Vitest vacía los .css que se importan.
const STYLES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(STYLES_DIR, '..');
const tokensCss = readFileSync(path.join(STYLES_DIR, 'tokens.css'), 'utf8');
const ALL_CSS = Object.fromEntries(
  (readdirSync(SRC_DIR, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.css'))
    .map((file) => [file, readFileSync(path.join(SRC_DIR, file), 'utf8')]),
);

type Theme = 'light' | 'dark';

function modernTokens(): Record<string, Record<Theme, Rgb>> {
  const block = tokensCss.slice(tokensCss.indexOf('@supports (color: light-dark('));
  const out: Record<string, Record<Theme, Rgb>> = {};
  const pair = /(--[a-z0-9-]+):\s*light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)/g;
  for (const match of block.matchAll(pair)) {
    const [, name = '', light = '', dark = ''] = match;
    const l = parseOklch(light);
    const d = parseOklch(dark);
    if (l && d && !light.includes('/')) out[name] = { light: oklchToRgb(l), dark: oklchToRgb(d) };
  }
  const single = /(--[a-z0-9-]+):\s*(oklch\([^)/]*\));/g;
  for (const match of block.matchAll(single)) {
    const [, name = '', value = ''] = match;
    const color = parseOklch(value);
    if (color && !out[name]) out[name] = { light: oklchToRgb(color), dark: oklchToRgb(color) };
  }
  return out;
}

function fallbackTokens(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(selector, tokensCss.indexOf('Colores · respaldo en hex'));
  const body = tokensCss.slice(start, tokensCss.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/g))
    out[match[1] ?? ''] = match[2] ?? '';
  return out;
}

const tokens = modernTokens();
const BACKGROUNDS = ['--bg', '--bg-sunk', '--surface', '--surface-2'];
const TEXT = [
  '--text',
  '--text-2',
  '--text-3',
  '--accent-ink',
  '--ok-ink',
  '--weak-ink',
  '--fail-ink',
];
const GRAPHIC = ['--ok', '--weak', '--fail', '--accent-edge', '--line-strong'];

describe('tokens: contraste AA', () => {
  it('se leen los tokens de color', () => {
    for (const name of [...BACKGROUNDS, ...TEXT, ...GRAPHIC, '--accent', '--on-accent']) {
      expect(tokens[name], name).toBeDefined();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`texto ≥ 4,5:1 sobre los cuatro fondos (${theme})`, () => {
      for (const text of TEXT) {
        for (const bg of BACKGROUNDS) {
          const ratio = contrastRatio(tokens[text]![theme], tokens[bg]![theme]);
          expect(
            ratio,
            `${text} sobre ${bg} en ${theme}: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`medidores y bordes de control ≥ 3:1 (${theme})`, () => {
      for (const mark of GRAPHIC) {
        for (const bg of BACKGROUNDS) {
          const ratio = contrastRatio(tokens[mark]![theme], tokens[bg]![theme]);
          expect(
            ratio,
            `${mark} sobre ${bg} en ${theme}: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  /* Lo activo (carril, pestañas, chips) pinta --accent-ink sobre --accent-wash:
     el velo oscurece el fondo, así que se mide sobre la mezcla. La revisión
     visual de la Fase 2 lo pilló en el carril claro (4,37:1 sobre --bg-sunk). */
  it('texto de acento ≥ 4,5:1 sobre el velo de acento en los cuatro fondos', () => {
    const washAlpha: Record<Theme, number> = { light: 0.22, dark: 0.16 };
    const mix = (top: Rgb, under: Rgb, alpha: number): Rgb => ({
      r: top.r * alpha + under.r * (1 - alpha),
      g: top.g * alpha + under.g * (1 - alpha),
      b: top.b * alpha + under.b * (1 - alpha),
    });
    expect(tokensCss).toContain(
      '--accent-wash: light-dark(oklch(0.889 0.181 93.4 / 0.22), oklch(0.889 0.181 93.4 / 0.16))',
    );
    for (const theme of ['light', 'dark'] as const) {
      for (const bg of BACKGROUNDS) {
        const under = mix(tokens['--accent']![theme], tokens[bg]![theme], washAlpha[theme]);
        const ratio = contrastRatio(tokens['--accent-ink']![theme], under);
        expect(
          ratio,
          `--accent-ink sobre --accent-wash + ${bg} en ${theme}: ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('texto sobre el cielo ≥ 4,5:1', () => {
    expect(
      contrastRatio(tokens['--on-accent']!.light, tokens['--accent']!.light),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens: respaldo en hex', () => {
  const close = (hex: string, rgb: Rgb) => {
    const parsed = parseHex(hex);
    if (!parsed) return false;
    return (
      Math.max(Math.abs(parsed.r - rgb.r), Math.abs(parsed.g - rgb.g), Math.abs(parsed.b - rgb.b)) *
        255 <=
      2.5
    );
  };

  it('el hex de cada tema es la conversión de su OKLCH', () => {
    const light = fallbackTokens(':root {');
    const dark = fallbackTokens(":root[data-scheme='dark'] {");
    expect(Object.keys(light).length).toBeGreaterThan(10);
    for (const [name, hex] of Object.entries(light)) {
      const expected = tokens[name]?.light;
      if (expected)
        expect(close(hex, expected), `${name} claro: ${hex} ≠ ${rgbToHex(expected)}`).toBe(true);
    }
    for (const [name, hex] of Object.entries(dark)) {
      const expected = tokens[name]?.dark;
      if (expected)
        expect(close(hex, expected), `${name} oscuro: ${hex} ≠ ${rgbToHex(expected)}`).toBe(true);
    }
  });
});

describe('ningún texto por debajo de 11 px', () => {
  it('tokens de tamaño', () => {
    for (const match of tokensCss.matchAll(/--fs-[a-z0-9]+:\s*([\d.]+)rem/g)) {
      expect(Number(match[1]) * 16).toBeGreaterThanOrEqual(11);
    }
  });

  it('todas las hojas de estilos', () => {
    for (const [file, css] of Object.entries(ALL_CSS)) {
      for (const match of css.matchAll(/font-size:\s*([^;]+);/g)) {
        const value = match[1] ?? '';
        const px = /^([\d.]+)px$/.exec(value.trim());
        const rem = /^([\d.]+)rem$/.exec(value.trim());
        if (px) expect(Number(px[1]), `${file}: ${value}`).toBeGreaterThanOrEqual(11);
        if (rem) expect(Number(rem[1]) * 16, `${file}: ${value}`).toBeGreaterThanOrEqual(11);
      }
    }
  });
});
