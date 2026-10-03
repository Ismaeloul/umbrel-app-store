/* @lento · Guía grande (docs/iptv.md §20.9): 3 000 canales × 3 días (unos
   235 000 programas, ~85 MB de XMLTV) leídos en streaming hasta `guia.db`.
   Mide el tiempo, la memoria (montón de JS y RSS: la caché de SQLite no
   está en el montón), lo que se retrasa el hilo (la IPTV que alguien está
   viendo comparte ese hilo), el tamaño del fichero y lo que tardan un trozo
   de 60 canales × 6 h, una ficha y «ahora / después» de 100 canales.

   El contenedor `storage` tiene 768 MB: el objetivo es no pasar de ~200 MB
   de montón extra y que el hilo no se pare más de ~100 ms. «@lento» es la
   etiqueta: corre en la tanda normal (unos 10-30 s en este PC). */

import { statSync } from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createSilentLogger } from '../../core/logger.js';
import { tempDir } from '../../../test/helpers/index.js';
import { fakeGuideChunks, fakeGuideEstimate } from '../../../test/fake-iptv/guia.js';
import { GuideStore } from './guide-db.js';
import { buildFullGuide } from './guide-full.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 3, 12, 0);
const MB = 1024 * 1024;
const stores: GuideStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('@lento guía grande', () => {
  it('3 000 canales × 3 días: entera en disco, poca memoria, el hilo sin pararse y trozos rápidos', async () => {
    const options = { channels: 3000, from: NOW - 24 * HOUR, days: 3, logoEvery: 10 };
    const all = new Map<string, number>();
    for (let index = 1; index <= options.channels; index += 1) all.set(`canal${index}.es`, 0);
    const dir = tempDir('ace-guia-grande-');
    const store = new GuideStore(path.join(dir, 'guia.db'), dir, createSilentLogger());
    stores.push(store);

    /* El hilo en reposo, con la carga que tenga el PC ahora mismo: la referencia del retraso. */
    const idle = monitorEventLoopDelay({ resolution: 10 });
    idle.enable();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    idle.disable();
    const idleP99 = idle.percentile(99) / 1e6;

    global.gc?.();
    const baseHeap = process.memoryUsage().heapUsed;
    const baseRss = process.memoryUsage().rss;
    let peakHeap = baseHeap;
    let peakRss = baseRss;
    const sampler = setInterval(() => {
      const usage = process.memoryUsage();
      peakHeap = Math.max(peakHeap, usage.heapUsed);
      peakRss = Math.max(peakRss, usage.rss);
    }, 10);
    let lateness = 0;
    let expected = performance.now() + 10;
    const ticker = setInterval(() => {
      const now = performance.now();
      lateness = Math.max(lateness, now - expected);
      expected = now + 10;
    }, 10);
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();

    const started = performance.now();
    const marks = { parsed: 0, finished: 0, installed: 0 };
    let meta: Awaited<ReturnType<ReturnType<GuideStore['begin']>['finish']>>;
    try {
      const writer = store.begin({
        providerId: 'p_grande01',
        builtAt: NOW,
        source: 'xmltv',
        logger: createSilentLogger(),
      });
      const result = await buildFullGuide(Readable.from(fakeGuideChunks(options)), {
        now: NOW,
        eventChannels: new Map(),
        allChannels: all,
        writer,
      });
      expect(result.writerError).toBe(null);
      marks.parsed = performance.now();
      meta = await writer.finish();
      marks.finished = performance.now();
      store.install('p_grande01');
      marks.installed = performance.now();
    } finally {
      clearInterval(sampler);
      clearInterval(ticker);
      delay.disable();
    }
    const reader = store.current();
    expect(reader).not.toBe(null);
    const estimate = fakeGuideEstimate(options);
    expect(meta.programmes).toBeGreaterThan(estimate * 0.85);
    expect(meta.channels).toBe(options.channels);
    expect(meta.truncated).toBe(false);

    /* Consultas como las de la parrilla: 60 canales × 6 h, una ficha y «ahora / después» de 100. */
    const channels = [...(reader?.channels().values() ?? [])];
    const sliceTimes: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      const from = NOW - 12 * HOUR + round * HOUR;
      const group = channels.slice((round * 60) % 2940, ((round * 60) % 2940) + 60);
      const t0 = performance.now();
      let count = 0;
      for (const info of group)
        count += reader?.slice(info.g, from, from + 6 * HOUR, 400).length ?? 0;
      sliceTimes.push(performance.now() - t0);
      expect(count).toBeGreaterThan(60 * 3);
    }
    const t1 = performance.now();
    for (const info of channels.slice(0, 100)) reader?.nowNext(info.g, NOW);
    const nowMs = performance.now() - t1;
    const first = channels[0];
    const t2 = performance.now();
    const detail = first ? reader?.slice(first.g, NOW, NOW + HOUR, 1)[0] : undefined;
    const programme = first && detail ? reader?.programme(first.g, detail.s) : null;
    const detailMs = performance.now() - t2;
    expect(programme?.description).toContain('Una historia inventada');

    const size = statSync(path.join(dir, 'guia.db')).size;
    const heapMb = (peakHeap - baseHeap) / MB;
    const rssMb = (peakRss - baseRss) / MB;
    const p99 = delay.percentile(99) / 1e6;
    const summary = [
      `${meta.programmes} programas de ${meta.channels} canales`,
      `leer ${Math.round(marks.parsed - started)} ms`,
      `arreglar ${Math.round(marks.finished - marks.parsed)} ms`,
      `instalar ${Math.round(marks.installed - marks.finished)} ms`,
      `fichero ${(size / MB).toFixed(1)} MB`,
      `montón +${heapMb.toFixed(1)} MB`,
      `RSS +${rssMb.toFixed(1)} MB`,
      `hilo p99 ${p99.toFixed(1)} ms (en reposo ${idleP99.toFixed(1)}), máx ${(delay.max / 1e6).toFixed(1)} ms, reloj tarde ${Math.round(lateness)} ms`,
      `trozo 60×6 h mediana ${median(sliceTimes).toFixed(1)} ms (peor ${Math.max(...sliceTimes).toFixed(1)})`,
      `ahora/después ×100 ${nowMs.toFixed(1)} ms`,
      `ficha ${detailMs.toFixed(2)} ms`,
    ].join(' · ');
    console.info(`[guía @lento] ${summary}`);

    /* Pico del montón con la basura que aún no ha recogido V8 (también la del generador de la
       prueba): +33-38 MB en reposo, más con el PC cargado. Lo de la guía va a disco. */
    expect(heapMb).toBeLessThan(200);
    expect(size).toBeLessThan(150 * MB);
    /* Con el PC cargado (otras pruebas, otros equipos) el hilo va tarde aunque no hagamos nada:
       se compara con el reposo medido justo antes. En el N100 el objetivo es < 50 ms. */
    expect(p99).toBeLessThan(Math.max(120, idleP99 * 3 + 60));
    expect(median(sliceTimes)).toBeLessThan(60);
  }, 300_000);
});
