import { describe, expect, it, vi } from 'vitest';
import { FAKE_CLOCK_EPOCH, FakeClock, createSystemClock } from './clock.js';

describe('FakeClock', () => {
  it('empieza en una fecha fija y solo avanza cuando se le pide', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(FAKE_CLOCK_EPOCH);
    expect(clock.date().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(1500);
    expect(clock.now()).toBe(FAKE_CLOCK_EPOCH + 1500);
  });

  it('dispara los temporizadores en orden de hora y, a igual hora, de programación', () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push('b'), 20);
    clock.setTimeout(() => order.push('a'), 10);
    clock.setTimeout(() => order.push('c'), 20);
    clock.advance(15);
    expect(order).toEqual(['a']);
    clock.advance(5);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(clock.pendingTimers()).toBe(0);
  });

  it('cada temporizador ve la hora a la que vence, y los que se programan dentro también corren', () => {
    const clock = new FakeClock(0);
    const seen: number[] = [];
    clock.setTimeout(() => {
      seen.push(clock.now());
      clock.setTimeout(() => seen.push(clock.now()), 5);
    }, 10);
    clock.advance(100);
    expect(seen).toEqual([10, 15]);
    expect(clock.now()).toBe(100);
  });

  it('los intervalos se repiten hasta cancelarlos', () => {
    const clock = new FakeClock(0);
    const fn = vi.fn();
    const handle = clock.setInterval(fn, 10);
    clock.advance(35);
    expect(fn).toHaveBeenCalledTimes(3);
    clock.clearInterval(handle);
    clock.advance(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('clearTimeout cancela y set() salta sin volver atrás', () => {
    const clock = new FakeClock(0);
    const fn = vi.fn();
    clock.clearTimeout(clock.setTimeout(fn, 10));
    clock.set(50);
    expect(fn).not.toHaveBeenCalled();
    expect(() => clock.set(10)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });

  it('sleep se resuelve al avanzar y se cancela con la señal', async () => {
    const clock = new FakeClock(0);
    const done = vi.fn();
    const sleeping = clock.sleep(45_000).then(done);
    await clock.advanceAsync(44_999);
    expect(done).not.toHaveBeenCalled();
    await clock.advanceAsync(1);
    await sleeping;
    expect(done).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const aborted = clock.sleep(1000, controller.signal);
    controller.abort(new Error('cancelado'));
    await expect(aborted).rejects.toThrow('cancelado');
    expect(clock.pendingTimers()).toBe(0);
    await expect(clock.sleep(10, controller.signal)).rejects.toThrow('cancelado');
  });

  it('advanceAsync deja terminar los await de un bucle de sondeo', async () => {
    const clock = new FakeClock(0);
    let polls = 0;
    const loop = async (): Promise<void> => {
      while (polls < 3) {
        await clock.sleep(400);
        await Promise.resolve();
        polls += 1;
      }
    };
    const running = loop();
    await clock.advanceAsync(1200);
    await running;
    expect(polls).toBe(3);
  });
});

describe('reloj del sistema', () => {
  it('usa Date.now y los temporizadores reales', async () => {
    const clock = createSystemClock();
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1000);
    await clock.sleep(1);
    const fn = vi.fn();
    clock.clearTimeout(clock.setTimeout(fn, 1, { unref: true }));
    const interval = clock.setInterval(fn, 1000, { unref: true });
    clock.clearInterval(interval);
    clock.clearTimeout(null);
    expect(fn).not.toHaveBeenCalled();
  });
});
