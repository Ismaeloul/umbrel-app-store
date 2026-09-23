/* Transporte real (`node:http`) contra un servidor local en ::1 (en este PC
   127.0.0.1 corta alguna conexión; ::1 no). Sin DNS real: el nombre
   `lista.example` solo existe en el resolvedor inyectado, así que si la
   petición llega es porque la conexión fue a la IP fijada. */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { createNetClient } from './index.js';
import { tableResolver } from './testing.js';
import { systemResolver } from './transport.js';

interface LocalServer {
  readonly port: number;
  readonly requests: http.IncomingMessage[];
  close(): Promise<void>;
}

const servers: LocalServer[] = [];

afterEach(async () => {
  while (servers.length) await servers.pop()?.close();
});

async function localServer(handler: http.RequestListener): Promise<LocalServer> {
  const requests: http.IncomingMessage[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
  const local: LocalServer = {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(local);
  return local;
}

function client(allowPrivate: boolean) {
  const core = createTestCore({
    env: allowPrivate ? { ALLOW_PRIVATE_SYNC_URLS: 'true' } : {},
  });
  const resolver = tableResolver({ 'lista.example': [{ address: '::1', family: 6 }] });
  return { core, resolver, net: createNetClient({ ...core, resolver }) };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

describe('transporte node:http con la IP fijada', () => {
  it('conecta a la IP que dio el resolvedor y conserva el nombre en Host', async () => {
    const server = await localServer((_req, res) => {
      res.setHeader('content-type', 'audio/x-mpegurl');
      res.end('#EXTM3U\n');
    });
    const { net, resolver } = client(true);
    const url = `http://lista.example:${server.port}/lista.m3u`;
    const response = await net.fetchText(url);
    expect(response).toEqual({
      body: '#EXTM3U\n',
      url,
      status: 200,
      contentType: 'audio/x-mpegurl',
    });
    expect(resolver.calls).toEqual(['lista.example']);
    const seen = server.requests[0];
    expect(seen?.headers.host).toBe(`lista.example:${server.port}`);
    expect(seen?.headers['accept-encoding']).toBe('identity');
    expect(seen?.headers['user-agent']).toBe('AcePlayerNeo/0.7.0-test');
  });

  it('sin ALLOW_PRIVATE_SYNC_URLS el mismo nombre (resuelve a ::1) no llega a conectar', async () => {
    const server = await localServer((_req, res) => res.end('no'));
    const { net } = client(false);
    expect(await codeOf(net.fetchText(`http://lista.example:${server.port}/`))).toBe('private_url');
    expect(await codeOf(net.fetchText(`http://[::1]:${server.port}/`))).toBe('private_url');
    expect(server.requests).toHaveLength(0);
  });

  it('T-116 · un servidor local que responde 429 da http_429', async () => {
    const server = await localServer((_req, res) => {
      res.statusCode = 429;
      res.end('despacio');
    });
    const { net } = client(true);
    expect(await codeOf(net.fetchText(`http://[::1]:${server.port}/list.m3u`))).toBe('http_429');
  });

  it('gzip → unsupported_encoding; más del tope → response_too_large', async () => {
    const server = await localServer((req, res) => {
      if (req.url === '/gzip') res.setHeader('content-encoding', 'gzip');
      res.end('x'.repeat(64));
    });
    const { net } = client(true);
    const base = `http://lista.example:${server.port}`;
    expect(await codeOf(net.fetchText(`${base}/gzip`))).toBe('unsupported_encoding');
    expect(await codeOf(net.fetchText(`${base}/grande`, { maxBytes: 10 }))).toBe(
      'response_too_large',
    );
    expect((await net.fetchText(`${base}/justo`, { maxBytes: 64 })).body).toHaveLength(64);
  });

  it('sigue redirecciones comprobando cada salto', async () => {
    const server = await localServer((req, res) => {
      if (req.url === '/a') {
        res.statusCode = 302;
        res.setHeader('location', '/b');
        res.end();
        return;
      }
      res.end(`final ${req.url}`);
    });
    const { net, resolver } = client(true);
    const response = await net.fetchText(`http://lista.example:${server.port}/a`);
    expect(response.body).toBe('final /b');
    expect(response.url).toBe(`http://lista.example:${server.port}/b`);
    expect(resolver.calls).toEqual(['lista.example', 'lista.example']);
  });

  it('un cuerpo que se para 12 s (reloj inyectado) corta la conexión con fetch_timeout', async () => {
    let received: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      received = resolve;
    });
    const server = await localServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('empieza');
      received();
    });
    const { net, core } = client(true);
    const pending = codeOf(net.fetchText(`http://lista.example:${server.port}/lento`));
    await arrived;
    await core.clock.advanceAsync(12_000);
    expect(await pending).toBe('fetch_timeout');
    expect(core.clock.pendingTimers()).toBe(0);
  });
});

describe('systemResolver', () => {
  it('devuelve las direcciones con su familia (con IP literales: sin preguntar al DNS)', async () => {
    await expect(systemResolver.lookup('127.0.0.1')).resolves.toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(systemResolver.lookup('::1')).resolves.toEqual([{ address: '::1', family: 6 }]);
  });
});
