import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hueFromName,
  isForbiddenHue,
  oklchCss,
  oklchToRgb,
  parseHex,
  parseOklch,
  rgbToHex,
  rgbToOklch,
  teamLight,
} from './color.ts';

describe('color', () => {
  it('lee hex de ESPN (sin #), cortos y largos', () => {
    expect(parseHex('cb3524')).toEqual({ r: 203 / 255, g: 53 / 255, b: 36 / 255 });
    expect(rgbToHex(parseHex('#fff') ?? { r: 0, g: 0, b: 0 })).toBe('#ffffff');
    expect(parseHex('zzz')).toBeNull();
    expect(parseHex(null)).toBeNull();
  });

  it('OKLCH ida y vuelta (el cielo de la marca)', () => {
    const sky = parseHex('5fd9ff');
    if (!sky) throw new Error('hex');
    const lch = rgbToOklch(sky);
    expect(lch.l).toBeCloseTo(0.83, 2);
    expect(lch.c).toBeCloseTo(0.12, 2);
    expect(lch.h).toBeCloseTo(222, 0);
    expect(rgbToHex(oklchToRgb(lch))).toBe('#5fd9ff');
  });

  it('contraste WCAG', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 1, g: 1, b: 1 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
  });

  it('parseOklch y oklchCss se entienden', () => {
    const value = oklchCss({ l: 0.5, c: 0.13, h: 245 }, 0.5);
    expect(value).toBe('oklch(0.5 0.13 245 / 0.5)');
    expect(parseOklch(value)).toEqual({ l: 0.5, c: 0.13, h: 245 });
    expect(parseOklch('oklch(83% 0.12 222)')).toEqual({ l: 0.83, c: 0.12, h: 222 });
    expect(parseOklch('#fff')).toBeNull();
  });

  it('el tono sacado del nombre nunca es violeta ni de estado (regla C2)', () => {
    for (const name of [
      'DAZN 1',
      'M+ LaLiga',
      'Eurosport',
      'Movistar Plus+',
      'beIN',
      'La 1',
      'TV3',
      'Gol',
    ]) {
      const hue = hueFromName(name);
      expect(isForbiddenHue(hue)).toBe(false);
      expect(hueFromName(name)).toBe(hue);
    }
    expect(isForbiddenHue(300)).toBe(true);
    expect(isForbiddenHue(150)).toBe(true);
    expect(isForbiddenHue(27)).toBe(true);
    expect(isForbiddenHue(222)).toBe(false);
  });

  it('un blanco de club usa su segundo color en el tema claro', () => {
    const light = teamLight('f7f8fa', '132257', 'light');
    const dark = teamLight('f7f8fa', '132257', 'dark');
    expect(light?.h).toBeGreaterThan(250);
    expect(light?.l).toBeLessThanOrEqual(0.74);
    expect(dark?.l).toBeGreaterThan(0.9);
    expect(teamLight(null, null, 'dark')).toBeNull();
  });
});
