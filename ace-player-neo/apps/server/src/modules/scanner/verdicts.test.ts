/* Veredictos por fuente: el reproductor manda 3 min, lo verificado que
   falla una vez queda flojo y todo caduca (T-122; B-023, B-025, B-048). */

import { describe, expect, it } from 'vitest';
import { FAKE_CLOCK_EPOCH } from '../../core/clock.js';
import { veredictoDelReproductor } from '../sources/stats.js';
import * as legacy from './legacy-exports.js';
import { VerdictCache, sourceStateOf, verdictPolicy } from './verdicts.js';

const MIN = 60_000;

describe('veredictos (B-025, B-026, B-048)', () => {
  it('T-122 · una fuente verificada que falla una prueba queda floja y lo que ve el reproductor manda', () => {
    const t0 = FAKE_CLOCK_EPOCH;
    const id = 'd'.repeat(40);
    legacy.recordScannerVerdict(id, { state: 'working', reason: 'playable_media' }, t0);
    let veredicto = legacy.recordScannerVerdict(
      id,
      { state: 'failed', reason: 'timeout' },
      t0 + 1000,
    );
    expect([veredicto.state, veredicto.reason]).toEqual(['weak', 'intermittent']);
    veredicto = legacy.recordScannerVerdict(id, { state: 'failed', reason: 'timeout' }, t0 + 2000);
    expect(veredicto.state).toBe('failed');
    // lo que habla del vídeo, no de la red, no se suaviza
    const hevc = 'e'.repeat(40);
    legacy.recordScannerVerdict(hevc, { state: 'working', reason: 'playable_media' }, t0);
    expect(
      legacy.recordScannerVerdict(hevc, { state: 'failed', reason: 'unsupported_codec' }, t0 + 1000)
        .state,
    ).toBe('failed');
    // el reproductor manda durante unos minutos sobre el comprobador
    const vista = 'f'.repeat(40);
    legacy.recordScannerVerdict(vista, { state: 'working', reason: 'player_ok', by: 'player' }, t0);
    expect(legacy.playerVerdictHeld(vista, t0 + 60 * 1000)).toBe(true);
    expect(
      legacy.recordScannerVerdict(vista, { state: 'failed', reason: 'timeout' }, t0 + 60 * 1000)
        .state,
    ).toBe('working');
    expect(legacy.playerVerdictHeld(vista, t0 + 4 * 60 * 1000)).toBe(false);
    // traducción de lo que cuenta el reproductor
    expect(veredictoDelReproductor('arranco', 0)).toEqual({
      state: 'working',
      reason: 'player_ok',
    });
    expect(veredictoDelReproductor('sigue', 0)).toEqual({ state: 'working', reason: 'player_ok' });
    expect(veredictoDelReproductor('cayo', 600)).toEqual({
      state: 'weak',
      reason: 'player_dropped',
    });
    expect(veredictoDelReproductor('cayo', 10)).toEqual({
      state: 'failed',
      reason: 'player_failed',
    });
    expect(veredictoDelReproductor('fallo', 0)).toEqual({
      state: 'failed',
      reason: 'player_failed',
    });
    /* La regla del drenador ("la fuente que se está viendo no se vuelve a
       probar aunque se fuerce") se prueba con la cola en service.test.ts. */
    expect(legacy.scannerCacheHit(vista, t0 + MIN)?.by).toBe('player');
  });

  it('un veredicto retenido se devuelve como estaba, con cached; el del reproductor siempre se anota', () => {
    const cache = new VerdictCache(verdictPolicy(10 * MIN));
    const id = '1'.repeat(40);
    cache.record(id, { state: 'failed', reason: 'player_failed', by: 'player' }, 0);
    const held = cache.record(id, { state: 'working', reason: 'playable_media' }, MIN);
    expect(held.entry).toBeNull();
    expect(held.verdict).toMatchObject({
      state: 'failed',
      by: 'player',
      cached: true,
      cachedAt: 0,
    });
    const replaced = cache.record(id, { state: 'working', reason: 'player_ok', by: 'player' }, MIN);
    expect(replaced.entry?.cachedAt).toBe(MIN);
    expect(cache.held(id, MIN + 3 * MIN - 1)).toBe(true);
    expect(cache.held(id, MIN + 3 * MIN)).toBe(false);
  });

  it('el suavizado solo vale sobre una verificada de los últimos 10 min y ajusta playableOn', () => {
    const cache = new VerdictCache(verdictPolicy(10 * MIN));
    const id = '2'.repeat(40);
    cache.record(id, { state: 'working', reason: 'playable_media' }, 0);
    const late = cache.record(id, { state: 'failed', reason: 'timeout' }, 10 * MIN + 1);
    expect(late.verdict.state).toBe('failed');
    cache.record(id, { state: 'working', reason: 'playable_media' }, 11 * MIN);
    const soft = cache.record(
      id,
      { state: 'failed', reason: 'no_media', playableOn: { web: false, ios: false } },
      12 * MIN,
    );
    expect(soft.verdict).toMatchObject({
      state: 'weak',
      reason: 'intermittent',
      playableOn: { web: true, ios: true },
    });
    const hard = cache.record(id, { state: 'failed', reason: 'no_video' }, 12 * MIN + 1);
    expect(hard.verdict.state).toBe('failed');
  });

  it('caducidad (B-023): 10 min lo bueno, el retraso de reintento lo fallido; la poda borra', () => {
    const cache = new VerdictCache(verdictPolicy(2 * MIN));
    const good = '3'.repeat(40);
    const bad = '4'.repeat(40);
    cache.record(good, { state: 'weak', reason: 'slow_data' }, 0);
    cache.record(bad, { state: 'failed', reason: 'timeout' }, 0);
    expect(cache.size).toBe(2);
    expect(cache.hit(bad, 2 * MIN)).not.toBeNull();
    expect(cache.hit(bad, 2 * MIN + 1)).toBeNull();
    expect(cache.peek(bad)).toBeUndefined();
    expect(cache.hit(good, 10 * MIN)).not.toBeNull();
    cache.prune(10 * MIN + 1);
    expect(cache.size).toBe(0);
    expect(cache.hit('nada', 0)).toBeNull();
    cache.record(good, { state: 'working', reason: 'x' }, 0);
    cache.delete(good);
    expect(cache.size).toBe(0);
    cache.record(good, { state: 'working', reason: 'x' }, 0);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('estado explícito de una fuente a partir de su veredicto', () => {
    const policy = verdictPolicy(10 * MIN);
    const entry = {
      state: 'weak' as const,
      reason: 'starved',
      by: 'scanner' as const,
      cachedAt: 0,
    };
    expect(sourceStateOf(undefined, 0, policy)).toBe('desconocida');
    expect(sourceStateOf(entry, 0, policy, true)).toBe('comprobando');
    expect(sourceStateOf(entry, MIN, policy)).toBe('floja');
    expect(sourceStateOf(entry, 11 * MIN, policy)).toBe('desconocida');
  });
});
