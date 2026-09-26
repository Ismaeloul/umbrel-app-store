/* `net` para la IPTV (docs/iptv.md §3.1 y §2.4): filtro más duro aunque
   ALLOW_PRIVATE_SYNC_URLS esté activado, `openStream` con sus topes y plazos,
   gzip (por cabecera y por bytes mágicos) con tope de bytes descomprimidos y
   errores sin URLs. */

import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { createNetClient } from './index.js';
import { hostIsLan, isLanAddress, resolveIptvAddresses } from './ssrf.js';
import { fakeTransport, stalledBody, tableResolver, type FakeReply } from './testing.js';
import type { NetTransport, ResolvedAddress } from './types.js';

const PUBLIC: readonly ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];
const LAN: readonly ResolvedAddress[] = [{ address: '192.168.1.40', family: 4 }];
const LOOP: readonly ResolvedAddress[] = [{ address: '127.0.0.1', family: 4 }];

const resolver = tableResolver({
  'iptv.example': PUBLIC,
  'casa.example': LAN,
  'trampa.example': LOOP,
  'mixta.example': [...PUBLIC, ...LAN],
});

function setup(transport: NetTransport, env: Record<string, string> = {}) {
  const core = createTestCore({ env });
  return { core, net: createNetClient({ ...core, resolver, transport }) };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

async function detailOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? String(error.detail ?? '') : String(error);
  }
  return '';
}

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

describe('filtro de la IPTV (resolveIptvAddresses)', () => {
  const url = (value: string) => new URL(value);
  const open = { allowPrivate: true, lan: true };

  it('bloquea siempre loopback, enlace local, metadatos, multicast y 0/8, aunque se permitan las privadas', async () => {
    for (const target of [
      'http://127.0.0.1/x',
      'http://[::1]/x',
      'http://169.254.169.254/latest',
      'http://[fe80::1]/x',
      'http://224.0.0.1/x',
      'http://0.0.0.1/x',
      'http://100.64.0.1/x',
    ]) {
      expect(await codeOf(resolveIptvAddresses(url(target), resolver, open)), target).toBe(
        'private_url',
      );
    }
  });

  it('bloquea los nombres de una etiqueta (Docker), localhost y el puerto del relé', async () => {
    const policy = { ...open, blockedPorts: [41234] };
    expect(
      await codeOf(
        resolveIptvAddresses(
          url('http://ismaeloul-ace-player-neo_acestream_1:6878/'),
          resolver,
          policy,
        ),
      ),
    ).toBe('private_url');
    expect(await codeOf(resolveIptvAddresses(url('http://localhost/x'), resolver, policy))).toBe(
      'private_url',
    );
    expect(
      await codeOf(resolveIptvAddresses(url('http://iptv.example:41234/x'), resolver, policy)),
    ).toBe('private_url');
    expect(
      await codeOf(resolveIptvAddresses(url('http://trampa.example/x'), resolver, policy)),
    ).toBe('private_url');
  });

  it('RFC1918 solo con ALLOW_PRIVATE_SYNC_URLS Y host configurado de casa', async () => {
    const casa = url('http://casa.example/lista.m3u');
    expect(await codeOf(resolveIptvAddresses(casa, resolver, open))).toBe('ok');
    expect(
      await codeOf(resolveIptvAddresses(casa, resolver, { allowPrivate: true, lan: false })),
    ).toBe('private_url');
    expect(
      await codeOf(resolveIptvAddresses(casa, resolver, { allowPrivate: false, lan: true })),
    ).toBe('private_url');
    expect(await codeOf(resolveIptvAddresses(url('http://192.168.1.9/x'), resolver, open))).toBe(
      'ok',
    );
    /* Un nombre que resuelve a pública y privada a la vez: la privada manda. */
    expect(
      await codeOf(
        resolveIptvAddresses(url('http://mixta.example/x'), resolver, {
          allowPrivate: true,
          lan: false,
        }),
      ),
    ).toBe('private_url');
  });

  it('el detail lleva solo el host', async () => {
    expect(
      await detailOf(resolveIptvAddresses(url('http://127.0.0.1/u/p/1'), resolver, open)),
    ).toBe('127.0.0.1');
  });

  it('isLanAddress y hostIsLan', async () => {
    expect(isLanAddress('10.1.2.3')).toBe(true);
    expect(isLanAddress('172.20.0.1')).toBe(true);
    expect(isLanAddress('::ffff:192.168.0.1')).toBe(true);
    expect(isLanAddress('fd00::1')).toBe(true);
    expect(isLanAddress('127.0.0.1')).toBe(false);
    expect(isLanAddress('8.8.8.8')).toBe(false);
    // Las redes de Docker del Umbrel no son casa aunque sean RFC1918.
    expect(isLanAddress('10.21.21.9')).toBe(false);
    expect(isLanAddress('172.17.0.2')).toBe(false);
    expect(isLanAddress('::ffff:10.21.0.5')).toBe(false);
    expect(isLanAddress('10.22.0.1')).toBe(true);
    expect(await hostIsLan('casa.example', resolver)).toBe(true);
    expect(await hostIsLan('iptv.example', resolver)).toBe(false);
    expect(await hostIsLan('mixta.example', resolver)).toBe(false);
    expect(await hostIsLan('192.168.1.1', resolver)).toBe(true);
    expect(await hostIsLan('no-existe.example', resolver)).toBe(false);
  });
});

describe('fetchBuffer con la IPTV', () => {
  it('una redirección a loopback se bloquea en el salto aunque se permitan las privadas', async () => {
    const transport = fakeTransport({
      'http://iptv.example/get.php?username=U&password=P': {
        status: 302,
        headers: { location: 'http://127.0.0.1:3000/api/v1/state' },
      },
    });
    const { net } = setup(transport, { ALLOW_PRIVATE_SYNC_URLS: 'true' });
    const promise = net.fetchBuffer('http://iptv.example/get.php?username=U&password=P', {
      iptv: { lan: false },
    });
    expect(await codeOf(promise)).toBe('private_url');
    expect(transport.requests).toHaveLength(1);
  });

  it('gzip por cabecera y por bytes mágicos; sin IPTV sigue siendo unsupported_encoding', async () => {
    const zipped = gzipSync(Buffer.from('#EXTM3U\n'));
    const transport = fakeTransport({
      'http://iptv.example/a.m3u': { headers: { 'content-encoding': 'gzip' }, body: zipped },
      'http://iptv.example/b.m3u.gz': { body: zipped },
    });
    const { net } = setup(transport);
    const a = await net.fetchText('http://iptv.example/a.m3u', { iptv: { lan: false } });
    expect(a.body).toBe('#EXTM3U\n');
    const b = await net.fetchText('http://iptv.example/b.m3u.gz', { iptv: { lan: false } });
    expect(b.body).toBe('#EXTM3U\n');
    expect(await codeOf(net.fetchText('http://iptv.example/a.m3u'))).toBe('unsupported_encoding');
  });

  it('bomba gzip: corta al pasar del tope descomprimido', async () => {
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024, 0x41));
    const transport = fakeTransport({ 'http://iptv.example/guia.xml.gz': { body: bomb } });
    const { net } = setup(transport);
    expect(
      await codeOf(
        net.fetchBuffer('http://iptv.example/guia.xml.gz', {
          iptv: { lan: false, maxDecompressedBytes: 1024 * 1024 },
        }),
      ),
    ).toBe('response_too_large');
  });

  it('redirect_loop y bad_url sin URL cruda (docs/iptv.md §2.4)', async () => {
    const loop = fakeTransport({
      'http://iptv.example/live/usuario/clave/1.ts': {
        status: 302,
        headers: { location: 'http://iptv.example/live/usuario/clave/1.ts' },
      },
    });
    const { net } = setup(loop);
    const plain = await detailOf(net.fetchBuffer('http://iptv.example/live/usuario/clave/1.ts'));
    expect(plain).not.toContain('usuario');
    expect(plain).not.toContain('clave');
    const iptv = await detailOf(
      net.fetchBuffer('http://iptv.example/live/usuario/clave/1.ts', { iptv: { lan: false } }),
    );
    expect(iptv).toBe('iptv.example');
    const bad = fakeTransport({
      'http://iptv.example/x?password=clave': {
        status: 302,
        headers: { location: 'ftp://iptv.example/?password=clave' },
      },
    });
    const second = setup(bad);
    const badDetail = await detailOf(
      second.net.fetchBuffer('http://iptv.example/x?password=clave'),
    );
    expect(badDetail).not.toContain('clave');
  });
});

describe('openStream', () => {
  it('devuelve el cuerpo sin leerlo y sigue redirecciones comprobando cada salto', async () => {
    const transport = fakeTransport({
      'http://iptv.example/live/u/p/1.ts': {
        status: 302,
        headers: { location: 'http://iptv.example/lb/1.ts?token=abc' },
      },
      'http://iptv.example/lb/1.ts?token=abc': {
        headers: { 'content-type': 'video/mp2t' },
        body: Buffer.alloc(1000, 0x47),
      },
    });
    const { net } = setup(transport);
    const opened = await net.openStream('http://iptv.example/live/u/p/1.ts', {
      idleMs: 5000,
      iptv: { lan: false },
    });
    expect(opened.status).toBe(200);
    expect(opened.contentType).toBe('video/mp2t');
    expect(opened.finalUrl).toBe('http://iptv.example/lb/1.ts?token=abc');
    expect((await readAll(opened.body)).length).toBe(1000);
  });

  it('un estado que no es 2xx lanza http_NNN', async () => {
    const transport = fakeTransport({ 'http://iptv.example/x': { status: 458 } });
    const { net } = setup(transport);
    expect(await codeOf(net.openStream('http://iptv.example/x', { idleMs: 1000 }))).toBe(
      'http_458',
    );
  });

  it('gzip por bytes mágicos aunque lleguen de uno en uno, y tope de bytes', async () => {
    const zipped = gzipSync(Buffer.from('#EXTM3U\n#EXTINF:-1,Uno\nhttp://x/1.ts\n'));
    const bytes = [...zipped].map((byte) => Buffer.from([byte]));
    const transport = fakeTransport({
      'http://iptv.example/lista.m3u': () => ({ body: Readable.from(bytes) }),
      'http://iptv.example/grande': () => ({ body: Buffer.alloc(5000) }),
    });
    const { net } = setup(transport);
    const opened = await net.openStream('http://iptv.example/lista.m3u', {
      idleMs: 5000,
      iptv: { lan: false },
    });
    expect((await readAll(opened.body)).toString()).toContain('Uno');
    const big = await net.openStream('http://iptv.example/grande', {
      idleMs: 5000,
      maxBytes: 1000,
    });
    expect(await codeOf(readAll(big.body))).toBe('response_too_large');
  });

  it('inactividad: sin bytes en idleMs se corta con fetch_timeout', async () => {
    const transport = fakeTransport({
      'http://iptv.example/cuelga': () => ({ body: stalledBody() }),
    });
    const { core, net } = setup(transport);
    const opened = await net.openStream('http://iptv.example/cuelga', { idleMs: 10_000 });
    const reading = codeOf(readAll(opened.body));
    core.clock.advance(10_001);
    expect(await reading).toBe('fetch_timeout');
  });

  it('las cabeceras tienen su propio plazo', async () => {
    const transport: NetTransport = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason));
      });
    const { core, net } = setup(transport);
    const pending = codeOf(
      net.openStream('http://iptv.example/lento', { idleMs: 30_000, headersMs: 8000 }),
    );
    await Promise.resolve();
    await Promise.resolve();
    core.clock.advance(8001);
    expect(await pending).toBe('fetch_timeout');
  });

  it('destruir el cuerpo corta la conexión (señal del transporte abortada)', async () => {
    let seen: AbortSignal | null = null;
    const transport: NetTransport = async (request) => {
      seen = request.signal;
      return { status: 200, headers: {}, body: stalledBody() };
    };
    const { net } = setup(transport);
    const opened = await net.openStream('http://iptv.example/vivo', { idleMs: 10_000 });
    opened.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });

  it('una señal externa abortada corta el cuerpo', async () => {
    const reply: FakeReply = { body: stalledBody() };
    const transport = fakeTransport({ 'http://iptv.example/vivo': reply });
    const { net } = setup(transport);
    const controller = new AbortController();
    const opened = await net.openStream('http://iptv.example/vivo', {
      idleMs: 10_000,
      signal: controller.signal,
    });
    const reading = codeOf(readAll(opened.body));
    controller.abort(new AppError('iptv_disabled'));
    expect(await reading).toBe('iptv_disabled');
  });
});
