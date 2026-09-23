/* Cliente saliente con transporte y DNS falsos: T-005, la parte de red de
   T-116 y todo lo que arquitectura §5.11 pide (redirecciones comprobadas en
   cada salto, IP fijada, rebinding, plazos con el reloj inyectado). */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { DEFAULT_ACCEPT } from './client.js';
import { createNetClient, NetBadResponseError } from './index.js';
import { fetchText as legacyFetchText } from './legacy-exports.js';
import { fakeTransport, stalledBody, tableResolver, type FakeReply } from './testing.js';
import type { NetResolver, NetTransport, ResolvedAddress, TransportResponse } from './types.js';

const PUBLIC: readonly ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const PUBLIC_2: readonly ResolvedAddress[] = [{ address: '151.101.1.1', family: 4 }];

function setup(
  transport: NetTransport,
  resolver: NetResolver = tableResolver({ 'lista.example': PUBLIC, 'otra.example': PUBLIC_2 }),
  env: Record<string, string> = {},
) {
  const core = createTestCore({ env });
  const net = createNetClient({ ...core, resolver, transport });
  return { core, net };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

const redirect = (location: string, status = 302): FakeReply => ({
  status,
  headers: { location },
});

describe('T-005 · la descarga rechaza loopback antes de abrir la conexion (B-227)', () => {
  it('T-005 · la descarga rechaza loopback antes de abrir la conexion', async () => {
    const transport = fakeTransport({});
    const { net } = setup(transport);
    // dirección privada → private_url antes de conectar
    expect(await codeOf(net.fetchText('http://127.0.0.1:3000/private.m3u'))).toBe('private_url');
    // plazo vencido → fetch_timeout sin red
    expect(
      await codeOf(net.fetchText('https://lista.example/list.m3u', { totalTimeoutMs: 0 })),
    ).toBe('fetch_timeout');
    expect(transport.requests).toHaveLength(0);
  });

  it('la exportación antigua `fetchText` hace lo mismo con su firma posicional', async () => {
    await expect(legacyFetchText('http://127.0.0.1:1/private.m3u')).rejects.toThrow(/private_url/);
    await expect(legacyFetchText('https://example.com/list.m3u', 0, new Set(), 0)).rejects.toThrow(
      /fetch_timeout/,
    );
    // el plazo se mira antes que la URL, como en server.js:1343
    await expect(legacyFetchText('no-es-url', 0, new Set(), 0)).rejects.toThrow(/fetch_timeout/);
  });
});

describe('T-116 · el directorio guarda por que fallo la ultima actualizacion (B-195, parte de red)', () => {
  it('un 429 del servidor llega como http_429 (no como fetch_failed)', async () => {
    const { net } = setup(fakeTransport({ 'https://lista.example/list.m3u': { status: 429 } }));
    const error = await net.fetchText('https://lista.example/list.m3u').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('http_429');
    expect((error as Error).message).toBe('http_429');
  });

  it('un nombre que no existe es dns_failed (sin DNS real)', async () => {
    const { net } = setup(fakeTransport({}));
    expect(await codeOf(net.fetchText('https://no-existe.invalid/list.m3u'))).toBe('dns_failed');
  });
});

describe('URL admitidas (server.js:1344-1352)', () => {
  it.each([
    'no es una url',
    'ftp://lista.example/x',
    'file:///etc/passwd',
    'gopher://lista.example/',
    'https://usuario:clave@lista.example/list.m3u',
    'https://usuario@lista.example/list.m3u',
  ])('%s → bad_url', async (url) => {
    const transport = fakeTransport({});
    const { net } = setup(transport);
    expect(await codeOf(net.fetchText(url))).toBe('bad_url');
    expect(transport.requests).toHaveLength(0);
  });
});

describe('SSRF en el primer salto', () => {
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.01/',
    'http://127.1/',
    'http://0.0.0.0:6878/',
    'http://[::1]:3000/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fe80::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://localhost:3000/api/state',
    'http://umbrel.local/',
    'http://acestream:6878/webui/api/service',
  ])('%s → private_url sin conectar', async (url) => {
    const transport = fakeTransport({});
    const { net } = setup(transport);
    expect(await codeOf(net.fetchText(url))).toBe('private_url');
    expect(transport.requests).toHaveLength(0);
  });

  it('un nombre público que resuelve a una IP privada → private_url sin conectar', async () => {
    const transport = fakeTransport({});
    const { net } = setup(
      transport,
      tableResolver({
        'interna.example': [{ address: '192.168.1.20', family: 4 }],
        'v6.example': [{ address: 'fd00::5', family: 6 }],
        'mapeada.example': [{ address: '::ffff:10.0.0.1', family: 6 }],
      }),
    );
    for (const host of ['interna.example', 'v6.example', 'mapeada.example']) {
      expect(await codeOf(net.fetchText(`https://${host}/lista.m3u`)), host).toBe('private_url');
    }
    expect(transport.requests).toHaveLength(0);
  });
});

describe('la IP comprobada es la que se usa (sin rebinding)', () => {
  it('el transporte recibe las direcciones comprobadas y el DNS se consulta una sola vez por salto', async () => {
    let answer = 0;
    const resolver = tableResolver({
      // primera respuesta pública, segunda privada: la segunda no debe llegar a usarse
      'rebind.example': () => (answer++ === 0 ? PUBLIC : [{ address: '127.0.0.1', family: 4 }]),
    });
    const transport = fakeTransport({ 'https://rebind.example/lista.m3u': { body: 'ok' } });
    const { net } = setup(transport, resolver);
    const response = await net.fetchText('https://rebind.example/lista.m3u');
    expect(response.body).toBe('ok');
    expect(resolver.calls).toEqual(['rebind.example']);
    expect(transport.requests[0]?.addresses).toEqual(PUBLIC);
  });

  it('una redirección al mismo nombre se vuelve a comprobar: si ahora resuelve a privada, private_url', async () => {
    let answer = 0;
    const resolver = tableResolver({
      'rebind.example': () => (answer++ === 0 ? PUBLIC : [{ address: '10.0.0.7', family: 4 }]),
    });
    const transport = fakeTransport({
      'https://rebind.example/a': redirect('/b'),
      'https://rebind.example/b': { body: 'no debería llegar' },
    });
    const { net } = setup(transport, resolver);
    expect(await codeOf(net.fetchText('https://rebind.example/a'))).toBe('private_url');
    expect(transport.requests.map((request) => request.url.href)).toEqual([
      'https://rebind.example/a',
    ]);
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://[::1]/',
    'http://2130706433/',
    'http://localhost/',
    'http://interna.example/',
  ])('una redirección a %s → private_url sin seguirla', async (target) => {
    const transport = fakeTransport({ 'https://lista.example/list.m3u': redirect(target, 301) });
    const { net } = setup(
      transport,
      tableResolver({
        'lista.example': PUBLIC,
        'interna.example': [{ address: '172.17.0.2', family: 4 }],
      }),
    );
    expect(await codeOf(net.fetchText('https://lista.example/list.m3u'))).toBe('private_url');
    expect(transport.requests).toHaveLength(1);
  });
});

describe('redirecciones manuales (server.js:1378-1388)', () => {
  it('sigue hasta 5 saltos, relativas incluidas, y devuelve la URL final', async () => {
    const transport = fakeTransport({
      'https://lista.example/0': redirect('/1'),
      'https://lista.example/1': redirect('https://otra.example/2', 301),
      'https://otra.example/2': redirect('3', 307),
      'https://otra.example/3': redirect('https://lista.example/4', 308),
      'https://lista.example/4': redirect('/5', 303),
      'https://lista.example/5': { body: 'final', headers: { 'content-type': 'text/plain' } },
    });
    const { net } = setup(transport);
    const response = await net.fetchText('https://lista.example/0');
    expect(response).toEqual({
      body: 'final',
      url: 'https://lista.example/5',
      status: 200,
      contentType: 'text/plain',
    });
    expect(transport.requests[2]?.addresses).toEqual(PUBLIC_2);
  });

  it('el sexto salto es redirect_limit', async () => {
    const routes: Record<string, FakeReply> = {};
    for (let index = 0; index <= 6; index += 1) {
      routes[`https://lista.example/${index}`] = redirect(`/${index + 1}`);
    }
    const transport = fakeTransport(routes);
    const { net } = setup(transport);
    expect(await codeOf(net.fetchText('https://lista.example/0'))).toBe('redirect_limit');
    expect(transport.requests).toHaveLength(6);
  });

  it('volver a una URL ya visitada es redirect_loop', async () => {
    const transport = fakeTransport({
      'https://lista.example/a': redirect('/b'),
      'https://lista.example/b': redirect('https://LISTA.example/a'),
    });
    const { net } = setup(transport);
    expect(await codeOf(net.fetchText('https://lista.example/a'))).toBe('redirect_loop');
  });

  it('una redirección a otro esquema o con credenciales es bad_url', async () => {
    for (const location of ['ftp://lista.example/x', 'https://u:p@lista.example/', 'http://[::1']) {
      const transport = fakeTransport({ 'https://lista.example/a': redirect(location) });
      const { net } = setup(transport);
      expect(await codeOf(net.fetchText('https://lista.example/a')), location).toBe('bad_url');
    }
  });

  it('un 3xx sin Location es http_3NN', async () => {
    const { net } = setup(fakeTransport({ 'https://lista.example/a': { status: 304 } }));
    expect(await codeOf(net.fetchText('https://lista.example/a'))).toBe('http_304');
  });
});

describe('respuesta (server.js:1389-1419)', () => {
  it.each([404, 500, 503, 199])('estado %s → http_NNN', async (status) => {
    const { net } = setup(fakeTransport({ 'https://lista.example/a': { status, body: 'x' } }));
    expect(await codeOf(net.fetchText('https://lista.example/a'))).toBe(`http_${status}`);
  });

  it('pide identity y rechaza cualquier otra codificación', async () => {
    for (const encoding of ['gzip', 'br', 'deflate', 'GZIP']) {
      const { net } = setup(
        fakeTransport({
          'https://lista.example/a': { headers: { 'content-encoding': encoding }, body: 'x' },
        }),
      );
      expect(await codeOf(net.fetchText('https://lista.example/a')), encoding).toBe(
        'unsupported_encoding',
      );
    }
    const { net } = setup(
      fakeTransport({
        'https://lista.example/a': { headers: { 'content-encoding': 'Identity' }, body: 'x' },
      }),
    );
    expect((await net.fetchText('https://lista.example/a')).body).toBe('x');
  });

  it('manda User-Agent con la versión, Accept y Accept-Encoding: identity', async () => {
    const transport = fakeTransport({ 'https://lista.example/a': { body: '{}' } });
    const { net } = setup(transport);
    await net.fetchText('https://lista.example/a');
    await net.fetchText('https://lista.example/a', {
      accept: 'application/vnd.ipld.car',
      headers: { 'Accept-Encoding': 'gzip', 'X-Extra': '1' },
    });
    expect(transport.requests[0]?.headers).toEqual({
      'User-Agent': 'AcePlayerNeo/0.7.0-test',
      Accept: DEFAULT_ACCEPT,
      'Accept-Encoding': 'identity',
    });
    expect(transport.requests[1]?.headers).toEqual({
      'User-Agent': 'AcePlayerNeo/0.7.0-test',
      Accept: 'application/vnd.ipld.car',
      'Accept-Encoding': 'identity',
      'X-Extra': '1',
    });
  });

  it('2 MiB por defecto: justo el tope pasa, un byte más es response_too_large', async () => {
    const limit = 2 * 1024 * 1024;
    const exact = Buffer.alloc(limit, 97);
    const { net } = setup(
      fakeTransport({
        'https://lista.example/justo': {
          body: Readable.from([exact.subarray(0, 1000), exact.subarray(1000)]),
        },
        'https://lista.example/grande': { body: Readable.from([exact, Buffer.from('b')]) },
      }),
    );
    expect((await net.fetchBuffer('https://lista.example/justo')).body.length).toBe(limit);
    expect(await codeOf(net.fetchBuffer('https://lista.example/grande'))).toBe(
      'response_too_large',
    );
  });

  it('respeta maxBytes y un Content-Length mayor se rechaza sin leer', async () => {
    const body = new Readable({
      read() {
        throw new Error('no debería leerse');
      },
    });
    const { net } = setup(
      fakeTransport({
        'https://lista.example/a': { body: 'x'.repeat(11) },
        'https://lista.example/b': { headers: { 'content-length': '999999' }, body },
      }),
    );
    expect(await codeOf(net.fetchText('https://lista.example/a', { maxBytes: 10 }))).toBe(
      'response_too_large',
    );
    expect(await codeOf(net.fetchText('https://lista.example/b', { maxBytes: 10 }))).toBe(
      'response_too_large',
    );
  });

  it('fetchJson parsea y un JSON roto lanza NetBadResponseError (bad_response)', async () => {
    const { net } = setup(
      fakeTransport({
        'https://lista.example/ok': { body: '{"a":[1,2]}' },
        'https://lista.example/roto': { body: '{"a":' },
      }),
    );
    expect((await net.fetchJson('https://lista.example/ok')).body).toEqual({ a: [1, 2] });
    const error = await net.fetchJson('https://lista.example/roto').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetBadResponseError);
    expect((error as Error).message).toBe('bad_response');
  });

  it('un fallo de socket sale tal cual (como en la 0.6.59: la ruta antigua da 500)', async () => {
    const { net } = setup(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:443'), {
        code: 'ECONNREFUSED',
      });
    });
    const error = await net.fetchText('https://lista.example/a').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toMatch(/ECONNREFUSED/);
  });
});

describe('plazos con el reloj inyectado (45 s en total, 12 s de inactividad)', () => {
  it('sin respuesta en 12 s → fetch_timeout y la conexión se aborta', async () => {
    const seen: { signal?: AbortSignal } = {};
    const { net, core } = setup((request) => {
      seen.signal = request.signal;
      return new Promise(() => {});
    });
    const pending = codeOf(net.fetchText('https://lista.example/a'));
    await core.clock.advanceAsync(11_999);
    expect(seen.signal?.aborted).toBe(false);
    await core.clock.advanceAsync(1);
    expect(await pending).toBe('fetch_timeout');
    expect(seen.signal?.aborted).toBe(true);
    expect(core.clock.pendingTimers()).toBe(0);
  });

  it('un cuerpo que se queda parado 12 s → fetch_timeout', async () => {
    const body = stalledBody();
    const { net, core } = setup(fakeTransport({ 'https://lista.example/a': { body } }));
    const pending = codeOf(net.fetchText('https://lista.example/a'));
    await core.clock.advanceAsync(0);
    body.push('#EXTM3U\n');
    await core.clock.advanceAsync(11_000);
    body.push('más\n');
    await core.clock.advanceAsync(11_000);
    body.push('y más\n');
    await core.clock.advanceAsync(12_000);
    expect(await pending).toBe('fetch_timeout');
    expect(body.destroyed).toBe(true);
    expect(core.clock.pendingTimers()).toBe(0);
  });

  it('aunque lleguen datos, a los 45 s en total → fetch_timeout (plazo compartido por los saltos)', async () => {
    const body = stalledBody();
    const { net, core } = setup(
      fakeTransport({
        'https://lista.example/a': redirect('/b'),
        'https://lista.example/b': { body },
      }),
    );
    const pending = codeOf(net.fetchText('https://lista.example/a'));
    for (let elapsed = 0; elapsed < 44_000; elapsed += 4_000) {
      body.push('x');
      await core.clock.advanceAsync(4_000);
    }
    body.push('x');
    await core.clock.advanceAsync(1_000);
    expect(await pending).toBe('fetch_timeout');
  });

  it('respeta idleTimeoutMs y totalTimeoutMs propios', async () => {
    const { net, core } = setup(() => new Promise(() => {}));
    const pending = codeOf(net.fetchText('https://lista.example/a', { idleTimeoutMs: 500 }));
    await core.clock.advanceAsync(500);
    expect(await pending).toBe('fetch_timeout');
    const other = codeOf(
      net.fetchText('https://lista.example/a', { totalTimeoutMs: 300, idleTimeoutMs: 10_000 }),
    );
    await core.clock.advanceAsync(300);
    expect(await other).toBe('fetch_timeout');
  });

  it('una respuesta que llega después del plazo se cierra sin leerla', async () => {
    const holder: { resolve?: (reply: TransportResponse) => void } = {};
    const late = new Readable({ read() {} });
    const { net, core } = setup(
      () =>
        new Promise<TransportResponse>((resolve) => {
          holder.resolve = resolve;
        }),
    );
    const pending = codeOf(net.fetchText('https://lista.example/a'));
    await core.clock.advanceAsync(12_000);
    expect(await pending).toBe('fetch_timeout');
    holder.resolve?.({ status: 200, headers: {}, body: late });
    await core.clock.advanceAsync(0);
    expect(late.destroyed).toBe(true);
  });

  it('la señal externa cancela la descarga con su motivo', async () => {
    const body = stalledBody();
    const controller = new AbortController();
    const { net, core } = setup(fakeTransport({ 'https://lista.example/a': { body } }));
    const pending = net.fetchText('https://lista.example/a', { signal: controller.signal });
    await core.clock.advanceAsync(0);
    controller.abort(new AppError('fetch_timeout', { detail: 'plazo de la agenda' }));
    await expect(pending).rejects.toMatchObject({ code: 'fetch_timeout' });
    expect(body.destroyed).toBe(true);

    const already = new AbortController();
    already.abort(new Error('cancelado'));
    await expect(
      net.fetchText('https://lista.example/a', { signal: already.signal }),
    ).rejects.toThrow('cancelado');
    expect(core.clock.pendingTimers()).toBe(0);
  });
});

describe('ALLOW_PRIVATE_SYNC_URLS=true quita el filtro (server.js:70, 1312)', () => {
  it('deja pasar loopback y red local, y sigue fijando la IP resuelta', async () => {
    const transport = fakeTransport(() => ({ body: 'ok' }));
    const { net } = setup(
      transport,
      tableResolver({ 'nas.local': [{ address: '192.168.1.5', family: 4 }] }),
      { ALLOW_PRIVATE_SYNC_URLS: 'true' },
    );
    expect((await net.fetchText('http://127.0.0.1:8080/lista.m3u')).body).toBe('ok');
    expect((await net.fetchText('http://nas.local/lista.m3u')).body).toBe('ok');
    expect(transport.requests.map((request) => request.addresses)).toEqual([
      [{ address: '127.0.0.1', family: 4 }],
      [{ address: '192.168.1.5', family: 4 }],
    ]);
  });

  it('isPrivateAddress e isPrivateHostname del servicio son las puras', () => {
    const { net } = setup(fakeTransport({}));
    expect(net.isPrivateAddress('10.1.1.1')).toBe(true);
    expect(net.isPrivateAddress('8.8.8.8')).toBe(false);
    expect(net.isPrivateHostname('tv.lan')).toBe(true);
    expect(net.isPrivateHostname('example.org')).toBe(false);
  });
});
