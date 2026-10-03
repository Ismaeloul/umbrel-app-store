/* Proxy de carteles (docs/vod.md §8 y §15.1): bytes mágicos, topes, red de
   casa, redirecciones, cabeceras, caché en disco (LRU, nombres sin URL),
   caché negativa, ETag/304, `v`, tamaños de TMDB y 4 a la vez. */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOD_ART } from '@ace/shared';
import { deriveIptvKeys } from '../../../config/keys.js';
import { createNetClient } from '../../net/index.js';
import { fakeTransport, tableResolver, type FakeHandler } from '../../net/testing.js';
import { createTestCore } from '../../../../test/helpers/index.js';
import { etagMatches, imageTypeOf, tmdbSized, VodArtCache } from './art.js';

const KEYS = deriveIptvKeys('semilla-de-prueba-0123456789');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

function rig(handler: FakeHandler) {
  const core = createTestCore({ env: { ALLOW_PRIVATE_SYNC_URLS: 'true' } });
  const transport = fakeTransport(handler);
  const net = createNetClient({
    ...core,
    resolver: tableResolver({
      'img.example': [{ address: '93.184.216.34', family: 4 }],
      'image.tmdb.org': [{ address: '93.184.216.35', family: 4 }],
      'router.casa.example': [{ address: '192.168.1.1', family: 4 }],
      'panel.casa.example': [{ address: '192.168.1.20', family: 4 }],
    }),
    transport,
  });
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'vod-arte-')), 'arte');
  const art = new VodArtCache({
    net,
    clock: core.clock,
    logger: core.logger,
    dir,
    keys: () => KEYS,
    /* Como vod-service: la red de casa solo para el host EXACTO del proveedor. */
    policyFor: (url) => ({ lan: url.host === 'panel.casa.example:8080' }),
  });
  return { core, transport, art, dir };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe('bytes mágicos y TMDB', () => {
  it('JPEG, PNG y WebP sí; SVG y HTML no', () => {
    expect(imageTypeOf(JPEG)).toBe('image/jpeg');
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(WEBP)).toBe('image/webp');
    expect(imageTypeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageTypeOf(Buffer.from('<!doctype html><html>'))).toBeNull();
  });

  it('tamaños de TMDB por tipo; lo demás igual', () => {
    const url = 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg';
    expect(tmdbSized(url, 'poster')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(tmdbSized(url, 'backdrop')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg');
    expect(tmdbSized(url, 'still')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
    expect(tmdbSized('https://otro.tmdb.org/t/p/w600/a.jpg', 'poster')).toBe(
      'https://otro.tmdb.org/t/p/w600/a.jpg',
    );
    expect(etagMatches('W/"abc", "def"', 'def')).toBe(true);
  });
});

describe('VodArtCache', () => {
  it('sirve, guarda en disco sin la URL en el nombre y responde 304 y la `v`', async () => {
    const { art, transport, dir } = rig(() => ({ body: PNG }));
    const url = 'http://img.example/carteles/oppenheimer.png';
    const v = art.stamp(url);
    expect(v).toMatch(/^[a-f0-9]{8}$/);
    const first = await art.serve(url, 'poster', v, undefined);
    expect(first.status).toBe(200);
    expect(first.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
    const plain = await art.serve(url, 'poster', 'deadbeef', undefined);
    expect(plain.headers['cache-control']).toBe('private, no-cache');
    const notModified = await art.serve(url, 'poster', v, first.headers.etag);
    expect(notModified.status).toBe(304);
    expect(transport.requests).toHaveLength(1);
    const files = readdirSync(dir, { recursive: true }).map(String);
    expect(files.join('\n')).not.toMatch(/img\.example|oppenheimer|carteles/);
    const file = art.fileOf(url);
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it('SVG, HTML y lo que pasa del tope → vod_not_found, y se recuerda 1 h', async () => {
    let body: Buffer = Buffer.from('<svg/>');
    const { art, transport, core } = rig(() => ({ body }));
    expect(
      await codeOf(art.serve('http://img.example/a.svg', 'poster', undefined, undefined)),
    ).toBe('vod_not_found');
    expect(
      await codeOf(art.serve('http://img.example/a.svg', 'poster', undefined, undefined)),
    ).toBe('vod_not_found');
    expect(transport.requests).toHaveLength(1);
    core.clock.advance(VOD_ART.negativeMs + 1);
    body = PNG;
    expect(
      await codeOf(art.serve('http://img.example/a.svg', 'poster', undefined, undefined)),
    ).toBe('ok');
    body = Buffer.concat([PNG, Buffer.alloc(VOD_ART.posterMaxBytes)]);
    expect(
      await codeOf(art.serve('http://img.example/grande.png', 'poster', undefined, undefined)),
    ).toBe('vod_not_found');
    /* Un fondo admite 2 MiB. */
    expect(
      await codeOf(art.serve('http://img.example/fondo.png', 'backdrop', undefined, undefined)),
    ).toBe('ok');
  });

  it('la red de casa no vale salvo el host exacto del proveedor; redirección a 127.0.0.1 bloqueada', async () => {
    const { art } = rig((request) => {
      if (request.url.pathname === '/redirige') {
        return { status: 302, headers: { location: 'http://127.0.0.1/x.png' } };
      }
      return { body: PNG };
    });
    expect(
      await codeOf(art.serve('http://router.casa.example/a.png', 'poster', undefined, undefined)),
    ).toBe('vod_not_found');
    expect(
      await codeOf(
        art.serve('http://panel.casa.example:8080/a.png', 'poster', undefined, undefined),
      ),
    ).toBe('ok');
    expect(
      await codeOf(
        art.serve('http://panel.casa.example:9090/a.png', 'poster', undefined, undefined),
      ),
    ).toBe('vod_not_found');
    expect(
      await codeOf(art.serve('http://img.example/redirige', 'poster', undefined, undefined)),
    ).toBe('vod_not_found');
  });

  it('TMDB se pide al tamaño justo', async () => {
    const { art, transport } = rig(() => ({ body: JPEG }));
    await art.serve(
      'https://image.tmdb.org/t/p/original/abc.jpg',
      'backdrop',
      undefined,
      undefined,
    );
    expect(transport.requests[0]?.url.pathname).toBe('/t/p/w780/abc.jpg');
  });

  it('4 a la vez y 64 en cola; con la cola llena, vod_unavailable', async () => {
    let active = 0;
    let max = 0;
    const releases: Array<() => void> = [];
    const { art } = rig(
      () =>
        new Promise((resolve) => {
          active += 1;
          max = Math.max(max, active);
          releases.push(() => {
            active -= 1;
            resolve({ body: PNG });
          });
        }),
    );
    const all = Array.from({ length: 4 + VOD_ART.queue }, (_, i) =>
      art.serve(`http://img.example/${i}.png`, 'poster', undefined, undefined),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      await codeOf(art.serve('http://img.example/de-mas.png', 'poster', undefined, undefined)),
    ).toBe('vod_unavailable');
    let settled = 0;
    for (const promise of all) void promise.finally(() => (settled += 1));
    while (settled < all.length) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await Promise.all(all);
    expect(active).toBe(0);
    expect(max).toBe(VOD_ART.concurrent);
  });

  it('barrido LRU por mtime: 5 000 ficheros como mucho; restos que no son de la caché, fuera', async () => {
    const { art, dir } = rig(() => ({ body: PNG }));
    const sub = path.join(dir, 'ab');
    mkdirSync(sub, { recursive: true });
    const total = VOD_ART.cacheFiles + 3;
    for (let i = 0; i < total; i += 1) {
      const name = i.toString(16).padStart(32, '0');
      const file = path.join(sub, name);
      writeFileSync(file, PNG);
      const when = new Date(1_700_000_000_000 + i * 1000);
      utimesSync(file, when, when);
    }
    writeFileSync(path.join(sub, 'resto.tmp'), 'x');
    await art.sweep();
    const left = readdirSync(sub);
    expect(left).toHaveLength(VOD_ART.cacheFiles);
    /* Se van los más viejos. */
    expect(left).not.toContain((0).toString(16).padStart(32, '0'));
    expect(left).toContain((total - 1).toString(16).padStart(32, '0'));
  });
});
