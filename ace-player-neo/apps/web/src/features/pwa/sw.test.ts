/* El service worker de verdad (scripts/templates/sw.js, el que scripts/release.mjs
   sella con la versión y la lista de precarga) ejecutado en un entorno de
   worker simulado: instalar, activar y cada tipo de petición (B-242,
   inventario §16). scripts/test/release.test.ts ya comprueba que la release
   lo sella bien; aquí se prueba lo que HACE. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMPLATE = readFileSync(path.resolve(WEB, '../../scripts/templates/sw.js'), 'utf8');
const ORIGIN = 'http://umbrel.local:7792';
const VERSION = 'aceneo-0.7.0';
const PRECACHE = ['/', '/assets/index-3f2a1b9c.js', '/assets/index-77aa11bb.css', '/icon-192.png'];

type Listener = (event: never) => void;

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

function request(url: string, init: Partial<FakeRequest> = {}): FakeRequest {
  return { url: new URL(url, ORIGIN).href, method: 'GET', mode: 'cors', ...init };
}

function keyOf(input: string | FakeRequest): string {
  return new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname;
}

function worker({ failing = [] as string[] } = {}) {
  const stores = new Map<string, Map<string, Response>>([
    ['aceneo-0.6.59', new Map([['/', new Response('viejo')]])],
  ]);
  const cacheOf = (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    return {
      add: async (url: string) => {
        if (failing.includes(url)) throw new Error(`no se pudo descargar ${url}`);
        store.set(keyOf(url), new Response(`copia de ${url}`));
      },
      put: async (input: string | FakeRequest, response: Response) => {
        store.set(keyOf(input), response);
      },
    };
  };
  const caches = {
    open: vi.fn(async (name: string) => cacheOf(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    match: vi.fn(async (input: string | FakeRequest) => {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(input));
        if (hit) return hit.clone();
      }
      return undefined;
    }),
  };
  let online = true;
  const network = vi.fn(async (input: FakeRequest) => {
    if (!online) throw new TypeError('Failed to fetch');
    const response = new Response(`red: ${keyOf(input)}`, { status: 200 });
    Object.defineProperty(response, 'type', { value: 'basic' });
    return response;
  });
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const source = TEMPLATE.replace(
    "const VERSION = 'aceneo-0.0.0';",
    `const VERSION = "${VERSION}";`,
  ).replace('[/* __ACE_PRECACHE__ */]', JSON.stringify(PRECACHE));
  // El worker es un script clásico: se ejecuta con su «self», caches y fetch simulados.
  new Function('self', 'caches', 'fetch', 'Response', source)(self, caches, network, Response);

  const waitUntil = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    (listeners.get(type) as (event: { waitUntil(p: Promise<unknown>): void }) => void)({
      waitUntil: (promise) => {
        done = promise;
      },
    });
    await done;
  };
  /** Lo que contesta el worker, o null si deja la petición a la red sin tocarla. */
  const fetchEvent = async (req: FakeRequest): Promise<Response | null> => {
    let answer: Promise<Response> | null = null;
    (
      listeners.get('fetch') as (event: {
        request: FakeRequest;
        respondWith(p: Promise<Response>): void;
      }) => void
    )({
      request: req,
      respondWith: (promise) => {
        answer = promise;
      },
    });
    return answer ? await answer : null;
  };
  return {
    self,
    stores,
    caches,
    network,
    waitUntil,
    fetchEvent,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('service worker (B-242)', () => {
  it('al instalarse precarga el armazón uno a uno (uno roto no tumba al resto) y hace skipWaiting', async () => {
    const sw = worker({ failing: ['/icon-192.png'] });
    await sw.waitUntil('install');
    expect([...sw.stores.get(VERSION)!.keys()].sort()).toEqual(
      ['/', '/assets/index-3f2a1b9c.js', '/assets/index-77aa11bb.css'].sort(),
    );
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('al activarse borra las cachés de otras versiones y toma el control (clients.claim)', async () => {
    const sw = worker();
    await sw.waitUntil('install');
    await sw.waitUntil('activate');
    expect(sw.caches.delete).toHaveBeenCalledWith('aceneo-0.6.59');
    expect([...sw.stores.keys()]).toEqual([VERSION]);
    expect(sw.self.clients.claim).toHaveBeenCalledTimes(1);
  });

  it('nunca toca /api, /ace, /content, /remux ni /native, ni lo que no es GET o es de otro origen', async () => {
    const sw = worker();
    for (const url of [
      '/api/v1/football',
      '/ace/r/abc/def',
      '/content/abc/0.ts',
      '/remux/abc/index.m3u8',
      '/native/api/v1/bootstrap',
      '/api',
    ])
      expect(await sw.fetchEvent(request(url))).toBeNull();
    expect(
      await sw.fetchEvent(request('/assets/index-3f2a1b9c.js', { method: 'POST' })),
    ).toBeNull();
    expect(await sw.fetchEvent(request('https://cdn.example.com/x.js'))).toBeNull();
    expect(sw.network).not.toHaveBeenCalled();
  });

  it('el documento va primero a la red (y guarda copia en «/»); sin red, sale de la caché', async () => {
    const sw = worker();
    await sw.waitUntil('install');
    await sw.waitUntil('activate');
    const online = await sw.fetchEvent(request('/?vista=agenda', { mode: 'navigate' }));
    expect(await online!.text()).toBe('red: /');
    await settle();
    expect(await sw.stores.get(VERSION)!.get('/')!.clone().text()).toBe('red: /');
    sw.setOnline(false);
    const offline = await sw.fetchEvent(request('/?vista=biblioteca', { mode: 'navigate' }));
    expect(await offline!.text()).toBe('red: /');
  });

  it('los estáticos salen de la caché; si no están, de la red, y se guardan', async () => {
    const sw = worker();
    await sw.waitUntil('install');
    const cached = await sw.fetchEvent(request('/assets/index-3f2a1b9c.js'));
    expect(await cached!.text()).toBe('copia de /assets/index-3f2a1b9c.js');
    expect(sw.network).not.toHaveBeenCalled();
    const fresh = await sw.fetchEvent(request('/assets/hls-1a2b3c4d.js'));
    expect(await fresh!.text()).toBe('red: /assets/hls-1a2b3c4d.js');
    await settle();
    expect(sw.stores.get(VERSION)!.has('/assets/hls-1a2b3c4d.js')).toBe(true);
  });
});
