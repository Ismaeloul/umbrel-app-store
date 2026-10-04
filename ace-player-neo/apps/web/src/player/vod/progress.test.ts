/* El progreso de una película (docs/vod.md §10.2 y §12.7). */

import type { VodProgressBody } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VodProgress } from './progress.ts';

const sent: Array<VodProgressBody & { keepalive: boolean }> = [];
const send = async (_id: string, body: VodProgressBody, options: { keepalive?: boolean }) => {
  sent.push({ ...body, keepalive: options.keepalive === true });
};

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('VodProgress', () => {
  it('`tick` cada 15 s solo sonando y si la posición ha cambiado 1 s o más', () => {
    const progress = new VodProgress('x', send);
    progress.tick(10, 100, true);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(15_000);
    progress.tick(25, 100, false);
    expect(sent).toHaveLength(0);
    progress.tick(25, 100, true);
    expect(sent.at(-1)).toMatchObject({ event: 'tick', posS: 25, durS: 100 });
    vi.advanceTimersByTime(15_000);
    progress.tick(25.4, 100, true);
    expect(sent).toHaveLength(1);
  });

  it('el `seek` sale 2 s después del último salto (varios saltos, una marca)', () => {
    const progress = new VodProgress('x', send);
    let at = 10;
    progress.seek(() => at, 100);
    vi.advanceTimersByTime(1_000);
    at = 40;
    progress.seek(() => at, 100);
    vi.advanceTimersByTime(1_999);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ event: 'seek', posS: 40, durS: 100, keepalive: false }]);
  });

  it('`stop` con keepalive es la última marca; después no sale nada más', () => {
    const progress = new VodProgress('x', send);
    progress.stop(50, 100, { keepalive: true });
    progress.pause(60, 100);
    progress.ended(100);
    expect(sent).toEqual([{ event: 'stop', posS: 50, durS: 100, keepalive: true }]);
  });

  it('nunca manda más que la duración (el servidor rechaza posS > durS + 5)', () => {
    const progress = new VodProgress('x', send);
    progress.pause(130, 100);
    expect(sent[0]).toMatchObject({ posS: 100 });
  });
});
