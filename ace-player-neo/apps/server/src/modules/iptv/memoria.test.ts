/* @lento · Memoria de una sincronización grande (docs/iptv.md §3.3 y §12.2,
   riesgo 6): 100 000 canales de `get_live_streams` troceados en streaming,
   sin el pico de 250-300 MB de un `JSON.parse` entero. El contenedor tiene
   `mem_limit: 768m`; el objetivo es que el pico de heap de la sincronización
   quede por debajo de 150 MB. */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createNetClient } from '../net/index.js';
import { fakeTransport, tableResolver } from '../net/testing.js';
import { createStateService } from '../state/index.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { IptvServiceImpl } from './service.js';

const CHANNELS = 100_000;
const HOST = 'grande.example';

function* streamsJson(): Generator<Buffer> {
  yield Buffer.from('[');
  let batch: string[] = [];
  for (let index = 0; index < CHANNELS; index += 1) {
    batch.push(
      JSON.stringify({
        num: index + 1,
        name: `ES: Canal de prueba número ${index} FHD`,
        stream_type: 'live',
        stream_id: index + 1,
        stream_icon: `http://logos.example/${index}.png`,
        epg_channel_id: `Canal${index}.es`,
        added: '1700000000',
        category_id: String(index % 40),
        custom_sid: '',
        tv_archive: 0,
        direct_source: '',
        tv_archive_duration: 0,
      }),
    );
    if (batch.length === 1000) {
      yield Buffer.from(`${index < 1000 ? '' : ','}${batch.join(',')}`);
      batch = [];
    }
  }
  if (batch.length) yield Buffer.from(`,${batch.join(',')}`);
  yield Buffer.from(']');
}

describe('@lento memoria de la sincronización Xtream', () => {
  it('100 000 canales: el catálogo se completa y el pico de heap queda por debajo de 150 MB', async () => {
    const core = createTestCore();
    const transport = fakeTransport((request) => {
      const action = request.url.searchParams.get('action');
      if (!action) {
        return {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            user_info: {
              auth: 1,
              status: 'Active',
              max_connections: '1',
              active_cons: '0',
              allowed_output_formats: ['ts'],
            },
          }),
        };
      }
      if (action === 'get_live_categories') return { body: '[]' };
      if (action === 'get_live_streams') return { body: Readable.from(streamsJson()) };
      return { status: 404 };
    });
    const net = createNetClient({
      ...core,
      resolver: tableResolver({ [HOST]: [{ address: '93.184.216.34', family: 4 }] }),
      transport,
    });
    const state = createStateService(core);
    await state.load();
    const service = new IptvServiceImpl({ ...core, state, net });
    global.gc?.();
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 10);
    try {
      await service.save(
        { kind: 'xtream', server: `http://${HOST}`, username: 'usuario', password: 'clave-larga' },
        new AbortController().signal,
      );
      await service.idle();
    } finally {
      clearInterval(sampler);
    }
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    expect(service.catalogForTests()?.size).toBe(CHANNELS);
    const grewMb = (peak - baseline) / 1024 / 1024;
    expect(grewMb).toBeLessThan(150);
    await service.stop();
  }, 60_000);
});
