/* Contraste de la lista de la Agenda de escritorio (DeskList, agenda.css).
   La revisión visual (axe) pilló tres textos por debajo de 4,5:1:
   - el canal de un partido terminado: --text-3 con un 0,6 de opacidad encima;
   - en la fila elegida (velo de acento), el minuto en directo y el canal, en
     oscuro;
   - «En directo (3)» sobre su velo rojo, en claro (y pulsada, peor).
   Aquí se mide sobre la mezcla, con los porcentajes que dice el CSS, en los
   cuatro fondos y los dos temas. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, oklchToRgb, parseOklch, rgbToOklch, type Rgb } from '../../lib/color.ts';

// Se leen del disco: con `css: false` Vitest vacía los .css que se importan.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const agendaCss = readFileSync(path.join(HERE, 'agenda.css'), 'utf8');
const tokensCss = readFileSync(path.join(HERE, '..', '..', 'styles', 'tokens.css'), 'utf8');

type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];
const BACKGROUNDS = ['--bg', '--bg-sunk', '--surface', '--surface-2'];

function tokens(): Record<string, Record<Theme, Rgb>> {
  const block = tokensCss.slice(tokensCss.indexOf('@supports (color: light-dark('));
  const out: Record<string, Record<Theme, Rgb>> = {};
  const pair = /(--[a-z0-9-]+):\s*light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)/g;
  for (const [, name = '', light = '', dark = ''] of block.matchAll(pair)) {
    const l = parseOklch(light);
    const d = parseOklch(dark);
    if (l && d) out[name] = { light: oklchToRgb(l), dark: oklchToRgb(d) };
  }
  // Los que no cambian con el tema (--accent).
  for (const [, name = '', value = ''] of block.matchAll(/(--[a-z0-9-]+):\s*(oklch\([^)/]*\));/g)) {
    const color = parseOklch(value);
    if (color && !out[name]) out[name] = { light: oklchToRgb(color), dark: oklchToRgb(color) };
  }
  return out;
}
const T = tokens();
const tok = (name: string, theme: Theme): Rgb => {
  const value = T[name]?.[theme];
  if (!value) throw new Error(`falta ${name}`);
  return value;
};

/** Un color con alfa encima de otro (lo que pinta el navegador). */
const over = (top: Rgb, under: Rgb, alpha: number): Rgb => ({
  r: top.r * alpha + under.r * (1 - alpha),
  g: top.g * alpha + under.g * (1 - alpha),
  b: top.b * alpha + under.b * (1 - alpha),
});

/** `color-mix(in oklab, a p%, b)`. */
function mixOklab(a: Rgb, b: Rgb, p: number): Rgb {
  const lab = (rgb: Rgb) => {
    const { l, c, h } = rgbToOklch(rgb);
    const rad = (h * Math.PI) / 180;
    return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
  };
  const x = lab(a);
  const y = lab(b);
  const l = x.l * p + y.l * (1 - p);
  const A = x.a * p + y.a * (1 - p);
  const B = x.b * p + y.b * (1 - p);
  return oklchToRgb({
    l,
    c: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  });
}

/** El cuerpo de la primera regla con exactamente ese selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(agendaCss);
  if (!match) throw new Error(`no está la regla ${selector}`);
  return match[1] ?? '';
}

/** `color-mix(in oklab, var(--live-ink) 72%, var(--text))` → 0.72. */
function inkShare(body: string, from: string, to: string): number {
  const match = new RegExp(
    `color:\\s*color-mix\\(in oklab, var\\(${from}\\) (\\d+)%, var\\(${to}\\)\\)`,
  ).exec(body);
  if (!match) throw new Error(`sin la mezcla ${from}/${to} en: ${body}`);
  return Number(match[1]) / 100;
}

function backgroundShare(body: string): number {
  const match = /background:\s*color-mix\(in oklab, var\(--live\) (\d+)%, transparent\)/.exec(body);
  if (!match) throw new Error(`sin el velo rojo en: ${body}`);
  return Number(match[1]) / 100;
}

const WASH: Record<Theme, number> = { light: 0.22, dark: 0.16 };

describe('Agenda de escritorio: contraste de la lista', () => {
  it('un terminado no apaga el texto con opacidad (solo los escudos)', () => {
    expect(agendaCss).not.toMatch(/\.desk-row__teams--done\s*\{[^}]*opacity/);
    expect(rule('.desk-row__teams--done .desk-row__team .team')).toMatch(/opacity:\s*0\.6/);
    expect(
      rule('.desk-row__teams--done .desk-row__name,\n.desk-row__teams--done .desk-row__channel'),
    ).toMatch(/color:\s*var\(--text-2\)/);
    for (const theme of THEMES) {
      for (const bg of BACKGROUNDS) {
        const ratio = contrastRatio(tok('--text-2', theme), tok(bg, theme));
        expect(ratio, `--text-2 sobre ${bg} (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('fila elegida: estado, canal y minuto en directo ≥ 4,5:1 sobre el velo de acento', () => {
    expect(rule('.desk-row--sel .desk-row__state,\n.desk-row--sel .desk-row__channel')).toMatch(
      /color:\s*var\(--text-2\)/,
    );
    const share = inkShare(
      rule(
        '.desk-row--sel .desk-row__when--live .desk-row__state,\n.desk-row--sel .desk-row__score--live',
      ),
      '--live-ink',
      '--text',
    );
    for (const theme of THEMES) {
      const live = mixOklab(tok('--live-ink', theme), tok('--text', theme), share);
      for (const bg of BACKGROUNDS) {
        const under = over(tok('--accent', theme), tok(bg, theme), WASH[theme]);
        for (const [name, color] of [
          ['--text-2', tok('--text-2', theme)],
          ['minuto en directo', live],
        ] as const) {
          const ratio = contrastRatio(color, under);
          expect(
            ratio,
            `${name} sobre el velo + ${bg} (${theme}): ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('«En directo» ≥ 4,5:1 sobre su velo rojo, suelta y pulsada', () => {
    for (const selector of [
      '.desk-pill--live.chip--button',
      ".desk-pill--live.chip--button[aria-pressed='true']",
    ]) {
      const body = rule(selector);
      const share = inkShare(body, '--live-ink', '--text');
      const veil = backgroundShare(body);
      for (const theme of THEMES) {
        const ink = mixOklab(tok('--live-ink', theme), tok('--text', theme), share);
        for (const bg of BACKGROUNDS) {
          const under = over(tok('--live', theme), tok(bg, theme), veil);
          const ratio = contrastRatio(ink, under);
          expect(
            ratio,
            `${selector} sobre ${bg} (${theme}): ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
