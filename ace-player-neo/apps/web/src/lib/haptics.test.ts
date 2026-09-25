import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic, HAPTIC_MAP, HAPTIC_PATTERN, resetHaptics, type HapticKind } from './haptics.ts';

const realMatchMedia = window.matchMedia;

function reducedMotion(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: on && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetHaptics();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
  delete (navigator as { vibrate?: unknown }).vibrate;
});

describe('háptica web mínima (W13)', () => {
  it('vibra con el patrón de cada tipo y devuelve true', () => {
    expect(haptic('rigid')).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(14);
    vi.advanceTimersByTime(50);
    expect(haptic('success')).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([12, 60, 18]);
  });

  it('sin navigator.vibrate (iPhone, escritorio) no hace nada y no lanza', () => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    expect(haptic('light')).toBe(false);
  });

  it('sin ráfagas: la misma sensación no se repite en menos de 40 ms', () => {
    expect(haptic('light')).toBe(true);
    expect(haptic('light')).toBe(false);
    vi.advanceTimersByTime(30);
    expect(haptic('light')).toBe(false);
    // Otra sensación distinta sí pasa; y la misma, pasados los 40 ms, también.
    expect(haptic('medium')).toBe(true);
    vi.advanceTimersByTime(45);
    expect(haptic('medium')).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('«selección» se silencia con reducir movimiento; los impactos no', () => {
    reducedMotion(true);
    expect(haptic('selection')).toBe(false);
    expect(haptic('heavy')).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('el mapa documenta dónde dispara cada tipo y cada tipo tiene patrón', () => {
    const kinds = Object.keys(HAPTIC_PATTERN) as HapticKind[];
    for (const kind of kinds) {
      expect(HAPTIC_MAP[kind].length, kind).toBeGreaterThan(0);
      const pattern = HAPTIC_PATTERN[kind];
      // Ningún tramo de vibración por debajo de 40 ms se repite pegado: son
      // pulsos cortos separados por pausas de ≥ 60 ms.
      if (Array.isArray(pattern))
        for (let i = 1; i < pattern.length; i += 2) expect(pattern[i]).toBeGreaterThanOrEqual(60);
    }
  });
});
