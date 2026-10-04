/* Cola de fichas (docs/vod.md §7.1 y §15.1): coalescencia, 1 en vuelo,
   300 ms entre llamadas, 60 por minuto, 8 en espera, precargas y LRU por
   bytes con TTL. */

import { describe, expect, it } from 'vitest';
import { VOD_DETAILS, type VodKind } from '@ace/shared';
import { FakeClock } from '../../../core/clock.js';
import { VodDetailsQueue, type VodDetailsLimits } from './details.js';
import { parseMovieInfo, parseSeriesInfo, type VodInfo } from './parse.js';

interface Call {
  readonly kind: VodKind;
  readonly source: number;
  readonly at: number;
  resolve(value: VodInfo): void;
  reject(error: Error): void;
}

function rig(limits: VodDetailsLimits = VOD_DETAILS) {
  const clock = new FakeClock();
  const calls: Call[] = [];
  const queue = new VodDetailsQueue(
    clock,
    (kind, source) =>
      new Promise<VodInfo>((resolve, reject) => {
        calls.push({ kind, source, at: clock.now(), resolve, reject });
      }),
    limits,
  );
  return { clock, calls, queue };
}

const movie = (plot = 'Sinopsis'): VodInfo => parseMovieInfo({ info: { name: 'X', plot } });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('VodDetailsQueue', () => {
  it('coalescencia: 10 peticiones de la misma ficha hacen una sola llamada', async () => {
    const { calls, queue } = rig();
    const all = Array.from({ length: 10 }, () => queue.get('movie', 1));
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(movie());
    const results = await Promise.all(all);
    expect(results.every((result) => result.info === 'ok')).toBe(true);
    /* Y la siguiente sale de la caché. */
    expect((await queue.get('movie', 1)).info).toBe('ok');
    expect(queue.calls).toBe(1);
  });

  it('una en vuelo y 300 ms entre llamadas', async () => {
    const { clock, calls, queue } = rig();
    const a = queue.get('movie', 1);
    const b = queue.get('movie', 2);
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(movie());
    await a;
    await tick();
    expect(calls).toHaveLength(1);
    await clock.advanceAsync(299);
    expect(calls).toHaveLength(1);
    await clock.advanceAsync(1);
    expect(calls).toHaveLength(2);
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBe(300);
    calls[1]?.resolve(movie());
    await b;
  });

  it('60 por minuto como mucho', async () => {
    const { clock, calls, queue } = rig({ ...VOD_DETAILS, waitingMax: 100 });
    const pending: Array<Promise<unknown>> = [];
    for (let i = 0; i < 61; i += 1) pending.push(queue.get('movie', i + 1));
    for (let i = 0; i < 60; i += 1) {
      await clock.advanceAsync(300);
      calls[i]?.resolve(movie());
      await tick();
    }
    await clock.advanceAsync(300);
    expect(calls).toHaveLength(60);
    /* La 61.ª espera a que la primera salga de la ventana de 60 s. */
    await clock.advanceAsync(60_000);
    expect(calls).toHaveLength(61);
    expect((calls[60]?.at ?? 0) - (calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(60_000);
    calls[60]?.resolve(movie());
    await Promise.all(pending);
  });

  it('con 8 en espera, `failed` al momento; un fallo del proveedor, `failed` y sin caché', async () => {
    const { calls, queue } = rig();
    const first = queue.get('movie', 1);
    const waiting = Array.from({ length: 8 }, (_, i) => queue.get('movie', i + 2));
    expect(await queue.get('movie', 99)).toEqual({ info: 'failed' });
    calls[0]?.reject(new Error('502'));
    expect(await first).toEqual({ info: 'failed' });
    expect(queue.peek('movie', 1)).toBeNull();
    queue.clear();
    expect((await Promise.all(waiting)).every((result) => result.info === 'failed')).toBe(true);
  });

  it('precarga con la cola ocupada → `pending` sin llamar; con la cola vacía, se lanza', async () => {
    const { calls, queue } = rig();
    const busy = queue.get('movie', 1);
    expect(await queue.get('movie', 2, { pre: true })).toEqual({ info: 'pending' });
    expect(await queue.get('movie', 1, { pre: true })).toEqual({ info: 'pending' });
    expect(calls).toHaveLength(1);
    calls[0]?.resolve(movie());
    await busy;
    const { calls: calls2, queue: idle } = rig();
    const pre = idle.get('series', 5, { pre: true });
    expect(calls2).toHaveLength(1);
    calls2[0]?.resolve(parseSeriesInfo({ episodes: [] }));
    expect((await pre).info).toBe('ok');
  });

  it('LRU por bytes, TTL de 6 h y se vacía con `clear`', async () => {
    const small = rig({ ...VOD_DETAILS, cacheBytes: 2_000, spacingMs: 0 });
    for (const source of [1, 2, 3]) {
      const got = small.queue.get('movie', source);
      small.calls[source - 1]?.resolve(movie('x'.repeat(500)));
      await got;
      await tick();
    }
    /* Cada ficha ocupa ~700 bytes: con 2 000, la primera se ha ido. */
    expect(small.queue.peek('movie', 1)).toBeNull();
    expect(small.queue.peek('movie', 3)).not.toBeNull();
    small.clock.advance(VOD_DETAILS.ttlMs + 1);
    expect(small.queue.peek('movie', 3)).toBeNull();
    const again = small.queue.get('movie', 2);
    small.calls[3]?.resolve(movie());
    await again;
    small.queue.clear();
    expect(small.queue.peek('movie', 2)).toBeNull();
  });

  it('una serie de 3 000 episodios (la más grande que se admite) cabe en la caché', async () => {
    const { calls, queue } = rig();
    const episodes = Array.from({ length: 3_000 }, (_, i) => ({
      id: i + 1,
      episode_num: (i % 500) + 1,
      season: Math.floor(i / 500) + 1,
      title: `Ep ${i}`,
      info: { plot: 'y'.repeat(600) },
    }));
    const got = queue.get('series', 1);
    calls[0]?.resolve(parseSeriesInfo({ episodes }));
    const result = await got;
    expect(result.info).toBe('ok');
    expect(queue.peek('series', 1)).not.toBeNull();
  });
});
