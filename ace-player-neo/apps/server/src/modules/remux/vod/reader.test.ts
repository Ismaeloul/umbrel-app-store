/* Lector por Range contra el relé VOD (docs/vod.md §9.4) con un servidor
   local en loopback que hace de relé: rangos exactos, el tamaño del fichero,
   los errores del relé con su cabecera, un 416 sin ella que NO es «sin
   saltos» (P9), lecturas a medias o de más, plazo y cancelación. */

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../core/errors.js';
import { loopbackHost } from '../../../../test/fake-engine/test-utils.js';
import {
  VOD_ERROR_HEADER,
  VOD_REASON_HEADER,
  createBufferReader,
  createHttpRangeReader,
  isRelayUrl,
  relayError,
} from './reader.js';

const TICKET = 'AbCdEfGhIjKlMnOpQrStUv';
const DATA = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 13) & 0xff));

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let host: string;
beforeAll(async () => {
  host = await loopbackHost();
});

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()?.close();
});

/** Relé de pega: por defecto sirve DATA con Range como el de verdad. */
async function relay(handler?: Handler): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    res.on('error', () => undefined);
    requests.push(String(req.headers.range));
    if (handler) {
      handler(req, res);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range));
    const start = Number(match?.[1]);
    const end = Math.min(Number(match?.[2]), DATA.length - 1);
    if (!match || start >= DATA.length) {
      res.writeHead(416, { 'content-range': `bytes */${DATA.length}` }).end();
      return;
    }
    res.writeHead(206, {
      'content-range': `bytes ${start}-${end}/${DATA.length}`,
      'content-length': String(end - start + 1),
    });
    res.end(DATA.subarray(start, end + 1));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  servers.push({
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  });
  const port = (server.address() as AddressInfo).port;
  const hostInUrl = host.includes(':') ? `[${host}]` : host;
  return { url: `http://${hostInUrl}:${port}/r/${TICKET}/vod.mkv`, requests };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('debía fallar');
}

describe('isRelayUrl', () => {
  it('solo el relé en loopback con un ticket', () => {
    expect(isRelayUrl(`http://127.0.0.1:4100/r/${TICKET}/vod.mkv`)).toBe(true);
    expect(isRelayUrl(`http://[::1]:4100/r/${TICKET}/vod.mp4`)).toBe(true);
    expect(isRelayUrl(`http://10.0.0.5:4100/r/${TICKET}/vod.mkv`)).toBe(false);
    expect(isRelayUrl(`http://127.0.0.1:4100/movie/u/p/1.mkv`)).toBe(false);
    expect(isRelayUrl(`http://127.0.0.1:4100/r/corto/vod.mkv`)).toBe(false);
    expect(isRelayUrl(`https://127.0.0.1:4100/r/${TICKET}/vod.mkv`)).toBe(false);
  });

  it('el lector no se crea fuera del relé', () => {
    expect(() => createHttpRangeReader('http://iptv.example/movie/u/p/1.mkv')).toThrow(
      'internal_error',
    );
  });
});

describe('relayError', () => {
  it('la cabecera del relé manda; 200 es sin_saltos; 416 sin cabecera no (P9)', () => {
    const busy = relayError(503, { [VOD_ERROR_HEADER]: 'vod_busy' });
    expect(busy.code).toBe('vod_busy');
    const rangeless = relayError(416, {
      [VOD_ERROR_HEADER]: 'vod_unsupported',
      [VOD_REASON_HEADER]: 'sin_saltos',
    });
    expect(rangeless.code).toBe('vod_unsupported');
    expect(rangeless.data).toEqual({ reason: 'sin_saltos' });
    expect(relayError(200, {}).data).toEqual({ reason: 'sin_saltos' });
    expect(relayError(416, {}).code).toBe('vod_dropped');
    expect(relayError(502, { [VOD_ERROR_HEADER]: 'no_es_un_codigo' }).code).toBe('vod_dropped');
  });
});

describe('createHttpRangeReader', () => {
  it('lee el rango exacto, aprende el tamaño y no pide más allá del final', async () => {
    const r = await relay();
    const reader = createHttpRangeReader(r.url);
    expect(reader.size()).toBeNull();
    expect((await reader.read(100, 199)).equals(DATA.subarray(100, 200))).toBe(true);
    expect(reader.size()).toBe(DATA.length);
    /* Recortado al final del fichero. */
    expect((await reader.read(9_990, 20_000)).equals(DATA.subarray(9_990))).toBe(true);
    expect(r.requests.at(-1)).toBe('bytes=9990-9999');
    /* Más allá del final: vacío y sin petición. */
    const before = r.requests.length;
    expect((await reader.read(10_000, 10_100)).length).toBe(0);
    expect(r.requests.length).toBe(before);
  });

  it('un 416 con el tamaño, leyendo más allá del final, es un trozo vacío', async () => {
    const r = await relay();
    const reader = createHttpRangeReader(r.url);
    expect((await reader.read(20_000, 20_099)).length).toBe(0);
    expect(reader.size()).toBe(DATA.length);
  });

  it('un 416 sin tamaño es vod_dropped, no sin_saltos (P9)', async () => {
    const r = await relay((_req, res) => res.writeHead(416).end());
    const error = await failure(createHttpRangeReader(r.url).read(0, 99));
    expect(error.code).toBe('vod_dropped');
  });

  it('200 (el proveedor no hace caso del Range) → vod_unsupported sin_saltos', async () => {
    const r = await relay((_req, res) => res.writeHead(200).end(DATA));
    const error = await failure(createHttpRangeReader(r.url).read(0, 99));
    expect(error.code).toBe('vod_unsupported');
    expect(error.data).toEqual({ reason: 'sin_saltos' });
  });

  it('el código vod_* del relé llega con su motivo', async () => {
    const r = await relay((_req, res) =>
      res.writeHead(503, { [VOD_ERROR_HEADER]: 'vod_busy', [VOD_REASON_HEADER]: 'x' }).end(),
    );
    const error = await failure(createHttpRangeReader(r.url).read(0, 99));
    expect(error.code).toBe('vod_busy');
    expect(error.data).toEqual({ reason: 'x' });
  });

  it('más del tope → vod_unsupported índice, sin pedir nada', async () => {
    const r = await relay();
    const error = await failure(createHttpRangeReader(r.url, { maxBytes: 1000 }).read(0, 1000));
    expect(error.code).toBe('vod_unsupported');
    expect(error.data).toEqual({ reason: 'indice' });
    expect(r.requests).toHaveLength(0);
  });

  it('Content-Range de otro inicio → vod_dropped', async () => {
    const r = await relay((_req, res) =>
      res
        .writeHead(206, { 'content-range': `bytes 5-104/${DATA.length}` })
        .end(DATA.subarray(5, 105)),
    );
    expect((await failure(createHttpRangeReader(r.url).read(0, 99))).code).toBe('vod_dropped');
  });

  it('un cuerpo a medias o de más → vod_dropped', async () => {
    const short = await relay((_req, res) => {
      res.writeHead(206, { 'content-range': `bytes 0-99/${DATA.length}` });
      res.end(DATA.subarray(0, 50));
    });
    expect((await failure(createHttpRangeReader(short.url).read(0, 99))).code).toBe('vod_dropped');
    const long = await relay((_req, res) => {
      res.writeHead(206, { 'content-range': `bytes 0-99/${DATA.length}` });
      res.end(DATA.subarray(0, 150));
    });
    expect((await failure(createHttpRangeReader(long.url).read(0, 99))).code).toBe('vod_dropped');
  });

  it('una conexión cortada a mitad → vod_dropped', async () => {
    const r = await relay((_req, res) => {
      res.writeHead(206, {
        'content-range': `bytes 0-999/${DATA.length}`,
        'content-length': '1000',
      });
      res.write(DATA.subarray(0, 200), () => res.socket?.destroy());
    });
    expect((await failure(createHttpRangeReader(r.url).read(0, 999))).code).toBe('vod_dropped');
  });

  it('sin respuesta en el plazo → vod_timeout', async () => {
    const r = await relay(() => undefined);
    const error = await failure(createHttpRangeReader(r.url, { timeoutMs: 150 }).read(0, 99));
    expect(error.code).toBe('vod_timeout');
  });

  it('la señal cancela la lectura en curso con su motivo', async () => {
    const r = await relay(() => undefined);
    const controller = new AbortController();
    const pending = createHttpRangeReader(r.url, { signal: controller.signal }).read(0, 99);
    setTimeout(() => controller.abort(new AppError('vod_dropped', { detail: 'cerrada' })), 50);
    expect((await failure(pending)).code).toBe('vod_dropped');
    const already = new AbortController();
    already.abort(new AppError('vod_timeout'));
    expect(
      (await failure(createHttpRangeReader(r.url, { signal: already.signal }).read(0, 9))).code,
    ).toBe('vod_timeout');
  });

  it('rangos sin sentido → internal_error', async () => {
    const r = await relay();
    const reader = createHttpRangeReader(r.url);
    expect((await failure(reader.read(10, 5))).code).toBe('internal_error');
    expect((await failure(reader.read(-1, 5))).code).toBe('internal_error');
  });
});

describe('createBufferReader', () => {
  it('lee de memoria y apunta las lecturas', async () => {
    const reads: { start: number; end: number }[] = [];
    const reader = createBufferReader(DATA, reads);
    expect((await reader.read(5, 9)).equals(DATA.subarray(5, 10))).toBe(true);
    expect((await reader.read(9_995, 20_000)).length).toBe(5);
    expect(reads).toEqual([
      { start: 5, end: 9 },
      { start: 9_995, end: 20_000 },
    ]);
    expect(reader.size()).toBe(DATA.length);
  });
});
