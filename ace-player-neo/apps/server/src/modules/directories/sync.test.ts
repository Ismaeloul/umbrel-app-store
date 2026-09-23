/* Sincronización de directorios (server.js:4143-4157, 4960-5027, 5082-5126):
   T-116 (parte del directorio), T-119, T-036 (parte de la sincronización) y
   lo nuevo de arquitectura §5.11: cerrojo único, aplicar solo si la URL y el
   tipo no cambiaron, espera exponencial y motivo del último fallo. */

import { motivoDeFallo, type WebSource } from '@ace/shared';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../core/errors.js';
import type { FakeReply } from '../net/testing.js';
import { DIRECTORY_RETRY_BASE_MS, WEB_SYNC_INTERVAL_MS, WEB_SYNC_ON_RESOLVE_MS } from './index.js';
import {
  ID_A,
  ID_B,
  ID_C,
  createHarness,
  deferred,
  seedPrincipal,
  settle,
} from './test-support.js';

function m3u(entries: readonly (readonly [string, string])[]): string {
  return [
    '#EXTM3U',
    ...entries.flatMap(([id, title]) => [`#EXTINF:-1,${title}`, `acestream://${id}`]),
  ].join('\n');
}

const LIST: FakeReply = {
  body: m3u([
    [ID_A, 'Nombre remoto'],
    [ID_B, 'Nuevo'],
    [ID_C, 'Otro canal'],
  ]),
};

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

function source(id: string, url: string, extra: Partial<WebSource> = {}): WebSource {
  return {
    id,
    name: id,
    url,
    type: 'm3u',
    streams: [],
    renames: {},
    hidden: [],
    syncedAt: null,
    lastErrorAt: null,
    lastError: null,
    ...extra,
  };
}

describe('T-116 · el directorio guarda por que fallo la ultima actualizacion (B-195)', () => {
  it('T-116 · el directorio guarda por que fallo la ultima actualizacion', async () => {
    expect(motivoDeFallo(new Error('http_429'))).toBe('http_429');
    expect(motivoDeFallo(new Error('getaddrinfo ENOTFOUND x'))).toBe('fetch_failed');
    // la actualización manual de un directorio guardado también lo anota y conserva la caché
    const { service, state, core } = createHarness();
    seedPrincipal(state);
    const error = await service
      .sync({ sourceId: 'principal', url: 'https://no-existe.invalid/list.m3u', type: 'm3u' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('dns_failed');
    const fuente = state.get().webSources[0]!;
    expect(fuente.lastError).toBe('dns_failed');
    expect(fuente.lastErrorAt).toBe(core.clock.date().toISOString());
    expect(fuente.streams).toHaveLength(2);
    expect(fuente.url).toBe('https://example.com/list.m3u');
    // y la tarjeta lo enseña
    expect(service.view().webSources[0]).toMatchObject({ lastError: 'dns_failed', count: 2 });
  });

  it('un 429 en la sincronización automática queda como http_429 en la tarjeta y en el diagnóstico', async () => {
    const { service, state, core } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': { status: 429 } },
    });
    const reports: unknown[] = [];
    core.bus.on('diagnostics.report', (report) => reports.push(report));
    seedPrincipal(state);
    await service.autoSync('periodic');
    expect(state.get().webSources[0]).toMatchObject({ lastError: 'http_429', syncedAt: null });
    expect(state.get().webSources[0]?.streams).toHaveLength(2);
    expect(reports).toEqual([
      {
        cause: 'network',
        code: 'http_429',
        message: expect.stringContaining('Principal') as unknown,
      },
    ]);
  });
});

describe('T-119 · con AUTO_SYNC=false la sincronizacion periodica no sale a internet (B-194)', () => {
  it('T-119 · con AUTO_SYNC=false la sincronizacion periodica no sale a internet', async () => {
    const { service, state, requested } = createHarness({
      routes: { 'https://example.com/list.m3u': LIST },
    });
    seedPrincipal(state);
    await service.autoSync('periodic');
    const fuente = state.get().webSources[0]!;
    expect(fuente.lastErrorAt).toBeNull();
    expect(fuente.syncedAt).toBeNull();
    expect(requested()).toEqual([]);
  });

  it('tampoco al arrancar, ni la de la resolución, ni programa el temporizador de 3 h', async () => {
    const { service, state, core, requested } = createHarness({
      routes: { 'https://example.com/list.m3u': LIST },
    });
    seedPrincipal(state);
    await service.start();
    expect(core.clock.pendingTimers()).toBe(0);
    await service.autoSync('startup');
    service.refreshStaleInBackground();
    await core.clock.advanceAsync(WEB_SYNC_INTERVAL_MS);
    expect(requested()).toEqual([]);
    expect(state.writes()).toBe(0);
    await service.stop();
  });

  it('`manual` sí sale aunque AUTO_SYNC=false', async () => {
    const { service, state, requested } = createHarness({
      routes: { 'https://example.com/list.m3u': LIST },
    });
    seedPrincipal(state);
    await service.autoSync('manual');
    expect(requested()).toEqual(['https://example.com/list.m3u']);
    expect(state.get().webSources[0]?.streams).toHaveLength(3);
  });
});

describe('T-036 · renombres y borrados web sobreviven a una sincronizacion posterior (B-185)', () => {
  it('T-036 · renombres y borrados web sobreviven a una sincronizacion posterior', async () => {
    const { service, state } = createHarness({ routes: { 'https://example.com/list.m3u': LIST } });
    // el renombre lo hace state.mutateLibrary; aquí se siembra ya hecho
    seedPrincipal(state, { renames: { [ID_A]: 'Mi nombre' } });
    let result = await service.sync({ sourceId: 'principal', url: 'https://example.com/list.m3u' });
    expect(result.web.find((item) => item.id === ID_A)?.title).toBe('Mi nombre');
    expect(result.web.find((item) => item.id === ID_B)?.title).toBe('Nuevo');
    // borrar en el directorio es ocultar: tras otra sincronización no vuelve
    await state.enqueue(
      (draft) => {
        draft.webSources[0]!.hidden = [ID_A];
      },
      { scopes: ['directories'] },
    );
    result = await service.sync({ sourceId: 'principal', url: 'https://example.com/list.m3u' });
    expect(result.web.some((item) => item.id === ID_A)).toBe(false);
    expect(result.web.some((item) => item.id === ID_C)).toBe(true);
    expect(state.get().webSources[0]?.renames).toEqual({ [ID_A]: 'Mi nombre' });
  });
});

describe('POST /api/streams/sync (server.js:4960-5008, B-191, B-192)', () => {
  it('una URL nueva crea un directorio `directorio-<base36>-<5>` que pasa a ser el activo', async () => {
    const { service, state, core } = createHarness({
      routes: { 'https://lista.example/nueva.m3u': LIST },
    });
    seedPrincipal(state);
    const result = await service.sync({ url: ' https://lista.example/nueva.m3u ' });
    const id = `directorio-${core.clock.now().toString(36)}-${(0.123456789).toString(36).slice(2, 7)}`;
    expect(result.activeWebSourceId).toBe(id);
    expect(result.success).toBe(true);
    expect(result.streams).toBe(result.web);
    expect(result.web.map((item) => item.id)).toEqual([ID_A, ID_B, ID_C]);
    expect(result.webSyncedAt).toBe(core.clock.date().toISOString());
    expect(result.webSources.map((item) => [item.id, item.name, item.type, item.count])).toEqual([
      ['principal', 'Principal', 'm3u', 2],
      [id, 'lista.example', 'm3u', 3],
    ]);
  });

  it('la misma URL y tipo sin sourceId refresca el que ya hay (y `name` lo renombra)', async () => {
    const { service, state } = createHarness({ routes: { 'https://example.com/list.m3u': LIST } });
    seedPrincipal(state);
    const result = await service.sync({
      url: 'https://example.com/list.m3u',
      type: 'm3u',
      name: '  Mi   lista  ',
    });
    expect(result.webSources).toHaveLength(1);
    expect(result.webSources[0]).toMatchObject({ id: 'principal', name: 'Mi lista', count: 3 });
  });

  it('con sourceId se le puede cambiar la URL y el tipo (HTML)', async () => {
    const { service, state } = createHarness({
      routes: {
        'https://otra.example/pagina': {
          body: `<a href="acestream://${ID_B}">Canal B</a> acestream://${ID_C}`,
        },
      },
    });
    seedPrincipal(state);
    const result = await service.sync({
      sourceId: 'principal',
      url: 'https://otra.example/pagina',
      type: 'html',
    });
    expect(result.webSources[0]).toMatchObject({
      id: 'principal',
      url: 'https://otra.example/pagina',
      type: 'html',
      lastError: null,
    });
    expect(result.web.map((item) => item.title)).toEqual(['Canal B', `Stream ${ID_C.slice(0, 8)}`]);
  });

  it('bad_url, source_not_found y source_limit sin salir a la red', async () => {
    const { service, state, requested } = createHarness();
    state.seed({
      webSources: Array.from({ length: 8 }, (_, index) =>
        source(`d${index}`, `https://example.com/${index}.m3u`),
      ),
    });
    for (const body of [{}, { url: 'ftp://example.com/x' }, { url: 'no es url' }, null, 'texto']) {
      expect(await codeOf(service.sync(body as never)), JSON.stringify(body)).toBe('bad_url');
    }
    expect(
      await codeOf(service.sync({ url: 'https://example.com/x', sourceId: 'no-existe' })),
    ).toBe('source_not_found');
    expect(await codeOf(service.sync({ url: 'https://example.com/nueva.m3u' }))).toBe(
      'source_limit',
    );
    expect(requested()).toEqual([]);
    expect(state.writes()).toBe(0);
  });

  it('con 8 directorios se puede refrescar uno de ellos', async () => {
    const { service, state } = createHarness({ routes: { 'https://example.com/3.m3u': LIST } });
    state.seed({
      webSources: Array.from({ length: 8 }, (_, index) =>
        source(`d${index}`, `https://example.com/${index}.m3u`),
      ),
    });
    const result = await service.sync({ url: 'https://example.com/3.m3u' });
    expect(result.activeWebSourceId).toBe('d3');
    expect(result.webSources).toHaveLength(8);
  });

  it('una lista sin enlaces es empty_directory y se anota en el guardado', async () => {
    const { service, state } = createHarness({
      routes: { 'https://example.com/list.m3u': { body: '#EXTM3U\n#EXTINF:-1,Nada\n' } },
    });
    seedPrincipal(state);
    expect(
      await codeOf(service.sync({ sourceId: 'principal', url: 'https://example.com/list.m3u' })),
    ).toBe('empty_directory');
    expect(state.get().webSources[0]).toMatchObject({ lastError: 'empty_directory' });
    expect(state.get().webSources[0]?.streams).toHaveLength(2);
  });

  it('si falla una URL nueva (sin directorio guardado) no se escribe nada', async () => {
    const { service, state } = createHarness({
      routes: { 'https://lista.example/x.m3u': { status: 500 } },
    });
    seedPrincipal(state);
    expect(await codeOf(service.sync({ url: 'https://lista.example/x.m3u' }))).toBe('http_500');
    expect(state.writes()).toBe(0);
  });

  it('como mucho 500 canales por lista', async () => {
    const entries = Array.from(
      { length: 520 },
      (_, index) => [index.toString(16).padStart(40, '0'), `Canal ${index}`] as const,
    );
    const { service, state } = createHarness({
      routes: { 'https://example.com/list.m3u': { body: m3u(entries) } },
    });
    seedPrincipal(state);
    const result = await service.sync({ url: 'https://example.com/list.m3u' });
    expect(result.web).toHaveLength(500);
  });

  it('se relee el estado al aplicar: lo que cambió durante la descarga no se pisa', async () => {
    const gate = deferred<FakeReply>();
    const { service, state, core } = createHarness({
      routes: { 'https://example.com/list.m3u': () => gate.promise },
    });
    seedPrincipal(state);
    const pending = service.sync({ url: 'https://example.com/list.m3u' });
    await core.clock.advanceAsync(0);
    await state.enqueue(
      (draft) => {
        draft.favorites = [
          {
            id: ID_B,
            title: 'Favorito de otro dispositivo',
            type: 'fav',
            category: 'General',
            date: core.clock.date().toISOString(),
            fromWebSync: false,
            ih: false,
          },
        ];
      },
      { scopes: ['library'] },
    );
    gate.resolve(LIST);
    await pending;
    expect(state.get().favorites.map((item) => item.title)).toEqual([
      'Favorito de otro dispositivo',
    ]);
    expect(state.get().webSources[0]?.streams).toHaveLength(3);
  });
});

describe('POST /api/streams/activate y /api/streams/delete (server.js:5010-5027, B-192)', () => {
  function threeSources() {
    const harness = createHarness();
    harness.state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u', { streams: [] }),
        source('dos', 'https://example.com/2.m3u'),
        source('tres', 'https://example.com/3.m3u'),
      ],
      activeWebSourceId: 'dos',
    });
    return harness;
  }

  it('activate elige el activo; uno que no existe es source_not_found', async () => {
    const { service } = threeSources();
    expect((await service.activate('tres')).activeWebSourceId).toBe('tres');
    expect(await codeOf(service.activate('cuatro'))).toBe('source_not_found');
    expect(await codeOf(service.activate(''))).toBe('source_not_found');
  });

  it('delete del activo pasa a activo el primero que quede; de otro, lo deja', async () => {
    const { service } = threeSources();
    let result = await service.remove('dos');
    expect(result.webSources.map((item) => item.id)).toEqual(['uno', 'tres']);
    expect(result.activeWebSourceId).toBe('uno');
    result = await service.remove('tres');
    expect(result.activeWebSourceId).toBe('uno');
    expect(await codeOf(service.remove('uno'))).toBe('last_source');
    expect(await codeOf(service.remove('nada'))).toBe('source_not_found');
  });

  it('view() es la forma v1: sin success ni streams', async () => {
    const { service } = threeSources();
    const view = service.view();
    expect(Object.keys(view).sort()).toEqual([
      'activeWebSourceId',
      'web',
      'webSources',
      'webSyncedAt',
    ]);
    expect(view.activeWebSourceId).toBe('dos');
  });
});

describe('sincronización automática (server.js:5091-5126, B-194)', () => {
  it('en serie, uno detrás de otro; cada uno anota su resultado', async () => {
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: {
        'https://example.com/1.m3u': LIST,
        'https://example.com/2.m3u': { status: 503 },
      },
    });
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u'),
        source('dos', 'https://example.com/2.m3u'),
      ],
    });
    await service.autoSync('periodic');
    expect(requested()).toEqual(['https://example.com/1.m3u', 'https://example.com/2.m3u']);
    const [uno, dos] = state.get().webSources;
    expect(uno).toMatchObject({ syncedAt: core.clock.date().toISOString(), lastError: null });
    expect(uno?.streams).toHaveLength(3);
    expect(dos).toMatchObject({ syncedAt: null, lastError: 'http_503' });
  });

  it('solo aplica si la URL y el tipo no cambiaron durante la descarga', async () => {
    const gate = deferred<FakeReply>();
    const { service, state, core } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': () => gate.promise },
    });
    seedPrincipal(state);
    const run = service.autoSync('periodic');
    await core.clock.advanceAsync(0);
    await state.enqueue(
      (draft) => {
        draft.webSources[0]!.url = 'https://otra.example/lista.m3u';
      },
      { scopes: ['directories'] },
    );
    gate.resolve(LIST);
    await run;
    const fuente = state.get().webSources[0]!;
    expect(fuente.url).toBe('https://otra.example/lista.m3u');
    expect(fuente.streams).toHaveLength(2);
    expect(fuente.syncedAt).toBeNull();
  });

  it('un directorio borrado durante la descarga no vuelve', async () => {
    const gate = deferred<FakeReply>();
    const { service, state, core } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/1.m3u': () => gate.promise },
    });
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u'),
        source('dos', 'https://example.com/2.m3u'),
      ],
    });
    const run = service.autoSync('startup');
    await core.clock.advanceAsync(0);
    await service.remove('uno');
    gate.resolve(LIST);
    await run;
    expect(state.get().webSources.map((item) => item.id)).toEqual(['dos']);
  });

  it('dos llamadas a la vez comparten la misma ejecución', async () => {
    const { service, state, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': LIST },
    });
    seedPrincipal(state);
    const first = service.autoSync('periodic');
    const second = service.autoSync('resolution');
    expect(second).toBe(first);
    await first;
    expect(requested()).toEqual(['https://example.com/list.m3u']);
  });
});

describe('un solo cerrojo para todas las sincronizaciones (backend-modulos §8.2.6)', () => {
  it('una manual espera al directorio en curso y va antes que el siguiente de la automática', async () => {
    const gate = deferred<FakeReply>();
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: {
        'https://example.com/1.m3u': () => gate.promise,
        'https://example.com/2.m3u': LIST,
        'https://lista.example/manual.m3u': LIST,
      },
    });
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u'),
        source('dos', 'https://example.com/2.m3u'),
      ],
    });
    const auto = service.autoSync('periodic');
    await core.clock.advanceAsync(0);
    const manual = service.sync({ url: 'https://lista.example/manual.m3u' });
    await core.clock.advanceAsync(0);
    expect(requested()).toEqual(['https://example.com/1.m3u']);
    gate.resolve(LIST);
    await Promise.all([auto, manual]);
    expect(requested()).toEqual([
      'https://example.com/1.m3u',
      'https://lista.example/manual.m3u',
      'https://example.com/2.m3u',
    ]);
    expect(state.get().webSources).toHaveLength(3);
  });

  it('dos manuales a la vez van una detrás de otra', async () => {
    const gate = deferred<FakeReply>();
    const { service, state, core, requested } = createHarness({
      routes: {
        'https://example.com/list.m3u': () => gate.promise,
        'https://lista.example/b.m3u': LIST,
      },
    });
    seedPrincipal(state);
    const first = service.sync({ url: 'https://example.com/list.m3u' });
    const second = service.sync({ url: 'https://lista.example/b.m3u' });
    await core.clock.advanceAsync(0);
    expect(requested()).toEqual(['https://example.com/list.m3u']);
    gate.resolve(LIST);
    await Promise.all([first, second]);
    expect(requested()).toEqual(['https://example.com/list.m3u', 'https://lista.example/b.m3u']);
  });
});

describe('refresco al resolver y espera exponencial (server.js:4143-4157, B-193, §8.2.7)', () => {
  it('solo refresca lo que lleva más de 30 min sin sincronizar, sin esperar', async () => {
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/1.m3u': LIST, 'https://example.com/2.m3u': LIST },
    });
    state.seed({
      webSources: [
        source('uno', 'https://example.com/1.m3u', { syncedAt: core.clock.date().toISOString() }),
        source('dos', 'https://example.com/2.m3u', { syncedAt: 'no es una fecha' }),
      ],
    });
    const refresh = async (): Promise<void> => {
      service.refreshStaleInBackground();
      // si arrancó una, autoSync devuelve esa misma: así se espera a que acabe
      await service.autoSync('resolution');
    };
    await refresh();
    expect(requested()).toEqual(['https://example.com/2.m3u']);
    await refresh();
    await core.clock.advanceAsync(WEB_SYNC_ON_RESOLVE_MS);
    await refresh();
    expect(requested()).toEqual(['https://example.com/2.m3u']);
    // pasados 30 min los dos son viejos (el segundo se sincronizó en el minuto 0)
    await core.clock.advanceAsync(1);
    await refresh();
    expect(requested()).toEqual([
      'https://example.com/2.m3u',
      'https://example.com/1.m3u',
      'https://example.com/2.m3u',
    ]);
  });

  it('un directorio que falla siempre espera 5 min, 10, 20… antes de volver a probarse', async () => {
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': { status: 429 } },
    });
    seedPrincipal(state);
    const attempt = async (): Promise<void> => {
      service.refreshStaleInBackground();
      await service.autoSync('resolution');
    };
    await attempt();
    expect(requested()).toHaveLength(1);
    for (const wait of [
      DIRECTORY_RETRY_BASE_MS,
      2 * DIRECTORY_RETRY_BASE_MS,
      4 * DIRECTORY_RETRY_BASE_MS,
    ]) {
      await core.clock.advanceAsync(wait - 1);
      const before = requested().length;
      await attempt();
      expect(requested()).toHaveLength(before);
      await core.clock.advanceAsync(1);
      await attempt();
      expect(requested()).toHaveLength(before + 1);
    }
  });

  it('la espera no frena ni la periódica ni la manual, y un éxito la borra', async () => {
    let fail = true;
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: {
        'https://example.com/list.m3u': () => (fail ? { status: 500 } : LIST),
      },
    });
    seedPrincipal(state);
    service.refreshStaleInBackground();
    await service.autoSync('resolution');
    await service.autoSync('periodic');
    expect(requested()).toHaveLength(2);
    fail = false;
    await service.sync({ sourceId: 'principal', url: 'https://example.com/list.m3u' });
    expect(requested()).toHaveLength(3);
    // ya sincronizado: hasta dentro de 30 min no toca
    service.refreshStaleInBackground();
    await service.autoSync('resolution');
    expect(requested()).toHaveLength(3);
    await core.clock.advanceAsync(WEB_SYNC_ON_RESOLVE_MS + 1);
    service.refreshStaleInBackground();
    await service.autoSync('resolution');
    expect(requested()).toHaveLength(4);
  });

  it('cambiar la URL del directorio reinicia la espera', async () => {
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: {
        'https://example.com/list.m3u': { status: 500 },
        'https://lista.example/nueva.m3u': { status: 500 },
      },
    });
    seedPrincipal(state);
    service.refreshStaleInBackground();
    await service.autoSync('resolution');
    await state.enqueue(
      (draft) => {
        draft.webSources[0]!.url = 'https://lista.example/nueva.m3u';
      },
      { scopes: ['directories'] },
    );
    await core.clock.advanceAsync(1);
    service.refreshStaleInBackground();
    await service.autoSync('resolution');
    expect(requested()).toEqual([
      'https://example.com/list.m3u',
      'https://lista.example/nueva.m3u',
    ]);
  });
});

describe('arranque y apagado (server.js:5141, 5159; arquitectura §5.16)', () => {
  it('con AUTO_SYNC arranca una sincronización y programa la de cada 3 h', async () => {
    const { service, state, core, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': LIST },
    });
    seedPrincipal(state);
    await service.start();
    await service.start(); // idempotente
    await settle();
    expect(requested()).toHaveLength(1);
    expect(state.get().webSources[0]?.syncedAt).toBe(core.clock.date().toISOString());
    await core.clock.advanceAsync(WEB_SYNC_INTERVAL_MS - 1);
    expect(requested()).toHaveLength(1);
    await core.clock.advanceAsync(1);
    await settle();
    expect(requested()).toHaveLength(2);
    await service.stop();
    await service.stop(); // idempotente
    expect(core.clock.pendingTimers()).toBe(0);
    await core.clock.advanceAsync(WEB_SYNC_INTERVAL_MS);
    expect(requested()).toHaveLength(2);
  });

  it('el apagado corta la descarga en curso y no la anota como fallo', async () => {
    const { service, state, core, transport } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: { 'https://example.com/list.m3u': () => new Promise<FakeReply>(() => {}) },
    });
    seedPrincipal(state);
    await service.start();
    await settle();
    expect(transport.requests).toHaveLength(1);
    await service.stop();
    expect(transport.requests[0]?.signal.aborted).toBe(true);
    expect(state.get().webSources[0]).toMatchObject({ lastError: null, lastErrorAt: null });
    expect(core.clock.pendingTimers()).toBe(0);
  });

  it('un fallo inesperado de la automática va al log y no rompe nada', async () => {
    const { service, state, core } = createHarness({ env: { AUTO_SYNC: 'true' } });
    const error = vi.spyOn(core.logger, 'error');
    seedPrincipal(state);
    vi.spyOn(state, 'enqueue').mockRejectedValue(new Error('disco lleno'));
    await service.start();
    await settle();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'startup' }),
      expect.any(String),
    );
    await service.stop();
  });
});
