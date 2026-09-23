/* Marca de equipo: monograma con los colores del club. NUNCA escudos
   oficiales (ni imágenes de terceros): un círculo con el color principal,
   aro con el secundario y, a partir de 40 px, una placa con las siglas.

   - Colores: los de ESPN (`color` y `alternateColor`, hex sin «#»). Sin datos,
     un tono sacado del nombre fuera de los tonos de estado (eleccion.md,
     «Sin datos, escudo genérico con iniciales y un tono sacado del nombre»).
   - «Los escudos se encienden» solo en directo (`lit`): un halo con el color
     del club normalizado por tema (src/lib/color.ts: los blancos usan su
     segundo color en claro). El halo es una capa que aparece con opacidad.
   - Decorativa: el nombre del equipo siempre está escrito al lado. */

import type { CSSProperties } from 'react';
import { channelTone, oklchCss, parseHex, rgbToHex, teamLight, hueFromName } from '../lib/color.ts';
import { cx } from '../lib/cx.ts';
import './TeamMark.css';

export interface TeamColors {
  primary?: string | null;
  secondary?: string | null;
}

export interface TeamMarkProps {
  name: string;
  /** Siglas para la placa (ESPN da `abbreviation`); si no, se sacan del nombre. */
  short?: string;
  colors?: TeamColors;
  /** Lado en px. */
  size?: number;
  /** En directo: el escudo se enciende. */
  lit?: boolean;
  /** Dibujo del círculo (el dato no lo da ninguna API: por defecto, liso). */
  pattern?: 'liso' | 'rayas' | 'mitades';
  className?: string;
}

const SKIP = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'el',
  'fc',
  'cf',
  'cd',
  'sd',
  'ud',
  'sc',
  'ac',
  'afc',
  'club',
  'y',
]);

/** «Atlético de Madrid» → «AM»; «Tottenham» → «TOT»; «Real Madrid» → «RM». */
export function teamInitials(name: string, short?: string): string {
  if (short && short.trim()) return short.trim().slice(0, 4).toUpperCase();
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s.-]+/)
    .filter((word) => word && !SKIP.has(word.toLowerCase()));
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function TeamMark({
  name,
  short,
  colors,
  size = 28,
  lit = false,
  pattern = 'liso',
  className,
}: TeamMarkProps) {
  const primaryRgb = parseHex(colors?.primary);
  const secondaryRgb = parseHex(colors?.secondary);
  const fallbackHue = hueFromName(name);
  const primary = primaryRgb ? rgbToHex(primaryRgb) : oklchCss(channelTone(name));
  const secondary = secondaryRgb
    ? rgbToHex(secondaryRgb)
    : oklchCss({ l: 0.93, c: 0.03, h: fallbackHue });
  const glowLight = teamLight(colors?.primary, colors?.secondary, 'light') ?? {
    l: 0.6,
    c: 0.12,
    h: fallbackHue,
  };
  const glowDark = teamLight(colors?.primary, colors?.secondary, 'dark') ?? {
    l: 0.66,
    c: 0.13,
    h: fallbackHue,
  };
  const style = {
    '--s': `${size}px`,
    '--team': primary,
    '--team-2': secondary,
    '--glow-l': oklchCss(glowLight),
    '--glow-d': oklchCss(glowDark),
  } as CSSProperties;
  const withPlate = size >= 40;
  return (
    <span
      className={cx('team', `team--${pattern}`, withPlate && 'team--plate', className)}
      style={style}
      data-lit={lit ? 'true' : 'false'}
      aria-hidden="true"
    >
      {withPlate ? <b className="team__plate">{teamInitials(name, short)}</b> : null}
    </span>
  );
}
