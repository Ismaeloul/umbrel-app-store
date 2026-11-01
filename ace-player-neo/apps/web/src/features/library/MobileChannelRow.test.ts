import { describe, expect, it } from 'vitest';
import { remainingText } from './MobileChannelRow.tsx';

describe('remainingText (cuánto le queda al programa, móvil)', () => {
  const now = Date.UTC(2026, 10, 1, 20, 0);
  const min = (n: number) => now + n * 60_000;

  it('en minutos, en singular con 1 y redondeando hacia arriba', () => {
    expect(remainingText(min(25), now)).toBe('quedan 25 min');
    expect(remainingText(min(1), now)).toBe('queda 1 min');
    expect(remainingText(min(0.2), now)).toBe('queda 1 min');
  });

  it('con horas: «1 h», «1 h 20 min»', () => {
    expect(remainingText(min(60), now)).toBe('quedan 1 h');
    expect(remainingText(min(80), now)).toBe('quedan 1 h 20 min');
  });

  it('un programa ya acabado no dice nada', () => {
    expect(remainingText(now, now)).toBeNull();
    expect(remainingText(min(-5), now)).toBeNull();
  });
});
