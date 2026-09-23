/* Revisión de seguridad (docs/seguridad.md §3.5): contaminación del
   prototipo y claves "mágicas" en todas las rutas que leen un cuerpo.

   Por qué: la web manda JSON libre a las rutas antiguas (PUT /api/state,
   /api/library…) y un iPhone emparejado puede escribir en v1 (fuentes,
   biblioteca, preferencias): nombres de canal, proveedores o ids de lista
   acaban como CLAVES de objetos del estado (estadísticas por proveedor,
   renombres, vínculos). Si alguna se escribiera con `obj[clave] = …` o se
   leyera sin `Object.hasOwn`, un `"__proto__"` o un `"constructor"`:
   - contaminaría `Object.prototype` de todo el proceso, o
   - dejaría en disco un estado que rompe cada arranque o cada GET (DoS
     persistente, también desde un dispositivo emparejado).
   Aquí se manda de todo con esas cargas (como texto: `JSON.parse` deja
   `__proto__` como clave propia, igual que en la petición real) y se
   comprueba que el proceso sigue limpio, que ninguna ruta da 500 y que el
   estado se sigue leyendo y guardando. */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createStateService } from '../../src/modules/state/index.js';
import { createHarness, WEB, type Harness } from './harness.js';

const HASH = 'b'.repeat(40);
/* Nombres que chocan con el prototipo o con métodos de Object. */
const POISONS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
/* Lo que se añade a CADA objeto del cuerpo (como texto, ver arriba). */
const POISON_KEYS = '"__proto__":{"polluted":"si"},"constructor":{"prototype":{"polluted":"si"}}';

/** JSON de `value` con las claves venenosas metidas en cada objeto. */
function poisonedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(poisonedJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}:${poisonedJson(item)}`,
    );
    return `{${[POISON_KEYS, ...entries].join(',')}}`;
  }
  return JSON.stringify(value);
}

/* Un cuerpo "de todo" para las rutas antiguas (aceptan cualquier JSON y
   normalizan lo que entienden): cada campo que alguna usa como clave o id. */
function kitchenSink(
  poison: string,
  id: string,
  action: string,
  collection: string,
): Record<string, unknown> {
  const item = { id, title: poison, category: poison, alias: poison, ih: false };
  return {
    action,
    item,
    id,
    hash: id,
    ih: false,
    dev: poison,
    device: poison,
    token: poison,
    viewer: poison,
    title: poison,
    channel: poison,
    channelKey: poison,
    source: poison,
    listaId: poison,
    proveedor: poison,
    resultado: 'arranco',
    segundos: 120,
    verdict: 'correct',
    reason: 'not_starting',
    matchId: poison,
    name: poison,
    sourceId: poison,
    collection,
    alias: poison,
    category: poison,
    favorites: [item],
    history: [item],
    web: [item],
    renames: { [poison]: poison, [HASH]: poison },
    hidden: [poison, HASH],
    webSources: [{ id: poison, name: poison, url: 'https://example.com/x.m3u', type: 'm3u' }],
    activeWebSourceId: poison,
    onboardingComplete: true,
    country: poison,
    leagues: [poison],
    teams: [poison],
    nationalities: [poison],
    preferences: { country: poison, leagues: [poison], teams: [poison] },
    channelBindings: [{ channel: poison, id, title: poison }],
  };
}

/* Rutas antiguas con cuerpo, salvo /api/streams/sync (sale a internet). */
const LEGACY_BODY_ROUTES: readonly (readonly [string, string])[] = [
  ['POST', '/api/preferences'],
  ['POST', '/api/football/bind'],
  ['POST', '/api/sources/report'],
  ['POST', '/api/sources/outcome'],
  ['POST', '/api/sources/feedback'],
  ['PUT', '/api/state'],
  ['POST', '/api/library'],
  ['POST', '/api/playback/claim'],
  ['POST', '/api/playback/release'],
  ['POST', '/api/remux/stop'],
  ['POST', '/api/streams/activate'],
  ['POST', '/api/streams/delete'],
];

/* v1 con cuerpo estricto: las cargas van en los VALORES que acaban siendo claves. */
function v1Requests(poison: string): readonly (readonly [string, string, unknown])[] {
  return [
    ['PUT', '/api/v1/preferences', { country: poison, leagues: [poison], teams: [poison] }],
    ['POST', '/api/v1/football/bindings', { channel: poison, id: HASH, title: poison }],
    ['POST', '/api/v1/football/bindings', { channel: poison, id: poison }],
    [
      'POST',
      '/api/v1/sources/report',
      { id: HASH, channel: poison, matchId: poison, source: poison },
    ],
    [
      'POST',
      '/api/v1/sources/outcome',
      {
        id: HASH,
        resultado: 'arranco',
        segundos: 300,
        title: poison,
        listaId: poison,
        source: poison,
      },
    ],
    ['POST', '/api/v1/sources/outcome', { id: poison, resultado: 'fallo', source: poison }],
    [
      'POST',
      '/api/v1/sources/feedback',
      { id: HASH, verdict: 'correct', channel: poison, channelKey: poison, title: poison },
    ],
    ['POST', '/api/v1/sources/feedback', { id: HASH, verdict: 'incorrect', channelKey: poison }],
    [
      'POST',
      '/api/v1/library',
      {
        action: 'favorite-upsert',
        item: { id: HASH, title: poison, category: poison, alias: poison },
      },
    ],
    ['POST', '/api/v1/library', { action: 'history-upsert', item: { id: poison, title: poison } }],
    ['POST', '/api/v1/library', { action: 'rename', collection: 'web', id: HASH, title: poison }],
    [
      'POST',
      '/api/v1/library',
      { action: 'rename', collection: 'favorites', id: poison, title: 'x' },
    ],
    [
      'POST',
      '/api/v1/library',
      { action: 'delete', collection: 'web', id: poison, sourceId: poison },
    ],
    ['POST', '/api/v1/diagnostics', { code: 'prueba', message: poison, channel: poison }],
    ...(/^[A-Za-z0-9_-]+$/.test(poison)
      ? ([
          ['POST', `/api/v1/directories/${poison}/activate`, undefined],
          ['DELETE', `/api/v1/directories/${poison}`, undefined],
        ] as const)
      : []),
  ];
}

function prototypeSnapshot(): string {
  return JSON.stringify([
    Object.getOwnPropertyNames(Object.prototype).sort(),
    Object.getOwnPropertyNames(Array.prototype).sort(),
    Object.getOwnPropertyNames(Function.prototype).sort(),
  ]);
}

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('seguridad · cargas con __proto__ / constructor en los cuerpos', () => {
  it('ninguna ruta contamina el prototipo, da 500 ni deja un estado que no se lee', async () => {
    const h = await createHarness();
    current = h;
    const before = prototypeSnapshot();
    const send = async (method: string, url: string, payload: string | undefined) => {
      const response = await h.app.inject({
        method: method as 'POST',
        url,
        headers: { ...WEB, 'content-type': 'application/json' },
        ...(payload === undefined ? {} : { payload }),
      });
      const label = `${method} ${url} ${payload?.slice(0, 160) ?? ''}`;
      expect(response.statusCode, `${label} -> ${response.body.slice(0, 200)}`).toBeLessThan(500);
      expect(({} as Record<string, unknown>).polluted, label).toBeUndefined();
      expect(prototypeSnapshot(), label).toBe(before);
    };

    /* El propio estado, envenenado entero, de vuelta por PUT /api/state. */
    const state = await h.app.inject({ method: 'GET', url: '/api/state', headers: WEB });
    expect(state.statusCode).toBe(200);
    await send('PUT', '/api/state', poisonedJson(state.json()));

    for (const poison of POISONS) {
      for (const [method, url] of LEGACY_BODY_ROUTES) {
        /* /api/library decide por `action` y `collection`; las demás los ignoran. */
        const actions =
          url === '/api/library' ? ['favorite-upsert', 'history-upsert', 'rename', 'delete'] : [''];
        const collections = url === '/api/library' ? ['favorites', 'history'] : ['favorites'];
        for (const id of [HASH, poison]) {
          for (const action of actions) {
            for (const collection of collections) {
              await send(method, url, poisonedJson(kitchenSink(poison, id, action, collection)));
            }
          }
        }
      }
      for (const [method, url, body] of v1Requests(poison)) {
        await send(method, url, body === undefined ? undefined : JSON.stringify(body));
      }
    }
    await h.settle();

    /* El estado se sigue sirviendo, por las dos API, y se guarda en disco. */
    for (const url of ['/api/state', '/api/v1/bootstrap', '/api/v1/library', '/api/playback']) {
      const response = await h.app.inject({ method: 'GET', url, headers: WEB });
      expect(response.statusCode, `${url} -> ${response.body.slice(0, 200)}`).toBe(200);
    }
    await h.services.state.flush();
    const disk = readFileSync(h.core.config.paths.stateFile, 'utf8');
    expect(() => JSON.parse(disk)).not.toThrow();
    /* Y el siguiente arranque lo lee tal cual: ni apartado como corrupto ni
       recuperado de una copia (un DoS persistente saldría aquí). */
    const reloaded = createStateService(h.core);
    const report = await reloaded.load();
    expect(report.status).toBe('ready');
    expect(report.quarantined).toEqual([]);
    expect(reloaded.get().favorites.map((item) => item.id)).toContain(HASH);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(prototypeSnapshot()).toBe(before);
  }, 60_000);

  /* Cuerpos patológicos dentro del tope de 2 MiB: anidado de cientos de miles
     de niveles (una función recursiva sin tope reventaría la pila), decenas
     de miles de claves y una cadena enorme en un campo que se guarda. Lo que
     vale es que respondan (2xx/4xx, nunca 500) y que el estado no crezca. */
  it('anidado muy profundo, miles de claves o cadenas enormes: nunca 500', async () => {
    const h = await createHarness();
    current = h;
    const depth = 400_000;
    const bodies: readonly (readonly [string, string])[] = [
      ['array anidado', `${'['.repeat(depth)}${']'.repeat(depth)}`],
      ['objeto anidado', `${'{"a":'.repeat(depth / 4)}1${'}'.repeat(depth / 4)}`],
      ['campo anidado', `{"favorites":${'['.repeat(depth)}${']'.repeat(depth)}}`],
      ['muchas claves', `{${Array.from({ length: 60_000 }, (_, i) => `"k${i}":1`).join(',')}}`],
      ['cadena enorme', JSON.stringify({ country: 'x'.repeat(1_500_000), title: 'y' })],
    ];
    const routes: readonly (readonly [string, string, Record<string, string>])[] = [
      ['PUT', '/api/state', WEB],
      ['POST', '/api/preferences', WEB],
      ['POST', '/api/library', WEB],
      ['PUT', '/api/v1/preferences', WEB],
      ['POST', '/native/api/v1/pairing/claim', {}],
    ];
    for (const [method, url, headers] of routes) {
      for (const [name, payload] of bodies) {
        const response = await h.app.inject({
          method: method as 'POST',
          url,
          headers: { ...headers, 'content-type': 'application/json' },
          payload,
        });
        expect(response.statusCode, `${method} ${url} (${name})`).toBeLessThan(500);
      }
    }
    const state = await h.app.inject({ method: 'GET', url: '/api/state', headers: WEB });
    expect(state.statusCode).toBe(200);
    /* La cadena enorme no se guarda entera (preferences.country se recorta). */
    expect(state.body.length).toBeLessThan(64 * 1024);
  }, 60_000);
});
