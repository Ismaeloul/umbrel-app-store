/* Sincronización del catálogo VOD (docs/vod.md §4.2, §4.7 y §15.1) con un
   transporte falso: pasos, tope que recorta, `skipped`, «sin VOD», modo por
   categorías y cadencia. Lo que depende del servicio (aplicar solo con el
   mismo proveedor, abortar al guardar o eliminar, `IptvStatus.vod`) está en
   vod-service.test.ts. */

import { describe, expect, it } from 'vitest';
import { VOD_LIMITS, VOD_REFRESH_MS } from '@ace/shared';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver, type FakeReply } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import {
  syncVodCatalog,
  vodDueAction,
  vodDueAtStart,
  vodPeriodicDelay,
  vodRetryDelay,
  VOD_RETRY_MS,
} from './catalog.js';

const HOST = 'panel.example';
const CREDS = { server: `http://${HOST}`, username: 'usuario', password: 'clave-larga' };

const movies = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    stream_id: i + 1,
    name: `Película ${i + 1}`,
    stream_type: 'movie',
    category_id: String(1 + (i % 2)),
    added: 1_700_000_000 + i,
    ...extra(i),
  }));

function rig(answer: (action: string, url: URL) => FakeReply | undefined) {
  const core = createTestCore();
  const transport = fakeTransport((request) => {
    const action = request.url.searchParams.get('action') ?? '';
    return answer(action, request.url) ?? { body: '[]' };
  });
  const net = createNetClient({
    ...core,
    resolver: tableResolver({ [HOST]: [{ address: '93.184.216.34', family: 4 }] }),
    transport,
  });
  const run = (mode: 'completo' | 'por_categorias' = 'completo', signal = new AbortController().signal) =>
    syncVodCatalog(
      { net, clock: core.clock, logger: core.logger, credentials: CREDS, policy: { lan: false }, signal },
      { providerId: 'p_prueba01', providerFp: '0123456789abcdef', revision: 2, mode },
    );
  return { core, transport, run };
}

const cats = (list: Array<[string, string]>) =>
  JSON.stringify(list.map(([id, name]) => ({ category_id: id, category_name: name })));

describe('syncVodCatalog', () => {
  it('categorías → películas → series, con sus filas, categorías y meta', async () => {
    const { run, transport } = rig((action) => {
      if (action === 'get_vod_categories') return { body: cats([['1', 'ES | PELIS'], ['2', 'XXX']]) };
      if (action === 'get_series_categories') return { body: cats([['5', 'Series']]) };
      if (action === 'get_vod_streams') return { body: JSON.stringify(movies(4)) };
      if (action === 'get_series') {
        return { body: JSON.stringify([{ series_id: 9, name: 'Serie', category_id: '5', last_modified: '1700000000' }]) };
      }
      return undefined;
    });
    const result = await run();
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    const { catalog } = result;
    expect(catalog.tables.movie.n).toBe(4);
    expect(catalog.tables.series.n).toBe(1);
    expect(catalog.tables.movie.cats).toEqual(['ES | PELIS', 'XXX']);
    expect(catalog.tables.movie.isAdult(1)).toBe(true);
    expect(catalog.meta).toMatchObject({ revision: 2, truncated: false, skipped: 0, mode: 'completo' });
    expect(catalog.stamp).toMatch(/^[a-z0-9]{1,16}$/);
    expect(transport.requests.map((request) => request.url.searchParams.get('action'))).toEqual([
      'get_vod_categories',
      'get_vod_streams',
      'get_series_categories',
      'get_series',
    ]);
    /* Ninguna llamada lleva parámetros fuera de la lista cerrada. */
    for (const request of transport.requests) {
      expect([...request.url.searchParams.keys()].sort()).toEqual(['action', 'password', 'username']);
    }
  });

  it('`skipped` cuenta ids malos, objetos que no lo son, repetidos y demasiado grandes', async () => {
    const { run } = rig((action) => {
      if (action === 'get_vod_streams') {
        const list = [
          ...movies(3),
          { stream_id: 'abc', name: 'Mal' },
          { stream_id: 2, name: 'Repetida' },
          7,
          { stream_id: 50, name: 'Enorme', plot: 'x'.repeat(VOD_LIMITS.movies.maxObjectBytes) },
        ];
        return { body: JSON.stringify(list) };
      }
      return undefined;
    });
    const result = await run();
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      expect(result.catalog.tables.movie.n).toBe(3);
      expect(result.catalog.meta.skipped).toBe(4);
    }
  });

  it('pasar el tope RECORTA con `truncated` y corta la descarga', async () => {
    const big = movies(VOD_LIMITS.maxMovies + 50, () => ({}));
    const { run } = rig((action) => {
      if (action === 'get_vod_streams') return { body: JSON.stringify(big) };
      return undefined;
    });
    const result = await run();
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      expect(result.catalog.tables.movie.n).toBe(VOD_LIMITS.maxMovies);
      expect(result.catalog.meta.truncated).toBe(true);
    }
  }, 60_000);

  it('«sin VOD»: `[]`, `{}` o un objeto con `user_info` en las dos listas es `none`', async () => {
    for (const body of ['[]', '{}', JSON.stringify({ user_info: { auth: 1 } })]) {
      const { run } = rig((action) =>
        action === 'get_vod_streams' || action === 'get_series' ? { body } : undefined,
      );
      expect((await run()).state, body).toBe('none');
    }
    /* Películas sí y series no: listo con 0 series. */
    const { run } = rig((action) => {
      if (action === 'get_vod_streams') return { body: JSON.stringify(movies(1)) };
      if (action === 'get_series') return { body: '{}' };
      return undefined;
    });
    const result = await run();
    expect(result.state === 'ready' && result.catalog.tables.series.n).toBe(0);
  });

  it('una lista completa que falla por 5xx pasa al modo por categorías (250 ms entre llamadas)', async () => {
    const { run, transport, core } = rig((action, url) => {
      if (action === 'get_vod_categories') return { body: cats([['1', 'A'], ['2', 'B']]) };
      if (action === 'get_vod_streams') {
        const category = url.searchParams.get('category_id');
        if (category === null) return { status: 502 };
        return { body: JSON.stringify(movies(4).filter((movie) => movie.category_id === category)) };
      }
      return undefined;
    });
    const promise = run();
    /* La espera entre categorías va con el reloj falso. */
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await core.clock.advanceAsync(VOD_LIMITS.byCategory.spacingMs);
    }
    const result = await promise;
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      expect(result.catalog.tables.movie.n).toBe(4);
      expect(result.catalog.meta.mode).toBe('por_categorias');
    }
    const categories = transport.requests
      .filter((request) => request.url.searchParams.get('action') === 'get_vod_streams')
      .map((request) => request.url.searchParams.get('category_id'));
    expect(categories).toEqual([null, '1', '2']);
  });

  it('un 401 o sin categorías no pasa al modo por categorías: falla con el código IPTV', async () => {
    const { run } = rig((action) => (action === 'get_vod_streams' ? { status: 401 } : undefined));
    await expect(run()).rejects.toMatchObject({ code: 'iptv_auth_failed' });
    const { run: run2 } = rig((action) => (action === 'get_vod_streams' ? { status: 503 } : undefined));
    await expect(run2()).rejects.toMatchObject({ code: 'iptv_unreachable' });
  });

  it('abortar corta la sincronización', async () => {
    const controller = new AbortController();
    const { run } = rig((action) => {
      if (action === 'get_vod_streams') controller.abort(new Error('guardado'));
      return { body: JSON.stringify(movies(2)) };
    });
    await expect(run('completo', controller.signal)).rejects.toBeTruthy();
  });
});

describe('cadencia (§4.7)', () => {
  it('esperas tras un fallo: 15 min, 1 h, 6 h y 24 h', () => {
    expect([1, 2, 3, 4, 9].map(vodRetryDelay)).toEqual([...VOD_RETRY_MS, VOD_RETRY_MS[3]]);
  });

  it('la primera no se aplaza con alguien viendo; las siguientes, una vez', () => {
    expect(vodDueAction({ first: true, busy: true, delayedOnce: false })).toBe('run');
    expect(vodDueAction({ first: false, busy: true, delayedOnce: false })).toBe('delay');
    expect(vodDueAction({ first: false, busy: true, delayedOnce: true })).toBe('run');
    expect(vodDueAction({ first: false, busy: false, delayedOnce: false })).toBe('run');
  });

  it('cada 24 h; al arrancar sin catálogo o con uno viejo', () => {
    expect(vodPeriodicDelay(1_000, 1_000)).toBe(VOD_REFRESH_MS);
    expect(vodPeriodicDelay(0, VOD_REFRESH_MS + 5)).toBe(0);
    expect(vodDueAtStart(null, 0)).toBe(true);
    expect(vodDueAtStart(0, VOD_REFRESH_MS)).toBe(true);
    expect(vodDueAtStart(0, VOD_REFRESH_MS - 1)).toBe(false);
  });
});
