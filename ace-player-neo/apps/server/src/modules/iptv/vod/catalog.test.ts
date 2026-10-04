/* Sincronización del catálogo VOD (docs/vod.md §4.2, §4.7 y §15.1) con un
   transporte falso: pasos, tope que recorta, `skipped`, «sin VOD», modo por
   categorías y cadencia. Lo que depende del servicio (aplicar solo con el
   mismo proveedor, abortar al guardar o eliminar, `IptvStatus.vod`) está en
   vod-service.test.ts. */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { VOD_LIMITS, VOD_REFRESH_MS } from '@ace/shared';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver, type FakeReply } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import {
  syncVodCatalog,
  vodCategoriesGiveUp,
  vodDueAction,
  vodDueAtStart,
  vodPeriodicDelay,
  vodRetryDelay,
  VOD_RETRY_MS,
  type VodCatalog,
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
  const run = (
    mode: 'completo' | 'por_categorias' = 'completo',
    signal = new AbortController().signal,
    extra: Partial<Parameters<typeof syncVodCatalog>[1]> = {},
  ) =>
    syncVodCatalog(
      {
        net,
        clock: core.clock,
        logger: core.logger,
        credentials: CREDS,
        policy: { lan: false },
        signal,
      },
      { providerId: 'p_prueba01', providerFp: '0123456789abcdef', revision: 2, mode, ...extra },
    );
  return { core, transport, net, run };
}

/** Mueve el reloj falso (esperas entre categorías y plazos) hasta que la promesa acabe. */
async function drive(
  core: ReturnType<typeof createTestCore>,
  promise: Promise<unknown>,
  stepMs: number = VOD_LIMITS.byCategory.spacingMs,
): Promise<void> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let round = 0; round < 400 && !done; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await core.clock.advanceAsync(stepMs);
  }
}

const cats = (list: Array<[string, string]>) =>
  JSON.stringify(list.map(([id, name]) => ({ category_id: id, category_name: name })));

describe('syncVodCatalog', () => {
  it('categorías → películas → series, con sus filas, categorías y meta', async () => {
    const { run, transport } = rig((action) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'ES | PELIS'],
            ['2', 'XXX'],
          ]),
        };
      if (action === 'get_series_categories') return { body: cats([['5', 'Series']]) };
      if (action === 'get_vod_streams') return { body: JSON.stringify(movies(4)) };
      if (action === 'get_series') {
        return {
          body: JSON.stringify([
            { series_id: 9, name: 'Serie', category_id: '5', last_modified: '1700000000' },
          ]),
        };
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
    expect(catalog.meta).toMatchObject({
      revision: 2,
      truncated: false,
      skipped: 0,
      mode: 'completo',
    });
    expect(catalog.stamp).toMatch(/^[a-z0-9]{1,16}$/);
    expect(transport.requests.map((request) => request.url.searchParams.get('action'))).toEqual([
      'get_vod_categories',
      'get_vod_streams',
      'get_series_categories',
      'get_series',
    ]);
    /* Ninguna llamada lleva parámetros fuera de la lista cerrada. */
    for (const request of transport.requests) {
      expect([...request.url.searchParams.keys()].sort()).toEqual([
        'action',
        'password',
        'username',
      ]);
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
    expect(result.state === 'ready' && result.held).toEqual([]);
  });

  it('«sin VOD» en UNA lista con títulos guardados de ese tipo (`holdIfNone`): sigue la tabla de antes', async () => {
    const seriesList = JSON.stringify([
      { series_id: 9, name: 'Serie', category_id: '5', last_modified: '1700000000' },
    ]);
    const answer =
      (seriesBody: string) =>
      (action: string): FakeReply | undefined => {
        if (action === 'get_series_categories') return { body: cats([['5', 'Series']]) };
        if (action === 'get_vod_streams') return { body: JSON.stringify(movies(2)) };
        if (action === 'get_series') return { body: seriesBody };
        return undefined;
      };
    const first = await rig(answer(seriesList)).run();
    if (first.state !== 'ready') throw new Error('debería estar listo');
    const previous = first.catalog;
    for (const body of ['[]', '{}', 'null']) {
      const result = await rig(answer(body)).run('completo', undefined, {
        previous: () => Promise.resolve(previous),
        holdIfNone: { movie: true, series: true },
      });
      expect(result.state, body).toBe('ready');
      if (result.state !== 'ready') return;
      expect(result.held).toEqual(['series']);
      expect(result.catalog.tables.series.n).toBe(1);
      expect(result.catalog.tables.series.title(0)).toBe('Serie');
      expect(result.catalog.tables.movie.n).toBe(2);
    }
    /* Sin `holdIfNone` (ya confirmado, o no había series): vale el «sin VOD». */
    const confirmed = await rig(answer('[]')).run('completo', undefined, {
      previous: () => Promise.resolve(previous),
      holdIfNone: { movie: true, series: false },
    });
    expect(confirmed.state === 'ready' && confirmed.catalog.tables.series.n).toBe(0);
    expect(confirmed.state === 'ready' && confirmed.held).toEqual([]);
    /* Sin catálogo anterior que leer, tampoco hay nada que guardar. */
    const unreadable = await rig(answer('[]')).run('completo', undefined, {
      previous: () => Promise.resolve(null),
      holdIfNone: { series: true },
    });
    expect(unreadable.state === 'ready' && unreadable.catalog.tables.series.n).toBe(0);
    expect(unreadable.state === 'ready' && unreadable.held).toEqual([]);
    /* Las dos listas «sin VOD» y alguna guardada: `held`, sin tocar nada. */
    const both = rig((action) =>
      action === 'get_vod_streams' || action === 'get_series' ? { body: '[]' } : undefined,
    );
    expect(
      await both.run('completo', undefined, {
        previous: () => Promise.resolve(previous),
        holdIfNone: { movie: true, series: false },
      }),
    ).toEqual({ state: 'held', held: ['movie'], skipped: 0 });
    expect(
      (await both.run('completo', undefined, { holdIfNone: { movie: false, series: false } }))
        .state,
    ).toBe('none');
  });

  it('una lista completa que falla por 5xx pasa al modo por categorías (250 ms entre llamadas)', async () => {
    const { run, transport, core } = rig((action, url) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
          ]),
        };
      if (action === 'get_vod_streams') {
        const category = url.searchParams.get('category_id');
        if (category === null) return { status: 502 };
        return {
          body: JSON.stringify(movies(4).filter((movie) => movie.category_id === category)),
        };
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
      /* Un 5xx puede ser un mal rato: la próxima vez se prueba otra vez la lista entera. */
      expect(result.catalog.meta.mode).toBe('completo');
    }
    const categories = transport.requests
      .filter((request) => request.url.searchParams.get('action') === 'get_vod_streams')
      .map((request) => request.url.searchParams.get('category_id'));
    expect(categories).toEqual([null, '1', '2']);
  });

  it('solo una lista que no cabe (`iptv_too_large`) deja apuntado el modo por categorías', async () => {
    const { run, core } = rig((action, url) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
          ]),
        };
      if (action === 'get_vod_streams') {
        const category = url.searchParams.get('category_id');
        if (category === null) {
          return { headers: { 'content-length': String(500 * 1024 * 1024) }, body: '[]' };
        }
        return {
          body: JSON.stringify(movies(4).filter((movie) => movie.category_id === category)),
        };
      }
      return undefined;
    });
    const promise = run();
    await drive(core, promise);
    const result = await promise;
    expect(result.state === 'ready' && result.catalog.meta.mode).toBe('por_categorias');
    expect(result.state === 'ready' && result.catalog.tables.movie.n).toBe(4);
  });

  it('la lista entera muere A MITAD por inactividad: el modo por categorías empieza de cero y `skipped` sale bien (fallo 2)', async () => {
    const all = movies(1_000);
    const { run, core } = rig((action, url) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
          ]),
        };
      if (action !== 'get_vod_streams') return undefined;
      const category = url.searchParams.get('category_id');
      if (category === null) {
        /* 1 000 películas y después nada: el plazo de inactividad (30 s) la corta. */
        const body = new Readable({ read() {} });
        body.push(`[${all.map((movie) => JSON.stringify(movie)).join(',')},`);
        return { body };
      }
      return { body: JSON.stringify(all.filter((movie) => movie.category_id === category)) };
    });
    const promise = run();
    await drive(core, promise, 2_000);
    const result = await promise;
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      expect(result.catalog.tables.movie.n).toBe(1_000);
      expect(result.catalog.meta).toMatchObject({
        /* Un plazo no se recuerda: la próxima vez, otra vez la lista entera. */
        mode: 'completo',
        skipped: 0,
        truncated: false,
      });
    }
  });

  it('una categoría mala se salta y se cuenta; las demás llegan (fallo 3)', async () => {
    const { run, core, transport } = rig((action, url) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
            ['3', 'C'],
          ]),
        };
      if (action !== 'get_vod_streams') return undefined;
      const category = url.searchParams.get('category_id');
      if (category === null || category === '2') return { status: 500 };
      return { body: JSON.stringify(movies(6).filter((movie) => movie.category_id === category)) };
    });
    const promise = run();
    await drive(core, promise);
    const result = await promise;
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      /* Las de la categoría 1 (las impares); la 2 falló y la 3 está vacía. */
      expect(result.catalog.tables.movie.n).toBe(3);
      expect(result.catalog.meta.truncated).toBe(false);
    }
    const asked = transport.requests
      .filter((request) => request.url.searchParams.get('action') === 'get_vod_streams')
      .map((request) => request.url.searchParams.get('category_id'));
    expect(asked).toEqual([null, '1', '2', '3']);
  });

  it('si fallan TODAS las categorías de un tipo (4 o menos), es un fallo y no «sin VOD»: no vacía nada', async () => {
    /* Las películas van bien; las series, con 2 categorías, dan 500 en la
       lista entera y en cada categoría. Antes salía `ready` con 0 series y
       se guardaba así 24 h. */
    const series = rig((action) => {
      if (action === 'get_vod_categories') return { body: cats([['1', 'A']]) };
      if (action === 'get_vod_streams') return { body: JSON.stringify(movies(1)) };
      if (action === 'get_series_categories')
        return {
          body: cats([
            ['5', 'S'],
            ['6', 'T'],
          ]),
        };
      if (action === 'get_series') return { status: 500 };
      return undefined;
    });
    const onlySeries = series.run();
    void drive(series.core, onlySeries);
    await expect(onlySeries).rejects.toMatchObject({ code: 'iptv_unreachable' });

    /* Las dos listas y sus 3 + 1 categorías dan 500: antes salía `none` y,
       confirmado a los 15 min, borraba el catálogo y `vod.enc`. */
    const both = rig((action) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
            ['3', 'C'],
          ]),
        };
      if (action === 'get_series_categories') return { body: cats([['5', 'S']]) };
      if (action === 'get_vod_streams' || action === 'get_series') return { status: 500 };
      return undefined;
    });
    const all = both.run();
    void drive(both.core, all);
    await expect(all).rejects.toMatchObject({ code: 'iptv_unreachable' });

    /* Una que falla y las demás vacías (`[]`): tampoco es «sin VOD». */
    const mixed = rig((action, url) => {
      if (action === 'get_vod_categories')
        return {
          body: cats([
            ['1', 'A'],
            ['2', 'B'],
          ]),
        };
      if (action !== 'get_vod_streams') return undefined;
      const category = url.searchParams.get('category_id');
      return category === null || category === '2' ? { status: 503 } : { body: '[]' };
    });
    const half = mixed.run();
    void drive(mixed.core, half);
    await expect(half).rejects.toMatchObject({ code: 'iptv_unreachable' });
  });

  it('5 categorías malas seguidas: se rinde con el código IPTV; un 401 en una categoría, al momento', async () => {
    const ids = Array.from(
      { length: 10 },
      (_, i) => [String(i + 1), `C${i + 1}`] as [string, string],
    );
    const failing = rig((action) => {
      if (action === 'get_vod_categories') return { body: cats(ids) };
      if (action === 'get_vod_streams') return { status: 502 };
      return undefined;
    });
    const promise = failing.run();
    void drive(failing.core, promise);
    await expect(promise).rejects.toMatchObject({ code: 'iptv_unreachable' });
    const calls = failing.transport.requests.filter(
      (request) => request.url.searchParams.get('action') === 'get_vod_streams',
    );
    /* La lista entera y 5 categorías: ni una más. */
    expect(calls).toHaveLength(6);

    const auth = rig((action, url) => {
      if (action === 'get_vod_categories') return { body: cats(ids) };
      if (action !== 'get_vod_streams') return undefined;
      return url.searchParams.get('category_id') === '2' ? { status: 401 } : { status: 502 };
    });
    const denied = auth.run();
    void drive(auth.core, denied);
    await expect(denied).rejects.toMatchObject({ code: 'iptv_auth_failed' });
  });

  it('el modo por categorías tiene tope de tiempo: se queda lo leído con `truncated` (fallo 8)', async () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => [String(i + 1), `C${i + 1}`] as [string, string],
    );
    const { core, transport, net } = rig((action, url) => {
      if (action === 'get_vod_categories') return { body: cats(ids) };
      if (action !== 'get_vod_streams') return undefined;
      const category = Number(url.searchParams.get('category_id'));
      return {
        body: JSON.stringify([
          { stream_id: category, name: `Película ${category}`, category_id: String(category) },
        ]),
      };
    });
    const promise = syncVodCatalog(
      {
        net,
        clock: core.clock,
        logger: core.logger,
        credentials: CREDS,
        policy: { lan: false },
        signal: new AbortController().signal,
      },
      {
        providerId: 'p_prueba01',
        providerFp: '0123456789abcdef',
        revision: 2,
        mode: 'por_categorias',
        byCategoryTotalMs: 1_000,
      },
    );
    await drive(core, promise);
    const result = await promise;
    expect(result.state).toBe('ready');
    if (result.state === 'ready') {
      /* Sin catálogo anterior (la primera vez), faltan categorías de verdad. */
      expect(result.catalog.meta.truncated).toBe(true);
      expect(result.catalog.tables.movie.n).toBeGreaterThan(0);
      expect(result.catalog.tables.movie.n).toBeLessThan(20);
      /* La próxima vez se empieza por la primera que no cupo. */
      expect(result.resumeFrom.movie).toBe(String(result.catalog.tables.movie.n + 1));
    }
    expect(transport.requests.length).toBeLessThan(25);
  });

  describe('modo por categorías con catálogo anterior (rotación)', () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => [String(i + 1), `C${i + 1}`] as [string, string],
    );
    /* Cada categoría N tiene una película N; la 7 falla si `broken`. */
    function categoriesRig(broken = { on: false }) {
      return rig((action, url) => {
        if (action === 'get_vod_categories') return { body: cats(ids) };
        if (action !== 'get_vod_streams') return undefined;
        const raw = url.searchParams.get('category_id');
        if (raw === null) return { status: 503 };
        if (broken.on && raw === '7') return { status: 500 };
        const category = Number(raw);
        return {
          body: JSON.stringify([
            { stream_id: category, name: `Película ${category}`, category_id: raw },
          ]),
        };
      });
    }
    function syncWith(
      setup: ReturnType<typeof categoriesRig>,
      extra: Partial<Parameters<typeof syncVodCatalog>[1]>,
    ) {
      const { core, net } = setup;
      const promise = syncVodCatalog(
        {
          net,
          clock: core.clock,
          logger: core.logger,
          credentials: CREDS,
          policy: { lan: false },
          signal: new AbortController().signal,
        },
        {
          providerId: 'p_prueba01',
          providerFp: '0123456789abcdef',
          revision: 2,
          mode: 'por_categorias',
          ...extra,
        },
      );
      void drive(core, promise);
      return promise;
    }
    const sources = (catalog: VodCatalog): number[] =>
      Array.from(catalog.tables.movie.source).sort((a, b) => a - b);
    const asked = (setup: ReturnType<typeof categoriesRig>): Array<string | null> =>
      setup.transport.requests
        .filter((request) => request.url.searchParams.get('action') === 'get_vod_streams')
        .map((request) => request.url.searchParams.get('category_id'));

    it('lo que no cabe en el tope se queda como estaba y la siguiente empieza por ahí: en unas vueltas están todas', async () => {
      let catalog: VodCatalog | null = null;
      let resumeFrom: Partial<Record<'movie' | 'series', string>> = {};
      for (let round = 0; round < 20 && (catalog?.tables.movie.n ?? 0) < 20; round += 1) {
        const setup = categoriesRig();
        const previous: VodCatalog | null = catalog;
        const result = await syncWith(setup, {
          byCategoryTotalMs: 1_000,
          resumeFrom,
          previous: () => Promise.resolve(previous),
        });
        expect(result.state).toBe('ready');
        if (result.state !== 'ready') return;
        /* Empieza por la primera que no cupo la vez anterior. */
        expect(asked(setup)[0]).toBe(resumeFrom.movie ?? '1');
        if (previous) {
          /* Nada de lo que había se pierde, y ya no es «faltan títulos». */
          expect(sources(result.catalog)).toEqual(expect.arrayContaining(sources(previous)));
          expect(result.catalog.meta.truncated).toBe(false);
        }
        catalog = result.catalog;
        resumeFrom = result.resumeFrom;
      }
      expect(catalog && sources(catalog)).toEqual(ids.map(([id]) => Number(id)));
    });

    it('una categoría que falla se queda como estaba en el catálogo anterior (no desaparece 24 h)', async () => {
      const first = await syncWith(categoriesRig(), {});
      expect(first.state).toBe('ready');
      if (first.state !== 'ready') return;
      expect(first.catalog.tables.movie.n).toBe(20);
      const previous = first.catalog;
      const second = await syncWith(categoriesRig({ on: true }), {
        previous: () => Promise.resolve(previous),
      });
      expect(second.state === 'ready' && sources(second.catalog)).toEqual(sources(previous));
      expect(second.state === 'ready' && second.catalog.meta.truncated).toBe(false);
      /* Sin catálogo anterior, la 7 falta (y no es `truncated`: es una categoría mala). */
      const alone = await syncWith(categoriesRig({ on: true }), {});
      expect(alone.state === 'ready' && alone.catalog.tables.movie.n).toBe(19);
    });

    it('el catálogo anterior de OTRO proveedor no se usa', async () => {
      const first = await syncWith(categoriesRig(), {});
      if (first.state !== 'ready') throw new Error('debería estar listo');
      const other = { ...first.catalog, providerId: 'p_otro0001' };
      const second = await syncWith(categoriesRig({ on: true }), {
        previous: () => Promise.resolve(other),
      });
      expect(second.state === 'ready' && second.catalog.tables.movie.n).toBe(19);
    });
  });

  it('las reglas de rendirse: 5 seguidas, o más de max(5, 20 %)', () => {
    expect(vodCategoriesGiveUp(4, 4, 10)).toBe(false);
    expect(vodCategoriesGiveUp(5, 5, 10)).toBe(true);
    expect(vodCategoriesGiveUp(5, 1, 10)).toBe(false);
    expect(vodCategoriesGiveUp(6, 1, 10)).toBe(true);
    expect(vodCategoriesGiveUp(20, 1, 100)).toBe(false);
    expect(vodCategoriesGiveUp(21, 1, 100)).toBe(true);
  });

  it('`skipped` del troceador también cuando se corta por el tope de títulos (fallo 10)', async () => {
    const big = [7, 'x', ...movies(VOD_LIMITS.maxMovies + 10)];
    const { run } = rig((action) =>
      action === 'get_vod_streams' ? { body: JSON.stringify(big) } : undefined,
    );
    const result = await run();
    expect(result.state === 'ready' && result.catalog.meta).toMatchObject({
      truncated: true,
      skipped: 2,
    });
  }, 60_000);

  it('un 401 o sin categorías no pasa al modo por categorías: falla con el código IPTV', async () => {
    const { run } = rig((action) => (action === 'get_vod_streams' ? { status: 401 } : undefined));
    await expect(run()).rejects.toMatchObject({ code: 'iptv_auth_failed' });
    const { run: run2 } = rig((action) =>
      action === 'get_vod_streams' ? { status: 503 } : undefined,
    );
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
