/* Generador determinista: los datos falsos son siempre los mismos. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashFrom(rand: () => number): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 40; i++) s += hex[Math.floor(rand() * 16)];
  return s;
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}
