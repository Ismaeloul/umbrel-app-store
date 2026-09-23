import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, routeKey } from '../../api/query.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { dispatchSse } from '../../api/sse.ts';
import { parseRoute } from '../../app/routes.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import {
  announceUpdate,
  RECHECK_AFTER_HIDDEN_MS,
  registerServiceWorker,
  setReloadForTests,
  swAvailable,
  swDecision,
  updateStore,
  watchServerVersion,
  type SwEnvironment,
} from './install.ts';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Un ServiceWorkerContainer de mentira con sus eventos. */
class FakeContainer extends EventTarget {
  controller: object | null = null;
  registration = Object.assign(new EventTarget(), {
    waiting: null as object | null,
    installing: null as (EventTarget & { state: string }) | null,
  });
  register = vi.fn(async () => this.registration as unknown as ServiceWorkerRegistration);
}

function env(over: Partial<SwEnvironment> = {}, container = new FakeContainer()): SwEnvironment {
  return {
    prod: true,
    isSecureContext: true,
    hostname: 'umbrel.tail1234.ts.net',
    serviceWorker: container as unknown as ServiceWorkerContainer,
    fetch: vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'text/javascript' } })),
    ...over,
  };
}

beforeEach(() => {
  updateStore.set({ available: false, version: null });
  resetToasts();
});
afterEach(() => {
  setReloadForTests(null);
  resetToasts();
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
});

describe('registro del service worker', () => {
  it('solo en producción, con serviceWorker y en contexto seguro; en localhost, comprobando antes', () => {
    expect(swDecision(env())).toBe('register');
    expect(swDecision(env({ prod: false }))).toBe('skip');
    // http:// de la LAN: el navegador no lo deja (como en la 0.6.59).
    expect(swDecision(env({ isSecureContext: false, hostname: 'umbrel.local' }))).toBe('skip');
    expect(swDecision(env({ serviceWorker: undefined }))).toBe('skip');
    expect(swDecision(env({ hostname: 'localhost' }))).toBe('probe');
    expect(swDecision(env({ hostname: '127.0.0.1' }))).toBe('probe');
    expect(swDecision(env({ hostname: '[::1]' }))).toBe('probe');
  });

  it('en localhost solo registra si /sw.js es JavaScript de verdad (no el index de vite preview)', async () => {
    const html = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await swAvailable(html)).toBe(false);
    expect(await swAvailable(vi.fn(async () => new Response('', { status: 404 })))).toBe(false);
    expect(await swAvailable(vi.fn(async () => Promise.reject(new TypeError('red'))))).toBe(false);
    const container = new FakeContainer();
    expect(await registerServiceWorker(env({ hostname: 'localhost', fetch: html }, container))).toBeNull();
    expect(container.register).not.toHaveBeenCalled();
    const ok = new FakeContainer();
    await registerServiceWorker(env({ hostname: 'localhost' }, ok));
    expect(ok.register).toHaveBeenCalledWith('/sw.js');
  });

  it('si el registro falla, la app sigue (sin worker)', async () => {
    const container = new FakeContainer();
    container.register.mockRejectedValueOnce(new Error('SecurityError'));
    await expect(registerServiceWorker(env({}, container))).resolves.toBeNull();
  });

  it('versión nueva: avisa al cambiar de worker, pero NO en la primera instalación', async () => {
    const onUpdate = vi.fn();
    const first = new FakeContainer();
    await registerServiceWorker(env({}, first), onUpdate);
    // Primera vez: clients.claim() toma el control → no es «nueva».
    first.dispatchEvent(new Event('controllerchange'));
    expect(onUpdate).not.toHaveBeenCalled();
    // Una release después: el worker nuevo toma el control → aviso.
    first.dispatchEvent(new Event('controllerchange'));
    expect(onUpdate).toHaveBeenCalledTimes(1);

    const controlled = new FakeContainer();
    controlled.controller = {};
    const onUpdate2 = vi.fn();
    await registerServiceWorker(env({}, controlled), onUpdate2);
    controlled.dispatchEvent(new Event('controllerchange'));
    expect(onUpdate2).toHaveBeenCalledTimes(1);
  });

  it('también avisa si un worker nuevo queda instalado esperando (por si sw.js dejara de hacer skipWaiting)', async () => {
    const container = new FakeContainer();
    container.controller = {};
    const onUpdate = vi.fn();
    await registerServiceWorker(env({}, container), onUpdate);
    const worker = Object.assign(new EventTarget(), { state: 'installing' });
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event('updatefound'));
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('aviso de versión nueva', () => {
  it('un solo toast por versión, con «Recargar» y sin recargar solo', () => {
    const reload = vi.fn();
    setReloadForTests(reload);
    expect(announceUpdate()).toBe(true);
    expect(announceUpdate()).toBe(false);
    expect(announceUpdate('0.7.1')).toBe(false);
    const item = toastStore.get().at(-1);
    expect(item?.text).toBe('Hay una versión nueva de Ace Player Neo. Recarga para usarla.');
    expect(item?.action?.label).toBe('Recargar');
    expect(reload).not.toHaveBeenCalled();
    item?.action?.onAction();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(updateStore.get()).toEqual({ available: true, version: '0.7.1' });
    // Otra versión distinta después: otro aviso.
    expect(announceUpdate('0.7.2')).toBe(true);
    expect(toastStore.get().at(-1)?.text).toBe(
      'Hay una versión nueva de Ace Player Neo (0.7.2). Recarga para usarla.',
    );
  });
});

describe('versión del servidor', () => {
  beforeEach(() => setMode('live', 'bootstrap'));

  it('la del bootstrap es la base; si el servidor cambia tras un resync del SSE, aviso', async () => {
    const client = createQueryClient();
    client.setQueryData(routeKey('bootstrap'), { version: '0.7.0' });
    let server = '0.7.0';
    const fetchVersion = vi.fn(async () => server);
    const onUpdate = vi.fn();
    const stop = watchServerVersion({ client, fetchVersion, onUpdate });
    expect(fetchVersion).not.toHaveBeenCalled();
    dispatchSse('resync', { reason: 'buffer_miss' }, { id: null, synthetic: false });
    await vi.waitFor(() => expect(fetchVersion).toHaveBeenCalledTimes(1));
    expect(onUpdate).not.toHaveBeenCalled();
    server = '0.7.1';
    dispatchSse('resync', { reason: 'server_restart' }, { id: null, synthetic: false });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith('0.7.1'));
    stop();
  });

  it('también al volver el SSE tras un corte y al volver a la pestaña tras 30 min', async () => {
    const client = createQueryClient();
    client.setQueryData(routeKey('bootstrap'), { version: '0.7.0' });
    realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
    const fetchVersion = vi.fn(async () => '0.7.0');
    let clock = 1_000_000;
    let visibility: DocumentVisibilityState = 'visible';
    // defineProperty y no Object.assign: assign copiaría el valor del getter una vez.
    const doc = Object.defineProperty(new EventTarget(), 'visibilityState', {
      get: () => visibility,
    }) as unknown as Document;
    const stop = watchServerVersion({ client, fetchVersion, onUpdate: vi.fn(), now: () => clock, doc });
    realtimeStore.set({ status: 'connecting', lastEventId: null, attempts: 1 });
    realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
    await vi.waitFor(() => expect(fetchVersion).toHaveBeenCalledTimes(1));
    // Que termine esa comprobación (no se piden dos a la vez).
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Oculta 5 min: no pregunta.
    visibility = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    clock += 5 * 60_000;
    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    // Oculta 30 min: pregunta.
    visibility = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    clock += RECHECK_AFTER_HIDDEN_MS;
    visibility = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetchVersion).toHaveBeenCalledTimes(2));
    stop();
  });

  it('un bootstrap nuevo con otra versión también cuenta; en la demo no se pregunta nada', async () => {
    const client = createQueryClient();
    client.setQueryData(routeKey('bootstrap'), { version: '0.7.0' });
    const onUpdate = vi.fn();
    const stop = watchServerVersion({ client, fetchVersion: async () => '0.7.0', onUpdate });
    client.setQueryData(routeKey('bootstrap'), { version: '0.8.0' });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith('0.8.0'));
    stop();

    setMode('demo', 'param');
    const demoFetch = vi.fn(async () => '9.9.9');
    const stopDemo = watchServerVersion({ client: createQueryClient(), fetchVersion: demoFetch, onUpdate });
    dispatchSse('resync', { reason: 'server_restart' }, { id: null, synthetic: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(demoFetch).not.toHaveBeenCalled();
    stopDemo();
  });
});

describe('manifiesto y accesos directos', () => {
  it('«Agenda» y «Biblioteca» del icono abren esas vistas (?vista=…)', () => {
    const manifest = JSON.parse(readFileSync(path.join(WEB, 'public', 'manifest.webmanifest'), 'utf8')) as {
      id: string;
      start_url: string;
      shortcuts: Array<{ name: string; url: string }>;
    };
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    const byName = Object.fromEntries(manifest.shortcuts.map((s) => [s.name, s.url]));
    expect(byName['Agenda de fútbol']).toBe('/?vista=agenda');
    expect(byName.Biblioteca).toBe('/?vista=biblioteca');
    for (const shortcut of manifest.shortcuts) {
      const search = new URL(shortcut.url, 'http://umbrel.local:7792').search;
      expect(parseRoute(search).vista).toBe(shortcut.url.endsWith('biblioteca') ? 'biblioteca' : 'agenda');
    }
  });
});
